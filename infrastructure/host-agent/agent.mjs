import { cpus, freemem, totalmem } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, writeFile, rename, mkdir, access, open, unlink } from 'node:fs/promises'
import { dirname, resolve, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
export const managedServices = new Set(['hub', 'kiosk', 'advisor', 'order-worker'])
export const knownServices = new Set([...managedServices, 'backend', 'db', 'redis', 'admin'])
const actions = new Set(['start', 'stop', 'restart'])
const dockerExecutable = process.platform === 'win32' ? 'docker.exe' : 'docker'
export const runDocker = args => execFileAsync(dockerExecutable, args, { shell: false, windowsHide: true, timeout: args[0] === 'container' && actions.has(args[1]) ? 180_000 : 10_000, maxBuffer: 2 * 1024 * 1024 })

export function validateConfig(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.token !== 'string' || raw.token.length < 32 || raw.projectName !== 'autopharm' || !isAbsolute(raw.projectRoot) || !isAbsolute(raw.journalPath)) throw new Error('Invalid private host agent configuration')
  const url = new URL(raw.backendUrl)
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== '8000' || url.pathname !== '/' || url.username || url.password || url.search || url.hash) throw new Error('Backend must be the configured loopback API')
  return { ...raw, backendUrl: url.origin, intervalMs: 5000, projectRoot: resolve(raw.projectRoot), journalPath: resolve(raw.journalPath) }
}

export function parseJsonRows(text) {
  if (!text.trim()) return []
  try { const parsed = JSON.parse(text); return Array.isArray(parsed) ? parsed : [parsed] } catch { return text.trim().split(/\r?\n/).map(row => JSON.parse(row)) }
}

export function cpuSnapshot(values = cpus()) {
  return values.reduce((result, cpu) => ({ idle: result.idle + cpu.times.idle, total: result.total + Object.values(cpu.times).reduce((sum, n) => sum + n, 0) }), { idle: 0, total: 0 })
}

export function cpuPercent(previous, current) {
  const total = current.total - previous.total
  return total > 0 ? Math.max(0, Math.min(100, 100 * (1 - (current.idle - previous.idle) / total))) : null
}

export function bytes(value) {
  const match = /^([\d.]+)\s*(B|KiB|MiB|GiB|TiB|kB|MB|GB|TB)$/i.exec(value.trim())
  if (!match) return null
  const units = { b: 1, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4, kb: 1000, mb: 1000 ** 2, gb: 1000 ** 3, tb: 1000 ** 4 }
  const result = Number(match[1]) * units[match[2].toLowerCase()]
  return Number.isFinite(result) ? Math.round(result) : null
}

function labels(row) {
  if (typeof row.Labels === 'object') return row.Labels
  return Object.fromEntries(String(row.Labels || '').split(',').map(item => { const index = item.indexOf('='); return [item.slice(0, index), item.slice(index + 1)] }))
}

export function ownedContainers(rows) {
  const seen = new Set()
  return rows.filter(row => {
    const tags = labels(row), service = tags['com.docker.compose.service'] || row.Service
    if (tags['com.docker.compose.project'] !== 'autopharm' || !knownServices.has(service) || seen.has(service)) return false
    seen.add(service); row.Service = service; return true
  })
}

function validateJob(job) {
  if (!managedServices.has(job.service) || !actions.has(job.action) || !/^[a-f\d-]{36}$/i.test(job.id)) throw new Error('Rejected service action')
}

export function commandArgs(config, job, target) {
  validateJob(job)
  if (config.projectName !== 'autopharm' || !target || !ownedContainers([target]).some(row => row.Service === job.service) || !/^[a-f\d]{64}$/i.test(target.ID)) throw new Error('Rejected container ownership')
  // Compose start/restart may traverse dependencies. Target one discovered,
  // labelled container instead; no ID ever comes from the browser or job DTO.
  const args = ['container', job.action]
  // Docker waits indefinitely for cooperative termination. An agent timeout
  // stops waiting for the CLI; it never escalates to killing the container.
  if (job.action === 'stop' || job.action === 'restart') args.push('--timeout', '-1')
  return [...args, target.ID]
}

