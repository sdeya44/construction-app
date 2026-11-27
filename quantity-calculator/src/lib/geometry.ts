// ============================================================================
// פונקציות גאומטריות למדידה מתוך התוכנית
// העבודה היא במערכת קואורדינטות של "פיקסלים מקוריים" של התמונה/העמוד,
// כך שזום ו-pan אינם משפיעים על המדידה.
// ============================================================================

export interface Point {
  x: number;
  y: number;
}

/** מרחק אוקלידי בין שתי נקודות (בפיקסלים) */
export function dist(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** אורך פוליליין - סכום המקטעים (בפיקסלים) */
export function polylineLength(points: Point[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) len += dist(points[i - 1], points[i]);
  return len;
}

/** שטח פוליגון בעזרת נוסחת שרוך הנעל (Shoelace), בפיקסלים² */
export function polygonArea(points: Point[]): number {
  const n = points.length;
  if (n < 3) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** המרת אורך בפיקסלים למטרים לפי קנה מידה */
export function pixelsToMeters(pixels: number, pixelsPerMeter: number): number {
  if (!pixelsPerMeter) return 0;
  return pixels / pixelsPerMeter;
}

/** המרת שטח בפיקסלים² למ״ר */
export function pixelAreaToM2(pixelArea: number, pixelsPerMeter: number): number {
  if (!pixelsPerMeter) return 0;
  return pixelArea / (pixelsPerMeter * pixelsPerMeter);
}

/** מרכז מסה (centroid) של פוליגון */
export function polygonCentroid(points: Point[]): Point {
  const n = points.length;
  if (n === 0) return { x: 0, y: 0 };
  if (n < 3) {
    const sx = points.reduce((a, p) => a + p.x, 0) / n;
    const sy = points.reduce((a, p) => a + p.y, 0) / n;
    return { x: sx, y: sy };
  }
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const cross = a.x * b.y - b.x * a.y;
    area += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  area /= 2;
  if (area === 0) {
    const sx = points.reduce((a, p) => a + p.x, 0) / n;
    const sy = points.reduce((a, p) => a + p.y, 0) / n;
    return { x: sx, y: sy };
  }
  return { x: cx / (6 * area), y: cy / (6 * area) };
}

/** האם נקודה נמצאת בתוך פוליגון (ray casting) */
export function pointInPolygon(p: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect = yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
