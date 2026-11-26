/**
 * CLEAT-01/02: שלב D (הסבה) — תושבת פטה, סגנון `run` (זוויתן מרותך לקורה, מוברג לווב הפטה). הקוד הישן (`connections.ts`) מול המתכון `cleatRunRecipe()`
 * (דגל `purlins.engine`). תנאי המעבר זהים ל-CONV/STRUT: מיקומי חלקים, מידות, חורים/ברגים, ריתוכים, סימונים, משקלים, NC1, גיליונות.
 */
import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { computeFabrication } from '../src/fab/marks';
import { partToNc1 } from '../src/fab/dstv';
import { computeBom } from '../src/fab/bom';
import { buildSheet, drawingCatalog } from '../src/drawing/views';
import { cleatPlateRecipe, cleatRunRecipe } from '../src/geometry/convRecipes';
import type { BoltInfo, DerivedModel, Member, Project, WeldInfo } from '../src/model/types';

const TOL = 0.5;
type V = { x: number; y: number; z: number };
const dist = (a: V, b: V) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const dot = (a: V, b: V) => a.x * b.x + a.y * b.y + a.z * b.z;

interface Cfg { name: string; mod: (p: Project) => void }
const CFGS: Cfg[] = [
  { name: 'ברירת מחדל', mod: () => {} },
  { name: 'C120 · 2 שורות · 3 ברגים בשורה · M16', mod: (p) => { p.building.purlins.left = { ...p.building.purlins.left, profile: 'C120x50x13x2', cleat: { ...p.building.purlins.left.cleat, rows: 2, perRow: 3, pitch: 50, width: 200, bolt: { ...p.building.purlins.left.cleat.bolt, d: 12 } } }; } },
  { name: 'פלטה + משולש · ברירת מחדל', mod: (p) => { p.building.purlins.left = { ...p.building.purlins.left, cleat: { ...p.building.purlins.left.cleat, style: 'plate' } }; p.building.purlins.right = { ...p.building.purlins.right, cleat: { ...p.building.purlins.right.cleat, style: 'plate' } }; } },
  { name: 'פלטה + משולש · 2 שורות · 4 ברגים בשורה · M16', mod: (p) => { for (const k of ['left', 'right'] as const) p.building.purlins[k] = { ...p.building.purlins[k], profile: 'C150x50x15x2', cleat: { ...p.building.purlins[k].cleat, style: 'plate', rows: 2, rowPitch: 70, perRow: 4, pitch: 70, thickness: 10, base: 80, bolt: { ...p.building.purlins[k].cleat.bolt, d: 16 } } }; } },
  { name: 'גובה / רוחב / עובי ידניים', mod: (p) => { p.building.purlins.left = { ...p.building.purlins.left, cleat: { ...p.building.purlins.left.cleat, height: 90, width: 120, thickness: 10, base: 70, weldSize: 6 } }; } },
];
const proj = (c: Cfg, recipe: boolean) => { const p = newProject('c', defaultBuilding()); c.mod(p); if (recipe) p.building.purlins.engine = 'recipe'; return p; };
const oldC = (d: DerivedModel) => d.connections.filter((c) => c.type === 'purlin-cleat');
const newC = (d: DerivedModel) => d.connections.filter((c) => c.custom && c.custom.site.includes('|x:'));
const cleats = (d: DerivedModel, ids: string[]) => ids.map((i) => d.byId.get(i)).filter((m): m is Member => !!m && (m.kind === 'cleat' || m.kind === 'plate'));

