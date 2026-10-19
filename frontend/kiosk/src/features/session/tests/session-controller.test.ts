import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@have/shared/api'
import { terminalApi, type CustomerIdentity, type TerminalSession } from '@have/shared/api/terminal'
import type { PaymentContinuedSession } from '@have/shared/api/purchase'
import { createSessionController } from '../services/session-controller'

const customer: CustomerIdentity = { id: 'HAV-C678-000000000001', account_type: 'CUSTOMER', first_name: 'Ahmed', last_name: 'Sherif', phone_number: '+201012345678', email: 'test@example.test', date_of_birth: '24-01-2005', phone_verified_at: '2026-10-10T00:00:00Z' }
const guest: TerminalSession = { session_id: 'test', session_token: 'guest-secret', token_type: 'Bearer', idle_expires_in: 240 }
const loggedIn: TerminalSession = { ...guest, session_token: 'customer-secret', customer }

function fixtures() {
  const api = {
    start: vi.fn().mockResolvedValue(guest), activity: vi.fn().mockResolvedValue({ ...guest, session_token: undefined }),
    end: vi.fn().mockResolvedValue(undefined), login: vi.fn().mockResolvedValue(loggedIn), me: vi.fn().mockResolvedValue(customer),
    createQr: vi.fn(), qrStatus: vi.fn(), completeQr: vi.fn().mockResolvedValue(loggedIn),
  } satisfies NonNullable<Parameters<typeof createSessionController>[0]>
  const controller = createSessionController(api)
  controller.connect()
  const start = async () => { controller.chooseLanguage(); await controller.start('en') }
  return { api, controller, start }
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-10T00:00:00Z')) })
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

describe('Terminal session lifecycle', () => {
  it('explicit payment continuation adopts only the server remaining lifetime and keeps the token in memory', async () => {
    const { controller, api } = fixtures()
    const reconnect = vi.fn().mockResolvedValue({ ...loggedIn, session_token: 'returned-token', language: 'en', session_expires_in: 90 })
    expect(await controller.reconnectPayment(reconnect)).toBe(true)
    expect(controller.getSnapshot()).toMatchObject({ phase: 'customer', customer, remaining: 90 })
    const work = vi.fn(async () => 'ok'); await controller.request(work)
    expect(work).toHaveBeenCalledWith('returned-token', expect.any(AbortSignal))
    expect(api.login).not.toHaveBeenCalled(); expect(api.start).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(90_000)
    expect(controller.getSnapshot().phase).toBe('attract')
  })
  it('ignores a late payment continuation after Start over', async () => {
    const { controller } = fixtures()
    let finish!: (value: PaymentContinuedSession) => void
    const restoring = controller.reconnectPayment(() => new Promise(resolve => { finish = resolve }))
    await vi.advanceTimersByTimeAsync(0); controller.reset(false)
    finish({ ...loggedIn, language: 'en', session_expires_in: 90 })
    expect(await restoring).toBe(false)
    expect(controller.getSnapshot().phase).toBe('attract')
  })
  it('starts anonymous and uses rotated token for me and sign-out', async () => {
    const { api, controller, start } = fixtures()
    await start()
    expect(controller.getSnapshot().phase).toBe('guest')
    expect(controller.getSnapshot().customer).toBeNull()
    await controller.login('01012345678', '4826')
    expect(api.login).toHaveBeenCalledWith('guest-secret', '01012345678', '4826', expect.any(AbortSignal))
    expect(api.me).toHaveBeenCalledWith('customer-secret', expect.any(AbortSignal))
    controller.reset()
    await vi.advanceTimersByTimeAsync(0)
    expect(api.end).toHaveBeenCalledWith('customer-secret')
    expect(controller.getSnapshot()).toMatchObject({ phase: 'attract', language: null, customer: null })
  })
  it('identity requests do not extend inactivity; expiry clears identity', async () => {
    const { controller, start } = fixtures()
    await start(); await controller.login('01012345678', '4826')
    await vi.advanceTimersByTimeAsync(200_000)
    await controller.refreshIdentity()
    expect(controller.getSnapshot().remaining).toBe(40)
    await vi.advanceTimersByTimeAsync(40_000)
    expect(controller.getSnapshot().phase).toBe('attract')
    expect(controller.getSnapshot().customer).toBeNull()
  })
  it('throttles interaction and sends its trailing update', async () => {
    const { api, controller, start } = fixtures()
    await start(); controller.interact()
    await vi.advanceTimersByTimeAsync(100)
    controller.interact(); controller.interact()
    await vi.advanceTimersByTimeAsync(4800)
    expect(api.activity).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(100)
    expect(api.activity).toHaveBeenCalledTimes(2)
  })
  it('login and activity cannot restart the absolute clock', async () => {
    const { controller, start } = fixtures()
    await start()
    for (let index = 0; index < 8; index++) {
      await vi.advanceTimersByTimeAsync(100_000)
      controller.interact(); await vi.advanceTimersByTimeAsync(0)
    }
    await controller.login('01012345678', '4826')
    expect(controller.getSnapshot().remaining).toBe(100)
    await controller.continueSession()
    await vi.advanceTimersByTimeAsync(100_000)
    expect(controller.getSnapshot().phase).toBe('attract')
  })
  it('wrong PIN retains guest; invalid session clears it', async () => {
    const { api, controller, start } = fixtures()
    await start(); api.login.mockRejectedValue(new ApiError('Bad credentials', 401))
    await controller.login('01012345678', '9999')
    expect(controller.getSnapshot()).toMatchObject({ phase: 'guest', error: 'credentials' })
    api.activity.mockRejectedValue(new ApiError('Expired', 401))
    await controller.login('01012345678', '9999')
    expect(controller.getSnapshot().phase).toBe('attract')
  })
  it('rate limiting blocks repeated actions until Retry-After', async () => {
    const { api, controller, start } = fixtures()
    await start(); api.login.mockRejectedValue(new ApiError('Wait', 429, 30))
    await controller.login('01012345678', '4826')
    await controller.login('01012345678', '4826')
    expect(api.login).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(30_000)
    await controller.login('01012345678', '4826')
    expect(api.login).toHaveBeenCalledTimes(2)
  })
  it('an aborted late login cannot restore personal state after reset', async () => {
    const { api, controller, start } = fixtures()
    await start()
    let resolve!: (value: TerminalSession) => void
    api.login.mockImplementation(() => new Promise(done => { resolve = done }))
    const login = controller.login('01012345678', '4826')
    await vi.advanceTimersByTimeAsync(0)
    controller.reset()
    resolve(loggedIn); await login
    expect(controller.getSnapshot()).toMatchObject({ phase: 'attract', customer: null })
    expect(api.me).not.toHaveBeenCalled()
  })
  it('late guest creation cannot restore a cancelled session', async () => {
    const { api, controller } = fixtures()
    let resolve!: (value: TerminalSession) => void
    api.start.mockImplementation(() => new Promise(done => { resolve = done }))
    controller.chooseLanguage()
    const start = controller.start('ar')
    await vi.advanceTimersByTimeAsync(0)
    controller.reset(); resolve(guest); await start
    expect(controller.getSnapshot()).toMatchObject({ phase: 'attract', language: null })
  })
  it('a late identity rejection cannot clear a newer guest session', async () => {
    const { api, controller, start } = fixtures()
    await start()
    let reject!: (error: Error) => void
    api.me.mockImplementation(() => new Promise((_, fail) => { reject = fail }))
    const login = controller.login('01012345678', '4826')
    await vi.advanceTimersByTimeAsync(0)
    controller.reset()
    await start()
    reject(new ApiError('Old session rejected', 401)); await login
    expect(controller.getSnapshot()).toMatchObject({ phase: 'guest', customer: null })
  })
  it('serializes activity before token rotation and does not reuse the old token', async () => {
    const { api, controller, start } = fixtures()
    await start(); controller.interact()
    await controller.login('01012345678', '4826')
    await controller.continueSession()
    expect(api.activity.mock.calls[0]?.[0]).toBe('guest-secret')
    expect(api.activity.mock.calls.at(-1)?.[0]).toBe('customer-secret')
  })
  it('QR reads do not renew inactivity, completion rotates tokens', async () => {
    const { api, controller, start } = fixtures()
    await start(); api.qrStatus.mockResolvedValue({ challenge_id: 'challenge', status: 'approved', expires_in: 90 })
    await vi.advanceTimersByTimeAsync(60_000)
    await controller.qrStatus('challenge')
    expect(controller.getSnapshot().remaining).toBe(180)
    expect(api.activity).not.toHaveBeenCalled()
    await controller.completeQr('challenge')
    expect(api.me).toHaveBeenCalledWith('customer-secret', expect.any(AbortSignal))
  })
  it('network failure at sign-out still destroys local account state', async () => {
    const { api, controller, start } = fixtures()
    await start(); await controller.login('01012345678', '4826')
    api.end.mockRejectedValue(new ApiError('Offline', 0))
    controller.reset(); await vi.advanceTimersByTimeAsync(0)
    expect(controller.getSnapshot().customer).toBeNull()
  })
})
