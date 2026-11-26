/**
 * BSPLICE-01/02: G9 (אתר אמצע על קורה/עמוד) — חיבורי המשך של קורות ועמודים: פלטות קצה מוברגות (I), פלנץ (RHS/SHS), מרותך (I ו-RHS).
 * הקוד הישן (`autoSplice.ts`) מול המתכונים (`settings.spliceEngine`). פלטות חיזוק משולשות — תמיד הקוד הישן (נבדק שלא הוסב).
 */
import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { computeFabrication } from '../src/fab/marks';
import { partToNc1 } from '../src/fab/dstv';
import { computeBom } from '../src/fab/bom';
import { buildSheet, drawingCatalog } from '../src/drawing/views';
import type { BoltInfo, DerivedModel, Member, Project, WeldInfo } from '../src/model/types';

const TOL = 0.5;
type V = { x: number; y: number; z: number };
const dist = (a: V, b: V) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const dot = (a: V, b: V) => a.x * b.x + a.y * b.y + a.z * b.z;

interface Cfg { name: string; mod: (p: Project) => void; legacyOnly?: boolean }
const spl = (p: Project) => { p.settings.autoSplice = false; p.splices['F1.RAF.L'] = [3500, 6500]; p.splices['F2.RAF.R'] = [5000]; p.splices['F1.COL.L'] = [2500]; p.splices['F3.COL.R'] = [3000]; };
const CFGS: Cfg[] = [
  { name: 'I מוברג · ברירת מחדל', mod: (p) => spl(p) },
  { name: 'I מוברג · IPE400 / HEA300', mod: (p) => { spl(p); p.building.rafterProfile = 'IPE400'; p.building.columnProfile = 'HEA300'; } },
  { name: 'I מוברג · אוטומטי (חומר גלם קצר)', mod: (p) => { p.settings.stockLength = 6000; } },
  { name: 'I מרותך', mod: (p) => { spl(p); p.settings.spliceJoint = { beams: 'welded', columns: 'welded' }; } },
  { name: 'RHS פלנץ', mod: (p) => { spl(p); p.building.rafterProfile = 'RHS300x200x10'; p.building.columnProfile = 'SHS200x200x8'; } },
  { name: 'RHS מרותך', mod: (p) => { spl(p); p.building.rafterProfile = 'RHS300x200x10'; p.building.columnProfile = 'SHS200x200x8'; p.settings.spliceJoint = { beams: 'welded', columns: 'welded' }; } },
  { name: 'קורה נושאת (flush — פלטה סמויה מלמעלה)', mod: (p) => { const f = p.building.frames; p.building.transfers = [{ id: 'T1', lineId: 'L', from: f[0]!.id, to: f[3]!.id, removed: [f[1]!.id, f[2]!.id], profile: 'IPE600', support: 'A1', seat: 'B1' }]; p.settings.stockLength = 6000; } },
  { name: 'פלטות חיזוק — נשאר הקוד הישן', legacyOnly: true, mod: (p) => { spl(p); p.settings.spliceStiffeners = true; p.splices['F1.COL.L'] = []; p.splices['F3.COL.R'] = []; } },
];
const proj = (c: Cfg, recipe: boolean) => { const p = newProject('c', defaultBuilding()); c.mod(p); if (recipe) p.settings.spliceEngine = 'recipe'; return p; };
const oldC = (d: DerivedModel) => d.connections.filter((c) => c.type === 'beam-splice');
const newC = (d: DerivedModel) => d.connections.filter((c) => c.custom && c.custom.site.includes('|s:') && c.id.startsWith('C.') && /^C\.(RS|WS)\./.test(c.id));
const plates = (d: DerivedModel, ids: string[]) => ids.map((i) => d.byId.get(i)).filter((m): m is Member => !!m && m.kind === 'plate');

