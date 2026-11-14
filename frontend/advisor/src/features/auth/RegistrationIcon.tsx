export function RegistrationIcon({ name }: { name: 'doctor' | 'account' | 'documents' | 'review' | 'camera' | 'upload' | 'shield' | 'check' }) {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === 'doctor' && <><circle cx="10" cy="6" r="3" /><path d="M3 20v-3a7 7 0 0 1 11-5M15 10v4a3 3 0 0 0 6 0v-4M15 10h1m4 0h1M18 17v2a2 2 0 0 1-4 0v-1" /></>}
    {name === 'account' && <><rect x="5" y="10" width="14" height="11" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2" /></>}
    {name === 'documents' && <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5" /></>}
    {(name === 'review' || name === 'check') && <><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></>}
    {name === 'camera' && <><path d="m8 5 1-2h6l1 2h4a1 1 0 0 1 1 1v13H3V6a1 1 0 0 1 1-1z" /><circle cx="12" cy="12" r="4" /></>}
    {name === 'upload' && <><path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6" /></>}
    {name === 'shield' && <><path d="m12 2 8 3v6c0 5-3 8-8 11-5-3-8-6-8-11V5zM8 12l3 3 5-6" /></>}
  </svg>;
}
