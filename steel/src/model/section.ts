import type { Mm } from '../core/units';
import type { BuildingParams, RoofInfo } from './types';

/**
 * חתך מסגרת מודולרי (החלטת משתמש 15.11.2026): "מערכת מודולרית לקביעת צורת הסככה".
 * שורות עמודים בכל מספר ומיקום, ומישורי גג (שיפועים) בכל מספר, גובה וכיוון. החיבורים נגזרים מהטופולוגיה:
 *  · עמוד שהמישור הגבוה עובר מעליו ⇒ ראש עמוד (שתי פלטות מוברגות), הקורה רציפה מעליו
 *  · מישור שמסתיים בעמוד שממשיך מעליו (גג מדורג / רכס מעל עמוד) ⇒ חיבור צד: פלטת קצה לאגף העמוד
 *  · שני מישורים שקצותיהם נפגשים ללא עמוד ⇒ רכס (פלטות קצה), כולל רכס על קונזולה
 * כל המסגרות לאורך Y זהות בחתך.
 */
export interface SectionLineDef { id: string; x: Mm }
export interface RoofPlaneDef {
  id: string;
  /** קו ייחוס (TOS או ציר לפי heightRef) מ-(x0,z0) עד (x1,z1); x0 < x1 */
  x0: Mm; z0: Mm; x1: Mm; z1: Mm;
  /** מאיזה קצה מתחילה פריסת הפטות */
  start: 'x0' | 'x1';
  /** סט פרמטרי הפטות: 'left' / 'right' (משותפים) או מזהה מישור עם פרמטרים משלו */
  purlins?: string;
  /** הקצה שגובהו נשמר כששינוי שיפוע (ברירת מחדל: קצה ההתחלה של הפטות) */
  fixed?: 'x0' | 'x1';
}
export interface CustomSection { lines: SectionLineDef[]; planes: RoofPlaneDef[]; template?: string }

export interface NLine { id: string; label: string; x: Mm }
export interface NPlane {
  id: string;
  label: string;
  /** קצה התחלת הקורה (a) וקצה סיום (b) */
  a: { x: Mm; z: Mm };
  b: { x: Mm; z: Mm };
  /** קצה התחלת פריסת הפטות */
  startAt: 'a' | 'b';
  /** האם קצה ההתחלה חופשי (לא רכס) — הפטה הראשונה נמדדת מהקצה */
  startFree: boolean;
  /** מפתח פרמטרי פטות */
  params: string;
  /** מזהה קורת הגג במסגרת */
  rafterId: (frameId: string) => string;
}
export interface NSection { lines: NLine[]; planes: NPlane[]; custom: boolean }

const HEB = 'אבגדהוזחטיכלמנסעפצקרשת';
export const lineLabel = (i: number) => HEB[i] ?? `X${i + 1}`;

/** גובה קו הייחוס של מישור ב-x */
export const zAt = (p: Pick<NPlane, 'a' | 'b'>, x: number) => p.a.z + ((p.b.z - p.a.z) * (x - p.a.x)) / (p.b.x - p.a.x);
export const xMin = (p: Pick<NPlane, 'a' | 'b'>) => Math.min(p.a.x, p.b.x);
export const xMax = (p: Pick<NPlane, 'a' | 'b'>) => Math.max(p.a.x, p.b.x);

