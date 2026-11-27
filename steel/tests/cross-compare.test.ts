/**
 * CROSS-01/02: G9 (אתר עוגן) — הצטלבות קושרות X (גג וקירות): פח מילוי + בורג, ובורג בלבד (קושרת מוט הברגה). הקוד הישן (`bracing.ts`) מול המתכונים
 * `braceCrossGussetRecipe()` / `braceCrossRodRecipe()` (דגל `bracing.conn.engine` / `bracing.roof.rod.engine`).
 */
import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { computeFabrication } from '../src/fab/marks';
import { partToNc1 } from '../src/fab/dstv';
import { computeBom } from '../src/fab/bom';
import { buildSheet, drawingCatalog } from '../src/drawing/views';
import { braceCrossGussetRecipe, braceCrossRodRecipe } from '../src/geometry/crossRecipes';
import { defaultRodEnd } from '../src/geometry/bracing';
import type { BoltInfo, DerivedModel, Member, Project } from '../src/model/types';

const TOL = 0.5;
type V = { x: number; y: number; z: number };
const dist = (a: V, b: V) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const dot = (a: V, b: V) => a.x * b.x + a.y * b.y + a.z * b.z;

interface Cfg { name: string; rod?: boolean; mod: (p: Project) => void }
const CFGS: Cfg[] = [
  { name: 'פח מילוי · ברירת מחדל', mod: () => {} },
  { name: 'פח מילוי · L70x7 · M16 · פח 12', mod: (p) => { p.building.bracing.roof.profile = 'L70x7'; p.building.bracing.walls.profile = 'L70x7'; p.building.bracing.conn = { ...p.building.bracing.conn, gussetT: 12, bolt: { ...p.building.bracing.conn.bolt, d: 16 } }; } },
  { name: 'מוט הברגה (בורג הצטלבות)', rod: true, mod: (p) => { p.building.bracing.roof.endDetail = 'rod'; p.building.bracing.roof.rod = defaultRodEnd(); } },
];
const proj = (c: Cfg, recipe: boolean) => {
  const p = newProject('c', defaultBuilding()); c.mod(p);
  if (recipe) { p.building.bracing.conn = { ...p.building.bracing.conn, engine: 'recipe' }; if (p.building.bracing.roof.rod) p.building.bracing.roof.rod = { ...p.building.bracing.roof.rod, engine: 'recipe' }; }
  return p;
};
const oldC = (d: DerivedModel) => d.connections.filter((c) => c.type === 'brace-cross');
const newC = (d: DerivedModel) => d.connections.filter((c) => c.custom && c.custom.site.includes('|p:'));
const plates = (d: DerivedModel, ids: string[]) => ids.map((i) => d.byId.get(i)).filter((m): m is Member => !!m && m.kind === 'plate');

