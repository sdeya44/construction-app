import { useEffect, useState, type KeyboardEvent } from 'react';
import { fromMm, toMm } from '../core/units';

/**
 * שדה אורך: הערך במודל ב-mm, התצוגה ביחידת הפרויקט. ההתחייבות לערך מתבצעת ב-Enter או ביציאה מהשדה.
 * ערך לא מספרי מסומן ואינו נשלח למודל.
 */
export function LenField({ mm, unit, onCommit, min, testId, disabled }: {
  mm: number; unit: 'm' | 'mm'; onCommit: (mm: number) => void; min?: number; testId?: string; disabled?: boolean;
}) {
  const show = (v: number) => (unit === 'm' ? String(+fromMm(v, 'm').toFixed(4)) : String(+v.toFixed(2)));
  const [text, setText] = useState(show(mm));
  const [bad, setBad] = useState(false);
  useEffect(() => { setText(show(mm)); setBad(false); }, [mm, unit]);
  const commit = () => {
    const n = Number(text.replace(',', '.'));
    if (!Number.isFinite(n) || text.trim() === '' || (min !== undefined && toMm(n, unit) < min)) { setBad(true); return; }
    setBad(false);
    const v = toMm(n, unit);
    if (Math.abs(v - mm) > 1e-9) onCommit(v);
  };
  return (
    <div className="unit-wrap">
      <input className={`inp num${bad ? ' bad' : ''}`} value={text} inputMode="decimal" disabled={disabled} data-testid={testId}
        onChange={(e) => setText(e.target.value)} onBlur={commit}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setText(show(mm)); (e.target as HTMLInputElement).blur(); } }} />
      <span className="unit">{unit === 'm' ? 'מ\'' : 'מ"מ'}</span>
    </div>
  );
}

export function NumField({ value, suffix, onCommit, testId, step, placeholder }: {
  value: number; suffix?: string; onCommit: (v: number) => void; testId?: string; step?: number; placeholder?: string;
}) {
  const show = (v: number) => (Number.isFinite(v) ? String(+v.toFixed(6)) : '');
  const [text, setText] = useState(show(value));
  const [bad, setBad] = useState(false);
  useEffect(() => { setText(show(value)); setBad(false); }, [value]);
  const commit = () => {
    // ערך "משתנה" (NaN) שלא נגעו בו — לא משנה דבר
    if (!Number.isFinite(value) && text.trim() === '') { setBad(false); return; }
    const n = Number(text.replace(',', '.'));
    if (!Number.isFinite(n) || text.trim() === '') { setBad(true); return; }
    setBad(false);
    if (n !== value) onCommit(n);
  };
  return (
    <div className="unit-wrap">
      <input className={`inp num${bad ? ' bad' : ''}${!Number.isFinite(value) ? ' varies' : ''}`} value={text} inputMode="decimal" data-testid={testId} step={step} placeholder={placeholder}
        onChange={(e) => setText(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      {suffix && <span className="unit">{suffix}</span>}
    </div>
  );
}

export function TextField({ value, onCommit, testId, list, ltr, placeholder, varies }: { value: string; onCommit: (v: string) => void; testId?: string; list?: string; ltr?: boolean; placeholder?: string; varies?: boolean }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => { if (text !== value) onCommit(text); };
  return (
    <input className={`inp${ltr ? ' num' : ''}${varies ? ' varies' : ''}`} value={text} list={list} data-testid={testId} placeholder={placeholder}
      onChange={(e) => setText(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
  );
}
