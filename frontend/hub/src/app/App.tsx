import { RouterProvider } from 'react-router-dom'
import { SessionProvider } from './providers'
import { router } from './routes'
import { HubCatalogueProvider } from '../features/catalogue/hooks/use-catalogue'
import './hub.css'

export default function App() {
  return <SessionProvider><HubCatalogueProvider><RouterProvider router={router} /></HubCatalogueProvider></SessionProvider>
}
