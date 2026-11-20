import React, { useEffect, useMemo, useState, type ReactNode } from 'react';
import { store, useStore } from '../store';
import type { Connection, DerivedModel, Member } from '../model/types';
import { kneeSet, KNEE_RE, wallSet, WALL_RE } from '../view/realView';
import { LiveView3D } from './LiveView3D';
import { MenuPic } from './pics';
import { useWizardTx, WizardActions } from './wizard/Wizard';
import type { NavKey } from './SideNav';
import { FAMILIES, famOfConn, famOfMember, famOfNav, type FamKey } from './FamilyStudio';

/**
 * 1.55: חלון רכיב — אותו חלון לכל דרך הגעה (כלי בריבון, לחיצה על אלמנט במודל, גיליון הפרמטרים, סרגל השלבים).
 * מעטפת מעוצבת סביב העורך הקיים (כל ההגדרות נשמרות במקום אחד), עם תצוגה תלת-ממדית ריאליסטית וחיה
 * של הרכיב, וכרטיסי המחברים שלו (אשף המחברים / סטודיו הפרטים).
 */
export type CompKind = 'walls' | 'knee' | FamKey;
const META0: Record<'walls' | 'knee', { title: string; crumb: string; pic: string; re: RegExp; nav: NavKey; tint: string }> = {
  walls: { title: 'קשיחות קירות', crumb: 'חיזוקים', pic: 'walls', re: WALL_RE, nav: 'b:walls', tint: 'teal' },
  knee: { title: 'אלכסוני עמוד-קורה', crumb: 'חיזוקים', pic: 'knee', re: KNEE_RE, nav: 'b:knee', tint: 'mustard' },
};
/** 1.58: כל משפחות הרכיבים — אותו חלון */
export const compMeta = (k: CompKind) => (k === 'walls' || k === 'knee' ? META0[k] : { ...FAMILIES[k], re: new RegExp(FAMILIES[k].re.source.replace('^(C\\.)?', '^')), nav: FAMILIES[k].nav[0] });
/** ביטוי להעדפת הבחירה במודל כשהחלון פתוח */
export const compPick = (k: CompKind | null): string | null => (k === 'walls' ? '^(C\\.)?(BR\\.W|BB\\.|LT\\.)' : k === 'knee' ? '^(C\\.)?KB\\.' : k ? FAMILIES[k].re.source : null);
/** נקודת הלחיצה האחרונה במודל — החלון נפתח בצד השני, כדי לא לכסות את מה שנלחץ */
let lastDown: { x: number; t: number } | null = null;
if (typeof document !== 'undefined') document.addEventListener('pointerdown', (e) => { if ((e.target as HTMLElement)?.closest?.('.vp-pane')) lastDown = { x: e.clientX, t: Date.now() }; }, true);
const isPart = (m: Member) => m.kind === 'plate' || m.kind === 'bolt' || m.kind === 'cleat' || m.kind === 'anchor';

/** לאיזה חלון רכיב שייך אלמנט (כולל הפלטות והברגים של החיבורים שלו) */
export function compOfMember(m: Member | undefined, d: DerivedModel): CompKind | null {
  if (!m) return null;
  const id = isPart(m) ? (m.connId ? d.connById.get(m.connId)?.members[0] ?? m.connId : m.id) : m.id;
  if (/^(C\.)?(BR\.W|BB\.|LT\.)/.test(id) && !/^(C\.)?LTIE/.test(id)) return 'walls';
  if (/^(C\.)?(KB|HN)\./.test(id)) return 'knee';
  return famOfMember(m, d);
}
/** חיבור (עורך החיבור) ששייך לרכיב — נפתח באותו חלון */
export function compOfConn(id: string | null | undefined): CompKind | null {
  if (!id) return null;
  if (/^C\.(BR\.W|BB\.|LT\.)/.test(id) && !/^C\.LTIE/.test(id)) return 'walls';
  if (/^C\.(KB|HN)\./.test(id)) return 'knee';
  return famOfConn(id);
}
export const compOfNav = (k: NavKey): CompKind | null => (k === 'b:walls' ? 'walls' : k === 'b:knee' ? 'knee' : famOfNav(k));

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

