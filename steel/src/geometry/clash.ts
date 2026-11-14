import { dot, sub, type Plane, type Vec3 } from '../core/vec';
import { getProfile } from '../profiles/library';
import type { P2 } from '../profiles/section';
import type { Member } from '../model/types';
import { localFrame } from './frame';
import { memberSolid } from './solid';

const EPS = 0.05; // mm — מגע (0 מ"מ) אינו התנגשות

function pointInPoly(p: P2, poly: P2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.v > p.v) !== (b.v > p.v) && p.u < ((b.u - a.u) * (p.v - a.v)) / (b.v - a.v) + a.u) inside = !inside;
  }
  return inside;
}
function distToPoly(p: P2, poly: P2[]): number {
  let d = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i];
    const ab = { u: b.u - a.u, v: b.v - a.v };
    const t = Math.max(0, Math.min(1, ((p.u - a.u) * ab.u + (p.v - a.v) * ab.v) / (ab.u * ab.u + ab.v * ab.v || 1)));
    d = Math.min(d, Math.hypot(p.u - (a.u + ab.u * t), p.v - (a.v + ab.v * t)));
  }
  return d;
}

/** בודק נקודה בתוך פריזמה (אלמנט) — מדויק לאקסטרוזיה עם חיתוכי קצה מישוריים. */
export class PrismTester {
  private f; private du; private dv; private outer; private holes; private sp: Plane; private ep: Plane;
  constructor(public m: Member) {
    const prof = getProfile(m.profile);
    const s = memberSolid(m);
    this.f = localFrame(m); this.du = s.du; this.dv = s.dv;
    this.outer = prof.outline.outer; this.holes = prof.outline.holes;
    this.sp = m.startCut ?? { point: m.start, normal: this.f.ex };
    this.ep = m.endCut ?? { point: m.end, normal: this.f.ex };
  }
  /** עומק חדירה מוערך (mm) אם הנקודה בפנים, אחרת 0 */
  depth(P: Vec3): number {
    const sgnS = Math.sign(dot(this.f.ex, this.sp.normal)) || 1;
    const sgnE = Math.sign(dot(this.f.ex, this.ep.normal)) || 1;
    const a = dot(sub(P, this.sp.point), this.sp.normal) * sgnS;
    const b = -dot(sub(P, this.ep.point), this.ep.normal) * sgnE;
    if (a <= EPS || b <= EPS) return 0;
    const r = sub(P, this.m.start);
    const q = { u: dot(r, this.f.u) - this.du, v: dot(r, this.f.v) - this.dv };
    if (!pointInPoly(q, this.outer)) return 0;
    if (this.holes.some((h) => pointInPoly(q, h))) return 0;
    let d = distToPoly(q, this.outer);
    for (const h of this.holes) d = Math.min(d, distToPoly(q, h));
    if (d <= EPS) return 0;
    return Math.min(d, a, b);
  }
}

/** נקודות דגימה של מוצק: קודקודים, אמצעי צלעות ונקודות לאורך הצלעות האורכיות. */
function samples(m: Member): Vec3[] {
  const s = memberSolid(m);
  const pts: Vec3[] = [];
  const n = s.startRing.length;
  for (let i = 0; i < n; i++) {
    const a = s.startRing[i], b = s.endRing[i], c = s.startRing[(i + 1) % n], e = s.endRing[(i + 1) % n];
    pts.push(a, b);
    for (let j = 1; j < 4; j++) { pts.push(lerp(a, c, j / 4), lerp(b, e, j / 4)); }
    for (let k = 1; k < 12; k++) pts.push(lerp(a, b, k / 12), lerp(mid(a, c), mid(b, e), k / 12));
  }
  return pts;
}
const mid = (a: Vec3, b: Vec3) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });
const lerp = (a: Vec3, b: Vec3, t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });

export interface Clash { a: string; b: string; depth: number }

const testerCache = new WeakMap<Member, PrismTester>();
const tester = (m: Member) => { let t = testerCache.get(m); if (!t) { t = new PrismTester(m); testerCache.set(m, t); } return t; };
const sampleCache = new WeakMap<Member, Vec3[]>();
const samp = (m: Member) => { let t = sampleCache.get(m); if (!t) { t = samples(m); sampleCache.set(m, t); } return t; };

/** נקודות מצופפות לאורך צלעות פוליגון. */
function densify(poly: P2[], n = 12): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    for (let k = 0; k < n; k++) out.push({ u: a.u + ((b.u - a.u) * k) / n, v: a.v + ((b.v - a.v) * k) / n });
  }
  return out;
}

