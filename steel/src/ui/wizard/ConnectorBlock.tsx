import { useEffect, useState, type ReactNode } from 'react';
import { store, useStore } from '../../store';
import { EndTypePicker } from '../ConnTypePicker';

/**
 * 1.63: מקום אחד לבחירת חיבור בכל אשף (במקום פרט + כרטיסי קצה + "סוג חיבור בכל קצה" + כפתורים נפרדים):
 *   מחברים (לשוניות) → פרט החיבור: "מובנה" (הפרט הפרמטרי של הרכיב) או "מהספרייה / פרט מוכן" (לקצה שנבחר)
 *   → תלת-ממד של המחבר → סטודיו (פרט חדש / עריכה מתקדמת).
 */
export interface ConnTab { key: string; title: string; sub?: string; testId?: string }
export function ConnectorBlock({ tabs, value, onPick, built, site, onStudio, wizardConnId, single }: {
  tabs: ConnTab[]; value: string; onPick: (k: string) => void;
  /** הפרט המובנה של הרכיב: אריחי פרט + שדות (ברגים, עובי…) */
  built: ReactNode;
  /** קצה האלמנט שנבחר — לשיוך פרט מהספרייה / פרט מוכן (בלי אלמנט נבחר: הסבר) */
  site?: { memberId: string; end: 'start' | 'end' } | null;
  connId?: string;
  onStudio?: () => void;
  /** חיבור לפתיחה באשף המחברים (כל סוגי הפרט לחיבור הזה) */
  wizardConnId?: string;
  /** הפרט המובנה כבר כולל בחירה מהספרייה / פרטים מוכנים (למשל תושבת פטה) — בלי בורר מקור כפול */
  single?: boolean;
}) {
  const p = useStore((s) => s.project);
  const assigned = site ? p.detailAssign?.[`${site.memberId}|${site.end}`] : undefined;
  const [src, setSrc] = useState<'built' | 'lib'>(assigned ? 'lib' : 'built');
  useEffect(() => { if (assigned) setSrc('lib'); }, [assigned]);
  return (
    <div className="cb" data-testid="conn-block">
      {tabs.length > 1 && <div className="ks-ends" role="tablist" aria-label="מחברים">
        {tabs.map((t) => (
          <button key={t.key} role="tab" aria-selected={value === t.key} className={`ks-end${value === t.key ? ' on' : ''}`} onClick={() => onPick(t.key)} data-testid={t.testId}>
            <b>{t.title}</b>{t.sub && <small>{t.sub}</small>}
          </button>
        ))}
      </div>}
      <div className="cb-card">
        <div className="cb-h">
          <b>פרט החיבור</b>
          {!single && <span className="seg cb-src" role="radiogroup" aria-label="מקור הפרט">
            <button role="radio" aria-checked={src === 'built'} className={`tbtn${src === 'built' ? ' on' : ''}`} onClick={() => setSrc('built')} data-testid="cb-built">פרט מובנה</button>
            <button role="radio" aria-checked={src === 'lib'} className={`tbtn${src === 'lib' ? ' on' : ''}`} onClick={() => setSrc('lib')} data-testid="cb-lib">מהספרייה / פרט מוכן</button>
          </span>}
        </div>
        {(src === 'built' || single) && <div className="cb-body">
          {built}
          {wizardConnId && <button className="wz-link cb-more" onClick={() => store.set({ connWizard: wizardConnId })} data-testid="ks-wizard">עוד סוגי פרט לחיבור הזה — אשף המחברים ←</button>}
        </div>}
        {src === 'lib' && !single && <div className="cb-body">
          {site ? <><div className="ks-note">פרט מהספרייה של הפרויקט או פרט מוכן — לקצה הזה (אפשר להחיל גם על כל הקצוות הדומים).</div><EndTypePicker memberId={site.memberId} end={site.end} /></>
            : <div className="ks-note" data-testid="cb-lib-nosel">בחרו במודל אלמנט של הרכיב — הפרט מהספרייה משויך לקצה שלו (ואפשר להחיל על כל הקצוות הדומים).</div>}
        </div>}
      </div>
      {onStudio && <div className="ks-acts"><button className="btn" onClick={onStudio} data-testid="ks-studio">סטודיו ✎ — פרט חדש / עריכה מתקדמת</button></div>}
    </div>
  );
}

/** לאיזה קצה של האלמנט שייך החיבור (לפי מרכז החלקים שלו) */
export function endOfConn(d: { byId: Map<string, { start: { x: number; y: number; z: number }; end: { x: number; y: number; z: number } }>; connById: Map<string, { parts: string[] }> }, memberId: string, connId?: string): 'start' | 'end' {
  const m = d.byId.get(memberId), c = connId ? d.connById.get(connId) : undefined;
  if (!m || !c) return 'start';
  const pts = c.parts.map((x) => d.byId.get(x)).filter((x): x is NonNullable<typeof x> => !!x).map((x) => ({ x: (x.start.x + x.end.x) / 2, y: (x.start.y + x.end.y) / 2, z: (x.start.z + x.end.z) / 2 }));
  if (!pts.length) return 'start';
  const P = { x: pts.reduce((a, q) => a + q.x, 0) / pts.length, y: pts.reduce((a, q) => a + q.y, 0) / pts.length, z: pts.reduce((a, q) => a + q.z, 0) / pts.length };
  const dd = (q: { x: number; y: number; z: number }) => Math.hypot(q.x - P.x, q.y - P.y, q.z - P.z);
  return dd(m.start) <= dd(m.end) ? 'start' : 'end';
}
