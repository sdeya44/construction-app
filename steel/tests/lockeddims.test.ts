import { expect, it } from 'vitest';
import { triMeasure, triSolve, type TDim } from '../src/ui/wizard/LockedDims';
import { newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { connSet } from '../src/view/realView';

/** LD-01 (1.60): מידות נעולות למשולש — כל צמד קובע את השאר; צמד בלי פתרון מוחזר null */
it('LD-01: triSolve — כל צמד מידות מחזיר את אותו אלכסון', () => {
  const m = triMeasure(600, 40);
  const K: TDim[] = ['v', 'h', 'ang', 'L'];
  for (const a of K) for (const b of K) {
    if (a === b) { expect(triSolve(a, m[a], b, m[b])).toBeNull(); continue; }
    const r = triSolve(a, m[a], b, m[b])!;
    expect(r.v).toBeCloseTo(600, 3); expect(r.ang).toBeCloseTo(40, 3);
  }
  expect(triSolve('v', 600, 'L', 500)).toBeNull(); // אורך קטן מהאנכי
  expect(triSolve('h', 800, 'L', 700)).toBeNull();
  expect(triSolve('v', 10, 'h', 5000)).toBeNull(); // זווית מתחת ל-5°
});

/** CV-01 (1.60): תצוגת מחבר — חלקי החיבור בפוקוס, קצוות האלמנטים החתוכים סביבו */
it('CV-01: connSet — פלטות וברגים של חיבור אחד והאלמנטים שלו', () => {
  const p = newProject(); const d = generate(p);
  const c = d.connections.find((x) => x.type === 'eave')!;
  const s = connSet(d, c.id)!;
  expect(s.focus.some((m) => m.kind === 'plate')).toBe(true);
  expect(s.focus.some((m) => m.kind === 'bolt')).toBe(true);
  expect(s.context.length).toBeGreaterThan(0);
  // האלמנטים חתוכים סביב המחבר — קצרים מהמקור
  const col = s.context.find((m) => m.kind === 'column')!;
  const orig = d.byId.get(col.id)!;
  expect(Math.abs(col.end.z - col.start.z)).toBeLessThan(Math.abs(orig.end.z - orig.start.z));
  expect(connSet(d, 'C.NOPE')).toBeNull();
});

/** CV-02 (1.60): באג שנמצא — קטע שנחתך לנקודה (אורך אפס) הפיל את התצוגה. כל מחבר במודל — בלי אלמנט באורך אפס */
it('CV-02: connSet לכל המחברים במודל (כולל שורות קשירה וקשיחות) — אין אלמנט באורך אפס', () => {
  const p = newProject();
  p.building.bracing.purlinTies.enabled = true; p.building.bracing.walls.enabled = true; p.building.bracing.roof.enabled = true;
  const d = generate(p);
  let n = 0;
  for (const c of d.connections) {
    const s = connSet(d, c.id); if (!s) continue; n++;
    for (const m of [...s.focus, ...s.context]) expect(Math.hypot(m.end.x - m.start.x, m.end.y - m.start.y, m.end.z - m.start.z), `${c.id} ${m.id}`).toBeGreaterThan(0.5);
  }
  expect(n).toBeGreaterThan(50);
});
