import { expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { defaultKneeBraces } from '../src/geometry/knee';
import { defaultPortal } from '../src/geometry/portal';
import { kneeSet, wallSet } from '../src/view/realView';

/** RV-01 (1.55): התצוגה החיה של חלון הרכיב מקבלת את אלמנטי המודל עצמו — מפתח אחד של קשיחות הקיר עם העמודים שלו, וצומת אלכסון עם העמוד והקורה */
it('RV-01: בחירת האלמנטים לתצוגה החיה — מפתח קיר וצומת אלכסון', () => {
  const p = newProject();
  const b = defaultBuilding() as typeof p.building;
  b.kneeBraces = { ...defaultKneeBraces(), enabled: true };
  b.bracing.walls.enabled = true; b.bracing.walls.type = 'portal'; b.bracing.walls.portal = defaultPortal();
  p.building = b;
  const d = generate(p);
  const w = wallSet(p, d)!;
  expect(w).toBeTruthy();
  // הרכיב: רק אגד B, כולל פלטות וברגים של החיבורים שלו
  expect(w.focus.some((m) => /^BB\./.test(m.id))).toBe(true);
  expect(w.focus.some((m) => m.kind === 'bolt')).toBe(true);
  expect(w.focus.filter((m) => m.kind !== 'plate' && m.kind !== 'bolt' && m.kind !== 'cleat').every((m) => /^BB\./.test(m.id))).toBe(true);
  // המבנה סביב: שני העמודים של המפתח
  expect(w.context.filter((m) => m.kind === 'column').length).toBe(2);
  // כל הקיר: יותר אלמנטים מאשר מפתח אחד
  const all = wallSet(p, d, { whole: true })!;
  expect(all.focus.length).toBeGreaterThanOrEqual(w.focus.length);
  const k = kneeSet(p, d)!;
  expect(k.focus.some((m) => /^KB\./.test(m.id))).toBe(true);
  expect(k.context.some((m) => m.kind === 'column')).toBe(true);
  expect(k.context.some((m) => m.kind === 'rafter')).toBe(true);
  expect(k.tags?.some((t) => t.text.startsWith('ירידה'))).toBe(true);
  const kf = kneeSet(p, d, { frame: true })!;
  expect(kf.context.filter((m) => m.kind === 'column').length).toBeGreaterThanOrEqual(2);
});
