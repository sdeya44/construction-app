import { setBuilding, setCleat, setKneeBraces, setPurlinSide } from '../commands/commands';
import { purlinParams } from '../geometry/purlins';
import { defaultKneeBraces } from '../geometry/knee';
import { defaultPortal } from '../geometry/portal';
import type { BraceConnParams, CleatParams, Member, OpeningDef, PortalBraceParams, PurlinSideParams, RidgeReinfParams } from '../model/types';
import { tryProfile } from '../profiles/library';
import { store, useStore } from '../store';
import { S, Schematic, type SDim } from './Schematic';

const rad = (a: number) => (a * Math.PI) / 180;

/** אגד B: עמודים, קורה ראשית, קורת אגד ושני אלכסונים — מרווח, ירידה וזווית לעריכה על השרטוט */
export function PortalSchematic({ invert }: { invert?: boolean } = {}) {
  const br = useStore((s) => s.project.building.bracing);
  const frames = useStore((s) => s.project.building.frames);
  const p = br.walls.portal ?? defaultPortal();
  const inv = invert ?? !!p.invert;
  const set = (patch: Partial<PortalBraceParams>) => store.exec(setBuilding({ bracing: { ...br, walls: { ...br.walls, portal: { ...p, ...patch } } } }));
  const fr = [...frames].sort((a, b) => a.y - b.y);
  const bay = fr.length > 1 ? fr[1].y - fr[0].y : 6000;
  const hb = tryProfile(p.beam)?.props.h ?? 100;
  const x0 = 24, x1 = 176, yTop = 16, yMain = 22;
  const gapV = 6 + Math.min(14, p.gap / 40), hbV = Math.max(3, Math.min(8, hb / 25));
  const dropV = Math.max(14, Math.min(40, p.drop / 25));
  const dx = dropV / Math.tan(rad(p.angle));
  // רגיל: קורה מתחת לקורה הראשית, אלכסונים יורדים לעמוד · הפוך: ראש האלכסון בעמוד מתחת לקורה הראשית, הקורה נמוכה ממנו ב-drop
  const yBt = yMain + gapV + (inv ? dropV : 0), yBb = yBt + hbV;
  const yC = inv ? yBt - dropV : yBb + dropV;
  const yR = inv ? yBt : yBb;
  const dims: SDim[] = [
    { a: [x1 + 2, yMain], b: [x1 + 2, inv ? yC : yBt], off: -8, value: p.gap, unit: '', testId: 'sch-pb-gap', onCommit: (v) => set({ gap: Math.max(0, v) }) },
    { a: [x0 - 2, yR], b: [x0 - 2, yC], off: 8, value: p.drop, testId: 'sch-pb-drop', min: 200, onCommit: (v) => set({ drop: Math.max(200, v) }) },
    { a: [0, 0], b: [0, 0], off: 0, value: p.angle, unit: '°', labelOnly: true, at: [x0 + dx * 0.55 + 9, inv ? yC + dropV * 0.45 + 4 : yC - dropV * 0.45], testId: 'sch-pb-angle', min: 20, max: 70, onCommit: (v) => set({ angle: v }) },
    { a: [x0, 108], b: [x1, 108], off: 0, value: bay, derived: true, text: `${Math.round(bay)} (מפתח)` },
  ];
  return (
    <Schematic w={200} h={118} dims={dims} testId="sch-portal" caption={`לחיצה על מידה מסומנת ✎ לשינוי · חל על כל אגדי B בפרויקט${inv ? ' · הפוך: אלכסונים עולים' : ''}`}>
      {S.bar([x0, yTop], [x0, 104])}{S.bar([x1, yTop], [x1, 104])}
      {S.bar([x0 - 6, yMain - 3], [x1 + 6, yMain - 3], 'sm-main', 5)}
      {S.text([100, yMain - 8], 'קורה ראשית / ראש עמוד', 'sm-lbl-s')}
      <rect x={x0 + 1.5} y={yBt} width={x1 - x0 - 3} height={yBb - yBt} className="sm-plate" />
      {S.text([100, yBt + (yBb - yBt) / 2], `קורת אגד ${p.beam}`, 'sm-lbl')}
      {S.bar([x0 + 1.5, yC], [x0 + 1.5 + dx, yR], 'sm-hi', 2.2)}{S.bar([x1 - 1.5, yC], [x1 - 1.5 - dx, yR], 'sm-hi', 2.2)}
      <g data-testid={inv ? 'sch-pb-up' : 'sch-pb-down'}>{S.text([x1 - dx - 10, inv ? yC + dropV * 0.6 : yC - dropV * 0.4], `אלכסון ${p.brace}`, 'sm-lbl-s', 'end')}</g>
    </Schematic>
  );
}

