import { setBuilding, setCleat, setKneeBraces, setPurlinSide } from '../commands/commands';
import { purlinParams } from '../geometry/purlins';
import { defaultKneeBraces } from '../geometry/knee';
import { defaultPortal } from '../geometry/portal';
import type { BraceConnParams, CleatParams, LockTrussParams, Member, OpeningDef, PortalBraceParams, PurlinSideParams, PurlinSpliceParams, RidgeReinfParams } from '../model/types';
import { tryProfile } from '../profiles/library';
import { store, useStore } from '../store';
import { S, Schematic, type SDim } from './Schematic';

const rad = (a: number) => (a * Math.PI) / 180;

/** אגד B: עמודים, קורה ראשית, קורת אגד ושני אלכסונים — מרווח, ירידה וזווית לעריכה על השרטוט */
export function PortalSchematic({ invert, params, onSet }: { invert?: boolean; params?: PortalBraceParams; onSet?: (patch: Partial<PortalBraceParams>) => void } = {}) {
  const br = useStore((s) => s.project.building.bracing);
  const frames = useStore((s) => s.project.building.frames);
  const p = params ?? br.walls.portal ?? defaultPortal();
  const inv = invert ?? !!p.invert;
  const set = onSet ?? ((patch: Partial<PortalBraceParams>) => store.exec(setBuilding({ bracing: { ...br, walls: { ...br.walls, portal: { ...p, ...patch } } } })));
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
    <Schematic w={200} h={118} dims={dims} testId="sch-portal" caption={`לחיצה על מידה מסומנת ✎ לשינוי${params ? '' : ' · חל על כל אגדי B בפרויקט'}${inv ? ' · הפוך: אלכסונים עולים' : ''}`}>
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

/** נעילה אופקית (מסבך RHS בין העמודים): מרווח, גובה, מרחק לצומת ראשון ומספר אלכסונים — עריכה על השרטוט */
export function LockTrussSchematic({ p, set }: { p: LockTrussParams; set: (patch: Partial<LockTrussParams>) => void }) {
  const frames = useStore((s) => s.project.building.frames);
  const fr = [...frames].sort((a, b) => a.y - b.y);
  const bay = fr.length > 1 ? fr[1].y - fr[0].y : 6000;
  const H = Math.max(300, p.height);
  const x0 = 24, x1 = 176, yMain = 20;
  const gapV = 6 + Math.min(14, p.gap / 40), hV = Math.max(18, Math.min(46, H / 30));
  const yTopC = yMain + gapV, yBotC = yTopC + hV;
  const ySec = p.position === 'above' ? yTopC : yBotC, yCont = p.position === 'above' ? yBotC : yTopC;
  const ec = p.endClear ?? 0;
  const ecV = ec > 0 ? Math.min(40, ec / 25) : 10;
  // אלכסונים W: מספר אוטומטי לזווית ~50°
  const n = p.diags > 0 ? p.diags : Math.max(2, Math.round(((bay - 2 * (ec || 250)) / H) * Math.tan((40 * Math.PI) / 180)) * 2 / 2);
  const a0 = x0 + ecV, a1 = x1 - ecV;
  const nodes = Array.from({ length: n + 1 }, (_, i) => a0 + ((a1 - a0) * i) / n);
  const dims: SDim[] = [
    { a: [x1 + 2, yMain], b: [x1 + 2, yTopC], off: -8, value: p.gap, testId: 'sch-lt-gap', onCommit: (v) => set({ gap: Math.max(0, v) }) },
    { a: [x0 - 2, yTopC], b: [x0 - 2, yBotC], off: 8, value: H, testId: 'sch-lt-height', min: 300, onCommit: (v) => set({ height: Math.max(300, v) }) },
    { a: [x0, yBotC + 9], b: [a0, yBotC + 9], off: 0, value: ec, text: ec > 0 ? `${Math.round(ec)}` : 'אוטו׳', testId: 'sch-lt-end', min: 0, onCommit: (v) => set({ endClear: Math.max(0, v) }) },
    { a: [0, 0], b: [0, 0], off: 0, value: p.diags, labelOnly: true, at: [100, yBotC + 22], text: p.diags > 0 ? `${p.diags} אלכסונים` : 'אלכסונים: אוטו׳', testId: 'sch-lt-diags', min: 0, onCommit: (v) => set({ diags: Math.max(0, Math.round(v)) }) },
    { a: [x0, 108], b: [x1, 108], off: 0, value: bay, derived: true, text: `${Math.round(bay)} (מפתח)` },
  ];
  return (
    <Schematic w={200} h={118} dims={dims} testId="sch-lock" caption="לחיצה על מידה ✎ — מרווח מתחת לקורה, גובה המסבך, מרחק מהעמוד לצומת הראשון, מספר אלכסונים (0 = אוטו׳)">
      {S.bar([x0, 12], [x0, 104])}{S.bar([x1, 12], [x1, 104])}
      {S.bar([x0 - 6, yMain - 3], [x1 + 6, yMain - 3], 'sm-main', 5)}
      {S.text([100, yMain - 9], 'קורה ראשית / ראש עמוד', 'sm-lbl-s')}
      {S.bar([x0 + 1.5, yCont], [x1 - 1.5, yCont], 'sm-plate', 4)}
      {S.bar([x0 + 1.5, ySec], [x1 - 1.5, ySec], 'sm-plate', 4)}
      {nodes.slice(0, -1).map((x, i) => S.bar([x, i % 2 ? yTopC : yBotC], [nodes[i + 1], i % 2 ? yBotC : yTopC], 'sm-hi', 1.8))}
      {S.text([100, yCont + (p.position === 'above' ? 7 : -6)], `סיב רציף ${p.chord}`, 'sm-lbl-s')}
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
  const W = 300, xA = 268, xB = 26, yA = 30, yB = 48; // התחלה (רכס/קצה) מימין למעלה ← סוף משמאל למטה
  const P = (s: number): [number, number] => [xA + ((xB - xA) * s) / L, yA + ((yB - yA) * s) / L];
  const even = (prm.layout ?? 'fixed') === 'even';
  const manual = !!prm.manualPositions;
  const n = ss.length;
  const all = n <= 12;
  // כל מרווח על השרטוט (1.34): לחיצה — מרווח רגיל (פריסה אוטומטית) או הזזת הפטה וכל מה שאחריה (פריסה ידנית)
  const gapDim = (i: number): SDim => {
    const v = ss[i + 1] - ss[i];
    const rem = !even && !manual && i === n - 2 && Math.abs(v - prm.spacing) > 0.5;
    return {
      a: P(ss[i]), b: P(ss[i + 1]), off: i % 2 ? 9 : -24, value: manual ? v : even ? v : rem ? v : prm.spacing,
      text: `${Math.round(v)}${rem ? ' שארית' : ''}`, testId: `sch-${side}-g${i}`,
      onCommit: (nv: number) => {
        if (manual) { const d0 = nv - v, arr = prm.manualPositions!.map((x, j) => (j > i ? x + d0 : x)); set({ manualPositions: arr }); }
        else set({ spacing: nv });
      },
    };
  };
  const dims: SDim[] = [
    { a: P(0), b: P(ss[0]), off: 9, value: prm.first, testId: `sch-${side}-s0`, onCommit: (v) => (manual ? set({ manualPositions: prm.manualPositions!.map((x) => x + v - ss[0]) }) : set({ first: v })) },
    ...(n > 1 && !all ? [{ a: P(ss[0]), b: P(ss[1]), off: -9, value: prm.spacing, text: `${Math.round(even ? prm.spacing : ss[1] - ss[0])}${even ? ' (מרבי)' : ''}`, testId: `sch-${side}-s1`, onCommit: (v: number) => set({ spacing: v }) } as SDim] : []),
    ...(all ? ss.slice(0, -1).map((_, i) => gapDim(i)) : n > 2 ? [gapDim(n - 2)] : []),
    { a: P(ss[n - 1]), b: P(L), off: (all ? n - 1 : 1) % 2 ? 9 : -24, value: prm.edgeOffset, text: `${Math.round(prm.edgeOffset)} (שפה)`, testId: `sch-${side}-s2`, onCommit: (v) => set({ edgeOffset: v }) },
    { a: [0, 0], b: [0, 0], off: 0, value: n, labelOnly: true, derived: true, at: [150, 94], text: `${n} פטות · ${prm.profile}${manual ? ' · פריסה ידנית' : even ? ' · מרווחים שווים' : ''}` },
  ];
  return (
    <Schematic w={W} h={100} dims={dims} testId={`sch-purlins-${side}`} caption={`${mono ? 'מקצה ההתחלה' : 'מהרכס'} לקצה הקורה, מ"מ ${prm.measure === 'horizontal' ? 'בהיטל אופקי' : 'לאורך השיפוע'} · לחיצה על מרווח ✎ — ${manual ? 'מזיזה את הפטה וכל מה שאחריה' : even ? 'מרווח מרבי' : 'מרווח רגיל לכל הפטות'}`}>
      <line x1={P(0)[0]} y1={P(0)[1] + 3} x2={P(L)[0]} y2={P(L)[1] + 3} className="sm-main" strokeWidth={5} />
      {ss.map((s2, i) => { const [x, y] = P(s2); return <rect key={i} x={x - 2.2} y={y - 4} width={4.4} height={6} className="sm-plate" />; })}
      {S.text([P(0)[0] + 2, P(0)[1] - 7], mono ? 'התחלה' : 'רכס', 'sm-lbl-s', 'end')}
      {S.text([P(L)[0] - 1, P(L)[1] - 10], 'קצה הקורה', 'sm-lbl-s', 'start')}
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
export function WallCladSchematic({ n, bays, bottom, top, eave, onBays, onBottom, onTop, testId, labelOf, girts, onGirts, posts, onPosts }: {
  n: number; bays: boolean[]; bottom: number; top: number | null; eave: number;
  onBays: (b: boolean[]) => void; onBottom: (v: number) => void; onTop: (v: number | null) => void; testId: string; labelOf: (i: number) => string;
  /** פטות קיר (1.35): קווים בחזית, מידות ראשונה ומרווח */
  girts?: { first: number; spacing: number }; onGirts?: (patch: { first?: number; spacing?: number }) => void;
  /** עמודי רוח בקיר קצה: רוחב כל מפתח (מ"מ) ומרווח מרבי */
  posts?: { bayW: number[]; maxSpacing: number }; onPosts?: (maxSpacing: number) => void;
}) {
  const x0 = 34, x1 = 186, yG = 88, yE = 24;
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
  const gz: number[] = [];
  if (girts && girts.spacing > 50) for (let z = girts.first; z <= zt - 50 && gz.length < 40; z += girts.spacing) gz.push(z);
  if (girts && onGirts && gz.length) {
    dims.push({ a: [x0 - 17, yG], b: [x0 - 17, Y(gz[0])], off: 0, value: girts.first, text: `${Math.round(girts.first)}`, testId: `${testId}-g-first`, min: 0, onCommit: (v) => onGirts({ first: Math.max(0, v) }) });
    if (gz.length > 1) dims.push({ a: [x0 - 17, Y(gz[0])], b: [x0 - 17, Y(gz[1])], off: 0, value: girts.spacing, text: `${Math.round(girts.spacing)}`, testId: `${testId}-g-sp`, min: 300, onCommit: (v) => onGirts({ spacing: Math.max(300, v) }) });
  }
  // עמודי רוח: בכל מפתח ⌈w/max⌉−1 עמודים במרווחים שווים
  const bw0 = (x1 - x0) / Math.max(n, 1);
  const postX: number[] = [];
  let firstGap: { a: number; b: number; v: number } | null = null;
  if (posts) posts.bayW.forEach((w, i) => {
    if (!bays[i]) return;
    const k = Math.max(0, Math.ceil(w / Math.max(500, posts.maxSpacing)) - 1);
    for (let j = 1; j <= k; j++) postX.push(x0 + i * bw0 + (bw0 * j) / (k + 1));
    if (k > 0 && !firstGap) firstGap = { a: x0 + i * bw0, b: x0 + i * bw0 + bw0 / (k + 1), v: w / (k + 1) };
  });
  if (posts && onPosts) {
    const fg = firstGap as { a: number; b: number; v: number } | null;
    dims.push(fg
      ? { a: [fg.a, Y(zt) - 5], b: [fg.b, Y(zt) - 5], off: 0, value: posts.maxSpacing, text: `${Math.round(fg.v)} (≤${Math.round(posts.maxSpacing)})`, testId: `${testId}-p-max`, min: 1000, onCommit: (v) => onPosts(Math.max(1000, v)) }
      : { a: [0, 0], b: [0, 0], off: 0, value: posts.maxSpacing, labelOnly: true, at: [(x0 + x1) / 2, yE - 6], text: `עמודי רוח: מרווח מרבי ${Math.round(posts.maxSpacing)}`, testId: `${testId}-p-max`, min: 1000, onCommit: (v) => onPosts(Math.max(1000, v)) });
  }
  return (
    <Schematic w={210} h={112} dims={dims} testId={testId} caption={`לחיצה על מפתח — מחופה/פתוח · מידות ✎ תחתית וראש החיפוי${girts ? ', פטה ראשונה ומרווח פטות' : ''}${posts ? ', מרווח עמודי רוח' : ''}`}>
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
      {gz.map((z, i) => <line key={`g${i}`} x1={x0} y1={Y(z)} x2={x1} y2={Y(z)} className="sm-sec" strokeWidth={0.9} pointerEvents="none" />)}
      {postX.map((x, i) => <line key={`p${i}`} x1={x} y1={Y(zt)} x2={x} y2={yG} className="sm-hi" strokeWidth={1.4} pointerEvents="none" />)}
      {(gz.length > 0 || postX.length > 0) && <text x={x1} y={yG + 15} className="sm-lbl-s" textAnchor="end">{gz.length ? `${gz.length} פטות קיר` : ''}{postX.length ? ` · ${postX.length} עמודי רוח` : ''}</text>}
      <g className="bay-cell" onClick={() => onTop(top === null ? Math.round(eave * 0.6) : null)}><text x={x0 + 2} y={yE - 14} className="sm-lbl-s">{top === null ? 'עד הגג (לחץ לגובה חלקי)' : 'גובה חלקי (לחץ עד הגג)'}</text></g>
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

/**
 * תוכנית מסגרות לאורך המבנה (1.34): קו לכל מסגרת עם מספר, מידה לכל מפתח — לחיצה ✎ ושינוי (מזיז את כל המסגרות שאחריו),
 * ואורך כולל. מחליף את טבלת המיקומים כעריכה הראשית; הטבלה נשארת מקופלת.
 */
export function FramesStrip({ frames, onBay, onTotal, po, onPo }: { frames: { id: string; y: number }[]; onBay: (i: number, v: number) => void; onTotal: (v: number) => void;
  /** קונזולת פטות לפני המסגרת הראשונה / אחרי האחרונה (1.35) */
  po?: { start: number; end: number }; onPo?: (k: 'start' | 'end', v: number) => void }) {
  const fr = [...frames].sort((a, b) => a.y - b.y);
  const n = fr.length;
  const L = fr[n - 1].y - fr[0].y || 1;
  const W = 300, x0 = 40, x1 = 270, yT = 26, yB = 54;
  const X = (y: number) => x0 + ((y - fr[0].y) / L) * (x1 - x0);
  const many = n > 13;
  const dims: SDim[] = [
    ...fr.slice(1).map((f, i) => ({ a: [X(fr[i].y), yB + 10], b: [X(f.y), yB + 10], off: 0, value: f.y - fr[i].y,
      text: many ? `${((f.y - fr[i].y) / 1000).toFixed(1)}` : `${Math.round(f.y - fr[i].y)}`, unit: '', testId: `fs-bay-${i}`, min: 100,
      onCommit: (v: number) => onBay(i, v) }) as SDim),
    { a: [x0, yB + 24], b: [x1, yB + 24], off: 0, value: L, text: `${Math.round(L)} (אורך)`, testId: 'fs-total', min: 1000, onCommit: (v: number) => onTotal(v) },
    ...(po && onPo ? [
      { a: [x0 - 22, yT + 6], b: [x0, yT + 6], off: 0, value: po.start, text: `${Math.round(po.start)}`, testId: 'fs-po-start', min: 0, onCommit: (v: number) => onPo('start', v) } as SDim,
      { a: [x1, yT + 6], b: [x1 + 22, yT + 6], off: 0, value: po.end, text: `${Math.round(po.end)}`, testId: 'fs-po-end', min: 0, onCommit: (v: number) => onPo('end', v) } as SDim,
    ] : []),
  ];
  return (
    <Schematic w={W} h={92} dims={dims} testId="frames-strip" caption={`תוכנית מסגרות (מ"מ${many ? ', מרווחים במטר' : ''}) — לחיצה על מרווח ✎ משנה אותו ומזיזה את כל מה שאחריו · לחיצה על האורך — חלוקה שווה מחדש`}>
      <rect x={x0} y={yT} width={x1 - x0} height={yB - yT} className="sm-plate" opacity={0.35} />
      {po && <><line x1={x0 - 22} y1={yT + 14} x2={x1 + 22} y2={yT + 14} className="sm-thin" />
        {S.text([x0 - 11, yB + 2], 'קונזולת פטות', 'sm-lbl-s')}{S.text([x1 + 11, yB + 2], 'קונזולת פטות', 'sm-lbl-s')}</>}
      {fr.map((f, i) => (
        <g key={f.id}>
          {S.bar([X(f.y), yT - 2], [X(f.y), yB + 2], 'sm-main', 2.2)}
          {(!many || i % 2 === 0 || i === n - 1) && <><circle cx={X(f.y)} cy={yT - 9} r={5.5} className="sm-bub" />{S.text([X(f.y), yT - 8.6], String(i + 1), 'sm-lbl-s')}</>}
        </g>
      ))}
    </Schematic>
  );
}

/**
 * קשיחות קירות — תוכנית אחת (1.34): שורה לכל ציר עמודים (מלמעלה ← למטה: הציר הראשון ← האחרון), עמודה לכל מפתח.
 * לחיצה על תא מוסיפה/מסירה קשיחות בקיר הזה במפתח הזה; הסמל לפי הסוג (X / אגד B / נעילה אופקית).
 */
export function WallsPlan({ lines, nb, bays, kind, onToggle }: {
  lines: { id: string; label: string }[]; nb: number; bays: Map<string, number[]>; kind: 'x' | 'portal' | 'truss';
  onToggle: (lineId: string, bay: number) => void;
}) {
  const W = 300, X0 = 70, X1 = 294, Y0 = 18, rowH = Math.max(22, Math.min(30, 150 / Math.max(lines.length, 1)));
  const bw = (X1 - X0) / Math.max(nb, 1);
  const H = Y0 + rowH * lines.length + 14;
  const sym = (a: number, y: number) => {
    const b = a + bw, t = y + 3, u = y + rowH - 3;
    if (kind === 'x') return <><line x1={a + 1.5} y1={t} x2={b - 1.5} y2={u} className="sm-hi" strokeWidth={1.3} /><line x1={a + 1.5} y1={u} x2={b - 1.5} y2={t} className="sm-hi" strokeWidth={1.3} /></>;
    if (kind === 'portal') { const yb = t + (u - t) * 0.35; return <><line x1={a + 1} y1={yb} x2={b - 1} y2={yb} className="sm-hi" strokeWidth={1.6} /><line x1={a + 1} y1={u} x2={a + bw * 0.28} y2={yb} className="sm-hi" strokeWidth={1.2} /><line x1={b - 1} y1={u} x2={b - bw * 0.28} y2={yb} className="sm-hi" strokeWidth={1.2} /></>; }
    const n = 4, xs = Array.from({ length: n + 1 }, (_, i) => a + 2 + ((bw - 4) * i) / n);
    return <><line x1={a + 1} y1={t + 1} x2={b - 1} y2={t + 1} className="sm-hi" strokeWidth={1.4} /><line x1={a + 1} y1={u - 3} x2={b - 1} y2={u - 3} className="sm-hi" strokeWidth={1.4} />
      {xs.slice(0, -1).map((x, i) => <line key={i} x1={x} y1={i % 2 ? t + 1 : u - 3} x2={xs[i + 1]} y2={i % 2 ? u - 3 : t + 1} className="sm-hi" strokeWidth={1} />)}</>;
  };
  return (
    <div className="schem" data-testid="walls-plan">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="קשיחות קירות — תוכנית">
        <text x={W / 2} y={9} className="sm-lbl-s" textAnchor="middle">חזיתות הקירות לפי ציר — לחיצה על מפתח מוסיפה/מסירה</text>
        {lines.map((l, r) => {
          const y = Y0 + r * rowH, sel = new Set(bays.get(l.id) ?? []);
          const side = r === 0 ? ' (שמאל)' : r === lines.length - 1 ? ' (ימין)' : '';
          return <g key={l.id}>
            <text x={X0 - 3} y={y + rowH / 2 + 2} className="sm-lbl" textAnchor="end" direction="ltr" style={{ unicodeBidi: 'plaintext' }}>{`ציר ${l.label}${side}`}</text>
            {Array.from({ length: nb }, (_, i) => {
              const a = X0 + i * bw, on = sel.has(i);
              return <g key={i} className="bay-cell" data-testid={`sch-wall-${l.id}-${i}`} onClick={() => onToggle(l.id, i)}>
                <rect x={a} y={y} width={bw} height={rowH} className={on ? 'bay on' : 'bay'} />
                {on && sym(a, y)}
              </g>;
            })}
            <line x1={X0} y1={y + rowH} x2={X1} y2={y + rowH} className="sm-main" strokeWidth={1.2} />
          </g>;
        })}
        {Array.from({ length: nb + 1 }, (_, i) => <g key={i}><line x1={X0 + i * bw} y1={Y0} x2={X0 + i * bw} y2={Y0 + rowH * lines.length} className="sm-main" strokeWidth={1.2} />
          {(nb <= 24 || i % 2 === 0) && <text x={X0 + i * bw} y={H - 3} className="sm-lbl-s" textAnchor="middle">{i + 1}</text>}</g>)}
      </svg>
    </div>
  );
}

/**
 * חיבור המשך פטה (1.35): חזית ווב הפטה בתפר — פלטה בצד הפנימי, 2 ברגים בכל צד.
 * מידות לעריכה: מרחק הבורג מהתפר, מרחק לקצה הפלטה, גובה הפלטה (אוטו׳ לפי הפטה), עובי.
 */
export function PurlinSpliceSchematic({ sp, purlinH, onSet }: { sp: PurlinSpliceParams; purlinH: number; onSet: (patch: Partial<PurlinSpliceParams>) => void }) {
  const h = Math.max(100, purlinH);
  const H = sp.plateH ?? Math.floor((h - 4 * 2.5 - 20) / 10) * 10;
  const L = 2 * (sp.jointOffset + sp.edge);
  const k = 150 / Math.max(L + 120, h * 1.3);
  const cx = 110, cy = 62;
  const X = (u: number) => cx + u * k, Y = (v: number) => cy - v * k; // u לאורך, v לגובה (0 = מרכז)
  const bolts: [number, number][] = [];
  for (const sg of [-1, 1]) for (const zz of [-1, 1]) bolts.push([sg * sp.jointOffset, zz * (H / 2 - sp.edge)]);
  const dims: SDim[] = [
    { a: [X(0), Y(-H / 2) + 8], b: [X(sp.jointOffset), Y(-H / 2) + 8], off: 0, value: sp.jointOffset, testId: 'sch-ps-off', min: 20, onCommit: (v) => onSet({ jointOffset: Math.max(20, v) }) },
    { a: [X(sp.jointOffset), Y(-H / 2) + 8], b: [X(sp.jointOffset + sp.edge), Y(-H / 2) + 8], off: 0, value: sp.edge, testId: 'sch-ps-edge', min: 15, onCommit: (v) => onSet({ edge: Math.max(15, v) }) },
    { a: [X(-L / 2) - 6, Y(-H / 2)], b: [X(-L / 2) - 6, Y(H / 2)], off: 0, value: H, text: `${Math.round(H)}${sp.plateH == null ? ' (אוטו׳)' : ''}`, testId: 'sch-ps-h', min: 40, onCommit: (v) => onSet({ plateH: Math.max(40, Math.min(h - 20, v)) }) },
    { a: [0, 0], b: [0, 0], off: 0, value: sp.plateT, labelOnly: true, at: [X(-L / 4), Y(0)], text: `t=${sp.plateT}`, testId: 'sch-ps-t', min: 3, onCommit: (v) => onSet({ plateT: Math.max(3, v) }) },
    { a: [X(-L / 2), Y(-H / 2) + 20], b: [X(L / 2), Y(-H / 2) + 20], off: 0, value: L, derived: true, text: `${Math.round(L)} (אורך פלטה)` },
  ];
  return (
    <Schematic w={220} h={140} dims={dims} testId="sch-psplice" caption="חזית ווב הפטה בתפר · לחיצה על מידה ✎ — מרחק מהתפר, מרחק לקצה, גובה ועובי הפלטה">
      <rect x={X(-L / 2 - 60)} y={Y(h / 2)} width={(L / 2 + 60) * k - 1} height={h * k} className="sm-host" />
      <rect x={X(0) + 1} y={Y(h / 2)} width={(L / 2 + 60) * k} height={h * k} className="sm-host" />
      <line x1={X(0)} y1={Y(h / 2) - 4} x2={X(0)} y2={Y(-h / 2) + 4} className="sm-hi" strokeDasharray="3 2" strokeWidth={1} />
      <rect x={X(-L / 2)} y={Y(H / 2)} width={L * k} height={H * k} className="sm-plate" />
      {bolts.map(([u, v], i) => <circle key={i} cx={X(u)} cy={Y(v)} r={Math.max(2.2, (sp.bolt.d / 2) * k)} className="sm-bolt" />)}
      {S.text([X(0), Y(h / 2) - 7], 'תפר', 'sm-lbl-s')}
      {S.text([X(-L / 2 - 30), Y(h / 2) + 9], 'פטה', 'sm-lbl-s')}{S.text([X(L / 2 + 30), Y(h / 2) + 9], 'פטה', 'sm-lbl-s')}
      {S.text([X(L / 4), Y(0) + 3], `2×M${sp.bolt.d} בכל צד`, 'sm-lbl-s')}
    </Schematic>
  );
}

/** בחירת מסגרות בתוכנית (1.35): קו לכל מסגרת לאורך המבנה, לחיצה מסמנת/מבטלת; מסומנת = סמל מסבך */
export function FramePickStrip({ frames, sel, onToggle, testPre, label }: { frames: { id: string; y: number }[]; sel: string[]; onToggle: (id: string) => void; testPre: string; label: string }) {
  const fr = [...frames].sort((a, b) => a.y - b.y);
  const L = (fr[fr.length - 1]?.y ?? 0) - (fr[0]?.y ?? 0) || 1;
  const W = 300, x0 = 16, x1 = 284, yT = 14, yB = 44;
  const X = (y: number) => x0 + ((y - fr[0].y) / L) * (x1 - x0);
  return (
    <div className="schem" data-testid={`${testPre}strip`}>
      <svg viewBox={`0 0 ${W} 62`} role="img" aria-label={label}>
        <rect x={x0} y={yT} width={x1 - x0} height={yB - yT} className="sm-plate" opacity={0.3} />
        {fr.map((f, i) => {
          const on = sel.includes(f.id), x = X(f.y);
          return (
            <g key={f.id} className="bay-cell" data-testid={`${testPre}${i + 1}`} onClick={() => onToggle(f.id)}>
              <rect x={x - 7} y={yT - 4} width={14} height={yB - yT + 18} fill="transparent" />
              {on
                ? <>{S.bar([x, yT], [x, yB], 'sm-hi', 3.2)}<path d={`M${x - 4} ${yT + 4} L${x + 4} ${yT + 10} L${x - 4} ${yT + 16} L${x + 4} ${yT + 22}`} className="sm-hi" strokeWidth={1} fill="none" /></>
                : S.bar([x, yT], [x, yB], 'sm-main', 1.6)}
              <circle cx={x} cy={yB + 9} r={5.5} className={on ? 'sm-bub on' : 'sm-bub'} />
              {S.text([x, yB + 9.4], String(i + 1), 'sm-lbl-s')}
            </g>
          );
        })}
      </svg>
      <div className="schem-cap">{label}</div>
    </div>
  );
}

/** חתך פנל גג (1.35): גלי הפח לאורך רוחב הכיסוי, עובי (פנל מבודד) ובליטה לתוך המזחלה — מידות לעריכה */
export function RoofPanelSchematic({ cover, thickness, eaveExt, onSet }: { cover: number; thickness: number; eaveExt: number; onSet: (patch: { cover?: number; thickness?: number; eaveExt?: number }) => void }) {
  const x0 = 20, x1 = 150, y = 34;
  const ribs = 5, rw = (x1 - x0) / ribs;
  const tV = thickness > 0 ? Math.max(3, Math.min(14, thickness / 6)) : 0;
  const pts: string[] = [];
  for (let i = 0; i < ribs; i++) { const a = x0 + i * rw; pts.push(`${a},${y}`, `${a + rw * 0.2},${y}`, `${a + rw * 0.3},${y - 7}`, `${a + rw * 0.5},${y - 7}`, `${a + rw * 0.6},${y}`); }
  pts.push(`${x1},${y}`);
  const ex0 = 168, ex1 = 206, ey = 40;
  const extV = Math.max(4, Math.min(30, eaveExt / 6));
  const dims: SDim[] = [
    { a: [x0, y + tV + 8], b: [x1, y + tV + 8], off: 0, value: cover, testId: 'sch-rp-cover', min: 300, onCommit: (v) => onSet({ cover: Math.max(300, v) }) },
    { a: [0, 0], b: [0, 0], off: 0, value: thickness, labelOnly: true, at: [(x0 + x1) / 2, y - 13], text: thickness > 0 ? `עובי ${Math.round(thickness)}` : 'פח בודד (עובי 0)', testId: 'sch-rp-t', min: 0, onCommit: (v) => onSet({ thickness: Math.max(0, v) }) },
    { a: [ex1 - extV, ey + 18], b: [ex1, ey + 18], off: 0, value: eaveExt, testId: 'sch-rp-ext', min: 0, onCommit: (v) => onSet({ eaveExt: Math.max(0, v) }) },
  ];
  return (
    <Schematic w={220} h={72} dims={dims} testId="sch-roofpanel" caption="חתך פנל הגג · לחיצה על מידה ✎ — רוחב כיסוי, עובי, בליטה לתוך המזחלה">
      <polyline points={pts.join(' ')} className="sm-hi" strokeWidth={1.4} fill="none" />
      {tV > 0 && <><rect x={x0} y={y} width={x1 - x0} height={tV} className="sm-plate" /><line x1={x0} y1={y + tV} x2={x1} y2={y + tV} className="sm-main" strokeWidth={0.8} /></>}
      {/* קצה הגג: פנל בולט מעבר לקורה לתוך המזחלה */}
      <line x1={ex0} y1={ey} x2={ex1} y2={ey} className="sm-hi" strokeWidth={1.4} />
      <rect x={ex0} y={ey + 2} width={ex1 - ex0 - extV} height={5} className="sm-host" />
      <path d={`M${ex1 - extV - 4} ${ey + 6} v10 h${extV + 10} v-12`} className="sm-main" strokeWidth={0.8} fill="none" />
      {S.text([ex0 + 8, ey - 4], 'קצה הגג', 'sm-lbl-s')}{S.text([ex1 + 4, ey + 13], 'מזחלה', 'sm-lbl-s')}
    </Schematic>
  );
}
