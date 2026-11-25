/**
 * ביקורת גיאומטריה במנוע CAD מלא (OpenCascade דרך replicad).
 *
 * המודול לא מייבא את המנוע: מקבל אותו מבחוץ (K = { R, oc }), כדי שהתוכנה עצמה לא תגדל.
 * כרגע משמש בבדיקות הפיתוח בלבד; בהמשך ישמש גם את "שרטוט מדויק" שיוריד את המנוע לפי דרישה.
 *
 * כל אלמנט נבנה כגוף מוצק: אקסטרוזיה של החתך + חיתוכי קצה מישוריים + קידוח כל חורי הברגים / החורים החופשיים.
 * הבדיקות:
 *   1. גוף תקין טופולוגית ובדיוק גוף אחד.
 *   2. נפח הגוף (לפני קידוח) תואם לנפח הרשת של מנוע הגיאומטריה שלנו.
 *   3. כל חור מסיר חומר בפועל מהחלק שהוא שייך אליו.
 *   4. כל ריתוך: שני החלקים נוגעים (מרווח ≤ WELD_GAP_MAX) ואין חדירת נפח ביניהם.
 *   5. בתוך כל חיבור: אין חדירת נפח בין שני חלקים כלשהם.
 */
import type { Connection, DerivedModel, Member } from '../model/types';
import { localFrame } from '../geometry/frame';
import { getProfile } from '../profiles/library';
import { webCenterU } from '../geometry/purlins';
import { cachedSolidPure } from '../drawing/solidCache';

/** מרווח מקסימלי (מ"מ) בין שני חלקים מרותכים. ריתוך פינה מגשר על מרווח קטן (למשל מוט עיגון Ø20 בחור Ø22 = 1 מ"מ). */
export const WELD_GAP_MAX = 2;
/** סף חדירת נפח (מ"מ³) — מתחתיו נחשב רעש נומרי */
export const OVERLAP_TOL = 1;
/** סטייה יחסית מותרת בין נפח CAD לנפח הרשת */
export const VOLUME_TOL = 0.002;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface CadKernel { R: any; oc: any }

type V = [number, number, number];
const P = (v: { x: number; y: number; z: number }): V => [v.x, v.y, v.z];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V, s: number): V => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** חור לקידוח באלמנט: מבורג (holesIn) או חור חופשי של חיבור */
export interface CadHole { id: string; memberId: string; p: V; axis: V; d: number; len: number }

export function holesOf(d: DerivedModel): Map<string, CadHole[]> {
  const out = new Map<string, CadHole[]>();
  const push = (h: CadHole) => { const a = out.get(h.memberId) ?? []; a.push(h); out.set(h.memberId, a); };
  for (const c of d.connections) {
    for (const b of c.bolts) for (const mid of b.holesIn ?? []) {
      // הגוף של הבורג: מהראש לאורך הציר; החור משתרע על כל אורך הבורג + שוליים
      const len = Math.max(b.length ?? 0, b.grip ?? 0, 30) + 60;
      push({ id: b.id, memberId: mid, p: add(P(b.p), mul(P(b.axis), -30)), axis: P(b.axis), d: b.hole, len });
    }
    for (const h of c.holes ?? []) push({ id: h.id, memberId: h.memberId, p: add(P(h.p), mul(P(h.axis), -200)), axis: P(h.axis), d: h.d, len: 400 });
  }
  return out;
}

