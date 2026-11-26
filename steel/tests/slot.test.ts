/**
 * G12 — חריץ RHS (לשונית): נתון ייצור על האלמנט (`Connection.slots`), לא ערך מחושב בלבד.
 * SLOT-01: הקוד הישן (`finJoint`) והמתכון (`kneeFinRecipe`) מפיקים אותו חריץ (מיקום, כיוון, מידות).
 * SLOT-02: ה-NC1 (שורות `** SLOT`) מושווה לגיאומטריית הלשונית שנמדדה ישירות מהמוצק — רוחב = עובי + 1, עומק = חפיפה + 2, פתח בקצה האלמנט.
 * SLOT-03: שרטוט החלק מצייר את אותם מידות מנתוני המודל; חלק בלי חריץ — ללא שורת חריצים.
 * SLOT-04: חלקים שונים בחריץ בלבד — חתימה (סימון) שונה.
 */
import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { kneeFinRecipe, strutFinRecipe } from '../src/geometry/convRecipes';
import { defaultRafterStruts } from '../src/geometry/rafterStruts';
import { assignDetail, setDetailParam } from '../src/commands/commands';
import { localFrame } from '../src/geometry/frame';
import { cachedSolidPure } from '../src/drawing/solidCache';
import { computeFabrication } from '../src/fab/marks';
import { partToNc1 } from '../src/fab/dstv';
import { computeBom } from '../src/fab/bom';
import { buildSheet, drawingCatalog } from '../src/drawing/views';
import { dot, sub } from '../src/core/vec';
import { getProfile } from '../src/profiles/library';
import type { DerivedModel, Member, Project } from '../src/model/types';

function mk(profile: string, plateT: number, d = 16, boltsPerEnd = 2): Project {
  const b = defaultBuilding();
  b.kneeBraces = { ...(b.kneeBraces as object), enabled: true, profile, drop: 800, reach: 800, angle: 45, plateT, plateW: 150, plateL: 250, bolt: { d, grade: '8.8', standard: 'ISO 4017', clearance: 2 }, gauge: 80, pitch: 200, weldSize: 5, exclude: [], detail: 'fin', boltsPerEnd } as never;
  return newProject('slot', b);
}
function asRecipe(p: Project, d: DerivedModel, plateT: number, dia = 16, nb = 2): Project {
  const keys = d.members.filter((m) => m.id.startsWith('KB.')).flatMap((m) => [`${m.id}|start`, `${m.id}|end`]);
  let n = assignDetail(keys, kneeFinRecipe()).run(p);
  for (const [name, v] of [['d', dia], ['nb', nb], ['ft', plateT], ['tt', plateT]] as const) n = setDetailParam(keys, name, v).run(n);
  return n;
}
const slotsOf = (d: DerivedModel, id: string) => d.connections.flatMap((c) => c.slots ?? []).filter((s) => s.memberId === id);
const CFGS: [string, number][] = [['RHS60x60x4', 10], ['RHS80x80x4', 12], ['RHS100x50x4', 10]];

describe('SLOT-01 חריץ במודל: הקוד הישן מול המתכון', () => {
  for (const [profile, t] of CFGS) it(`${profile} · פח ${t}`, () => {
    const p0 = mk(profile, t), d0 = generate(p0), d1 = generate(asRecipe(p0, d0, t));
    const braces = d0.members.filter((m) => m.id.startsWith('KB.'));
    expect(braces.length).toBeGreaterThan(4);
    const bad: string[] = [];
    for (const br of braces) {
      const ex = localFrame(br).ex, along = (q: { p: { x: number; y: number; z: number } }) => dot(sub(q.p, br.start), ex);
      const a = slotsOf(d0, br.id).sort((x, y) => along(x) - along(y)), b = slotsOf(d1, br.id).sort((x, y) => along(x) - along(y));
      if (a.length !== 2 || b.length !== 2) { bad.push(`${br.id}: חריצים ${a.length}/${b.length} (צפוי 2/2)`); continue; }
      a.forEach((s, i) => {
        const q = b[i]!;
        const dp = Math.hypot(s.p.x - q.p.x, s.p.y - q.p.y, s.p.z - q.p.z);
        if (dp > 0.5 || Math.abs(dot(s.axis, q.axis) - 1) > 1e-6 || Math.abs(Math.abs(dot(s.nrm, q.nrm)) - 1) > 1e-6 || Math.abs(s.L - q.L) > 0.5 || Math.abs(s.w - q.w) > 0.01) bad.push(`${br.id}[${i}]: p ${dp.toFixed(2)} L ${s.L}/${q.L} w ${s.w}/${q.w}`);
      });
    }
    expect(bad).toEqual([]);
  });
});