/** חתך מנורמל מתוך פרמטרי המבנה: מצב קלאסי (דו/חד־שיפועי) או חתך מודולרי (building.section). */
export function normalizeSection(b: BuildingParams, roof: RoofInfo): NSection {
  if (b.section) {
    const lines = [...b.section.lines].sort((p, q) => p.x - q.x).map((l, i) => ({ id: l.id, label: lineLabel(i), x: l.x }));
    const planes: NPlane[] = b.section.planes.map((pl, i) => {
      const p0 = { x: pl.x0, z: pl.z0 }, p1 = { x: pl.x1, z: pl.z1 };
      const startAt = pl.start === 'x0' ? 'b' : 'b'; // הקורה תמיד מהקצה הרחוק אל קצה ההתחלה
      const [a, bb] = pl.start === 'x0' ? [p1, p0] : [p0, p1];
      void startAt;
      return {
        id: pl.id, label: `שיפוע ${i + 1}`, a, b: bb, startAt: 'b', startFree: true, params: pl.purlins ?? pl.id,
        rafterId: (f) => `${f}.RAF.${pl.id}`,
      };
    });
    // קצה התחלה שנפגש בקצה של מישור אחר (רכס) — אינו חופשי
    for (const p of planes) {
      p.startFree = !planes.some((q) => q !== p && [q.a, q.b].some((e) => Math.abs(e.x - p.b.x) < 1 && Math.abs(e.z - p.b.z) < 1));
    }
    return { lines, planes, custom: true };
  }
  const lines: NLine[] = [{ id: 'L', label: lineLabel(0), x: 0 }, { id: 'R', label: lineLabel(1), x: b.width }];
  if (b.roofType === 'gable') {
    const R = { x: b.ridgeX, z: roof.ridgeZ! };
    const A = { x: -b.rafterOverhangLeft, z: b.eaveLeft - roof.slopeLeft * b.rafterOverhangLeft };
    const B = { x: b.width + b.rafterOverhangRight, z: b.eaveRight - roof.slopeRight * b.rafterOverhangRight };
    return {
      lines, custom: false, planes: [
        { id: 'L', label: 'שיפוע שמאל', a: A, b: R, startAt: 'b', startFree: false, params: 'left', rafterId: (f) => `${f}.RAF.L` },
        { id: 'R', label: 'שיפוע ימין', a: B, b: R, startAt: 'b', startFree: false, params: 'right', rafterId: (f) => `${f}.RAF.R` },
      ],
    };
  }
  const s = roof.slopeLeft;
  const A = { x: -b.rafterOverhangLeft, z: b.eaveLeft - s * b.rafterOverhangLeft };
  const B = { x: b.width + b.rafterOverhangRight, z: b.eaveRight + s * b.rafterOverhangRight };
  // הקורה תמיד משמאל לימין (מזהה F.RAF); קצה התחלת הפטות לפי monoStart
  const lowIsA = A.z <= B.z;
  const startAtB = b.purlins.monoStart === 'low' ? !lowIsA : lowIsA;
  return {
    lines, custom: false, planes: [
      { id: 'M', label: 'שיפוע הגג', a: A, b: B, startAt: startAtB ? 'b' : 'a', startFree: true, params: 'left', rafterId: (f) => `${f}.RAF` },
    ],
  };
}

/** המרת המבנה הקלאסי הנוכחי לחתך מודולרי שקול (נקודת התחלה לעריכה). */
export function toCustomSection(b: BuildingParams, roof: RoofInfo): CustomSection {
  const n = normalizeSection({ ...b, section: undefined }, roof);
  return {
    lines: n.lines.map((l) => ({ id: l.id, x: l.x })),
    planes: n.planes.map((p) => {
      const [s0, s1] = p.a.x <= p.b.x ? [p.a, p.b] : [p.b, p.a];
      const startPt = p.startAt === 'b' ? p.b : p.a;
      return { id: p.id, x0: s0.x, z0: s0.z, x1: s1.x, z1: s1.z, start: startPt.x === s0.x ? 'x0' : 'x1', purlins: p.params };
    }),
  };
}

