import { describe, expect, it } from 'vitest';
import { defaultBuilding, defaultRidgeReinf, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { SECTION_TEMPLATES } from '../src/model/section';

const geo = () => newProject('t', defaultBuilding());

describe('סבכה אופקית RHS במקום X', () => {
  it('מוטות RHS100/100/5 בכל צומת, אלכסוני RHS80/80/4 (N); פח לכל צומת מרותך לווב; 2×M16 בכל לשונית; ללא התנגשויות', () => {
    const p = geo();
    p.building.bracing.roof.type = 'rhs';
    const d = generate(p);
    const hb = d.members.filter((m) => m.id.startsWith('HB.') && m.kind === 'brace');
    expect(hb.filter((m) => m.profile === 'RHS100x100x5').length).toBe(2 * 2 * 2); // 2 מפתחים × 2 שיפועים × 2 מוטות
    expect(hb.filter((m) => m.profile === 'RHS80x80x4').length).toBe(2 * 2 * 1);
    expect(d.members.some((m) => m.id.startsWith('BR.R'))).toBe(false); // ה-X הוחלף
    const node = d.connById.get('C.HB.R1.L.A1')!;
    expect(node.bolts.length).toBe(4); // מוט + אלכסון, 2 ברגים כל אחד
    expect(node.bolts.every((b) => b.d === 16 && b.location === 'site')).toBe(true);
    expect(node.welds.some((w) => w.location === 'shop' && w.between[0] === 'F1.RAF.L')).toBe(true);
    expect(d.issues.filter((i) => i.code === 'CLASH' || i.code === 'BRACE_SHORT')).toEqual([]);
  });
  it('גם בחתך מודולרי (גג מדורג)', () => {
    const p = geo();
    p.building.section = SECTION_TEMPLATES.find((t) => t.id === 'stepped')!.make();
    p.building.bracing.roof.type = 'rhs';
    const d = generate(p);
    expect(d.issues.filter((i) => i.severity === 'error' || i.code === 'CLASH')).toEqual([]);
    expect(d.members.filter((m) => m.id.startsWith('HB.') && m.kind === 'brace').length).toBeGreaterThan(0);
  });
});

describe('חיזוק רכס', () => {
  it('שיטת הפלטה: פלטות הקצה מוגבהות, 3 שורות ברגים, פלטת חיזוק משולשת מתחת לכל קורה (ריתוך מסגריה)', () => {
    const p = geo();
    p.building.ridgeReinf = { ...defaultRidgeReinf(), type: 'plate' };
    const d = generate(p);
    const c = d.connById.get('C.RIDGE.F2')!;
    expect(c.bolts.length).toBe(6);
    expect(c.parts).toContain('C.RIDGE.F2.ST1');
    expect(c.parts).toContain('C.RIDGE.F2.ST2');
    expect(c.welds.filter((w) => w.between[1].includes('.ST')).every((w) => w.location === 'shop')).toBe(true);
    const plate = d.byId.get('C.RIDGE.F2.PL1')!;
    expect(plate.profile.startsWith('PL160x')).toBe(true);
    expect(d.issues.filter((i) => i.code === 'CLASH')).toEqual([]);
  });
  it('שיטת הפרופיל האופקי: IPE160 בין שתי הקורות מתחת לרכס, מוברג לפחים (4 ברגים בכל קצה)', () => {
    const p = geo();
    p.building.ridgeReinf = { ...defaultRidgeReinf(), type: 'tie' };
    const d = generate(p);
    const t = d.byId.get('RT.F2')!;
    expect(t.profile).toBe('IPE160');
    expect(t.start.z).toBeCloseTo(t.end.z, 6); // אופקי
    expect(t.start.x).toBeLessThan(9000); expect(t.end.x).toBeGreaterThan(9000);
    const c = d.connById.get('C.RT.F2')!;
    expect(c.type).toBe('ridge-tie');
    expect(c.bolts.length).toBe(8);
    expect(c.welds.every((w) => w.location === 'shop')).toBe(true);
    expect(d.issues.filter((i) => i.code === 'CLASH' || i.code === 'RIDGE_TIE')).toEqual([]);
  });
});
