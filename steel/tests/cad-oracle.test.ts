/**
 * CAD-01: ביקורת גיאומטריה במנוע CAD מלא (OpenCascade) — בדיקות פיתוח בלבד, המנוע לא נכנס לתוכנה.
 * לכל צורת מבנה: שני חיבורים מייצגים מכל סוג → גופים תקינים, נפח תואם, חורים חותכים, ריתוכים במגע, אין חדירות.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { SECTION_TEMPLATES } from '../src/model/section';
import { defaultKneeBraces } from '../src/geometry/knee';
import { defaultWing } from '../src/geometry/wing';
import { cadAudit, cadFindings, type CadKernel } from '../src/cad/occAudit';
import type { BuildingParams, Connection, DerivedModel } from '../src/model/types';

let K: CadKernel;
beforeAll(async () => {
  const req = createRequire(import.meta.url);
  const R = await import('replicad');
  const init = (await import('replicad-opencascadejs')).default as (o: object) => Promise<unknown>;
  const oc = await init({ wasmBinary: readFileSync(req.resolve('replicad-opencascadejs/wasm')) });
  R.setOC(oc as never);
  K = { R, oc };
}, 60000);

/** שני חיבורים מכל סוג (הראשון והאחרון — קצה ואמצע) */
function sample(d: DerivedModel): Connection[] {
  const by = new Map<string, Connection[]>();
  for (const c of d.connections) { const a = by.get(c.type) ?? []; a.push(c); by.set(c.type, a); }
  return [...by.values()].flatMap((a) => (a.length > 1 ? [a[0]!, a[a.length - 1]!] : a));
}

const full = (b: BuildingParams) => { b.kneeBraces = { ...defaultKneeBraces(), enabled: true }; b.bracing.walls.enabled = true; return b; };
const SHAPES: { id: string; make: () => BuildingParams }[] = [
  { id: 'דו-שיפועי', make: () => full(defaultBuilding()) },
  { id: 'חד-שיפועי', make: () => full({ ...defaultBuilding(), roofType: 'mono', eaveRight: 7500, purlins: { ...defaultBuilding().purlins, left: { ...defaultBuilding().purlins.left, first: 0 } } }) },
  { id: 'רב-מפתחי', make: () => full({ ...defaultBuilding(), section: SECTION_TEMPLATES.find((t) => t.id === 'mono-multi')!.make() }) },
  { id: 'דו-שיפועי כפול', make: () => full({ ...defaultBuilding(), section: SECTION_TEMPLATES.find((t) => t.id === 'twin-gable')!.make() }) },
  { id: 'L', make: () => { const b = full(defaultBuilding()); b.wing = defaultWing(b, 'gable'); return b; } },
  { id: 'L חד-שיפועי', make: () => { const b = full({ ...defaultBuilding(), roofType: 'mono', eaveRight: 7000 }); b.purlins = { ...b.purlins, left: { ...b.purlins.left, first: 0 } }; b.wing = defaultWing(b, 'mono'); return b; } },
];

// בדיקה נפרדת לכל צורה × סוג חיבור — כך אפשר להריץ רק סוג אחד: -t "· rafter-side"
for (const s of SHAPES) {
  const d = generate(newProject(s.id, s.make()));
  const byType = new Map<string, Connection[]>();
  for (const c of sample(d)) { const a = byType.get(c.type) ?? []; a.push(c); byType.set(c.type, a); }
  describe(`CAD-01 ${s.id}`, () => {
    it('מבנה תקין עם חיבורים', () => { expect(byType.size).toBeGreaterThan(3); });
    for (const [type, conns] of byType) {
      it(`· ${type}`, () => {
        const r = cadAudit(K, d, conns);
        const f = cadFindings(r);
        if (f.length) console.log(`${s.id} · ${type}:\n` + f.slice(0, 40).join('\n'));
        expect(r.parts.length).toBeGreaterThan(0);
        expect(f).toEqual([]);
      }, 300000);
    }
  });
}

