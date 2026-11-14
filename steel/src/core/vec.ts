/** וקטור תלת־ממדי במערכת עולמית: X רוחב, Y אורך, Z גובה (Z חיובי = מעלה). יחידות mm. */
export interface Vec3 { x: number; y: number; z: number }

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const len = (a: Vec3) => Math.sqrt(dot(a, a));
export const dist = (a: Vec3, b: Vec3) => len(sub(a, b));
export function norm(a: Vec3): Vec3 {
  const l = len(a);
  if (l < 1e-12) throw new RangeError('וקטור באורך אפס');
  return scale(a, 1 / l);
}
export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => add(a, scale(sub(b, a), t));
export const eq = (a: Vec3, b: Vec3, tol = 1e-6) => dist(a, b) <= tol;

/** סיבוב וקטור v סביב ציר יחידה k בזווית ang (Rodrigues). */
export function rotateAxis(v: Vec3, k: Vec3, ang: number): Vec3 {
  const c = Math.cos(ang), s = Math.sin(ang);
  return add(add(scale(v, c), scale(cross(k, v), s)), scale(k, dot(k, v) * (1 - c)));
}

export interface Plane { point: Vec3; normal: Vec3 }

/** חיתוך קו (p + t·d) עם מישור. מחזיר t, או null אם הקו מקביל למישור. */
export function linePlaneT(p: Vec3, d: Vec3, plane: Plane): number | null {
  const den = dot(d, plane.normal);
  if (Math.abs(den) < 1e-12) return null;
  return dot(sub(plane.point, p), plane.normal) / den;
}
