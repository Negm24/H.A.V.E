import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, getHealth, request } from './http'

afterEach(() => vi.unstubAllGlobals())

describe('HTTP transport', () => {
  it('uses same-origin credentials, no caching, and returns health', async () => {
    const mock = vi.fn().mockResolvedValue(new Response('{"status":"ok"}'))
    vi.stubGlobal('fetch', mock)
    expect(await getHealth()).toEqual({ status: 'ok' })
    expect(mock).toHaveBeenCalledWith('/api/v1/health/', expect.objectContaining({
      method: 'GET', credentials: 'same-origin', cache: 'no-store',
    }))
  })
  it('fetches fresh CSRF before an explicit cookie-authenticated mutation', async () => {
    const mock = vi.fn()
      .mockResolvedValueOnce(new Response('{"csrf_token":"test-csrf"}'))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', mock)
    expect(await request('/api/v1/auth/owners/logout/', { method: 'POST', csrf: true })).toBeUndefined()
    expect(mock.mock.calls[1][1].headers.get('X-CSRFToken')).toBe('test-csrf')
  })
  it('attaches only the supplied bearer, never device credentials', async () => {
    const mock = vi.fn().mockResolvedValue(new Response('{}'))
    vi.stubGlobal('fetch', mock)
    await request('/api/example/', { bearerToken: 'test-token' })
    const headers = mock.mock.calls[0][1].headers as Headers
    expect(headers.get('Authorization')).toBe('Bearer test-token')
    expect(headers.has('X-Terminal-Key')).toBe(false)
  })
  it('preserves a 429 delay and does not retry a mutation', async () => {
    const mock = vi.fn().mockResolvedValue(new Response('{"detail":"Wait before trying again."}',
      { status: 429, headers: { 'Retry-After': '60' } }))
    vi.stubGlobal('fetch', mock)
    await expect(request('/api/example/', { method: 'POST', body: { code: '123456' } }))
      .rejects.toMatchObject({ status: 429, retryAfter: 60 })
    expect(mock).toHaveBeenCalledTimes(1)
  })
  it('does not display a proxy HTML error page as an error message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>internal proxy error</html>', { status: 502 })))
    await expect(getHealth()).rejects.toMatchObject({ message: 'The request could not be completed.', status: 502 })
  })
  it('rejects a successful non-JSON response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>not the API</html>')))
    await expect(getHealth()).rejects.toBeInstanceOf(ApiError)
  })
  it('normalizes network failure without logging request data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('failed')))
    await expect(getHealth()).rejects.toMatchObject({ status: 0, message: 'Unable to reach the server. Check your connection.' })
  })
  it('honors caller cancellation', async () => {
    const controller = new AbortController()
    controller.abort()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError')))
    await expect(getHealth(controller.signal)).rejects.toMatchObject({ status: 0, message: 'Request cancelled.' })
  })
  it('rejects external paths before sending credentials', async () => {
    const mock = vi.fn()
    vi.stubGlobal('fetch', mock)
    await expect(request('https://example.test/api/')).rejects.toThrow('absolute /api/')
    expect(mock).not.toHaveBeenCalled()
  })
})
