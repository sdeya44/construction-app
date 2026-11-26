/**
 * SPLICE-01/02: G9 (אתר באמצע אלמנט) — חיבור המשך פטה. הקוד הישן (`connections.ts`) מול המתכון `purlinSpliceRecipe()` (דגל `purlins.splice.engine`)
 * על אתר `פטה|s:k`. תנאי המעבר זהים לשאר ההסבות: מיקומי חלקים, ברגים, סימונים, משקלים, NC1, גיליונות.
 */
import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { computeFabrication } from '../src/fab/marks';
import { partToNc1 } from '../src/fab/dstv';
import { computeBom } from '../src/fab/bom';
import { buildSheet, drawingCatalog } from '../src/drawing/views';
import { purlinSpliceRecipe } from '../src/geometry/spliceRecipes';
import type { BoltInfo, DerivedModel, Member, Project } from '../src/model/types';

const TOL = 0.5;
type V = { x: number; y: number; z: number };
const dist = (a: V, b: V) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const dot = (a: V, b: V) => a.x * b.x + a.y * b.y + a.z * b.z;

interface Cfg { name: string; mod: (p: Project) => void }
const spl = (p: Project, prof?: string) => {
  p.settings.autoSplice = false;
  if (prof) for (const k of ['left', 'right'] as const) p.building.purlins[k] = { ...p.building.purlins[k], profile: prof };
  p.splices['PL.L.03'] = [7000, 15000]; p.splices['PL.R.03'] = [9000]; p.splices['PL.L.05'] = [11000];
};
const CFGS: Cfg[] = [
  { name: 'ברירת מחדל', mod: (p) => spl(p) },
  { name: 'C120 (פטה נמוכה — שורה אופקית)', mod: (p) => spl(p, 'C120x50x13x2') },
  { name: 'C150 · M16 · פלטה 8 · שפה 35', mod: (p) => { spl(p, 'C150x50x15x2'); p.building.purlins.splice = { ...p.building.purlins.splice, plateT: 8, edge: 35, bolt: { ...p.building.purlins.splice.bolt, d: 16 } }; } },
  { name: 'תפר מעל תומך (מרווח הברגים גדל)', mod: (p) => { p.settings.autoSplice = false; p.splices['PL.L.03'] = [6000]; p.splices['PL.R.04'] = [7500, 13000]; } },
  { name: 'אוטומטי (חלוקה לפי אורך חומר גלם)', mod: (p) => { p.settings.stockLength = 6000; } },
];
const proj = (c: Cfg, recipe: boolean) => { const p = newProject('c', defaultBuilding()); c.mod(p); if (recipe) p.building.purlins.splice = { ...p.building.purlins.splice, engine: 'recipe' }; return p; };
const oldC = (d: DerivedModel) => d.connections.filter((c) => c.type === 'purlin-splice');
const newC = (d: DerivedModel) => d.connections.filter((c) => c.custom && c.custom.site.includes('|s:'));
const plates = (d: DerivedModel, ids: string[]) => ids.map((i) => d.byId.get(i)).filter((m): m is Member => !!m && m.kind === 'plate');

