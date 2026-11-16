import { setBuilding, setKneeBraces } from '../commands/commands';
import { defaultKneeBraces } from '../geometry/knee';
import { defaultPortal } from '../geometry/portal';
import type { PortalBraceParams } from '../model/types';
import { tryProfile } from '../profiles/library';
import { store, useStore } from '../store';
import { S, Schematic, type SDim } from './Schematic';

const rad = (a: number) => (a * Math.PI) / 180;

/** אגד B: עמודים, קורה ראשית, קורת אגד ושני אלכסונים — מרווח, ירידה וזווית לעריכה על השרטוט */
export function PortalSchematic() {
  const br = useStore((s) => s.project.building.bracing);
  const frames = useStore((s) => s.project.building.frames);
  const p = br.walls.portal ?? defaultPortal();
  const set = (patch: Partial<PortalBraceParams>) => store.exec(setBuilding({ bracing: { ...br, walls: { ...br.walls, portal: { ...p, ...patch } } } }));
  const fr = [...frames].sort((a, b) => a.y - b.y);
  const bay = fr.length > 1 ? fr[1].y - fr[0].y : 6000;
  const hb = tryProfile(p.beam)?.props.h ?? 100;
  const x0 = 24, x1 = 176, yTop = 16, yMain = 22;
  const gapV = 6 + Math.min(14, p.gap / 40), hbV = Math.max(3, Math.min(8, hb / 25));
  const yBt = yMain + gapV, yBb = yBt + hbV;
  const dropV = Math.max(14, Math.min(40, p.drop / 25));
  const dx = dropV / Math.tan(rad(p.angle));
  const yC = yBb + dropV;
  const dims: SDim[] = [
    { a: [x1 + 2, yMain], b: [x1 + 2, yBt], off: -8, value: p.gap, unit: '', testId: 'sch-pb-gap', onCommit: (v) => set({ gap: Math.max(0, v) }) },
    { a: [x0 - 2, yBb], b: [x0 - 2, yC], off: 8, value: p.drop, testId: 'sch-pb-drop', min: 200, onCommit: (v) => set({ drop: Math.max(200, v) }) },
    { a: [0, 0], b: [0, 0], off: 0, value: p.angle, unit: '°', labelOnly: true, at: [x0 + dx * 0.55 + 9, yC - dropV * 0.45], testId: 'sch-pb-angle', min: 20, max: 70, onCommit: (v) => set({ angle: v }) },
    { a: [x0, 108], b: [x1, 108], off: 0, value: bay, derived: true, text: `${Math.round(bay)} (מפתח)` },
  ];
  return (
    <Schematic w={200} h={118} dims={dims} testId="sch-portal" caption="לחיצה על מידה מסומנת ✎ לשינוי · חל על כל אגדי B בפרויקט">
      {S.bar([x0, yTop], [x0, 104])}{S.bar([x1, yTop], [x1, 104])}
      {S.bar([x0 - 6, yMain - 3], [x1 + 6, yMain - 3], 'sm-main', 5)}
      {S.text([100, yMain - 8], 'קורה ראשית / ראש עמוד', 'sm-lbl-s')}
      <rect x={x0 + 1.5} y={yBt} width={x1 - x0 - 3} height={yBb - yBt} className="sm-plate" />
      {S.text([100, yBt + (yBb - yBt) / 2], `קורת אגד ${p.beam}`, 'sm-lbl')}
      {S.bar([x0 + 1.5, yC], [x0 + 1.5 + dx, yBb], 'sm-hi', 2.2)}{S.bar([x1 - 1.5, yC], [x1 - 1.5 - dx, yBb], 'sm-hi', 2.2)}
      {S.text([x1 - dx - 10, yC - dropV * 0.4], `אלכסון ${p.brace}`, 'sm-lbl-s', 'end')}
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