export async function loadJournal(path) {
  try {
    const data = JSON.parse(await readFile(path, 'utf8'))
    const envelope = data?.version === 1 && typeof data.continuity === 'boolean'
    const entries = envelope ? data.entries : data
    if (!entries || typeof entries !== 'object' || Array.isArray(entries) || Object.entries(entries).some(([id, entry]) => !/^[a-f\d-]{36}$/i.test(id) || !entry || !managedServices.has(entry.service) || !actions.has(entry.action) || !['intent', 'finished'].includes(entry.stage) || typeof entry.reported !== 'boolean')) throw new Error('Invalid journal')
    // Existing nonempty legacy journals remain readable. An empty legacy file
    // cannot establish whether history was lost and must be reconciled first.
    return { entries, trusted: envelope ? data.continuity : Object.keys(entries).length > 0 }
  } catch (failure) {
    if (failure.code === 'ENOENT') return { entries: {}, trusted: false }
    throw new Error('Host journal unavailable; actions are disabled')
  }
}

export async function saveJournal(path, entries, continuity = true) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = path + '.tmp'
  await writeFile(temporary, JSON.stringify({ version: 1, continuity, entries }), { mode: 0o600, flush: true })
  await rename(temporary, path)
}

export class HostAgent {
  constructor(config, { docker = runDocker, request = fetch, journal, journalTrusted = false, journalCorrupt = false, persist } = {}) {
    this.config = validateConfig(config); this.docker = docker; this.request = request
    this.journal = journal || {}; this.journalTrusted = journalTrusted; this.journalCorrupt = journalCorrupt
    this.persist = persist || (data => saveJournal(this.config.journalPath, data, this.journalTrusted))
    this.previousCpu = cpuSnapshot(); this.busy = false; this.execution = null
  }
  async api(path, body) {
    const response = await this.request(this.config.backendUrl + '/internal/host-agent/' + path, { method: 'POST', headers: { Authorization: 'Bearer ' + this.config.token, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) })
    if (!response.ok) throw new Error('Private host API unavailable')
    return response.json()
  }
  async containers() {
    const prefix = ['compose', '--project-name', 'autopharm', '--file', resolve(this.config.projectRoot, 'compose.yaml')]
    return ownedContainers(parseJsonRows((await this.docker([...prefix, 'ps', '--all', '--no-trunc', '--format', 'json'])).stdout))
  }
  async containerState(row) {
    const reference = row.ID || row.Name || row.Names
    if (typeof reference !== 'string' || !/^[a-z\d][a-z\d_.-]+$/i.test(reference)) throw new Error('Unknown container reference')
    const state = JSON.parse((await this.docker(['inspect', '--format', '{{json .State}}', reference])).stdout)
    return { id: row.ID || reference, started_at: typeof state.StartedAt === 'string' ? state.StartedAt : null, state: state.Status }
  }
  async heartbeat() {
    const current = cpuSnapshot(), memory = totalmem(), used = memory - freemem()
    const cpu = cpuPercent(this.previousCpu, current); this.previousCpu = current
    let rows = []
    try { rows = await this.containers() } catch { /* Host metrics still work while Docker is unavailable. */ }
    let stats = []
    const names = rows.filter(row => row.State === 'running').map(row => row.Name || row.Names).filter(Boolean)
    if (names.length) {
      try { stats = parseJsonRows((await this.docker(['stats', '--no-stream', '--format', '{{json .}}', ...names])).stdout) } catch { /* Missing measurements remain null. */ }
    }
    const containers = rows.map(row => {
      const stat = stats.find(stat => stat.Name === (row.Name || row.Names) || stat.Container === row.ID)
      const [usage, limit] = String(stat?.MemUsage || '').split('/')
      const percentage = Number.parseFloat(stat?.CPUPerc)
      return { service: row.Service, state: ['running', 'stopped', 'exited', 'restarting', 'starting', 'dead', 'created'].includes(row.State) ? row.State : 'unknown', health: ['healthy', 'unhealthy', 'starting'].includes(row.Health) ? row.Health : 'unknown', cpu_percent: Number.isFinite(percentage) ? percentage : null, memory_bytes: usage ? bytes(usage) : null, memory_limit_bytes: limit ? bytes(limit) : null }
    })
    return this.api('heartbeat/', { host: { cpu_percent: cpu, memory_percent: memory ? used / memory * 100 : 0, memory_used_bytes: used, memory_total_bytes: memory }, containers })
  }
  async report(id, entry) {
    return this.api(`jobs/${id}/result/`, { status: entry.status, result_code: entry.result_code })
  }
  async recover() {
    if (!this.journalTrusted || this.journalCorrupt) return
    for (const [id, entry] of Object.entries(this.journal)) {
      if (entry.reported && entry.status !== 'UNKNOWN') continue
      if (entry.stage === 'intent') {
        entry.status = 'UNKNOWN'; entry.result_code = 'outcome_unknown'; entry.stage = 'finished'
        await this.persist(this.journal)
      }
      if (entry.status === 'UNKNOWN') {
        // Read-only reconciliation may prove a transition. A running container
        // alone cannot prove that an interrupted Restart actually happened.
        try {
          const row = (await this.containers()).find(row => row.Service === entry.service)
          const current = row && await this.containerState(row)
          const confirmed = entry.action === 'stop' ? current && ['exited', 'stopped'].includes(current.state)
            : entry.action === 'start' ? current?.state === 'running'
              : current?.state === 'running' && current.id === entry.before?.id && Number.isFinite(Date.parse(entry.before?.started_at)) && Date.parse(current.started_at) > Date.parse(entry.before.started_at)
          if (confirmed) {
            entry.status = 'SUCCEEDED'; entry.result_code = 'confirmed'; entry.reported = false
            await this.persist(this.journal)
          }
        } catch { /* Missing evidence keeps the outcome uncertain and blocks control. */ }
      }
      if (entry.reported) continue
      await this.report(id, entry)
      entry.reported = true; await this.persist(this.journal)
    }
  }
  async recoverClaims(jobs = []) {
    for (const job of jobs) {
      validateJob(job)
      if (!this.journalTrusted || this.journalCorrupt) {
        // A missing journal is not proof of non-execution. Preserve uncertainty
        // until a trusted journal or independent authoritative proof exists.
        const entry = this.journal[job.id] || { stage: 'finished', service: job.service, action: job.action, reported: false, status: 'UNKNOWN', result_code: 'outcome_unknown' }
        this.journal[job.id] = entry
        if (!this.journalCorrupt) await this.persist(this.journal)
        if (!entry.reported) {
          await this.report(job.id, entry); entry.reported = true
          if (!this.journalCorrupt) await this.persist(this.journal)
        }
        continue
      }
      if (this.journal[job.id]) continue
      // The exclusive, validated journal has no intent for this claimed job.
      // The effect therefore never started; recording that fact releases the
      // guard without executing or replaying the requested command.
      const entry = { stage: 'finished', service: job.service, action: job.action, reported: false, status: 'FAILED', result_code: 'execution_failed' }
      this.journal[job.id] = entry; await this.persist(this.journal)
      await this.report(job.id, entry); entry.reported = true; await this.persist(this.journal)
    }
  }
  async execute(job) {
    if (!this.journalTrusted || this.journalCorrupt) throw new Error('Trusted journal continuity is required')
    if (this.journal[job.id]) { await this.recover(); return }
    let args, before
    try {
      validateJob(job)
      const owned = await this.containers()
      const target = owned.find(row => row.Service === job.service)
      if (!target) throw new Error('Target rejected')
      before = await this.containerState(target)
      if (job.action === 'start' ? !['exited', 'stopped', 'created'].includes(before.state) : before.state !== 'running') throw new Error('Target state changed')
      args = commandArgs(this.config, job, target)
    } catch {
      await this.api(`jobs/${job.id}/result/`, { status: 'FAILED', result_code: 'target_rejected' }); return
    }
    const entry = { stage: 'intent', service: job.service, action: job.action, before, reported: false }
    this.journal[job.id] = entry
    await this.persist(this.journal) // Fail closed if the intent cannot be persisted.
    try {
      await this.docker(args)
      const rows = await this.containers(), state = rows.find(row => row.Service === job.service)?.State
      const confirmed = job.action === 'stop' ? ['exited', 'stopped'].includes(state) : state === 'running'
      entry.status = confirmed ? 'SUCCEEDED' : 'UNKNOWN'; entry.result_code = confirmed ? 'confirmed' : 'outcome_unknown'
    } catch {
      // The CLI may have sent the operation before losing its connection.
      entry.status = 'UNKNOWN'; entry.result_code = 'outcome_unknown'
    }
    entry.stage = 'finished'; await this.persist(this.journal)
    await this.report(job.id, entry); entry.reported = true; await this.persist(this.journal)
  }
  async tick() {
    if (this.busy) return
    this.busy = true
    try {
      await this.heartbeat()
      if (this.execution) return
      if (!this.journalTrusted || this.journalCorrupt) {
        const { unresolved = [] } = await this.api('claim/', { claim_new: false })
        if (unresolved.length || this.journalCorrupt) { await this.recoverClaims(unresolved); return }
        // First boot is safe only when no prior execution remains unresolved.
        // Persist that baseline before enabling any subsequent claim/effect.
        this.journalTrusted = true
        try { await this.persist(this.journal) } catch (failure) { this.journalTrusted = false; throw failure }
        return
      }
      await this.recover()
      const { job, unresolved } = await this.api('claim/', {})
      await this.recoverClaims(unresolved)
      if (job) this.execution = this.execute(job).catch(() => {}).finally(() => { this.execution = null })
    } finally { this.busy = false }
  }
}

