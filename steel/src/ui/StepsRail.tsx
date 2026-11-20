import { useMemo, useState } from 'react';
import { setMeta } from '../commands/commands';
import { store, useStore } from '../store';
import { navStatus } from './navStatus';
import type { NavKey } from './SideNav';
import { STEPS, stepExists, stepMarks, stepState, type StepDef, type StepState } from './steps';

/**
 * סרגל שלבי העבודה (1.59): שם השלב + מצב, בצד ימין. לחיצה על שלב קיים פותחת את האשף שלו;
 * רכיב שלא קיים — שאלה: הוספה / לא נדרש / ביטול. "הושלם" (ירוק) — רק אחרי "אישור" באשף.
 * ניתן לכווץ לנקודות (ההעדפה נשמרת בדפדפן).
 */
const MARK: Record<StepState, string> = { ok: '✓', warn: '!', skip: '–', todo: '' };
const STATE_HE: Record<StepState, string> = { ok: 'הושלם', warn: 'הושלם — יש הערות', skip: 'לא נדרש', todo: 'לא הוגדר' };

export function StepsRail({ nav, setNav, setMode, onExport, wide, setWide }: { nav: NavKey; setNav: (k: NavKey) => void; setMode: (m: 'drawings' | 'production') => void; onExport: () => void; wide: boolean; setWide: (v: boolean) => void }) {
  const p = useStore((s) => s.project), d = useStore((s) => s.derived);
  const [ask, setAsk] = useState<StepDef | null>(null);
  const stat = useMemo(() => navStatus(p, d), [p, d]);
  const marks = useMemo(() => stepMarks(p, d), [p, d]);
  const errs = d.issues.filter((i) => i.severity === 'error').length, warns = d.issues.filter((i) => i.severity === 'warning').length;
  const rows = STEPS.map((st, i) => {
    const s = st.nav ? stat[st.nav] : undefined;
    const state = stepState(st, p, d, marks, { err: s?.err ?? 0, warn: s?.warn ?? 0 });
    const exists = stepExists(st.key, p, d);
    const sub = st.key === 'issues' ? `${errs} שגיאות · ${warns} אזהרות` : st.out ? '' : !exists && !st.core ? (state === 'skip' ? 'לא נדרש' : 'לא קיים — לחצו להוספה') : s?.v ?? '';
    return { ...st, i, state, exists, sub, on: !!st.nav && (nav === st.nav || (st.nav === 'issues' && nav.startsWith('i:'))) };
  });
  const counted = rows.filter((r) => !r.out);
  const done = counted.filter((r) => r.state === 'ok' || r.state === 'skip').length;
  const pct = Math.round((done / counted.length) * 100);
  const open = (r: (typeof rows)[number]) => { if (r.nav) setNav(r.nav); else if (r.mode) setMode(r.mode); else if (r.action === 'export') onExport(); };
  const go = (r: (typeof rows)[number]) => { if (!r.out && !r.core && !r.exists) setAsk(r); else open(r); };
  const skip = (k: string) => { try { store.exec(setMeta({ steps: { ...marks, [k]: 'skip' } })); } catch { /* מהדורה נעולה */ } };
  const row = (r: (typeof rows)[number]) => (
    <button key={r.key} className={`sr-item ${r.state}${r.on ? ' on' : ''}${!r.exists && !r.core && !r.out ? ' absent' : ''}`} onClick={() => go(r)} data-testid={`sr-${r.i + 1}`} data-state={r.state}
      title={`${r.i + 1}. ${r.label} — ${r.out ? 'הפקה' : STATE_HE[r.state]}${r.sub ? ` · ${r.sub}` : ''}`} aria-label={`שלב ${r.i + 1}: ${r.label} — ${r.out ? 'הפקה' : STATE_HE[r.state]}`}>
      <span className={`sr-dot ${r.out ? 'out' : r.state}`}>{r.out ? '' : MARK[r.state] || r.i + 1}</span>
      {wide && <span className="sr-t"><b>{r.short}</b><small>{r.out ? 'הפקה' : r.state === 'todo' && !r.exists && !r.core ? '+ הוספה' : STATE_HE[r.state]}</small></span>}
    </button>
  );
  return (
    <div className={`steps-rail${wide ? ' wide' : ''}`} data-testid="steps-rail">
      <div className="sr-head">
        <span className="sr-ring" style={{ background: `conic-gradient(var(--ok, #1f9d55) 0 ${pct}%, var(--line) ${pct}% 100%)` }} data-testid="sr-ring" title={`${done} מתוך ${counted.length} שלבי הגדרה הושלמו`}><span>{pct}%</span></span>
        {wide && <span className="sr-ht"><b>שלבי העבודה</b><small>{done} מתוך {counted.length} הושלמו</small></span>}
        <button className="sr-fold" onClick={() => setWide(!wide)} data-testid="sr-fold" title={wide ? 'כיווץ לנקודות' : 'הצגת שמות השלבים'} aria-label={wide ? 'כיווץ סרגל השלבים' : 'הרחבת סרגל השלבים'}>{wide ? '›' : '‹'}</button>
      </div>
      <div className="sr-list" role="list">
        {wide && <div className="sr-grp">הגדרת המבנה</div>}
        {rows.filter((r) => !r.out).map(row)}
        {wide ? <div className="sr-grp">הפקה</div> : <i className="sr-sep" />}
        {rows.filter((r) => r.out).map(row)}
      </div>
      {wide && <div className="sr-legend" aria-hidden="true"><span><i className="sr-dot ok" />הושלם</span><span><i className="sr-dot todo" />לא הוגדר</span><span><i className="sr-dot skip" />לא נדרש</span><span><i className="sr-dot warn" />הערות</span></div>}
      {ask && (
        <div className="sr-ask-bg" onClick={() => setAsk(null)}>
          <div className="sr-ask" role="dialog" aria-label={`להוסיף ${ask.label}?`} data-testid="sr-ask" onClick={(e) => e.stopPropagation()}>
            <b>להוסיף "{ask.label}" למבנה?</b>
            <p>הרכיב לא קיים בפרויקט. "הוספה" פותחת את האשף; השלב יסומן כהושלם אחרי "אישור" באשף.</p>
            <div className="sr-ask-a">
              <button className="btn primary" data-testid="sr-ask-add" onClick={() => { const r = rows.find((x) => x.key === ask.key)!; setAsk(null); open(r); }}>הוספה</button>
              <button className="btn" data-testid="sr-ask-skip" onClick={() => { skip(ask.key); setAsk(null); }}>לא נדרש במבנה הזה</button>
              <button className="btn" data-testid="sr-ask-cancel" onClick={() => setAsk(null)}>ביטול</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
