/**
 * PGEO — אגד B: גיאומטריית האלכסונים מול המידות שהוזנו (gap 200, ירידה 800, זווית 40°, קורה RHS100x100x5, אלכסון SHS80x4, מפתח אחד).
 * אמנה (לפי `portal.ts`): זווית מהאופק; ירידה = מרחק אנכי על פני העמוד מתחתית קורת האגד לנקודת העבודה התחתונה של האלכסון;
 * נקודת העבודה העליונה על תחתית קורת האגד במרחק אופקי ירידה/tan(זווית) מפני הווב (y = f.y ± tw/2); gap = מרחק מתחתית הקורה הראשית לראש קורת האגד.
 * חיתוך בחיבורים (פח + לשונית) מקצר את חלק ה-RHS בכל קצה — נקודות העבודה (המשך הציר) חייבות להישאר על המידות שהוזנו.
 * גיאומטריה בלבד — לא תכן חוזק. דוח: e2e-results/evidence/portal-geometry.md.
 */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject, framesFromSpacings } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { computeFabrication } from '../src/fab/marks';
import { computeBom } from '../src/fab/bom';
import { numberParts, setBuilding } from '../src/commands/commands';
import { defaultPortal } from '../src/geometry/portal';
import { buildSheet, drawingCatalog } from '../src/drawing/views';
import { getProfile } from '../src/profiles/library';

const IN = { gap: 200, drop: 800, angle: 40, beam: 'RHS100x100x5', brace: 'SHS80x4', bay: 6000 };
const rad = (d: number) => (d * Math.PI) / 180;
// חישוב ידני (ציר-ציר) מהקלט בלבד
const EXP = { dz: IN.drop, dy: IN.drop / Math.tan(rad(IN.angle)), len: IN.drop / Math.sin(rad(IN.angle)) }; // 800 / 953.40 / 1244.58

function build(extra: Record<string, number> = {}) {
  const b = defaultBuilding();
  const p0 = setBuilding({ frames: framesFromSpacings([IN.bay]), bracing: { ...b.bracing, walls: { ...b.bracing.walls, enabled: true, type: 'portal', portal: { ...defaultPortal(), ...IN, ...extra } } } } as never).run(newProject('PGEO', b));
  const p = numberParts().run(p0);
  const d = generate(p), fab = computeFabrication(p, d), bom = computeBom(d, fab);
  return { p, d, fab, bom };
}
const r2 = (x: number) => Math.round(x * 100) / 100;

