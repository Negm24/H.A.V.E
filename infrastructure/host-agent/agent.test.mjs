import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { HostAgent, commandArgs, cpuPercent, bytes, ownedContainers, validateConfig, loadJournal, saveJournal } from './agent.mjs'

const root = resolve('.')
const config = { backendUrl: 'http://127.0.0.1:8000', token: 'a'.repeat(40), projectRoot: root, projectName: 'autopharm', journalPath: resolve(root, 'development/host-agent-state.json') }
const job = { id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', service: 'advisor', action: 'restart' }
const row = { ID: 'a'.repeat(64), Service: 'advisor', State: 'running', Name: 'autopharm-advisor-1', Labels: 'com.docker.compose.project=autopharm,com.docker.compose.service=advisor' }
const running = { Status: 'running', StartedAt: '2026-11-06T10:00:00Z' }
const dockerOutput = args => ({ stdout: JSON.stringify(args.includes('inspect') ? running : row) })
const trustedAgent = options => new HostAgent(config, { journalTrusted: true, ...options })

test('only fixed service actions are accepted, with no shell or lifecycle deletes', () => {
  assert.throws(() => commandArgs(config, { ...job, service: 'db' }, row))
  assert.throws(() => commandArgs(config, { ...job, service: 'advisor; rm -rf /' }, row))
  assert.throws(() => commandArgs(config, { ...job, action: 'down' }, row))
  assert.throws(() => commandArgs(config, job, { ...row, Labels: 'com.docker.compose.project=other,com.docker.compose.service=advisor' }))
  assert.throws(() => commandArgs(config, job, { ...row, Labels: 'com.docker.compose.project=autopharm,com.docker.compose.service=backend' }))
  assert.deepEqual(commandArgs(config, job, row), ['container', 'restart', '--timeout', '-1', row.ID])
  assert.deepEqual(commandArgs(config, { ...job, action: 'start' }, row), ['container', 'start', row.ID])
  assert.deepEqual(commandArgs(config, { ...job, action: 'stop' }, row), ['container', 'stop', '--timeout', '-1', row.ID])
})

test('rejects remote backend endpoints and other Compose projects', () => {
  assert.throws(() => validateConfig({ ...config, backendUrl: 'https://public.example.test' }))
  assert.throws(() => validateConfig({ ...config, projectName: 'other' }))
  assert.equal(ownedContainers([row, { ...row, Labels: 'com.docker.compose.project=other,com.docker.compose.service=advisor' }]).length, 1)
})

test('host CPU deltas and Docker memory units retain meaningful units', () => {
  assert.equal(cpuPercent({ total: 100, idle: 50 }, { total: 200, idle: 75 }), 75)
  assert.equal(cpuPercent({ total: 100, idle: 50 }, { total: 100, idle: 50 }), null)
  assert.equal(bytes('1.5GiB'), 1610612736)
  assert.equal(bytes('not available'), null)
})

test('lost acknowledgment does not execute a Restart twice', async () => {
  let executions = 0, reports = 0
  const agent = trustedAgent({ persist: async () => {}, docker: async args => { if (args.includes('restart')) executions++; return dockerOutput(args) }, request: async () => { reports++; if (reports === 1) throw new Error('Lost response'); return { ok: true, json: async () => ({}) } } })
  await assert.rejects(agent.execute(job))
  await agent.execute(job)
  assert.equal(executions, 1)
  assert.equal(reports, 2)
})

test('an interrupted intent is UNKNOWN after reconnect and never executed again', async () => {
  let executions = 0, outcome
  const agent = trustedAgent({ journal: { [job.id]: { stage: 'intent', service: job.service, action: job.action, reported: false } }, persist: async () => {}, docker: async args => { if (args.includes('restart')) executions++; return dockerOutput(args) }, request: async (_url, options) => { outcome = JSON.parse(options.body); return { ok: true, json: async () => ({}) } } })
  await agent.execute(job)
  assert.equal(executions, 0)
  assert.equal(outcome.status, 'UNKNOWN')
})

test('an unwritable intent journal prevents the Docker side effect', async () => {
  let executions = 0
  const agent = trustedAgent({ persist: async () => { throw new Error('Read only') }, docker: async args => { if (args.includes('restart')) executions++; return dockerOutput(args) } })
  await assert.rejects(agent.execute(job))
  assert.equal(executions, 0)
})

test('Restart uncertainty clears only after a proven later start of the same container', async () => {
  let executions = 0, outcome
  const journal = { [job.id]: { stage: 'intent', service: job.service, action: job.action, before: { id: row.ID, started_at: running.StartedAt }, reported: false } }
  let startedAt = running.StartedAt
  const agent = trustedAgent({ journal, persist: async () => {}, docker: async args => { if (args.includes('restart')) executions++; return { stdout: JSON.stringify(args.includes('inspect') ? { ...running, StartedAt: startedAt } : row) } }, request: async (_url, options) => { outcome = JSON.parse(options.body); return { ok: true, json: async () => ({}) } } })
  await agent.recover()
  assert.equal(outcome.status, 'UNKNOWN')
  startedAt = '2026-11-06T10:01:00Z'
  await agent.recover()
  assert.equal(outcome.status, 'SUCCEEDED')
  assert.equal(executions, 0)
})

test('a lost claim without a durable intent is failed without executing a command', async () => {
  let commands = 0, outcome
  const agent = trustedAgent({ persist: async () => {}, docker: async () => { commands++ }, request: async (_url, options) => { outcome = JSON.parse(options.body); return { ok: true, json: async () => ({}) } } })
  await agent.recoverClaims([job])
  assert.equal(outcome.status, 'FAILED')
  assert.equal(commands, 0)
})

test('host measurements continue while Docker is unavailable', async () => {
  let measurement
  const agent = trustedAgent({ docker: async () => { throw new Error('Docker unavailable') }, request: async (_url, options) => { measurement = JSON.parse(options.body); return { ok: true, json: async () => ({}) } } })
  await agent.heartbeat()
  assert.ok(measurement.host.memory_total_bytes > 0)
  assert.deepEqual(measurement.containers, [])
})

test('resource heartbeats continue while a cooperative Docker command is still pending', async () => {
  let heartbeats = 0, claims = 0, finish
  const agent = trustedAgent({ persist: async () => {} })
  agent.heartbeat = async () => { heartbeats++ }
  agent.api = async () => { claims++; return { job, unresolved: [] } }
  agent.execute = () => new Promise(resolve => { finish = resolve })
  await agent.tick()
  const execution = agent.execution
  await agent.tick()
  assert.equal(heartbeats, 2)
  assert.equal(claims, 1)
  finish(); await execution
})

test('durable journal round-trips and damaged state fails closed', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'autopharm-agent-test-'))
  const filename = resolve(directory, 'journal.json')
  try {
    const data = { [job.id]: { stage: 'intent', service: job.service, action: job.action, reported: false } }
    assert.deepEqual(await loadJournal(filename), { entries: {}, trusted: false })
    await saveJournal(filename, data, false)
    assert.deepEqual(await loadJournal(filename), { entries: data, trusted: false })
    await saveJournal(filename, data)
    assert.deepEqual(await loadJournal(filename), { entries: data, trusted: true })
    await writeFile(filename, 'damaged')
    await assert.rejects(loadJournal(filename), /actions are disabled/)
  } finally {
    await unlink(filename).catch(failure => { if (failure.code !== 'ENOENT') throw failure })
    await unlink(filename + '.tmp').catch(failure => { if (failure.code !== 'ENOENT') throw failure })
    await rmdir(directory)
  }
})

