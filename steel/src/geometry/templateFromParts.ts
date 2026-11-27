import { add, cross, dot, len, norm, rotateAxis, scale, sub, type Vec3 } from '../core/vec';
import { tryProfile } from '../profiles/library';
import type { BoltInfo, Connection, CustomDetail, DetailOp, Member } from '../model/types';
import { blankDetail, buildDetail, findSite, parseSiteKey, platePoly, siteKey, type Frame, type Site } from './detail';
import { localFrame } from './frame';

/**
 * "הפוך לתבנית" (גישה ב', שלב 1): היסק פרט (`CustomDetail`) מפלטות חופשיות במודל — בהשראת Tekla Custom Component.
 * הבעיה הפוכה: מגיאומטריה (מיקום, כיוון, מתאר, חורים) מסיקים פעולות `plate` + `holes` והפניה (`DetailRef`: פנים + היסט)
 * ביחס למסגרת האתר. פונקציה טהורה — אינה משנה את המנוע; משתמשת ב-`buildDetail(...).frame` כדי לקבל את מסגרות הפנים.
 *
 * אי-יחידות: אותה פלטה אפשר לתאר בכמה דרכים (פנים שונות, flat/stand, סיבוב). נבחר המועמד הטוב ביותר לפי דירוג:
 * מגע בפנים (|off| ≤ 0.5), זווית "נקייה" (כפולה של 90°), פנים "ציר" (axis) רק כמוצא אחרון, קרבה למרכז הפנים (|along|+|across|+|off|, מעוגל למ"מ), עדיפות פנים (פלטה קודמת ← מארח ← קצה האלמנט ← דפנות).
 * בטיחות: כל תוצאה מאומתת הלוך-חזור — הפרט נבנה מחדש על אותו אתר ומושווה לפלטות ולחורים של המקור; בלי התאמה — אין פרט.
 *
 * מחוץ לשלב 1 (בכוונה): ברגים (שלב 2), ריתוכים וחיתוך קצה האלמנט (שלב 3). חורים נרשמים כפעולת `holes` — לפי המנוע
 * הם נראים במודל רק כשיש עליהם `bolts` (ראו `tests/templatefromparts.test.ts`, האימות משתמש בברגי בדיקה זמניים).
 */

/** סטיית מידה מרבית (מ"מ) להלוך-חזור: פלטות וחורים */
export const TFP_TOL = 0.3;
const CONTACT = 0.5;
/** אלמנטים מבניים שהחיבור יושב על הקצה שלהם (גם פרט שהוא "חלק" של החיבור, כמו אלכסון ברך) */
const STRUCT = new Set(['column', 'rafter', 'beam', 'purlin', 'girt', 'brace']);

export interface TemplateInfo { plate: string; op: string; ref: string; mode: 'flat' | 'stand'; spin: number; off: number; shape: string; contact: boolean }
export interface TemplateResult {
  /** הפרט שהוסק; null = אין (ראו `errors`) */
  detail: CustomDetail | null;
  /** מפתח האתר שעליו הפרט נבנה והוצג כזהה למקור */
  siteKey?: string;
  errors: string[];
  warnings: string[];
  infos: TemplateInfo[];
  /** סטייה מרבית (מ"מ) בהלוך-חזור: פלטות, חורים */
  dev?: { plates: number; holes: number };
}

export interface PartsModel { members: Member[]; connections: Connection[] }

// ---------- גיאומטריית פלטה במודל ----------

