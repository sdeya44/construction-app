import { cross, dot, norm, rotateAxis, scale, sub, v3, type Vec3 } from '../core/vec';
import { degToRad } from '../core/units';
import type { Member } from '../model/types';

/** מערכת צירים מקומית של אלמנט: ex לאורך, v = כיוון גובה החתך, u = כיוון הרוחב. */
export interface LocalFrame { ex: Vec3; u: Vec3; v: Vec3; length: number }

export function localFrame(m: Pick<Member, 'start' | 'end' | 'refUp' | 'rollDeg' | 'mirror'>): LocalFrame {
  const d = sub(m.end, m.start);
  const length = Math.hypot(d.x, d.y, d.z);
  const ex = norm(d);
  let ref = m.refUp;
  if (Math.abs(dot(ref, ex)) > 0.999) ref = Math.abs(ex.z) > 0.9 ? v3(1, 0, 0) : v3(0, 0, 1);
  let v = norm(sub(ref, scale(ex, dot(ref, ex))));
  let u = norm(cross(v, ex));
  if (m.rollDeg) {
    const a = degToRad(m.rollDeg);
    v = rotateAxis(v, ex, a);
    u = rotateAxis(u, ex, a);
  }
  if (m.mirror) u = scale(u, -1);
  return { ex, u, v, length };
}
