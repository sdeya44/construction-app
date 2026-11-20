import { expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { defaultKneeBraces } from '../src/geometry/knee';
import { measureKnee, solveKnee } from '../src/geometry/kneeSolve';

/** KS-01 (1.56): מידות האלכסון ופתרון הפוך — שתי מידות נעולות קובעות את השאר, על המודל עצמו */
it('KS-01: מדידה ופתרון — ירידה+זווית, אופקי+זווית, מרחק נקודות מגע+אנכי', () => {
  const p = newProject();
  p.building = defaultBuilding() as typeof p.building;
  p.building.kneeBraces = { ...defaultKneeBraces(), enabled: true };
  const id = 'KB.F2.L.L.R';
  const m = measureKnee(generate(p), id)!;
  expect(m).toBeTruthy();
  // ברירת מחדל: זווית 45°, הירידה כפי שהוגדרה
  expect(Math.abs(m.ang - (p.building.kneeBraces.angle ?? 45))).toBeLessThan(0.6);
  expect(Math.abs(m.v - p.building.kneeBraces.drop)).toBeLessThan(15);
  expect(m.face).toBeGreaterThan(300); expect(m.ax).toBeGreaterThan(m.face); expect(m.L).toBeGreaterThan(0);
  // אופקי + זווית ⇒ ירידה
  const s1 = solveKnee(p, id, { h: m.h + 200, ang: 40 })!;
  expect(s1).toBeTruthy();
  expect(Math.abs(s1.meas.h - (m.h + 200))).toBeLessThan(3);
  expect(Math.abs(s1.meas.ang - 40)).toBeLessThan(0.5);
  // מרחק נקודות המגע + אנכי ⇒ זווית
  const s2 = solveKnee(p, id, { face: m.face + 150, v: m.v })!;
  expect(s2).toBeTruthy();
  expect(Math.abs(s2.meas.face - (m.face + 150))).toBeLessThan(3);
  // חריג למיקום: רק הצד הזה משתנה
  const s3 = solveKnee(p, id, { L: m.L + 100, ang: 45 }, 'L.L.R')!;
  expect(s3).toBeTruthy();
  expect(Math.abs(s3.meas.L - (m.L + 100))).toBeLessThan(3);
});
