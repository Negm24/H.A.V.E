import { afterEach, expect, it, vi } from 'vitest'
import { configureTerminalSimulator, terminalApi } from './terminal'
import { getHealth, request } from './http'

afterEach(() => { configureTerminalSimulator(undefined); vi.unstubAllGlobals() })

it('adds the page simulator selector to Terminal calls only, never device secrets or Hub calls', async () => {
  const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response('{}')))
  vi.stubGlobal('fetch', fetch)
  configureTerminalSimulator('a'.repeat(32))
  await terminalApi.start()
  await terminalApi.cart('guest-token')
  await getHealth()
  expect(fetch.mock.calls[0][1].headers.get('X-Terminal-Simulator')).toBe('a'.repeat(32))
  expect(fetch.mock.calls[1][1].headers.get('X-Terminal-Simulator')).toBe('a'.repeat(32))
  expect(fetch.mock.calls[2][1].headers.has('X-Terminal-Simulator')).toBe(false)
  expect(fetch.mock.calls[1][1].headers.get('Authorization')).toBe('Bearer guest-token')
  for (const [, options] of fetch.mock.calls) {
    expect(options.headers.has('X-Terminal-Key')).toBe(false)
    expect(options.headers.has('X-Terminal-Serial')).toBe(false)
  }
  await expect(request('/api/v1/hub/cart/', { terminalSimulatorId: 'a'.repeat(32) })).rejects.toThrow('only allowed on Terminal routes')
})