describe('CAD-02 תיקוני גיאומטריה שנמצאו בביקורת', () => {
  it('מוט עיגון בפלטה מבוטנת צמוד לפני הפלטה — לא בולט מתחת לעמוד', () => {
    const d = generate(newProject('a', defaultBuilding()));
    const c = d.connections.find((x) => x.type === 'base')!;
    const pl = d.byId.get(c.parts[0]!)!;
    const rods = d.members.filter((m) => m.kind === 'anchor' && m.connId === c.id);
    expect(rods.length).toBeGreaterThan(0);
    for (const r of rods) expect(Math.max(r.start.z, r.end.z)).toBeCloseTo(pl.start.z, 6);
    const r = cadAudit(K, d, [c]);
    expect(r.clashes).toEqual([]);
    for (const w of r.welds) expect(w.dist).toBeLessThanOrEqual(2);
  }, 120000);
  it('כיסא כנף: פלטה בשיפוע הקורה, וברכס ברגים בתוך כל קורה (לא בתפר)', () => {
    const b = defaultBuilding(); b.wing = defaultWing(b, 'gable');
    const d = generate(newProject('L', b));
    const seats = d.connections.filter((c) => c.id.startsWith('C.WS.'));
    expect(seats.length).toBe(3);
    const ridge = seats.find((c) => c.bolts.length === 4)!;
    expect(ridge).toBeTruthy();
    expect(new Set(ridge.bolts.map((x) => x.holesIn[1])).size).toBe(2);
    expect(d.issues.some((i) => i.code === 'WING_RIDGE_SEAT')).toBe(true);
    const tilted = seats.filter((c) => c !== ridge).map((c) => d.byId.get(`${c.id}.PL`)!);
    for (const p of tilted) expect(Math.abs(p.refUp.y)).toBeGreaterThan(0.05);
    expect(cadFindings(cadAudit(K, d, seats))).toEqual([]);
  }, 120000);
  it('מסבך גג רב-מפתחי (1.66) ואלכסוני הרכס: ריתוכים במגע, אין חדירות', async () => {
    const { defaultTrussSpec } = await import('../src/geometry/truss');
    const g = defaultBuilding();
    g.roofTruss = { enabled: true, frames: [g.frames[0]!.id], shape: 'flat', spec: defaultTrussSpec(8, 1000, { top: g.rafterProfile }) };
    const dg = generate(newProject('g', g));
    expect(cadFindings(cadAudit(K, dg, dg.connections.filter((c) => c.type === 'truss'))), 'מפתח יחיד').toEqual([]);
    const b = { ...defaultBuilding(), section: SECTION_TEMPLATES.find((t) => t.id === 'twin-gable')!.make() };
    b.roofTruss = { enabled: true, frames: [b.frames[0]!.id], shape: 'flat', spec: defaultTrussSpec(8, 1000, { top: b.rafterProfile }) };
    const d = generate(newProject('t', b));
    const cs = d.connections.filter((c) => /^C\.TR[ES]?\./.test(c.id) && c.id.includes('.S2'));
    expect(cs.length).toBeGreaterThan(1);
    expect(cadFindings(cadAudit(K, d, cs))).toEqual([]);
  }, 300000);
});

describe('CAD-03 ספריית מחברים (1.67)', () => {
  it('כל פרט מהספרייה על אתר מתאים: גופים, חורים, ריתוכים במגע, בלי חדירות', async () => {
    const { buildDetail, detailPresets, presetFits } = await import('../src/geometry/detail');
    const { libSites } = await import('./libSites');
    const out: string[] = [];
    for (const [label, make] of libSites) {
      const { sites, d } = make();
      for (const det of detailPresets().filter((x) => x.id.startsWith('lib-'))) {
        const s = sites.find((x) => presetFits(det, x))!;
        const r = buildDetail(s, det);
        const members = [...d.members.filter((m) => m.id !== r.main.id), r.main, ...r.members];
        const dd = { ...d, members, byId: new Map(members.map((m) => [m.id, m])), connections: [...d.connections, r.conn] };
        out.push(...cadFindings(cadAudit(K, dd, [r.conn])).map((f) => `${label} ${det.id}: ${f}`));
      }
    }
    expect(out).toEqual([]);
  }, 300000);
});