export interface SrcPlate {
  id: string; m: Member; Z: Vec3; t: number;
  /** מתאר במישור האמצע (עולמי), בלי קודקודים כפולים/קוליניאריים — כולל חיתוך קצה אם יש */
  poly: Vec3[];
  /** מתאר להתאמת צורה: המלבן לפני חיתוך הקצה (הפעולה `clipHost` חותכת אותו בבנייה) */
  fitPoly: Vec3[];
  /** חיתוך קצה יחיד במישור (פלטה מלבנית) */
  cut?: { plane: { point: Vec3; normal: Vec3 } };
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const S = (x: number) => { const v = r2(x); return String(Object.is(v, -0) ? 0 : v); };

function simplify(poly: Vec3[]): Vec3[] {
  let p = poly.filter((q, i) => len(sub(q, poly[(i + poly.length - 1) % poly.length])) > 0.01);
  for (let ch = true; ch && p.length > 3;) {
    ch = false;
    for (let i = 0; i < p.length; i++) {
      const a = p[(i + p.length - 1) % p.length], b = p[i], c = p[(i + 1) % p.length];
      const ab = sub(b, a), bc = sub(c, b);
      if (len(cross(ab, bc)) <= 1e-4 * len(ab) * len(bc)) { p = p.filter((_, j) => j !== i); ch = true; break; }
    }
  }
  return p;
}

/** מתאר פלטת מודל (מישור האמצע). מחזיר טקסט שגיאה כשהפלטה לא נתמכת */
export function plateOutline(m: Member): Omit<SrcPlate, 'id'> | string {
  if (m.kind !== 'plate') return 'החלק שנבחר אינו פלטה';
  if (m.snip) return 'לפלטה יש קיטום (snip) — לא נתמך עדיין בהסקה';
  if (m.startCut && m.endCut) return 'לפלטה יש חיתוך בשני הקצוות — לא נתמך עדיין בהסקה';
  if ((m.startCut || m.endCut) && m.contour && m.contour.length >= 3) return 'לפלטה בצורה חופשית יש חיתוך קצה — לא נתמך עדיין בהסקה';
  const prof = tryProfile(m.profile);
  if (!prof || prof.family !== 'PL') return 'חתך הפלטה אינו PL';
  const f = localFrame(m), t = prof.dims.t;
  let pts: Vec3[];
  const W = (s: number, u: number) => add(add(m.start, scale(f.ex, s)), scale(f.u, u));
  if (m.contour && m.contour.length >= 3) pts = m.contour.map((p) => W(p.s, p.u));
  else {
    const us = prof.outline.outer.map((p) => p.u), u0 = Math.min(...us), u1 = Math.max(...us);
    pts = [W(0, u0), W(f.length, u0), W(f.length, u1), W(0, u1)];
  }
  const fitPoly = simplify(pts);
  if (fitPoly.length < 3) return 'מתאר הפלטה מנוון';
  const cp = m.startCut ?? m.endCut;
  if (!cp) return { m, Z: f.v, t, poly: fitPoly, fitPoly };
  // חיתוך קצה מישורי (כמו מוצק האלמנט): כל קודקוד בקצה זז לאורך ציר הפלטה אל מישור החיתוך
  const k = dot(f.ex, cp.normal);
  if (Math.abs(k) < 0.05) return 'מישור חיתוך הקצה מקביל לציר הפלטה';
  const atEnd = !!m.endCut, cut = pts.map((p, i) => {
    const onEnd = i === 1 || i === 2;
    return onEnd === atEnd ? add(p, scale(f.ex, dot(sub(cp.point, p), cp.normal) / k)) : p;
  });
  return { m, Z: f.v, t, poly: simplify(cut), fitPoly, cut: { plane: cp } };
}

/** שני מתארים זהים (קבוצות קודקודים, בלי תלות בסדר) בסטייה מרבית `tol`; מחזיר את הסטייה או Infinity */
export function polyDev(a: Vec3[], b: Vec3[]): number {
  const A = simplify(a), B = simplify(b);
  if (A.length !== B.length) return Infinity;
  const one = (P: Vec3[], Q: Vec3[]) => Math.max(...P.map((p) => Math.min(...Q.map((q) => len(sub(p, q))))));
  return Math.max(one(A, B), one(B, A));
}

// ---------- התאמת צורה ----------

type Shape = { shape: 'rect' | 'cham' | 'tri' | 'rtri'; ch: number; corners: [boolean, boolean, boolean, boolean] };
const same2 = (a: [number, number][], b: [number, number][]) => a.length === b.length && a.every((p) => b.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.15)) && b.every((q) => a.some((p) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.15));

