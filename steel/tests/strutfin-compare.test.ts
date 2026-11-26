/**
 * STRUT-01/02: שלב D (הסבה) — תמוכה בין קורות, פרט `fin`. הקוד הישן (`finJoint` דרך `buildRafterStruts`) מול המתכון `strutFinRecipe()`
 * שמוחל על כל קצוות התמוכות. תנאי המעבר זהים לאלכסון (CONV-01/02): מיקומי חלקים, מידות, חורים/ברגים, ריתוכים, סימונים, משקלים, NC1, גיליונות.
 */
import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { defaultRafterStruts } from '../src/geometry/rafterStruts';
import { strutEndRecipe, strutFinRecipe, strutWeldRecipe } from '../src/geometry/convRecipes';
import { assignDetail, setDetailParam } from '../src/commands/commands';
import { applyDetail, candidates, familyOf, readCurrent, situationOf } from '../src/model/connRegistry';
import { computeFabrication } from '../src/fab/marks';
import { partToNc1 } from '../src/fab/dstv';
import { computeBom } from '../src/fab/bom';
import { buildSheet, drawingCatalog } from '../src/drawing/views';
import type { BoltInfo, DerivedModel, Member, Project, WeldInfo } from '../src/model/types';

const TOL = 0.5;
type V = { x: number; y: number; z: number };
const dist = (a: V, b: V) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const mid = (m: Member) => ({ x: (m.start.x + m.end.x) / 2, y: (m.start.y + m.end.y) / 2, z: (m.start.z + m.end.z) / 2 });
const L = (m: Member) => dist(m.start, m.end);
const dot = (a: V, b: V) => a.x * b.x + a.y * b.y + a.z * b.z;

interface Cfg { detail?: 'fin' | 'endplate' | 'weld'; name: string; profile: string; d: number; bolts: number; plateT: number; rows: { id: string; from: string; toward: string; dist: number; bays?: number[]; profile?: string }[] }
const CFGS: Cfg[] = [
  { name: 'RHS80 · M16 · 2 ברגים · פח 10', profile: 'RHS80x80x4', d: 16, bolts: 2, plateT: 10, rows: [{ id: 'r1', from: 'L', toward: 'R', dist: 4000 }] },
  { name: 'RHS100 · M20 · 4 ברגים · פח 12 · שתי שורות', profile: 'RHS100x100x5', d: 20, bolts: 4, plateT: 12, rows: [{ id: 'r1', from: 'L', toward: 'R', dist: 3000 }, { id: 'r2', from: 'R', toward: 'L', dist: 5000, bays: [1, 2] }] },
  { name: 'RHS100x50 · M12 · 2 ברגים · פח 8', profile: 'RHS100x50x4', d: 12, bolts: 2, plateT: 8, rows: [{ id: 'r1', from: 'L', toward: 'R', dist: 6000, bays: [0, 1, 2, 3] }] },
];

/** פלטת קצה (אתר זוגי): הקצוות נבנים דרך הדגל (שיוך משתמע עם מי-בונה-ברגים וזוגות), לא בהחלה מפורשת */
const END_CFGS: Cfg[] = [
  { detail: 'endplate', name: 'פלטת קצה · RHS80 · M16 · 2 ברגים · פח 10', profile: 'RHS80x80x4', d: 16, bolts: 2, plateT: 10, rows: [{ id: 'r1', from: 'L', toward: 'R', dist: 4000 }] },
  { detail: 'endplate', name: 'פלטת קצה · RHS80 · M16 · 4 ברגים · פח 10 (פלטה נמוכה — 2 ברגים בלבד)', profile: 'RHS80x80x4', d: 16, bolts: 4, plateT: 10, rows: [{ id: 'r1', from: 'L', toward: 'R', dist: 4000, bays: [0, 1] }] },
  { detail: 'endplate', name: 'פלטת קצה · RHS100 · M20 · 4 ברגים · פח 12 · שתי שורות', profile: 'RHS100x100x5', d: 20, bolts: 4, plateT: 12, rows: [{ id: 'r1', from: 'L', toward: 'R', dist: 3000 }, { id: 'r2', from: 'R', toward: 'L', dist: 5000, bays: [1, 2] }] },
  { detail: 'endplate', name: 'פלטת קצה · RHS100x50 · M12 · 2 ברגים · פח 8 · מפתחות בודדים', profile: 'RHS100x50x4', d: 12, bolts: 2, plateT: 8, rows: [{ id: 'r1', from: 'L', toward: 'R', dist: 6000, bays: [0, 2, 3] }] },
];

