import { useEffect, useRef, type ComponentProps, type ReactNode } from 'react'

export function Button({ variant = 'secondary', className = '', ...props }: ComponentProps<'button'> & { variant?: 'primary' | 'secondary' | 'danger' }) {
  return <button {...props} className={`have-button have-button--${variant} ${className}`} />
}

export function Alert({ children }: { children: ReactNode }) {
  return <div className="have-alert" role="alert">{children}</div>
}

export function Dialog({ title, children }: { title: string; children: ReactNode }) {
  const section = useRef<HTMLElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    section.current?.querySelector<HTMLButtonElement>('button')?.focus()
    return () => previous?.focus()
  }, [])
  return <div className="have-dialog-backdrop"><section ref={section} className="have-dialog" role="alertdialog" aria-modal="true" aria-label={title} onKeyDown={event => {
    if (event.key !== 'Tab') return
    const buttons = section.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
    if (!buttons?.length) return
    const first = buttons[0]!, last = buttons[buttons.length - 1]!
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }}>
    <h2>{title}</h2>{children}
  </section></div>
}
