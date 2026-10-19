import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CartButton } from './cart-button'

vi.mock('../i18n', () => ({ useTranslation: () => ({ t: (_key: string, values: { count: number }) => `Cart · ${values.count}` }) }))

let host: HTMLDivElement, root: Root
const animate = vi.fn((_frames: Keyframe[], _options: KeyframeAnimationOptions) => ({ cancel: vi.fn() }))
const reducedMotion = vi.fn(() => ({ matches: false }))
const click = vi.fn()
function render(count: number, revision?: string, disabled = false) {
  act(() => root.render(createElement(CartButton, { count, revision, disabled, onClick: click })))
  return host.querySelector('button')!
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  vi.clearAllMocks()
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate })
  vi.stubGlobal('matchMedia', reducedMotion)
})
afterEach(() => { act(() => root.unmount()); host.remove(); Reflect.deleteProperty(HTMLElement.prototype, 'animate'); vi.unstubAllGlobals() })

it('shows an icon without visible cart text and keeps the accessible label and click action', () => {
  const button = render(0, 'v1')
  expect(button.id).toBe('cart-button')
  expect(button.textContent).toBe('')
  expect(button.getAttribute('aria-label')).toBe('Cart · 0')
  expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  expect(button.querySelector('.have-cart-badge')).toBeNull()
  button.click(); expect(click).toHaveBeenCalledOnce()
})

it('shows the full quantity in a badge only when nonempty, without flashing on initial load', () => {
  render(124, 'v1')
  expect(host.querySelector('.have-cart-badge')?.textContent).toBe('124')
  expect(animate).not.toHaveBeenCalled()
  render(124, 'v1')
  expect(animate).not.toHaveBeenCalled()
})

it('glows for exactly 300ms on each changed revision including equal-total changes', () => {
  render(0, 'v1'); render(1, 'v2'); render(2, 'v3'); render(2, 'v4')
  expect(animate).toHaveBeenCalledTimes(3)
  expect(animate.mock.calls[0]?.[1]).toEqual({ duration: 300, easing: 'ease-out' })
  render(2, 'v4'); expect(animate).toHaveBeenCalledTimes(3)
})

it('does not flash on initial hydration, unavailable carts, or an empty cart', () => {
  render(0); render(2, 'v1'); expect(animate).not.toHaveBeenCalled()
  render(0); render(2, 'v2'); expect(animate).not.toHaveBeenCalled()
  render(0, 'v3'); expect(animate).not.toHaveBeenCalled()
})

it('respects reduced motion and preserves disabled behavior', () => {
  reducedMotion.mockReturnValueOnce({ matches: true })
  render(0, 'v1'); const button = render(1, 'v2', true)
  expect(animate).not.toHaveBeenCalled()
  button.click(); expect(click).not.toHaveBeenCalled()
  expect(button.disabled).toBe(true)
})
