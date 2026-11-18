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

describe('מזחלה — זוויתן על הווב, מפתחים וירידות', () => {
  const mk = (spec: object = {}, perRun?: object) => {
    const b = defaultBuilding();
    b.cladding = defaultCladding();
    b.cladding.gutter = { ...b.cladding.gutter, enabled: true, spec, ...(perRun ? { perRun } : {}) } as typeof b.cladding.gutter;
    return newProject('g', b);
  };
  it('ברירת מחדל: זוויתן בחפיפה על הווב, ללא התנגשות; דופן פנימית מעל הפטה', () => {
    const d = generate(mk());
    expect(d.issues.filter((i) => i.severity === 'error').map((i) => i.message)).toEqual([]);
    const gb = d.connections.filter((c) => c.type === 'gutter');
    expect(gb.length).toBeGreaterThan(0);
    for (const c of gb) {
      const raf = d.byId.get(c.members[0]!)!;
      for (const pid of c.parts) { const k = clash(d.byId.get(pid)!, raf); expect(k?.depth ?? 0).toBeLessThan(0.6); }
    }
    for (const sl of ['horizontal', 'roof']) {
      const d2 = generate(mk({ bracketSlope: sl, bracketOffset: -150 }));
      expect(d2.issues.filter((i) => i.severity === 'error').map((i) => i.message)).toEqual([]);
    }
  });
  it('מזחלה רק בחלק מהמפתחים וירידות לפי בחירה', () => {
    const all = generate(mk()).connections.filter((c) => c.type === 'gutter').length;
    const p = mk({}, { L: { bays: [true, true, false, false, true], downpipes: [0, 2] } });
    const d = generate(p);
    expect(d.connections.filter((c) => c.type === 'gutter').length).toBeLessThan(all);
    const t = claddingTakeoff(p, d)!;
    expect(t.gutters.length).toBeGreaterThan(1);
  });
});
import { claddingTakeoff } from '../src/geometry/cladding';

import { gutterRuns, gutterSurfaces } from '../src/geometry/gutter';
import { SECTION_TEMPLATES as TPL2 } from '../src/model/section';
describe('מזחלות בגג מדורג ושן מסור — כל המזחלות ניתנות לבחירה; תחתית משופעת', () => {
  for (const id of ['sawtooth', 'stepped', 'twin-gable', 'butterfly']) {
    it(id, () => {
      const b = defaultBuilding();
      b.section = TPL2.find((t) => t.id === id)!.make();
      b.cladding = defaultCladding();
      const p = newProject(id, b);
      const d = generate(p);
      const runs = gutterRuns(b, d.section!, d.members);
      expect(runs.length).toBeGreaterThan(0);
      expect(runs.every((r) => !!r.planeId)).toBe(true);
      // ביטול מפתח 2 בכל המזחלות ⇒ כל מזחלה מתפצלת לשני מקטעים
      b.cladding.gutter.perRun = Object.fromEntries(runs.map((r) => [r.planeId!, { bays: [true, false, true, true, true] }]));
      const runs2 = gutterRuns(b, d.section!, generate(newProject(id, b)).members);
      expect(runs2.length).toBe(2 * new Set(runs.map((r) => r.planeId)).size);
    });
  }
  it('תושבת בשיפוע הגג ⇒ תחתית המזחלה בשיפוע', () => {
    const b = defaultBuilding(); b.cladding = defaultCladding();
    b.cladding.gutter.spec = { bracketSlope: 'roof' };
    const d = generate(newProject('s', b));
    expect(d.issues.filter((i) => i.severity === 'error').map((i) => i.message)).toEqual([]);
    const r = gutterRuns(b, d.section!, d.members).find((x) => x.kind === 'eave')!;
    expect(r.bottomSlope).toBeLessThan(0);
    const sf = gutterSurfaces(b, [r]).filter((x) => x.kind === 'gutter');
    const zs = sf.flatMap((x) => x.pts.map((q) => Math.round(q.z)));
    expect(Math.min(...zs)).toBeLessThan(r.zBottom - 5);
  });
});