function matchShape(pts: [number, number][], w: number, h: number): Shape | null {
  const no: [boolean, boolean, boolean, boolean] = [false, false, false, false];
  if (pts.length === 4 && same2(pts, platePoly('rect', w, h, 0, no))) return { shape: 'rect', ch: 0, corners: no };
  if (pts.length === 3) for (const sh of ['tri', 'rtri'] as const) if (same2(pts, platePoly(sh, w, h, 0, no))) return { shape: sh, ch: 0, corners: no };
  if (pts.length > 4 && pts.length <= 8) {
    const need = pts.length - 4, lens = new Set<number>();
    // אורך הקיטום ch = מרחק קודקוד מקצה התיבה (W-|x| או H-|y|) או אלכסון/√2
    const add2 = (x: number) => { if (x > 0.05) lens.add(Math.round(x * 100) / 100); };
    pts.forEach((p, i) => { const q = pts[(i + 1) % pts.length]; add2(w / 2 - Math.abs(p[0])); add2(h / 2 - Math.abs(p[1])); add2(Math.hypot(p[0] - q[0], p[1] - q[1]) / Math.SQRT2); });
    for (const ch of lens) for (let mask = 1; mask < 16; mask++) {
      const co: [boolean, boolean, boolean, boolean] = [!!(mask & 1), !!(mask & 2), !!(mask & 4), !!(mask & 8)];
      if (co.filter(Boolean).length !== need || ch >= Math.min(w, h) - 2) continue;
      if (same2(pts, platePoly('cham', w, h, ch, co))) return { shape: 'cham', ch, corners: co };
    }
  }
  return null;
}

// ---------- מועמדי הצבה ----------

interface Cand {
  on: string; face: string; mode: 'flat' | 'stand'; spin: number; along: number; across: number; off: number;
  w: number; h: number; t: number; sh: Shape; score: number[];
}

const SITE_FACES: [string, string, number][] = [
  ['host', 'hit', 1], ['host', 'opp', 2], ['main', 'end', 3], ['main', 'a+', 4], ['main', 'a-', 4], ['main', 'w+', 4], ['main', 'w-', 4], ['host', 'web', 5],
  ['main', 'axis', 6], ['main', 'axis-', 6], ['main', 'axisA', 6], ['main', 'axisA-', 6],
];

const angOf = (e1: Vec3, d: Vec3, n: Vec3) => Math.atan2(dot(cross(e1, d), n), dot(e1, d));

function candidatesFor(src: SrcPlate, fr: Frame, on: string, face: string, prio: number): Cand[] {
  const out: Cand[] = [];
  const { n, e1, hand } = fr; const e2 = fr.e2;
  if (Math.abs(dot(e1, n)) > 1e-6) return out;
  const pos = (c: Vec3) => sub(c, fr.base);
  const FP = src.fitPoly;
  const edges = FP.map((p, i) => norm(sub(FP[(i + 1) % FP.length], p)));
  const fit = (mode: 'flat' | 'stand', Y: Vec3, X: Vec3) => {
    const O = FP[0];
    const xy = FP.map((p) => [dot(sub(p, O), X), dot(sub(p, O), Y)] as [number, number]);
    const x0 = Math.min(...xy.map((p) => p[0])), x1 = Math.max(...xy.map((p) => p[0])), y0 = Math.min(...xy.map((p) => p[1])), y1 = Math.max(...xy.map((p) => p[1]));
    const w = x1 - x0, h = y1 - y0, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const sh = matchShape(xy.map(([x, y]) => [x - cx, y - cy] as [number, number]), w, h);
    if (!sh || w < 1 || h < 1) return;
    const C = add(add(O, scale(X, cx)), scale(Y, cy)), pp = pos(C);
    const phi = angOf(e1, Y, n), spin = phi * 180 / Math.PI * hand;
    const dn = dot(pp, n), off = mode === 'flat' ? dn - src.t / 2 : dn - w / 2;
    const sp = ((spin % 360) + 540) % 360 - 180, clean = Math.abs(sp / 90 - Math.round(sp / 90)) * 90 < 0.05;
    const al = dot(pp, e1), ac = dot(pp, e2);
    out.push({ on, face, mode, spin: clean ? Math.round(sp / 90) * 90 : sp, along: al, across: ac, off, w, h, t: src.t, sh,
      score: [Math.abs(off) <= CONTACT ? 0 : 1, clean ? 0 : 1, face.startsWith('axis') ? 1 : 0, Math.round(Math.abs(al) + Math.abs(ac) + Math.abs(off)), prio, Math.abs(Math.round(sp / 90))] });
  };
  if (Math.abs(dot(src.Z, n)) > 1 - 1e-4) {
    // flat: הפלטה מונחת על הפנים; Y מיושר לכיוון אחת הצלעות (+ סיבובי 90°)
    const seen: number[] = [];
    for (const d of edges) {
      const phi = angOf(e1, d, n);
      for (let k = 0; k < 4; k++) {
        const a = phi + k * Math.PI / 2, key = ((a % (2 * Math.PI)) + 4 * Math.PI) % (2 * Math.PI);
        if (seen.some((q) => Math.abs(q - key) < 1e-4 || Math.abs(q - key) > 2 * Math.PI - 1e-4)) continue;
        seen.push(key);
        const Y = rotateAxis(e1, n, a), X = scale(cross(n, Y), hand);
        fit('flat', Y, X);
      }
    }
  } else if (Math.abs(dot(src.Z, n)) < 1e-4) {
    // stand: הרוחב לאורך נורמל הפנים, הגובה במישור הפנים
    const Y0 = norm(cross(src.Z, n));
    for (const sg of [1, -1]) { const Y = scale(Y0, sg); fit('stand', Y, n); }
  }
  return out;
}