test('a changed target state fails closed before journalling or executing Restart', async () => {
  let mutations = 0, outcome
  const agent = trustedAgent({ persist: async () => {}, docker: async args => { if (args.includes('restart')) mutations++; return { stdout: JSON.stringify(args.includes('inspect') ? { Status: 'exited', StartedAt: running.StartedAt } : row) } }, request: async (_url, options) => { outcome = JSON.parse(options.body); return { ok: true, json: async () => ({}) } } })
  await agent.execute(job)
  assert.equal(mutations, 0)
  assert.equal(outcome.status, 'FAILED')
  assert.equal(outcome.result_code, 'target_rejected')
  assert.equal(Object.keys(agent.journal).length, 0)
})

test('discovery explicitly requests complete IDs before preparing a single-container command', async () => {
  const agent = trustedAgent({ docker: async args => ({ stdout: JSON.stringify(args.includes('--no-trunc') ? row : { ...row, ID: row.ID.slice(0, 12) }) }) })
  const [target] = await agent.containers()
  assert.equal(target.ID.length, 64)
  assert.deepEqual(commandArgs(config, job, target), ['container', 'restart', '--timeout', '-1', row.ID])
  assert.throws(() => commandArgs(config, job, { ...row, ID: row.ID.slice(0, 12) }))
})

test('missing journal plus an unresolved Restart stays UNKNOWN and never claims non-execution', async () => {
  let commands = 0, outcome
  const agent = new HostAgent(config, { journal: {}, journalTrusted: false, persist: async () => {}, docker: async () => { commands++ }, request: async (_url, options) => { outcome = JSON.parse(options.body); return { ok: true, json: async () => ({}) } } })
  await agent.recoverClaims([job])
  assert.equal(outcome.status, 'UNKNOWN')
  assert.equal(outcome.result_code, 'outcome_unknown')
  assert.equal(agent.journalTrusted, false)
  assert.equal(commands, 0)
  await assert.rejects(agent.execute(job), /continuity/)
})

test('first boot enables control only after a durable baseline and no unresolved jobs', async () => {
  const calls = [], saved = []
  const agent = new HostAgent(config, { journalTrusted: false, persist: async data => { saved.push(data) } })
  agent.heartbeat = async () => {}
  agent.api = async (_path, body) => { calls.push(body); return { job: null, unresolved: [] } }
  await agent.tick()
  assert.deepEqual(calls, [{ claim_new: false }])
  assert.equal(agent.journalTrusted, true)
  assert.equal(saved.length, 1)
})

test('corrupt history never overwrites its evidence or enables new controls', async () => {
  let writes = 0, commands = 0
  const calls = []
  const agent = new HostAgent(config, { journalCorrupt: true, persist: async () => { writes++ }, docker: async () => { commands++ } })
  agent.heartbeat = async () => {}
  agent.api = async (path, body) => { calls.push({ path, body }); return { job: null, unresolved: [job] } }
  await agent.tick()
  assert.equal(calls[0].body.claim_new, false)
  assert.equal(calls[1].body.status, 'UNKNOWN')
  assert.equal(writes, 0)
  assert.equal(commands, 0)
  assert.equal(agent.journalTrusted, false)
})
