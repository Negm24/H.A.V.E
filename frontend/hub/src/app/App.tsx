import { RouterProvider } from 'react-router-dom'
import { SessionProvider } from './providers'
import { router } from './routes'
import { HubCatalogueProvider } from '../features/catalogue/hooks/use-catalogue'
import { CollectionSummaryProvider } from '../features/orders/hooks/use-collection-summary'
import './hub.css'

export default function App() {
  return <SessionProvider><CollectionSummaryProvider><HubCatalogueProvider><RouterProvider router={router} /></HubCatalogueProvider></CollectionSummaryProvider></SessionProvider>
}
