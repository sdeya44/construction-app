import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { aabb, aabbOverlap, clash } from '../src/geometry/clash';
import { computeFabrication } from '../src/fab/marks';
import { computeBom } from '../src/fab/bom';
import { numberParts } from '../src/commands/commands';
import { buildSheet, drawingCatalog } from '../src/drawing/views';
import { defaultKneeBraces } from '../src/geometry/knee';
import { defaultCladding, claddingTakeoff } from '../src/geometry/cladding';
import { SECTION_TEMPLATES } from '../src/model/section';
import type { BuildingParams, PlanShape } from '../src/model/types';

const cases: [string, () => BuildingParams, PlanShape][] = [
  ['gable skew 0', () => defaultBuilding(), { shape: 'skew', skewDeg: 0 }],
  ['gable skew 15', () => defaultBuilding(), { shape: 'skew', skewDeg: 15 }],
  ['gable skew -20', () => defaultBuilding(), { shape: 'skew', skewDeg: -20 }],
  ['gable taper +3000', () => defaultBuilding(), { shape: 'taper', taperLine: 'last', taperEnd: 3000 }],
  ['mono-multi taper first -2000', () => ({ ...defaultBuilding(), section: SECTION_TEMPLATES.find((t) => t.id === 'mono-multi')!.make() }), { shape: 'taper', taperLine: 'first', taperEnd: -2000 }],
];

describe('תוכנית לא מלבנית', () => {
  for (const [name, mk, plan] of cases) {
    it(name, () => {
      const b = mk();
      b.plan = plan;
      b.kneeBraces = { ...defaultKneeBraces(), enabled: true };
      b.cladding = defaultCladding();
      b.cladding.walls.enabled = true;
      b.bracing.walls.enabled = true;
      b.bracing.purlinTies.enabled = true;
      const p = newProject(name, b);
      const d = generate(p);
      expect(d.plan).toBeTruthy();
      expect(d.issues.filter((i) => i.severity === 'error').map((i) => i.message)).toEqual([]);
      expect(d.members.some((m) => [m.start, m.end].some((q) => !Number.isFinite(q.x + q.y + q.z)))).toBe(false);
      // חלקי חיבור מול מארחים: אין חדירה משמעותית
      const welded = new Set<string>();
      for (const c of d.connections) for (const w of c.welds) welded.add([...w.between].sort().join('|'));
      const bad: string[] = [];
      const small = d.members.filter((m) => (m.kind === 'plate' || m.kind === 'cleat') && m.connId);
      const big = d.members.filter((m) => ['column', 'rafter', 'purlin', 'brace', 'beam'].includes(m.kind));
      for (const a of small) for (const o of big) {
        if (welded.has([a.id, o.id].sort().join('|')) || !aabbOverlap(aabb(a), aabb(o))) continue;
        const k = clash(a, o); if (k && k.depth > 3.5) bad.push(`${a.id} ↔ ${o.id} ${k.depth.toFixed(1)}`);
      }
      console.log(name, 'clash>3:', bad.length, bad.slice(0, 6));
      expect(bad.length).toBeLessThan(5);
      const pn = numberParts().run(p); const fab = computeFabrication(pn, d); const bom = computeBom(d, fab);
      expect(fab.parts.every((x) => x.length > 0)).toBe(true);
      for (const def of drawingCatalog(pn, d, fab)) buildSheet(def, pn, d, fab, bom);
      const t = claddingTakeoff(pn, d)!;
      expect(t.surfaces.length).toBeGreaterThan(0);
    }, 120000);
  }
});
