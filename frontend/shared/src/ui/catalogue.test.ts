import { createElement, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createAppI18n } from '../i18n'
import en from '../i18n/catalogue/en.json'
import ar from '../i18n/catalogue/ar.json'
import { QuantityControl, ProductCard, CartContents } from './catalogue'
import type { CatalogueProduct } from '../api/catalogue'
import type { CustomerCart } from '../api/cart'

let root: Root, container: HTMLDivElement
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const i18n = await createAppI18n('kiosk')
  i18n.addResourceBundle('en', 'catalogue', en); i18n.addResourceBundle('ar', 'catalogue', ar)
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove() })

it('quantity controls permit reducing an unavailable saved line but block increases', async () => {
  const onChange = vi.fn()
  await act(async () => root.render(createElement(QuantityControl, { quantity: 2, limit: 0, onChange })))
  const buttons = container.querySelectorAll('button')
  expect(buttons[0]!.disabled).toBe(false); expect(buttons[1]!.disabled).toBe(true)
  await act(async () => buttons[0]!.click()); expect(onChange).toHaveBeenCalledExactlyOnceWith(1)
  await act(async () => root.render(createElement(QuantityControl, { quantity: 0, limit: 0, onChange })))
  expect(container.querySelector('button')!.disabled).toBe(true)
})

it('a shared product card receives actions instead of importing an app session', async () => {
  const onOpen = vi.fn(), onQuantity = vi.fn()
  const product = { id: 1, name_en: 'Sample item', name_ar: 'منتج', strength: '5 mg', price: '10.00', pack_description: '12 tablets', stock_quantity: 8, quantity_limit: 3, image_url: null, requires_prescription: false } as CatalogueProduct
  await act(async () => root.render(createElement(ProductCard, { product, quantity: 0, onOpen, onQuantity })))
  await act(async () => container.querySelector<HTMLButtonElement>('.quantity-control button')!.click())
  expect(onQuantity).toHaveBeenCalledExactlyOnceWith(1); expect(onOpen).not.toHaveBeenCalled()
  await act(async () => container.querySelector<HTMLButtonElement>('.product-open')!.click())
  expect(onOpen).toHaveBeenCalledOnce()
})

it('checkout is explicit and disabled for empty or invalid carts', async () => {
  const onContinue = vi.fn(), onQuantity = vi.fn(), onRemove = vi.fn()
  const cart = { items: [], total_quantity: 0, subtotal: '0.00', total: '0.00', has_issues: false } as unknown as CustomerCart
  const render = async () => act(async () => root.render(createElement(CartContents, { cart, onContinue, onQuantity, onRemove, continueLabel: 'Checkout' })))
  await render()
  expect([...container.querySelectorAll('button')].find(button => button.textContent === 'Checkout')!.disabled).toBe(true)
  cart.items = [{ product_id: 1, product: null, quantity: 1, unit_price: '1.00', line_total: '1.00', issues: [] }]
  cart.total_quantity = 1; await render()
  const button = [...container.querySelectorAll('button')].find(button => button.textContent === 'Checkout')!
  expect(button.disabled).toBe(false); await act(async () => button.click()); expect(onContinue).toHaveBeenCalledOnce()
  cart.has_issues = true; await render()
  expect([...container.querySelectorAll('button')].find(button => button.textContent === 'Checkout')!.disabled).toBe(true)
})
