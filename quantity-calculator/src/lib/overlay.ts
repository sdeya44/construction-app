// ============================================================================
// צבעי סימון משותפים + יצירת תצלום חתוך (crop) של אזור המדידה
// משמש גם את השכבה החיה על התוכנית וגם את התצלום שנשמר עם השורה.
// ============================================================================

import type { AnnotationShape } from '../types';
import type { Point } from './geometry';

export interface OverlayColor {
  stroke: string;
  fill: string;
  dot: string;
}

/** צבע הסימון לפי סוג המדידה / האם זו הפחתה */
export function overlayColor(shape: AnnotationShape, isDeduction: boolean): OverlayColor {
  if (isDeduction) return { stroke: '#c0392b', fill: 'rgba(192,57,43,0.22)', dot: '#c0392b' };
  if (shape === 'count') return { stroke: '#16a34a', fill: 'rgba(22,160,74,0.20)', dot: '#16a34a' };
  return { stroke: '#1f5fb0', fill: 'rgba(31,95,176,0.18)', dot: '#1f5fb0' };
}

/** ממפה CalcType -> צורת סימון */
export function shapeForType(type: string): AnnotationShape {
  if (type === 'measured_area') return 'area';
  if (type === 'count') return 'count';
  return 'length';
}

const MAX_CROP_SIDE = 720; // תקרת רזולוציה לתצלום, לשמירת נפח סביר

/**
 * חותך את אזור המדידה מתמונת התוכנית ומצייר עליו את הסימון.
 * points בקואורדינטות התמונה הטבעיות. מחזיר dataURL (JPEG) או undefined.
 */
export function makeCrop(
  img: HTMLImageElement,
  points: Point[],
  shape: AnnotationShape,
  isDeduction: boolean,
): string | undefined {
  if (!img || !img.naturalWidth || points.length === 0) return undefined;

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  let minX = Math.min(...xs);
  let maxX = Math.max(...xs);
  let minY = Math.min(...ys);
  let maxY = Math.max(...ys);

  // ריווח סביב האזור הנמדד כדי שיהיה הקשר ברור בתוכנית
  const pad = Math.max(30, (maxX - minX) * 0.18, (maxY - minY) * 0.18);
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(img.naturalWidth, maxX + pad);
  maxY = Math.min(img.naturalHeight, maxY + pad);

  const w = maxX - minX;
  const h = maxY - minY;
  if (w < 8 || h < 8) return undefined;

  const scale = Math.min(1, MAX_CROP_SIDE / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cw, ch);
  // חיתוך מהתמונה המקורית (drawImage עם מלבן מקור)
  ctx.drawImage(img, minX, minY, w, h, 0, 0, cw, ch);

  // ציור הסימון על גבי החיתוך
  const c = overlayColor(shape, isDeduction);
  const tp = points.map((p) => ({ x: (p.x - minX) * scale, y: (p.y - minY) * scale }));
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = c.stroke;
  ctx.fillStyle = c.fill;

  if (shape === 'area' && tp.length >= 3) {
    ctx.beginPath();
    ctx.moveTo(tp[0].x, tp[0].y);
    tp.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (shape === 'length' && tp.length >= 2) {
    ctx.beginPath();
    ctx.moveTo(tp[0].x, tp[0].y);
    tp.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
    ctx.stroke();
  }

  // נקודות
  ctx.fillStyle = c.dot;
  tp.forEach((p) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fill();
  });

  if (shape === 'count') {
    ctx.fillStyle = c.dot;
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    tp.forEach((p, i) => ctx.fillText(String(i + 1), p.x, p.y - 7));
  }

  return canvas.toDataURL('image/jpeg', 0.85);
}