/** תבניות חתך נפוצות — נקודת התחלה מהירה (כל ערך ניתן לעריכה). גבהים = פני עליון קורת הגג בציר. */
export const SECTION_TEMPLATES: { id: string; name: string; desc: string; make: () => CustomSection }[] = [
  {
    id: 'gable-2', name: 'דו־שיפועי (2 צירים)', desc: 'סככה סטנדרטית: שני צירי עמודים, רכס באמצע',
    make: () => ({ template: 'gable-2', lines: [{ id: 'A', x: 0 }, { id: 'B', x: 18000 }], planes: [
      { id: 'P1', x0: -170, z0: 6000 - 17, x1: 9000, z1: 6900, start: 'x1' },
      { id: 'P2', x0: 9000, z0: 6900, x1: 18170, z1: 6000 - 17, start: 'x0' },
    ] }),
  },
  {
    id: 'mono-2', name: 'חד־שיפועי (2 צירים)', desc: 'שני צירי עמודים, שיפוע אחד',
    make: () => ({ template: 'mono-2', lines: [{ id: 'A', x: 0 }, { id: 'B', x: 12000 }], planes: [
      { id: 'P1', x0: -300, z0: 6000 - 30, x1: 12300, z1: 6000 + 0.1 * 12300, start: 'x1' },
    ] }),
  },
  {
    id: 'mono-multi', name: 'חד־שיפועי רב־מפתחי', desc: '3 שורות עמודים, שיפוע אחד רציף, קונזולות בשני הקצוות',
    make: () => ({ template: 'mono-multi', lines: [{ id: 'A', x: 0 }, { id: 'B', x: 8000 }, { id: 'C', x: 16000 }], planes: [{ id: 'P1', x0: -600, z0: 6000 - 60, x1: 16600, z1: 6000 + 0.1 * 16600, start: 'x1' }] }),
  },
  {
    id: 'gable-inner', name: 'דו־שיפועי עם עמוד פנימי', desc: '3 שורות עמודים; העמוד הפנימי אינו במרכז; הרכס בין העמודים',
    make: () => ({ template: 'gable-inner', lines: [{ id: 'A', x: 0 }, { id: 'B', x: 7000 }, { id: 'C', x: 20000 }], planes: [
      { id: 'P1', x0: -300, z0: 6000 - 30, x1: 11000, z1: 6000 + 0.1 * 11000, start: 'x1' },
      { id: 'P2', x0: 11000, z0: 6000 + 0.1 * 11000, x1: 20300, z1: 6000 + 0.1 * 11000 - 0.1 * 9300, start: 'x0' },
    ] }),
  },
  {
    id: 'gable-cant', name: 'רכס על קונזולה', desc: 'שיפוע אחד ממשיך כקונזולה מעבר לעמוד ועד הרכס; השיפוע השני מחובר אליו',
    make: () => ({ template: 'gable-cant', lines: [{ id: 'A', x: 0 }, { id: 'B', x: 9000 }, { id: 'C', x: 16000 }], planes: [
      { id: 'P1', x0: -300, z0: 6000 - 30, x1: 10500, z1: 6000 + 0.1 * 10500, start: 'x1' },
      { id: 'P2', x0: 10500, z0: 6000 + 0.1 * 10500, x1: 16300, z1: 6000 + 0.1 * 10500 - 0.15 * 5800, start: 'x0' },
    ] }),
  },
  {
    id: 'stepped', name: 'גג מדורג (שני חד־שיפועיים)', desc: 'שני שיפועים באותו כיוון בגבהים שונים; העמוד באמצע ממשיך למעלה — המישור הנמוך מתחבר לצד העמוד',
    make: () => ({ template: 'stepped', lines: [{ id: 'A', x: 0 }, { id: 'B', x: 10000 }, { id: 'C', x: 20000 }], planes: [
      { id: 'P1', x0: -500, z0: 5000 - 50, x1: 10000, z1: 5000 + 0.1 * 10000, start: 'x1' },
      { id: 'P2', x0: 10000, z0: 7000, x1: 20500, z1: 7000 + 0.1 * 10500, start: 'x1' },
    ] }),
  },
  {
    id: 'gable-center', name: 'דו־שיפועי עם עמוד ברכס', desc: '3 שורות עמודים; העמוד האמצעי מתחת לרכס, שני השיפועים מתחברים לצדי העמוד',
    make: () => ({ template: 'gable-center', lines: [{ id: 'A', x: 0 }, { id: 'B', x: 9000 }, { id: 'C', x: 18000 }], planes: [
      { id: 'P1', x0: -300, z0: 6000 - 30, x1: 9000, z1: 6900, start: 'x1' },
      { id: 'P2', x0: 9000, z0: 6900, x1: 18300, z1: 6000 - 30, start: 'x0' },
    ] }),
  },
  {
    id: 'twin-gable', name: 'דו־מפתחי (שני רכסים)', desc: '3 צירים, שני גגות דו־שיפועיים; מרזב (עמק) מעל העמוד האמצעי',
    make: () => ({ template: 'twin-gable', lines: [{ id: 'A', x: 0 }, { id: 'B', x: 15000 }, { id: 'C', x: 30000 }], planes: [
      { id: 'P1', x0: -300, z0: 6000 - 30, x1: 7500, z1: 6750, start: 'x1' },
      { id: 'P2', x0: 7500, z0: 6750, x1: 15000, z1: 6000, start: 'x0' },
      { id: 'P3', x0: 15000, z0: 6000, x1: 22500, z1: 6750, start: 'x1' },
      { id: 'P4', x0: 22500, z0: 6750, x1: 30300, z1: 6000 - 30, start: 'x0' },
    ] }),
  },
  {
    id: 'butterfly', name: 'פרפר (V) — מרזב באמצע', desc: '3 צירים; שני שיפועים יורדים אל עמוד אמצעי (מרזב פנימי)',
    make: () => ({ template: 'butterfly', lines: [{ id: 'A', x: 0 }, { id: 'B', x: 9000 }, { id: 'C', x: 18000 }], planes: [
      { id: 'P1', x0: -300, z0: 6900 + 30, x1: 9000, z1: 6000, start: 'x0' },
      { id: 'P2', x0: 9000, z0: 6000, x1: 18300, z1: 6900 + 30, start: 'x1' },
    ] }),
  },
  {
    id: 'sawtooth', name: 'שן מסור', desc: 'כמה חד־שיפועיים ברצף; כל עמוד פנימי ממשיך למעלה ומקבל את הקורה הבאה בצדו',
    make: () => ({ template: 'sawtooth', lines: [{ id: 'A', x: 0 }, { id: 'B', x: 8000 }, { id: 'C', x: 16000 }, { id: 'D', x: 24000 }], planes: [
      { id: 'P1', x0: -300, z0: 5500 - 30, x1: 8000, z1: 5500 + 800, start: 'x1' },
      { id: 'P2', x0: 8000, z0: 5500, x1: 16000, z1: 5500 + 800, start: 'x1' },
      { id: 'P3', x0: 16000, z0: 5500, x1: 24300, z1: 5500 + 830, start: 'x1' },
    ] }),
  },
  {
    id: 't-canopy', name: 'סככת T — עמוד מרכזי', desc: 'שורת עמודים אחת במרכז, רכס מעל העמוד, קונזולות לשני הצדדים (חניה)',
    make: () => ({ template: 't-canopy', lines: [{ id: 'A', x: 0 }], planes: [
      { id: 'P1', x0: -5000, z0: 4000 - 250, x1: 0, z1: 4000, start: 'x0' },
      { id: 'P2', x0: 0, z0: 4000, x1: 5000, z1: 4000 - 250, start: 'x1' },
    ] }),
  },
  {
    id: 'cantilever', name: 'קונזולה חד־עמודית (Γ)', desc: 'שורת עמודים אחת בגב, גג חד־שיפועי בקונזולה ארוכה לחזית (חניה / כניסה)',
    make: () => ({ template: 'cantilever', lines: [{ id: 'A', x: 0 }], planes: [
      { id: 'P1', x0: -300, z0: 4000 + 15, x1: 6000, z1: 4000 - 300, start: 'x0' },
    ] }),
  },
];

