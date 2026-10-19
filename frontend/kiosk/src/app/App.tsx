import { BrowserRouter, useLocation, useNavigate } from 'react-router-dom'
import { useLayoutEffect } from 'react'
import { SessionProvider } from '../features/session/hooks/use-session'
import { AppRoutes } from './routes'
import './kiosk.css'
import { CatalogueProvider } from '../features/catalogue/hooks/use-catalogue'
import { CollectionSummaryProvider } from '../features/orders/hooks/use-collection-summary'
import { CheckoutAttemptProvider } from '../features/orders/hooks/use-checkout-attempt'

function SimulatorLocation({ id }: { id?: string }) {
  const location = useLocation()
  const navigate = useNavigate()
  useLayoutEffect(() => {
    if (!id) return
    const search = new URLSearchParams(location.search)
    if (search.getAll('terminal').length === 1 && search.get('terminal') === id) return
    search.set('terminal', id)
    navigate({ pathname: location.pathname, search: search.toString(), hash: location.hash }, { replace: true, state: location.state })
  }, [id, location, navigate])
  return null
}

export default function App({ simulatorId }: { simulatorId?: string }) {
  return <SessionProvider><CatalogueProvider><CollectionSummaryProvider><CheckoutAttemptProvider><BrowserRouter><SimulatorLocation id={simulatorId} /><AppRoutes /></BrowserRouter></CheckoutAttemptProvider></CollectionSummaryProvider></CatalogueProvider></SessionProvider>
}
