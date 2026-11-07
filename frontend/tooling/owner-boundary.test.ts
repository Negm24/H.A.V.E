// @vitest-environment node
import { expect, it } from 'vitest'
import { customerCookies, privateApiPath } from './owner-boundary'

it('blocks all Owner and internal paths including encoded route names', () => {
  for (const path of ['/api/v1/owner/', '/api/v1/owner/products/', '/api/v1/auth/owners/login/', '/internal/host-agent/claim/', '/api/v1/%6fwner/session/', '/api/v1/auth/%6fwners/me/']) expect(privateApiPath(path)).toBe(true)
  for (const path of ['/api/v1/hub/orders/', '/api/v1/auth/customers/hub/login/', '/api/v1/terminals/sessions/']) expect(privateApiPath(path)).toBe(false)
})
it('strips Owner cookies without breaking customer refresh and CSRF cookies', () => {
  expect(customerCookies('sessionid=private; have_hub_refresh=customer; csrftoken=csrf; have_owner_session=other')).toBe('have_hub_refresh=customer; csrftoken=csrf')
  expect(customerCookies('sessionid=private')).toBeUndefined()
})