describe('CROSS-01 הצטלבות קושרות: הקוד הישן מול המתכון', () => {
  for (const cfg of CFGS) it(cfg.name, () => {
    const p0 = proj(cfg, false), d0 = generate(p0), p1 = proj(cfg, true), d1 = generate(p1);
    const oc = d0.connections.filter((c) => c.type === 'brace-cross'), nc = newC(d1);
    expect(oc.length).toBeGreaterThan(0);
    expect(oldC(d1).length + nc.length).toBe(oc.length);
    expect(nc.length).toBeGreaterThan(0);
    const bad: string[] = [];
    const inRod = (id: string) => /^C\.BR\.R/.test(id) && cfg.rod;
    void inRod;
    const op = oc.flatMap((c) => plates(d0, c.parts)), np = [...nc, ...oldC(d1)].flatMap((c) => plates(d1, c.parts));
    if (op.length !== np.length) bad.push(`פלטות ${op.length}→${np.length}`);
    const left = [...np];
    for (const o of op) {
      const i = left.findIndex((x) => x.profile === o.profile && dist(x.start, o.start) <= TOL && dist(x.end, o.end) <= TOL && Math.abs(dot(x.refUp, o.refUp)) > 0.999);
      if (i < 0) bad.push(`פלטה ${o.profile} ב-(${o.start.x.toFixed(0)},${o.start.y.toFixed(0)},${o.start.z.toFixed(0)}) לא נמצאה`); else left.splice(i, 1);
    }
    const ob: BoltInfo[] = oc.flatMap((c) => c.bolts), nb: BoltInfo[] = [...nc, ...oldC(d1)].flatMap((c) => c.bolts);
    if (ob.length !== nb.length) bad.push(`ברגים ${ob.length}→${nb.length}`);
    const lb = [...nb];
    for (const o of ob) {
      const i = lb.findIndex((x) => dist(x.p, o.p) <= TOL && x.d === o.d && dot(x.axis, o.axis) > 0.999 && Math.abs(x.length - o.length) <= TOL && Math.abs(x.grip - o.grip) <= 0.01 && x.location === o.location && x.holesIn.length === o.holesIn.length && [...x.holesIn].sort().join() === [...o.holesIn].sort().join());
      if (i < 0) bad.push(`בורג M${o.d} ב-(${o.p.x.toFixed(1)},${o.p.y.toFixed(1)},${o.p.z.toFixed(1)}) לא נמצא`); else lb.splice(i, 1);
    }
    expect(bad.slice(0, 8)).toEqual([]);
    expect(newC(d1).map((c) => c.id).sort()).toEqual(oc.map((c) => c.id).sort());
    const errs = (d: DerivedModel) => d.issues.filter((i) => i.severity === 'error').map((i) => `${i.code} ${i.message}`);
    expect(errs(d1)).toEqual(errs(d0));
    const f0 = computeFabrication(p0, d0), f1 = computeFabrication(p1, d1);
    const ids0 = new Set(oc.flatMap((c) => c.parts)), ids1 = new Set([...nc, ...oldC(d1)].flatMap((c) => c.parts));
    const rel = (f: typeof f0) => f.parts.filter((x) => (f === f0 ? ids0 : ids1).has(x.memberId) && x.kind === 'plate');
    const mw = (ps: ReturnType<typeof rel>) => ps.map((x) => `${x.mark}:${x.weight.toFixed(2)}:${x.length.toFixed(1)}:${x.holes.length}`).sort();
    expect(mw(rel(f1))).toEqual(mw(rel(f0)));
    const nc1 = (d: DerivedModel, p: Project, ps: ReturnType<typeof rel>) => ps.map((x) => { const ls = partToNc1(x, p, d, 1).split('\r\n'); const bo = ls.indexOf('BO'); return [ls.slice(8, 23).join('|'), ...(bo >= 0 ? ls.slice(bo + 1).filter((l) => /^\s*[vuoh]/.test(l)).sort() : [])].join('~'); }).sort();
    expect(nc1(d1, p1, rel(f1))).toEqual(nc1(d0, p0, rel(f0)));
    expect(f1.assemblies.length).toBe(f0.assemblies.length);
    // ברגי הזוויתנים (חורים בזוויתן) זהים
    const angH = (f: typeof f0) => f.parts.filter((x) => x.kind === 'brace').map((x) => `${x.mark}:${x.holes.length}:${x.weight.toFixed(2)}`).sort();
    expect(angH(f1)).toEqual(angH(f0));
  });
});

describe('CROSS-02 גיליונות השרטוט', () => {
  for (const cfg of CFGS) it(`אותם גיליונות · ${cfg.name}`, () => {
    const p0 = proj(cfg, false), d0 = generate(p0), p1 = proj(cfg, true), d1 = generate(p1);
    const run = (p: Project, d: DerivedModel) => { const f = computeFabrication(p, d), bom = computeBom(d, f); return new Map(drawingCatalog(p, d, f).map((df) => [df.id, buildSheet(df, p, d, f, bom)])); };
    const a = run(p0, d0), b = run(p1, d1);
    const SOFT = new Set(['OUTLINE', 'THIN', 'MARK']);
    const bad: string[] = [];
    const allowedNew = new Set([`D-CONN-cd-${braceCrossGussetRecipe().id}`, `D-CONN-cd-${braceCrossRodRecipe().id}`]);
    for (const k of a.keys()) if (!b.has(k) && !/^D-CONN-brace-cross(~\d+)?$/.test(k)) bad.push(`גיליון נעלם: ${k}`);
    for (const k of b.keys()) if (!a.has(k) && !allowedNew.has(k)) bad.push(`גיליון חדש: ${k}`);
    for (const [id, sa] of a) {
      const sb = b.get(id); if (!sb || id === 'D-COVER' || id === 'D-CONN-brace-cross') continue;
      const ea = sa.ents.filter((e) => e.layer !== 'TITLE'), eb = sb.ents.filter((e) => e.layer !== 'TITLE');
      const hist = (es: typeof ea) => { const m: Record<string, number> = {}; for (const e of es) m[`${e.k}|${e.layer}`] = (m[`${e.k}|${e.layer}`] ?? 0) + 1; return m; };
      const ha = hist(ea), hb = hist(eb);
      for (const k of new Set([...Object.keys(ha), ...Object.keys(hb)])) {
        const x = ha[k] ?? 0, y = hb[k] ?? 0;
        if (SOFT.has(k.split('|')[1]!) ? Math.abs(x - y) > Math.max(10, 0.01 * x) : x !== y) bad.push(`${id}: ${k} ${x}→${y}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