/** אלכסון עמוד-קורה: ירידה על העמוד וזווית (או מרחק) — לעריכה על השרטוט; אורך מחושב מהמודל */
export function KneeSchematic() {
  const kb = useStore((s) => s.project.building.kneeBraces) ?? defaultKneeBraces();
  const d = useStore((s) => s.derived);
  const set = (patch: Parameters<typeof setKneeBraces>[0]) => store.exec(setKneeBraces(patch));
  const k1 = d.members.find((m) => m.id.startsWith('KB.'));
  const L = k1 ? Math.round(Math.hypot(k1.end.x - k1.start.x, k1.end.y - k1.start.y, k1.end.z - k1.start.z)) : null;
  const xc = 40, yR0 = 30, slope = 0.1;
  const yR = (x: number) => yR0 - (x - xc) * slope;
  const dropV = Math.max(18, Math.min(50, kb.drop / 18));
  const angle = kb.angle ?? 45, angleMode = (kb.mode ?? 'angle') === 'angle';
  const yC = yR(xc) + 6 + dropV;
  // נקודה על תחתית הקורה
  let xr = xc + (angleMode ? dropV / Math.tan(rad(angle)) : Math.min(120, kb.reach / 12));
  for (let i = 0; i < 4; i++) xr = xc + 4 + (yC - (yR(xr) + 6)) / Math.tan(rad(angleMode ? angle : 40));
  const dims: SDim[] = [
    { a: [xc - 5, yR(xc) + 6], b: [xc - 5, yC], off: 9, value: kb.drop, testId: 'sch-kb-drop', onCommit: (v) => set({ drop: v }) },
    angleMode
      ? { a: [0, 0], b: [0, 0], off: 0, value: angle, unit: '°', labelOnly: true, at: [xc + 22, yC - 6], testId: 'sch-kb-angle', min: 15, max: 75, onCommit: (v) => set({ angle: v }) }
      : { a: [xc, yC + 8], b: [xr, yC + 8], off: -4, value: kb.reach, testId: 'sch-kb-reach', onCommit: (v) => set({ reach: v }) },
    ...(L ? [{ a: [0, 0], b: [0, 0], off: 0, value: L, labelOnly: true, derived: true, at: [(xc + xr) / 2 + 22, (yC + yR(xr)) / 2 + 12], text: `אורך ${L}` } as SDim] : []),
  ];
  return (
    <Schematic w={200} h={110} dims={dims} testId="sch-knee" caption="ירידה וזווית — חל על כל האלכסונים (חריגים בטבלה 'לכל צד')">
      {S.bar([xc, 104], [xc, yR(xc) - 2], 'sm-main', 7)}
      <polygon points={`${xc - 3},${yR(xc - 3)} 195,${yR(195)} 195,${yR(195) + 6} ${xc - 3},${yR(xc - 3) + 6}`} className="sm-plate" />
      {S.text([150, yR(150) + 3], 'קורת גג', 'sm-lbl-s')}
      {S.text([xc - 6, 90], 'עמוד', 'sm-lbl-s', 'end')}
      {S.bar([xc + 4, yC], [xr, yR(xr) + 6], 'sm-hi', 3)}
      {S.text([(xc + xr) / 2 + 4, (yC + yR(xr)) / 2 + 3], kb.profile, 'sm-lbl', 'start')}
    </Schematic>
  );
}

