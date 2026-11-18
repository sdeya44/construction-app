import React, { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { assessCandidate, SIZE_LABEL, type SizeStatus } from '../model/sizing';
import { useStore } from '../store';
import { fromMm, toMm } from '../core/units';
import { catalogNames, massPerMeter, tryProfile } from '../profiles/library';
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

/** ציור חתך קטן לפי משפחה (בכפתור ובחלונית) */
export function SectionIcon({ family, size = 20 }: { family: string; size?: number }) {
  const st = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinejoin: 'round' as const };
  const body = (() => {
    switch (family) {
      case 'IPE': case 'INP': return <path d="M5 4h14M5 20h14M12 4v16" {...st} />;
      case 'HEA': case 'HEB': case 'HEM': return <path d="M4 4h16M4 20h16M12 4v16" {...st} strokeWidth={2.8} />;
      case 'UPN': case 'UPE': case 'C': return <path d="M18 4H7v16h11" {...st} />;
      case 'Z': return <path d="M5 4h7v16h7" {...st} />;
      case 'L': return <path d="M7 4v15h12" {...st} />;
      case 'CHS': return <circle cx="12" cy="12" r="8" {...st} />;
      case 'SHS': return <rect x="4.5" y="4.5" width="15" height="15" rx="1.5" {...st} />;
      case 'RHS': return <rect x="6" y="3.5" width="12" height="17" rx="1.5" {...st} />;
      default: return <rect x="3" y="9" width="18" height="6" {...st} />;
    }
  })();
  return <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" className="sec-ico">{body}</svg>;
}

const kgm = (n: string) => { const pr = tryProfile(n); return pr ? massPerMeter(pr, 7850) : null; };

/**
 * בחירת חתך (1.34, בקשת משתמש: "כפתור אחד + חלונית"): שדה אחד עם ציור החתך, השם (ניתן להקלדה) ומשקל למטר;
 * לחיצה על ▾ פותחת חלונית: סוגי פרופיל כלשוניות וגדלים כרשת עם משקל, צבע לפי הערכת הגודל.
 * families מגביל את הסוגים (למשל פטות: C/Z). role — צביעת הגדלים לפי כללי האצבע.
 */
