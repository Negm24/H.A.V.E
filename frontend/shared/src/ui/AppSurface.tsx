import type { ReactNode } from 'react'

export function AppSurface({ children, kiosk = false }: { children: ReactNode; kiosk?: boolean }) {
  return <main className={kiosk ? 'app-surface kiosk-surface' : 'app-surface'}>{children}</main>
}
