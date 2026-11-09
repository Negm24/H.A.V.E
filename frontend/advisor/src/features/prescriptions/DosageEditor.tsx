import { useTranslation } from '@have/shared/i18n';
export type Dosage = { mode: string; [key: string]: string | string[] };
export function editDosage(value: unknown): Dosage | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const d = { ...(value as Dosage) };
  if (d.once_at) {
    const date = new Date(d.once_at as string);
    if (!Number.isNaN(date.getTime())) d.once_at = new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);
  }
  return d;
}
const scheduleKeys: Record<string, string[]> = { times:['times'], interval:['hours','first_time'], daily:['daily_count'], meals:['meals'], once:['once_at'], prn:['hours','reason','max_doses'] };
export function dosagePayload(d: Dosage) {
  if (d.mode !== 'structured') return { mode: d.mode };
  const keys = ['mode','amount','schedule','food','notes', ...(scheduleKeys[d.schedule as string] ?? [])];
  if (d.schedule !== 'once') keys.push('duration', ...(d.duration === 'until' ? ['until'] : ['days','weeks'].includes(d.duration as string) ? ['duration_count'] : []));
  const result: Record<string, unknown> = {};
  for (const key of keys) if (d[key] !== undefined && d[key] !== '') result[key] = ['hours','daily_count','max_doses','duration_count'].includes(key) ? Number(d[key]) : d[key];
  if (result.once_at) result.once_at = new Date(result.once_at as string).toISOString();
  return result;
}
export function instructionPreview(d: Dosage | undefined, custom: string, unit: string | null | undefined, t: (key: string) => string) {
  if (!d || d.mode === 'custom') return custom;
  if (d.mode === 'none') return t('dose.none');
  if (!d.schedule || !d.amount) return t('dose.complete');
  const parts = [t('dose.amount') + ': ' + (d.amount || '—') + ' ' + t('dose.unit.' + unit), t('dose.schedule.' + d.schedule)];
  for (const key of scheduleKeys[d.schedule as string] ?? []) if (d[key]) parts.push(t('dose.' + key) + ': ' + (Array.isArray(d[key]) ? (d[key] as string[]).map(v => key === 'meals' ? t('dose.meal.'+v) : v).join(', ') : d[key]));
  if (d.food !== 'unspecified' && d.schedule !== 'meals') parts.push(t('dose.food.' + d.food));
  if (d.schedule === 'meals') parts.push(t('dose.food.' + d.food));
  if (d.schedule !== 'once' && d.duration) parts.push(t('dose.duration.' + d.duration) + (d.duration_count ? ': ' + d.duration_count : '') + (d.until ? ': ' + d.until : ''));
  if (d.notes) parts.push(d.notes as string);
  return parts.join('\n');
}
export function DosageEditor({ value, unit, custom, disabled, change, customChange }: { value: Dosage; unit: string | null | undefined; custom: string; disabled: boolean; change: (d: Dosage) => void; customChange: (s: string) => void }) {
  const { t } = useTranslation('advisor');
  const set = (key: string, v: string | string[]) => change({ ...value, [key]: v });
  const select = (key: string, options: string[], prefix = 'dose.') => <label className="advisor-field"><span>{t('dose.'+key+'Label')}</span><select aria-label={t('dose.'+key+'Label')} disabled={disabled} value={value[key] as string ?? ''} required onChange={e => change({ ...value, food: value.food ?? 'unspecified', [key]: e.target.value })}><option value="">{t('dose.choose')}</option>{options.map(o=><option key={o} value={o} disabled={key==='mode' && o==='structured' && !unit}>{t(prefix+o)}</option>)}</select></label>;
  const stepAmount = (direction: number) => {
    const increment = unit === 'mL' ? 0.1 : 1;
    const current = Number(value.amount || 0);
    const next = Math.round((current + direction * increment) * 1000) / 1000;
    if (next > 0 && next <= 999999.999) set('amount', String(next));
  };
  const amountField = <label className="advisor-field"><span>{t('dose.amount')}</span><div className="advisor-amount-stepper"><button type="button" aria-label={t('dose.decrease')} onClick={()=>stepAmount(-1)} disabled={disabled || Number(value.amount || 0) <= (unit === 'mL' ? 0.1 : 1)}>−</button><input aria-label={t('dose.amount')} type="number" inputMode="decimal" step="any" min="0.001" max="999999.999" required value={value.amount as string ?? ''} onChange={e=>set('amount',e.target.value)} onKeyDown={e=>{if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();stepAmount(e.key==='ArrowUp'?1:-1)}}}/><button type="button" aria-label={t('dose.increase')} onClick={()=>stepAmount(1)} disabled={disabled || Number(value.amount || 0) >= 999999.999}>+</button></div></label>;
  const field = (key: string, type = 'number', required = true) => <label className="advisor-field"><span>{t('dose.'+key)}</span><input disabled={disabled} value={value[key] as string ?? ''} required={required} max={type==='number' ? ['max_doses','daily_count'].includes(key) ? 100 : key==='amount' ? 999999.999 : 10000 : undefined} type={type} min={type==='number' ? key==='amount' ? '0.001' : '1' : undefined} step={key==='amount' ? '0.001' : undefined} maxLength={key==='reason'?500:undefined} onChange={e=>set(key,e.target.value)} /></label>;
  return <fieldset className="advisor-dosage" disabled={disabled}><legend>{t('instructions')}</legend>
    {select('mode',['structured','custom','none'])}
    {value.mode==='structured' && <>
      <div className="advisor-form-grid"><div>{amountField}<p className="advisor-dose-unit">{t('dose.unit.'+unit)} · {t('dose.fromCatalogue')}</p></div>{select('schedule',['times','interval','daily','meals','once','prn'],'dose.schedule.')}</div>
      {!!value.schedule && <div className="advisor-form-grid">
        {value.schedule==='times' && <div><span>{t('dose.times')}</span>{(value.times as string[] ?? ['']).map((time,index)=><div className="advisor-time-row" key={index}><input aria-label={t('dose.time')+' '+(index+1)} type="time" required value={time} onChange={e=>{const next=[...(value.times as string[] ?? [''])];next[index]=e.target.value;set('times',next)}}/><button type="button" disabled={(value.times as string[] ?? ['']).length===1} onClick={()=>set('times',(value.times as string[] ?? ['']).filter((_,i)=>i!==index))}>{t('remove')}</button></div>)}<button type="button" disabled={(value.times as string[] ?? []).length>=24} onClick={()=>set('times',[...(value.times as string[] ?? []),''])}>{t('dose.addTime')}</button><small>{t('dose.cairo')}</small></div>}
        {['interval','prn'].includes(value.schedule as string) && field('hours')}
        {value.schedule==='interval' && field('first_time','time',false)}
        {value.schedule==='daily' && field('daily_count')}
        {value.schedule==='once' && field('once_at','datetime-local',false)}
        {value.schedule==='prn' && <>{field('reason','text')}{field('max_doses')}</>}
        {value.schedule==='meals' && <fieldset><legend>{t('dose.meals')}</legend>{['breakfast','lunch','dinner'].map(m=><label className="advisor-check" key={m}><input type="checkbox" checked={(value.meals as string[] ?? []).includes(m)} onChange={e=>set('meals',e.target.checked ? [...(value.meals as string[] ?? []),m] : (value.meals as string[]).filter(v=>v!==m))}/>{t('dose.meal.'+m)}</label>)}</fieldset>}
        {select('food',value.schedule==='meals' ? ['before','with','after'] : ['unspecified','before','with','after'],'dose.food.')}
        {value.schedule!=='once' && select('duration',['days','weeks','until','ongoing'],'dose.duration.')}
        {value.schedule!=='once' && ['days','weeks'].includes(value.duration as string) && field('duration_count')}
        {value.schedule!=='once' && value.duration==='until' && field('until','date')}
      </div>}
      <details><summary>{t('dose.notes')}</summary><label className="advisor-field"><span className="sr-only">{t('dose.notes')}</span><textarea dir="auto" maxLength={2000} value={value.notes as string ?? ''} onChange={e=>set('notes',e.target.value)}/></label></details>
    </>}
    {value.mode==='custom' && <label className="advisor-field"><span>{t('instructions')}</span><textarea required dir="auto" maxLength={4000} value={custom} onChange={e=>customChange(e.target.value)}/></label>}
    <div className="advisor-instruction-preview"><strong>{t('dose.preview')}</strong><p className="advisor-preserve-text" dir="auto">{instructionPreview(value,custom,unit,t)}</p></div>
  </fieldset>;
}
