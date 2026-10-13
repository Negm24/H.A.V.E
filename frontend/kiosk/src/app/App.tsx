import { BrowserRouter } from 'react-router-dom'
import { SessionProvider } from '../features/session/hooks/use-session'
import { AppRoutes } from './routes'
import './kiosk.css'

export default function App() {
  return <SessionProvider><BrowserRouter><AppRoutes /></BrowserRouter></SessionProvider>
}
