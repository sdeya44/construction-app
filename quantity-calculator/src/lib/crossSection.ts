// ============================================================================
// חישוב כמויות חפירה/מילוי בחתכים — Average End Area
// קואורדינטות הקנבס: ציר X משמאל לימין, ציר Y מלמעלה למטה (y גדול = נמוך יותר).
// חפירה = הפרופיל המתוכנן מתחת לקיים. מילוי = המתוכנן מעל הקיים.
// ============================================================================

import type { CrossSection, CSPoint } from '../types';

export const CS_W = 340; // רוחב קנבס פנימי (px)
export const CS_H = 210; // גובה קנבס פנימי (px)

export const CS_COLORS = {
  existing: '#2a3441', // פרופיל קיים — קו כהה
  proposed: '#1f5fb0', // פרופיל מתוכנן — כחול
  cut: 'rgba(192,57,43,0.40)', // חפירה = אדום
  fill: 'rgba(31,95,176,0.32)', // מילוי = כחול
  cutStroke: '#c0392b',
  fillStroke: '#1f5fb0',
};

function sortX(pts: CSPoint[]): CSPoint[] {
  return [...pts].sort((a, b) => a.x - b.x);
}

/** אינטרפולציה לינארית של y בנקודה x מתוך פוליליין ממוין */
function interpY(pts: CSPoint[], x: number): number | null {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (x >= a.x && x <= b.x) {
      if (b.x === a.x) return a.y;
      const t = (x - a.x) / (b.x - a.x);
      return a.y + t * (b.y - a.y);
    }
  }
  return null;
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export interface SectionAreas {
  cut: number; // מ״ר
  fill: number; // מ״ר
}

/** מחשב שטחי חפירה/מילוי (מ״ר) לחתך לפי קנה המידה */
export function sectionAreas(sec: CrossSection, scaleW: number, scaleH: number): SectionAreas {
  const ex = sortX(sec.existing || []);
  const pr = sortX(sec.proposed || []);
  if (ex.length < 2 || pr.length < 2) return { cut: 0, fill: 0 };

  const pxPerMx = CS_W / scaleW;
  const pxPerMy = CS_H / scaleH;

  const xMin = Math.max(ex[0].x, pr[0].x);
  const xMax = Math.min(ex[ex.length - 1].x, pr[pr.length - 1].x);
  if (xMax <= xMin) return { cut: 0, fill: 0 };

  const N = 240;
  const dxPx = (xMax - xMin) / N;
  const dxM = dxPx / pxPerMx;

  let cut = 0;
  let fill = 0;
  for (let i = 0; i < N; i++) {
    const x = xMin + dxPx * (i + 0.5); // אמצע המקטע
    const ye = interpY(ex, x);
    const yp = interpY(pr, x);
    if (ye == null || yp == null) continue;
    const diffM = (yp - ye) / pxPerMy; // חיובי => מתוכנן מתחת לקיים => חפירה
    if (diffM > 0) cut += diffM * dxM;
    else fill += -diffM * dxM;
  }
  return { cut: round2(cut), fill: round2(fill) };
}

export interface SpanVolume {
  from: CrossSection;
  to: CrossSection;
  a1: SectionAreas;
  a2: SectionAreas;
  L: number;
  vCut: number; // מ״ק
  vFill: number; // מ״ק
}

export interface VolumeResult {
  rows: Array<{ sec: CrossSection; areas: SectionAreas }>;
  spans: SpanVolume[];
  totCut: number;
  totFill: number;
}

/** נפחים בין חתכים עוקבים בשיטת שטח קצה ממוצע: V = (A1+A2)/2 × L */
export function computeVolumes(sections: CrossSection[], scaleW: number, scaleH: number): VolumeResult {
  const rows = sections.map((sec) => ({ sec, areas: sectionAreas(sec, scaleW, scaleH) }));
  const spans: SpanVolume[] = [];
  let totCut = 0;
  let totFill = 0;
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i];
    const b = rows[i + 1];
    const L = +a.sec.dist || 0;
    const vCut = round2(((a.areas.cut + b.areas.cut) / 2) * L);
    const vFill = round2(((a.areas.fill + b.areas.fill) / 2) * L);
    totCut += vCut;
    totFill += vFill;
    spans.push({ from: a.sec, to: b.sec, a1: a.areas, a2: b.areas, L, vCut, vFill });
  }
  return { rows, spans, totCut: round2(totCut), totFill: round2(totFill) };
}

/** מצייר חתך על קנבס (משמש גם בעורך וגם בייצוא) */
export function drawSection(
  canvas: HTMLCanvasElement,
  sec: CrossSection,
  scaleW: number,
  scaleH: number,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, CS_W, CS_H);
  ctx.fillStyle = '#fbfbf8';
  ctx.fillRect(0, 0, CS_W, CS_H);

  const pxPerMx = CS_W / scaleW;
  const pxPerMy = CS_H / scaleH;

  // רשת
  ctx.strokeStyle = 'rgba(26,23,20,0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let m = 0; m <= scaleW; m += 1) {
    const x = m * pxPerMx;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, CS_H);
  }
  for (let m = 0; m <= scaleH; m += 1) {
    const y = m * pxPerMy;
    ctx.moveTo(0, y);
    ctx.lineTo(CS_W, y);
  }
  ctx.stroke();

  const ex = sortX(sec.existing || []);
  const pr = sortX(sec.proposed || []);

  // הצללת אזורי חפירה/מילוי
  if (ex.length >= 2 && pr.length >= 2) {
    const xMin = Math.max(ex[0].x, pr[0].x);
    const xMax = Math.min(ex[ex.length - 1].x, pr[pr.length - 1].x);
    for (let x = xMin; x <= xMax; x += 2) {
      const ye = interpY(ex, x);
      const yp = interpY(pr, x);
      if (ye == null || yp == null) continue;
      ctx.strokeStyle = yp > ye ? CS_COLORS.cut : CS_COLORS.fill;
      ctx.beginPath();
      ctx.moveTo(x, ye);
      ctx.lineTo(x, yp);
      ctx.stroke();
    }
  }

  drawPolyline(ctx, ex, CS_COLORS.existing, false);
  drawPolyline(ctx, pr, CS_COLORS.proposed, true);
}

function drawPolyline(
  ctx: CanvasRenderingContext2D,
  pts: CSPoint[],
  color: string,
  dashed: boolean,
): void {
  if (!pts.length) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  if (dashed) ctx.setLineDash([5, 4]);
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = color;
  pts.forEach((p) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}