export function ComponentWindow({ kind, memberId, onClose, children, studio, step }: { kind: CompKind; memberId?: string; onClose: () => void; children?: ReactNode; /** 1.56: חלון במבנה האחיד (סוג → היקף → 3 כפתורים) — מחליף את התוכן והצד */ studio?: ReactNode; /** 1.59: שלב העבודה שהאישור משלים */ step?: string | null }) {
  const p = useStore((s) => s.project), d = useStore((s) => s.derived);
  const M = compMeta(kind);
  // 1.57: האשף פותח טרנזקציה — אישור = פעולת Undo אחת, ביטול = חזרה למצב שלפני
  useWizardTx(`אשף: ${M.title}`);
  const [wide, setWide] = useState(false);
  // 1.55.1: חלון צף מעל המודל — הזזה בגרירת הכותרת, מזעור לפס, הגדלה
  const [min, setMin] = useState(false);
  const [max, setMax] = useState(false);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const [side, setSide] = useState<'r' | 'l'>('r');
  useEffect(() => {
    if (!memberId) return; // ניקוי בחירה (לחיצה על שטח ריק) — החלון נשאר כמו שהוא (גם ממוזער)
    setMin(false);
    // נפתח מלחיצה במודל: אם הלחיצה בחצי הימני — החלון משמאל (ולהפך); גם המיקום הגרור מתאפס
    if (lastDown && Date.now() - lastDown.t < 1500) {
      const c = document.querySelector('.workspace > .center')?.getBoundingClientRect();
      if (c) { const s2 = lastDown.x > c.left + c.width / 2 ? 'l' : 'r'; if (s2 !== side) { setSide(s2); setOff({ x: 0, y: 0 }); } }
    }
  }, [memberId, kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const drag = (e: React.PointerEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest('button') || max) return;
    const x0 = e.clientX, y0 = e.clientY, o0 = off, el = e.currentTarget.closest('.cwin') as HTMLElement | null;
    const host = el?.parentElement?.getBoundingClientRect(), r0 = el?.getBoundingClientRect();
    const mv = (ev: PointerEvent) => {
      let x = o0.x + ev.clientX - x0, y = o0.y + ev.clientY - y0;
      if (host && r0) { x = Math.max(host.left - r0.left + o0.x, Math.min(host.right - r0.right + o0.x, x)); y = Math.max(host.top - r0.top + o0.y, Math.min(host.bottom - r0.top - 48 + o0.y, y)); }
      setOff({ x, y });
    };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  };
  // נפתח מלחיצה על אלמנט ועדיין לא נבחר היקף — ישר להגדרות הרכיב (בלי לשמור כהעדפה)
  useEffect(() => { if ((kind === 'walls' || kind === 'knee') && memberId && d.byId.has(memberId) && !store.state.propScope) store.set({ propScope: kind === 'knee' ? 'asm' : 'asmall' }); }, [memberId, kind]); // eslint-disable-line react-hooks/exhaustive-deps
  // חיבור פתוח (עורך החיבור) — התצוגה מתמקדת באלמנט של הרכיב שבחיבור
  const focusId = memberId && !d.byId.has(memberId) ? d.connById.get(memberId)?.members.find((x) => M.re.test(x)) : memberId;
  const set = useMemo(() => (studio ? null : kind === 'walls' ? wallSet(p, d, { memberId: focusId, whole: wide }) : kneeSet(p, d, { memberId: focusId, frame: wide })), [kind, p, d, focusId, wide, !!studio]); // eslint-disable-line react-hooks/exhaustive-deps
  const count = d.members.filter((m) => (M.re.test(m.id) || (((M as { kinds?: string[] }).kinds ?? []).includes(m.kind))) && !isPart(m)).length;
  const groups = useMemo(() => connGroups(d, M.re), [d, M.re]);
  const mainEnd = useMemo(() => { const m = d.members.find((x) => M.re.test(x.id) && !isPart(x)); return m ? `${m.id}|start` : null; }, [d, M.re]);
  const modes = <div className="seg-mini" role="group" aria-label="מה מוצג">
    <button className={wide ? '' : 'on'} onClick={() => setWide(false)} data-testid="live3d-near">{kind === 'walls' ? 'מפתח' : 'צומת'}</button>
    <button className={wide ? 'on' : ''} onClick={() => setWide(true)} data-testid="live3d-far">{kind === 'walls' ? 'כל הקיר' : 'מסגרת'}</button>
  </div>;
  return (
    <section className={`cwin cwin-${M.tint}${min ? ' min' : ''}${max ? ' max' : ''}${side === 'l' ? ' at-l' : ''}`} data-side={side} data-testid={`cwin-${kind}`} aria-label={M.title} style={max ? undefined : { transform: `translate(${off.x}px, ${off.y}px)` }}>
      <header className="cwin-h" onPointerDown={drag} onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest('button')) setMin(!min); }} title="גרירה מזיזה את החלון · לחיצה כפולה ממזערת">
        <span className="cwin-ic"><MenuPic name={M.pic} size={30} /></span>
        <div className="cwin-t"><small>{M.crumb} › {M.title}</small><b>{M.title}</b></div>
        <span className="cwin-pill" data-testid="cwin-count">{count ? `${count} אלמנטים` : 'לא בשימוש'}</span>
        <span className="sp" />
        <button className="cwin-x" onClick={() => setMin(!min)} title={min ? 'הצגת החלון' : 'מזעור — המודל כולו גלוי'} aria-label={min ? 'הצגת החלון' : 'מזעור החלון'} data-testid="cwin-min">{min ? '▢' : '–'}</button>
        <button className="cwin-x" onClick={() => { setMax(!max); setMin(false); }} title={max ? 'חזרה לחלון צף' : 'הגדלה'} aria-label={max ? 'חזרה לחלון צף' : 'הגדלת החלון'} data-testid="cwin-full">{max ? '⤡' : '⤢'}</button>
        <button className="cwin-x" onClick={onClose} title="סגירה — המודל במסך מלא" aria-label="סגירת החלון" data-testid="cwin-close">✕</button>
      </header>
      {studio && <div className="cwin-body cwin-studio" hidden={min}>{studio}</div>}
      {!min && !studio && <>
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
      </>}
      {!min && (studio ? <WizardActions label={`אשף: ${M.title}`} onClose={onClose} step={step} /> : <footer className="cwin-f"><i />כל שינוי מוצג מיד בתצוגה ובמודל · Ctrl+Z לביטול · גרירת הכותרת מזיזה את החלון</footer>)}
    </section>
  );
}