const WELD_CFGS: Cfg[] = [
  { detail: 'weld', name: 'ריתוך ישיר · RHS80', profile: 'RHS80x80x4', d: 16, bolts: 2, plateT: 10, rows: [{ id: 'r1', from: 'L', toward: 'R', dist: 4000 }] },
  { detail: 'weld', name: 'ריתוך ישיר · RHS100x50 · שתי שורות', profile: 'RHS100x50x5', d: 16, bolts: 2, plateT: 10, rows: [{ id: 'r1', from: 'L', toward: 'R', dist: 3000, bays: [0, 1] }, { id: 'r2', from: 'R', toward: 'L', dist: 5000, bays: [1, 2, 3] }] },
];

function oldProject(c: Cfg): Project {
  const b = defaultBuilding();
  b.bracing.rafterStruts = { ...defaultRafterStruts(), detail: c.detail ?? 'fin', profile: c.profile, plateT: c.plateT, bolts: c.bolts, bolt: { d: c.d, grade: '8.8', standard: 'ISO 4017', clearance: 2 }, rows: c.rows };
  return newProject('s', b);
}
const strutIds = (d: DerivedModel) => d.members.filter((m) => /^RS\d+\.\d+$/.test(m.id)).map((m) => m.id);
function assigned(p: Project, d: DerivedModel, c: Cfg): Project {
  if (c.detail === 'endplate' || c.detail === 'weld') { const n = structuredClone(p); n.building.bracing.rafterStruts![c.detail === 'weld' ? 'weldEngine' : 'endEngine'] = 'recipe'; return n; }
  const det = strutFinRecipe();
  const keys = strutIds(d).flatMap((id) => [`${id}|start`, `${id}|end`]);
  let n = assignDetail(keys, det).run(p);
  for (const [name, v] of [['d', c.d], ['nb', c.bolts], ['ft', c.plateT], ['tt', c.plateT]] as const) n = setDetailParam(keys, name, v).run(n);
  return n;
}
const isOldC = (id?: string) => /^C\.RS\d+\./.test(id ?? '');
const oldConns = (d: DerivedModel) => d.connections.filter((c) => isOldC(c.id));
const newConns = (d: DerivedModel) => d.connections.filter((c) => c.custom && /^RS\d+\.\d+\|/.test(c.custom.site));

