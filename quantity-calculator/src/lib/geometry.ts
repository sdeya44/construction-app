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