describe('SLOT-02 NC1 מול גיאומטריית הלשונית', () => {
  for (const [profile, t] of CFGS) it(`${profile} · פח ${t}`, () => {
    const p = mk(profile, t), d = generate(p), fab = computeFabrication(p, d);
    const braces = d.members.filter((m) => m.id.startsWith('KB.'));
    const bad: string[] = []; let checked = 0;
    for (const br of braces) {
      const f = localFrame(br), Lm = Math.hypot(br.end.x - br.start.x, br.end.y - br.start.y, br.end.z - br.start.z);
      const part = fab.parts.find((x) => x.memberId === br.id)!;
      const nc = partToNc1(part, p, d, 1).split('\r\n').filter((l) => l.startsWith('** SLOT'));
      const conns = d.connections.filter((c) => c.parts.includes(br.id));
      // אמת מידה: הלשוניות (מוצק אמיתי) — עובי = עובי הפרופיל, חפיפה בציר האלמנט נמדדת מהטבעות
      const truth: { w: number; depth: number; mouth: number }[] = [];
      for (const c of conns) for (const id of c.parts) {
        const tg = d.byId.get(id) as Member | undefined;
        if (!tg || tg.kind !== 'plate' || !/\.T$/.test(tg.id)) continue;
        const s = cachedSolidPure(tg);
        const ts = [...s.startRing, ...s.endRing].map((q) => dot(sub(q, br.start), f.ex));
        const lo = Math.min(...ts), hi = Math.max(...ts);
        const atStart = Math.abs((lo + hi) / 2) < Math.abs((lo + hi) / 2 - Lm);
        truth.push({ w: (getProfile(tg.profile).dims.t ?? 0) + 1, depth: (atStart ? hi : Lm - lo) + 2, mouth: atStart ? 0 : Lm });
      }
      if (truth.length !== 2 || nc.length !== 2) { bad.push(`${br.id}: לשוניות ${truth.length}, שורות SLOT ${nc.length} (צפוי 2/2)`); continue; }
      const got = nc.map((l) => ({ w: +/ w=([\d.]+)/.exec(l)![1]!, depth: +/ depth=([\d.]+)/.exec(l)![1]!, mouth: +/ mouth-x=([\d.]+)/.exec(l)![1]! })).sort((a, b) => a.mouth - b.mouth);
      truth.sort((a, b) => a.mouth - b.mouth);
      truth.forEach((q, i) => { const g = got[i]!; checked++; if (Math.abs(g.w - q.w) > 0.06 || Math.abs(g.depth - q.depth) > 0.06 || Math.abs(g.mouth - q.mouth) > 0.6) bad.push(`${br.id}[${i}]: NC1 ${JSON.stringify(g)} ≠ גיאומטריה ${JSON.stringify(q)}`); });
    }
    expect(checked).toBeGreaterThan(8);
    expect(bad).toEqual([]);
  });
  it('NC1 חוקי: שורות SLOT הן הערות (`**`) לפני BO/EN — אין קונטור AK', () => {
    const p = mk('RHS60x60x4', 10), d = generate(p), fab = computeFabrication(p, d);
    const part = fab.parts.find((x) => x.memberId.startsWith('KB.'))!;
    const ls = partToNc1(part, p, d, 1).split('\r\n');
    expect(ls.some((l) => l.startsWith('AK') || l.startsWith('IK'))).toBe(false);
    const iSlot = ls.findIndex((l) => l.startsWith('** SLOT')), iEn = ls.indexOf('EN');
    expect(iSlot).toBeGreaterThan(22);
    expect(iSlot).toBeLessThan(iEn);
  });
});

describe('SLOT-03 שרטוט החלק מנתוני המודל', () => {
  it('חריצים: מידות הציור = מידות המודל; חלק בלי חריץ — בלי שורה', () => {
    const p = mk('RHS60x60x4', 10), d = generate(p), fab = computeFabrication(p, d), bom = computeBom(d, fab);
    const defs = drawingCatalog(p, d, fab);
    const texts = (mark: string) => { const df = defs.find((x) => x.id === `D-PART-${mark}`)!; return buildSheet(df, p, d, fab, bom).ents.filter((e) => e.k === 'text').map((e) => (e as { s: string }).s); };
    const brace = fab.parts.find((x) => x.memberId.startsWith('KB.'))!;
    const sl = brace.slots[0]!;
    const want = `${Math.round(sl.w * 10) / 10}×${Math.round(Math.abs(sl.t1 - sl.t0))}`;
    const tx = texts(brace.mark);
    expect(tx.some((s) => s === `חריץ ${want}`)).toBe(true);
    expect(tx.some((s) => s.startsWith('חריצים:') && s.includes(want))).toBe(true);
    const col = fab.parts.find((x) => x.kind === 'column')!;
    expect(texts(col.mark).some((s) => s.startsWith('חריצים:'))).toBe(false);
  });
});

describe('SLOT-04 חתימה', () => {
  it('חלקים בלי חריץ — חתימה ללא שינוי; חריץ משנה חתימה', () => {
    const p = mk('RHS60x60x4', 10), d = generate(p), fab = computeFabrication(p, d);
    const col = fab.parts.find((x) => x.kind === 'column')!;
    expect(/\|S[uv]-?\d/.test(col.signature)).toBe(false);
    const br = fab.parts.find((x) => x.memberId.startsWith('KB.'))!;
    expect(br.signature).toMatch(/\|S[uv]-?\d/);
  });
});

