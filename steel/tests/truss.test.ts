import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { defaultTrussSpec, patternCells, trussUtil } from '../src/geometry/truss';
import { SECTION_TEMPLATES } from '../src/model/section';
import { computeFabrication } from '../src/fab/marks';

const errs = (d: ReturnType<typeof generate>) => d.issues.filter((i) => i.severity === 'error').map((i) => i.message);

describe('מסבכים', () => {
  it('TR-U1: מסבכי גג — תבניות וצורות, דו-שיפועי וחד-שיפועי, 18/30 מ\' — ללא שגיאות', () => {
    for (const [w, shape, pat, mono] of [[18000, 'flat', 'warren-v', false], [18000, 'parallel', 'pratt', false], [30000, 'flat', 'howe', false], [18000, 'flat', 'warren', true]] as const) {
      const b = defaultBuilding(); b.width = w;
      if (mono) b.section = SECTION_TEMPLATES.find((t) => t.id === 'mono-2')!.make() as never;
      const spec = defaultTrussSpec(w / 1500, 1200, { top: b.rafterProfile });
      Object.assign(spec, patternCells(pat, spec.panels), { pattern: pat });
      b.roofTruss = { enabled: true, frames: 'all', shape, spec };
      const d = generate(newProject('x', b));
      expect(errs(d)).toEqual([]);
      expect(d.members.filter((m) => m.id.startsWith('TR.')).length).toBeGreaterThan(b.frames.length * 8);
      expect(d.members.some((m) => m.id.startsWith('KB.'))).toBe(false);
      // כל החלקים קצרים מאורך המוט
      expect(d.parts.every((p) => p.length <= 12000 + 1)).toBe(true);
    }
  });
  it('TR-U2: מסבך גג — מכלול אחד לכל חצי מסבך (קורת גג + חגורה + מילוי), לא מכלול ענק', () => {
    const b = defaultBuilding();
    b.roofTruss = { enabled: true, frames: 'all', shape: 'flat', spec: defaultTrussSpec(12, 1200, { top: b.rafterProfile }) };
    const p = newProject('x', b); const d = generate(p); const fab = computeFabrication(p, d);
    const asm = fab.assemblies.filter((a) => a.main.includes('.RAF.'));
    expect(asm.length).toBe(b.frames.length * 2);
    expect(asm.every((a) => a.parts.length > 8)).toBe(true);
  });
  it('TR-U3: מסבך נושא בדילול עמודים — X, ריק, חיבור המשך ידני — ללא שגיאות', () => {
    const b = defaultBuilding(); const f = [...b.frames].sort((x, y) => x.y - y.y);
    const spec = defaultTrussSpec(8, 1200);
    spec.cells[3] = 'X'; spec.cells[4] = 'X'; spec.cells[6] = ''; spec.splice = [3];
    b.transfers = [{ id: 'T1', lineId: 'L', from: f[0].id, to: f[4].id, removed: [f[1].id, f[2].id, f[3].id], profile: 'HEA160', support: 'A2', seat: 'B1', kind: 'truss', truss: spec }];
    const d = generate(newProject('x', b));
    expect(errs(d)).toEqual([]);
    expect(d.connections.filter((c) => c.id.startsWith('C.RS.TB.T1')).length).toBe(2);
    expect(d.members.filter((m) => m.id.startsWith('TB.T1.TR')).length).toBeGreaterThan(10);
  });
  it('TR-U4: הערכת ניצול — גובה כפול ⇒ כוח בחגורה חצי', () => {
    const s1 = defaultTrussSpec(8, 1000), s2 = { ...s1, depth: 2000 };
    const u1 = trussUtil(s1, 24000, { q: 10 }), u2 = trussUtil(s2, 24000, { q: 10 });
    expect(u2[1].force).toBeCloseTo(u1[1].force / 2, 3);
  });
});
