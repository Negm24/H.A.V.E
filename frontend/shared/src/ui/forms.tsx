import { useId, type ComponentProps, type ReactNode } from 'react'

export function Field({ label, error, ...props }: ComponentProps<'input'> & { label: string; error?: string }) {
  const generated = useId(), id = props.id ?? generated
  return <div className="have-field"><label htmlFor={id}>{label}</label><input {...props} id={id} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} />{error && <small id={`${id}-error`} role="alert">{error}</small>}</div>
}

export function FormSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <section className="have-form-section"><h1>{title}</h1>{description && <p className="have-form-description">{description}</p>}{children}</section>
}
