import type { DerivedModel, Member, Project } from '../model/types';
import { tryProfile } from '../profiles/library';
import { generate } from './generate';
import { defaultKneeBraces } from './knee';
import { cutLength } from './solid';

/**
 * 1.56: מידות האלכסון (עמוד-קורה) כפי שהמנוע בונה אותו, ופתרון הפוך: שתי מידות "נעולות" קובעות את השאר.
 * המשתנים של המנוע: ירידה (drop) וזווית (angle, במצב 'angle'). כל צמד מידות נעולות מתורגם לירידה וזווית
 * בפתרון נומרי (ניוטון עם הפרשים סופיים) על המודל עצמו — מה שמוצג הוא בדיוק מה שנבנה.
 *
 * v    אנכי — מתחתית הקורה (בפני העמוד) עד נקודת המגע של האלכסון בעמוד (= הירידה)
 * h    אופקי — מציר העמוד עד נקודת המגע בקורה
 * ax   מידה צירית — לאורך ציר האלכסון, בין החיתוך עם ציר העמוד לחיתוך עם ציר הקורה
 * face מרחק בין נקודות המגע — מפני העמוד לפני הקורה, לאורך ציר האלכסון
 * L    אורך האלכסון (אורך חיתוך)
 * ang  זווית מהאופק (מעלות)
 */
export type KDim = 'v' | 'h' | 'ax' | 'face' | 'L' | 'ang';
export const KDIMS: KDim[] = ['v', 'h', 'ax', 'face', 'L', 'ang'];
export type KMeas = Record<KDim, number>;

const kbHosts = (d: DerivedModel, kbId: string) => {
  const c = d.connections.find((x) => x.parts.includes(kbId) || x.id === `C.${kbId}`);
  const col = c?.members.map((x) => d.byId.get(x)).find((m): m is Member => !!m && m.kind === 'column');
  const raf = c?.members.map((x) => d.byId.get(x)).find((m): m is Member => !!m && (m.kind === 'rafter' || m.kind === 'beam'));
  return { col, raf };
};

/** מידות האלכסון kbId במודל d (מ"מ, זווית במעלות) */
export function measureKnee(d: DerivedModel, kbId: string): KMeas | null {
  const m = d.byId.get(kbId);
  if (!m) return null;
  const { col, raf } = kbHosts(d, kbId);
  if (!col || !raf) return null;
  // מישור המסגרת: u = מרחק אופקי מציר העמוד לכיוון הפנים, z = גובה
  const P = m.start.z < m.end.z ? m.start : m.end, Q = m.start.z < m.end.z ? m.end : m.start;
  const cx = col.start.x, cy = col.start.y;
  const dirx = Math.sign(Q.x - P.x) || 1;
  const u = (q: { x: number; y: number }) => (q.x - cx) * dirx + 0 * (q.y - cy);
  const uP = u(P), uQ = u(Q), zP = P.z, zQ = Q.z;
  void zQ;
  // קו הקורה בתחום: z = a + b·u (קו הייחוס של הקורה — מרכז או פני עליון לפי העיגון)
  const r0 = raf.start, r1 = raf.end;
  const ur0 = u(r0), ur1 = u(r1);
  const b = Math.abs(ur1 - ur0) > 1 ? (r1.z - r0.z) / (ur1 - ur0) : 0;
  const a0 = r0.z - b * ur0;
  const hv = (tryProfile(raf.profile)?.props.h ?? 0) * Math.sqrt(1 + b * b);
  const top = raf.anchor === 'top' ? a0 : a0 + hv / 2; // פני עליון בציר
  const under = (uu: number) => top + b * uu - hv;      // תחתית הקורה
  const mid = (uu: number) => top + b * uu - hv / 2;    // ציר הקורה
  const uF = (tryProfile(col.profile)?.props.h ?? 0) / 2; // פני העמוד
  // ציר האלכסון: z = zP + k·(u − uP)
  const k = Math.abs(uQ - uP) > 1e-6 ? (zQ - zP) / (uQ - uP) : 1e6;
  const zAt = (uu: number) => zP + k * (uu - uP);
  const hit = (c0: number) => (Math.abs(k - b) > 1e-9 ? (c0 - zP + k * uP) / (k - b) : uQ); // חיתוך עם z = c0 + b·u
  const uR = hit(top - hv), uM = hit(top - hv / 2);
  const C0 = { u: uF, z: zAt(uF) }, R0 = { u: uR, z: under(uR) };
  const ax = Math.hypot(uM - 0, mid(uM) - zAt(0));
  const face = Math.hypot(R0.u - C0.u, R0.z - C0.z);
  const v = under(uF) - C0.z;
  const h = R0.u;
  const ang = (Math.atan2(R0.z - C0.z, R0.u - C0.u) * 180) / Math.PI;
  const L = cutLength(m).max;
  return { v, h, ax, face, L, ang };
}

/** הפרמטרים שחלים על האלכסון: חריג למיקום (sides[key]) או הכללי */
export function kneeKeyOf(kbId: string) { return kbId.split('.').slice(2).join('.'); }

function withParams(p: Project, drop: number, angle: number, sideKey?: string): Project {
  const q: Project = structuredClone(p);
  const kb = { ...(q.building.kneeBraces ?? defaultKneeBraces()) };
  if (sideKey) kb.sides = { ...(kb.sides ?? {}), [sideKey]: { ...(kb.sides?.[sideKey] ?? {}), mode: 'angle', drop, angle } };
  else { kb.mode = 'angle'; kb.drop = drop; kb.angle = angle; }
  q.building.kneeBraces = kb;
  return q;
}

