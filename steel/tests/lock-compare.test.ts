/**
 * LOCK-01/02: שלב D (הסבה) — מסבך נעילה, סגנון לשונית (סיב וחגורה: פח + לשונית בחריץ). הקוד הישן (`lockTruss.ts` / `finJoint`) מול `kneeFinRecipe`
 * (דגל `LockTrussParams.engine`; סגנון פלטה — תמיד הקוד הישן). תנאי המעבר: חלקים, ברגים, חורים, ריתוכים, סימונים, משקלים, NC1, גיליונות.
 */
import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { defaultLockTruss } from '../src/geometry/lockTruss';
import { computeFabrication } from '../src/fab/marks';
import { partToNc1 } from '../src/fab/dstv';
import { computeBom } from '../src/fab/bom';
import { buildSheet, drawingCatalog } from '../src/drawing/views';
import { KNEE_FIN_LTCHORD_RECIPE_ID, KNEE_FIN_LTTRUSS_RECIPE_ID, LOCK_PLATE_RECIPE_ID } from '../src/geometry/convRecipes';
const PORTAL_RECIPES = [KNEE_FIN_LTCHORD_RECIPE_ID, KNEE_FIN_LTTRUSS_RECIPE_ID, LOCK_PLATE_RECIPE_ID];
import type { BoltInfo, DerivedModel, Member, LockTrussParams, Project, WeldInfo } from '../src/model/types';

const TOL = 0.5;
type V = { x: number; y: number; z: number };
const dist = (a: V, b: V) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const dot = (a: V, b: V) => a.x * b.x + a.y * b.y + a.z * b.z;

interface Cfg { name: string; patch: Partial<LockTrussParams>; plate?: boolean }
const CFGS: Cfg[] = [
  { name: 'ברירת מחדל (לשונית)', patch: { conn: 'tongue' } },
  { name: 'RHS60 · M12 · פח 8 · מסבך מתחת', patch: { conn: 'tongue', chord: 'RHS60x60x4', diag: 'RHS60x60x4', bolt: { ...defaultLockTruss().bolt, d: 12 }, plateT: 8, position: 'below' } },
  { name: 'ללא סיב רציף · ריתוך 6 · גובה 1200', patch: { conn: 'tongue', continuous: false, weldSize: 6, height: 1200 } },
  { name: 'לשונית בשני הצדדים (A/B)', patch: { conn: 'plate', connA: 'tongue', connB: 'tongue' } },
  { name: 'פלטת קצה · ברירת מחדל (4×M16 דרך העמוד, אתר זוגי)', patch: { conn: 'plate' }, plate: true },
  { name: 'פלטת קצה · RHS60 · M12 · פלטה 8 · ללא סיב רציף', patch: { conn: 'plate', chord: 'RHS60x60x4', diag: 'RHS60x60x4', bolt: { ...defaultLockTruss().bolt, d: 12 }, plateT: 8, continuous: false }, plate: true },
  { name: 'צד A פלטה וצד B לשונית (מעורב)', patch: { conn: 'plate', connA: 'plate', connB: 'tongue' }, plate: true },
];
const proj = (c: Cfg, recipe: boolean) => {
  const b = defaultBuilding(); b.columnProfile = 'RHS200x200x8';
  b.bracing.walls = { ...b.bracing.walls, enabled: true, type: 'truss', truss: { ...defaultLockTruss(), ...c.patch, ...(recipe ? { engine: 'recipe' as const } : {}) } };
  return newProject('c', b);
};
const oldB = (d: DerivedModel) => d.connections.filter((c) => c.type === 'knee' && (/^C\.LT\.\d+\.[^.]+\.[CS][AB]$/.test(c.id) || /^C\.LT\.[^.]+\.F\d+\.COL\./.test(c.id)));
const newB = (d: DerivedModel) => d.connections.filter((c) => c.custom && PORTAL_RECIPES.includes(c.custom.detailId) && c.custom.site.startsWith('LT.'));
const parts = (d: DerivedModel, ids: string[]) => ids.map((i) => d.byId.get(i)).filter((m): m is Member => !!m && m.kind === 'plate');