/** נפח רשת סגורה (משולשים) — מנוע הגיאומטריה שלנו */
export function meshVolume(tris: number[]): number {
  let v = 0;
  for (let i = 0; i < tris.length; i += 9) {
    const ax = tris[i]!, ay = tris[i + 1]!, az = tris[i + 2]!, bx = tris[i + 3]!, by = tris[i + 4]!, bz = tris[i + 5]!, cx = tris[i + 6]!, cy = tris[i + 7]!, cz = tris[i + 8]!;
    v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return Math.abs(v);
}

function prism(K: CadKernel, poly: number[][], depth: number, origin: V, x: V, z: V) {
  let pen = K.R.draw(poly[0]);
  for (const p of poly.slice(1)) pen = pen.lineTo(p);
  const plane = new K.R.Plane(origin, x, z);
  try { return pen.close().sketchOnPlane(plane).extrude(depth); } finally { plane.delete?.(); }
}

function replace<T extends { delete(): void }>(old: T, next: T): T { old.delete(); return next; }

/** גוף מוצק של אלמנט ללא חורים (חתך + חיתוכי קצה), באותה הגדרת מיקום כמו memberSolid */
export function memberShape(K: CadKernel, m: Member) {
  const prof = getProfile(m.profile);
  const f = localFrame(m);
  const ex = P(f.ex), u = P(f.u), v = P(f.v);
  if (m.contour && m.contour.length >= 3 && prof.family === 'PL') {
    const t = prof.dims.t;
    const sgn = dot(cross(v, ex), u) > 0 ? 1 : -1;
    return prism(K, m.contour.map((q) => [q.s, sgn * q.u]), t, add(P(m.start), mul(v, -t / 2)), ex, v);
  }
  const outer = prof.outline.outer;
  const vTop = Math.max(...outer.map((q) => q.v)), vBot = Math.min(...outer.map((q) => q.v)), uMin = Math.min(...outer.map((q) => q.u));
  const dv = m.anchor === 'top' ? -vTop : m.anchor === 'purlin' || m.anchor === 'corner' ? -vBot : 0;
  const du = m.anchor === 'purlin' ? -webCenterU(m.profile) : m.anchor === 'corner' ? -uMin : 0;
  // הארכה לשני הצדדים — חיתוכי הקצה המשופעים קובעים את הגבול האמיתי
  const ext = Math.max(...outer.map((q) => Math.hypot(q.u, q.v)), 100) * 6 + 200;
  const origin = add(P(m.start), add(mul(ex, -ext), add(mul(u, du), mul(v, dv))));
  const hand = dot(cross(ex, u), v) > 0 ? 1 : -1;
  const conv = (r: { u: number; v: number }[]) => r.map((q) => [q.u, hand * q.v]);
  let shape = prism(K, conv(outer), f.length + 2 * ext, origin, u, ex);
  for (const h of prof.outline.holes) {
    const tool = prism(K, conv(h), f.length + 2 * ext + 2, add(origin, mul(ex, -1)), u, ex);
    shape = replace(shape, shape.cut(tool)); tool.delete();
  }
  for (const [which, other] of [['start', 'end'], ['end', 'start']] as const) {
    const cut = (which === 'start' ? m.startCut : m.endCut) ?? { point: m[which], normal: f.ex };
    const n = P(cut.normal), p0 = P(cut.point);
    const keep = dot(add(P(m[other]), mul(p0, -1)), n) > 0 ? 'positive' : 'negative';
    const plane = new K.R.Plane(p0, Math.abs(n[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0], n);
    const next = shape.cutPlane(plane, 0, keep);
    plane.delete?.();
    if (!next) { shape.delete(); throw Error('חיתוך קצה מחק את כל החלק'); }
    shape = replace(shape, next);
  }
  return shape;
}

/**
 * חומר שמוסר מאלמנט בייצור ואינו חלק ממוצק המודל:
 *  - חריץ בפרופיל חלול (RHS/SHS/CHS) לפח/לשונית שנכנסים דרך הקצה — כמו בשרטוט החלק: רוחב עובי הפח + 1, עומק כניסה + 2;
 *  - תפר חיבור המשך: האלמנט מפוצל בייצור בין שתי פלטות ההמשך.
 */
export function removedRegions(m: Member, d: DerivedModel): { t0: number; t1: number; u0: number; u1: number; v0: number; v1: number }[] {
  const f = localFrame(m);
  const loc = (q: { x: number; y: number; z: number }) => { const r = { x: q.x - m.start.x, y: q.y - m.start.y, z: q.z - m.start.z }; return { t: r.x * f.ex.x + r.y * f.ex.y + r.z * f.ex.z, u: r.x * f.u.x + r.y * f.u.y + r.z * f.u.z, v: r.x * f.v.x + r.y * f.v.y + r.z * f.v.z }; };
  const own = cachedSolidPure(m), ring = [...own.startRing, ...own.endRing].map(loc);
  const ut0 = Math.min(...ring.map((q) => q.u)), ut1 = Math.max(...ring.map((q) => q.u)), vt0 = Math.min(...ring.map((q) => q.v)), vt1 = Math.max(...ring.map((q) => q.v));
  const tE0 = Math.min(...ring.map((q) => q.t)), tE1 = Math.max(...ring.map((q) => q.t));
  const BIG = 1e4, out: ReturnType<typeof removedRegions> = [];
  const conns = d.connections.filter((c) => c.parts.includes(m.id) || c.members.includes(m.id));
  const fam = getProfile(m.profile).family;
  if (['RHS', 'SHS', 'CHS'].includes(fam)) {
    for (const pm of d.members.filter((x) => x.kind === 'plate' && conns.some((c) => c.parts.includes(x.id)))) {
      const q = [...cachedSolidPure(pm).startRing, ...cachedSolidPure(pm).endRing].map(loc);
      const t0 = Math.min(...q.map((x) => x.t)), t1 = Math.max(...q.map((x) => x.t));
      const u0 = Math.min(...q.map((x) => x.u)), u1 = Math.max(...q.map((x) => x.u)), v0 = Math.min(...q.map((x) => x.v)), v1 = Math.max(...q.map((x) => x.v));
      const fromStart = t0 < tE0 + 1 && t1 > tE0 + 5, fromEnd = t1 > tE1 - 1 && t0 < tE1 - 5;
      if (!fromStart && !fromEnd) continue;
      const tt0 = fromStart ? -BIG : t0 - 2, tt1 = fromStart ? t1 + 2 : BIG;
      if (v1 - v0 >= vt1 - vt0 - 1 && u1 - u0 < (ut1 - ut0) / 2) out.push({ t0: tt0, t1: tt1, u0: u0 - 0.5, u1: u1 + 0.5, v0: -BIG, v1: BIG });
      else if (u1 - u0 >= ut1 - ut0 - 1 && v1 - v0 < (vt1 - vt0) / 2) out.push({ t0: tt0, t1: tt1, u0: -BIG, u1: BIG, v0: v0 - 0.5, v1: v1 + 0.5 });
    }
  }
  for (const c of conns.filter((x) => x.type === 'beam-splice' && x.members.includes(m.id))) {
    const ps = c.parts.filter((id) => /\.PL[12]$/.test(id)).map((id) => d.byId.get(id)).filter(Boolean) as Member[];
    if (ps.length < 2) continue;
    const ts = ps.flatMap((pm) => [...cachedSolidPure(pm).startRing, ...cachedSolidPure(pm).endRing].map((q) => loc(q).t));
    out.push({ t0: Math.min(...ts), t1: Math.max(...ts), u0: -BIG, u1: BIG, v0: -BIG, v1: BIG });
  }
  return out;
}

export interface PartRow { id: string; kind: string; profile: string; valid: boolean; solids: number; volume: number; meshVolume: number; holes: number; /** גופים צפויים: 1 + מספר תפרי חיבור המשך */ pieces: number; error?: string }
export interface HoleRow { id: string; memberId: string; removed: number }
export interface PairRow { conn: string; a: string; b: string; dist: number; overlap: number; weld?: string }
export interface CadAuditResult { parts: PartRow[]; holes: HoleRow[]; welds: PairRow[]; clashes: PairRow[] }

/** תיבה חוסמת מהרשת שלנו — סינון מוקדם לבדיקת חדירה */
function box(m: Member) {
  const t = cachedSolidPure(m).tris;
  const lo: V = [Infinity, Infinity, Infinity], hi: V = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < t.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k]!, t[i + k]!); hi[k] = Math.max(hi[k]!, t[i + k]!); }
  return { lo, hi };
}
const boxesTouch = (a: ReturnType<typeof box>, b: ReturnType<typeof box>, gap: number) => [0, 1, 2].every((k) => a.lo[k]! <= b.hi[k]! + gap && b.lo[k]! <= a.hi[k]! + gap);