export type JunctionKind = 'cap' | 'side';
/** מפגש עמוד-מישור. side: הצד של הקורה ביחס לעמוד (−1 = משמאל, +1 = מימין). end: איזה קצה של הקורה (לחיבור צד) */
export interface Junction { line: NLine; plane: NPlane; kind: JunctionKind; side: -1 | 1 | 0; end?: 'a' | 'b' }
export interface Ridge { pa: NPlane; ea: 'a' | 'b'; pb: NPlane; eb: 'a' | 'b'; x: number; z: number }
export interface SectionTopology {
  sec: NSection;
  junctions: Junction[];
  ridges: Ridge[];
  /** גובה קו הייחוס העליון בכל עמוד, ומישור ראש העמוד (cap) אם יש */
  colTop: Map<string, { z: number; cap: NPlane | null }>;
  issues: { code: string; severity: 'error' | 'warning' | 'info'; message: string }[];
}

/**
 * טופולוגיית החתך: מסווגת כל מפגש עמוד-מישור (ראש עמוד / חיבור צד), מאתרת רכסים, ומאריכה קצה מישור
 * שיושב על עמוד קיצוני עד minExt (חצי פלטת ראש העמוד). colHalf = חצי עומק העמוד בכיוון X.
 */
export function sectionTopology(sec: NSection, colHalf: number, minExt: number): SectionTopology {
  const issues: SectionTopology['issues'] = [];
  const TOL = 1;
  const junctions: Junction[] = [];
  const colTop = new Map<string, { z: number; cap: NPlane | null }>();
  const endsAt = (p: NPlane, x: number): 'a' | 'b' | null => (Math.abs(p.a.x - x) <= colHalf + TOL ? 'a' : Math.abs(p.b.x - x) <= colHalf + TOL ? 'b' : null);
  // הארכת קצוות על עמוד קיצוני (העמוד הגבוה ביותר שם, ואין מישור אחר שממשיך)
  for (const l of sec.lines) {
    const cover = sec.planes.filter((p) => xMin(p) - colHalf - TOL <= l.x && l.x <= xMax(p) + colHalf + TOL);
    if (!cover.length) continue;
    const top = Math.max(...cover.map((p) => zAt(p, l.x)));
    const tops = cover.filter((p) => Math.abs(zAt(p, l.x) - top) < TOL);
    if (tops.length !== 1) continue;
    const p = tops[0];
    const e = Math.abs(p.a.x - l.x) <= minExt + TOL ? 'a' : Math.abs(p.b.x - l.x) <= minExt + TOL ? 'b' : null;
    if (!e) continue;
    const pt = p[e], other = p[e === 'a' ? 'b' : 'a'];
    const out = Math.sign(pt.x - other.x) || 1;
    const need = l.x + out * minExt;
    if ((need - pt.x) * out > 0.01) {
      const z = zAt(p, need);
      p[e] = { x: need, z };
      issues.push({ code: 'RAFTER_EXT', severity: 'info', message: `${p.label}: קורת הגג מוארכת עד ${minExt} מ"מ מציר ${l.label} (קצה פלטת ראש העמוד)` });
    }
  }
  for (const l of sec.lines) {
    const cover = sec.planes.filter((p) => xMin(p) - colHalf - TOL <= l.x && l.x <= xMax(p) + colHalf + TOL);
    if (!cover.length) { issues.push({ code: 'LINE_FREE', severity: 'error', message: `ציר ${l.label}: אין מישור גג מעל העמוד` }); continue; }
    const top = Math.max(...cover.map((p) => zAt(p, Math.max(xMin(p), Math.min(xMax(p), l.x)))));
    const tops = cover.filter((p) => Math.abs(zAt(p, Math.max(xMin(p), Math.min(xMax(p), l.x))) - top) < TOL);
    let cap: NPlane | null = null;
    for (const p of cover) {
      const e = endsAt(p, l.x);
      const isTop = tops.includes(p);
      if (isTop && (!e || tops.length === 1)) {
        cap = p;
        junctions.push({ line: l, plane: p, kind: 'cap', side: 0 });
        continue;
      }
      if (!e) {
        issues.push({ code: 'PLANE_THROUGH', severity: 'error', message: `${p.label} עובר דרך ציר ${l.label} שהעמוד שלו ממשיך מעליו — יש לסיים את המישור בעמוד` });
        continue;
      }
      const other = p[e === 'a' ? 'b' : 'a'];
      junctions.push({ line: l, plane: p, kind: 'side', side: other.x > l.x ? 1 : -1, end: e });
    }
    // עמוד שכל המישורים מסתיימים בצדו (עמק/מרזב — פרפר, דו־מפתחי): ראש העמוד בגובה הקורות בפני העמוד, כדי שפלטות הצד ייכנסו
    let zTop = top;
    if (!cap) for (const p of cover) zTop = Math.max(zTop, zAt(p, Math.max(xMin(p), Math.min(xMax(p), l.x - colHalf))), zAt(p, Math.max(xMin(p), Math.min(xMax(p), l.x + colHalf))));
    colTop.set(l.id, { z: zTop, cap });
  }
  // רכסים: קצוות של שני מישורים באותה נקודה, ללא עמוד
  const ridges: Ridge[] = [];
  for (let i = 0; i < sec.planes.length; i++) for (let j = i + 1; j < sec.planes.length; j++) {
    const pa = sec.planes[i], pb = sec.planes[j];
    for (const ea of ['a', 'b'] as const) for (const eb of ['a', 'b'] as const) {
      const A = pa[ea], B = pb[eb];
      if (Math.abs(A.x - B.x) < TOL && Math.abs(A.z - B.z) < TOL && !sec.lines.some((l) => Math.abs(l.x - A.x) <= colHalf + TOL)) ridges.push({ pa, ea, pb, eb, x: A.x, z: A.z });
    }
  }
  // קצה מישור שאינו על עמוד, אינו רכס — קונזולה חופשית (מותר). מישור בלי שום עמוד — שגיאה.
  for (const p of sec.planes) {
    if (!junctions.some((j) => j.plane === p) && !ridges.some((r) => r.pa === p || r.pb === p)) issues.push({ code: 'PLANE_FREE', severity: 'error', message: `${p.label}: אינו נשען על עמוד ואינו מחובר למישור אחר` });
    if (Math.abs(p.a.x - p.b.x) < 100) issues.push({ code: 'PLANE_SHORT', severity: 'error', message: `${p.label}: מישור קצר מדי` });
  }
  return { sec, junctions, ridges, colTop, issues };
}

