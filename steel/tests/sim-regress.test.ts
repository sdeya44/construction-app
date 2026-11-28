/**
 * SR — ממצאי סימולציית UI חיצונית (v1.114.0): מונופיץ' 6 מ' עם קונזולה 1 מ', גובה 4/5 מ', אלכסוני עמוד-קורה, אגד B,
 * עמוד ציר ב מבוטל ← מסבך נושא. גיאומטריה בלבד — לא בדיקת חוזק.
 *  SR-1 אלכסון עמוד-קורה: אנכי = אופקי = 1000 נשמר כ-mode=reach (drop/reach), בלי reach ישן; הזווית שנגזרת אינה 45° (האופקי מציר העמוד).
 *  SR-2 גובה עמוד: הגובה הוא פני עליון קורת הגג בציר העמוד; הזזת קצה המישור (קונזולה) שומרת אותו (slidePlaneEnd), ו-X בלבד מזיז את הגג.
 *  SR-3 התנגשויות: פח+לשונית בחריץ — רק בחגורות חלולות; קשיחות קיר לא נבנית במפתח הצמוד לעמוד מבוטל.
 *  SR-5 עקביות: אין התייחסות לעמוד שבוטל ב-BOM, בחלקים, בחיבורים ובשרטוטים.
 */
import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject, framesFromSpacings } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { computeFabrication } from '../src/fab/marks';
import { computeBom } from '../src/fab/bom';
import { numberParts } from '../src/commands/commands';
import { defaultKneeBraces } from '../src/geometry/knee';
import { defaultPortal } from '../src/geometry/portal';
import { defaultTrussSpec } from '../src/geometry/truss';
import { measureKnee } from '../src/geometry/kneeSolve';
import { slidePlaneEnd, toCustomSection } from '../src/model/section';
import { buildSheet, drawingCatalog } from '../src/drawing/views';
import type { BuildingParams } from '../src/model/types';

const base = (f: (b: BuildingParams) => void = () => undefined) => {
  const b = defaultBuilding();
  b.roofType = 'mono'; b.width = 6000; b.eaveLeft = 4000; b.eaveRight = 5000; b.columnProfile = 'RHS150x150x5'; b.rafterProfile = 'IPE300';
  b.frames = framesFromSpacings([5000, 5000]); b.rafterOverhangLeft = 1000;
  f(b); return b;
};
const errs = (d: ReturnType<typeof generate>) => d.issues.filter((i) => i.severity === 'error');
const withTransfer = (profile: string, conn: string, extra: (b: BuildingParams) => void = () => undefined) => base((b) => {
  const f = b.frames;
  b.transfers = [{ id: 'T1', lineId: 'R', from: f[0].id, to: f[2].id, removed: [f[1].id], profile, support: 'A2', seat: 'B1', kind: 'truss', truss: defaultTrussSpec(6, 1000, { top: profile, bottom: 'RHS100x100x5' }), trussFit: 'between', trussConn: conn } as never];
  extra(b);
});

describe('SR-1 אלכסון עמוד-קורה 1000/1000', () => {
  it('mode=reach, drop=reach=1000: האנכי והאופקי כפי שהוזנו; הזווית שנגזרת אינה 45°', () => {
    const b = base((x) => { x.kneeBraces = { ...defaultKneeBraces(), enabled: true, mode: 'reach', drop: 1000, reach: 1000 }; });
    const d = generate(newProject('sr1', b));
    const m = measureKnee(d, 'KB.F1.L.M.R')!;
    expect(m.v).toBeCloseTo(1000, 3); expect(m.h).toBeCloseTo(1000, 3);
    expect(Math.abs(m.ang - 45)).toBeGreaterThan(2);   // אופקי מציר העמוד + שיפוע הקורה ⇒ לא 45°
  });
  it('mode=angle, drop=1000, angle=45: זווית 45° מדויקת (האופקי נגזר)', () => {
    const b = base((x) => { x.kneeBraces = { ...defaultKneeBraces(), enabled: true, mode: 'angle', drop: 1000, angle: 45 }; });
    const m = measureKnee(generate(newProject('sr1b', b)), 'KB.F1.L.M.R')!;
    expect(m.v).toBeCloseTo(1000, 3); expect(m.ang).toBeCloseTo(45, 1);
  });
});