/**
 * ביקורת לחיבורים נבחרים: בונה את כל האלמנטים והחלקים שלהם, קודח, ובודק ריתוכים וחדירות.
 * conns — החיבורים לבדיקה (ברירת מחדל: כולם).
 */
export function cadAudit(K: CadKernel, d: DerivedModel, conns: Connection[] = d.connections): CadAuditResult {
  const holes = holesOf(d);
  const ids = new Set(conns.flatMap((c) => [...c.members, ...c.parts]));
  const shapes = new Map<string, any>(); // eslint-disable-line @typescript-eslint/no-explicit-any
  const res: CadAuditResult = { parts: [], holes: [], welds: [], clashes: [] };
  try {
    for (const id of ids) {
      const m = d.byId.get(id);
      if (!m) continue; // ברגים אינם אלמנטים
      const row: PartRow = { id, kind: m.kind, profile: m.profile, valid: false, solids: 0, volume: 0, meshVolume: meshVolume(cachedSolidPure(m).tris), holes: 0, pieces: 1 + d.connections.filter((c) => c.type === 'beam-splice' && c.members.includes(id)).length };
      res.parts.push(row);
      try {
        let s = memberShape(K, m);
        row.volume = K.R.measureVolume(s);
        const f = localFrame(m);
        for (const r of removedRegions(m, d)) {
          const at = (t: number, uu: number, vv: number): V => [m.start.x + f.ex.x * t + f.u.x * uu + f.v.x * vv, m.start.y + f.ex.y * t + f.u.y * uu + f.v.y * vv, m.start.z + f.ex.z * t + f.u.z * uu + f.v.z * vv];
          const lim = 1e5, t0 = Math.max(r.t0, -lim), t1 = Math.min(r.t1, lim);
          const hand = dot(cross(P(f.u), P(f.v)), P(f.ex)) > 0 ? 1 : -1;
          const tool = prism(K, [[r.u0, hand * r.v0], [r.u1, hand * r.v0], [r.u1, hand * r.v1], [r.u0, hand * r.v1]].map(([a, b]) => [Math.max(-lim, Math.min(lim, a!)), Math.max(-lim, Math.min(lim, b!))]), t1 - t0, at(t0, 0, 0), P(f.u), P(f.ex));
          s = replace(s, s.cut(tool)); tool.delete();
        }
        for (const h of holes.get(id) ?? []) {
          const tool = K.R.makeCylinder(h.d / 2, h.len, h.p, h.axis);
          const before = K.R.measureVolume(s);
          s = replace(s, s.cut(tool)); tool.delete();
          res.holes.push({ id: h.id, memberId: id, removed: before - K.R.measureVolume(s) });
          row.holes++;
        }
        const an = new K.oc.BRepCheck_Analyzer(s.wrapped, true, false);
        row.valid = an.IsValid(); an.delete();
        const sol = s.solids; row.solids = sol.length; sol.forEach((x: { delete?: () => void }) => x.delete?.());
        shapes.set(id, s);
      } catch (e) { row.error = String((e as Error).message ?? e); }
    }
    const pair = (conn: string, a: string, b: string, weld?: string): PairRow | null => {
      const x = shapes.get(a), y = shapes.get(b);
      if (!x || !y) return null;
      const ds = new K.oc.BRepExtrema_DistShapeShape();
      ds.LoadS1(x.wrapped); ds.LoadS2(y.wrapped);
      ds.Perform(new K.oc.Message_ProgressRange());
      const dist = ds.IsDone() ? ds.Value() : NaN; ds.delete();
      let overlap = 0;
      if (dist < 1e-6) { const c = x.intersect(y); overlap = K.R.measureVolume(c); c.delete(); }
      return { conn, a, b, dist, overlap, ...(weld ? { weld } : {}) };
    };
    for (const c of conns) {
      for (const w of c.welds) { const r = pair(c.id, w.between[0], w.between[1], w.id); if (r) res.welds.push(r); }
      const welded = new Set(c.welds.map((w) => [...w.between].sort().join('|')));
      const solids = [...new Set([...c.members, ...c.parts])].filter((id) => shapes.has(id));
      const bx = new Map(solids.map((id) => [id, box(d.byId.get(id)!)]));
      for (let i = 0; i < solids.length; i++) for (let j = i + 1; j < solids.length; j++) {
        const a = solids[i]!, b = solids[j]!;
        if (welded.has([a, b].sort().join('|')) || !boxesTouch(bx.get(a)!, bx.get(b)!, 0.01)) continue;
        const r = pair(c.id, a, b);
        if (r && r.overlap > OVERLAP_TOL) res.clashes.push(r);
      }
    }
  } finally { for (const s of shapes.values()) try { s.delete(); } catch { /* כבר שוחרר */ } }
  return res;
}