describe('CAD-04 הסבה (שלב C): אלכסון עמוד-קורה פח+לשונית כמתכון', () => {
  it('כל קצוות האלכסונים: גופים תקינים, חורים חותכים, ריתוכים במגע, בלי חדירות — ובדיוק כמו הפרט הישן', async () => {
    const { kneeFinRecipe } = await import('../src/geometry/convRecipes');
    const { assignDetail } = await import('../src/commands/commands');
    const b = defaultBuilding();
    b.kneeBraces = { ...defaultKneeBraces(), enabled: true, profile: 'RHS60x60x4', detail: 'fin' } as never;
    const p0 = newProject('conv', b), d0 = generate(p0);
    const keys = d0.members.filter((m) => m.id.startsWith('KB.F1.')).flatMap((m) => [`${m.id}|start`, `${m.id}|end`]);
    const d1 = generate(assignDetail(keys, kneeFinRecipe()).run(p0));
    const old = d0.connections.filter((c) => c.id.startsWith('C.KB.F1.'));
    const neu = d1.connections.filter((c) => c.custom?.site.startsWith('KB.F1.'));
    expect(neu.length).toBe(old.length * 2);
    const fo = cadFindings(cadAudit(K, d0, old)), fn = cadFindings(cadAudit(K, d1, neu));
    expect(fo).toEqual([]);
    expect(fn).toEqual([]);
  }, 300000);
});

describe('CAD-05 הסבה (שלב D): תמוכה בין קורות פח+לשונית כמתכון', () => {
  it('כל קצוות התמוכות: גופים תקינים, חורים חותכים, ריתוכים במגע, בלי חדירות — ובדיוק כמו הפרט הישן', async () => {
    const { strutFinRecipe } = await import('../src/geometry/convRecipes');
    const { assignDetail } = await import('../src/commands/commands');
    const { defaultRafterStruts } = await import('../src/geometry/rafterStruts');
    const b = defaultBuilding();
    b.bracing.rafterStruts = { ...defaultRafterStruts(), detail: 'fin', profile: 'RHS80x80x4', rows: [{ id: 'r1', from: 'L', toward: 'R', dist: 4000, bays: [0, 1] }] };
    const p0 = newProject('conv', b), d0 = generate(p0);
    const keys = d0.members.filter((m) => /^RS1\.\d+$/.test(m.id)).flatMap((m) => [`${m.id}|start`, `${m.id}|end`]);
    const d1 = generate(assignDetail(keys, strutFinRecipe()).run(p0));
    const old = d0.connections.filter((c) => /^C\.RS1\./.test(c.id));
    const neu = d1.connections.filter((c) => c.custom && /^RS1\./.test(c.custom.site));
    expect(neu.length).toBe(keys.length);
    expect(cadFindings(cadAudit(K, d0, old))).toEqual([]);
    expect(cadFindings(cadAudit(K, d1, neu))).toEqual([]);
  }, 300000);
});

describe('CAD-06 הסבה (שלב D): תמוכה בין קורות — פלטת קצה (אתר זוגי) וריתוך ישיר', () => {
  for (const [detail, flag] of [['endplate', 'endEngine'], ['weld', 'weldEngine']] as const) it(detail, async () => {
    const { defaultRafterStruts } = await import('../src/geometry/rafterStruts');
    const b = defaultBuilding();
    b.bracing.rafterStruts = { ...defaultRafterStruts(), detail, profile: 'RHS80x80x4', bolts: 4, rows: [{ id: 'r1', from: 'L', toward: 'R', dist: 4000, bays: [0, 1, 2] }] };
    const p0 = newProject('conv', b), d0 = generate(p0);
    const p1 = structuredClone(p0); p1.building.bracing.rafterStruts![flag] = 'recipe';
    const d1 = generate(p1);
    const old = d0.connections.filter((c) => /^C\.RS1\./.test(c.id));
    const neu = d1.connections.filter((c) => c.custom && /^RS1\./.test(c.custom.site));
    expect(neu.length).toBeGreaterThan(4);
    expect(cadFindings(cadAudit(K, d0, old))).toEqual([]);
    expect(cadFindings(cadAudit(K, d1, neu))).toEqual([]);
  }, 300000);
});
