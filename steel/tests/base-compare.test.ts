/**
 * BASE-01/02: שלב D (הסבה) — פלטת בסיס (מבוטנת / ברגי עוגן). הקוד הישן (`connections.ts`) מול המתכונים `baseEmbeddedRecipe` / `baseBoltedRecipe`
 * (דגל `building.baseEngine`). `pile` תמיד בקוד הישן. תנאי המעבר: מיקומי חלקים, עיגונים, חורים, ברגים, ריתוכים, סימונים, משקלים, NC1, גיליונות.
 */
import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { computeFabrication } from '../src/fab/marks';
import { partToNc1 } from '../src/fab/dstv';
import { computeBom } from '../src/fab/bom';
import { buildSheet, drawingCatalog } from '../src/drawing/views';
import { BASE_BOLTED_B500_RECIPE_ID, BASE_EMBEDDED_RECIPE_ID } from '../src/geometry/convRecipes';
import type { BoltInfo, DerivedModel, Member, Project, WeldInfo } from '../src/model/types';

const TOL = 0.5;
type V = { x: number; y: number; z: number };
const dist = (a: V, b: V) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const dot = (a: V, b: V) => a.x * b.x + a.y * b.y + a.z * b.z;

interface Cfg { name: string; mod: (p: Project) => void }
const setBase = (p: Project, patch: Record<string, unknown>) => { p.connectionDefaults.base = { ...p.connectionDefaults.base, ...patch } as typeof p.connectionDefaults.base; };
const CFGS: Cfg[] = [
  { name: 'מבוטנת · ברירת מחדל', mod: () => {} },
  { name: 'מבוטנת · 2×4 · M24 · פלטה 300×260×25 · עיגון 600', mod: (p) => setBase(p, { rows: 2, cols: 4, pitch: 120, gauge: 70, bolt: { ...p.connectionDefaults.base.bolt, d: 24 }, l: 300, w: 260, t: 25, anchorLength: 600, weldSize: 6 }) },
  { name: 'ברגי עוגן · ברירת מחדל (B500)', mod: (p) => setBase(p, { mode: 'bolted' }) },
  { name: 'ברגי עוגן · 8.8 ISO 4017 · 2×3 · M20', mod: (p) => setBase(p, { mode: 'bolted', rows: 2, cols: 3, pitch: 150, gauge: 90, bolt: { ...p.connectionDefaults.base.bolt, grade: '8.8', standard: 'ISO 4017', d: 20 } }) },
  { name: 'מבוטנת · עמודים מסובבים 90° (ציר a לאורך X)', mod: (p) => roll(p) },
  { name: 'ברגי עוגן · עמודים מסובבים 90° · פלטה 300×260', mod: (p) => { setBase(p, { mode: 'bolted', l: 300, w: 260, rows: 3, cols: 2 }); roll(p); } },
  { name: 'מבוטנת · עמוד HEA200', mod: (p) => { p.building.columnProfile = 'HEA200'; } },
];
const roll = (p: Project) => { for (const f of p.building.frames) for (const sd of ['L', 'R']) p.memberOverrides[`${f.id}.COL.${sd}`] = { ...(p.memberOverrides[`${f.id}.COL.${sd}`] ?? {}), rollDeg: 90 }; };
const proj = (c: Cfg, recipe: boolean) => { const p = newProject('c', defaultBuilding()); c.mod(p); if (recipe) p.building.baseEngine = 'recipe'; return p; };
const oldB = (d: DerivedModel) => d.connections.filter((c) => c.type === 'base');
const newB = (d: DerivedModel) => d.connections.filter((c) => c.custom && /^conv-base/.test(c.custom.detailId));
const parts = (d: DerivedModel, ids: string[]) => ids.map((i) => d.byId.get(i)).filter((m): m is Member => !!m && (m.kind === 'plate' || m.kind === 'anchor'));

