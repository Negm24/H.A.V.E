import { RouterProvider } from 'react-router-dom'
import { SessionProvider } from './providers'
import { router } from './routes'
import './hub.css'

export default function App() {
  return <SessionProvider><RouterProvider router={router} /></SessionProvider>
}