// ======================================================================== פטות ושיפוע
/** שיפוע הגג עם הפטות במיקומן בפועל: מרחק ראשון, מרווח, מרווח אחרון מקצה הקורה — בלחיצה */
export function PurlinSlopeSchematic({ side, items, mono }: { side: string; items: Member[]; mono: boolean }) {
  const pu = useStore((s) => s.project.building.purlins);
  const prm = purlinParams(pu, side);
  const set = (patch: Partial<PurlinSideParams>) => store.exec(setPurlinSide(side, patch));
  const ss = [...new Set(items.map((m) => Math.round(m.purlin!.sSlope)))].sort((a, b) => a - b);
  if (!ss.length) return null;
  const L = ss[ss.length - 1] + Math.max(prm.edgeOffset, 0) + 120;
  const xA = 170, xB = 22, yA = 30, yB = 66; // התחלה (רכס/קצה) מימין למעלה ← סוף משמאל למטה
  const P = (s: number): [number, number] => [xA + ((xB - xA) * s) / L, yA + ((yB - yA) * s) / L];
  const even = (prm.layout ?? 'fixed') === 'even';
  const dims: SDim[] = [
    { a: P(0), b: P(ss[0]), off: -17, value: prm.first, testId: `sch-${side}-s0`, onCommit: (v) => set({ first: v }) },
    ...(ss.length > 1 ? [{ a: P(ss[0]), b: P(ss[1]), off: -9, value: even ? prm.spacing : ss[1] - ss[0], text: `${Math.round(even ? prm.spacing : ss[1] - ss[0])}${even ? ' (מרבי)' : ''}`, testId: `sch-${side}-s1`, onCommit: (v: number) => set({ spacing: v }) } as SDim] : []),
    { a: P(ss[ss.length - 1]), b: P(L - 120 + 120), off: -9, value: prm.edgeOffset, text: `${Math.round(prm.edgeOffset)} (שפה)`, testId: `sch-${side}-s2`, onCommit: (v) => set({ edgeOffset: v }) },
    { a: [0, 0], b: [0, 0], off: 0, value: ss.length, labelOnly: true, derived: true, at: [100, 92], text: `${ss.length} פטות · ${prm.profile}` },
  ];
  return (
    <Schematic w={200} h={100} dims={dims} testId={`sch-purlins-${side}`} caption={`${mono ? 'מקצה ההתחלה' : 'מהרכס'} לקצה הקורה · לחיצה על מידה ✎`}>
      <line x1={P(0)[0]} y1={P(0)[1] + 3} x2={P(L)[0]} y2={P(L)[1] + 3} className="sm-main" strokeWidth={5} />
      {ss.map((s, i) => { const [x, y] = P(s); return <rect key={i} x={x - 2.2} y={y - 4} width={4.4} height={6} className="sm-plate" />; })}
      {S.text([P(0)[0] + 2, P(0)[1] - 6], mono ? 'התחלה' : 'רכס', 'sm-lbl-s', 'end')}
      {S.text([P(L)[0] - 1, P(L)[1] + 10], 'קצה הקורה', 'sm-lbl-s', 'start')}
    </Schematic>
  );
}

