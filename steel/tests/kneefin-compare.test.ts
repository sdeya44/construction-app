/**
 * CONV-01: שלב C (הסבה) — פיילוט אלכסון עמוד-קורה, פח + לשונית. ההשוואה האוטומטית: הפרט הישן (`finJoint`, דרך `buildKneeBraces`)
 * מול המתכון `kneeFinRecipe()` שמוחל על שני קצוות כל אלכסון. תנאי המעבר: מיקומי חלקים, מידות, חורים/ברגים, ריתוכים — זהים (סטייה ≤ 0.5 מ"מ).
 */
import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { kneeFinRecipe } from '../src/geometry/convRecipes';
import { assignDetail, setDetailParam } from '../src/commands/commands';
import { computeFabrication } from '../src/fab/marks';
import { partToNc1 } from '../src/fab/dstv';
import { computeBom } from '../src/fab/bom';
import { buildSheet, drawingCatalog } from '../src/drawing/views';
import type { BoltInfo, DerivedModel, Member, Project, WeldInfo } from '../src/model/types';

const TOL = 0.5;
const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const mid = (m: Member) => ({ x: (m.start.x + m.end.x) / 2, y: (m.start.y + m.end.y) / 2, z: (m.start.z + m.end.z) / 2 });
const L = (m: Member) => dist(m.start, m.end);
const dot = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => a.x * b.x + a.y * b.y + a.z * b.z;

interface Cfg { name: string; profile: string; d: number; boltsPerEnd: number; plateT: number }
const CFGS: Cfg[] = [
  { name: 'RHS60 · M16 · 2 ברגים · פח 10', profile: 'RHS60x60x4', d: 16, boltsPerEnd: 2, plateT: 10 },
  { name: 'RHS80 · M16 · 4 ברגים · פח 12', profile: 'RHS80x80x4', d: 16, boltsPerEnd: 4, plateT: 12 },
  { name: 'RHS100x50 · M20 · 2 ברגים · פח 10', profile: 'RHS100x50x4', d: 20, boltsPerEnd: 2, plateT: 10 },
  { name: 'RHS60 · M12 · בורג אחד · פח 8', profile: 'RHS60x60x4', d: 12, boltsPerEnd: 1, plateT: 8 },
];

function oldProject(c: Cfg): Project {
  const b = defaultBuilding();
  b.kneeBraces = { ...(b.kneeBraces as object), enabled: true, profile: c.profile, drop: 800, reach: 800, angle: 45, plateT: c.plateT, plateW: 150, plateL: 250, bolt: { d: c.d, grade: '8.8', standard: 'ISO 4017', clearance: 2 }, gauge: 80, pitch: 200, weldSize: 5, exclude: [], detail: 'fin', boltsPerEnd: c.boltsPerEnd } as never;
  return newProject('c', b);
}
function newProj(p: Project, d: DerivedModel, c: Cfg): Project {
  const det = kneeFinRecipe();
  const keys = d.members.filter((m) => m.id.startsWith('KB.')).flatMap((m) => [`${m.id}|start`, `${m.id}|end`]);
  let n = assignDetail(keys, det).run(p);
  for (const [name, v] of [['d', c.d], ['nb', c.boltsPerEnd], ['ft', c.plateT], ['tt', c.plateT]] as const) n = setDetailParam(keys, name, v).run(n);
  return n;
}
const parts = (d: DerivedModel, ids: string[]) => ids.map((i) => d.byId.get(i)).filter((m): m is Member => !!m && m.kind === 'plate');
const connsOf = (d: DerivedModel, brace: string, custom: boolean) => d.connections.filter((c) => (custom ? c.custom?.site.startsWith(`${brace}|`) : c.id === `C.${brace}`));