describe('PGEO אגד B — אלכסונים מול המידות שהוזנו', () => {
  const { p, d, fab, bom } = build();
  const col = getProfile(p.building.columnProfile), tw = col.dims.tw ?? 8;
  const beamM = d.members.find((m) => m.id === 'BB.1.L')!, k1 = d.members.find((m) => m.id === 'BB.1.L.K1')!, k2 = d.members.find((m) => m.id === 'BB.1.L.K2')!;
  const hb = getProfile(IN.beam).props.h;
  const zBot = beamM.start.z - hb / 2, zTopB = beamM.start.z + hb / 2;
  // נקודות עבודה = המשך ציר האלכסון (בפועל, מקצות האלמנט) עד פני העמוד ועד תחתית קורת האגד
  const wp = (m: typeof k1, yFace: number) => {
    const dy = m.end.y - m.start.y, dz = m.end.z - m.start.z;
    const tFace = (yFace - m.start.y) / dy, tBeam = (zBot - m.start.z) / dz;
    return { low: { y: yFace, z: m.start.z + tFace * dz }, up: { y: m.start.y + tBeam * dy, z: zBot }, dy: Math.abs(dy), dz: Math.abs(dz), len: Math.hypot(dy, dz), angle: (Math.atan2(Math.abs(dz), Math.abs(dy)) * 180) / Math.PI };
  };
  const w1 = wp(k1, 0 + tw / 2), w2 = wp(k2, IN.bay - tw / 2);
  const nominal = (w: typeof w1) => Math.hypot(w.up.y - w.low.y, w.up.z - w.low.z);

  it('PGEO-01: אמנה — נקודות העבודה (המשך הציר) בדיוק על המידות שהוזנו: ירידה 800, אופקי 953.40, אורך 1,244.58, זווית 40°', () => {
    for (const [w, sg, yF] of [[w1, 1, tw / 2], [w2, -1, IN.bay - tw / 2]] as const) {
      expect(w.low.z, 'נקודה תחתונה = תחתית הקורה − ירידה').toBeCloseTo(zBot - IN.drop, 6);
      expect(sg * (w.up.y - yF), 'אופקי מפני הווב').toBeCloseTo(EXP.dy, 6);
      expect(Math.abs(w.up.z - w.low.z), 'אנכי').toBeCloseTo(EXP.dz, 6);
      expect(nominal(w), 'אורך נקודה-לנקודה').toBeCloseTo(EXP.len, 6);
      expect(w.angle, 'זווית מהאופק').toBeCloseTo(IN.angle, 6);
    }
    expect(EXP.len).toBeCloseTo(1244.58, 2); expect(EXP.dy).toBeCloseTo(953.40, 2);
  });
  it('PGEO-02: חלק ה-RHS מקוצר בחיבורים (פח + לשונית בחריץ) באותו קיצור בשני הצדדים; הציר עובר דרך נקודות העבודה', () => {
    const allowance = (EXP.len - w1.len) / 2;
    expect(allowance).toBeGreaterThan(100); expect(allowance).toBeLessThan(250);
    expect(w2.len).toBeCloseTo(w1.len, 6);
    // קצוות החלק על הקו בין נקודות העבודה
    const onLine = (m: typeof k1, w: typeof w1) => { const dy = w.up.y - w.low.y, dz = w.up.z - w.low.z, L = Math.hypot(dy, dz); const dist = (q: { y: number; z: number }) => Math.abs((q.y - w.low.y) * dz - (q.z - w.low.z) * dy) / L; return Math.max(dist(m.start), dist(m.end)); };
    expect(onLine(k1, w1)).toBeLessThan(1e-6); expect(onLine(k2, w2)).toBeLessThan(1e-6);
  });
  // gap בפועל = מרחק אנכי מתחתית הקורה הראשית (על ציר הקורה) לראש קורת האגד
  const gapOf = (mod: ReturnType<typeof build>) => {
    const bm = mod.d.members.find((m) => m.id === 'BB.1.L')!;
    const raf = mod.d.members.find((m) => m.id === 'F1.RAF.L') ?? mod.d.members.find((m) => /^F1\.RAF/.test(m.id))!;
    const t = (bm.start.x - raf.start.x) / (raf.end.x - raf.start.x);
    const zs = raf.start.z + t * (raf.end.z - raf.start.z);
    const sl = (raf.end.z - raf.start.z) / (raf.end.x - raf.start.x);
    expect(raf.anchor).toBe('top');
    return zs - getProfile(raf.profile).props.h * Math.sqrt(1 + sl * sl) - (bm.start.z + getProfile(IN.beam).props.h / 2);
  };
  it('PGEO-03: gap — ברירת מחדל zTopClear=60 משמרת מודלים קיימים (gap+60); zTopClear=0 נותן gap מדויק 200', () => {
    expect(gapOf({ p, d, fab, bom })).toBeCloseTo(IN.gap + 60, 6); // ללא zTopClear: גיאומטריה קיימת ללא שינוי
    const m0 = build({ zTopClear: 0 });
    expect(gapOf(m0)).toBeCloseTo(IN.gap, 6);
    // נקודות העבודה לא זזות ביחס לקורה: אותו אורך/זווית/ירידה, הכול מוזז ב-60 מעלה
    const k = m0.d.members.find((m) => m.id === 'BB.1.L.K1')!;
    expect(Math.abs(k.start.z - k.end.z)).toBeCloseTo(Math.abs(k1.start.z - k1.end.z), 6);
    expect(m0.d.members.find((m) => m.id === 'BB.1.L')!.start.z - beamM.start.z).toBeCloseTo(60, 6); // הקורה גבוהה ב-60
  });
  it('PGEO-04: כתב כמויות ושרטוטי ייצור — אורך החלק = אורך האלמנט בפועל; השרטוט מציג את אותו אורך, והמכלול את הדלתאות והזווית', () => {
    const pt = fab.parts.find((x) => x.memberId === k1.id)!;
    expect(pt.length).toBeCloseTo(w1.len, 1);
    const row = bom.parts.find((x) => x.mark === pt.mark)!;
    expect(row.length).toBeCloseTo(pt.length, 6); expect(row.qty).toBe(d.members.filter((m) => /^BB\.\d+\.[LR]\.K\d$/.test(m.id)).length); expect(row.qty).toBe(4); // 2 אלכסונים × קיר שמאל וימין, כולם זהים
    const cat = drawingCatalog(p, d, fab);
    const texts = (id: string) => buildSheet(cat.find((c) => c.id === id)!, p, d, fab, bom).ents.filter((e) => e.k === 'text').map((e) => (e as { s: string }).s);
    const partTexts = texts(`D-PART-${pt.mark}`);
    expect(partTexts.some((s) => s.replace(/[^\d.]/g, '') === String(Math.round(pt.length))), `אורך ${Math.round(pt.length)} בשרטוט החלק`).toBe(true);
    const unit = cat.find((c) => c.type === 'brace-unit')!;
    const ut = texts(unit.id);
    expect(ut.some((s) => s === String(Math.round(w1.dz)))).toBe(true);   // אנכי של האלמנט
    expect(ut.some((s) => s === String(Math.round(w1.dy)))).toBe(true);   // אופקי של האלמנט
    expect(ut.some((s) => s === '40.0°')).toBe(true);                     // זווית
    // דוח
    const md = ['# PGEO — אגד B: צפוי מול בפועל (gap 200, ירידה 800, 40°, RHS100x100x5 / SHS80x4)', '', '| פריט | צפוי (חישוב) | בפועל | הפרש |', '|---|---|---|---|',
      `| אנכי, נקודה לנקודה | ${r2(EXP.dz)} | ${r2(Math.abs(w1.up.z - w1.low.z))} | ${r2(Math.abs(w1.up.z - w1.low.z) - EXP.dz)} |`,
      `| אופקי, נקודה לנקודה | ${r2(EXP.dy)} | ${r2(w1.up.y - w1.low.y)} | ${r2(w1.up.y - w1.low.y - EXP.dy)} |`,
      `| אורך נקודה לנקודה | ${r2(EXP.len)} | ${r2(nominal(w1))} | ${r2(nominal(w1) - EXP.len)} |`,
      `| זווית | 40 | ${r2(w1.angle)} | ${r2(w1.angle - 40)} |`,
      `| אורך חלק RHS (אלמנט / BOM / שרטוט) | — | ${r2(w1.len)} / ${r2(row.length)} / ${Math.round(pt.length)} | קיצור ${r2((EXP.len - w1.len) / 2)} לכל קצה |`,
      `| אנכי / אופקי של האלמנט (מכלול) | — | ${Math.round(w1.dz)} / ${Math.round(w1.dy)} | — |`,
      `| gap (תחתית הקורה הראשית → ראש קורת האגד) | ${IN.gap} | ${r2(gapOf(build({ zTopClear: 0 })))} (zTopClear=0) / ${r2(zBotGap())} (ברירת מחדל 60) | 0 / +60 |`].join('\n');
    function zBotGap() { const raf = d.members.find((m) => /^F1\.RAF/.test(m.id))!; const t2 = (beamM.start.x - raf.start.x) / (raf.end.x - raf.start.x); const zt = raf.start.z + t2 * (raf.end.z - raf.start.z); const s = (raf.end.z - raf.start.z) / (raf.end.x - raf.start.x); return zt - getProfile(raf.profile).props.h * Math.sqrt(1 + s * s) - zTopB; }
    fs.mkdirSync('e2e-results/evidence', { recursive: true }); fs.writeFileSync('e2e-results/evidence/portal-geometry.md', md);
  });
});
