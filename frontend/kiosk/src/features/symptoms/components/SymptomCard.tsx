export function SymptomCard({ label, icon, selected, onSelect }: { label: string; icon?: string; selected: boolean; onSelect: () => void }) {
  return <button type="button" aria-pressed={selected} onClick={onSelect} className={`symptom-card${selected ? ' selected' : ''}`}>
    {selected && <span className="symptom-check" aria-hidden="true">✓</span>}
    {icon && <span className="symptom-icon" aria-hidden="true">{icon}</span>}
    <span>{label}</span>
  </button>
}
