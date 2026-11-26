import { it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { computeFabrication } from '../src/fab/marks';
import { computeBom } from '../src/fab/bom';
import { buildSheet, drawingCatalog } from '../src/drawing/views';
it('dbg', () => {
  for (const mode of ['embedded', 'bolted']) {
    const mk = (r: boolean) => { const p = newProject('c', defaultBuilding()); p.connectionDefaults.base = { ...p.connectionDefaults.base, mode } as never; if (r) p.building.baseEngine = 'recipe'; return p; };
    const run = (p: ReturnType<typeof mk>) => { const d = generate(p), f = computeFabrication(p, d), bom = computeBom(d, f); return new Map(drawingCatalog(p, d, f).map((df) => [df.id, buildSheet(df, p, d, f, bom)])); };
    const a = run(mk(false)), b = run(mk(true));
    for (const id of ['D-ASM-BP2', 'D-ANCHOR', 'D-FRAME-F1']) {
      const t = (m: typeof a) => m.get(id)?.ents.filter((e) => e.k === 'text' && e.layer !== 'TITLE' && e.layer !== 'MARK').map((e) => (e as { s: string }).s) ?? [];
      const ca = new Map<string, number>(), cb = new Map<string, number>(); t(a).forEach((x) => ca.set(x, (ca.get(x) ?? 0) + 1)); t(b).forEach((x) => cb.set(x, (cb.get(x) ?? 0) + 1));
      for (const k of new Set([...ca.keys(), ...cb.keys()])) if (ca.get(k) !== cb.get(k)) console.log('RES', mode, id, JSON.stringify(k), ca.get(k) ?? 0, '→', cb.get(k) ?? 0);
    }
  }
});