describe('STRUT-01 תמוכה בין קורות: הקוד הישן מול המתכון (fin + endplate)', () => {
  for (const cfg of [...CFGS, ...END_CFGS, ...WELD_CFGS]) it(cfg.name, () => {
    const p0 = oldProject(cfg), d0 = generate(p0);
    expect(strutIds(d0).length).toBeGreaterThan(1);
    const p1 = assigned(p0, d0, cfg), d1 = generate(p1);
    const bad: string[] = [];
    // התמוכות עצמן
    for (const id of strutIds(d0)) {
      const a = d0.byId.get(id)!, b = d1.byId.get(id);
      if (!b) { bad.push(`${id}: חסרה`); continue; }
      if (dist(a.start, b.start) > TOL || dist(a.end, b.end) > TOL) bad.push(`${id}: קצוות (${dist(a.start, b.start).toFixed(2)}, ${dist(a.end, b.end).toFixed(2)})`);
    }
    // פלטות
    const oldP = oldConns(d0).flatMap((c) => c.parts.map((i) => d0.byId.get(i)).filter((m): m is Member => !!m && m.kind === 'plate'));
    const newP = newConns(d1).flatMap((c) => c.parts.map((i) => d1.byId.get(i)).filter((m): m is Member => !!m && m.kind === 'plate'));
    if (oldP.length !== newP.length) bad.push(`פלטות ${oldP.length}→${newP.length}`);
    const left = [...newP];
    for (const o of oldP) {
      const i = left.findIndex((x) => x.profile === o.profile && Math.abs(L(x) - L(o)) <= TOL && dist(mid(x), mid(o)) <= TOL && Math.abs(dot(x.refUp, o.refUp)) > 0.999);
      if (i < 0) bad.push(`פלטה ${o.profile} L=${L(o).toFixed(1)} ב-(${mid(o).x.toFixed(0)},${mid(o).y.toFixed(0)},${mid(o).z.toFixed(0)}) לא נמצאה`); else left.splice(i, 1);
    }
    // ברגים
    const ob: BoltInfo[] = oldConns(d0).flatMap((c) => c.bolts), nb: BoltInfo[] = newConns(d1).flatMap((c) => c.bolts);
    if (ob.length !== nb.length) bad.push(`ברגים ${ob.length}→${nb.length}`);
    const lb = [...nb];
    for (const o of ob) {
      const i = lb.findIndex((x) => dist(x.p, o.p) <= TOL && x.d === o.d && dot(x.axis, o.axis) > 0.999 && Math.abs(x.length - o.length) <= TOL && x.location === o.location);
      if (i < 0) bad.push(`בורג M${o.d} ב-(${o.p.x.toFixed(1)},${o.p.y.toFixed(1)},${o.p.z.toFixed(1)}) לא נמצא`); else lb.splice(i, 1);
    }
    // ריתוכים
    const key = (w: WeldInfo) => `${w.location}|${w.a}|${w.length}`;
    const ow: WeldInfo[] = oldConns(d0).flatMap((c) => c.welds), nw: WeldInfo[] = newConns(d1).flatMap((c) => c.welds);
    if (ow.map(key).sort().join() !== nw.map(key).sort().join()) bad.push(`ריתוכים ${ow.map(key).sort().join(' ')} ← ${nw.map(key).sort().join(' ')}`);
    expect(bad).toEqual([]);
    const errs = (d: DerivedModel) => d.issues.filter((i) => i.severity === 'error').map((i) => `${i.code} ${i.message}`);
    expect(errs(d1)).toEqual(errs(d0));
    // ייצור
    const f0 = computeFabrication(p0, d0), f1 = computeFabrication(p1, d1);
    const rel0 = f0.parts.filter((x) => /^(C\.RS\d|RS\d)/.test(x.memberId)), rel1 = f1.parts.filter((x) => /^(C\.CD\.RS\d|RS\d)/.test(x.memberId));
    expect(rel1.length).toBe(rel0.length);
    const markW = (ps: typeof rel0) => ps.map((x) => `${x.mark}:${x.weight.toFixed(2)}:${x.cutStart.toFixed(1)}/${x.cutEnd.toFixed(1)}:${x.holes.length}`).sort();
    expect(markW(rel1)).toEqual(markW(rel0));
    const nc = (d: DerivedModel, p: Project, ps: typeof rel0) => ps.map((x) => {
      const ls = partToNc1(x, p, d, 1).split('\r\n');
      const bo = ls.indexOf('BO');
      return [ls.slice(8, 23).join('|'), ...(bo >= 0 ? ls.slice(bo + 1, ls.indexOf('EN')).sort() : [])].join('\n');
    }).sort();
    expect(nc(d1, p1, rel1)).toEqual(nc(d0, p0, rel0));
    expect(Math.abs(rel1.reduce((a, x) => a + x.weight, 0) - rel0.reduce((a, x) => a + x.weight, 0))).toBeLessThan(0.01);
    expect(f1.assemblies.length).toBe(f0.assemblies.length);
  });
});