describe('BASE-01 פלטת בסיס: הקוד הישן מול המתכון', () => {
  for (const cfg of CFGS) it(cfg.name, () => {
    const p0 = proj(cfg, false), d0 = generate(p0), p1 = proj(cfg, true), d1 = generate(p1);
    const oc = oldB(d0), nc = newB(d1);
    expect(oc.length).toBeGreaterThan(1);
    expect(oldB(d1).length + nc.length).toBe(oc.length);
    expect(nc.length).toBe(oc.length);
    // חלקים של חיבורים סמוכים (פחי קושרות ליד בסיס העמוד) לא נמחקים בהחלפת הבסיס
    const near = (d: DerivedModel) => d.members.filter((m) => m.connId?.startsWith('C.BR')).length;
    expect(near(d1)).toBe(near(d0));
    const bad: string[] = [];
    // פלטות ומוטות: אותו פרופיל, אותו אורך, ואמצע החלק (שונה לפי עוגן 'top' מול 'center': הפרש z עד חצי עובי)
    const op = oc.flatMap((c) => parts(d0, c.parts)), np = nc.flatMap((c) => parts(d1, c.parts));
    if (op.length !== np.length) bad.push(`חלקים ${op.length}→${np.length}`);
    const left = [...np];
    const mid = (m: Member): V => ({ x: (m.start.x + m.end.x) / 2, y: (m.start.y + m.end.y) / 2, z: (m.start.z + m.end.z) / 2 });
    for (const o of op) {
      const i = left.findIndex((x) => x.kind === o.kind && x.profile === o.profile && Math.abs(dist(x.start, x.end) - dist(o.start, o.end)) <= TOL && Math.hypot(mid(x).x - mid(o).x, mid(x).y - mid(o).y) <= TOL && Math.abs(mid(x).z - mid(o).z) <= (o.kind === 'plate' ? 40 : TOL) && (o.kind === 'plate' ? Math.abs(dot(x.refUp, o.refUp)) > 0.999 : true));
      if (i < 0) bad.push(`${o.kind} ${o.profile} ב-(${mid(o).x.toFixed(0)},${mid(o).y.toFixed(0)},${mid(o).z.toFixed(0)}) לא נמצא`); else left.splice(i, 1);
    }
    const ob: BoltInfo[] = oc.flatMap((c) => c.bolts), nb: BoltInfo[] = nc.flatMap((c) => c.bolts);
    if (ob.length !== nb.length) bad.push(`ברגים ${ob.length}→${nb.length}`);
    const lb = [...nb];
    for (const o of ob) {
      const i = lb.findIndex((x) => dist(x.p, o.p) <= TOL && x.d === o.d && x.grade === o.grade && x.standard === o.standard && dot(x.axis, o.axis) > 0.999 && Math.abs(x.length - o.length) <= TOL && Math.abs(x.grip - o.grip) <= 0.01 && x.location === o.location && x.holesIn.length === o.holesIn.length);
      if (i < 0) bad.push(`בורג M${o.d} ב-(${o.p.x.toFixed(1)},${o.p.y.toFixed(1)},${o.p.z.toFixed(1)}) לא נמצא`); else lb.splice(i, 1);
    }
    const key = (w: WeldInfo) => `${w.location}|${w.a}|${w.length}`;
    const ow = oc.flatMap((c) => c.welds).map(key).sort().join(), nw = nc.flatMap((c) => c.welds).map(key).sort().join();
    if (ow !== nw) bad.push(`ריתוכים שונים\n${ow}\n${nw}`);
    const fx = (v: number) => (Math.round(v * 10) / 10 + 0).toFixed(1); // בלי "-0.0"
    const hk = (c: { holes?: { p: V; d: number; axis: V }[] }) => (c.holes ?? []).map((h) => `${fx(h.p.x)},${fx(h.p.y)},${fx(h.p.z)}:${h.d}:${fx(h.axis.z)}`).sort().join('|');
    if (oc.map(hk).sort().join('#') !== nc.map(hk).sort().join('#')) bad.push('חורי פלטה שונים');
    expect(bad.slice(0, 6)).toEqual([]);
    const errs = (d: DerivedModel) => d.issues.filter((i) => i.severity === 'error').map((i) => `${i.code} ${i.message}`);
    expect(errs(d1)).toEqual(errs(d0));
    const warns = (d: DerivedModel) => d.issues.filter((i) => i.severity === 'warning' && !i.elementId?.startsWith('C.CD.')).map((i) => i.code).sort();
    expect(warns(d1)).toEqual(warns(d0));
    const f0 = computeFabrication(p0, d0), f1 = computeFabrication(p1, d1);
    const ids0 = new Set(oc.flatMap((c) => c.parts)), ids1 = new Set(nc.flatMap((c) => c.parts));
    const rel = (f: typeof f0) => f.parts.filter((x) => (f === f0 ? ids0 : ids1).has(x.memberId) && (x.kind === 'plate' || x.kind === 'anchor'));
    const markW = (ps: ReturnType<typeof rel>) => ps.map((x) => `${x.mark}:${x.weight.toFixed(2)}:${x.length.toFixed(1)}:${x.holes.length}`).sort();
    const cnt = (xs: string[]) => { const m: Record<string, number> = {}; xs.forEach((x) => { m[x] = (m[x] ?? 0) + 1; }); return m; };
    const ma = cnt(markW(rel(f0))), mb = cnt(markW(rel(f1)));
    expect(Object.keys({ ...ma, ...mb }).filter((k) => ma[k] !== mb[k]).map((k) => `${k}: ${ma[k] ?? 0}→${mb[k] ?? 0}`)).toEqual([]);
    const nc1 = (d: DerivedModel, p: Project, ps: ReturnType<typeof rel>) => ps.map((x) => { const ls = partToNc1(x, p, d, 1).split('\r\n'); const bo = ls.indexOf('BO'); return [ls.slice(8, 23).join('|'), ...(bo >= 0 ? ls.slice(bo + 1, ls.indexOf('EN')).sort() : [])].join('\n'); }).sort();
    expect(nc1(d1, p1, rel(f1))).toEqual(nc1(d0, p0, rel(f0)));
    // עמודים: סימון, משקל, אורך וחיתוך
    const col = (f: typeof f0) => f.parts.filter((x) => x.kind === 'column').map((x) => `${x.mark}:${x.weight.toFixed(2)}:${x.length.toFixed(1)}:${x.holes.length}`).sort();
    expect(col(f1)).toEqual(col(f0));
    expect(f1.assemblies.length).toBe(f0.assemblies.length);
  });
  it('pile תמיד בקוד הישן', () => {
    const p = proj({ name: '', mod: (q) => setBase(q, { mode: 'pile' }) }, true), d = generate(p);
    expect(newB(d).length).toBe(0);
    expect(oldB(d).length).toBeGreaterThan(1);
  });
});

