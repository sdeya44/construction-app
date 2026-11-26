import { it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
it('dbg', () => {
  const mk = (r: boolean) => { const p = newProject('c', defaultBuilding()); p.settings.autoSplice = false; p.splices['PL.L.03'] = [7000]; if (r) p.building.purlins.splice = { ...p.building.purlins.splice, engine: 'recipe' }; return p; };
  for (const r of [false, true]) {
    const d = generate(mk(r));
    const c = d.connections.find((x) => x.id === 'C.PS.PL.L.03.1')!;
    console.log(r, c.type, c.parts.join(','), c.bolts.length);
    for (const id of c.parts.filter((x) => !x.includes('.B'))) { const m = d.byId.get(id)!; console.log(id, m?.profile, JSON.stringify(m?.start, (k, v) => typeof v === 'number' ? Math.round(v * 10) / 10 : v), JSON.stringify(m?.end, (k, v) => typeof v === 'number' ? Math.round(v * 10) / 10 : v), JSON.stringify(m?.refUp)); }
    for (const b of c.bolts.slice(0, 4)) console.log(b.id, JSON.stringify(b.p, (k, v) => typeof v === 'number' ? Math.round(v * 10) / 10 : v), JSON.stringify(b.axis), b.length, b.grip);
    console.log(d.issues.filter((i) => i.severity === 'error').slice(0, 3).map((i) => i.message));
  }
});