/** STRUT-02: גיליונות השרטוט — אותם כללים כמו CONV-02 (אותן ישויות וטקסטים עד רעש עיגול; גיליון הפרט המותאם הוא חריג מאושר) */
describe('STRUT-02 תמוכות: גיליונות השרטוט', () => {
  for (const cfg of [CFGS[0]!, CFGS[1]!, END_CFGS[0]!, END_CFGS[2]!, WELD_CFGS[0]!]) it(cfg.name, () => {
    const p0 = oldProject(cfg), d0 = generate(p0), p1 = assigned(p0, d0, cfg), d1 = generate(p1);
    const run = (p: Project, d: DerivedModel) => { const f = computeFabrication(p, d), bom = computeBom(d, f); return new Map(drawingCatalog(p, d, f).map((df) => [df.id, buildSheet(df, p, d, f, bom)])); };
    const a = run(p0, d0), b = run(p1, d1);
    const gone = [...a.keys()].filter((k) => !b.has(k)), added = [...b.keys()].filter((k) => !a.has(k));
    // חריג מאושר (כמו (ב) באלכסון): נוסף גיליון פרט מותאם אחד; מספור העמודים (n/N) זז בהתאם
    expect(gone).toEqual([]);
    expect(added).toEqual([`D-CONN-cd-${cfg.detail === 'endplate' ? strutEndRecipe().id : cfg.detail === 'weld' ? strutWeldRecipe().id : strutFinRecipe().id}`]);
    const bad: string[] = [];
    // (א)+(ד) מורחב לגיליונות מכלול: סטיית מיקום ≤ 0.1 מ"מ בראשי ברגים משנה אילו קצוות משושה נראים (OUTLINE/THIN), ובחירת החלק שמקבל בועה
    // בחפיפה (לשונית בתוך ה-RHS) תלויה בסדר — לכן MARK/OUTLINE/THIN בטולרנס; כל השאר (חתכים, צירים, מידות, טקסטים) — מדויק.
    const SOFT = new Set(['OUTLINE', 'THIN', 'MARK']);
    for (const [id, sa] of a) {
      const sb = b.get(id); if (!sb) continue;
      if (id === 'D-COVER') continue; // שורה נוספת ברשימת השרטוטים (הגיליון המותאם)
      const ea = sa.ents.filter((e) => e.layer !== 'TITLE'), eb = sb.ents.filter((e) => e.layer !== 'TITLE');
      const hist = (es: typeof ea) => { const m: Record<string, number> = {}; for (const e of es) m[`${e.k}|${e.layer}`] = (m[`${e.k}|${e.layer}`] ?? 0) + 1; return m; };
      const ha = hist(ea), hb = hist(eb);
      for (const k of new Set([...Object.keys(ha), ...Object.keys(hb)])) {
        const x = ha[k] ?? 0, y = hb[k] ?? 0, soft = SOFT.has(k.split('|')[1]!);
        if (soft ? Math.abs(x - y) > Math.max(10, 0.01 * x) : x !== y) bad.push(`${id}: ${k} ${x}→${y}`);
      }
      const txt = (es: typeof ea, soft: boolean) => es.filter((e) => e.k === 'text' && (e.layer === 'MARK') === soft).map((e) => (/^-?\d+(\.\d+)?$/.test((e as { s: string }).s) ? '#' : /^\d+\/\d+$/.test((e as { s: string }).s) ? '#/#' : (e as { s: string }).s)).sort();
      if (JSON.stringify(txt(ea, false)) !== JSON.stringify(txt(eb, false))) bad.push(`${id}: טקסטים שונים`);
      if (JSON.stringify([...new Set(txt(ea, true))]) !== JSON.stringify([...new Set(txt(eb, true))])) bad.push(`${id}: קבוצת סימוני הבועות שונה`);
      const num = (es: typeof ea) => es.filter((e) => e.k === 'text' && /^-?\d+(\.\d+)?$/.test((e as { s: string }).s)).map((e) => Number((e as { s: string }).s)).sort((x, y) => x - y);
      const na = num(ea), nb = num(eb);
      if (na.length !== nb.length || na.some((v, i) => Math.abs(v - nb[i]!) > 1)) bad.push(`${id}: ערך מידה שונה ביותר מ-1`);
    }
    expect(bad).toEqual([]);
  });
});

/** STRUT-03: הדגל `rafterStruts.finEngine` (ללא ממשק): שקול להחלה מפורשת; ברירת מחדל = קוד ישן; אשף מחיבור custom */
describe('STRUT-03 דגל finEngine ואשף', () => {
  const cfg = CFGS[1]!;
  const sig = (p: Project, d: DerivedModel) => ({
    members: d.members.map((m) => `${m.id}|${m.profile}|${[m.start.x, m.start.y, m.start.z, m.end.x, m.end.y, m.end.z].map((v) => v.toFixed(1)).join(',')}`).sort(),
    parts: computeFabrication(p, d).parts.map((x) => `${x.mark}:${x.weight.toFixed(2)}:${x.holes.length}`).sort(),
  });
  it('ללא דגל = קוד ישן; recipe = החלה מפורשת (כולל ספירת אתרים)', () => {
    const p0 = oldProject(cfg), d0 = generate(p0);
    expect(d0.connections.some((c) => c.custom)).toBe(false);
    const explicit = assigned(p0, d0, cfg), dE = generate(explicit);
    const p1 = structuredClone(p0); p1.building.bracing.rafterStruts!.finEngine = 'recipe';
    const d1 = generate(p1);
    expect(p1.detailAssign).toBeUndefined();
    expect(newConns(d1).length).toBe(strutIds(d0).length * 2);
    expect(sig(p1, d1)).toEqual(sig(explicit, dE));
    const p2 = structuredClone(p0); p2.building.bracing.rafterStruts!.finEngine = 'legacy';
    expect(sig(p2, generate(p2))).toEqual(sig(p0, d0));
  });
  it('פרט אחר (endplate / weld) נשאר בקוד הישן גם עם recipe', () => {
    for (const det of ['endplate', 'weld'] as const) {
      const p = oldProject(cfg); p.building.bracing.rafterStruts!.detail = det; p.building.bracing.rafterStruts!.finEngine = 'recipe';
      expect(generate(p).connections.some((c) => c.custom)).toBe(false);
    }
  });
  it('אשף החיבורים נפתח מחיבור custom של תמוכה, וחזרה לפלטת קצה מבטלת את המתכון', () => {
    const p0 = oldProject(cfg); p0.building.bracing.rafterStruts!.finEngine = 'recipe';
    const d0 = generate(p0), cs = newConns(d0);
    expect(cs.length).toBeGreaterThan(4);
    for (const c of cs) {
      expect(familyOf(c)).toBe('strut');
      const sit = situationOf(p0, d0, c.id);
      expect(sit?.family).toBe('strut');
      expect(sit!.site!.key).toBe(c.custom!.site);
    }
    const sit = situationOf(p0, d0, cs[0]!.id)!;
    expect(readCurrent(p0, sit).detail).toBe('strut.fin');
    expect(candidates(p0, sit).some((x) => x.detail === 'strut.endplate')).toBe(true);
    const p1 = applyDetail(p0, sit, 'strut.endplate', {}, 'all');
    expect(newConns(generate(p1)).length).toBe(0);
  });
});