/**
 * הזזת צירים בחתך מודולרי: כל קצה מישור "שייך" לציר הקרוב אליו (לפני ההזזה) וזז איתו באותו מרחק — כך
 * קונזולות, רכס מעל עמוד וחיבורי צד נשמרים. הגבהים (z) של הקצוות נשמרים; השיפוע מתעדכן בהתאם.
 */
export function moveLines(sec: CustomSection, moves: Map<string, number>): CustomSection {
  const old = new Map(sec.lines.map((l) => [l.id, l.x]));
  const delta = (x: number) => {
    let best: string | null = null, bd = Infinity;
    for (const [id, lx] of old) { const d = Math.abs(lx - x); if (d < bd) { bd = d; best = id; } }
    return best && moves.has(best) ? moves.get(best)! - old.get(best)! : 0;
  };
  return {
    ...sec, template: undefined,
    lines: sec.lines.map((l) => (moves.has(l.id) ? { ...l, x: moves.get(l.id)! } : l)),
    planes: sec.planes.map((p) => ({ ...p, x0: p.x0 + delta(p.x0), x1: p.x1 + delta(p.x1) })),
  };
}

/**
 * מספר צירים (בקשת משתמש): n צירים במרווחים שווים בין הציר הראשון לאחרון (או לרוחב חדש).
 * צירים קיימים נשמרים לפי סדר (מזהים יציבים), חסרים נוספים, עודפים פנימיים מוסרים; קצוות מישורי הגג נעים עם הצירים הקרובים.
 */
