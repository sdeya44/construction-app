import { ShapeUtils, Vector2 } from 'three';
import { add, linePlaneT, scale, type Plane, type Vec3 } from '../core/vec';
import { getProfile } from '../profiles/library';
import type { P2 } from '../profiles/section';
import type { Member } from '../model/types';
import { localFrame } from './frame';
import { webCenterU } from './purlins';

export interface Solid {
  /** משולשים (לא ממופתחים): 9 מספרים למשולש, בקואורדינטות עולם mm */
  tris: number[];
  /** קטעי קווים לקווי מתאר: 6 מספרים לקטע */
  edges: number[];
  /** קודקודי קצה הפרופיל בתחילה ובסוף (לנקודות הצמדה) */
  startRing: Vec3[];
  endRing: Vec3[];
  /** היסט החתך ביחס לקו הייחוס (u, v) */
  du: number;
  dv: number;
}

/**
 * מוצק של אלמנט: אקסטרוזיה של חתך לאורך קו הייחוס, עם חיתוכי קצה מישוריים מדויקים.
 * כל קודקוד של החתך מוקרן לאורך ציר האלמנט אל מישור החיתוך — חיתוך מישורי מדויק לפריזמה.
 */
export function memberSolid(m: Member): Solid {
  const prof = getProfile(m.profile);
  const f = localFrame(m);
  const vTop = Math.max(...prof.outline.outer.map((p) => p.v));
  const vBot = Math.min(...prof.outline.outer.map((p) => p.v));
  // top: פני עליון על הקו · purlin: פני תחתון על הקו וציר הווב על הקו (מגע 0 מ"מ עם האגף העליון של הקורה)
  const uMin = Math.min(...prof.outline.outer.map((p) => p.u));
  const dv = m.anchor === 'top' ? -vTop : m.anchor === 'purlin' || m.anchor === 'corner' ? -vBot : 0;
  const du = m.anchor === 'purlin' ? -webCenterU(m.profile) : m.anchor === 'corner' ? -uMin : 0;

  const startPlane: Plane = m.startCut ?? { point: m.start, normal: f.ex };
  const endPlane: Plane = m.endCut ?? { point: m.end, normal: f.ex };

  const place = (p: P2, base: Vec3, plane: Plane): Vec3 => {
    const q = add(base, add(scale(f.u, p.u + du), scale(f.v, p.v + dv)));
    const t = linePlaneT(q, f.ex, plane);
    return t === null ? q : add(q, scale(f.ex, t));
  };

  const rings = [prof.outline.outer, ...prof.outline.holes];
  const S = rings.map((r) => r.map((p) => place(p, m.start, startPlane)));
  const E = rings.map((r) => r.map((p) => place(p, m.end, endPlane)));

  const tris: number[] = [];
  const pushTri = (a: Vec3, b: Vec3, c: Vec3) => tris.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  // צדדים
  rings.forEach((r, ri) => {
    const n = r.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      pushTri(S[ri][i], S[ri][j], E[ri][j]);
      pushTri(S[ri][i], E[ri][j], E[ri][i]);
    }
  });
  // מכסים
  const contour = prof.outline.outer.map((p) => new Vector2(p.u, p.v));
  const holes = prof.outline.holes.map((h) => h.map((p) => new Vector2(p.u, p.v)));
  const faces = ShapeUtils.triangulateShape(contour, holes);
  const flat = (arr: Vec3[][]) => arr.flat();
  const sFlat = flat(S), eFlat = flat(E);
  for (const [a, b, c] of faces) {
    pushTri(sFlat[a], sFlat[c], sFlat[b]);
    pushTri(eFlat[a], eFlat[b], eFlat[c]);
  }
  // קווי מתאר: טבעות קצה + קווים לאורך בפינות חדות בלבד
  const edges: number[] = [];
  const seg = (a: Vec3, b: Vec3) => edges.push(a.x, a.y, a.z, b.x, b.y, b.z);
  rings.forEach((r, ri) => {
    const n = r.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      seg(S[ri][i], S[ri][j]);
      seg(E[ri][i], E[ri][j]);
      if (isSharp(r, i)) seg(S[ri][i], E[ri][i]);
    }
  });
  return { tris, edges, startRing: S[0], endRing: E[0], du, dv };
}

function isSharp(r: P2[], i: number): boolean {
  const n = r.length;
  const a = r[(i - 1 + n) % n], b = r[i], c = r[(i + 1) % n];
  const d1 = Math.atan2(b.v - a.v, b.u - a.u), d2 = Math.atan2(c.v - b.v, c.u - b.u);
  let d = Math.abs(d2 - d1);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return d > (35 * Math.PI) / 180;
}

/** אורך חיתוך מעשי: האורך המרבי של האלמנט לאחר חיתוכי הקצה (על פני הקודקודים). */
export function cutLength(m: Member): { max: number; min: number } {
  const s = memberSolid(m);
  const f = localFrame(m);
  let max = 0, min = Infinity;
  for (let i = 0; i < s.startRing.length; i++) {
    const d = s.endRing[i], a = s.startRing[i];
    const l = (d.x - a.x) * f.ex.x + (d.y - a.y) * f.ex.y + (d.z - a.z) * f.ex.z;
    max = Math.max(max, l); min = Math.min(min, l);
  }
  return { max, min };
}
