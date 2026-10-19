// @vitest-environment node
import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readDevelopmentAccess } from './development-access'

const folders: string[] = []
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }) })
const valid = { hubPublicOrigin: 'https://laptop.example.ts.net', kioskPublicOrigin: 'https://laptop.example.ts.net:8443', kioskAccessPassword: 'private-test-password' }
function file(text: string) {
  const folder = mkdtempSync(join(tmpdir(), 'have-access-')); folders.push(folder)
  const path = join(folder, 'access.local.json'); writeFileSync(path, text); return path
}
it('accepts exact separate HTTPS origins including the Kiosk port and optional BOM', () => {
  expect(readDevelopmentAccess(file(JSON.stringify(valid)))).toEqual(valid)
  expect(readDevelopmentAccess(file('\uFEFF' + JSON.stringify(valid)))).toEqual(valid)
})
it('missing configuration supports localhost; malformed configuration fails without leaking secrets', () => {
  expect(readDevelopmentAccess(file('{}') + '.missing')).toBeUndefined()
  expect(() => readDevelopmentAccess(file('not-json'))).toThrow('JSON syntax')
  for (const changes of [{ extra: 'field' }, { kioskAccessPassword: '' }, { kioskAccessPassword: 'x'.repeat(257) }, { hubPublicOrigin: null }]) {
    expect(() => readDevelopmentAccess(file(JSON.stringify({ ...valid, ...changes })))).toThrow()
  }
})
it('rejects wildcard, HTTP, paths, credentials, IPs, arbitrary ports and identical origins', () => {
  for (const origin of ['http://laptop.example.ts.net', 'https://*.ts.net', 'https://laptop.example.ts.net/', 'https://laptop.example.ts.net/path', 'https://laptop.example.ts.net?x=1', 'https://laptop.example.ts.net#fragment', 'https://user:secret@laptop.example.ts.net', 'https://localhost', 'https://127.0.0.1', 'https://laptop.example.ts.net:443', 'https://laptop.example.ts.net:8443', 'https://laptop.example.ts.net:10000']) {
    expect(() => readDevelopmentAccess(file(JSON.stringify({ ...valid, hubPublicOrigin: origin })))).toThrow()
  }
  expect(() => readDevelopmentAccess(file(JSON.stringify({ ...valid, kioskPublicOrigin: valid.hubPublicOrigin })))).toThrow()
})
