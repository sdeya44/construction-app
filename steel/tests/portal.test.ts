import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { defaultPortal } from '../src/geometry/portal';
import { SECTION_TEMPLATES } from '../src/model/section';

describe('אגד B — קשיחות לאורך בקיר', () => {
  const mk = (patch: object = {}) => {
    const b = defaultBuilding();
    b.bracing.walls = { ...b.bracing.walls, enabled: true, type: 'portal', portal: defaultPortal(), ...patch };
    return generate(newProject('t', b));
  };
  const beams = (d: any) => d.members.filter((m: any) => /^BB\.[^K]*$/.test(m.id));
  const diags = (d: any) => d.members.filter((m: any) => /^BB\..*\.K[12]$/.test(m.id));
  it('אגד במפתחים שנבחרו, וקורת אגד רציפה בשאר המפתחים של אותו ציר', () => {
    const d = mk();
    expect(beams(d).length).toBe(2 * 5); // 2 צירים × 5 מפתחים
    expect(diags(d).length).toBe(2 * 2 * 2); // 2 מפתחים × 2 צירים × 2 אלכסונים
    expect(d.members.some((m) => m.id.startsWith('BR.W'))).toBe(false);
    const bm = beams(d)[0];
    expect(bm.start.z).toBeCloseTo(bm.end.z, 6);
    expect(bm.start.x).toBeCloseTo(bm.end.x, 6);
    // ללא רציפות — רק במפתחי האגד
    const d2 = mk({ portal: { ...defaultPortal(), continuous: false } });
    expect(beams(d2).length).toBe(4);
  });
  it('פרט הלקוח: פח מרותך + לשונית בחריץ, 2 ברגים בכל קצה, לא דרך העמוד; 45°; האלכסונים על ציר העמודים; ללא התנגשויות', () => {
    const d = mk();
    const k = diags(d)[0];
    const a = Math.atan2(Math.abs(k.end.z - k.start.z), Math.abs(k.end.y - k.start.y)) * 180 / Math.PI;
    expect(a).toBeGreaterThan(40); expect(a).toBeLessThan(50);
    const cs = d.connections.filter((c) => c.id.startsWith('C.BB.'));
    expect(cs.length).toBe(10 * 2 + 4 * 4);
    for (const c of cs) {
      expect(c.bolts.length).toBe(2);
      expect(c.bolts.every((b) => Math.abs(b.axis.x) > 0.999)).toBe(true);
      expect(c.bolts.every((b) => b.location === 'site' && !b.holesIn.some((h) => h.includes('.COL.')))).toBe(true);
      expect(c.welds.every((w) => w.location === 'shop')).toBe(true);
      expect(c.parts.some((p) => p.endsWith('.PL')) && c.parts.some((p) => p.endsWith('.T'))).toBe(true);
    }
    expect(k.start.x).toBeCloseTo(0, 6); // ציר האלכסון על ציר העמודים
    expect(beams(d)[0].start.x).toBeCloseTo(12, 6); // קורת האגד מוסטת בעובי פח
    expect(d.issues.filter((i) => i.code === 'CLASH')).toEqual([]);
  });
  it('אגד בכל ציר: ציר פנימי בחתך מודולרי', () => {
    const p = newProject('t', defaultBuilding());
    p.building.section = SECTION_TEMPLATES.find((t) => t.id === 'gable-inner')!.make();
    const mid = [...p.building.section.lines].sort((a, b) => a.x - b.x)[1].id;
    p.building.bracing.walls = { ...p.building.bracing.walls, enabled: true, type: 'portal', portal: defaultPortal(), byLine: { [mid]: [2] } };
    const d = generate(p);
    expect(diags(d).length).toBe(2);
    expect(beams(d).every((m: any) => m.id.endsWith(`.${mid}`))).toBe(true);
    expect(d.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });
});
