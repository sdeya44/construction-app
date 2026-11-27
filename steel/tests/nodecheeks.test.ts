/**
 * CHEEK — לחיות צומת במסבך (F10, `geometry/truss.ts`): ברירת מחדל ללא שינוי; כשמופעל — זוג פלטות בכל צומת משני צדי הצומת,
 * ריתוכים לחגורה ולאלכסונים, אזהרה כשהלחי חורגת מרוחב החגורה; גיליון תוכנית המסבך כולל אותן.
 */
import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { defaultTrussSpec } from '../src/geometry/truss';
import { computeFabrication } from '../src/fab/marks';
import { computeBom } from '../src/fab/bom';
import { numberParts } from '../src/commands/commands';
import { buildSheet, drawingCatalog } from '../src/drawing/views';
import type { BuildingParams, TrussSpec } from '../src/model/types';

const roof = (patch?: Partial<TrussSpec>): BuildingParams => { const b = defaultBuilding(); b.roofTruss = { enabled: true, frames: [b.frames[0]!.id], shape: 'flat', spec: { ...defaultTrussSpec(8, 1000, { top: b.rafterProfile }), ...patch } }; return b; };
const model = (b: BuildingParams) => generate(newProject('c', b));
const cheeks = (d: ReturnType<typeof model>) => d.members.filter((m) => /^TR\..*\.G\d+[TB][12]$/.test(m.id));

describe('CHEEK לחיות צומת', () => {
  it('CHEEK-01: כבוי / חסר — אין לחיות, והמודל זהה (אותם חלקים וריתוכים)', () => {
    const a = model(roof()), b = model(roof({ nodeCheeks: { enabled: false, t: 8, h: 100 } }));
    expect(cheeks(a)).toEqual([]); expect(cheeks(b)).toEqual([]);
    expect(b.members.map((m) => m.id).join()).toBe(a.members.map((m) => m.id).join());
    expect(b.connections.find((c) => c.id.startsWith('C.TR.'))!.welds.length).toBe(a.connections.find((c) => c.id.startsWith('C.TR.'))!.welds.length);
  });
  it('CHEEK-02: מופעל — שתי לחיות לכל צומת (תחתון ועליון), משני צדי מישור המסבך, בחיבור המסבך; אין שגיאות חדשות', () => {
    const base = model(roof());
    const d = model(roof({ nodeCheeks: { enabled: true, t: 8, h: 100 } }));
    const cs = cheeks(d);
    expect(cs.length).toBeGreaterThan(20); expect(cs.length % 2).toBe(0);
    for (const m of cs) { expect(m.kind).toBe('plate'); expect(m.profile).toBe('PL100x8'); }
    // זוגות: אותו מקום לאורך, y הפוך סביב מישור המסבך
    const y0 = base.members.find((m) => m.id.startsWith('F1.COL'))!.start.y;
    const g = cs.filter((m) => m.id.endsWith('1')), h = cs.filter((m) => m.id.endsWith('2'));
    expect(g.length).toBe(h.length);
    for (let i = 0; i < g.length; i++) { expect(Math.round((g[i]!.start.y - y0) + (h[i]!.start.y - y0))).toBe(0); expect(g[i]!.start.y).not.toBeCloseTo(h[i]!.start.y, 0); }
    const c = d.connections.find((x) => x.id.startsWith('C.TR.'))!;
    expect(c.parts.length).toBe(base.connections.find((x) => x.id.startsWith('C.TR.'))!.parts.length + cs.length);
    expect(c.welds.length).toBeGreaterThan(base.connections.find((x) => x.id.startsWith('C.TR.'))!.welds.length + cs.length);
    const errs = (m: typeof d) => m.issues.filter((i) => i.severity === 'error').map((i) => i.code);
    expect(errs(d)).toEqual(errs(base));
  });
  it('CHEEK-03: עובי לחי גדול מרוחב החגורה — אזהרת TRUSS_NODE', () => {
    const d = model(roof({ nodeCheeks: { enabled: true, t: 40, h: 100 }, profiles: { top: 'IPE300', bottom: 'RHS100x50x4', endDiag: 'SHS100x5', diag: 'SHS80x4', vert: 'SHS60x4' } }));
    expect(d.issues.some((i) => i.code === 'TRUSS_NODE')).toBe(true);
  });
  it('CHEEK-04: גיליון תוכנית המסבך נבנה עם הלחיות (הסימונים מופיעים בטבלה)', () => {
    const b = roof({ nodeCheeks: { enabled: true, t: 8, h: 100 } });
    const p = numberParts().run(newProject('c', b)); const d = generate(p); const fab = computeFabrication(p, d); const bom = computeBom(d, fab);
    const def = drawingCatalog(p, d, fab).find((x) => x.type === 'truss-unit')!;
    const sh = buildSheet(def, p, d, fab, bom);
    expect(sh.ents.some((e) => e.k === 'text' && (e as { s: string }).s === 'PL100x8')).toBe(true);
  }, 120000);
  it('CHEEK-05: מסבך "מספריים", מקביל ומסבך נושא — לחיות בלי שגיאות נוספות', () => {
    const errs = (d: ReturnType<typeof model>) => d.issues.filter((i) => i.severity === 'error').map((i) => i.code);
    for (const shape of ['parallel', 'scissor'] as const) {
      const mk = (cheek: boolean) => { const b = roof(cheek ? { nodeCheeks: { enabled: true, t: 8, h: 100 } } : undefined); b.roofTruss!.shape = shape; b.roofTruss!.rise = 1200; return model(b); };
      const d = mk(true);
      expect(cheeks(d).length, shape).toBeGreaterThan(10);
      expect(errs(d), shape).toEqual(errs(mk(false)));
    }
    const carry = (cheek: boolean) => { const b = defaultBuilding(); const f = [...b.frames].sort((x, y) => x.y - y.y); const spec = defaultTrussSpec(8, 1200); if (cheek) spec.nodeCheeks = { enabled: true, t: 8, h: 100 }; b.transfers = [{ id: 'T1', lineId: 'L', from: f[0]!.id, to: f[4]!.id, removed: [f[1]!.id, f[2]!.id, f[3]!.id], profile: 'HEA160', support: 'A2', seat: 'B1', kind: 'truss', truss: spec }]; return model(b); };
    const dc = carry(true);
    expect(dc.members.filter((m) => /^TB\.T1\.TR\.G\d+[TB][12]$/.test(m.id)).length).toBeGreaterThan(10);
    expect(errs(dc)).toEqual(errs(carry(false)));
  }, 120000);
});
