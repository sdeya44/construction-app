import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { navStatus } from './navStatus';
import type { NavKey } from './SideNav';

/**
 * סרגל התקדמות — 16 שלבי העבודה (1.54, עיצוב מחדש). מציג מצב בלבד; לחיצה על שלב פותחת את הכלי שלו בריבון
 * (אותו setNav) — אין כאן ניווט נוסף. ✓ = קיים ותקין · ⚠ = יש אזהרה/שגיאה · – = לא בשימוש בפרויקט.
 */
type Step = { label: string; nav?: NavKey; mode?: 'drawings' | 'production'; action?: 'export' };
const STEPS: Step[] = [
  { label: 'פרויקט והגדרות', nav: 's:project' }, { label: 'צירים, מסגרות וגבהים', nav: 's:geometry' }, { label: 'חתכים וחומר', nav: 's:profiles' },
  { label: 'פטות ותושבות', nav: 'r:left' }, { label: 'חיבורי המשך פטות', nav: 'r:splices' },
  { label: 'אלכסוני עמוד-קורה', nav: 'b:knee' }, { label: 'קושרות גג', nav: 'b:roof' }, { label: 'קשיחות קירות', nav: 'b:walls' }, { label: 'פטות — קשירה ותמיכה', nav: 'b:ties' }, { label: 'חיזוק רכס', nav: 'b:ridge' },
  { label: 'חיפוי גג וקירות', nav: 'w:roof' }, { label: 'רכיבים מיוחדים', nav: 'b:tb' }, { label: 'בדיקות', nav: 'issues' },
  { label: 'ייצור — מספור', mode: 'production' }, { label: 'שרטוטים (PDF / DXF)', mode: 'drawings' }, { label: 'ייצוא קובץ פרויקט', action: 'export' },
];

export function StepsRail({ nav, setNav, setMode, onExport }: { nav: NavKey; setNav: (k: NavKey) => void; setMode: (m: 'drawings' | 'production') => void; onExport: () => void }) {
  const p = useStore((s) => s.project), d = useStore((s) => s.derived);
  const [open, setOpen] = useState(false);
  const stat = useMemo(() => navStatus(p, d), [p, d]);
  const errs = d.issues.filter((i) => i.severity === 'error').length, warns = d.issues.filter((i) => i.severity === 'warning').length;
  const rows = STEPS.map((st, i) => {
    let state: 'ok' | 'warn' | 'off' | 'todo' = 'todo';
    if (st.nav === 'issues') state = errs ? 'warn' : 'ok';
    else if (st.nav) { const s = stat[st.nav]; state = !s ? 'ok' : s.off ? 'off' : s.err || s.warn ? 'warn' : 'ok'; }
    if (st.nav === 's:project' || st.nav === 's:profiles') state = state === 'todo' ? 'ok' : state;
    const sub = st.nav === 'issues' ? `${errs} שגיאות · ${warns} אזהרות` : st.nav ? stat[st.nav]?.v ?? '' : '';
    return { ...st, i, state, sub, on: !!st.nav && (nav === st.nav || (st.nav === 'issues' && nav.startsWith('i:'))) };
  });
  const done = rows.filter((r) => r.state === 'ok' || r.state === 'off').length;
  const pct = Math.round((done / STEPS.length) * 100);
  const go = (r: (typeof rows)[number]) => { setOpen(false); if (r.nav) setNav(r.nav); else if (r.mode) setMode(r.mode); else if (r.action === 'export') onExport(); };
  const mark = (r: (typeof rows)[number]) => (r.state === 'ok' ? '✓' : r.state === 'warn' ? '!' : r.state === 'off' ? '–' : String(r.i + 1));
  return (
    <div className="steps-rail" data-testid="steps-rail">
      <button className="sr-ring" style={{ background: `conic-gradient(var(--brand) 0 ${pct}%, var(--line) ${pct}% 100%)` }} onClick={() => setOpen(!open)} aria-expanded={open} data-testid="sr-ring" title="מסלול הפרויקט — 16 שלבים">
        <span>{pct}%</span>
      </button>
      {rows.map((r) => (
        <button key={r.i} className={`sr-dot ${r.state}${r.on ? ' on' : ''}`} title={`${r.i + 1}. ${r.label}${r.sub ? ` — ${r.sub}` : ''}`} aria-label={`שלב ${r.i + 1}: ${r.label}`} data-testid={`sr-${r.i + 1}`} onClick={() => go(r)}>{mark(r)}</button>
      ))}
      {open && (
        <div className="sr-pop" role="dialog" aria-label="מסלול הפרויקט" data-testid="sr-pop">
          <div className="sr-pop-h"><b>מסלול הפרויקט</b><span>{done} מתוך 16 · {pct}%</span></div>
          <div className="hint" style={{ margin: '0 8px 6px' }}>לחיצה על שלב פותחת את הכלי שלו. – = רכיב שלא בשימוש בפרויקט.</div>
          {rows.map((r) => (
            <button key={r.i} className={`sr-row${r.on ? ' on' : ''}`} onClick={() => go(r)}>
              <span className={`sr-dot ${r.state}`}>{mark(r)}</span>
              <span className="sr-t"><b>{r.i + 1}. {r.label}</b>{r.sub && <small>{r.sub}</small>}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
