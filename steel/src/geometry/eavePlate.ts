import type { PlateConnParams } from '../model/types';
import { getProfile } from '../profiles/library';
import { hw } from './connections';

/**
 * בדיקת פלטות ראש עמוד (פלטה על העמוד + פלטה על הקורה) מול רוחב הפרופילים — החלטת משתמש 15.11.2026.
 * אום מעל פלטת הקורה חייב להיות מחוץ לרוחב אגף הקורה; ראש בורג מתחת לפלטת העמוד — מחוץ להיטל העמוד.
 * הפלטה העליונה של העמוד חייבת לכסות את חתך העמוד (עם מקום לריתוך).
 * גיאומטריה בלבד — אינה בדיקת חוזק.
 */
export interface EaveBolt { gy: number; px: number; nutHit: boolean; headHit: boolean }
export interface EaveCheck {
  ok: boolean;
  bolts: EaveBolt[];
  /** רדיוס אום/דיסקית + מרווח (מ"מ) */
  rr: number;
  coverOk: boolean;
  edgeOk: boolean;
  messages: string[];
  raf: { b: number; h: number; name: string };
  col: { b: number; h: number; name: string };
  cos: number;
}

const grid = (n: number, step: number) => Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * step);
const up5 = (x: number) => Math.ceil(x / 5) * 5;

export function boltClearR(d: number): number {
  const h = hw(d);
  const washerOD = d <= 12 ? 24 : d <= 16 ? 30 : d <= 20 ? 37 : 44; // ISO 7089 (גיאומטרי)
  return Math.max(h.s / Math.sqrt(3), washerOD / 2) + 2;
}

export function checkEavePlate(prm: PlateConnParams, rafProfile: string, colProfile: string, cos = 1): EaveCheck {
  const rp = getProfile(rafProfile), cp = getProfile(colProfile);
  const rr = boltClearR(prm.bolt.d);
  const d0 = prm.bolt.d + prm.bolt.clearance;
  const bolts: EaveBolt[] = [];
  for (const gy of grid(prm.cols, prm.gauge)) for (const px of grid(prm.rows, prm.pitch)) {
    const nutHit = Math.abs(gy) - rr < rp.props.b / 2;
    const headHit = Math.abs(px) * cos - rr < cp.props.h / 2 && Math.abs(gy) - rr < cp.props.b / 2;
    bolts.push({ gy, px, nutHit, headHit });
  }
  const coverOk = prm.w >= cp.props.b + 10 && prm.l * cos >= cp.props.h + 10;
  const e1 = prm.l / 2 - ((prm.rows - 1) / 2) * prm.pitch, e2 = prm.w / 2 - ((prm.cols - 1) / 2) * prm.gauge;
  const edgeOk = Math.min(e1, e2) >= 1.2 * d0 - 0.01;
  const messages: string[] = [];
  if (bolts.some((b) => b.nutHit)) messages.push(`אום מעל פלטת הקורה מתנגש באגף הקורה (רוחב אגף ${rp.props.b}) — נדרש מרווח רוחבי ≥ ${up5(rp.props.b + 2 * rr)}`);
  if (bolts.some((b) => b.headHit)) messages.push(`ראש בורג מתחת לפלטת העמוד בתוך היטל העמוד (${cp.props.h}×${cp.props.b})`);
  if (!coverOk) messages.push(`הפלטה אינה מכסה את חתך העמוד עם מקום לריתוך (נדרש ≥ ${up5(cp.props.b + 10)}×${up5((cp.props.h + 10) / cos)})`);
  if (!edgeOk) messages.push(`מרחק שפה ${Math.min(e1, e2).toFixed(0)} < 1.2·d0 = ${(1.2 * d0).toFixed(1)}`);
  return {
    ok: !messages.length, bolts, rr, coverOk, edgeOk, messages, cos,
    raf: { b: rp.props.b, h: rp.props.h, name: rp.name }, col: { b: cp.props.b, h: cp.props.h, name: cp.name },
  };
}

/**
 * הצעת מידות מזעריות (מעוגלות ל-5 מ"מ) לרשת 2×2: שתי חלופות — ברגים מחוץ לעמוד לרוחב או לאורך הקורה —
 * ונבחרת החלופה עם שטח הפלטה הקטן יותר.
 */
export function suggestEavePlate(prm: PlateConnParams, rafProfile: string, colProfile: string, cos = 1): Pick<PlateConnParams, 'w' | 'l' | 'gauge' | 'pitch' | 'cols' | 'rows'> {
  const rp = getProfile(rafProfile), cp = getProfile(colProfile);
  const rr = boltClearR(prm.bolt.d);
  const d0 = prm.bolt.d + prm.bolt.clearance;
  const e = up5(Math.max(1.5 * d0, 25));
  const pMin = up5(2.4 * d0);
  const gaugeNut = up5(rp.props.b + 2 * rr);
  // חלופה א: הראש מחוץ לעמוד לרוחב
  // הברגים מפוזרים לפינות הפלטה (לא צמודים זה לזה) — מרווח לפי כיסוי העמוד פחות מרחקי שפה
  const coverL = up5((cp.props.h + 10) / cos), coverW = up5(cp.props.b + 10);
  const gA = Math.max(gaugeNut, up5(cp.props.b + 2 * rr)), pA = Math.max(pMin, coverL - 2 * e);
  // חלופה ב: הראש מחוץ לעמוד לאורך הקורה
  const gB = Math.max(gaugeNut, coverW - 2 * e), pB = Math.max(pMin, up5((cp.props.h + 2 * rr) / cos));
  const size = (g: number, pp: number) => {
    const w = up5(Math.max(g + 2 * e, cp.props.b + 10));
    const l = up5(Math.max(pp + 2 * e, (cp.props.h + 10) / cos));
    return { w, l, g, pp, area: w * l };
  };
  const A = size(gA, pA), B = size(gB, pB);
  const best = A.area <= B.area ? A : B;
  return { w: best.w, l: best.l, gauge: best.g, pitch: best.pp, cols: 2, rows: 2 };
}