const cmp = (a: number[], b: number[]) => { for (let i = 0; i < Math.min(a.length, b.length); i++) if (Math.abs(a[i] - b[i]) > 1e-9) return a[i] - b[i]; return 0; };

const plateOp = (id: string, name: string, c: Cand): DetailOp => ({
  k: 'plate', id, name, ref: { on: c.on, face: c.face, along: S(c.along), across: S(c.across) }, mode: c.mode, spin: S(c.spin), off: S(c.off),
  shape: c.sh.shape, w: S(c.w), h: S(c.h), t: S(c.t), ch: S(c.sh.ch), corners: c.sh.corners,
});

// ---------- חורים ----------

interface SrcHole { pt: Vec3; axis: Vec3; d: number }

function holesThrough(model: PartsModel, src: SrcPlate): SrcHole[] {
  const out: SrcHole[] = [];
  const add1 = (p: Vec3, axis: Vec3, d: number) => {
    const k = dot(axis, src.Z);
    if (Math.abs(k) < 0.5) return;
    const s = dot(sub(src.m.start, p), src.Z) / k;
    const pt = add(p, scale(axis, s));
    // החור חייב ליפול בתוך מתאר הפלטה (בדיקה גסה: בתוך תיבת התוחם)
    out.push({ pt, axis: norm(axis), d });
  };
  for (const c of model.connections) {
    for (const b of c.bolts as BoltInfo[]) if (b.holesIn.includes(src.id)) add1(b.p, b.axis, b.hole);
    for (const h of c.holes ?? []) if (h.memberId === src.id) add1(h.p, h.axis, h.d);
  }
  // כפילויות (אותו חור שמופיע גם בבורג וגם ברשימת חורים)
  return out.filter((h, i) => !out.slice(0, i).some((q) => len(sub(q.pt, h.pt)) < 0.05 && Math.abs(dot(q.axis, h.axis)) > 0.99));
}

const clusterVals = (v: number[], tol = 0.05) => { const s = [...v].sort((a, b) => a - b), out: number[][] = []; for (const x of s) { const g = out[out.length - 1]; if (g && x - g[g.length - 1] <= tol) g.push(x); else out.push([x]); } return out.map((g) => g.reduce((a, b) => a + b, 0) / g.length); };
const uniform = (v: number[], tol = 0.1) => v.length < 3 || v.slice(2).every((x, i) => Math.abs(x - v[i + 1] - (v[1] - v[0])) <= tol);

type HGroup = { rows: number; cols: number; py: number; px: number; along: number; across: number; ring?: boolean };

/** מפרק נקודות (along, across) לקבוצות: רשת מלאה ← היקף ← שורות ← יחידים */
export function groupHoles(pts: [number, number][]): HGroup[] {
  if (!pts.length) return [];
  const A = clusterVals(pts.map((p) => p[0])), B = clusterVals(pts.map((p) => p[1]));
  const at = (a: number, b: number) => pts.some((p) => Math.abs(p[0] - a) < 0.1 && Math.abs(p[1] - b) < 0.1);
  const mk = (rows: number[], cols: number[], ring = false): HGroup => ({ rows: rows.length, cols: cols.length, py: rows.length > 1 ? rows[1] - rows[0] : 0, px: cols.length > 1 ? cols[1] - cols[0] : 0, along: (rows[0] + rows[rows.length - 1]) / 2, across: (cols[0] + cols[cols.length - 1]) / 2, ...(ring ? { ring: true } : {}) });
  if (uniform(A) && uniform(B)) {
    if (A.length * B.length === pts.length && A.every((a) => B.every((b) => at(a, b)))) return [mk(A, B)];
    if (A.length >= 3 && B.length >= 3 && 2 * (A.length + B.length) - 4 === pts.length && A.every((a, i) => B.every((b, j) => (i === 0 || i === A.length - 1 || j === 0 || j === B.length - 1) === at(a, b)))) return [mk(A, B, true)];
  }
  const out: HGroup[] = [];
  for (const a of A) {
    const cols = clusterVals(pts.filter((p) => Math.abs(p[0] - a) < 0.1).map((p) => p[1]));
    if (uniform(cols)) out.push(mk([a], cols));
    else for (const b of cols) out.push(mk([a], [b]));
  }
  return out;
}