describe('SPLICE-01 חיבור המשך פטה: הקוד הישן מול המתכון', () => {
  for (const cfg of CFGS) it(cfg.name, () => {
    const p0 = proj(cfg, false), d0 = generate(p0), p1 = proj(cfg, true), d1 = generate(p1);
    const oc = oldC(d0), nc = newC(d1);
    expect(oc.length).toBeGreaterThan(0);
    expect(oldC(d1).length + nc.length).toBe(oc.length);
    expect(nc.length).toBe(oc.length);
    const bad: string[] = [];
    // מזהה החיבור נשמר (buildParts: סטטוס "מוברג")
    if (oc.map((c) => c.id).sort().join() !== nc.map((c) => c.id).sort().join()) bad.push('מזהי חיבורים שונים');
    const op = oc.flatMap((c) => plates(d0, c.parts)), np = nc.flatMap((c) => plates(d1, c.parts));
    if (op.length !== np.length) bad.push(`פלטות ${op.length}→${np.length}`);
    const left = [...np];
    for (const o of op) {
      const i = left.findIndex((x) => x.profile === o.profile && ((dist(x.start, o.start) <= TOL && dist(x.end, o.end) <= TOL) || (dist(x.start, o.end) <= TOL && dist(x.end, o.start) <= TOL)) && Math.abs(dot(x.refUp, o.refUp)) > 0.999);
      if (i < 0) bad.push(`פלטה ${o.profile} ב-(${o.start.x.toFixed(0)},${o.start.y.toFixed(0)},${o.start.z.toFixed(0)}) לא נמצאה`); else left.splice(i, 1);
    }
    const ob: BoltInfo[] = oc.flatMap((c) => c.bolts), nb: BoltInfo[] = nc.flatMap((c) => c.bolts);
    if (ob.length !== nb.length) bad.push(`ברגים ${ob.length}→${nb.length}`);
    const lb = [...nb];
    for (const o of ob) {
      const i = lb.findIndex((x) => dist(x.p, o.p) <= TOL && x.d === o.d && dot(x.axis, o.axis) > 0.999 && Math.abs(x.length - o.length) <= TOL && Math.abs(x.grip - o.grip) <= 0.01 && x.location === o.location && x.holesIn.length === o.holesIn.length);
      if (i < 0) bad.push(`בורג M${o.d} ב-(${o.p.x.toFixed(1)},${o.p.y.toFixed(1)},${o.p.z.toFixed(1)}) לא נמצא`); else lb.splice(i, 1);
    }
    expect(bad.slice(0, 8)).toEqual([]);
    const errs = (d: DerivedModel) => d.issues.filter((i) => i.severity === 'error').map((i) => `${i.code} ${i.message}`);
    expect(errs(d1)).toEqual(errs(d0));
    // סטטוס חיבורי ההמשך (מוברג / דורש תכנון) ואורכי החלקים — לא השתנו
    const sp = (d: DerivedModel) => d.splices.map((s) => `${s.id}:${s.status}`).sort();
    expect(sp(d1)).toEqual(sp(d0));
    const pl = (d: DerivedModel) => d.parts.map((x) => `${x.id}:${x.length.toFixed(2)}`).sort();
    expect(pl(d1)).toEqual(pl(d0));
    const f0 = computeFabrication(p0, d0), f1 = computeFabrication(p1, d1);
    const ids0 = new Set(oc.flatMap((c) => c.parts)), ids1 = new Set(nc.flatMap((c) => c.parts));
    const rel = (f: typeof f0) => f.parts.filter((x) => (f === f0 ? ids0 : ids1).has(x.memberId) && x.kind === 'plate');
    const markW = (ps: ReturnType<typeof rel>) => ps.map((x) => `${x.mark}:${x.weight.toFixed(2)}:${x.length.toFixed(1)}:${x.holes.length}`).sort();
    const cnt = (xs: string[]) => { const m: Record<string, number> = {}; xs.forEach((x) => { m[x] = (m[x] ?? 0) + 1; }); return m; };
    const ma = cnt(markW(rel(f0))), mb = cnt(markW(rel(f1)));
    expect(Object.keys({ ...ma, ...mb }).filter((k) => ma[k] !== mb[k]).map((k) => `${k}: ${ma[k] ?? 0}→${mb[k] ?? 0}`)).toEqual([]);
    const nc1 = (d: DerivedModel, p: Project, ps: ReturnType<typeof rel>) => ps.map((x) => { const ls = partToNc1(x, p, d, 1).split('\r\n'); const bo = ls.indexOf('BO'); return [ls.slice(8, 23).join('|'), ...(bo >= 0 ? ls.slice(bo + 1).filter((l) => /^\s*[vuoh]/.test(l)).sort() : [])].join('~'); }).sort();
    expect(nc1(d1, p1, rel(f1))).toEqual(nc1(d0, p0, rel(f0)));
    expect(f1.assemblies.length).toBe(f0.assemblies.length);
    const purH = (f: typeof f0) => f.parts.filter((x) => x.kind === 'purlin').map((x) => `${x.mark}:${x.holes.length}:${x.weight.toFixed(2)}`).sort();
    expect(purH(f1)).toEqual(purH(f0));
  });
});

describe('SPLICE-02 גיליונות השרטוט', () => {
  for (const cfg of [CFGS[0]!, CFGS[1]!]) it(`אותם גיליונות · ${cfg.name}`, () => {
    const p0 = proj(cfg, false), d0 = generate(p0), p1 = proj(cfg, true), d1 = generate(p1);
    const run = (p: Project, d: DerivedModel) => { const f = computeFabrication(p, d), bom = computeBom(d, f); return new Map(drawingCatalog(p, d, f).map((df) => [df.id, buildSheet(df, p, d, f, bom)])); };
    const a = run(p0, d0), b = run(p1, d1);
    const SOFT = new Set(['OUTLINE', 'THIN', 'MARK']);
    const bad: string[] = [];
    // חריג (לאישור): כשכל חיבורי ההמשך הוסבו — גיליון "פרט חיבור המשך" הרגיל מוחלף בגיליון פרט מותאם
    for (const k of a.keys()) if (!b.has(k) && k !== 'D-CONN-purlin-splice') bad.push(`גיליון נעלם: ${k}`);
    for (const k of b.keys()) if (!a.has(k) && k !== `D-CONN-cd-${purlinSpliceRecipe().id}`) bad.push(`גיליון חדש: ${k}`);
    for (const [id, sa] of a) {
      const sb = b.get(id); if (!sb || id === 'D-COVER' || id === 'D-CONN-purlin-splice') continue;
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
