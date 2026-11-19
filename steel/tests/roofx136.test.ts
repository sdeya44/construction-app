import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';

const base = () => { const p = newProject('t', defaultBuilding()); p.building.bracing.roof.enabled = true; p.building.bracing.roof.bays = [0]; return p; };
const xs = (d: ReturnType<typeof generate>) => d.members.filter((m) => m.id.startsWith('BR.R1.') && m.kind === 'brace');

describe('קושרות גג 1.36: פנלים לא שווים וקונזולה', () => {
  it('split=purlins: צמתי X על פטות', () => {
    const p = base();
    const seg0 = generate(p).roofSegments![0].id;
    p.building.bracing.roof.segCount = { [`0|${seg0}`]: 3 };
    const eq = generate(p);
    p.building.bracing.roof.split = 'purlins';
    const sn = generate(p);
    const ends = (d: typeof eq) => xs(d).filter((m) => m.id.includes(`.${seg0}.`)).flatMap((m) => [m.start.x, m.end.x]);
    const px = sn.members.filter((m) => m.purlin).map((m) => m.start.x);
    const near = (x: number) => Math.min(...px.map((q) => Math.abs(q - x)));
    const inner = (d: typeof eq) => { const e = ends(d); const lo = Math.min(...e), hi = Math.max(...e); return e.filter((x) => x > lo + 300 && x < hi - 300); };
    expect(inner(eq).length).toBeGreaterThan(0);
    // בחלוקה שווה לפחות צומת אחד רחוק מפטה; בחלוקה לפי פטות — כולם קרובים (בתוך מחצית מרווח הקצוות + חתך)
    expect(Math.max(...inner(sn).map(near))).toBeLessThan(260);
    expect(inner(sn).join()).not.toBe(inner(eq).join());
  });
  it('toEave: קטע נוסף ברצועת הקונזולה', () => {
    const p = base();
    p.building.rafterOverhangLeft = 2500;
    const n0 = generate(p).roofSegments!.length;
    p.building.bracing.roof.toEave = true;
    const d = generate(p);
    expect(d.roofSegments!.length).toBe(n0 + 1);
    expect(d.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });
});
