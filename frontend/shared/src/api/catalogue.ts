import { request } from './http'
import type { components } from './generated'

export type CatalogueCategory = components['schemas']['CategoryOutput']
export type CatalogueProduct = components['schemas']['ProductOutput']
export interface NetworkCatalogue<T> { items: T[]; availability_scope: 'TERMINAL'; observed_at: string }
export interface NetworkProductDetail { product: CatalogueProduct; availability_scope: 'TERMINAL'; observed_at: string }
const base = '/api/v1/hub/catalogue/'
const scope = (path: string, serial?: string) => path + (serial ? `?terminal_serial=${encodeURIComponent(serial)}` : '')
export const hubCatalogueApi = {
  categories: (token: string, signal?: AbortSignal, serial?: string) => request<NetworkCatalogue<CatalogueCategory>>(scope(base + 'categories/', serial), { bearerToken: token, signal }),
  products: (token: string, signal?: AbortSignal, serial?: string) => request<NetworkCatalogue<CatalogueProduct>>(scope(base + 'products/', serial), { bearerToken: token, signal }),
  product: (token: string, id: number, signal?: AbortSignal, serial?: string) => request<NetworkProductDetail>(scope(base + `products/${id}/`, serial), { bearerToken: token, signal }),
}
