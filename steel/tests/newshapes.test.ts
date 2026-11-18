import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { SECTION_TEMPLATES } from '../src/model/section';
import { computeFabrication } from '../src/fab/marks';
import { computeBom } from '../src/fab/bom';
import { numberParts } from '../src/commands/commands';
import { buildSheet, drawingCatalog } from '../src/drawing/views';
import { defaultKneeBraces } from '../src/geometry/knee';
import { defaultCladding } from '../src/geometry/cladding';

describe('תבניות חדשות: מוניטור, אסם, צמודה לקיר', () => {
  for (const id of ['monitor', 'barn', 'lean-to']) {
    it(id, () => {
      const b = defaultBuilding();
      b.section = SECTION_TEMPLATES.find((t) => t.id === id)!.make();
      b.kneeBraces = { ...defaultKneeBraces(), enabled: true };
      b.cladding = defaultCladding();
      b.bracing.walls.enabled = true;
      const p = newProject(id, b);
      const d = generate(p);
      const errs = d.issues.filter((i) => i.severity === 'error').map((i) => `${i.code} ${i.message}`);
      console.log(id, d.members.length, [...new Set(d.issues.filter((i) => i.severity === 'warning').map((i) => i.code))]);
      expect(errs).toEqual([]);
      const pn = numberParts().run(p); const fab = computeFabrication(pn, d); const bom = computeBom(d, fab);
      for (const def of drawingCatalog(pn, d, fab)) buildSheet(def, pn, d, fab, bom);
      if (id === 'lean-to') {
        expect(d.members.some((m) => m.id.includes('.COL.W'))).toBe(false);
        expect(d.connections.some((c) => c.id.startsWith('C.WALL.'))).toBe(true);
      }
    }, 60000);
  }
});

import { defaultHaunch } from '../src/geometry/haunch';
import { aabb, aabbOverlap, clash } from '../src/geometry/clash';
describe('מכפל בראש העמוד', () => {
  for (const tpl of ['classic', 'mono-multi', 'gable-inner', 'monitor']) {
    it(tpl, () => {
      const b = defaultBuilding();
      if (tpl !== 'classic') b.section = SECTION_TEMPLATES.find((t) => t.id === tpl)!.make();
      b.haunch = defaultHaunch();
      b.bracing.walls.enabled = true;
      const p = newProject(tpl, b);
      const d = generate(p);
      expect(d.issues.filter((i) => i.severity === 'error').map((i) => i.message)).toEqual([]);
      const hn = d.members.filter((m) => m.id.startsWith('C.HN.'));
      expect(hn.length).toBeGreaterThan(0);
      const welded = new Set<string>();
      for (const c of d.connections) for (const w of c.welds) welded.add([...w.between].sort().join('|'));
      const bad: string[] = [];
      for (const a of hn) for (const o of d.members) {
        if (a.id === o.id || o.kind === 'bolt' || !aabbOverlap(aabb(a), aabb(o)) || welded.has([a.id, o.id].sort().join('|')) || (a.connId && a.connId === o.connId)) continue;
        const k = clash(a, o); if (k && k.depth > 0.5) bad.push(`${a.id} ↔ ${o.id} ${k.depth.toFixed(1)}`);
      }
      expect(bad).toEqual([]);
      const fab = computeFabrication(numberParts().run(p), d);
      const w = fab.parts.find((x) => x.memberId.endsWith('.WEB'))!;
      const asm = fab.assemblies.find((x) => x.id === w.assembly)!;
      expect(asm.parts.some((id) => id.includes('.RAF'))).toBe(true);
    });
  }
});
