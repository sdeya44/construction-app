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
  for (const detail of ['endplate', 'weld'] as const) it(detail, async () => {
    const { defaultRafterStruts } = await import('../src/geometry/rafterStruts');
    const b = defaultBuilding();
    b.bracing.rafterStruts = { ...defaultRafterStruts(), detail, profile: 'RHS80x80x4', bolts: 4, rows: [{ id: 'r1', from: 'L', toward: 'R', dist: 4000, bays: [0, 1, 2] }] };
    const p0 = newProject('conv', b), d0 = generate(p0);
    const p1 = structuredClone(p0); p1.building.bracing.rafterStruts!.engine = 'recipe';
    const d1 = generate(p1);
    const old = d0.connections.filter((c) => /^C\.RS1\./.test(c.id));
    const neu = d1.connections.filter((c) => c.custom && /^RS1\./.test(c.custom.site));
    expect(neu.length).toBeGreaterThan(4);
    expect(cadFindings(cadAudit(K, d0, old))).toEqual([]);
    expect(cadFindings(cadAudit(K, d1, neu))).toEqual([]);
  }, 300000);
});

describe('CAD-07 הסבה (שלב D): תושבת פטה (זוויתן / פלטה + משולש) כמתכון', () => {
  for (const style of ['run', 'plate', 'stand'] as const) it(`${style}: גופים תקינים, חורים חותכים, ריתוכים במגע, בלי חדירות — ובדיוק כמו הפרט הישן`, async () => {
    const b = defaultBuilding();
    for (const k of ['left', 'right'] as const) b.purlins[k] = { ...b.purlins[k], cleat: { ...b.purlins[k].cleat, style } };
    const p0 = newProject('conv', b), d0 = generate(p0);
    const p1 = structuredClone(p0); p1.building.purlins.engine = 'recipe';
    const d1 = generate(p1);
    const neu = d1.connections.filter((c) => c.custom && c.custom.site.includes('|x:F2')).slice(0, 6);
    const old = d0.connections.filter((c) => c.type === 'purlin-cleat' && neu.some((n) => n.custom!.site.replace('|x:', '.') === c.id.replace('C.PC.', '')));
    expect(neu.length).toBeGreaterThan(2);
    expect(old.length).toBe(neu.length);
    expect(cadFindings(cadAudit(K, d0, old))).toEqual([]);
    expect(cadFindings(cadAudit(K, d1, neu))).toEqual([]);
  }, 300000);
  it('תפר פטה מעל תומך (פלטה + משולש, 4 חורים): כמו הפרט הישן', async () => {
    const b = defaultBuilding();
    for (const k of ['left', 'right'] as const) b.purlins[k] = { ...b.purlins[k], cleat: { ...b.purlins[k].cleat, spliceCleat: true } };
    const p0 = newProject('conv', b); p0.settings.autoSplice = false; p0.splices['PL.L.03'] = [12000, 24000]; p0.splices['PL.R.03'] = [12000];
    const d0 = generate(p0);
    const p1 = structuredClone(p0); p1.building.purlins.engine = 'recipe';
    const d1 = generate(p1);
    const seam = new Set(d0.issues.filter((i) => i.code === 'SPLICE_CLEAT').map((i) => i.elementId!.replace('C.PC.', '')));
    const neu = d1.connections.filter((c) => c.custom && seam.has(c.custom.site.replace('|x:', '.')));
    const old = d0.connections.filter((c) => seam.has(c.id.replace('C.PC.', '')));
    expect(neu.length).toBe(3);
    expect(old.length).toBe(3);
    expect(cadFindings(cadAudit(K, d0, old))).toEqual([]);
    expect(cadFindings(cadAudit(K, d1, neu))).toEqual([]);
  }, 300000);
});

