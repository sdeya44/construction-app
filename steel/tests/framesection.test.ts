import { expect, it } from 'vitest';
import { newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { toCustomSection, type CustomSection } from '../src/model/section';
import { columnTopAt, setJunction, setSlope, setTosAtAxis } from '../src/ui/FrameSection';

const zAt = (s: CustomSection, x: number) => Math.max(...s.planes.filter((p) => p.x0 - 1 <= x && x <= p.x1 + 1).map((p) => p.z0 + ((p.z1 - p.z0) * (x - p.x0)) / (p.x1 - p.x0)));

/** FS-01 (1.62): חתך המסגרת — ע.ע. קורה בציר, רכס ושיפוע; ראש העמוד = מישור החיתוך (לא נקודת העבודה) */
it('FS-01: עריכת גבהים בחתך — רק בציר / כל הגג / רכס / שיפוע', () => {
  const p = newProject(); const d = generate(p);
  const s0 = toCustomSection(p.building, d.roof);
  const [A, B] = [...s0.lines].sort((a, b) => a.x - b.x).map((l) => l.x);
  const ridge = s0.planes.find((q) => q.id === 'L')!.x1;
  const zr = zAt(s0, ridge);
  // רק בציר א: ע.ע. בציר א = 6500, הרכס וציר ב לא זזים
  const s1 = setTosAtAxis(s0, A, 6500, 'local');
  expect(zAt(s1, A)).toBeCloseTo(6500, 3); expect(zAt(s1, ridge)).toBeCloseTo(zr, 3); expect(zAt(s1, B)).toBeCloseTo(zAt(s0, B), 3);
  // כל הגג: כל הגבהים עולים ב-500, השיפועים נשמרים
  const s2 = setTosAtAxis(s0, A, zAt(s0, A) + 500, 'all');
  expect(zAt(s2, B)).toBeCloseTo(zAt(s0, B) + 500, 3); expect(zAt(s2, ridge)).toBeCloseTo(zr + 500, 3);
  // רכס: 7200, ע.ע. בצירים לא משתנה
  const s3 = setJunction(s0, ridge, 7200);
  expect(zAt(s3, ridge)).toBeCloseTo(7200, 3); expect(zAt(s3, A)).toBeCloseTo(zAt(s0, A), 3); expect(zAt(s3, B)).toBeCloseTo(zAt(s0, B), 3);
  // שיפוע שמאל 15%: ע.ע. בציר א נשמר; הרכס עולה והמישור הימני נצמד אליו (ציר ב נשמר)
  const s4 = setSlope(s0, 'L', 15);
  const L4 = s4.planes.find((q) => q.id === 'L')!, R4 = s4.planes.find((q) => q.id === 'R')!;
  expect(((L4.z1 - L4.z0) / (L4.x1 - L4.x0)) * 100).toBeCloseTo(15, 3);
  expect(zAt(s4, A)).toBeCloseTo(zAt(s0, A), 3); expect(zAt(s4, B)).toBeCloseTo(zAt(s0, B), 3);
  expect(R4.z0).toBeCloseTo(L4.z1, 3);
  // ראש העמוד: מתחת לע.ע. קורה (עומק הקורה + פלטה), לא נקודת העבודה
  const col = d.byId.get('F1.COL.L')!;
  const ct = columnTopAt(col, A);
  expect(Math.max(col.start.z, col.end.z)).toBeCloseTo(zAt(s0, A), 0);
  expect(ct).toBeLessThan(zAt(s0, A) - 300);
  expect(ct).toBeGreaterThan(zAt(s0, A) - 400);
});
