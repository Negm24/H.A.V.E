import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/http'
import { createCookieSession } from './cookie-session'

function setup() {
  let now = 1000
  const result = { access_token: 'access-1', expires_in: 900, customer: { id: 'customer' } }
  const api = { login: vi.fn(async () => result), refresh: vi.fn(async () => result), logout: vi.fn(async () => {}) }
  const notify = vi.fn(), exclusive = <T>(work: () => Promise<T>) => work()
  const session = createCookieSession(api, exclusive, notify, () => now)
  return { session, api, result, notify, advance: (seconds: number) => { now += seconds * 1000 } }
}
describe('cookie-session lifecycle', () => {
  it('restores once, keeps tokens private and reuses unexpired access', async () => {
    const { session, api } = setup()
    await Promise.all([session.restore(), session.restore()])
    expect(api.refresh).toHaveBeenCalledTimes(1)
    expect(session.getSnapshot()).toEqual({ status: 'authenticated', customer: { id: 'customer' } })
    await session.authorized(async access => { expect(access).toBe('access-1') })
    expect(api.refresh).toHaveBeenCalledTimes(1)
  })
  it('refreshes before an operation when access is about to expire', async () => {
    const { session, api, advance } = setup(); await session.restore(); advance(890)
    await session.authorized(async () => 'ok')
    expect(api.refresh).toHaveBeenCalledTimes(2)
  })
  it('retries only safe reads once after a 401', async () => {
    const { session, api } = setup(); await session.restore()
    const read = vi.fn().mockRejectedValueOnce(new ApiError('Expired', 401)).mockResolvedValue('ok')
    expect(await session.authorized(read, true)).toBe('ok'); expect(read).toHaveBeenCalledTimes(2)
    const mutation = vi.fn().mockRejectedValue(new ApiError('Denied', 401))
    await expect(session.authorized(mutation)).rejects.toMatchObject({ status: 401 })
    expect(mutation).toHaveBeenCalledTimes(1); expect(api.refresh).toHaveBeenCalledTimes(2)
  })
  it('clears locally immediately even if logout fails offline, and does not restore', async () => {
    const { session, api, notify } = setup(); await session.restore(); api.logout.mockRejectedValueOnce(new ApiError('Offline', 0))
    const logout = session.logout(); expect(session.getSnapshot().customer).toBeNull()
    await expect(logout).rejects.toMatchObject({ status: 0 })
    await session.restore(); expect(api.refresh).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith('signed-out')
  })
  it('does not adopt a late refresh after logout', async () => {
    const { session, api, result } = setup(); let complete!: (value: typeof result) => void
    api.refresh.mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
    const restore = session.restore(); await session.logout(); complete(result)
    await expect(restore).rejects.toMatchObject({ name: 'AbortError' })
    expect(session.getSnapshot().customer).toBeNull()
  })
  it('a remote logout invalidates an in-flight protected response', async () => {
    const { session } = setup(); await session.restore(); let complete!: (value: string) => void
    const operation = session.authorized(() => new Promise<string>(resolve => { complete = resolve }))
    await Promise.resolve(); session.remote('signed-out'); complete('personal data')
    await expect(operation).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('a rejected refresh removes authentication without retry loops', async () => {
    const { session, api } = setup(); api.refresh.mockRejectedValueOnce(new ApiError('Ended', 401))
    await session.restore(); await session.restore()
    expect(session.getSnapshot().status).toBe('anonymous'); expect(api.refresh).toHaveBeenCalledTimes(1)
  })
})