// ---------- הסקה ----------

const nameOf = (m: Member) => (m.partDesc ?? m.label ?? '').replace(/\s*PL\d.*$/, '').trim() || 'פלטה';

/** מנסה להסיק פרט על אתר אחד. מחזיר פרט + סטיות, או סיבת כשל */
function inferOnSite(model: PartsModel, site: Site, srcs: SrcPlate[], id: string, name: string): { det?: CustomDetail; infos: TemplateInfo[]; warnings: string[]; dev?: { plates: number; holes: number }; err?: string } {
  let det: CustomDetail = { ...blankDetail(name), id, name, vars: [], ops: [] };
  const infos: TemplateInfo[] = [], warnings: string[] = [], remaining = [...srcs], placed: { src: SrcPlate; opId: string }[] = [];
  let k = 0;
  while (remaining.length) {
    const res = buildDetail(site, det);
    let best: { i: number; c: Cand } | null = null;
    remaining.forEach((src, i) => {
      const refs: [string, string, number][] = [...placed.flatMap((p) => [[p.opId, 'z+', 0], [p.opId, 'z-', 0]] as [string, string, number][]), ...SITE_FACES];
      for (const [on, face, prio] of refs) {
        const fr = res.frame({ on, face });
        if (!fr) continue;
        for (const c of candidatesFor(src, fr, on, face, prio)) if (!best || cmp(c.score, best.c.score) < 0) best = { i, c };
      }
    });
    if (!best) return { infos, warnings, err: `לא נמצאו פנים באתר שעליהן אפשר לתאר את הפלטה ${remaining[0].id} (צורה לא נתמכת או כיוון לא ישר ביחס לפנים)` };
    const { i, c } = best as { i: number; c: Cand };
    const src = remaining.splice(i, 1)[0], opId = `P${++k}`;
    const op = plateOp(opId, nameOf(src.m), c) as Extract<DetailOp, { k: 'plate' }>;
    if (src.cut) {
      // חיתוך קצה במישור פני המארח (`clipHost`): מישור המקור חייב להיות מקביל לפני המארח
      if (!site.host || site.cross || Math.abs(dot(norm(src.cut.plane.normal), site.n)) < 1 - 1e-6) return { infos, warnings, err: `הפלטה ${src.id}: חיתוך הקצה אינו במישור פני המארח — לא נתמך עדיין בהסקה` };
      op.clipHost = true;
      const co = dot(sub(site.P, src.cut.plane.point), site.n);
      if (Math.abs(co) > 0.005) op.clipOff = S(co);
    }
    det = { ...det, ops: [...det.ops, op] };
    placed.push({ src, opId });
    infos.push({ plate: src.id, op: opId, ref: `${c.on}.${c.face}`, mode: c.mode, spin: c.spin, off: r2(c.off), shape: c.sh.shape, contact: Math.abs(c.off) <= CONTACT });
    if (Math.abs(c.off) > CONTACT) warnings.push(`הפלטה ${src.id} לא נוגעת בפנים הייחוס ${c.on}.${c.face} (היסט ${S(c.off)} מ"מ) — נשמר כהיסט`);
  }
  // חורים: לכל פלטה לפי סדר ההצבה; חור שכבר מכוסה (אותו קו בורג דרך פלטה קודמת) לא נכפל
  const res2 = buildDetail(site, det);
  const hops: DetailOp[] = [], srcHoles: { src: SrcPlate; pts: Vec3[] }[] = [], done: SrcHole[] = [];
  let hk = 0;
  for (const p of placed) {
    const hs = holesThrough(model, p.src);
    srcHoles.push({ src: p.src, pts: hs.map((h) => h.pt) });
    const fr = res2.frame({ on: p.opId, face: 'z+' });
    if (!fr) continue;
    const fresh = hs.filter((h) => !done.some((q) => Math.abs(dot(q.axis, h.axis)) > 0.99 && len(sub(sub(q.pt, h.pt), scale(h.axis, dot(sub(q.pt, h.pt), h.axis)))) < 0.3 && Math.abs(q.d - h.d) < 0.05));
    done.push(...fresh);
    const keyed = new Map<string, SrcHole[]>();
    for (const h of fresh) { const key = `${r2(h.d)}|${dot(h.axis, fr.n) < 0 ? 'r' : 'f'}`; keyed.set(key, [...(keyed.get(key) ?? []), h]); }
    for (const [key, list] of [...keyed.entries()].sort()) {
      const [d, dir] = key.split('|');
      const groups = groupHoles(list.map((h) => { const r = sub(h.pt, fr.base); return [dot(r, fr.e1), dot(r, fr.e2)] as [number, number]; }));
      if (groups.length > 1) warnings.push(`החורים בפלטה ${p.src.id} אינם רשת סדירה — נוצרו ${groups.length} קבוצות חורים`);
      for (const g of groups) hops.push({ k: 'holes', id: `H${++hk}`, ref: { on: p.opId, face: 'z+', along: S(g.along), across: S(g.across) }, rows: String(g.rows), cols: String(g.cols), px: S(g.px), py: S(g.py), d0: d, ...(g.ring ? { ring: true } : {}), ...(dir === 'r' ? { rev: '1' } : {}) });
    }
  }
  det = { ...det, ops: [...det.ops, ...hops] };

  // אימות הלוך-חזור: פלטות (מתאר) וחורים (דרך ברגי בדיקה זמניים, כי חורים בלי ברגים אינם נפלטים מהמנוע)
  const probe: CustomDetail = { ...det, ops: [...det.ops, ...hops.map((h, i) => ({ k: 'bolts', id: `PB${i + 1}`, holes: h.id, d: '12', grade: '8.8', site: true, noMain: true, noHost: true }) as DetailOp)] };
  const built = buildDetail(site, probe);
  const bad = Object.entries(built.errors).filter(([key]) => !key.startsWith('_'));
  if (bad.length) return { infos, warnings, err: `שגיאת בנייה בפרט שהוסק (${bad.map(([a, b]) => `${a}: ${b}`).join('; ')})` };
  let dp = 0, dh = 0;
  for (let i = 0; i < placed.length; i++) {
    const { src } = placed[i], rb = built.members.find((m) => m.id === `${built.conn.id}.${placed[i].opId}`);
    const o = rb ? plateOutline(rb) : 'חסרה';
    if (typeof o === 'string' || !rb) return { infos, warnings, err: `הפלטה ${src.id}: הפרט שהוסק לא יצר פלטה תואמת (${typeof o === 'string' ? o : 'חסרה'})` };
    const dv = polyDev(o.poly, src.poly), tv = Math.abs(o.t - src.t);
    if (!(dv <= TFP_TOL) || tv > TFP_TOL) return { infos, warnings, err: `הפלטה ${src.id}: הלוך-חזור נכשל (סטיית מתאר ${Number.isFinite(dv) ? r2(dv) : 'צורה שונה'} מ"מ, עובי ${r2(tv)})` };
    dp = Math.max(dp, dv, tv);
    // חורים: כל חור במקור חייב להיות במבנה המחודש (קו הבורג חותך את מישור הפלטה באותה נקודה)
    const sh = srcHoles[i].pts;
    if (sh.length) {
      const bolts = built.conn.bolts.filter((b) => b.holesIn.includes(rb.id));
      const pts = bolts.map((b) => { const kk = dot(b.axis, o.Z); return Math.abs(kk) < 0.5 ? null : add(b.p, scale(b.axis, dot(sub(rb.start, b.p), o.Z) / kk)); }).filter((q): q is Vec3 => !!q);
      for (const q of sh) { const m = Math.min(...pts.map((r) => len(sub(r, q))), Infinity); if (!(m <= TFP_TOL)) return { infos, warnings, err: `הפלטה ${src.id}: חור במיקום המקורי לא שוחזר (סטייה ${Number.isFinite(m) ? r2(m) : '∞'} מ"מ)` }; dh = Math.max(dh, m); }
      if (pts.length > sh.length) warnings.push(`הפלטה ${src.id}: בפרט שהוסק יש ${pts.length - sh.length} חורים נוספים מעבר למקור (חורי פלטה אחרת באותו קו בורג)`);
    }
  }
  return { det, infos, warnings, dev: { plates: r2(dp), holes: r2(dh) } };
}