function depth2D(q: P2, outer: P2[], holes: P2[][]): number {
  if (!pointInPoly(q, outer) || holes.some((h) => pointInPoly(q, h))) return 0;
  let d = distToPoly(q, outer);
  for (const h of holes) d = Math.min(d, distToPoly(q, h));
  return d > EPS ? d : 0;
}

/**
 * אלמנטים מקבילים (למשל זוויתן ופטה): בדיקה מדויקת בחתך המשותף —
 * חפיפה לאורך הציר + חיתוך פוליגונים דו־ממדי. מניח חיתוכי קצה ניצבים (כמו בפטות ותומכים).
 */
function clashParallel(a: Member, b: Member): number {
  const sa = memberSolid(a), sb = memberSolid(b);
  const fa = localFrame(a);
  const ax = (pts: Vec3[]) => pts.map((p) => dot(sub(p, a.start), fa.ex));
  const ia = ax([...sa.startRing, ...sa.endRing]), ib = ax([...sb.startRing, ...sb.endRing]);
  const ov = Math.min(Math.max(...ia), Math.max(...ib)) - Math.max(Math.min(...ia), Math.min(...ib));
  if (ov <= EPS) return 0;
  const to2 = (p: Vec3): P2 => { const r = sub(p, a.start); return { u: dot(r, fa.u), v: dot(r, fa.v) }; };
  const pa = getProfile(a.profile).outline, pb = getProfile(b.profile).outline;
  const polyA = (r: P2[]) => r.map((q) => ({ u: q.u + sa.du, v: q.v + sa.dv }));
  const Aout = polyA(pa.outer), Aholes = pa.holes.map(polyA);
  const Bout = sb.startRing.map(to2);
  // חורים של B במערכת A: מחושבים מהמסגרת של B
  const fb = localFrame(b);
  const bPt = (q: P2) => to2({ x: b.start.x + fb.u.x * (q.u + sb.du) + fb.v.x * (q.v + sb.dv), y: b.start.y + fb.u.y * (q.u + sb.du) + fb.v.y * (q.v + sb.dv), z: b.start.z + fb.u.z * (q.u + sb.du) + fb.v.z * (q.v + sb.dv) });
  const Bholes = pb.holes.map((h) => h.map(bPt));
  let d = 0;
  for (const q of densify(Bout)) d = Math.max(d, depth2D(q, Aout, Aholes));
  for (const q of densify(Aout)) d = Math.max(d, depth2D(q, Bout, Bholes));
  return d > 0 ? Math.min(d, ov) : 0;
}

/** בדיקת התנגשות בין שני אלמנטים. מגע 0 מ"מ אינו התנגשות. */
export function clash(a: Member, b: Member): Clash | null {
  const fa = localFrame(a), fb = localFrame(b);
  if (Math.abs(dot(fa.ex, fb.ex)) > 0.99999 && !a.startCut && !a.endCut && !b.startCut && !b.endCut) {
    const d = clashParallel(a, b);
    return d > 0.1 ? { a: a.id, b: b.id, depth: d } : null;
  }
  let depth = 0;
  const ta = tester(a), tb = tester(b);
  for (const p of samp(a)) depth = Math.max(depth, tb.depth(p));
  for (const p of samp(b)) depth = Math.max(depth, ta.depth(p));
  return depth > 0.1 ? { a: a.id, b: b.id, depth } : null;
}

/** תיבה חוסמת של מוצק (לסינון מהיר). */
export function aabb(m: Member): { min: Vec3; max: Vec3 } {
  const s = memberSolid(m);
  const pts = [...s.startRing, ...s.endRing];
  return {
    min: { x: Math.min(...pts.map((p) => p.x)), y: Math.min(...pts.map((p) => p.y)), z: Math.min(...pts.map((p) => p.z)) },
    max: { x: Math.max(...pts.map((p) => p.x)), y: Math.max(...pts.map((p) => p.y)), z: Math.max(...pts.map((p) => p.z)) },
  };
}
export function aabbOverlap(a: { min: Vec3; max: Vec3 }, b: { min: Vec3; max: Vec3 }, eps = 0.05): boolean {
  return a.min.x < b.max.x - eps && a.max.x > b.min.x + eps && a.min.y < b.max.y - eps && a.max.y > b.min.y + eps && a.min.z < b.max.z - eps && a.max.z > b.min.z + eps;
}