/** תומך פטה (זוויתן L): חזית — גובה ורגל בסיס; מבט על — רוחב, ברגים ומרווח */
export function CleatSchematic({ side }: { side: string }) {
  const pu = useStore((s) => s.project.building.purlins);
  const prm = purlinParams(pu, side);
  const c = prm.cleat;
  const set = (patch: Partial<CleatParams>) => store.exec(setCleat(side, patch));
  const ph = tryProfile(prm.profile)?.props.h ?? 200;
  const H = c.height ?? ph;
  const k = 46 / Math.max(H, c.base, 1);
  // חזית
  const x0 = 40, yb = 74;
  const hV = H * k, bV = c.base * k, tV = Math.max(1.6, c.thickness * k);
  // מבט על
  const kx = 70 / Math.max(c.width, 1);
  const px0 = 118, py = 40, wV = c.width * kx;
  const bolts = Array.from({ length: c.perRow }, (_, i) => px0 + wV / 2 + (i - (c.perRow - 1) / 2) * c.pitch * kx);
  const dims: SDim[] = [
    c.height === null
      ? { a: [x0 - 4, yb], b: [x0 - 4, yb - hV], off: 6, value: H, derived: true, text: `= גובה הפטה ${Math.round(ph)}` }
      : { a: [x0 - 4, yb], b: [x0 - 4, yb - hV], off: 6, value: c.height, testId: `sch-${side}-cl-h`, onCommit: (v) => set({ height: v }) },
    { a: [x0, yb + 3], b: [x0 + bV, yb + 3], off: -6, value: c.base, testId: `sch-${side}-cl-base`, onCommit: (v) => set({ base: v }) },
    { a: [px0, py + 22], b: [px0 + wV, py + 22], off: -6, value: c.width, testId: `sch-${side}-cl-w`, onCommit: (v) => set({ width: v }) },
    ...(c.perRow > 1 ? [{ a: [bolts[0], py - 6], b: [bolts[1], py - 6], off: 5, value: c.pitch, testId: `sch-${side}-cl-pitch`, onCommit: (v: number) => set({ pitch: v }) } as SDim] : []),
    { a: [0, 0], b: [0, 0], off: 0, value: c.thickness, labelOnly: true, at: [x0 + tV + 12, yb - hV / 2], text: `t=${c.thickness}`, testId: `sch-${side}-cl-t`, onCommit: (v) => set({ thickness: v }) },
  ];
  return (
    <>
      <Schematic w={200} h={96} dims={dims} testId={`sch-cleat-${side}`} caption="חזית (גובה, בסיס, עובי) · מבט על (רוחב, ברגים) — לחיצה על מידה ✎">
        <line x1={10} y1={yb + 1} x2={96} y2={yb + 1} className="sm-main" strokeWidth={3} />
        {S.text([70, yb + 9], 'אגף עליון קורת הגג', 'sm-lbl-s')}
        <polygon points={`${x0},${yb} ${x0},${yb - hV} ${x0 + tV},${yb - hV} ${x0 + tV},${yb - tV} ${x0 + bV},${yb - tV} ${x0 + bV},${yb}`} className="sm-plate" />
        <polyline points={`${x0 - 1 - 9},${yb - hV} ${x0 - 1},${yb - hV} ${x0 - 1},${yb - 1} ${x0 - 1 - 9},${yb - 1}`} className="sm-thin" />
        {S.text([x0 - 12, yb - hV - 4], prm.profile, 'sm-lbl-s', 'end')}
        <rect x={px0} y={py} width={wV} height={14} className="sm-plate" />
        {bolts.map((x, i) => <g key={i}>{S.bolt([x, py + 7], 1.8)}</g>)}
        {S.text([px0 + wV / 2, py + 34], `${c.perRow} × M${c.bolt.d}`, 'sm-lbl-s')}
      </Schematic>
      <div className="row" style={{ gap: 6, margin: '-4px 0 6px' }}>
        <span className="hint">ברגים בשורה:</span>
        <button className="btn small" data-testid={`sch-${side}-cl-n-`} onClick={() => c.perRow > 1 && set({ perRow: c.perRow - 1 })}>−</button><b>{c.perRow}</b>
        <button className="btn small" data-testid={`sch-${side}-cl-n+`} onClick={() => set({ perRow: c.perRow + 1 })}>+</button>
        {c.height === null ? <button className="btn small" onClick={() => set({ height: Math.round(ph) })}>גובה ידני</button> : <button className="btn small" onClick={() => set({ height: null })}>גובה = הפטה</button>}
      </div>
    </>
  );
}

// ======================================================================== חיזוק רכס
export function RidgeSchematic() {
  const rr = useStore((s) => s.project.building.ridgeReinf);
  if (!rr || rr.type === 'none') return null;
  const set = (patch: Partial<RidgeReinfParams>) => store.exec(setBuilding({ ridgeReinf: { ...rr, ...patch } }));
  const xc = 100, yApex = 20, slope = 0.18, hR = 10;
  const yU = (x: number) => yApex + Math.abs(x - xc) * slope + hR;
  const lenV = Math.min(80, 30 + rr.length / 15), depV = Math.min(30, 8 + rr.depth / 12);
  const dims: SDim[] = rr.type === 'plate'
    ? [
      { a: [xc + 2, yU(xc)], b: [xc + 2, yU(xc) + depV], off: -7, value: rr.depth, testId: 'sch-rr-depth', onCommit: (v) => set({ depth: v }) },
      { a: [xc, yU(xc) + depV + 4], b: [xc + lenV, yU(xc) + depV + 4], off: -6, value: rr.length, testId: 'sch-rr-len', onCommit: (v) => set({ length: v }) },
      { a: [0, 0], b: [0, 0], off: 0, value: rr.stiffT, labelOnly: true, at: [xc - lenV / 2 - 6, yU(xc - lenV / 2) + 10], text: `t=${rr.stiffT}`, testId: 'sch-rr-t', onCommit: (v) => set({ stiffT: v }) },
    ]
    : [{ a: [xc + 30, yU(xc + 30)], b: [xc + 30, yU(xc) + 4 + rr.tieGap / 25], off: -8, value: rr.tieGap, testId: 'sch-rr-gap', onCommit: (v) => set({ tieGap: v }) }];
  const yTie = yU(xc) + 4 + rr.tieGap / 25;
  return (
    <Schematic w={200} h={92} dims={dims} testId="sch-ridge" caption="חיזוק הרכס — לחיצה על מידה ✎">
      <polygon points={`${10},${yU(10) - hR} ${xc},${yApex} ${190},${yU(190) - hR} ${190},${yU(190)} ${xc},${yApex + hR} ${10},${yU(10)}`} className="sm-plate" />
      {rr.type === 'plate' && <>
        <polygon points={`${xc},${yU(xc)} ${xc + lenV},${yU(xc + lenV)} ${xc},${yU(xc) + depV}`} className="sm-host" />
        <polygon points={`${xc},${yU(xc)} ${xc - lenV},${yU(xc - lenV)} ${xc},${yU(xc) + depV}`} className="sm-host" />
        <line x1={xc} y1={yApex} x2={xc} y2={yU(xc) + depV} className="sm-main" strokeWidth={1.5} />
      </>}
      {rr.type === 'tie' && <>
        <line x1={xc - 70} y1={yTie} x2={xc + 70} y2={yTie} className="sm-hi" strokeWidth={3} />
        {S.text([xc, yTie + 8], rr.tieProfile, 'sm-lbl')}
      </>}
    </Schematic>
  );
}