export function setAxisCount(sec: CustomSection, n: number, width?: number): CustomSection {
  const ls = [...sec.lines].sort((a, b) => a.x - b.x);
  const N = Math.max(2, Math.min(30, Math.round(n)));
  const x0 = ls[0].x, x1 = width && width > 500 ? x0 + width : ls[ls.length - 1].x;
  const xs = Array.from({ length: N }, (_, i) => Math.round(x0 + ((x1 - x0) * i) / (N - 1)));
  const keepInner = ls.slice(1, -1).slice(0, N - 2);
  const kept = [ls[0], ...keepInner, ls[ls.length - 1]];
  const moves = new Map<string, number>();
  kept.forEach((l, i) => moves.set(l.id, i === kept.length - 1 ? xs[N - 1] : xs[i]));
  let out = moveLines({ ...sec, lines: kept }, moves);
  const used = new Set(out.lines.map((l) => l.id));
  const newId = () => { let k = 1; while (used.has(`C${k}`)) k++; used.add(`C${k}`); return `C${k}`; };
  for (let i = kept.length - 1; i < N - 1; i++) out = { ...out, lines: [...out.lines, { id: newId(), x: xs[i] }] };
  return { ...out, template: undefined };
}

/** קצה מישור עובר לגובה חדש; קצוות של מישורים אחרים באותה נקודה (רכס/עמק) זזים איתו — הטופולוגיה נשמרת */
export function setPlaneEndZ(sec: CustomSection, planeId: string, end: 'x0' | 'x1', z: number): CustomSection {
  const pl = sec.planes.find((p) => p.id === planeId);
  if (!pl) return sec;
  const x = pl[end], z0 = end === 'x0' ? pl.z0 : pl.z1;
  const near = (px: number, pz: number) => Math.abs(px - x) < 1 && Math.abs(pz - z0) < 1;
  return {
    ...sec, template: undefined,
    planes: sec.planes.map((p) => ({ ...p, z0: p.id === planeId && end === 'x0' || near(p.x0, p.z0) ? z : p.z0, z1: p.id === planeId && end === 'x1' || near(p.x1, p.z1) ? z : p.z1 })),
  };
}

/** שינוי שיפוע מישור (%) — הקצה הנעול (fixed / start) נשאר במקומו; הקצה השני ומישורים שמחוברים אליו מתעדכנים */
export function setPlaneSlope(sec: CustomSection, planeId: string, pct: number): CustomSection {
  const pl = sec.planes.find((p) => p.id === planeId);
  if (!pl) return sec;
  const fixed = pl.fixed ?? pl.start ?? 'x0';
  const sl = pct / 100, dx = pl.x1 - pl.x0;
  return fixed === 'x0' ? setPlaneEndZ(sec, planeId, 'x1', Math.round(pl.z0 + sl * dx)) : setPlaneEndZ(sec, planeId, 'x0', Math.round(pl.z1 - sl * dx));
}

/** הזזת כל הגג אנכית (גובה עמודים) */
export function shiftRoof(sec: CustomSection, dz: number): CustomSection {
  return { ...sec, template: undefined, planes: sec.planes.map((p) => ({ ...p, z0: p.z0 + dz, z1: p.z1 + dz })) };
}
