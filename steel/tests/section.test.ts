import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { SECTION_TEMPLATES, toCustomSection } from '../src/model/section';
import { defaultKneeBraces } from '../src/geometry/knee';
import { setSection } from '../src/commands/commands';

const geo = () => newProject('t', defaultBuilding());
const withTpl = (id: string, knee = false) => {
  const p = geo();
  p.building.section = SECTION_TEMPLATES.find((t) => t.id === id)!.make();
  if (knee) p.building.kneeBraces = { ...defaultKneeBraces(), enabled: true };
  return p;
};
const types = (d: ReturnType<typeof generate>) => { const m: Record<string, number> = {}; for (const c of d.connections) m[c.type] = (m[c.type] ?? 0) + 1; return m; };

describe('חתך מודולרי — מערכת לבניית סוגי סככות', () => {
  it('המרה מקלאסי למודולרי שקולה: אותם אלמנטים ואותה גיאומטריה (מלבד מזהי רכיבים)', () => {
    const p = geo();
    const d0 = generate(p);
    const p2 = setSection(toCustomSection(p.building, d0.roof)).run(p);
    const d1 = generate(p2);
    const geomOf = (d: typeof d0, k: string) => d.members.filter((m) => m.kind === k).map((m) => [m.start, m.end].map((q) => [q.x, q.y, q.z].map((v) => v.toFixed(3)).join()).join('|')).sort();
    for (const k of ['column', 'rafter', 'purlin', 'cleat']) expect(geomOf(d1, k)).toEqual(geomOf(d0, k));
    expect(types(d1)).toEqual(types(d0));
  });
  for (const t of SECTION_TEMPLATES) {
    it(`תבנית "${t.name}": נבנית בלי שגיאות ובלי התנגשויות, כולל אלכסוני עמוד-קורה`, () => {
      const d = generate(withTpl(t.id, true));
      expect(d.issues.filter((i) => i.severity === 'error')).toEqual([]);
      expect(d.issues.filter((i) => i.code === 'CLASH')).toEqual([]);
      expect(d.members.filter((m) => m.kind === 'column').length).toBe(6 * t.make().lines.length);
      expect(types(d).knee).toBeGreaterThan(0);
    });
  }
  it('גג מדורג: המישור הנמוך מתחבר לצד העמוד האמצעי בפלטת קצה; העמוד ממשיך למישור העליון', () => {
    const d = generate(withTpl('stepped'));
    const c = d.connById.get('C.SIDE.F2.B.P1')!;
    expect(c.type).toBe('rafter-side');
    expect(c.bolts.length).toBe(4);
    expect(c.bolts.every((b) => b.holesIn.includes('F2.COL.B') && b.location === 'site')).toBe(true);
    const col = d.byId.get('F2.COL.B')!;
    expect(col.end.z).toBeCloseTo(7000, 3); // ראש העמוד בגובה המישור העליון
    expect(d.connById.has('C.EAVE.F2.B')).toBe(true); // המישור העליון יושב על העמוד
    const raf = d.byId.get('F2.RAF.P1')!;
    expect(raf.endCut ?? raf.startCut).toBeTruthy();
  });
  it('רכס על קונזולה: השיפוע הראשון ממשיך מעבר לעמוד; רכס בין שני המישורים ללא עמוד', () => {
    const d = generate(withTpl('gable-cant'));
    expect(types(d).ridge).toBe(6);
    expect(d.connById.has('C.RIDGE.F1.P1.P2')).toBe(true);
    expect(d.connById.has('C.EAVE.F1.B')).toBe(true); // הקורה רציפה מעל העמוד הפנימי
  });
  it('עמוד ברכס: שני המישורים מתחברים לצדי העמוד; ראש העמוד בגובה הרכס', () => {
    const d = generate(withTpl('gable-center'));
    expect(['C.SIDE.F1.B.P1', 'C.SIDE.F1.B.P2'].every((id) => d.connById.get(id)?.type === 'rafter-side')).toBe(true);
    expect(d.byId.get('F1.COL.B')!.end.z).toBeCloseTo(6900, 3);
  });
  it('אלכסון עמוד-קורה: RHS80/80/4, פלטת קצה בכל קצה מוברגת 4×M16 לאגף המארח (אום בתוך הפרופיל)', () => {
    const d = generate(withTpl('mono-multi', true));
    const c = d.connById.get('C.KB.F2.B.P1.L')!;
    expect(c.bolts.length).toBe(8);
    expect(c.bolts.every((b) => b.d === 16 && b.location === 'site')).toBe(true);
    expect(c.bolts.filter((b) => b.holesIn.includes('F2.COL.B')).length).toBe(4);
    expect(c.bolts.filter((b) => b.holesIn.includes('F2.RAF.P1')).length).toBe(4);
    const br = d.byId.get('KB.F2.B.P1.L')!;
    expect(br.profile).toBe('RHS80x80x4');
    expect(c.welds.every((w) => w.location === 'shop')).toBe(true);
    // קצה שמאלי של עמוד קיצוני — אין אלכסון כלפי חוץ (הקורה לא ממשיכה מספיק)
    expect(d.connById.has('C.KB.F2.A.P1.L')).toBe(false);
  });
  it('מישור שעובר דרך עמוד גבוה ממנו — שגיאה ברורה', () => {
    const p = withTpl('stepped');
    p.building.section!.planes[0].x1 = 15000;
    p.building.section!.planes[0].z1 = 5000 + 0.1 * 15500;
    const d = generate(p);
    expect(d.issues.some((i) => i.code === 'PLANE_THROUGH')).toBe(true);
  });

  it('אלכסוני גג לכל אורך המישור, מחולקים בעמוד הפנימי ועד הרכס', () => {
    const d = generate(withTpl('gable-inner'));
    const span = (pre: string) => { const ms = d.members.filter((m) => m.id.startsWith(pre)); return [Math.min(...ms.map((m) => Math.min(m.start.x, m.end.x))), Math.max(...ms.map((m) => Math.max(m.start.x, m.end.x)))]; };
    const [a0, a1] = span('BR.R1.P11.'), [b0, b1] = span('BR.R1.P12.');
    expect(a0).toBeLessThan(200); expect(a1).toBeGreaterThan(6900); // מהעמוד החיצוני לפנימי
    expect(b0).toBeLessThan(7100); expect(b1).toBeGreaterThan(10700); // מהעמוד הפנימי עד הרכס (11.0)
  });
});