async function acquireLock(filename) {
  await mkdir(dirname(filename), { recursive: true })
  try {
    const handle = await open(filename, 'wx', 0o600)
    await handle.writeFile(String(process.pid)); await handle.close()
    return
  } catch (failure) {
    if (failure.code !== 'EEXIST') throw failure
  }
  const pid = Number(await readFile(filename, 'utf8'))
  if (!Number.isInteger(pid) || pid <= 0) throw new Error('Invalid host agent lock')
  try { process.kill(pid, 0); throw new Error('Another host agent is running') } catch (failure) {
    if (failure.code !== 'ESRCH') throw failure
  }
  await unlink(filename)
  return acquireLock(filename)
}

async function main() {
  const filename = resolve(process.argv[2] || 'development/host-agent.local.json')
  const config = validateConfig(JSON.parse(await readFile(filename, 'utf8')))
  await access(resolve(config.projectRoot, 'compose.yaml'))
  const lock = config.journalPath + '.lock'
  await acquireLock(lock)
  let state
  try { state = await loadJournal(config.journalPath) }
  catch { state = { entries: {}, trusted: false, corrupt: true } }
  const agent = new HostAgent(config, { journal: state.entries, journalTrusted: state.trusted, journalCorrupt: !!state.corrupt })
  let stopped = false
  process.on('SIGINT', () => { stopped = true }); process.on('SIGTERM', () => { stopped = true })
  try {
    while (!stopped) {
      const started = Date.now()
      try { await agent.tick() } catch { process.stderr.write('Host monitoring connection unavailable; pending actions were not replayed.\n') }
      await new Promise(resolve => setTimeout(resolve, Math.max(0, config.intervalMs - (Date.now() - started))))
    }
    await agent.execution
  } finally {
    await unlink(lock)
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => { process.stderr.write('Host agent could not start. Check its private configuration and journal.\n'); process.exitCode = 1 })
