// ============================================================================
// מנוע החישוב - לב המערכת
// כל חישוב מחזיר גם את הכמות וגם נוסחה קריאה לביקורת הנדסית.
// ============================================================================

import type { CalcRow } from '../types';

const PI = Math.PI;

/** עיגול מספר לתצוגה (עד 3 ספרות אחרי הנקודה, ללא אפסים מיותרים) */
export function fmt(n: number, digits = 3): string {
  if (!isFinite(n)) return '0';
  const rounded = Number(n.toFixed(digits));
  return rounded.toLocaleString('he-IL', { maximumFractionDigits: digits });
}

/** עיגול הכמות הסופית */
export function round(n: number, digits = 3): number {
  return Number((n ?? 0).toFixed(digits));
}

interface ComputeResult {
  quantity: number; // כמות סופית (כולל סימן הפחתה)
  formula: string; // נוסחה מוצגת לביקורת
  base: number; // ערך הבסיס לפני מקדם וכמות יחידות
}

const num = (v: number | null | undefined) => (typeof v === 'number' && isFinite(v) ? v : 0);

/**
 * מחשב שורת חישוב: מחזיר כמות ונוסחה קריאה.
 * הנוסחה מציגה את נתוני הקלט, הביטוי המתמטי והתוצאה - לצורך ביקורת.
 */
export function computeRow(row: CalcRow): ComputeResult {
  const L = num(row.length);
  const W = num(row.width);
  const H = num(row.height);
  const units = num(row.count) || 1;
  const coef = num(row.coefficient) || 1;

  let base = 0;
  let baseExpr = '';

  switch (row.type) {
    case 'length':
      base = L;
      baseExpr = `${fmt(L)}`;
      break;
    case 'rect_area':
      base = L * W;
      baseExpr = `${fmt(L)} × ${fmt(W)}`;
      break;
    case 'triangle_area':
      base = (L * W) / 2;
      baseExpr = `${fmt(L)} × ${fmt(W)} / 2`;
      break;
    case 'trapezoid_area':
      base = ((L + W) * H) / 2;
      baseExpr = `(${fmt(L)} + ${fmt(W)}) × ${fmt(H)} / 2`;
      break;
    case 'circle_area':
      base = PI * L * L;
      baseExpr = `π × ${fmt(L)}²`;
      break;
    case 'box_volume':
      base = L * W * H;
      baseExpr = `${fmt(L)} × ${fmt(W)} × ${fmt(H)}`;
      break;
    case 'cylinder_volume':
      base = PI * L * L * H;
      baseExpr = `π × ${fmt(L)}² × ${fmt(H)}`;
      break;
    case 'count':
      // ספירה: הכמות היא מספר היחידות עצמו
      base = 1;
      baseExpr = '';
      break;
    case 'measured_length':
      base = num(row.measuredValue);
      baseExpr = `${fmt(base)} (נמדד)`;
      break;
    case 'measured_area':
      base = num(row.measuredValue);
      if (row.measuredGross != null && row.measuredDeductions && row.measuredDeductions.length > 0) {
        // שטח ברוטו פחות ניכויים (cut-out)
        baseExpr = `${fmt(row.measuredGross)} - ${row.measuredDeductions.map((d) => fmt(d)).join(' - ')}`;
      } else {
        baseExpr = `${fmt(base)} (נמדד)`;
      }
      break;
  }

  // בניית הביטוי המלא עם כמות יחידות ומקדם
  const parts: string[] = [];
  if (row.type === 'count') {
    parts.push(fmt(units));
  } else {
    if (baseExpr) parts.push(baseExpr.includes(' ') && needsParens(row) ? `(${baseExpr})` : baseExpr);
    if (units !== 1) parts.push(`× ${fmt(units)}`);
  }
  if (coef !== 1) parts.push(`× ${fmt(coef)}`);

  let quantity = row.type === 'count' ? units * coef : base * units * coef;

  // הפחתה - הכמות שלילית
  if (row.kind === 'deduction') {
    quantity = -Math.abs(quantity);
  }

  const expr = parts.join(' ');
  const sign = row.kind === 'deduction' ? '-' : '';
  const formula = expr ? `${expr} = ${sign}${fmt(Math.abs(quantity))}` : `${sign}${fmt(Math.abs(quantity))}`;

  return { quantity: round(quantity), formula, base: round(base) };
}

// כשמכפילים בכמות יחידות/מקדם נוסיף סוגריים לביטוי בסיס מורכב
function needsParens(row: CalcRow): boolean {
  const hasMult = (num(row.count) || 1) !== 1 || (num(row.coefficient) || 1) !== 1;
  const complex = ['triangle_area', 'trapezoid_area', 'circle_area'].includes(row.type);
  return hasMult && complex;
}

/** סיכומי סעיף / יחידה */
export interface SectionSummary {
  sectionId: string | null;
  total: number; // סך נטו
  additions: number; // סך תוספות
  deductions: number; // סך הפחתות (ערך מוחלט)
  rowCount: number;
  unit: string;
}

/** מחשב סיכום לכל סעיף */
export function summarizeBySection(rows: CalcRow[]): Map<string | null, SectionSummary> {
  const map = new Map<string | null, SectionSummary>();
  for (const row of rows) {
    const { quantity } = computeRow(row);
    const key = row.sectionId;
    let s = map.get(key);
    if (!s) {
      s = { sectionId: key, total: 0, additions: 0, deductions: 0, rowCount: 0, unit: row.unit };
      map.set(key, s);
    }
    s.total += quantity;
    if (quantity < 0) s.deductions += Math.abs(quantity);
    else s.additions += quantity;
    s.rowCount += 1;
  }
  for (const s of map.values()) {
    s.total = round(s.total);
    s.additions = round(s.additions);
    s.deductions = round(s.deductions);
  }
  return map;
}

/** סיכום כללי */
export function grandTotals(rows: CalcRow[]) {
  let additions = 0;
  let deductions = 0;
  for (const row of rows) {
    const { quantity } = computeRow(row);
    if (quantity < 0) deductions += Math.abs(quantity);
    else additions += quantity;
  }
  return {
    additions: round(additions),
    deductions: round(deductions),
    net: round(additions - deductions),
    rowCount: rows.length,
  };
}
