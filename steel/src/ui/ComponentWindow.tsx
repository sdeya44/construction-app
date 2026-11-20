import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { store, useStore } from '../store';
import type { Connection, DerivedModel, Member } from '../model/types';
import { kneeSet, KNEE_RE, wallSet, WALL_RE } from '../view/realView';
import { LiveView3D } from './LiveView3D';
import { MenuPic } from './pics';
import type { NavKey } from './SideNav';

/**
 * 1.55: חלון רכיב — אותו חלון לכל דרך הגעה (כלי בריבון, לחיצה על אלמנט במודל, גיליון הפרמטרים, סרגל השלבים).
 * מעטפת מעוצבת סביב העורך הקיים (כל ההגדרות נשמרות במקום אחד), עם תצוגה תלת-ממדית ריאליסטית וחיה
 * של הרכיב, וכרטיסי המחברים שלו (אשף המחברים / סטודיו הפרטים).
 */
export type CompKind = 'walls' | 'knee';
const META: Record<CompKind, { title: string; crumb: string; pic: string; re: RegExp; nav: NavKey; tint: string }> = {
  walls: { title: 'קשיחות קירות', crumb: 'חיזוקים', pic: 'walls', re: WALL_RE, nav: 'b:walls', tint: 'teal' },
  knee: { title: 'אלכסוני עמוד-קורה', crumb: 'חיזוקים', pic: 'knee', re: KNEE_RE, nav: 'b:knee', tint: 'mustard' },
};
const isPart = (m: Member) => m.kind === 'plate' || m.kind === 'bolt' || m.kind === 'cleat' || m.kind === 'anchor';

/** לאיזה חלון רכיב שייך אלמנט (כולל הפלטות והברגים של החיבורים שלו) */
export function compOfMember(m: Member | undefined, d: DerivedModel): CompKind | null {
  if (!m) return null;
  const id = isPart(m) ? (m.connId ? d.connById.get(m.connId)?.members[0] ?? m.connId : m.id) : m.id;
  if (/^(C\.)?(BR\.W|BB\.|LT\.)/.test(id) && !/^(C\.)?LTIE/.test(id)) return 'walls';
  if (/^(C\.)?KB\./.test(id)) return 'knee';
  return null;
}
export const compOfNav = (k: NavKey): CompKind | null => (k === 'b:walls' ? 'walls' : k === 'b:knee' ? 'knee' : null);

/** פותח את הסטודיו על חיבור (אותה פעולה כמו "עריכת הפלטה בסטודיו") */
export function openConnStudio(c: Connection, d: DerivedModel) {
  const pts = c.parts.map((x) => d.byId.get(x)).filter((x): x is Member => !!x).map((x) => ({ x: (x.start.x + x.end.x) / 2, y: (x.start.y + x.end.y) / 2, z: (x.start.z + x.end.z) / 2 }));
  const P = pts.length ? { x: pts.reduce((a, q) => a + q.x, 0) / pts.length, y: pts.reduce((a, q) => a + q.y, 0) / pts.length, z: pts.reduce((a, q) => a + q.z, 0) / pts.length } : null;
  let best: [string, 'start' | 'end', number] | null = null;
  for (const id of c.members) { const mm = d.byId.get(id); if (!mm || !P) continue; for (const e of ['start', 'end'] as const) { const q = mm[e]; const dd = Math.hypot(q.x - P.x, q.y - P.y, q.z - P.z); if (!best || dd < best[2]) best = [id, e, dd]; } }
  store.set({ detailStudio: best ? `${best[0]}|${best[1]}` : `${c.members[0]}|start`, studioConn: c.id });
}

/** סוגי החיבורים של הרכיב, מקובצים לפי תיאור (בלי מספר המסגרת/הציר) */
function connGroups(d: DerivedModel, re: RegExp) {
  const g = new Map<string, Connection[]>();
  for (const c of d.connections) {
    if (!c.members.some((x) => re.test(x)) && !re.test(c.id.replace(/^C\./, ''))) continue;
    const key = c.label.replace(/(ציר|מפתח|מסגרת|קו)\s+[^\s—–-]+/g, '').replace(/\bF\d+\b/g, '').replace(/\s+([—–-])\s+/g, ' $1 ').replace(/\s+/g, ' ').replace(/^[\s—–-]+|[\s—–-]+$/g, '').trim() || c.label;
    (g.get(key) ?? g.set(key, []).get(key)!).push(c);
  }
  return [...g.entries()].map(([label, cs]) => {
    const b = cs[0].bolts[0];
    const plates = cs[0].parts.map((x) => d.byId.get(x)).filter((x): x is Member => !!x && x.kind === 'plate');
    const spec = [b ? `${cs[0].bolts.length}×M${b.d}` : '', plates[0] ? plates[0].profile : '', cs[0].welds.length ? 'ריתוך' : ''].filter(Boolean).join(' · ');
    return { label, cs, spec, custom: cs.some((c) => c.custom) };
  });
}