describe('CLEAT-01 תושבת פטה (זוויתן): הקוד הישן מול המתכון', () => {
  for (const cfg of CFGS) it(cfg.name, () => {
    const p0 = proj(cfg, false), d0 = generate(p0), p1 = proj(cfg, true), d1 = generate(p1);
    const oc = oldC(d0), nc = newC(d1);
    expect(oc.length).toBeGreaterThan(10);
    expect(oldC(d1).length + nc.length).toBe(oc.length);
    expect(nc.length).toBeGreaterThan(0);
    const bad: string[] = [];
    const op = oc.flatMap((c) => cleats(d0, c.parts)), np = nc.flatMap((c) => cleats(d1, c.parts));
    const keepOld = oldC(d1).flatMap((c) => cleats(d1, c.parts));
    if (op.length !== np.length + keepOld.length) bad.push(`זוויתנים ${op.length}→${np.length}+${keepOld.length}`);
    const left = [...np, ...keepOld];
    for (const o of op) {
      // זוויתן: התאמה מלאה. פלטה: כיוון הנורמל (±) לא משנה. משולש (קונטור): הציר במתכון במרכז הרוחב ובקוד הישן בקצה — משווים אורך ומרכז מעוגל (המשקל וה-NC1 נבדקים למטה)
      const i = left.findIndex((x) => x.profile === o.profile && !!x.contour === !!o.contour && (o.contour
        ? Math.abs(dist(x.start, x.end) - dist(o.start, o.end)) <= TOL && dist(x.start, o.start) <= 60
        : dist(x.start, o.start) <= TOL && dist(x.end, o.end) <= TOL && (o.kind === 'plate' ? Math.abs(dot(x.refUp, o.refUp)) > 0.999 : x.mirror === o.mirror && dot(x.refUp, o.refUp) > 0.999) && x.anchor === o.anchor));
      if (i < 0) bad.push(`זוויתן ${o.profile} ב-(${o.start.x.toFixed(0)},${o.start.y.toFixed(0)},${o.start.z.toFixed(0)}) לא נמצא`); else left.splice(i, 1);
    }
    const ob: BoltInfo[] = oc.flatMap((c) => c.bolts), nb: BoltInfo[] = [...nc, ...oldC(d1)].flatMap((c) => c.bolts);
    if (ob.length !== nb.length) bad.push(`ברגים ${ob.length}→${nb.length}`);
    const lb = [...nb];
    for (const o of ob) {
      const i = lb.findIndex((x) => dist(x.p, o.p) <= TOL && x.d === o.d && dot(x.axis, o.axis) > 0.999 && Math.abs(x.length - o.length) <= TOL && Math.abs(x.grip - o.grip) <= 0.01 && x.location === o.location && x.holesIn.length === o.holesIn.length);
      if (i < 0) bad.push(`בורג M${o.d} ב-(${o.p.x.toFixed(1)},${o.p.y.toFixed(1)},${o.p.z.toFixed(1)}) לא נמצא`); else lb.splice(i, 1);
    }
    const key = (w: WeldInfo) => `${w.location}|${w.a}|${w.length}`;
    const ow = oc.flatMap((c) => c.welds).map(key).sort().join(), nw = [...nc, ...oldC(d1)].flatMap((c) => c.welds).map(key).sort().join();
    if (ow !== nw) bad.push('ריתוכים שונים');
    expect(bad.slice(0, 8)).toEqual([]);
    const errs = (d: DerivedModel) => d.issues.filter((i) => i.severity === 'error').map((i) => `${i.code} ${i.message}`);
    expect(errs(d1)).toEqual(errs(d0));
    const f0 = computeFabrication(p0, d0), f1 = computeFabrication(p1, d1);
    const ids0 = new Set(oc.flatMap((c) => c.parts)), ids1 = new Set([...nc, ...oldC(d1)].flatMap((c) => c.parts));
    const rel = (f: typeof f0) => f.parts.filter((x) => (f === f0 ? ids0 : ids1).has(x.memberId) && (x.kind === 'cleat' || x.kind === 'plate'));
    const markW = (ps: ReturnType<typeof rel>) => ps.map((x) => `${x.mark}:${x.weight.toFixed(2)}:${x.length.toFixed(1)}:${x.holes.length}`).sort();
    const cnt = (xs: string[]) => { const m: Record<string, number> = {}; xs.forEach((x) => { m[x] = (m[x] ?? 0) + 1; }); return m; };
    const ma = cnt(markW(rel(f0))), mb = cnt(markW(rel(f1)));
    expect(Object.keys({ ...ma, ...mb }).filter((k) => ma[k] !== mb[k]).map((k) => `${k}: ${ma[k] ?? 0}→${mb[k] ?? 0}`)).toEqual([]);
    const nc1 = (d: DerivedModel, p: Project, ps: ReturnType<typeof rel>) => ps.map((x) => { const ls = partToNc1(x, p, d, 1).split('\r\n'); const bo = ls.indexOf('BO'); return [ls.slice(8, 23).join('|'), ...(bo >= 0 ? ls.slice(bo + 1, ls.indexOf('EN')).sort() : [])].join('\n'); }).sort();
    expect(nc1(d1, p1, rel(f1))).toEqual(nc1(d0, p0, rel(f0)));
    expect(f1.assemblies.length).toBe(f0.assemblies.length);
    // פטות: חורי הווב בפטה זהים
    const purH = (f: typeof f0) => f.parts.filter((x) => x.kind === 'purlin').map((x) => `${x.mark}:${x.holes.length}`).sort();
    expect(purH(f1)).toEqual(purH(f0));
  });
});