describe('CONV-01 אלכסון עמוד-קורה פח+לשונית: הקוד הישן מול המתכון', () => {
  for (const cfg of CFGS) it(cfg.name, () => {
    const p0 = oldProject(cfg), d0 = generate(p0);
    const braces = d0.members.filter((m) => m.id.startsWith('KB.'));
    expect(braces.length).toBeGreaterThan(4);
    const newP = newProj(p0, d0, cfg);
    const d1 = generate(newP);
    const bad: string[] = [];
    for (const br of braces) {
      const b1 = d1.byId.get(br.id);
      if (!b1) { bad.push(`${br.id}: אלכסון חסר במודל החדש`); continue; }
      if (dist(br.start, b1.start) > TOL || dist(br.end, b1.end) > TOL) bad.push(`${br.id}: קצות האלכסון (${dist(br.start, b1.start).toFixed(2)}, ${dist(br.end, b1.end).toFixed(2)})`);
      const oc = connsOf(d0, br.id, false), nc = connsOf(d1, br.id, true);
      if (oc.length !== 1 || nc.length !== 2) { bad.push(`${br.id}: חיבורים ישן ${oc.length} חדש ${nc.length}`); continue; }
      const oldParts = parts(d0, oc[0]!.parts), newParts = nc.flatMap((c) => parts(d1, c.parts));
      if (oldParts.length !== newParts.length) bad.push(`${br.id}: פלטות ${oldParts.length}→${newParts.length}`);
      for (const o of oldParts) {
        const m = newParts.find((x) => x.profile === o.profile && Math.abs(L(x) - L(o)) <= TOL && dist(mid(x), mid(o)) <= TOL && Math.abs(dot(x.refUp, o.refUp)) > 0.999);
        if (!m) bad.push(`${br.id}: פלטה ${o.profile} L=${L(o).toFixed(1)} לא נמצאה במודל החדש`);
      }
      const ob: BoltInfo[] = oc[0]!.bolts, nb = nc.flatMap((c) => c.bolts);
      if (ob.length !== nb.length) bad.push(`${br.id}: ברגים ${ob.length}→${nb.length}`);
      for (const o of ob) {
        const m = nb.find((x) => dist(x.p, o.p) <= TOL && x.d === o.d && dot(x.axis, o.axis) > 0.999 && Math.abs(x.length - o.length) <= TOL && x.location === o.location);
        if (!m) bad.push(`${br.id}: בורג M${o.d} ב-(${o.p.x.toFixed(1)},${o.p.y.toFixed(1)},${o.p.z.toFixed(1)}) לא נמצא`);
      }
      const ow: WeldInfo[] = oc[0]!.welds, nw = nc.flatMap((c) => c.welds);
      const key = (w: WeldInfo) => `${w.location}|${w.a}|${w.length}`;
      if (ow.map(key).sort().join() !== nw.map(key).sort().join()) bad.push(`${br.id}: ריתוכים ${ow.map(key).sort().join(' ')} ← ${nw.map(key).sort().join(' ')}`);
    }
    expect(bad).toEqual([]);
    // המודל החדש לא מוסיף שגיאות
    const errs = (d: DerivedModel) => d.issues.filter((i) => i.severity === 'error').map((i) => `${i.code} ${i.message}`);
    expect(errs(d1)).toEqual(errs(d0));
    // ייצור: אותם סימונים, אותם משקלים, ואותו NC1 (ללא שורות שם/סימון/תיאור; החורים ממוינים)
    const f0 = computeFabrication(p0, d0), f1 = computeFabrication(newP, d1);
    const rel0 = f0.parts.filter((x) => /^(C\.KB\.|KB\.)/.test(x.memberId)), rel1 = f1.parts.filter((x) => /^(C\.CD\.KB\.|KB\.)/.test(x.memberId));
    expect(rel1.length).toBe(rel0.length);
    const markW = (ps: typeof rel0) => ps.map((x) => `${x.mark}:${x.weight.toFixed(2)}:${x.cutStart.toFixed(1)}/${x.cutEnd.toFixed(1)}:${x.holes.length}`).sort();
    expect(markW(rel1)).toEqual(markW(rel0));
    const nc = (d: DerivedModel, p: Project, ps: typeof rel0) => ps.map((x) => {
      const ls = partToNc1(x, p, d, 1).split('\r\n');
      const bo = ls.indexOf('BO');
      return [ls.slice(8, 23).join('|'), ...(bo >= 0 ? ls.slice(bo + 1, ls.indexOf('EN')).sort() : [])].join('\n');
    }).sort();
    expect(nc(d1, newP, rel1)).toEqual(nc(d0, p0, rel0));
    const total = (ps: typeof rel0) => ps.reduce((a, x) => a + x.weight, 0);
    expect(Math.abs(total(rel1) - total(rel0))).toBeLessThan(0.01);
    expect(f1.assemblies.length).toBe(f0.assemblies.length);
  });
});