// ======================================================================== קושרות X — פח החיבור
export function GussetSchematic() {
  const br = useStore((s) => s.project.building.bracing);
  const c = br.conn;
  const set = (patch: Partial<BraceConnParams>) => store.exec(setBuilding({ bracing: { ...br, conn: { ...c, ...patch } } }));
  const n = c.boltsPerEnd;
  const k = 0.55;
  const ang = -0.6; // כיוון האלכסון
  const ux = Math.cos(ang), uy = Math.sin(ang);
  const x0 = 46, y0 = 70; // קצה הזוויתן
  const bp = (i: number): [number, number] => [x0 + ux * (c.endDist + i * c.pitch) * k, y0 + uy * (c.endDist + i * c.pitch) * k];
  const last = bp(n - 1);
  const plate: [number, number][] = [[20, 84], [20, y0 - 10 - (n - 1) * c.pitch * k * 0.6 - 20], [last[0] + c.gussetEdge * k + 10, last[1] - 10], [last[0] + c.gussetEdge * k + 14, 84]];
  const dims: SDim[] = [
    { a: [x0, y0], b: bp(0), off: -8, value: c.endDist, testId: 'sch-brc-end', onCommit: (v) => set({ endDist: v }) },
    ...(n > 1 ? [{ a: bp(0), b: bp(1), off: -8, value: c.pitch, testId: 'sch-brc-pitch', onCommit: (v: number) => set({ pitch: v }) } as SDim] : []),
    { a: last, b: [last[0] + c.gussetEdge * k * ux * 1.2, last[1] + c.gussetEdge * k * uy * 1.2], off: 8, value: c.gussetEdge, testId: 'sch-brc-edge', onCommit: (v) => set({ gussetEdge: v }) },
    { a: [0, 0], b: [0, 0], off: 0, value: c.gussetT, labelOnly: true, at: [32, 80], text: `t=${c.gussetT}`, testId: 'sch-brc-t', onCommit: (v) => set({ gussetT: v }) },
  ];
  return (
    <>
      <Schematic w={200} h={96} dims={dims} testId="sch-gusset" caption="פח חיבור קושרת: מרחק קצה, מרווח ברגים, שפת פח, עובי — לחיצה ✎">
        <line x1={14} y1={88} x2={14} y2={4} className="sm-main" strokeWidth={6} />
        {S.text([10, 10], 'עמוד/קורה', 'sm-lbl-s', 'start')}
        {S.plate(plate)}
        <line x1={x0} y1={y0} x2={x0 + ux * 260} y2={y0 + uy * 260} className="sm-sec" strokeWidth={7} opacity={0.75} />
        {Array.from({ length: n }, (_, i) => <g key={i}>{S.bolt(bp(i), 2)}</g>)}
        {S.text([150, 22], `${br.roof.profile} / ${br.walls.profile}`, 'sm-lbl-s')}
      </Schematic>
      <div className="row" style={{ gap: 6, margin: '-4px 0 6px' }}>
        <span className="hint">ברגים בכל קצה:</span>
        <button className="btn small" data-testid="sch-brc-n-" onClick={() => n > 1 && set({ boltsPerEnd: n - 1 })}>−</button><b>{n}</b>
        <button className="btn small" data-testid="sch-brc-n+" onClick={() => set({ boltsPerEnd: n + 1 })}>+</button>
        <span className="hint">M{c.bolt.d}</span>
      </div>
    </>
  );
}

