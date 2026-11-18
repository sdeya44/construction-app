import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { aabb, aabbOverlap, clash } from '../src/geometry/clash';
import { defaultRodEnd } from '../src/geometry/bracing';
import { computeFabrication } from '../src/fab/marks';
import { computeBom } from '../src/fab/bom';
import { numberParts } from '../src/commands/commands';

describe('קושרת X בגג — פרט מוט הברגה (תוכנית 110)', () => {
  const mk = () => {
    const b = defaultBuilding();
    b.bracing.roof = { ...b.bracing.roof, profile: 'L50x50x4', endDetail: 'rod', rod: defaultRodEnd() };
    return newProject('rod', b);
  };
  it('מוטות, דסקיות, חור אובלי בקורה ואין התנגשויות', () => {
    const p = mk();
    const d = generate(p);
    const errs = d.issues.filter((i) => i.severity === 'error');
    expect(errs.map((e) => e.message)).toEqual([]);
    const rods = d.members.filter((m) => m.id.endsWith('.ROD'));
    expect(rods.length).toBeGreaterThan(0);
    const ends = d.connections.filter((c) => c.bolts.some((b) => b.rod));
    expect(ends.length).toBe(rods.length);
    // התנגשויות: כל חלקי הקושרת מול כל האלמנטים (חוץ מהמוט דרך הווב של המארח, הדסקית הצמודה לווב, והזוויתן שאליו המוט מרותך)
    const parts = d.members.filter((m) => m.id.startsWith('BR.R') || m.id.startsWith('C.BR.R'));
    const others = d.members.filter((m) => ['rafter', 'column', 'purlin', 'cleat', 'plate', 'brace'].includes(m.kind));
    const bad: string[] = [];
    for (const a of parts) for (const o of others) {
      if (a.id === o.id || /\.B\d+\.S$/.test(a.id) || !aabbOverlap(aabb(a), aabb(o))) continue;
      const c = d.connections.find((x) => x.parts.includes(a.id) || x.parts.includes(o.id));
      if (c && (c.members.includes(o.id) || c.members.includes(a.id)) && (c.parts.includes(a.id) || c.parts.includes(o.id))) continue;
      if (a.id.split('.').slice(0, 4).join('.') === o.id.split('.').slice(0, 4).join('.')) continue;
      const k = clash(a, o);
      if (k && k.depth > 0.5) bad.push(`${a.id} ↔ ${o.id} ${k.depth.toFixed(1)}`);
    }
    expect(bad).toEqual([]);
    const pn = numberParts().run(p);
    const fab = computeFabrication(pn, d);
    const raf = fab.parts.find((x) => x.holes.some((h) => h.slot));
    expect(raf).toBeTruthy();
    const bom = computeBom(d, fab);
    expect(bom.bolts.some((r) => r.desc.includes('מוט הברגה'))).toBe(true);
  });
  it('כיסוי חלקי: קטע מושבת', () => {
    const p = mk();
    const all = generate(p).members.filter((m) => m.id.endsWith('.ROD')).length;
    p.building.bracing.roof.segOff = ['0|L'];
    const some = generate(p).members.filter((m) => m.id.endsWith('.ROD')).length;
    expect(some).toBeLessThan(all);
  });
});

import { defaultCladding } from '../src/geometry/cladding';
import { buildSheet, drawingCatalog } from '../src/drawing/views';
describe('מזחלה — תמיכת פלטה + זוויתן אופקי', () => {
  it('נבנית בלי התנגשות ושגיאות, גיליון K-02 נבנה', () => {
    const b = defaultBuilding();
    b.cladding = defaultCladding();
    b.cladding.gutter = { ...b.cladding.gutter, enabled: true, spec: { support: 'plate', plateT: 8, inner: 180, bottom: 250, outer: 260, lip: 30, fall: 40 } };
    const p = newProject('g', b);
    const d = generate(p);
    expect(d.issues.filter((i) => i.severity === 'error').map((i) => i.message)).toEqual([]);
    const pl = d.members.filter((m) => m.id.startsWith('C.GB.') && m.id.endsWith('.PL'));
    expect(pl.length).toBeGreaterThan(0);
    for (const m of pl) { const raf = d.byId.get(d.connections.find((c) => c.parts.includes(m.id))!.members[0]!)!; const k = clash(m, raf); expect(k?.depth ?? 0).toBeLessThan(0.6); }
    const pn = numberParts().run(p); const fab = computeFabrication(pn, d); const bom = computeBom(d, fab);
    const def = drawingCatalog(pn, d, fab).find((x) => x.type === 'gutter')!;
    expect(buildSheet(def, pn, d, fab, bom).ents.length).toBeGreaterThan(10);
  });
});