describe('BASE-02 גיליונות השרטוט', () => {
  for (const [cfg, rid] of [[CFGS[0]!, BASE_EMBEDDED_RECIPE_ID], [CFGS[2]!, BASE_BOLTED_B500_RECIPE_ID]] as const) it(`אותם גיליונות ואותה כמות ישויות (עד רעש עיגול ובחירת בועות) — ${cfg.name}`, () => {
    const p0 = proj(cfg, false), d0 = generate(p0), p1 = proj(cfg, true), d1 = generate(p1);
    const run = (p: Project, d: DerivedModel) => { const f = computeFabrication(p, d), bom = computeBom(d, f); return new Map(drawingCatalog(p, d, f).map((df) => [df.id, buildSheet(df, p, d, f, bom)])); };
    const a = run(p0, d0), b = run(p1, d1);
    // כשכל הבסיסים הוסבו — גיליון "פרט פלטת בסיס" הרגיל נעלם והפרט המותאם מחליף אותו (חריג (ב) כמו באלכסון); תוכנית העיגון והפלטות נשארות זהות
    expect([...a.keys()].filter((k) => !b.has(k))).toEqual(['D-CONN-base']);
    expect([...b.keys()].filter((k) => !a.has(k)).sort()).toEqual([`D-CONN-cd-${rid}`]);
    const SOFT = new Set(['OUTLINE', 'THIN', 'MARK']);
    const bad: string[] = [];
    for (const [id, sa] of a) {
      const sb = b.get(id); if (!sb || id === 'D-COVER' || id === 'D-CONN-base') continue;
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
