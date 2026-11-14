import { tryProfile } from '../profiles/library';
import { MATERIALS } from '../profiles/materials';
import type { BuildingParams, ValidationIssue } from './types';

const E = (code: string, message: string, field?: string): ValidationIssue => ({ code, severity: 'error', message, field });
const W = (code: string, message: string, field?: string): ValidationIssue => ({ code, severity: 'warning', message, field });

/** שיפוע ימני נגזר בגג דו־שיפועי. */
export function derivedRoof(b: BuildingParams) {
  if (b.roofType === 'gable') {
    const sL = b.slopeLeftPct / 100;
    const ridgeZ = b.eaveLeft + sL * b.ridgeX;
    const sR = (ridgeZ - b.eaveRight) / (b.width - b.ridgeX);
    return { ridgeZ, slopeLeft: sL, slopeRight: sR };
  }
  const s = (b.eaveRight - b.eaveLeft) / b.width;
  return { ridgeZ: undefined, slopeLeft: s, slopeRight: s };
}

/**
 * ולידציה של פרמטרי המבנה. שגיאה (error) חוסמת יצירת גיאומטריה;
 * אזהרה (warning) מדווחת על ערך לא סביר אך מותר.
 */
export function validateBuilding(b: BuildingParams): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const num = (v: number, field: string, label: string) => {
    if (!Number.isFinite(v)) { out.push(E('NUM', `${label}: ערך לא מספרי`, field)); return false; }
    return true;
  };
  if (num(b.width, 'width', 'רוחב')) {
    if (b.width <= 0) out.push(E('WIDTH_POS', 'רוחב חייב להיות חיובי', 'width'));
    else if (b.width < 3000) out.push(W('WIDTH_SMALL', 'רוחב קטן מ-3 מ\' — לבדוק', 'width'));
    else if (b.width > 60000) out.push(W('WIDTH_LARGE', 'רוחב גדול מ-60 מ\' — לבדוק', 'width'));
  }
  for (const [f, label] of [['eaveLeft', 'גובה שמאל'], ['eaveRight', 'גובה ימין']] as const) {
    const v = b[f];
    if (!num(v, f, label)) continue;
    if (v <= b.baseElevation) out.push(E('HEIGHT_POS', `${label} חייב להיות מעל מפלס הבסיס`, f));
    else if (v - b.baseElevation > 20000) out.push(W('HEIGHT_LARGE', `${label} מעל 20 מ' — לבדוק`, f));
    else if (v - b.baseElevation < 2200) out.push(W('HEIGHT_SMALL', `${label} נמוך מ-2.2 מ' — לבדוק`, f));
  }
  for (const [f, label] of [['rafterOverhangLeft', 'קונזולה שמאלית'], ['rafterOverhangRight', 'קונזולה ימנית'],
    ['purlinOverhangStart', 'קונזולת פטות התחלה'], ['purlinOverhangEnd', 'קונזולת פטות סוף']] as const) {
    const v = b[f];
    if (!num(v, f, label)) continue;
    if (v < 0) out.push(E('OVERHANG_NEG', `${label} לא יכולה להיות שלילית`, f));
    else if (v > 3000) out.push(W('OVERHANG_LARGE', `${label} מעל 3 מ' — לבדוק`, f));
  }
  if (b.roofType === 'gable' && b.width > 0) {
    if (!(b.ridgeX > 0 && b.ridgeX < b.width)) out.push(E('RIDGE_RANGE', 'מיקום הרכס חייב להיות בין שני צירי העמודים', 'ridgeX'));
    if (!(b.slopeLeftPct > 0)) out.push(E('SLOPE_POS', 'שיפוע שמאל חייב להיות חיובי', 'slopeLeftPct'));
    if (out.every((i) => i.severity !== 'error')) {
      const r = derivedRoof(b);
      if (!(r.slopeRight > 0)) out.push(E('SLOPE_R', 'השיפוע הימני הנגזר אינו חיובי — הרכס נמוך מהגובה הימני', 'eaveRight'));
      for (const [s, label] of [[r.slopeLeft, 'שמאל'], [r.slopeRight, 'ימין']] as const) {
        if (s > 0 && s < 0.02) out.push(W('SLOPE_FLAT', `שיפוע ${label} קטן מ-2% — ניקוז לבדיקה`));
        if (s > 0.6) out.push(W('SLOPE_STEEP', `שיפוע ${label} מעל 60% — לבדוק`));
      }
    }
  }
  if (b.roofType === 'mono' && b.width > 0) {
    const s = Math.abs(b.eaveRight - b.eaveLeft) / b.width;
    if (s < 0.02) out.push(W('SLOPE_FLAT', 'שיפוע הגג החד־שיפועי קטן מ-2% — ניקוז לבדיקה'));
    if (s > 0.6) out.push(W('SLOPE_STEEP', 'שיפוע מעל 60% — לבדוק'));
  }
  // מסגרות
  if (b.frames.length < 2) out.push(E('FRAMES_MIN', 'נדרשות לפחות 2 מסגרות', 'frames'));
  const ids = new Set<string>();
  for (let i = 0; i < b.frames.length; i++) {
    const f = b.frames[i];
    if (ids.has(f.id)) out.push(E('FRAME_DUP', `מזהה מסגרת כפול: ${f.id}`, 'frames'));
    ids.add(f.id);
    if (!Number.isFinite(f.y)) out.push(E('NUM', `מיקום מסגרת ${i + 1} לא מספרי`, 'frames'));
    if (i > 0) {
      const s = f.y - b.frames[i - 1].y;
      if (s <= 0) out.push(E('FRAME_ORDER', `מסגרת ${i + 1} אינה אחרי מסגרת ${i} לאורך Y`, 'frames'));
      else if (s < 1000) out.push(W('FRAME_CLOSE', `מרווח ${s / 1000} מ' בין מסגרות ${i}–${i + 1} קטן מ-1 מ'`, 'frames'));
      else if (s > 12000) out.push(W('FRAME_FAR', `מרווח ${s / 1000} מ' בין מסגרות ${i}–${i + 1} גדול מ-12 מ'`, 'frames'));
    }
  }
  if (!tryProfile(b.columnProfile)) out.push(E('PROFILE', `חתך עמוד לא מוכר: ${b.columnProfile}`, 'columnProfile'));
  if (!tryProfile(b.rafterProfile)) out.push(E('PROFILE', `חתך קורה לא מוכר: ${b.rafterProfile}`, 'rafterProfile'));
  if (!MATERIALS.some((m) => m.id === b.material)) out.push(E('MATERIAL', `חומר לא מוכר: ${b.material}`, 'material'));
  return out;
}

export const hasErrors = (issues: ValidationIssue[]) => issues.some((i) => i.severity === 'error');