/**
 * CONV-02: גיליונות השרטוט. אין זהות בייט-בייט (ראו docs/connector-mapping.md סעיף 6): מותר רק
 *  (א) רעש עיגול ≤ 1 במספרי מידות (95 ↔ 96 בגבול חצי מ"מ), (ב) גיליון פרט האלכסון, שהוא גיליון פרט מותאם (שם ומספור שונים),
 *  (ג) בחירת החלק המייצג בגיליון הפלטות (אותו סימון, צד קריאה הפוך של החורים).
 * כל השאר — אותם גיליונות, אותה כמות ישויות מכל סוג, אותם טקסטים — חייב להיות זהה.
 */
describe('CONV-02 אלכסון עמוד-קורה: גיליונות השרטוט', () => {
  it('אותם גיליונות, אותה כמות ישויות, אותם טקסטים (עד רעש עיגול)', () => {
    const cfg = CFGS[0]!;
    const p0 = oldProject(cfg), d0 = generate(p0), p1 = newProj(p0, d0, cfg), d1 = generate(p1);
    const run = (p: Project, d: DerivedModel) => { const f = computeFabrication(p, d), bom = computeBom(d, f); return new Map(drawingCatalog(p, d, f).map((df) => [df.id, buildSheet(df, p, d, f, bom)])); };
    const a = run(p0, d0), b = run(p1, d1);
    expect(a.size).toBe(b.size);
    const gone = [...a.keys()].filter((k) => !b.has(k)), added = [...b.keys()].filter((k) => !a.has(k));
    expect(gone).toEqual(['D-CONN-knee']);
    expect(added).toEqual([`D-CONN-cd-${kneeFinRecipe().id}`]);
    const EXEMPT = new Set(['D-COVER', 'D-PLATES-3']);
    const bad: string[] = [];
    for (const [id, sa] of a) {
      const sb = b.get(id); if (!sb) continue;
      const ea = sa.ents.filter((e) => e.layer !== 'TITLE'), eb = sb.ents.filter((e) => e.layer !== 'TITLE');
      if (ea.length !== eb.length) { bad.push(`${id}: ישויות ${ea.length}→${eb.length}`); continue; }
      const hist = (es: typeof ea) => { const m: Record<string, number> = {}; for (const e of es) m[`${e.k}|${e.layer}`] = (m[`${e.k}|${e.layer}`] ?? 0) + 1; return JSON.stringify(Object.entries(m).sort()); };
      if (hist(ea) !== hist(eb)) bad.push(`${id}: התפלגות ישויות שונה`);
      if (EXEMPT.has(id)) continue;
      const txt = (es: typeof ea) => es.filter((e) => e.k === 'text').map((e) => (/^-?\d+(\.\d+)?$/.test((e as { s: string }).s) ? '#' : (e as { s: string }).s)).sort();
      if (JSON.stringify(txt(ea)) !== JSON.stringify(txt(eb))) bad.push(`${id}: טקסטים שונים`);
      const num = (es: typeof ea) => es.filter((e) => e.k === 'text' && /^-?\d+(\.\d+)?$/.test((e as { s: string }).s)).map((e) => Number((e as { s: string }).s)).sort((x, y) => x - y);
      const na = num(ea), nb = num(eb);
      if (na.some((v, i) => Math.abs(v - nb[i]!) > 1)) bad.push(`${id}: ערך מידה שונה ביותר מ-1`);
    }
    expect(bad).toEqual([]);
    // הגיליון המותאם מכיל את אותם חלקים: כמות פלטות וברגים בטבלה
    const t = (sh: typeof a extends Map<string, infer S> ? S : never) => sh.ents.filter((e) => e.k === 'text').length;
    expect(Math.abs(t(b.get(added[0]!)!) - t(a.get('D-CONN-knee')!))).toBeLessThan(40);
  });
});
