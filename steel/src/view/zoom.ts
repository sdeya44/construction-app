/** מהירות זום בגלגלת (1.66): ברירת מחדל 3× (OrbitControls המקורי = 1, איטי במבנה גדול); נשמרת בדפדפן. */
const KEY = 'ksp.zoomSpeed';
export const ZOOM_MIN = 0.5, ZOOM_MAX = 8, ZOOM_DEFAULT = 3;
const clamp = (v: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v));
export function zoomSpeed(): number {
  try { const v = Number(localStorage.getItem(KEY)); return v ? clamp(v) : ZOOM_DEFAULT; } catch { return ZOOM_DEFAULT; }
}
export function setZoomSpeed(v: number): number {
  const z = clamp(v);
  try { localStorage.setItem(KEY, String(z)); } catch { /* מצב פרטי — רק לסשן */ }
  window.dispatchEvent(new CustomEvent('ksp-zoom', { detail: z }));
  return z;
}
