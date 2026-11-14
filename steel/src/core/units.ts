/**
 * שכבת יחידות יחידה.
 * יחידת האורך הפנימית של המודל היא מילימטר (mm). כל ערך אורך במודל הוא mm.
 * המרות מטר/מילימטר מתבצעות רק כאן. שיפוע נשמר כיחס (rise/run), זוויות ברדיאנים.
 */
export type Mm = number;
export type LengthUnit = 'mm' | 'm';

export const MM_PER: Record<LengthUnit, number> = { mm: 1, m: 1000 };

export function toMm(value: number, unit: LengthUnit): Mm {
  if (!Number.isFinite(value)) throw new RangeError(`ערך אורך לא תקין: ${value}`);
  return value * MM_PER[unit];
}

export function fromMm(mm: Mm, unit: LengthUnit): number {
  return mm / MM_PER[unit];
}

/** עיגול לרזולוציה מספרית של המודל (0.001 מ"מ) כדי לייצב השוואות ושמירה. */
export function roundMm(mm: Mm): Mm {
  return Math.round(mm * 1000) / 1000;
}

export function formatLength(mm: Mm, unit: LengthUnit, decimals?: number): string {
  const d = decimals ?? (unit === 'm' ? 3 : 0);
  return fromMm(mm, unit).toFixed(d);
}

/** שיפוע באחוזים ↔ יחס. */
export const pctToRatio = (pct: number) => pct / 100;
export const ratioToPct = (r: number) => r * 100;
export const ratioToDeg = (r: number) => (Math.atan(r) * 180) / Math.PI;
export const degToRad = (d: number) => (d * Math.PI) / 180;
export const radToDeg = (r: number) => (r * 180) / Math.PI;

/** צפיפות פלדה ק"ג/מ"ק, ומשקל למטר מתוך שטח במ"מ². */
export function kgPerMeter(areaMm2: number, densityKgM3: number): number {
  return (areaMm2 / 1e6) * densityKgM3;
}
