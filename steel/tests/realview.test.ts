import { expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { defaultKneeBraces } from '../src/geometry/knee';
import { defaultPortal } from '../src/geometry/portal';
import { familySet, kneeSet, wallSet } from '../src/view/realView';

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

/** RV-02 (1.58): תצוגה כללית לכל משפחת רכיבים — הרכיב סביב האלמנט שנבחר, והמבנה הראשי שסביבו כהקשר */
it('RV-02: familySet — קושרות גג: הרכיב בפוקוס, עמודים/קורות בהקשר; "כל הרכיב" כולל את כולם', () => {
  const p = newProject();
  const b = defaultBuilding() as typeof p.building;
  b.bracing.roof.enabled = true;
  p.building = b;
  const d = generate(p);
  const isX = (m: { id: string }) => /^BR\.R/.test(m.id);
  const near = familySet(p, d, isX, { key: 't' })!;
  expect(near.focus.some(isX)).toBe(true);
  expect(near.focus.filter((m) => m.kind !== 'plate' && m.kind !== 'bolt' && m.kind !== 'cleat').every(isX)).toBe(true);
  expect(near.context.some((m) => m.kind === 'rafter')).toBe(true);
  const all = familySet(p, d, isX, { key: 't', wide: true })!;
  expect(all.focus.filter(isX).length).toBe(d.members.filter(isX).length);
  expect(all.focus.filter(isX).length).toBeGreaterThan(near.focus.filter(isX).length);
  // משפחה בלי אלמנטים — אין תצוגה
  expect(familySet(p, d, (m) => /^NOPE/.test(m.id), { key: 'x' })).toBeNull();
});