describe('CAD-08 הסבה (שלב D): פלטת בסיס (מבוטנת / ברגי עוגן) כמתכון', () => {
  for (const mode of ['embedded', 'bolted'] as const) it(`${mode}: גופים תקינים, חורים חותכים, ריתוכים במגע, בלי חדירות — ובדיוק כמו הפרט הישן`, async () => {
    const p0 = newProject('conv', defaultBuilding());
    p0.connectionDefaults.base = { ...p0.connectionDefaults.base, mode };
    const d0 = generate(p0);
    const p1 = structuredClone(p0); p1.building.baseEngine = 'recipe';
    const d1 = generate(p1);
    const neu = d1.connections.filter((c) => c.custom && /^conv-base/.test(c.custom.detailId) && /^F[12]\./.test(c.custom.site));
    const old = d0.connections.filter((c) => c.type === 'base' && neu.some((n) => `C.BASE.${n.custom!.site.split('|')[0]!.replace('.COL.', '.')}` === c.id));
    expect(neu.length).toBe(4);
    expect(old.length).toBe(4);
    expect(cadFindings(cadAudit(K, d0, old))).toEqual([]);
    expect(cadFindings(cadAudit(K, d1, neu))).toEqual([]);
  }, 300000);
});

describe('CAD-09 הסבה (שלב D): חיבור צד (קורה לצד עמוד) כמתכון', () => {
  for (const tpl of ['stepped', 'gable-center'] as const) it(`${tpl}: גופים תקינים, חורים חותכים, ריתוכים במגע, בלי חדירות — ובדיוק כמו הפרט הישן`, async () => {
    const { SECTION_TEMPLATES } = await import('../src/model/section');
    const p0 = newProject('conv', defaultBuilding());
    p0.building.section = SECTION_TEMPLATES.find((t) => t.id === tpl)!.make();
    const d0 = generate(p0);
    const p1 = structuredClone(p0); p1.building.sideEngine = 'recipe';
    const d1 = generate(p1);
    const neu = d1.connections.filter((c) => c.custom && c.custom.detailId === 'conv-side' && /^F[12]\./.test(c.custom.site));
    const old = d0.connections.filter((c) => /^C\.SIDE\.F[12]\./.test(c.id));
    expect(neu.length).toBeGreaterThan(1);
    expect(old.length).toBe(neu.length);
    expect(cadFindings(cadAudit(K, d0, old))).toEqual([]);
    expect(cadFindings(cadAudit(K, d1, neu))).toEqual([]);
  }, 300000);
});

describe('CAD-10 הסבה (שלב D): אגד B (קורה + אלכסונים; פח + לשונית) כמתכון', () => {
  it('גופים תקינים, חורים חותכים, ריתוכים במגע, בלי חדירות — ובדיוק כמו הפרט הישן', async () => {
    const { defaultPortal } = await import('../src/geometry/portal');
    const b = defaultBuilding(); b.columnProfile = 'RHS200x200x8';
    b.bracing.walls = { ...b.bracing.walls, enabled: true, type: 'portal', portal: defaultPortal() };
    const p0 = newProject('conv', b), d0 = generate(p0);
    const p1 = structuredClone(p0); p1.building.bracing.walls.portal = { ...defaultPortal(), engine: 'recipe' };
    const d1 = generate(p1);
    const neu = d1.connections.filter((c) => c.custom && /^BB\.[12]\.L\b/.test(c.custom.site));
    const old = d0.connections.filter((c) => /^C\.BB\.[12]\.L\./.test(c.id));
    expect(neu.length).toBeGreaterThan(5);
    expect(old.length).toBe(neu.length);
    expect(cadFindings(cadAudit(K, d0, old))).toEqual([]);
    expect(cadFindings(cadAudit(K, d1, neu))).toEqual([]);
  }, 300000);
});

