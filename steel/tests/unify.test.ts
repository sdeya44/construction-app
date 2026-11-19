import { describe, expect, it } from 'vitest';
import { generate } from '../src/geometry/generate';
import { boltGroups, partGroups } from '../src/fab/unify';
import { computeFabrication } from '../src/fab/marks';
import { defaultBuilding, newProject } from '../src/model/defaults';
const defaultProject = () => newProject('t', defaultBuilding());

describe('האחדה', () => {
  it('ברגים: אשכולות לפי סף, והחלה מאחדת אורכים', () => {
    const p = defaultProject();
    const d = generate(p);
    const lens = (dd: ReturnType<typeof generate>) => new Set(dd.connections.flatMap((c) => c.bolts.filter((b) => b.standard === 'ISO 4017' && !b.rod).map((b) => `${b.d}|${b.length}`)));
    const before = lens(d).size;
    const g = boltGroups(d, 20);
    for (const x of g) { expect(x.to).toBe(Math.max(...x.lengths.map((l) => l.length))); expect(x.to - x.lengths[0].length).toBeLessThanOrEqual(20); }
    const d2 = generate({ ...p, settings: { ...p.settings, boltUnify: 20 } });
    const after = lens(d2).size;
    expect(after).toBe(before - g.reduce((s, x) => s + x.lengths.length - 1, 0));
    expect(boltGroups(d2, 20)).toHaveLength(0);
  });
  it('חלקים: קבוצות כמעט־זהות באותו חתך', () => {
    const p = defaultProject();
    const d = generate(p);
    const fab = computeFabrication(p, d);
    for (const g of partGroups(fab, 50)) {
      expect(g.marks.length).toBeGreaterThan(1);
      expect(g.diff).toBeLessThanOrEqual(50);
      expect(new Set(g.marks.map((m) => m.mark)).size).toBe(g.marks.length);
    }
  });
});