/** STRUT-04: פלטת קצה (אתר זוגי) וריתוך ישיר — דגלים, אשף, ושיוך מפורש לצד אחד בלבד */
describe('STRUT-04 endplate / weld: דגלים, אשף ואתר זוגי', () => {
  const flag = (c: Cfg, k: 'endEngine' | 'weldEngine') => { const p = oldProject(c); p.building.bracing.rafterStruts![k] = 'recipe'; return p; };
  it('ללא דגל = קוד ישן; דגל של פרט אחר לא משפיע', () => {
    const e = oldProject(END_CFGS[0]!); e.building.bracing.rafterStruts!.finEngine = 'recipe'; e.building.bracing.rafterStruts!.weldEngine = 'recipe';
    expect(generate(e).connections.some((c) => c.custom)).toBe(false);
    const w = oldProject(WELD_CFGS[0]!); w.building.bracing.rafterStruts!.finEngine = 'recipe'; w.building.bracing.rafterStruts!.endEngine = 'recipe';
    expect(generate(w).connections.some((c) => c.custom)).toBe(false);
  });
  it('אשף מחיבור custom (פלטת קצה / ריתוך) וחזרה לפרט הרגיל', () => {
    for (const [cfg, k] of [[END_CFGS[0]!, 'endEngine'], [WELD_CFGS[0]!, 'weldEngine']] as const) {
      const p0 = flag(cfg, k), d0 = generate(p0), cs = newConns(d0);
      expect(cs.length).toBe(strutIds(d0).length * 2);
      const sit = situationOf(p0, d0, cs[0]!.id)!;
      expect(sit.family).toBe('strut');
      expect(readCurrent(p0, sit).detail).toBe(`strut.${cfg.detail}`);
      const p1 = applyDetail(p0, sit, 'strut.fin', {}, 'all');
      expect(newConns(generate(p1)).length).toBe(0);
    }
  });
  it('שיוך מפורש של פרט אחר לצד אחד של הווב: הצד השני בונה לבדו את הברגים (דרך הפלטה והווב בלבד)', () => {
    const cfg = END_CFGS[0]!, p0 = flag(cfg, 'endEngine'), d0 = generate(p0);
    const frame2 = newConns(d0).filter((c) => c.custom!.site === 'RS1.1|end' || c.custom!.site === 'RS1.2|start');
    expect(frame2.length).toBe(2);
    expect(frame2.flatMap((c) => c.bolts).length).toBe(2); // 2 ברגים משותפים — בונה אחד
    const other = { ...strutEndRecipe(), id: 'other-y', name: 'אחר' };
    for (const site of ['RS1.1|end', 'RS1.2|start']) {
      const d = generate(assignDetail([site], other).run(p0));
      const mine = d.connections.filter((c) => c.custom && c.custom.detailId === 'conv-strut-end' && ['RS1.1|end', 'RS1.2|start'].includes(c.custom.site));
      expect(mine.length).toBe(1);
      expect(mine[0]!.bolts.length).toBeGreaterThanOrEqual(2);
      expect(mine[0]!.bolts.every((b) => b.grip < 25)).toBe(true); // רק פלטה אחת + ווב (לא שתי פלטות)
    }
  });
});