describe('CAD-11 הסבה (שלב D): מסבך נעילה (סגנון לשונית) כמתכון', () => {
  it('גופים תקינים, חורים חותכים, ריתוכים במגע, בלי חדירות — ובדיוק כמו הפרט הישן', async () => {
    const { defaultLockTruss } = await import('../src/geometry/lockTruss');
    const b = defaultBuilding(); b.columnProfile = 'RHS200x200x8';
    b.bracing.walls = { ...b.bracing.walls, enabled: true, type: 'truss', truss: { ...defaultLockTruss(), conn: 'tongue' } };
    const p0 = newProject('conv', b), d0 = generate(p0);
    const p1 = structuredClone(p0); p1.building.bracing.walls.truss = { ...defaultLockTruss(), conn: 'tongue', engine: 'recipe' };
    const d1 = generate(p1);
    const neu = d1.connections.filter((c) => c.custom && /^LT\.[12]\.L\b/.test(c.custom.site));
    const old = d0.connections.filter((c) => /^C\.LT\.[12]\.L\.[CS][AB]$/.test(c.id));
    expect(neu.length).toBeGreaterThan(3);
    expect(old.length).toBe(neu.length);
    expect(cadFindings(cadAudit(K, d0, old))).toEqual([]);
    expect(cadFindings(cadAudit(K, d1, neu))).toEqual([]);
  }, 300000);
});

describe('CAD-12 הסבה (שלב D, G4): מסבך נעילה — פלטת קצה לעמוד (אתר של שלושה אלמנטים) כמתכון', () => {
  it('גופים תקינים, חורים חותכים, ריתוכים במגע, בלי חדירות — ובדיוק כמו הפרט הישן', async () => {
    const { defaultLockTruss } = await import('../src/geometry/lockTruss');
    const b = defaultBuilding(); b.columnProfile = 'RHS200x200x8';
    b.bracing.walls = { ...b.bracing.walls, enabled: true, type: 'truss', truss: { ...defaultLockTruss(), conn: 'plate' } };
    const p0 = newProject('conv', b), d0 = generate(p0);
    const p1 = structuredClone(p0); p1.building.bracing.walls.truss = { ...defaultLockTruss(), conn: 'plate', engine: 'recipe' };
    const d1 = generate(p1);
    const neu = d1.connections.filter((c) => c.custom && c.custom.detailId === 'conv-lock-plate' && /^LT\.[12]\.L\.C\b/.test(c.custom.site));
    const old = d0.connections.filter((c) => /^C\.LT\.L\.F[123]\.COL\.L\.\d+$/.test(c.id) && c.members.some((m) => /^LT\.[12]\.L\.C$/.test(m)));
    expect(neu.length).toBeGreaterThan(2);
    expect(old.length).toBeGreaterThan(1);
    expect(cadFindings(cadAudit(K, d0, old))).toEqual([]);
    expect(cadFindings(cadAudit(K, d1, neu))).toEqual([]);
  }, 300000);
});

describe('CAD-13 הסבה (שלב D): אגד B ומסבך נעילה על עמוד I — פני הווב האמיתיים (`th`)', () => {
  it('אגד B על HEA200: גופים תקינים, בלי חדירות — ובדיוק כמו הפרט הישן', async () => {
    const { defaultPortal } = await import('../src/geometry/portal');
    const b = defaultBuilding(); b.columnProfile = 'HEA200';
    b.bracing.walls = { ...b.bracing.walls, enabled: true, type: 'portal', portal: defaultPortal() };
    const p0 = newProject('conv', b), d0 = generate(p0);
    const p1 = structuredClone(p0); p1.building.bracing.walls.portal = { ...defaultPortal(), engine: 'recipe' };
    const d1 = generate(p1);
    const neu = d1.connections.filter((c) => c.custom && /^BB\.[12]\.L\b/.test(c.custom.site));
    const old = d0.connections.filter((c) => /^C\.BB\.[12]\.L\./.test(c.id));
    expect(neu.length).toBeGreaterThan(5);
    expect(old.length).toBe(neu.length);
    expect(cadFindings(cadAudit(K, d0, old))).toEqual([]);
    expect(cadFindings(cadAudit(K, d1, neu))).toEqual([]);
  }, 300000);
  it('מסבך נעילה (פלטת קצה דרך הווב) על HEA200: כמו הפרט הישן', async () => {
    const { defaultLockTruss } = await import('../src/geometry/lockTruss');
    const b = defaultBuilding(); b.columnProfile = 'HEA200';
    b.bracing.walls = { ...b.bracing.walls, enabled: true, type: 'truss', truss: { ...defaultLockTruss(), conn: 'plate' } };
    const p0 = newProject('conv', b), d0 = generate(p0);
    const p1 = structuredClone(p0); p1.building.bracing.walls.truss = { ...defaultLockTruss(), conn: 'plate', engine: 'recipe' };
    const d1 = generate(p1);
    const neu = d1.connections.filter((c) => c.custom && c.custom.detailId === 'conv-lock-plate' && /^LT\.[12]\.L\.C\b/.test(c.custom.site));
    const old = d0.connections.filter((c) => /^C\.LT\.L\.F[123]\.COL\.L\.\d+$/.test(c.id) && c.members.some((m) => /^LT\.[12]\.L\.C$/.test(m)));
    expect(neu.length).toBeGreaterThan(2);
    expect(cadFindings(cadAudit(K, d0, old))).toEqual([]);
    expect(cadFindings(cadAudit(K, d1, neu))).toEqual([]);
  }, 300000);
});

