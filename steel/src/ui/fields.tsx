import { useEffect, useState, type KeyboardEvent } from 'react';
import { fromMm, toMm } from '../core/units';
import { catalogNames, tryProfile } from '../profiles/library';
import { getUserCatalog } from '../profiles/userCatalog';

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

const FAMILY_LABEL: Record<string, string> = {
  IPE: 'IPE', HEA: 'HEA', HEB: 'HEB', HEM: 'HEM', INP: 'INP', UPN: 'UPN', UPE: 'UPE',
  RHS: 'RHS (ריבוע/מלבן)', SHS: 'SHS', CHS: 'צינור CHS', L: 'זוויתן L', C: 'C מכופף', Z: 'Z מכופף', PL: 'פח',
};

/**
 * בחירת חתך בשני שלבים (החלטת משתמש 15.11.2026): סוג פרופיל ← גודל. משלב חתכים מקטלוג המשתמש.
 * families מגביל את הסוגים (למשל פטות: C/Z). שדה הקלדה חופשית נשאר לבעלי ניסיון (testId).
 */
export function ProfilePicker({ value, onCommit, families, testId, placeholder, varies }: {
  value: string; onCommit: (v: string) => void; families?: string[]; testId?: string; placeholder?: string; varies?: boolean;
}) {
  const groups = catalogNames().filter((g) => !families || families.includes(g.family));
  const user = getUserCatalog()?.rows.map((r) => r.name) ?? [];
  const fam = (n: string) => tryProfile(n)?.family ?? groups.find((g) => n.startsWith(g.family))?.family ?? '';
  const cur = value ? fam(value) : '';
  const [f, setF] = useState<string>(cur || groups[0]?.family || "");
  useEffect(() => { if (cur) setF(cur); }, [cur]);
  const g = groups.find((x) => x.family === f);
  const sizes = [...new Set([...(g?.names ?? []), ...user.filter((n) => fam(n) === f), ...(value && fam(value) === f ? [value] : [])])];
  const num = (n: string) => n.replace(/^[A-Z]+/, '').split(/x/i).map(Number);
  sizes.sort((a, b) => { const A = num(a), B = num(b); for (let i = 0; i < Math.max(A.length, B.length); i++) { const d = (A[i] ?? 0) - (B[i] ?? 0); if (d) return d; } return 0; });
  return (
    <div className="prof-pick">
      <select className="inp" value={f} aria-label="סוג פרופיל" data-testid={testId ? `${testId}-family` : undefined} onChange={(e) => setF(e.target.value)}>
        {groups.map((x) => <option key={x.family} value={x.family}>{FAMILY_LABEL[x.family] ?? x.family}</option>)}
      </select>
      <select className={`inp num${varies ? ' varies' : ''}`} value={value && fam(value) === f ? value : ''} aria-label="גודל" data-testid={testId ? `${testId}-size` : undefined}
        onChange={(e) => e.target.value && e.target.value !== value && onCommit(e.target.value)}>
        <option value="">{varies ? 'משתנה' : 'בחר גודל…'}</option>
        {sizes.map((n) => <option key={n} value={n}>{n.replace(/^[A-Z]+/, '').replace(/x/g, '×')}{user.includes(n) ? ' ✓' : ''}</option>)}
      </select>
      <TextField ltr list="profiles" testId={testId} value={value} placeholder={placeholder ?? 'הקלדה'} varies={varies} onCommit={(v) => { const n = v.toUpperCase().replace(/\s/g, ''); if (n && n !== value) onCommit(n); }} />
    </div>
  );
}