describe('LOCK-01 מסבך נעילה (לשונית): הקוד הישן מול המתכון', () => {
  for (const cfg of CFGS) it(cfg.name, () => {
    const p0 = proj(cfg, false), d0 = generate(p0), p1 = proj(cfg, true), d1 = generate(p1);
    const oc = oldB(d0), nc = newB(d1);
    expect(oc.length).toBeGreaterThan(10);
    // אתר פלטה: חיבור אחד לעמוד (שני קצוות) מוחלף בשני חיבורי מתכון (אתר לכל קצה); בלי חיבורים ישנים שנשארו
    if (cfg.plate) { expect(oldB(d1).filter((c) => /^C\.LT\.[^.]+\.F\d+\.COL\./.test(c.id)).length).toBe(0); expect(nc.length).toBeGreaterThanOrEqual(oc.filter((c) => /\.COL\./.test(c.id)).length); }
    else { expect(oldB(d1).length + nc.length).toBe(oc.length); expect(nc.length).toBe(oc.length); }
    const bad: string[] = [];
    // האלמנטים עצמם (קורות ואלכסונים): אותם קצוות
    const bbs = (d: DerivedModel) => d.members.filter((m) => /^LT\./.test(m.id) && (m.kind === 'beam' || m.kind === 'brace'));
    const m0 = bbs(d0), m1 = bbs(d1);
    if (m0.length !== m1.length) bad.push(`אלמנטים ${m0.length}→${m1.length}`);
    for (const o of m0) {
      const x = d1.byId.get(o.id);
      if (!x) { bad.push(`${o.id} חסר`); continue; }
      if (dist(x.start, o.start) > TOL || dist(x.end, o.end) > TOL) bad.push(`${o.id}: קצוות ${dist(x.start, o.start).toFixed(2)}/${dist(x.end, o.end).toFixed(2)}`);
    }
    const op = oc.flatMap((c) => parts(d0, c.parts)), np = [...nc, ...oldB(d1)].flatMap((c) => parts(d1, c.parts));
    if (op.length !== np.length) bad.push(`פלטות ${op.length}→${np.length}`);
    const left = [...np];
    for (const o of op) {
      const i = left.findIndex((x) => x.profile === o.profile && dist(x.start, o.start) <= TOL && dist(x.end, o.end) <= TOL && Math.abs(dot(x.refUp, o.refUp)) > 0.999 && !!x.startCut === !!o.startCut && !!x.endCut === !!o.endCut);
      if (i < 0) bad.push(`פלטה ${o.profile} ב-(${o.start.x.toFixed(0)},${o.start.y.toFixed(0)},${o.start.z.toFixed(0)}) לא נמצאה`); else left.splice(i, 1);
    }
    const ob: BoltInfo[] = oc.flatMap((c) => c.bolts), nb: BoltInfo[] = [...nc, ...oldB(d1)].flatMap((c) => c.bolts);
    if (ob.length !== nb.length) bad.push(`ברגים ${ob.length}→${nb.length}`);
    const lb = [...nb];
    for (const o of ob) {
      const i = lb.findIndex((x) => dist(x.p, o.p) <= TOL && x.d === o.d && dot(x.axis, o.axis) > 0.999 && Math.abs(x.length - o.length) <= TOL && Math.abs(x.grip - o.grip) <= 0.01 && x.location === o.location && x.holesIn.length === o.holesIn.length);
      if (i < 0) bad.push(`בורג M${o.d} ב-(${o.p.x.toFixed(1)},${o.p.y.toFixed(1)},${o.p.z.toFixed(1)}) לא נמצא`); else lb.splice(i, 1);
    }
    const key = (w: WeldInfo) => `${w.location}|${w.a}|${w.length}`;
    const ow = oc.flatMap((c) => c.welds).map(key).sort().join(), nw = [...nc, ...oldB(d1)].flatMap((c) => c.welds).map(key).sort().join();
    if (ow !== nw) bad.push('ריתוכים שונים');
    expect(bad.slice(0, 8)).toEqual([]);
    const errs = (d: DerivedModel) => d.issues.filter((i) => i.severity === 'error').map((i) => `${i.code} ${i.message}`);
    expect(errs(d1)).toEqual(errs(d0));
    const f0 = computeFabrication(p0, d0), f1 = computeFabrication(p1, d1);
    const ids0 = new Set([...oc.flatMap((c) => c.parts), ...m0.map((m) => m.id)]), ids1 = new Set([...nc, ...oldB(d1)].flatMap((c) => c.parts).concat(m1.map((m) => m.id)));
    const rel = (f: typeof f0) => f.parts.filter((x) => (f === f0 ? ids0 : ids1).has(x.memberId));
    const markW = (ps: ReturnType<typeof rel>) => ps.map((x) => `${x.mark}:${x.weight.toFixed(2)}:${x.length.toFixed(1)}:${x.holes.length}`).sort();
    const cnt = (xs: string[]) => { const m: Record<string, number> = {}; xs.forEach((x) => { m[x] = (m[x] ?? 0) + 1; }); return m; };
    const ma = cnt(markW(rel(f0))), mb = cnt(markW(rel(f1)));
    expect(Object.keys({ ...ma, ...mb }).filter((k) => ma[k] !== mb[k]).map((k) => `${k}: ${ma[k] ?? 0}→${mb[k] ?? 0}`)).toEqual([]);
    const nc1 = (d: DerivedModel, p: Project, ps: ReturnType<typeof rel>) => ps.map((x) => { const ls = partToNc1(x, p, d, 1).split('\r\n'); const bo = ls.indexOf('BO'); return [ls.slice(8, 23).join('|'), ...(bo >= 0 ? ls.slice(bo + 1, ls.indexOf('EN')).sort() : [])].join('\n'); }).sort();
    expect(nc1(d1, p1, rel(f1))).toEqual(nc1(d0, p0, rel(f0)));
    expect(f1.assemblies.length).toBe(f0.assemblies.length);
  });
});