describe('CAD-14 הסבה (שלב D, G9): אתר אמצע / עוגן — חיבורי המשך והצטלבות קושרות כמתכון', () => {
  const same = (d0: ReturnType<typeof generate>, old: ReturnType<typeof generate>['connections'], d1: ReturnType<typeof generate>, neu: ReturnType<typeof generate>['connections']) => {
    expect(neu.length).toBeGreaterThan(0);
    expect(neu.length).toBe(old.length);
    // הפרט החדש מקבל בדיוק את אותם ממצאי CAD כמו הישן (הקורה רציפה במודל — חפיפת פלטות המשך בתוכה אינה חדשה)
    expect(cadFindings(cadAudit(K, d1, neu))).toEqual(cadFindings(cadAudit(K, d0, old)));
  };
  it('חיבור המשך פטה', () => {
    const mk = (r: boolean) => { const p = newProject('conv', defaultBuilding()); p.settings.autoSplice = false; p.splices['PL.L.03'] = [7000, 15000]; p.splices['PL.R.03'] = [9000]; if (r) p.building.purlins.splice = { ...p.building.purlins.splice, engine: 'recipe' }; return p; };
    const d0 = generate(mk(false)), d1 = generate(mk(true));
    same(d0, d0.connections.filter((c) => c.type === 'purlin-splice'), d1, d1.connections.filter((c) => c.custom?.site.includes('|s:')));
  }, 300000);
  it('הצטלבות קושרות X (פח מילוי ומוט הברגה)', async () => {
    const { defaultRodEnd } = await import('../src/geometry/bracing');
    for (const rod of [false, true]) {
      const mk = (r: boolean) => { const p = newProject('conv', defaultBuilding()); if (rod) { p.building.bracing.roof.endDetail = 'rod'; p.building.bracing.roof.rod = defaultRodEnd(); } if (r) { p.building.bracing.conn = { ...p.building.bracing.conn, engine: 'recipe' }; if (p.building.bracing.roof.rod) p.building.bracing.roof.rod = { ...p.building.bracing.roof.rod, engine: 'recipe' }; } return p; };
      const d0 = generate(mk(false)), d1 = generate(mk(true));
      same(d0, d0.connections.filter((c) => c.type === 'brace-cross'), d1, d1.connections.filter((c) => c.custom?.site.includes('|p:')));
    }
  }, 300000);
  it('חיבור המשך קורה/עמוד: פלטות קצה מוברגות, מרותך, פלנץ', () => {
    for (const [prof, joint] of [['IPE300', undefined], ['IPE300', 'welded'], ['RHS300x200x10', undefined]] as const) {
      const mk = (r: boolean) => { const p = newProject('conv', defaultBuilding()); p.settings.autoSplice = false; p.splices['F1.RAF.L'] = [3500, 6500]; p.splices['F2.RAF.R'] = [5000]; p.building.rafterProfile = prof; if (joint) p.settings.spliceJoint = { beams: joint, columns: joint }; if (r) p.settings.spliceEngine = 'recipe'; return p; };
      const d0 = generate(mk(false)), d1 = generate(mk(true));
      same(d0, d0.connections.filter((c) => c.type === 'beam-splice'), d1, d1.connections.filter((c) => c.custom?.site.includes('|s:') && /^C\.(RS|WS)\./.test(c.id)));
    }
  }, 300000);
});