describe('CLEAT-02 גיליונות השרטוט', () => {
  for (const [cfg, rid] of [[CFGS[0]!, cleatRunRecipe().id], [CFGS[2]!, cleatPlateRecipe().id]] as const) it(`אותם גיליונות ואותה כמות ישויות (עד רעש עיגול ובחירת בועות); גיליון פרט מותאם נוסף — ${cfg.name}`, () => {
    const p0 = proj(cfg, false), d0 = generate(p0), p1 = proj(cfg, true), d1 = generate(p1);
    const run = (p: Project, d: DerivedModel) => { const f = computeFabrication(p, d), bom = computeBom(d, f); return new Map(drawingCatalog(p, d, f).map((df) => [df.id, buildSheet(df, p, d, f, bom)])); };
    const a = run(p0, d0), b = run(p1, d1);
    // כשכל התושבות הוסבו — גיליון "פרט תושבת" הרגיל נעלם והפרט המותאם מחליף אותו (חריג (ב) כמו באלכסון)
    expect([...a.keys()].filter((k) => !b.has(k)).filter((k) => k !== 'D-CONN-purlin-cleat')).toEqual([]);
    expect([...b.keys()].filter((k) => !a.has(k))).toEqual([`D-CONN-cd-${rid}`]);
    const SOFT = new Set(['OUTLINE', 'THIN', 'MARK']);
    const bad: string[] = [];
    for (const [id, sa] of a) {
      const sb = b.get(id); if (!sb || id === 'D-COVER') continue;
      // חריג מאושר-לבקשה (ב'): גיליון "פרט תושבת" מציג חיבור מייצג = הראשון שנשאר בקוד הישן (פלטת תפר / קצה), כי התושבות שהוסבו עברו לגיליון הפרט המותאם
      if (id === 'D-CONN-purlin-cleat') continue;
      const ea = sa.ents.filter((e) => e.layer !== 'TITLE'), eb = sb.ents.filter((e) => e.layer !== 'TITLE');
      const hist = (es: typeof ea) => { const m: Record<string, number> = {}; for (const e of es) m[`${e.k}|${e.layer}`] = (m[`${e.k}|${e.layer}`] ?? 0) + 1; return m; };
      const ha = hist(ea), hb = hist(eb);
      for (const k of new Set([...Object.keys(ha), ...Object.keys(hb)])) {
        const x = ha[k] ?? 0, y = hb[k] ?? 0;
        if (SOFT.has(k.split('|')[1]!) ? Math.abs(x - y) > Math.max(10, 0.01 * x) : x !== y) bad.push(`${id}: ${k} ${x}→${y}`);
      }
      const txt = (es: typeof ea, soft: boolean) => es.filter((e) => e.k === 'text' && (e.layer === 'MARK') === soft).map((e) => (/^-?\d+(\.\d+)?$/.test((e as { s: string }).s) ? '#' : /^\d+\/\d+$/.test((e as { s: string }).s) ? '#/#' : (e as { s: string }).s)).sort();
      if (JSON.stringify(txt(ea, false)) !== JSON.stringify(txt(eb, false))) bad.push(`${id}: טקסטים שונים`);
    }
    expect(bad).toEqual([]);
  });
});

/** CLEAT-03: אשף החיבורים נפתח מחיבור custom של תושבת (חוב מלפני שלב D) וחזרה לסוג מובנה מבטלת את המתכון */
import { applyDetail, candidates, familyOf, readCurrent, situationOf } from '../src/model/connRegistry';
describe('CLEAT-03 אשף מחיבור custom', () => {
  it('משפחה, מצב, מועמדים והחלפה לזוויתן עומד', () => {
    const p0 = proj(CFGS[0]!, true), d0 = generate(p0), cs = newC(d0);
    expect(cs.length).toBeGreaterThan(10);
    for (const c of cs) { expect(familyOf(c)).toBe('cleat'); const s = situationOf(p0, d0, c.id); expect(s?.family).toBe('cleat'); expect(s!.title).toBe('תושבת פטה'); expect(s!.facts.every((f) => !f.v.includes('?'))).toBe(true); }
    const sit = situationOf(p0, d0, cs[0]!.id)!;
    expect(readCurrent(p0, sit).detail).toBe('cleat.run');
    expect(candidates(p0, sit).some((x) => x.detail === 'cleat.stand')).toBe(true);
    const p1 = applyDetail(p0, sit, 'cleat.stand', {}, 'all');
    const left = newC(generate(p1));
    expect(left.length).toBeLessThan(cs.length); // 'כל התושבות' = כל הפטות של אותו שיפוע; שיפוע אחר נשאר במתכון
    expect(left.every((c) => !c.custom!.site.startsWith(cs[0]!.custom!.site.split('|')[0]!.replace(/\d+$/, '')))).toBe(true);
  });
});