describe('SR-2 גובה עמוד — פני עליון קורת הגג בציר העמוד', () => {
  const colZ = (b: BuildingParams) => { const d = generate(newProject('sr2', b)); return ['L', 'R'].map((s) => d.byId.get(`F2.COL.${s}`)!.end.z); };
  it('קונזולה קלאסית 1 מ׳: 4000 / 5000 בצירי העמודים', () => {
    const z = colZ(base()); expect(z[0]).toBeCloseTo(4000, 1); expect(z[1]).toBeCloseTo(5000, 1);
  });
  it('מישור מותאם: הזזת X שמאל ל-1000- בלי לעדכן Z מעלה את העמוד ל-4143 (קצה המישור ≠ ציר); slidePlaneEnd שומר 4000', () => {
    const b0 = base((x) => { x.rafterOverhangLeft = 0; });
    const sec = toCustomSection(b0, generate(newProject('x', b0)).roof);
    const naive = { ...sec, planes: sec.planes.map((p, i) => (i ? p : { ...p, x0: -1000 })) };
    expect(colZ({ ...b0, section: naive })[0]).toBeCloseTo(4142.9, 0);          // ההתנהגות הישנה של השדה "קצוות המישור (X)"
    const slid = slidePlaneEnd(sec, sec.planes[0].id, 'x0', -1000);
    const z = colZ({ ...b0, section: slid }); expect(z[0]).toBeCloseTo(4000, 1); expect(z[1]).toBeCloseTo(5000, 1);
  });
  it('שרטוט המסגרת מציין את הייחוס (TOS בציר העמוד)', () => {
    const p = numberParts().run(newProject('sr2c', base())), d = generate(p), fab = computeFabrication(p, d), bom = computeBom(d, fab);
    const cat = drawingCatalog(p, d, fab).find((c) => c.type === 'frame')!;
    const txt = buildSheet(cat, p, d, fab, bom).ents.filter((e) => e.k === 'text').map((e) => (e as { s: string }).s).join(' ');
    expect(txt).toContain('TOS');
  });
});

describe('SR-3 התנגשויות מסבך נושא / אגד B', () => {
  it('חגורה עליונה I (HEA160) + auto/fin: אין פח+לשונית דרך הווב — אין שגיאות; fin מפורש ⇒ אזהרה', () => {
    for (const conn of ['auto', 'fin']) {
      const d = generate(newProject('sr3', withTransfer('HEA160', conn)));
      expect(errs(d).map((i) => i.message), conn).toEqual([]);
      if (conn === 'fin') expect(d.issues.some((i) => i.code === 'TB_FIN_CHORD')).toBe(true);
      expect(d.members.some((m) => /^C\.TBS\.T1\.F\d\.T\.T$/.test(m.id))).toBe(false);
    }
  });
  it('חגורה עליונה חלולה (RHS) — הסנפיר נשמר ונקי מהתנגשויות', () => {
    const d = generate(newProject('sr3b', withTransfer('RHS200x100x6', 'fin')));
    expect(errs(d).map((i) => i.message)).toEqual([]);
    expect(d.members.some((m) => /^C\.TBS\.T1\.F1\.T\.T$/.test(m.id))).toBe(true);
  });
  it('אגד B במפתחים הצמודים לעמוד שבוטל — מושמט (info), בלי התנגשות עם המסבך', () => {
    for (const engine of ['legacy', 'recipe']) for (const gap of [150, 1200]) {
      const b = withTransfer('RHS200x100x6', 'fin', (x) => { x.bracing.walls = { ...x.bracing.walls, enabled: true, type: 'portal', left: [0, 1], right: [0, 1], portal: { ...defaultPortal(), gap, drop: 1100, engine } } as never; });
      const d = generate(newProject('sr3c', b));
      expect(errs(d).map((i) => i.message), `${engine}/${gap}`).toEqual([]);
      expect(d.members.some((m) => /^BB\.\d+\.R/.test(m.id))).toBe(false);          // ציר ב: שני המפתחים צמודים ל-F2
      expect(d.members.some((m) => /^BB\.\d+\.L/.test(m.id))).toBe(true);           // ציר א נשאר
      expect(d.issues.some((i) => i.code === 'WALL_BRACE_TB')).toBe(true);
    }
  });
});

describe('SR-5 עקביות שרטוטים / כתב כמויות', () => {
  it('אין התייחסות לעמוד F2.COL.R שבוטל', () => {
    const b = withTransfer('RHS200x100x6', 'fin', (x) => { x.kneeBraces = { ...defaultKneeBraces(), enabled: true }; x.bracing.walls = { ...x.bracing.walls, enabled: true, type: 'portal', portal: { ...defaultPortal(), gap: 1200, drop: 1100 } }; });
    const p = numberParts().run(newProject('sr5', b)), d = generate(p), fab = computeFabrication(p, d), bom = computeBom(d, fab);
    const gone = 'F2.COL.R';
    expect(d.byId.has(gone)).toBe(false);
    expect(d.connections.filter((c) => c.members.includes(gone) || c.parts.includes(gone)).map((c) => c.id)).toEqual([]);
    expect(fab.parts.filter((x) => x.memberId === gone || x.memberId.startsWith(`${gone}.`))).toEqual([]);
    expect(bom.parts.length).toBeGreaterThan(0);
    for (const c of drawingCatalog(p, d, fab)) {
      const txt = buildSheet(c, p, d, fab, bom).ents.filter((e) => e.k === 'text').map((e) => (e as { s: string }).s).join(' ');
      expect(txt.includes(gone), `${c.number} ${c.title}`).toBe(false);
    }
  });
});
