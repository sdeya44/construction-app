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
export interface SectionLineDef { id: string; x: Mm;
  /** קיר קיים (סככה צמודה לקיר): אין עמוד — קורות הגג מעוגנות לקיר בפלטת קצה ועוגנים כימיים */
  wall?: boolean }
export interface RoofPlaneDef {
  id: string;
  /** קו ייחוס (TOS או ציר לפי heightRef) מ-(x0,z0) עד (x1,z1); x0 < x1 */
  x0: Mm; z0: Mm; x1: Mm; z1: Mm;
  /** מאיזה קצה מתחילה פריסת הפטות */
  start: 'x0' | 'x1';
  /** סט פרמטרי הפטות: 'left' / 'right' (משותפים) או מזהה מישור עם פרמטרים משלו */
  purlins?: string;
  /** ישן (עד 1.32): הקצה שגובהו נשמר בשינוי שיפוע — לא בשימוש; שינוי שיפוע שומר את גובה העמוד הנמוך */
  fixed?: 'x0' | 'x1';
}
export interface CustomSection { lines: SectionLineDef[]; planes: RoofPlaneDef[]; template?: string }

export interface NLine { id: string; label: string; x: Mm; wall?: boolean }
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
    const lines = [...b.section.lines].sort((p, q) => p.x - q.x).map((l, i) => ({ id: l.id, label: b.lineLabels?.[l.id]?.trim() || lineLabel(i), x: l.x, ...(l.wall ? { wall: true } : {}) }));
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
  const lines: NLine[] = [{ id: 'L', label: b.lineLabels?.L?.trim() || lineLabel(0), x: 0 }, { id: 'R', label: b.lineLabels?.R?.trim() || lineLabel(1), x: b.width }];
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
    lines: n.lines.map((l) => ({ id: l.id, x: l.x, ...(l.wall ? { wall: true } : {}) })),
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
    id: 'monitor', name: 'מוניטור (גג מוגבה לאוורור)', desc: '4 צירים: גג דו־שיפועי מוגבה מעל שני העמודים הפנימיים, ושני גגות נמוכים משני הצדדים שמתחברים לצד העמודים — פתח אוורור בין הגגות',
    make: () => ({ template: 'monitor', lines: [{ id: 'A', x: 0 }, { id: 'B', x: 9000 }, { id: 'C', x: 15000 }, { id: 'D', x: 24000 }], planes: [
      { id: 'P1', x0: -300, z0: 5500 - 30, x1: 9000, z1: 5500 + 900, start: 'x1' },
      { id: 'P2', x0: 8700, z0: 7400 - 30, x1: 12000, z1: 7400 + 300, start: 'x0' },
      { id: 'P3', x0: 12000, z0: 7400 + 300, x1: 15300, z1: 7400 - 30, start: 'x1' },
      { id: 'P4', x0: 15000, z0: 5500 + 900, x1: 24300, z1: 5500 - 30, start: 'x0' },
    ] }),
  },
  {
    id: 'barn', name: 'אסם (מרכז גבוה + שתי כנפיים)', desc: '4 צירים: מפתח מרכזי רחב וגבוה בגג דו־שיפועי, ושתי כנפיים נמוכות חד־שיפועיות שנשענות על צדי העמודים המרכזיים',
    make: () => ({ template: 'barn', lines: [{ id: 'A', x: 0 }, { id: 'B', x: 6000 }, { id: 'C', x: 18000 }, { id: 'D', x: 24000 }], planes: [
      { id: 'P1', x0: -300, z0: 4000 - 30, x1: 6000, z1: 4000 + 600, start: 'x1' },
      { id: 'P2', x0: 5700, z0: 6500 - 45, x1: 12000, z1: 6500 + 900, start: 'x0' },
      { id: 'P3', x0: 12000, z0: 6500 + 900, x1: 18300, z1: 6500 - 45, start: 'x1' },
      { id: 'P4', x0: 18000, z0: 4000 + 600, x1: 24300, z1: 4000 - 30, start: 'x0' },
    ] }),
  },
  {
    id: 'lean-to', name: 'צמודה לקיר קיים (חד־שיפועי)', desc: 'שורת עמודים אחת בחזית; קורות הגג מעוגנות לקיר הקיים בפלטת קצה ועוגנים כימיים',
    make: () => ({ template: 'lean-to', lines: [{ id: 'W', x: 0, wall: true }, { id: 'A', x: 8000 }], planes: [
      { id: 'P1', x0: 0, z0: 5000, x1: 8300, z1: 5000 - 0.1 * 8300, start: 'x0' },
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
    if (l.wall) continue;
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
    if (l.wall) {
      // קיר קיים: המישור חייב להסתיים בפני הקיר; חיבור "צד" לקיר (ללא עמוד)
      for (const p of sec.planes) {
        const e = Math.abs(p.a.x - l.x) <= TOL + 1 ? 'a' : Math.abs(p.b.x - l.x) <= TOL + 1 ? 'b' : null;
        if (e) { const other = p[e === 'a' ? 'b' : 'a']; junctions.push({ line: l, plane: p, kind: 'side', side: other.x > l.x ? 1 : -1, end: e }); }
        else if (xMin(p) < l.x - 1 && xMax(p) > l.x + 1) issues.push({ code: 'PLANE_THROUGH', severity: 'error', message: `${p.label} עובר דרך הקיר הקיים (ציר ${l.label}) — יש לסיים את המישור בפני הקיר` });
      }
      continue;
    }
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

/**
 * שינוי שיפוע מישור (%): גובה העמוד בציר הנמוך נשמר, הרכס / העמוד הגבוה מתעדכן (ומישורים מחוברים אליו).
 * (בקשת משתמש 18.11.2026 — במקום מנגנון "גובה נעול"; השדה fixed הישן אינו בשימוש)
 */
export function setPlaneSlope(sec: CustomSection, planeId: string, pct: number): CustomSection {
  const pd = planeDims(sec, planeId);
  if (!pd) return sec;
  // הכיוון נשמר (הערך המוחלט — מהנמוך לגבוה); היפוך כיוון — בשדות הגובה
  return setPlaneDims(sec, planeId, pd.zLow, pd.zLow + (Math.abs(pct) / 100) * pd.run);
}

/** הזזת כל הגג אנכית (גובה עמודים) */
export function shiftRoof(sec: CustomSection, dz: number): CustomSection {
  return { ...sec, template: undefined, planes: sec.planes.map((p) => ({ ...p, z0: p.z0 + dz, z1: p.z1 + dz })) };
}

/** מפלס תחתית העמוד בציר (חגורה/יסוד); בין צירים — אינטרפולציה ליניארית (עמודי רוח בקיר קצה) */
export function lineBaseAt(b: { baseElevation: number; lineBase?: Record<string, number> }, lines: { id: string; x: number }[], x: number): number {
  const ls = [...lines].sort((a, c) => a.x - c.x);
  const z = (l: { id: string }) => b.lineBase?.[l.id] ?? b.baseElevation;
  if (!ls.length) return b.baseElevation;
  const hit = ls.find((l) => Math.abs(l.x - x) < 1); if (hit) return z(hit);
  if (x <= ls[0].x) return z(ls[0]);
  if (x >= ls[ls.length - 1].x) return z(ls[ls.length - 1]);
  for (let i = 1; i < ls.length; i++) if (x <= ls[i].x) { const t = (x - ls[i - 1].x) / (ls[i].x - ls[i - 1].x); return z(ls[i - 1]) + t * (z(ls[i]) - z(ls[i - 1])); }
  return b.baseElevation;
}

/**
 * מידות פשוטות של מישור גג (בקשת משתמש 18.11.2026): גובה עמוד (בציר הנמוך), גובה רכס / עמוד גבוה, שיפוע.
 * הגבהים נמדדים בצירי העמודים (לא בקצה הקונזולה): הנמוך — הציר הקרוב לקצה הנמוך; הגבוה — הרכס (מפגש מישורים)
 * או הציר הקרוב לקצה הגבוה. מזינים שניים — השלישי מחושב (setPlaneDims).
 */
export interface PlaneDims {
  xLow: number; xHigh: number; zLow: number; zHigh: number;
  /** שיפוע (%) — חיובי, מהנמוך לגבוה */
  slopePct: number;
  /** מרחק אופקי בין נקודות הייחוס */
  run: number;
  /** הקצה הגבוה הוא רכס (מפגש עם מישור אחר) */
  highIsRidge: boolean;
  /** אינדקס הציר בנקודת הייחוס (לתווית), אם יש */
  lowLine?: number; highLine?: number;
}

export function planeDims(sec: CustomSection, planeId: string): PlaneDims | null {
  const pl = sec.planes.find((p) => p.id === planeId);
  if (!pl || Math.abs(pl.x1 - pl.x0) < 1) return null;
  const lowEnd: 'x0' | 'x1' = pl.z0 <= pl.z1 ? 'x0' : 'x1', highEnd = lowEnd === 'x0' ? 'x1' : 'x0';
  const zOf = (x: number) => pl.z0 + ((pl.z1 - pl.z0) * (x - pl.x0)) / (pl.x1 - pl.x0);
  const lines = [...sec.lines].sort((a, b) => a.x - b.x);
  const inRange = lines.map((l, i) => ({ x: l.x, i })).filter((l) => l.x >= Math.min(pl.x0, pl.x1) - 1 && l.x <= Math.max(pl.x0, pl.x1) + 1);
  const nearest = (x: number, not?: number) => inRange.filter((l) => l.i !== not).sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x))[0];
  const hx = pl[highEnd], hz = highEnd === 'x0' ? pl.z0 : pl.z1;
  const highIsRidge = sec.planes.some((q) => q.id !== pl.id && ((Math.abs(q.x0 - hx) < 1 && Math.abs(q.z0 - hz) < 1) || (Math.abs(q.x1 - hx) < 1 && Math.abs(q.z1 - hz) < 1)));
  const lo = nearest(pl[lowEnd]);
  let hi = highIsRidge ? inRange.find((l) => Math.abs(l.x - hx) < 1) : nearest(hx, lo?.i);
  let xLow = lo ? lo.x : pl[lowEnd], xHigh = highIsRidge ? hx : hi ? hi.x : hx;
  if (Math.abs(xHigh - xLow) < 1) { xLow = pl[lowEnd]; xHigh = hx; hi = undefined; }
  const zLow = zOf(xLow), zHigh = zOf(xHigh), run = Math.abs(xHigh - xLow);
  return { xLow, xHigh, zLow, zHigh, run, slopePct: ((zHigh - zLow) / run) * 100, highIsRidge, lowLine: lo && Math.abs(lo.x - xLow) < 1 ? lo.i : undefined, highLine: hi?.i };
}

/** קביעת גובה בנקודות הייחוס (zLow, zHigh): המישור מוגדר מחדש דרכן; קצוות מישורים מחוברים (רכס) זזים יחד */
export function setPlaneDims(sec: CustomSection, planeId: string, zLow: number, zHigh: number): CustomSection {
  const pd = planeDims(sec, planeId);
  const pl = sec.planes.find((p) => p.id === planeId);
  if (!pd || !pl) return sec;
  const s = (zHigh - zLow) / (pd.xHigh - pd.xLow);
  const z = (x: number) => zLow + s * (x - pd.xLow);
  const out = setPlaneEndZ(sec, planeId, 'x0', z(pl.x0));
  return setPlaneEndZ(out, planeId, 'x1', z(pl.x1));
}

/** זוג מישורים דו-שיפועי סימטרי סביב רכס (לעריכה משותפת): אותו שיפוע, אותו גובה עמוד, רכס באמצע בין צירי הייחוס */
export function gablePair(sec: CustomSection): { a: string; b: string; symmetric: boolean } | null {
  if (sec.planes.length !== 2) return null;
  const [p, q] = [...sec.planes].sort((u, v) => u.x0 - v.x0);
  const dp = planeDims(sec, p.id), dq = planeDims(sec, q.id);
  if (!dp || !dq || !dp.highIsRidge || !dq.highIsRidge || Math.abs(dp.xHigh - dq.xHigh) > 1) return null;
  if (!(dp.xLow < dp.xHigh && dq.xLow > dq.xHigh)) return null;
  const centered = Math.abs(dp.run - dq.run) < 1;
  if (!centered) return null;
  return { a: p.id, b: q.id, symmetric: Math.abs(dp.zLow - dq.zLow) < 1 && Math.abs(dp.slopePct - dq.slopePct) < 0.01 };
}

/**
 * הזזת קצה מישור גג (X) לאורך השיפוע: הגובה בצירי העמודים נשמר (הגובה = פני עליון קורת הגג בציר העמוד, לא בקצה הקונזולה).
 * שינוי X בלי לעדכן Z מזיז את כל הגג (למשל קונזולה 1 מ' ב-X=-1000 עם Z=4000 בקצה העלה את גובה העמוד ל-4143).
 */
export function slidePlaneEnd(sec: CustomSection, planeId: string, end: 'x0' | 'x1', x: number): CustomSection {
  return {
    ...sec, template: undefined,
    planes: sec.planes.map((pl) => {
      if (pl.id !== planeId) return pl;
      const s = (pl.z1 - pl.z0) / (pl.x1 - pl.x0);
      return end === 'x0' ? { ...pl, x0: x, z0: pl.z1 - s * (pl.x1 - x) } : { ...pl, x1: x, z1: pl.z0 + s * (x - pl.x0) };
    }),
  };
}