// ======================================================================== מפתחים (קושרות גג/קיר)
/** שורת מפתחים בתוכנית/חזית: לחיצה על מפתח מוסיפה/מסירה X */
export function BaysSchematic({ count, bays, onChange, label, testId }: { count: number; bays: number[]; onChange: (b: number[]) => void; label: string; testId: string }) {
  const sel = new Set(bays);
  const W = 200, x0 = 8, x1 = 192, y0 = 12, y1 = 40;
  const bw = (x1 - x0) / Math.max(count, 1);
  return (
    <div className="schem" data-testid={testId}>
      <svg viewBox={`0 0 ${W} 52`} role="img" aria-label={label}>
        {Array.from({ length: count }, (_, i) => {
          const a = x0 + i * bw, b = a + bw, on = sel.has(i);
          return (
            <g key={i} className="bay-cell" data-testid={`${testId}-${i}`} onClick={() => { const n = new Set(sel); if (on) n.delete(i); else n.add(i); onChange([...n].sort((p, q) => p - q)); }}>
              <rect x={a} y={y0} width={bw} height={y1 - y0} className={on ? 'bay on' : 'bay'} />
              {on && <><line x1={a + 1} y1={y0 + 1} x2={b - 1} y2={y1 - 1} className="sm-hi" strokeWidth={1.4} /><line x1={a + 1} y1={y1 - 1} x2={b - 1} y2={y0 + 1} className="sm-hi" strokeWidth={1.4} /></>}
              <text x={(a + b) / 2} y={y1 + 8} className="sm-lbl-s" textAnchor="middle">{i + 1}</text>
            </g>
          );
        })}
        {Array.from({ length: count + 1 }, (_, i) => <line key={i} x1={x0 + i * bw} y1={y0 - 3} x2={x0 + i * bw} y2={y1 + 2} className="sm-main" strokeWidth={1.4} />)}
        <text x={W / 2} y={8} className="sm-lbl-s" textAnchor="middle">{label} — לחיצה על מפתח מוסיפה/מסירה</text>
      </svg>
    </div>
  );
}

// ======================================================================== חיפוי קיר
export function WallCladSchematic({ n, bays, bottom, top, eave, onBays, onBottom, onTop, testId, labelOf }: {
  n: number; bays: boolean[]; bottom: number; top: number | null; eave: number;
  onBays: (b: boolean[]) => void; onBottom: (v: number) => void; onTop: (v: number | null) => void; testId: string; labelOf: (i: number) => string;
}) {
  const x0 = 26, x1 = 190, yG = 84, yE = 14;
  const k = (yG - yE) / Math.max(eave, 1);
  const Y = (z: number) => yG - z * k;
  const bw = (x1 - x0) / Math.max(n, 1);
  const zt = top ?? eave;
  const dims: SDim[] = [
    { a: [x0 - 4, yG], b: [x0 - 4, Y(bottom)], off: 6, value: bottom, testId: `${testId}-bottom`, onCommit: onBottom },
    top === null
      ? { a: [x1 + 3, yG], b: [x1 + 3, Y(eave)], off: -6, value: eave, derived: true, text: `${Math.round(eave)} (עד הגג)` }
      : { a: [x1 + 3, yG], b: [x1 + 3, Y(zt)], off: -6, value: zt, testId: `${testId}-top`, onCommit: (v) => onTop(v) },
  ];
  return (
    <Schematic w={210} h={100} dims={dims} testId={testId} caption="לחיצה על מפתח — מחופה/פתוח · מידות ✎ תחתית וראש החיפוי">
      <line x1={x0 - 6} y1={yG} x2={x1 + 6} y2={yG} className="sm-main" strokeWidth={1} />
      {Array.from({ length: n }, (_, i) => {
        const a = x0 + i * bw;
        return (
          <g key={i} className="bay-cell" data-testid={`${testId}-bay-${i}`} onClick={() => onBays(bays.map((x, j) => (j === i ? !x : x)))}>
            <rect x={a + 1} y={Y(zt)} width={bw - 2} height={Y(bottom) - Y(zt)} className={bays[i] ? 'bay on clad' : 'bay'} />
            <text x={a + bw / 2} y={yG + 8} className="sm-lbl-s" textAnchor="middle">{labelOf(i)}</text>
          </g>
        );
      })}
      {Array.from({ length: n + 1 }, (_, i) => <line key={i} x1={x0 + i * bw} y1={yE} x2={x0 + i * bw} y2={yG} className="sm-main" strokeWidth={2} />)}
      <line x1={x0} y1={yE} x2={x1} y2={yE} className="sm-main" strokeWidth={2} />
      <g className="bay-cell" onClick={() => onTop(top === null ? Math.round(eave * 0.6) : null)}><text x={x0 + 2} y={yE - 4} className="sm-lbl-s">{top === null ? 'עד הגג (לחץ לגובה חלקי)' : 'גובה חלקי (לחץ עד הגג)'}</text></g>
    </Schematic>
  );
}

