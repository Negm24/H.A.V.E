import type { ComponentProps } from 'react'

export function Button({ variant = 'secondary', className = '', ...props }: ComponentProps<'button'> & { variant?: 'primary' | 'secondary' | 'danger' }) {
  return <button {...props} className={`have-button have-button--${variant} ${className}`} />
}