/** ממצאים בעברית מתוצאת הביקורת */
export function cadFindings(r: CadAuditResult): string[] {
  const out: string[] = [];
  for (const p of r.parts) {
    if (p.error) { out.push(`${p.id}: לא נבנה גוף — ${p.error}`); continue; }
    if (!p.valid || p.solids !== p.pieces) out.push(`${p.id}: גוף לא תקין (${p.solids} גופים, צפוי ${p.pieces})`);
    const rel = Math.abs(p.volume - p.meshVolume) / Math.max(p.meshVolume, 1e-9);
    if (rel > VOLUME_TOL) out.push(`${p.id} ${p.profile}: נפח CAD ${p.volume.toFixed(0)} מול רשת ${p.meshVolume.toFixed(0)} (${(rel * 100).toFixed(2)}%)`);
  }
  for (const h of r.holes) if (h.removed < 1e-3) out.push(`חור ${h.id} אינו חותך חומר ב-${h.memberId}`);
  for (const w of r.welds) {
    if (!(w.dist <= WELD_GAP_MAX)) out.push(`ריתוך ${w.weld}: אין מגע בין ${w.a} ל-${w.b} (מרווח ${w.dist.toFixed(1)} מ"מ)`);
    if (w.overlap > OVERLAP_TOL) out.push(`ריתוך ${w.weld}: ${w.a} חודר ל-${w.b} (${w.overlap.toFixed(0)} מ"מ³)`);
  }
  for (const c of r.clashes) out.push(`חיבור ${c.conn}: ${c.a} חודר ל-${c.b} (${c.overlap.toFixed(0)} מ"מ³)`);
  return out;
}