export function ComponentWindow({ kind, memberId, onClose, onFull, children }: { kind: CompKind; memberId?: string; onClose: () => void; onFull?: () => void; children: ReactNode }) {
  const p = useStore((s) => s.project), d = useStore((s) => s.derived);
  const M = META[kind];
  const [wide, setWide] = useState(false);
  // נפתח מלחיצה על אלמנט ועדיין לא נבחר היקף — ישר להגדרות הרכיב (בלי לשמור כהעדפה)
  useEffect(() => { if (memberId && !store.state.propScope) store.set({ propScope: kind === 'knee' ? 'asm' : 'asmall' }); }, [memberId, kind]);
  const set = useMemo(() => (kind === 'walls' ? wallSet(p, d, { memberId, whole: wide }) : kneeSet(p, d, { memberId, frame: wide })), [kind, p, d, memberId, wide]);
  const count = d.members.filter((m) => M.re.test(m.id) && !isPart(m)).length;
  const groups = useMemo(() => connGroups(d, M.re), [d, M.re]);
  const mainEnd = useMemo(() => { const m = d.members.find((x) => M.re.test(x.id) && !isPart(x)); return m ? `${m.id}|start` : null; }, [d, M.re]);
  const modes = <div className="seg-mini" role="group" aria-label="מה מוצג">
    <button className={wide ? '' : 'on'} onClick={() => setWide(false)} data-testid="live3d-near">{kind === 'walls' ? 'מפתח' : 'צומת'}</button>
    <button className={wide ? 'on' : ''} onClick={() => setWide(true)} data-testid="live3d-far">{kind === 'walls' ? 'כל הקיר' : 'מסגרת'}</button>
  </div>;
  return (
    <section className={`cwin cwin-${M.tint}`} data-testid={`cwin-${kind}`} aria-label={M.title}>
      <header className="cwin-h">
        <span className="cwin-ic"><MenuPic name={M.pic} size={30} /></span>
        <div className="cwin-t"><small>{M.crumb} › {M.title}</small><b>{M.title}</b></div>
        <span className="cwin-pill" data-testid="cwin-count">{count ? `${count} אלמנטים` : 'לא בשימוש'}</span>
        <span className="sp" />
        {onFull && <button className="cwin-x" onClick={onFull} title="חלון במסך מלא" aria-label="חלון במסך מלא" data-testid="cwin-full">⤢</button>}
        <button className="cwin-x" onClick={onClose} title="סגירה — המודל במסך מלא" aria-label="סגירת החלון" data-testid="cwin-close">✕</button>
      </header>
      <div className="cwin-body">
        <div className="cwin-main" data-testid="cwin-main">{children}</div>
        <aside className="cwin-side">
          <LiveView3D set={set} rev={d} modes={modes} />
          <div className="cwin-conns" data-testid="cwin-conns">
            <div className="cwin-sec">מחברים ברכיב</div>
            {!groups.length && <div className="hint">אין חיבורים עדיין.</div>}
            {groups.map((g, i) => (
              <div key={g.label} className="cc-card" data-testid={`cwin-conn-${i}`}>
                <div className="cc-t"><b>{g.label}</b><small>{g.cs.length} חיבורים{g.spec ? ` · ${g.spec}` : ''}{g.custom ? ' · פרט מותאם' : ''}</small></div>
                <div className="cc-a">
                  <button className="btn small" data-testid={`cwin-conn-wiz-${i}`} onClick={() => store.set({ connWizard: g.cs[0].id })}>אשף</button>
                  <button className="btn small" data-testid={`cwin-conn-studio-${i}`} onClick={() => openConnStudio(g.cs[0], d)}>סטודיו ✎</button>
                </div>
              </div>
            ))}
            {mainEnd && <button className="cc-add" data-testid="cwin-conn-add" onClick={() => store.set({ detailStudio: mainEnd })}>+ הוספת מחבר / פרט מותאם — בסטודיו</button>}
          </div>
        </aside>
      </div>
      <footer className="cwin-f"><i />כל שינוי מוצג מיד בתצוגה ובמודל · Ctrl+Z לביטול</footer>
    </section>
  );
}