export function ProfilePicker({ value, onCommit, families, testId, placeholder, varies, role }: {
  value: string; onCommit: (v: string) => void; families?: string[]; testId?: string; placeholder?: string; varies?: boolean;
  role?: 'column' | 'rafter' | 'purlin';
}) {
  const project = useStore((s) => s.project), derived = useStore((s) => s.derived);
  const groups = catalogNames().filter((g) => !families || families.includes(g.family));
  const user = getUserCatalog()?.rows.map((r) => r.name) ?? [];
  const fam = (n: string) => tryProfile(n)?.family ?? groups.find((g) => n.startsWith(g.family))?.family ?? '';
  const cur = value ? fam(value) : '';
  const [f, setF] = useState<string>(cur || groups[0]?.family || '');
  const [open, setOpen] = useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  useEffect(() => { if (cur) setF(cur); }, [cur]);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', down); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open]);
  const g = groups.find((x) => x.family === f);
  const sizes = [...new Set([...(g?.names ?? []), ...user.filter((n) => fam(n) === f), ...(value && fam(value) === f ? [value] : [])])];
  const num = (n: string) => n.replace(/^[A-Z]+/, '').split(/x/i).map(Number);
  sizes.sort((a, b) => { const A = num(a), B = num(b); for (let i = 0; i < Math.max(A.length, B.length); i++) { const d = (A[i] ?? 0) - (B[i] ?? 0); if (d) return d; } return 0; });
  const sz = useMemo(() => {
    const m = new Map<string, SizeStatus>();
    if (role && open) for (const n of sizes) { try { m.set(n, assessCandidate(project, derived, role, n).status); } catch { /* פרופיל לא מוכר */ } }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, f, open, project, derived, sizes.join(',')]);
  const curSz = role && value ? (() => { try { return assessCandidate(project, derived, role, value).status; } catch { return 'na' as SizeStatus; } })() : 'na';
  const w = value ? kgm(value) : null;
  const pick = (n: string) => { setOpen(false); if (n && n !== value) onCommit(n); };
  return (
    <div className={`prof-pick${open ? ' open' : ''}`} ref={ref} data-testid={testId ? `${testId}-pick` : undefined}>
      <div className="pp-main">
        <span className="pp-ico" title={FAMILY_LABEL[cur] ?? cur}><SectionIcon family={cur} /></span>
        <TextField ltr list="profiles" testId={testId} value={value} placeholder={placeholder ?? (varies ? 'משתנה' : 'הקלדה')} varies={varies} onCommit={(v) => { const n = v.toUpperCase().replace(/\s/g, ''); if (n && n !== value) onCommit(n); }} />
        {w !== null && <span className="pp-kg" title="משקל למטר">{w.toFixed(1)} ק"ג/מ'</span>}
        <button type="button" className="pp-open" aria-label="בחירה מהרשימה" aria-expanded={open} data-testid={testId ? `${testId}-open` : undefined} onClick={() => setOpen(!open)}>▾</button>
      </div>
      {role && curSz !== 'na' && <span className={`sz-badge sz-${curSz}`} data-testid={testId ? `${testId}-sz` : undefined} title="הערכת כללי אצבע — לא תכן סטטי">{SIZE_LABEL[curSz]}</span>}
      {open && (
        <div className="pp-pop" role="dialog" aria-label="בחירת חתך" data-testid={testId ? `${testId}-pop` : undefined}>
          <div className="pp-fams" role="tablist">
            {groups.map((x) => (
              <button key={x.family} type="button" role="tab" aria-selected={x.family === f} className={`pp-fam${x.family === f ? ' on' : ''}`} data-testid={testId ? `${testId}-fam-${x.family}` : undefined} onClick={() => setF(x.family)} title={FAMILY_LABEL[x.family] ?? x.family}>
                <SectionIcon family={x.family} size={18} /><span>{x.family}</span>
              </button>
            ))}
          </div>
          {role && <div className="pp-legend"><span className="sz-small">▼ קטן</span><span className="sz-ok">● מתאים</span><span className="sz-big">▲ גדול</span> — הערכת כללי אצבע</div>}
          <div className="pp-grid">
            {sizes.map((n) => {
              const st = sz.get(n) ?? 'na', kg = kgm(n);
              return (
                <button key={n} type="button" className={`pp-opt${n === value ? ' on' : ''}${st !== 'na' ? ` sz-${st}` : ''}`} data-testid={testId ? `${testId}-opt-${n}` : undefined} onClick={() => pick(n)} title={n}>
                  <b>{n.replace(/^[A-Z]+/, '').replace(/x/g, '×')}{user.includes(n) ? ' ✓' : ''}</b>
                  {kg !== null && <small>{kg.toFixed(1)} ק"ג/מ'</small>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** "מתקדם" מתקפל — הגדרות שמשתמשים בהן לעיתים רחוקות (המצב נשמר במכשיר) */
export function Adv({ id, children, label = 'מתקדם' }: { id: string; children: React.ReactNode; label?: string }) {
  const key = `ksp-adv-${id}`;
  let init = false;
  try { init = localStorage.getItem(key) === '1'; } catch { /* */ }
  return (
    <details className="adv" data-testid={`adv-${id}`} open={init || undefined} onToggle={(e) => { try { localStorage.setItem(key, (e.currentTarget as HTMLDetailsElement).open ? '1' : '0'); } catch { /* */ } }}>
      <summary>{label}</summary>
      <div className="adv-body">{children}</div>
    </details>
  );
}

/**
 * עורך שמוטמע בחלון האלמנט (בקשת משתמש 18.11.2026 — "התפריטים לא מסודרים"): בלי כותרת/מתג הפעלה, בלי בוחר חתך
 * (החתך נבחר במקום אחד — "חתך וחומר"), ורק החלק המבוקש: shape = צורה ומידות, conn = חיבורים.
 */
export const EditCtx = React.createContext<{ embed: boolean; part?: 'shape' | 'conn' }>({ embed: false });
export function useEdit() {
  const c = React.useContext(EditCtx);
  return { embed: c.embed, showTitle: !c.embed, showProfile: !c.embed, showShape: !c.embed || c.part === 'shape', showConn: !c.embed || c.part === 'conn' };
}

/** קטרי ברגים סטנדרטיים — מקור אחד לכל הממשק (תיקון 1.34: רשימות שונות הציגו M10 לבורג M18) */
export const BOLT_SIZES = [10, 12, 14, 16, 18, 20, 22, 24, 27, 30];

/** בחירת קוטר בורג; ערך שאינו ברשימה מוצג כפי שהוא (לא "קופץ" לערך הראשון) */
export function BoltSelect({ d, onChange, testId, sizes = BOLT_SIZES }: { d: number; onChange: (d: number) => void; testId?: string; sizes?: number[] }) {
  const list = sizes.includes(d) ? sizes : [...sizes, d].sort((a, b) => a - b);
  return (
    <select className="inp" data-testid={testId} value={d} onChange={(e) => onChange(Number(e.target.value))}>
      {list.map((x) => <option key={x} value={x}>M{x}</option>)}
    </select>
  );
}

/** הסבר ארוך מאחורי "?" (1.34): מקופל כברירת מחדל, כדי שהתוכן לא יידחף למטה */
export function Help({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return (
    <details className="help" data-testid={testId}>
      <summary aria-label="הסבר"><span className="help-q">?</span>הסבר</summary>
      <div className="hint">{children}</div>
    </details>
  );
}