describe('LOCK-02 גיליונות השרטוט', () => {
  for (const [cfg, rids] of [[CFGS[0]!, [KNEE_FIN_LTCHORD_RECIPE_ID, KNEE_FIN_LTTRUSS_RECIPE_ID]], [CFGS[4]!, [LOCK_PLATE_RECIPE_ID]]] as const) it(`אותם גיליונות ואותה כמות ישויות (עד רעש עיגול ובחירת בועות) — ${cfg.name}`, () => {
    const p0 = proj(cfg, false), d0 = generate(p0), p1 = proj(cfg, true), d1 = generate(p1);
    const run = (p: Project, d: DerivedModel) => { const f = computeFabrication(p, d), bom = computeBom(d, f); return new Map(drawingCatalog(p, d, f).map((df) => [df.id, buildSheet(df, p, d, f, bom)])); };
    const a = run(p0, d0), b = run(p1, d1);
    const gone = [...a.keys()].filter((k) => !b.has(k)), added = [...b.keys()].filter((k) => !a.has(k));
    // חריג (ב): גיליון הפרט הרגיל של אלכסון נעלם (אם כל האלכסונים הומרו) והפרט המותאם מחליף אותו
    expect(gone.filter((k) => k !== 'D-CONN-knee')).toEqual([]);
    expect(added.sort()).toEqual(rids.map((r) => `D-CONN-cd-${r}`).sort());
    const SOFT = new Set(['OUTLINE', 'THIN', 'MARK']);
    const bad: string[] = [];
    for (const [id, sa] of a) {
      const sb = b.get(id); if (!sb || id === 'D-COVER' || id === 'D-CONN-knee') continue;
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