/**
 * פתרון: שתי מידות נעולות (targets) ⇒ ירידה וזווית. sideKey = חריג למיקום (אחרת הכללי).
 * מחזיר null אם אין פתרון סביר (למשל אלכסון שלא נוגע בקורה).
 */
export function solveKnee(p: Project, kbId: string, targets: Partial<KMeas>, sideKey?: string): { drop: number; angle: number; meas: KMeas } | null {
  const keys = (Object.keys(targets) as KDim[]).filter((k) => Number.isFinite(targets[k]!));
  if (keys.length !== 2) return null;
  const kb = p.building.kneeBraces ?? defaultKneeBraces();
  const ov = sideKey ? kb.sides?.[sideKey] : undefined;
  const d0 = generate(p), m0 = measureKnee(d0, kbId);
  if (!m0) return null;
  let x = [ov?.drop ?? kb.drop, m0.ang];
  // ירידה וזווית נעולות — אין מה לפתור
  if (keys.includes('v') && keys.includes('ang')) x = [targets.v!, targets.ang!];
  const f = (xx: number[]) => { const q = withParams(p, xx[0], xx[1], sideKey); return measureKnee(generate(q), kbId); };
  const res = (mm: KMeas) => keys.map((k) => (mm[k] - targets[k]!) / (k === 'ang' ? 1 : 10));
  let mm = f(x);
  for (let it = 0; it < 8 && mm; it++) {
    const r = res(mm);
    if (Math.hypot(...r) < 0.05) break;
    const J: number[][] = [[0, 0], [0, 0]];
    const hs = [5, 0.25];
    for (let j = 0; j < 2; j++) {
      const xp = [...x]; xp[j] += hs[j];
      const mp = f(xp); if (!mp) return null;
      const rp = res(mp);
      for (let i = 0; i < 2; i++) J[i][j] = (rp[i] - r[i]) / hs[j];
    }
    const det = J[0][0] * J[1][1] - J[0][1] * J[1][0];
    if (Math.abs(det) < 1e-12) return null;
    const dx0 = (J[1][1] * r[0] - J[0][1] * r[1]) / det, dx1 = (-J[1][0] * r[0] + J[0][0] * r[1]) / det;
    x = [Math.max(50, x[0] - dx0), Math.min(80, Math.max(15, x[1] - dx1))];
    mm = f(x);
  }
  if (!mm) return null;
  const ok = keys.every((k) => Math.abs(mm![k] - targets[k]!) < (k === 'ang' ? 0.5 : 3));
  return ok ? { drop: Math.round(x[0]), angle: Math.round(x[1] * 10) / 10, meas: mm } : null;
}

/**
 * 1.57: בדיקת דרגות חופש — האם שתי המידות הנעולות קובעות את האלכסון (ירידה + זווית).
 * יעקוביאן 2×2 בהפרשים סופיים בנקודה הנוכחית; דטרמיננטה מנורמלת קטנה ⇒ המידות תלויות זו בזו (לא תקין).
 */
export function checkKneePair(p: Project, kbId: string, dims: [KDim, KDim], sideKey?: string): { ok: boolean; reason?: string } {
  if (dims[0] === dims[1]) return { ok: false, reason: 'נדרשות שתי מידות שונות' };
  const kb = p.building.kneeBraces ?? defaultKneeBraces();
  const ov = sideKey ? kb.sides?.[sideKey] : undefined;
  const m0 = measureKnee(generate(p), kbId);
  if (!m0) return { ok: false, reason: 'האלכסון לא נמצא במודל' };
  const x = [ov?.drop ?? kb.drop, m0.ang];
  const f = (xx: number[]) => measureKnee(generate(withParams(p, xx[0], xx[1], sideKey)), kbId);
  const base = f(x); if (!base) return { ok: false, reason: 'לא ניתן למדוד' };
  const hs = [20, 1];
  const cols: number[][] = [];
  for (let j = 0; j < 2; j++) {
    const xp = [...x]; xp[j] += hs[j];
    const mp = f(xp); if (!mp) return { ok: false, reason: 'לא ניתן למדוד' };
    cols.push(dims.map((k) => (mp[k] - base[k]) / hs[j]));
  }
  // J[i][j] = ∂dim_i/∂x_j ; נרמול שורות כדי שהבדיקה לא תלויה ביחידות
  // קנה מידה טיפוסי למשתנים (100 מ"מ ירידה, 10° זווית) — כדי שהבדיקה לא תלויה ביחידות
  const J = [[cols[0][0] * 100, cols[1][0] * 10], [cols[0][1] * 100, cols[1][1] * 10]];
  const n0 = Math.hypot(J[0][0], J[0][1]) || 1, n1 = Math.hypot(J[1][0], J[1][1]) || 1;
  const det = (J[0][0] * J[1][1] - J[0][1] * J[1][0]) / (n0 * n1);
  if (Math.abs(det) < 0.05) return { ok: false, reason: 'שתי המידות תלויות זו בזו — הן לא קובעות יחד את האלכסון. בחרו מידה קובעת אחרת.' };
  return { ok: true };
}