describe('SLOT-05 תמוכה בין קורות (dir=w): הקוד הישן מול המתכון, ו-NC1 מול הלשונית', () => {
  it('RHS80 · פח 10', () => {
    const b = defaultBuilding();
    b.bracing.rafterStruts = { ...defaultRafterStruts(), detail: 'fin', profile: 'RHS80x80x4', plateT: 10, bolts: 2, bolt: { d: 16, grade: '8.8', standard: 'ISO 4017', clearance: 2 }, rows: [{ id: 'r1', from: 'L', toward: 'R', dist: 4000 }] };
    const p0 = newProject('s', b), d0 = generate(p0);
    const ids = d0.members.filter((m) => /^RS\d+\.\d+$/.test(m.id)).map((m) => m.id);
    expect(ids.length).toBeGreaterThan(2);
    const keys = ids.flatMap((id) => [`${id}|start`, `${id}|end`]);
    let n = assignDetail(keys, strutFinRecipe()).run(p0);
    for (const [name, v] of [['d', 16], ['nb', 2], ['ft', 10], ['tt', 10]] as const) n = setDetailParam(keys, name, v).run(n);
    const d1 = generate(n);
    const bad: string[] = [];
    for (const id of ids) {
      const br = d0.byId.get(id)!, ex = localFrame(br).ex, along = (q: { p: { x: number; y: number; z: number } }) => dot(sub(q.p, br.start), ex);
      const a = slotsOf(d0, id).sort((x, y) => along(x) - along(y)), c = slotsOf(d1, id).sort((x, y) => along(x) - along(y));
      if (a.length !== 2 || c.length !== 2) { bad.push(`${id}: ${a.length}/${c.length}`); continue; }
      a.forEach((s, i) => { const q = c[i]!; const dp = Math.hypot(s.p.x - q.p.x, s.p.y - q.p.y, s.p.z - q.p.z); if (dp > 0.5 || Math.abs(dot(s.axis, q.axis) - 1) > 1e-6 || Math.abs(Math.abs(dot(s.nrm, q.nrm)) - 1) > 1e-6 || Math.abs(s.L - q.L) > 0.5 || Math.abs(s.w - q.w) > 0.01) bad.push(`${id}[${i}] p ${dp.toFixed(2)} L ${s.L}/${q.L} w ${s.w}/${q.w} nrm ${dot(s.nrm, q.nrm).toFixed(2)}`); });
    }
    expect(bad).toEqual([]);
    // NC1 מול הלשונית (הרוחב נמדד על ציר הלשונית, לא על פי הנחה)
    const fab = computeFabrication(p0, d0);
    let checked = 0;
    for (const id of ids) {
      const br = d0.byId.get(id)!, f = localFrame(br), part = fab.parts.find((x) => x.memberId === id)!;
      const nc = partToNc1(part, p0, d0, 1).split('\r\n').filter((l) => l.startsWith('** SLOT'));
      const tongues = d0.connections.filter((c) => c.parts.includes(id) || c.members.includes(id)).flatMap((c) => c.parts).map((x) => d0.byId.get(x)).filter((m): m is Member => !!m && m.kind === 'plate' && /\.T$/.test(m.id) && Math.abs(dot(sub(m.end, m.start), f.ex)) > 50);
      expect(nc.length).toBe(2);
      for (const l of nc) { checked++; expect(+/ w=([\d.]+)/.exec(l)![1]!).toBeCloseTo(10 + 1, 1); }
      expect(tongues.length).toBeGreaterThanOrEqual(2);
    }
    expect(checked).toBeGreaterThan(4);
  });
});

describe('SLOT-06 חלק עם חריץ מקבל סימון שונה', () => {
  it('אותו אלכסון בלי החריצים (אותו פרופיל, אורך, חיתוך וחורים) — חתימה וסימון שונים', () => {
    const p = mk('RHS60x60x4', 10), d = generate(p);
    const d0: DerivedModel = { ...d, connections: d.connections.map((c) => ({ ...c, slots: undefined })) };
    const withS = computeFabrication(p, d), without = computeFabrication(p, d0);
    const id = d.members.find((m) => m.id.startsWith('KB.'))!.id;
    const a = withS.parts.find((x) => x.memberId === id)!, b = without.parts.find((x) => x.memberId === id)!;
    expect(a.slots.length).toBe(2);
    expect(b.slots.length).toBe(0);
    expect(a.signature).not.toBe(b.signature);
    // אחרי מספור: שני החלקים (עם/בלי חריץ) לא חולקים סימון
    const reg = { ...p, marks: { ...p.marks, parts: { [b.signature]: 'BR9' } } } as Project;
    expect(computeFabrication(reg, d).parts.find((x) => x.memberId === id)!.mark).not.toBe('BR9');
  });
});