describe('BSPLICE-01 חיבור המשך קורה/עמוד: הקוד הישן מול המתכון', () => {
  for (const cfg of CFGS) it(cfg.name, () => {
    const p0 = proj(cfg, false), d0 = generate(p0), p1 = proj(cfg, true), d1 = generate(p1);
    const oc = oldC(d0), nc = newC(d1);
    expect(oc.length).toBeGreaterThan(0);
    if (cfg.legacyOnly) { expect(nc.length).toBe(0); expect(oldC(d1).length).toBe(oc.length); return; }
    expect(oldC(d1).length + nc.length).toBe(oc.length);
    expect(nc.length).toBe(oc.length);
    const bad: string[] = [];
    if (oc.map((c) => c.id).sort().join() !== nc.map((c) => c.id).sort().join()) bad.push('מזהי חיבורים שונים');
    const op = oc.flatMap((c) => plates(d0, c.parts)), np = nc.flatMap((c) => plates(d1, c.parts));
    if (op.length !== np.length) bad.push(`פלטות ${op.length}→${np.length}`);
    const left = [...np];
    for (const o of op) {
      const i = left.findIndex((x) => x.profile === o.profile && dist(x.start, o.start) <= TOL && dist(x.end, o.end) <= TOL && Math.abs(dot(x.refUp, o.refUp)) > 0.999);
      if (i < 0) bad.push(`פלטה ${o.profile} ב-(${o.start.x.toFixed(0)},${o.start.y.toFixed(0)},${o.start.z.toFixed(0)}) לא נמצאה`); else left.splice(i, 1);
    }
    const ob: BoltInfo[] = oc.flatMap((c) => c.bolts), nb: BoltInfo[] = nc.flatMap((c) => c.bolts);
    if (ob.length !== nb.length) bad.push(`ברגים ${ob.length}→${nb.length}`);
    const lb = [...nb];
    for (const o of ob) {
      const i = lb.findIndex((x) => dist(x.p, o.p) <= TOL && x.d === o.d && dot(x.axis, o.axis) > 0.999 && Math.abs(x.length - o.length) <= TOL && Math.abs(x.grip - o.grip) <= 0.01 && x.location === o.location && [...x.holesIn].sort().join() === [...o.holesIn].sort().join());
      if (i < 0) bad.push(`בורג M${o.d} ב-(${o.p.x.toFixed(1)},${o.p.y.toFixed(1)},${o.p.z.toFixed(1)}) לא נמצא`); else lb.splice(i, 1);
    }
    const wk = (w: WeldInfo) => `${w.location}|${w.a}|${w.length}|${[...w.between].sort().join('~')}`;
    const ow = oc.flatMap((c) => c.welds).map(wk).sort().join(), nw = nc.flatMap((c) => c.welds).map(wk).sort().join();
    if (ow !== nw) bad.push('ריתוכים שונים');
    const wpos = (cs: typeof oc) => cs.flatMap((c) => c.welds).map((w) => `${w.id.split('.').slice(0, -1).join('.')}:${w.from.x.toFixed(1)},${w.from.y.toFixed(1)},${w.from.z.toFixed(1)}`).sort();
    void wpos;
    expect(bad.slice(0, 8)).toEqual([]);
    const errs = (d: DerivedModel) => d.issues.filter((i) => i.severity === 'error').map((i) => `${i.code} ${i.message}`);
    expect(errs(d1)).toEqual(errs(d0));
    const sp = (d: DerivedModel) => d.splices.map((s) => `${s.id}:${s.status}`).sort();
    expect(sp(d1)).toEqual(sp(d0));
    const pl = (d: DerivedModel) => d.parts.map((x) => `${x.id}:${x.t0.toFixed(2)}:${x.t1.toFixed(2)}`).sort();
    expect(pl(d1)).toEqual(pl(d0));
    const f0 = computeFabrication(p0, d0), f1 = computeFabrication(p1, d1);
    const ids0 = new Set(oc.flatMap((c) => c.parts)), ids1 = new Set(nc.flatMap((c) => c.parts));
    const rel = (f: typeof f0) => f.parts.filter((x) => (f === f0 ? ids0 : ids1).has(x.memberId) && x.kind === 'plate');
    const mw = (ps: ReturnType<typeof rel>) => ps.map((x) => `${x.mark}:${x.weight.toFixed(2)}:${x.length.toFixed(1)}:${x.holes.length}`).sort();
    expect(mw(rel(f1))).toEqual(mw(rel(f0)));
    const nc1 = (d: DerivedModel, p: Project, ps: ReturnType<typeof rel>) => ps.map((x) => { const ls = partToNc1(x, p, d, 1).split('\r\n'); const bo = ls.indexOf('BO'); return [ls.slice(8, 23).join('|'), ...(bo >= 0 ? ls.slice(bo + 1).filter((l) => /^\s*[vuoh]/.test(l)).sort() : [])].join('~'); }).sort();
    expect(nc1(d1, p1, rel(f1))).toEqual(nc1(d0, p0, rel(f0)));
    expect(f1.assemblies.length).toBe(f0.assemblies.length);
    const asm = (f: typeof f0) => f.assemblies.map((a) => `${a.mark}:${a.weight.toFixed(1)}`).sort();
    expect(asm(f1)).toEqual(asm(f0));
    const mem = (f: typeof f0) => f.parts.filter((x) => x.kind !== 'plate' && x.kind !== 'bolt').map((x) => `${x.mark}:${x.holes.length}:${x.weight.toFixed(2)}`).sort();
    expect(mem(f1)).toEqual(mem(f0));
  });
});

describe('BSPLICE-02 גיליונות השרטוט', () => {
  for (const cfg of CFGS.filter((c) => !c.legacyOnly).slice(0, 4)) it(`אותם גיליונות · ${cfg.name}`, () => {
    const p0 = proj(cfg, false), d0 = generate(p0), p1 = proj(cfg, true), d1 = generate(p1);
    const run = (p: Project, d: DerivedModel) => { const f = computeFabrication(p, d), bom = computeBom(d, f); return new Map(drawingCatalog(p, d, f).map((df) => [df.id, buildSheet(df, p, d, f, bom)])); };
    const a = run(p0, d0), b = run(p1, d1);
    const SOFT = new Set(['OUTLINE', 'THIN', 'MARK']);
    const bad: string[] = [];
    for (const k of a.keys()) if (!b.has(k) && k !== 'D-CONN-beam-splice') bad.push(`גיליון נעלם: ${k}`);
    for (const k of b.keys()) if (!a.has(k) && !k.startsWith('D-CONN-cd-conv-beam-splice')) bad.push(`גיליון חדש: ${k}`);
    for (const [id, sa] of a) {
      const sb = b.get(id); if (!sb || id === 'D-COVER' || id === 'D-CONN-beam-splice') continue;
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