/**
 * פרט מפלטות שנבחרו. `plateIds` — מזהי פלטות במודל (אחת או כמה). `opts.siteKey` — אתר מפורש (אחרת מנסים את קצוות האלמנטים של החיבור
 * לפי קרבה ובוחרים את הראשון שהלוך-חזור שלו עובר). `opts.id` — מזהה הפרט (ברירת מחדל קבוע; הממשק מעביר מזהה ייחודי).
 */
export function templateFromParts(model: PartsModel, plateIds: string[], opts: { siteKey?: string; id?: string; name?: string; /** אלמנטי המודל "הנקי" לפתרון האתר (בלי פרט מותאם שהוחל על הקצה — כמו `base` בסטודיו); ברירת מחדל: `model.members` */ siteMembers?: Member[] } = {}): TemplateResult {
  const res: TemplateResult = { detail: null, errors: [], warnings: [], infos: [] };
  const byId = new Map(model.members.map((m) => [m.id, m]));
  const srcs: SrcPlate[] = [];
  for (const pid of [...new Set(plateIds)]) {
    const m = byId.get(pid);
    if (!m) { res.errors.push(`החלק ${pid} לא קיים במודל`); continue; }
    if (m.kind !== 'plate') { res.warnings.push(`${m.label || pid}: אינו פלטה — מדולג (ברגים וריתוכים: שלבים 2–3)`); continue; }
    const o = plateOutline(m);
    if (typeof o === 'string') res.errors.push(`${m.label || pid}: ${o}`); else srcs.push({ id: pid, ...o });
  }
  if (res.errors.length) return res;
  if (!srcs.length) { res.errors.push('לא נבחרה אף פלטה'); return res; }
  // אתרים מועמדים
  const conns = model.connections.filter((c) => srcs.some((s) => c.parts.includes(s.id) || s.m.connId === c.id));
  const cen = (m: Member) => scale(add(m.start, m.end), 0.5);
  const P = scale(srcs.reduce((a, s) => add(a, cen(s.m)), { x: 0, y: 0, z: 0 }), 1 / srcs.length);
  const keys: string[] = [];
  if (opts.siteKey) keys.push(opts.siteKey);
  else {
    const cand: [string, number][] = [];
    for (const c of conns) for (const mid of new Set([...c.members, ...c.parts.filter((x) => STRUCT.has(byId.get(x)?.kind ?? ''))])) { const m = byId.get(mid); if (!m) continue; for (const e of ['start', 'end'] as const) cand.push([siteKey(mid, e), len(sub(m[e], P))]); }
    keys.push(...cand.sort((a, b) => a[1] - b[1]).map((x) => x[0]));
  }
  if (!keys.length) { res.errors.push('הפלטות לא שייכות לחיבור — לא ידוע על איזה אלמנט לבנות את הפרט'); return res; }
  const name = opts.name ?? `תבנית מהמודל — ${nameOf(srcs[0].m)}`;
  let last = 'לא נמצא אתר מתאים';
  for (const key of [...new Set(keys)]) {
    const sm = opts.siteMembers ?? model.members, { id, end } = parseSiteKey(key), mm = sm.find((x) => x.id === id), site = mm ? findSite(sm, mm, end) : null;
    if (!site) { last = `האתר ${key} לא נפתר`; continue; }
    const r = inferOnSite(model, site, srcs, opts.id ?? 'cd-from-parts', name);
    if (r.det) {
      r.det.note = `נוצר מבחירת ${srcs.length} פלטות במודל (אתר ${key}). פעולות: פלטות וחורים בלבד — ברגים, ריתוכים וחיתוך האלמנט מוסיפים בסטודיו.`;
      return { ...res, detail: r.det, siteKey: key, infos: r.infos, warnings: [...res.warnings, ...r.warnings], dev: r.dev };
    }
    last = `${key}: ${r.err}`;
  }
  res.errors.push(`הלוך-חזור לא עבר באף אתר — ${last}`);
  return res;
}