// ======================================================================== פתחים בקיר
/** חזית קיר עם הפתחים: לחיצה על פתח בוחרת; מיקום, רוחב, גובה ואדן — בלחיצה על המידה */
export function OpeningsSchematic({ wall, len, eave, ticks, ops, sel, onSel, setOp, testId }: {
  wall: string; len: number; eave: number; ticks: number[];
  ops: { i: number; o: OpeningDef }[]; sel: number | null; onSel: (i: number) => void; setOp: (i: number, patch: Partial<OpeningDef>) => void; testId: string;
}) {
  const x0 = 14, x1 = 196, yG = 86, yE = 16;
  const kx = (x1 - x0) / Math.max(len, 1), kz = (yG - yE) / Math.max(eave, 1);
  const X = (p: number) => x0 + p * kx, Y = (z: number) => yG - z * kz;
  const cur = ops.find((q) => q.i === sel)?.o;
  const dims: SDim[] = cur ? [
    { a: [X(0), yG + 2], b: [X(cur.pos), yG + 2], off: -7, value: cur.pos, testId: `${testId}-pos`, onCommit: (v) => setOp(sel!, { pos: v }) },
    { a: [X(cur.pos), Y(cur.sill + cur.height)], b: [X(cur.pos + cur.width), Y(cur.sill + cur.height)], off: 6, value: cur.width, testId: `${testId}-w`, onCommit: (v) => setOp(sel!, { width: v }) },
    { a: [X(cur.pos + cur.width), Y(cur.sill)], b: [X(cur.pos + cur.width), Y(cur.sill + cur.height)], off: -6, value: cur.height, testId: `${testId}-h`, onCommit: (v) => setOp(sel!, { height: v }) },
    { a: [X(cur.pos) - 2, yG], b: [X(cur.pos) - 2, Y(cur.sill)], off: 6, value: cur.sill, text: cur.sill > 0 ? `${Math.round(cur.sill)} (אדן)` : '0 (שער)', testId: `${testId}-sill`, onCommit: (v) => setOp(sel!, { sill: Math.max(0, v) }) },
  ] : [];
  return (
    <Schematic w={210} h={104} dims={dims} testId={testId} caption={`${WALL_HE_S[wall] ?? wall}: לחיצה על פתח לבחירה · מידות ✎ (מיקום מתחילת הקיר, רוחב, גובה, אדן)`}>
      <rect x={x0} y={yE} width={x1 - x0} height={yG - yE} className="bay on clad" />
      {ticks.map((t, k) => <line key={k} x1={X(t)} y1={yE} x2={X(t)} y2={yG} className="sm-main" strokeWidth={1.6} />)}
      <line x1={x0 - 4} y1={yG} x2={x1 + 4} y2={yG} className="sm-main" strokeWidth={1} />
      {ops.map(({ i, o }) => (
        <g key={i} className="bay-cell" data-testid={`${testId}-op-${i}`} onClick={() => onSel(i)}>
          <rect x={X(o.pos)} y={Y(o.sill + o.height)} width={o.width * kx} height={o.height * kz} className={i === sel ? 'op-r sel' : 'op-r'} />
          <text x={X(o.pos + o.width / 2)} y={Y(o.sill + o.height / 2)} className="sm-lbl-s" textAnchor="middle" dominantBaseline="middle">{o.label ?? o.id}</text>
        </g>
      ))}
    </Schematic>
  );
}
const WALL_HE_S: Record<string, string> = { L: 'קיר שמאל', R: 'קיר ימין', F: 'קיר חזית', B: 'קיר אחורי' };
