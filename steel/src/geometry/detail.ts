import { add, cross, dot, len, norm, rotateAxis, scale, sub, v3, type Plane, type Vec3 } from '../core/vec';
import CONN_LIBRARY from './data/connLibrary.json';
import { tryExpr, type Vars } from '../core/expr';
import { getProfile, tryProfile } from '../profiles/library';
import type { BoltInfo, Connection, CustomDetail, SiteAnchor, DetailOp, DetailParam, DetailRef, Member, Project, ValidationIssue, WeldInfo } from '../model/types';
import { localFrame } from './frame';
import { memberSolid } from './solid';
import { axialExtent } from './parts';
import { clash, PrismTester } from './clash';
import { hw, makeBolt } from './connections';
import { BUILTIN_RECIPES } from './convRecipes';
import { anchorSite, midSite } from './midSite';

/**
 * פרטי חיבור מותאמים — "מתכון": רשימת פעולות (חיתוך, פלטות, חורים, ברגים, ריתוך...) שכל אחת יושבת על פנים
 * של אחד הרכיבים (האלמנט, המארח או פלטה קודמת), עם מידות בנוסחאות. הפרט מוחל על "קצה" של אלמנט (אתר):
 * האלמנט הראשי (שהקצה שלו מפורט) והמארח (האלמנט שהציר פוגע בו). כל המיקומים נגזרים מהגיאומטריה של האתר —
 * לכן אותו פרט מתאים לחתכים, זוויות וצדדים שונים (כולל מראה).
 */

/** קצה אלמנט, או חציה (x:מזהה מסגרת) — פטה שעוברת מעל קורת גג (תושבת פטה) */
/** קצה אלמנט, חציה (x:מזהה מסגרת), או אתר באמצע האלמנט (s:k — חיבור ההמשך ה-k, מ-1, ברשימת התפרים הממוינת; G9) */
export type End = 'start' | 'end' | `x:${string}` | `s:${number}` | `p:${string}`;
const STRUCT = new Set(['column', 'rafter', 'beam', 'purlin', 'girt', 'brace']);
const REMOVABLE = new Set(['plate', 'cleat', 'bolt', 'anchor']);

export interface Site {
  key: string;
  main: Member; end: End;
  host: Member | null;
  /** נקודת מפגש ציר האלמנט עם פני המארח (תיבת החתך) */
  P: Vec3;
  /** פגיעה במתאר החתך האמיתי של מארח I/U (למשל פני הווב כשהקרן באה מהצד) ונורמל הפן שנפגע; חסר כשזהה לתיבה. רק פרטים שמבקשים (`th`) משתמשים בה */
  Pt?: Vec3; nt?: Vec3;
  /** ציר האלמנט, מהמארח אל האלמנט */
  u: Vec3;
  /** נורמל פני המארח (לכיוון האלמנט); בקצה חופשי = u */
  n: Vec3;
  /** a — ניצב לציר במישור (n,u); w — ניצב למישור */
  a: Vec3; w: Vec3;
  hand: 1 | -1;
  /** כיוון קנוני ±1 של a (סימן רכיב x, ואם אפסי — הרכיב הדומיננטי): אותו צד מוחלט בשני קצוות האלמנט */
  handA: 1 | -1;
  /** מידות החתך הראשי לאורך a ו-w */
  mh: number; mb: number;
  /** עומק המארח לאורך n (לפנים הנגדיות), ומרחק פני המארח לווב */
  hd: number; webOff: number | null;
  /** ציר המארח (לכיוון e1 כשהאלמנט ניצב לפנים) ונקודה על קו מרכז החתך שלו */
  hostAxis: Vec3 | null;
  ang: number;
  /** הקצה המקורי של האלמנט והקצה השני */
  E: Vec3; O: Vec3;
  /** חציה: האלמנט עובר מעל המארח ואינו נחתך (תושבת פטה) — מזהה חיבור התושבת שמוחלף, וצד הווב */
  cross?: { conn: string; wo: number; cs: number; sr: number };
  /** אתר באמצע האלמנט (G9, חיבור המשך): האלמנט רציף ואינו נחתך. `conn` — מזהה החיבור המובנה שמוחלף; `t` — מיקום על הציר; `wa`/`ww` — היסט פני החומר לאורך a / w (פנים a±/w±);
   *  `up` — כיוון e1 של הפנים (למשל כלפי מעלה לאורך הווב); `xs` — סימן e2 של פנים a- ביחס לציר האלמנט */
  mid?: { conn: string; t: number; k: number; wa: number; ww: number; up: Vec3; xs: 1 | -1; /** כיוון ראש הבורג (ברירת מחדל `up`) */ bu?: Vec3; /** האלמנט עובר דרך הפלטות (חיבור המשך בקורה/עמוד): אין בדיקת התנגשות מול האלמנט וברגים לא נסרקים דרכו */ through?: boolean; /** סימן ימניות המערכת המקומית (ex,u,v): +1 כש-ex×u = v */ rh?: 1 | -1; /** אלמנט שני שהברגים עוברים בו (הצטלבות) */ partner?: string };
}

/** הקשר לפתרון אתרי אמצע: מיקומי חיבורי ההמשך האפקטיביים (כולל אוטומטיים) לפי מזהה אלמנט */
export interface SiteCtx { splices?: Record<string, number[]>; /** אתרי עוגן שחיבורים מובנים סיפקו (`Connection.recipe.anchors`), לפי מפתח אתר מלא */ anchors?: Record<string, SiteAnchor> }

export const siteKey = (memberId: string, end: End) => `${memberId}|${end}`;
export function parseSiteKey(k: string): { id: string; end: End } { const i = k.lastIndexOf('|'); return { id: k.slice(0, i), end: k.slice(i + 1) as End }; }

/** תיבת החתך של אלמנט במערכת המקומית שלו */
function secBox(m: Member) {
  const prof = getProfile(m.profile), s = memberSolid(m);
  const us = prof.outline.outer.map((p) => p.u + s.du), vs = prof.outline.outer.map((p) => p.v + s.dv);
  return { u0: Math.min(...us), u1: Math.max(...us), v0: Math.min(...vs), v1: Math.max(...vs) };
}

/**
 * נתוני פגיעת קרן שאינם תלויים בקרן (מערכת מקומית, תיבת חתך, טווח צירי): מחושבים פעם אחת לאובייקט אלמנט.
 * `findSite` רץ לכל אתר מול כל האלמנטים במודל — בלי זה העלות ריבועית במספר האתרים (מדידה: 160 אתרים ≈ 4 שניות מתוך 6).
 * המפתח הוא אובייקט האלמנט; אלמנט שהוחלף באובייקט חדש (ע"י פרט) מחושב מחדש.
 */
interface RayGeom { f: ReturnType<typeof localFrame>; bx: ReturnType<typeof secBox>; tMin: number; tMax: number; isI: boolean; tw: number }
const rayGeomCache = new WeakMap<Member, RayGeom>();
function rayGeom(m: Member): RayGeom {
  let g = rayGeomCache.get(m);
  if (!g) {
    const prof = getProfile(m.profile), { tMin, tMax } = axialExtent(m);
    g = { f: localFrame(m), bx: secBox(m), tMin, tMax, isI: ['IPE', 'HEA', 'HEB', 'HEM', 'INP', 'UPN', 'UPE'].includes(prof.family), tw: prof.dims.tw ?? 8 };
    rayGeomCache.set(m, g);
  }
  return g;
}

/** פגיעת קרן בפריזמה של אלמנט: הפנים הראשונות שהקרן נכנסת דרכן */
function rayHit(o: Vec3, d: Vec3, m: Member): { t: number; n: Vec3; depth: number; webOff: number | null } | null {
  if (m.contour) return null;
  const { f, bx, tMin, tMax, isI, tw } = rayGeom(m);
  let best: { t: number; n: Vec3; depth: number; webOff: number | null } | null = null;
  const faces: [Vec3, number, 'u' | 'v'][] = [[f.u, bx.u1, 'u'], [scale(f.u, -1), -bx.u0, 'u'], [f.v, bx.v1, 'v'], [scale(f.v, -1), -bx.v0, 'v']];
  for (const [nn, off, ax] of faces) {
    const den = dot(d, nn);
    if (den > -1e-6) continue;
    const pt0 = add(m.start, scale(nn, off));
    const t = dot(sub(pt0, o), nn) / den;
    const q = add(o, scale(d, t)), r = sub(q, m.start);
    const s = dot(r, f.ex), uu = dot(r, f.u), vv = dot(r, f.v);
    if (s < tMin - 1 || s > tMax + 1) continue;
    if (ax === 'u' && (vv < bx.v0 - 1 || vv > bx.v1 + 1)) continue;
    if (ax === 'v' && (uu < bx.u0 - 1 || uu > bx.u1 + 1)) continue;
    if (!best || t < best.t) {
      const depth = ax === 'u' ? bx.u1 - bx.u0 : bx.v1 - bx.v0;
      // ווב: בחתך I/U כשהפגיעה באגף (פנים v) — הווב במרכז
      const webOff = isI && ax === 'v' ? depth / 2 - tw / 2 : null;
      best = { t, n: scale(nn, 1), depth, webOff };
    }
  }
  return best;
}

/** כניסת הקרן למתאר החתך האמיתי (מערכת מקומית u,v של המארח) — לחתך I/U שבו פני התיבה אינם פני החומר. null כשאין שוני מהתיבה */
function trueHit(o: Vec3, d: Vec3, m: Member, tBox: number): { t: number; n: Vec3 } | null {
  const { f } = rayGeom(m);
  const prof = getProfile(m.profile), s = memberSolid(m);
  const ring = prof.outline.outer.map((p) => ({ u: p.u + s.du, v: p.v + s.dv }));
  const r0 = sub(o, m.start);
  const p0 = { u: dot(r0, f.u), v: dot(r0, f.v) }, dd = { u: dot(d, f.u), v: dot(d, f.v) };
  if (Math.hypot(dd.u, dd.v) < 1e-9) return null;
  let best: { t: number; n: Vec3 } | null = null;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
    const ex = b.u - a.u, ey = b.v - a.v;
    const den = dd.u * ey - dd.v * ex; // קרן × קטע
    if (Math.abs(den) < 1e-9) continue;
    const t = ((a.u - p0.u) * ey - (a.v - p0.v) * ex) / den, w = ((a.u - p0.u) * dd.v - (a.v - p0.v) * dd.u) / den;
    if (w < -1e-6 || w > 1 + 1e-6 || t < tBox - 1e-6) continue;
    // נורמל החוצה של הקטע; רק קטע שהקרן נכנסת דרכו (נגד הנורמל)
    const len2 = Math.hypot(ex, ey) || 1;
    let nu = ey / len2, nv = -ex / len2;
    if (nu * dd.u + nv * dd.v > 0) { nu = -nu; nv = -nv; }
    if (nu * dd.u + nv * dd.v > -1e-9) continue;
    if (!best || t < best.t) best = { t, n: add(scale(f.u, nu), scale(f.v, nv)) };
  }
  return best;
}

/** מציאת אתר לקצה אלמנט: המארח שהציר פוגע בו (עד 600 מ"מ מעבר לקצה), או קצה חופשי. */
export function findSite(members: Member[], m: Member, end: End, ctx?: SiteCtx): Site | null {
  if (!tryProfile(m.profile)) return null;
  if (end.startsWith('s:')) return midSite(m, Number(end.slice(2)), ctx?.splices?.[m.id]);
  if (end.startsWith('p:')) return anchorSite(m, end as `p:${string}`, ctx?.anchors?.[siteKey(m.id, end)]);
  if (end.startsWith('x:')) return crossSite(members, m, end.slice(2));
  const E = end === 'start' ? m.start : m.end, O = end === 'start' ? m.end : m.start;
  const L = len(sub(E, O)); if (L < 1) return null;
  const dOut = norm(sub(E, O));
  const o = sub(E, scale(dOut, Math.min(250, L / 2)));
  let best: { m: Member; t: number; n: Vec3; depth: number; webOff: number | null } | null = null;
  for (const x of members) {
    if (x === m || !STRUCT.has(x.kind) || !tryProfile(x.profile)) continue;
    if (m.id.startsWith('LT.') && x.id.startsWith('LT.')) continue; // מסבך נעילה: אלכסוני/חגורת אותו מסבך אינם מארח לקצה החגורה (תיבת החתך המסובבת של האלכסון תופסת את ציר החגורה)
    const h = rayHit(o, dOut, x);
    if (!h || h.t < 0 || h.t > Math.min(250, L / 2) + 600) continue;
    if (!best || h.t < best.t) best = { m: x, ...h };
  }
  const u = scale(dOut, -1);
  const P = best ? add(o, scale(dOut, best.t)) : E;
  const th = best && rayGeom(best.m).isI ? trueHit(o, dOut, best.m, best.t) : null;
  const Pt0 = th && th.t - best!.t > 0.5 ? add(o, scale(dOut, th.t)) : undefined;
  const n = best ? best.n : u;
  let w0 = cross(n, u);
  if (len(w0) < 0.05) { const f = localFrame(m); w0 = sub(f.v, scale(u, dot(f.v, u))); }
  const w = norm(w0), a = norm(cross(w, u));
  const ax = Math.abs(w.x) >= Math.abs(w.y) && Math.abs(w.x) >= Math.abs(w.z) ? w.x : Math.abs(w.y) >= Math.abs(w.z) ? w.y : w.z;
  const hand: 1 | -1 = ax >= 0 ? 1 : -1;
  const axA = Math.abs(a.x) > 1e-3 ? a.x : Math.abs(a.y) >= Math.abs(a.z) ? a.y : a.z;
  const handA: 1 | -1 = axA >= 0 ? 1 : -1;
  const f = localFrame(m), prof = getProfile(m.profile);
  const bU = prof.props.b ?? prof.props.h, hV = prof.props.h;
  const uAlongA = Math.abs(dot(f.u, a)) >= Math.abs(dot(f.v, a));
  const mh = uAlongA ? bU : hV, mb = uAlongA ? hV : bU;
  const ang = (Math.asin(Math.min(1, Math.abs(dot(u, n)))) * 180) / Math.PI;
  // ציר האלמנט מוסט מעט ממרכז המארח (למשל בגלל פרט סנפיר בקצה השני) — הפרט כולו ממורכז על המארח
  let Pc = P;
  if (best) {
    const hf = localFrame(best.m), bx = secBox(best.m);
    const C = add(add(best.m.start, scale(hf.u, (bx.u0 + bx.u1) / 2)), scale(hf.v, (bx.v0 + bx.v1) / 2));
    const qv = cross(n, hf.ex);
    if (len(qv) > 0.5 && Math.abs(dot(w, hf.ex)) < 0.2) { const q = norm(qv), off = dot(sub(P, C), q); if (Math.abs(off) > 0.01 && Math.abs(off) < 25) Pc = sub(P, scale(q, off)); }
  }
  return {
    key: siteKey(m.id, end), main: m, end, host: best?.m ?? null, P: Pc, u, n, a, w, hand, handA, mh, mb,
    hd: best?.depth ?? 0, webOff: best?.webOff ?? null, hostAxis: best ? localFrame(best.m).ex : null, ang, E, O,
    ...(Pt0 ? { Pt: Pt0 !== undefined && Pc !== P ? sub(Pt0, sub(P, Pc)) : Pt0, nt: th!.n } : {}),
  };
}

/** אתר חציה: פטה מעל קורת הגג של מסגרת — נקודת המגע על פני הקורה בקו הווב */
function crossSite(members: Member[], pur: Member, frameId: string): Site | null {
  if (!pur.purlin) return null;
  const lf = localFrame(pur);
  const pp = getProfile(pur.profile);
  const raf = members.find((x) => x.kind === 'rafter' && x.frameId === frameId && Math.abs(lf.ex.y) > 0.5 && (() => {
    const t = (x.start.y - pur.start.y) / lf.ex.y; const q = add(pur.start, scale(lf.ex, t));
    return q.x >= Math.min(x.start.x, x.end.x) - 1 && q.x <= Math.max(x.start.x, x.end.x) + 1;
  })());
  if (!raf) return null;
  const t = (raf.start.y - pur.start.y) / lf.ex.y;
  const P = add(pur.start, scale(lf.ex, t));
  const n = lf.v, d = pp.family === 'Z' ? lf.u : scale(lf.u, -1);
  const tw = pp.dims.t ?? pp.dims.tw ?? 3;
  const wb = pp.family === 'C' || pp.family === 'Z' ? tw / 2 : Math.max(...pp.outline.outer.map((q) => q.u * dot(d, lf.u)));
  const w = lf.ex, a = d;
  const ax = Math.abs(w.x) >= Math.abs(w.y) && Math.abs(w.x) >= Math.abs(w.z) ? w.x : Math.abs(w.y) >= Math.abs(w.z) ? w.y : w.z;
  const rp = getProfile(raf.profile);
  return {
    key: siteKey(pur.id, `x:${frameId}`), main: pur, end: `x:${frameId}`, host: raf, P, u: n, n, a, w, hand: ax >= 0 ? 1 : -1, handA: (Math.abs(a.x) > 1e-3 ? a.x : Math.abs(a.y) >= Math.abs(a.z) ? a.y : a.z) >= 0 ? 1 : -1,
    mh: pp.props.h, mb: pp.props.b ?? pp.props.h, hd: rp.props.h, webOff: null, hostAxis: localFrame(raf).ex, ang: 90, E: P, O: add(P, scale(w, 1000)),
    cross: (() => {
      const hand = ax >= 0 ? 1 : -1, e2 = scale(cross(n, w), hand);
      // cs — צד התושבת ביחס ל"לרוחב" של פני הקורה; sr — סיבוב פלטה ניצבת כך שתעמוד ניצב לווב (לכיוון התושבת)
      return { conn: `C.PC.${pur.id}.${frameId}`, wo: wb, cs: dot(a, e2) >= 0 ? 1 : -1, sr: 90 * hand * (dot(cross(n, w), a) >= 0 ? 1 : -1) };
    })(),
  };
}

/** פרמטרים מספריים של האתר לנוסחאות */
export function siteVars(s: Site): Vars {
  const mp = getProfile(s.main.profile), hp = s.host ? getProfile(s.host.profile) : null;
  return {
    mh: s.mh, mb: s.mb, pb: mp.props.b ?? mp.props.h, mt: mp.dims.t ?? mp.dims.tw ?? 5, mtf: mp.dims.tf ?? mp.dims.t ?? 5,
    hh: hp?.props.h ?? 0, hr: hp?.dims.r ?? 0, ph: mp.props.h, hb: hp?.props.b ?? 0, htf: hp?.dims.tf ?? hp?.dims.t ?? 0, htw: hp?.dims.tw ?? hp?.dims.t ?? 0,
    hd: s.hd, ang: Math.max(1, s.ang), hs: s.hand, ha: s.handA, wo: s.cross?.wo ?? s.mid?.wa ?? 0, cs: s.cross?.cs ?? 1, sr: s.cross?.sr ?? 90, ev: ((s.u.z - s.n.z * dot(s.u, s.n)) >= 0 ? 1 : -1), xs: s.cross ? (dot(scale(cross(scale(s.a, -1), s.u), s.hand), s.w) >= 0 ? 1 : -1) : s.mid ? s.mid.xs : 1, rh: s.mid?.rh ?? 1,
  };
}
export const VAR_HELP: [string, string][] = [
  ['mh', 'גובה חתך האלמנט (במישור)'], ['mb', 'רוחב חתך האלמנט (ניצב למישור)'], ['pb', 'רוחב החתך b לפי הפרופיל (בלי קשר לכיוון ההנחה)'], ['ph', 'גובה החתך h לפי הפרופיל'], ['hr', 'רדיוס שורש (r) של חתך המארח'], ['mt', 'עובי דופן/ווב האלמנט'], ['mtf', 'עובי אגף האלמנט'],
  ['hh', 'גובה חתך המארח'], ['hb', 'רוחב חתך המארח'], ['htf', 'עובי אגף המארח'], ['htw', 'עובי ווב המארח'], ['hd', 'עומק המארח בכיוון הפגיעה'],
  ['ang', 'זווית בין ציר האלמנט לפני המארח (90 = ניצב)'], ['hs', 'כיוון קנוני ±1 של w: הסטה/היסט ב-hs·x הולכים לאותו צד מוחלט בשני קצוות האלמנט'], ['ha', 'כיוון קנוני ±1 של a (כמו hs, לציר a): היסט ב-ha·x באותו צד מוחלט בשני הקצוות'], ['wo', 'תושבת פטה: מרחק פני הווב מציר הפטה'], ['ev', 'כיוון ±1 של הרכיב האנכי של e1 בפנים המארח (הטלת ציר האלמנט על הפנים) — היסט ev·x הולך כלפי מעלה'], ['xs', 'תושבת פטה: כיוון ±1 של "לרוחב" על פני הווב (a-) ביחס לציר הפטה — היסט xs·x הולך לאורך הפטה'],
];

export interface Frame { base: Vec3; n: Vec3; e1: Vec3; e2: Vec3; hand: 1 | -1 }
export interface PlateGeom { id: string; center: Vec3; X: Vec3; Y: Vec3; Z: Vec3; t: number; w: number; h: number; poly: [number, number][]; hand: 1 | -1; memberId: string; target: string }

export function platePoly(shape: string, w: number, h: number, ch: number, co: boolean[]): [number, number][] {
  const W = w / 2, H = h / 2;
  if (shape === 'round') return Array.from({ length: 32 }, (_, i) => [W * Math.cos((i / 32) * Math.PI * 2), W * Math.sin((i / 32) * Math.PI * 2)]);
  if (shape === 'tri') return [[-W, -H], [W, -H], [-W, H]];
  if (shape === 'rtri') return [[-W, -H], [-W, H], [W, -H]];
  const C: [number, number][] = [[W, H], [-W, H], [-W, -H], [W, -H]], ord = [3, 0, 1, 2], out: [number, number][] = [];
  const cc = shape === 'cham' ? Math.max(0, Math.min(ch, Math.min(w, h) - 2)) : 0;
  ord.forEach((k, i) => {
    const pt = C[k], pv = C[ord[(i + 3) % 4]], nx = C[ord[(i + 1) % 4]];
    if (cc > 0 && co[k]) {
      const dir = (q: [number, number]) => { const L = Math.hypot(q[0] - pt[0], q[1] - pt[1]); return [(q[0] - pt[0]) / L, (q[1] - pt[1]) / L]; };
      const da = dir(pv), db = dir(nx);
      out.push([pt[0] + da[0] * cc, pt[1] + da[1] * cc], [pt[0] + db[0] * cc, pt[1] + db[1] * cc]);
    } else out.push(pt);
  });
  return out;
}

export interface DetailResult {
  site: Site;
  /** האלמנט הראשי לאחר החיתוך */
  main: Member;
  members: Member[];
  conn: Connection;
  issues: ValidationIssue[];
  /** ערכי הנוסחאות (משתנים + תוצאות פעולות) */
  values: Vars;
  /** שגיאות לפי פעולה/משתנה */
  errors: Record<string, string>;
  plates: Map<string, PlateGeom>;
  frame: (ref: Pick<DetailRef, 'on' | 'face'>) => Frame | null;
  /** אורך האלמנט מהמפגש עד הקצה (לאורך u) */
  sEnd: number;
}

const r1 = (x: number) => Math.round(x * 10) / 10;

/**
 * ערכי מופע תקפים לפרט: רק למשתנים שקיימים בפרט, רק מספרים סופיים, ובמגבלות הטווח של הפרמטר (אם הוגדר).
 * קובץ מיובא או פרט שהשתנה בספרייה לא יפיל את המודל — ערך לא תקף פשוט מתעלמים ממנו.
 */
export function paramOverrides(det: CustomDetail, raw?: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw) return out;
  for (const v of det.vars) {
    const x = raw[v.name];
    if (typeof x !== 'number' || !Number.isFinite(x)) continue;
    const def = det.params?.find((q) => q.name === v.name);
    out[v.name] = def ? Math.min(def.max ?? Infinity, Math.max(def.min ?? -Infinity, x)) : x;
  }
  return out;
}

/** הפרמטרים שהאשף מציג לפרט, בסדר ההגדרה (רק אלה שמסומנים להצגה ושקיים להם משתנה) */
export function shownParams(det: CustomDetail): NonNullable<CustomDetail['params']> {
  return (det.params ?? []).filter((q) => q.show !== false && det.vars.some((v) => v.name === q.name));
}

/** ערכי הפרמטרים בפועל באתר (ברירת מחדל מהנוסחה, או ערך המופע) — לתצוגת האשף. null = האתר לא נמצא */
export function detailParamValues(members: Member[], key: string, det: CustomDetail, overrides?: Record<string, number>): { values: Record<string, number>; defaults: Record<string, number> } | null {
  const { id, end } = parseSiteKey(key);
  const m = members.find((x) => x.id === id);
  const site = m ? findSite(members, m, end) : null;
  if (!site) return null;
  const pick = (v: Vars) => Object.fromEntries((det.params ?? []).map((q) => [q.name, v[q.name] ?? 0]));
  return { values: pick(buildDetail(site, det, { overrides }).values), defaults: pick(buildDetail(site, det).values) };
}

/** בניית פרט על אתר. טהור — אינו משנה את האלמנט המקורי. */
export function buildDetail(site: Site, det: CustomDetail, opts: { connId?: string; material?: string; others?: Member[]; /** ערכי מופע (מתכון v2): שם משתנה ⇒ ערך, דורסים את נוסחת המשתנה */ overrides?: Record<string, number>; /** חלקים נוספים (פלטות של האתר שכנגד באתר זוגי) שהברגים נסרקים דרכם */ extra?: Member[] } = {}): DetailResult {
  // `th` (פרמטר חיבור): הפרט נבנה על פני החומר האמיתיים של מארח I/U (למשל פני הווב), לא על תיבת החתך
  const s: Site = opts.overrides?.th && site.Pt ? { ...site, P: site.Pt, n: site.nt ?? site.n } : site;
  const cid = opts.connId ?? s.mid?.conn ?? `C.CD.${s.key.replace('|', '.').replace(':', '.')}`, mat = opts.material ?? s.main.material;
  const vals: Vars = siteVars(s), errors: Record<string, string> = {}, issues: ValidationIssue[] = [];
  const ev = (src: string | number | undefined, key: string, dflt = 0) => {
    const r = tryExpr(src ?? dflt, vals, dflt);
    if (r.err) errors[key] = r.err;
    if (!key.startsWith('_') && !(key in vals)) vals[key] = r.v;
    return r.v;
  };
  const ovr = paramOverrides(det, opts.overrides);
  for (const v of det.vars) { const x = v.name in ovr ? ovr[v.name] : ev(v.expr, `var.${v.name}`); vals[v.name] = x; }
  // מעבר מקדים: מידות הפלטות זמינות לנוסחאות של כל הפעולות (גם לחיתוך שלפניהן)
  for (let pass = 0; pass < 2; pass++) for (const op of det.ops) if (op.k === 'plate' || op.k === 'endplate') {
    for (const k of ['w', 'h', 't'] as const) { const r = tryExpr((op as Record<string, unknown>)[k] as string, vals, NaN); if (!r.err) vals[`${op.id}.${k}`] = r.v; }
    if (op.k === 'plate' && op.shape === 'round') vals[`${op.id}.h`] = vals[`${op.id}.w`];
  }
  const members: Member[] = [], bolts: BoltInfo[] = [], welds: WeldInfo[] = [], vents: NonNullable<Connection['vents']> = [];
  let connHoles: Connection['holes'];
  const plates = new Map<string, PlateGeom>();
  // חיתוך: ברירת מחדל — מקביל לפני המארח, בפנים
  const cutOp = det.ops.find((o) => o.k === 'cut') as Extract<DetailOp, { k: 'cut' }> | undefined;
  let sEnd = 0; let cutPlane: Plane = { point: s.P, normal: s.n };
  const sinA = Math.max(0.05, Math.abs(dot(s.u, s.n)));
  const planar = !!(s.cross || s.mid); // האלמנט רציף: אין חיתוך/הסטה/פלטת קצה
  if (cutOp && !planar) {
    const at = ev(cutOp.at, cutOp.id); vals[`${cutOp.id}.at`] = at;
    if (cutOp.kind === 'host' || !s.host) { sEnd = at / sinA; cutPlane = { point: add(s.P, scale(s.n, at)), normal: s.n }; }
    else {
      sEnd = at; const Q = add(s.P, scale(s.u, at));
      let N = s.u;
      if (cutOp.kind === 'vert') { const hz = v3(s.u.x, s.u.y, 0); N = len(hz) > 0.05 ? norm(hz) : s.u; }
      if (cutOp.kind === 'horiz') N = v3(0, 0, 1);
      cutPlane = { point: Q, normal: N };
      // נקודת הציר על מישור החיתוך
      const tt = dot(sub(Q, s.P), N) / (dot(s.u, N) || 1); sEnd = tt;
    }
  }
  // הסטת הקצה (shift): ניצב למישור, לאורך w — הציר והחיתוך זזים; הפלטות על "axis" נשארות על הציר המקורי
  const shiftOp = det.ops.find((o) => o.k === 'shift') as Extract<DetailOp, { k: 'shift' }> | undefined;
  let sh = v3(0, 0, 0);
  if (shiftOp) {
    if (planar) errors[shiftOp.id] = 'באתר רציף (תושבת פטה / חיבור המשך) אין הסטה';
    else { const by = ev(shiftOp.by, shiftOp.id); vals[`${shiftOp.id}.by`] = by; sh = scale(s.w, by); cutPlane = { point: add(cutPlane.point, sh), normal: cutPlane.normal }; }
  }
  const endPt = add(add(s.P, scale(s.u, sEnd)), sh);
  const mainPt = cutOp?.keep ? add(s.P, sh) : endPt;
  // חיתוך ניצב לציר = קצה ישר (כמו בפרופיל רגיל) — בלי מישור חיתוך מפורש, כדי שהחלק, הגיליונות וה-NC1 יהיו זהים לקצה שנבנה בקוד
  const squareEnd = cutOp?.kind === 'perp';
  const cutFld = squareEnd ? undefined : cutPlane;
  const main: Member = planar ? s.main : { ...s.main, ...(s.end === 'start' ? { start: mainPt, startCut: cutFld } : { end: mainPt, endCut: cutFld }), connId: s.main.connId };
  if (planar && cutOp) errors[cutOp.id] = 'באתר רציף (תושבת פטה / חיבור המשך) אין חיתוך';
  vals.send = sEnd;
  let endT = 0;

  const frame = (ref: Pick<DetailRef, 'on' | 'face'>): Frame | null => {
    let base: Vec3, n: Vec3, e1: Vec3;
    if (ref.on === 'main') {
      if (ref.face === 'axis' || ref.face === 'axis-') { if (s.cross) return null; base = s.P; n = scale(s.w, s.hand * (ref.face === 'axis-' ? -1 : 1)); e1 = s.u; }
      else if (ref.face === 'axisA' || ref.face === 'axisA-') { if (s.cross) return null; base = s.P; n = scale(s.a, s.handA * (ref.face === 'axisA-' ? -1 : 1)); e1 = s.u; }
      else if (ref.face === 'end') { if (planar) return null; base = add(add(s.P, scale(s.u, sEnd - endT)), sh); n = scale(s.u, -1); e1 = s.a; }
      else if (s.mid) {
        // אתר אמצע: פנים a±/w± לפי כיוון מוחלט של הצירים (בלי כיוון קנוני), במרחק היסט החומר; e1 לאורך `up`
        // u± = ניצב לציר האלמנט (מישור התפר); a±/w± = לאורך הציר, בהיסט `wa`/`ww`; e1 = `up`, ואם הוא מקביל לנורמל — הציר האחר
        const sg = ref.face.endsWith('-') ? -1 : 1, k0 = ref.face[0];
        if (k0 === 'u') { n = scale(s.u, sg); base = s.P; e1 = s.mid.up; }
        else if (k0 === 'a' || k0 === 'w') {
          const isA = k0 === 'a'; n = scale(isA ? s.a : s.w, sg); base = add(s.P, scale(n, isA ? s.mid.wa : s.mid.ww));
          e1 = Math.abs(dot(s.mid.up, n)) > 0.99 ? (isA ? s.w : s.a) : s.mid.up;
        } else return null;
      } else if (s.cross) {
        // פטה: פני הווב (a+ בצד התושבת), e1 כלפי מעלה
        if (!ref.face.startsWith('a')) return null;
        const sg = ref.face.endsWith('-') ? -1 : 1;
        n = scale(s.a, sg); base = add(s.P, scale(n, s.cross.wo)); e1 = s.u;
      } else {
        const sg = ref.face.endsWith('-') ? -1 : 1, isA = ref.face.startsWith('a');
        n = scale(isA ? s.a : s.w, sg); base = add(add(s.P, sh), scale(n, (isA ? s.mh : s.mb) / 2)); e1 = s.u;
      }
    } else if (ref.on === 'host') {
      if (s.mid) return null;
      n = s.n;
      const proj = sub(s.u, scale(n, dot(s.u, n)));
      // תושבת פטה: לאורך הפטה (פלטה "ניצבת" יושבת במישור הווב)
      e1 = s.cross ? s.w : len(proj) > 0.05 ? norm(proj) : s.hostAxis ? norm(sub(s.hostAxis, scale(n, dot(s.hostAxis, n)))) : s.a;
      if (ref.face === 'opp') { base = sub(s.P, scale(n, s.hd)); n = scale(n, -1); }
      else if (ref.face === 'web') { if (s.webOff === null) return null; base = sub(s.P, scale(n, s.webOff)); }
      else base = s.P;
    } else {
      const g = plates.get(ref.on); if (!g) return null;
      const sg = ref.face === 'z-' ? -1 : 1;
      n = scale(g.Z, sg); base = add(g.center, scale(n, g.t / 2)); e1 = g.Y;
      return { base, n, e1, e2: scale(cross(n, e1), g.hand), hand: g.hand };
    }
    return { base, n, e1, e2: scale(cross(n, e1), s.hand), hand: s.hand };
  };
  const at = (fr: Frame, along: number, across: number) => add(add(fr.base, scale(fr.e1, along)), scale(fr.e2, across));
  const targetOf = (on: string) => on === 'main' ? s.main.id : on === 'host' ? (s.host?.id ?? '') : (plates.get(on)?.memberId ?? '');

  const plateMember = (g: PlateGeom, name: string, contour: boolean, rt = false, suffix = ''): Member => {
    const xs = g.poly.map((p) => p[0]), ys = g.poly.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), yc = rt ? g.poly[0][1] : (y0 + y1) / 2;
    const W = (x: number, y: number) => add(add(g.center, scale(g.X, x)), scale(g.Y, y));
    const start = W(x0, yc), end = W(x1, yc);
    const b = Math.round(y1 - y0), t = Math.round(g.t);
    const desc = `${name} PL${t}×${b}×${Math.round(x1 - x0)}${suffix ? ` ${suffix}` : ''}`;
    const m: Member = {
      id: g.memberId, kind: 'plate', label: desc, start, end, profile: `PL${b}x${t}`, material: mat, rollDeg: 0, mirror: false,
      anchor: 'center', refUp: rt && g.Z.y < 0 ? scale(g.Z, -1) : g.Z, source: 'generated', manualPlacement: false, connId: cid, partDesc: contour && !rt ? `${desc} (צורה)` : desc,
    };
    if (contour) {
      const f = localFrame(m);
      m.contour = g.poly.map(([x, y]) => { const r = sub(W(x, y), start); return { s: r1(dot(r, f.ex)), u: r1(dot(r, f.u)) }; });
    }
    return m;
  };

  const holeSets = new Map<string, { cs: Vec3[]; axis: Vec3; d0: number; plate: string }>();
  for (const op of det.ops) {
    try {
      if (op.k === 'plate') {
        const w = ev(op.w, `${op.id}.w`, 100), h = op.shape === 'round' ? w : ev(op.h, `${op.id}.h`, 100), t = ev(op.t, `${op.id}.t`, 10);
        Object.assign(vals, { [`${op.id}.w`]: w, [`${op.id}.h`]: h, [`${op.id}.t`]: t });
        const fr = frame(op.ref);
        if (!fr) { errors[op.id] = 'הפנים שנבחרו לא קיימות באתר הזה'; continue; }
        const along = ev(op.ref.along, `${op.id}.along`), across = ev(op.ref.across, `${op.id}.across`);
        const spin = ev(op.spin, `${op.id}.spin`) * fr.hand * Math.PI / 180, off = ev(op.off, `${op.id}.off`);
        const ch = ev(op.ch, `${op.id}.ch`);
        const o = at(fr, along, across);
        let X: Vec3, Y: Vec3, Z: Vec3, center: Vec3;
        if (op.mode === 'flat') { Z = fr.n; Y = rotateAxis(fr.e1, Z, spin); X = scale(cross(Z, Y), fr.hand); center = add(o, scale(Z, t / 2 + off)); }
        else { X = fr.n; Y = rotateAxis(fr.e1, X, spin); Z = scale(cross(X, Y), fr.hand); center = add(o, scale(X, w / 2 + off)); }
        const poly = platePoly(op.shape, w, h, ch, op.corners);
        const g: PlateGeom = { id: op.id, center, X, Y, Z, t, w, h, poly, hand: fr.hand, memberId: `${cid}.${op.id}`, target: targetOf(op.ref.on) };
        plates.set(op.id, g);
        const pm = plateMember(g, op.name || 'פלטה', op.shape !== 'rect' && !(op.shape === 'cham' && (ch <= 0 || !op.corners.some(Boolean))), op.shape === 'rtri', op.suffix);
        // clipHost: קצה הפלטה שליד המארח נחתך במישור פני המארח (זווית חיתוך בחלק — כמו בקוד הישן, ו-NC1 מקבל את זווית החיתוך)
        if (op.clipHost && s.host && !s.cross) {
          const cut = { point: sub(s.P, scale(s.n, op.clipOff ? ev(op.clipOff, `${op.id}.clipOff`) : 0)), normal: scale(s.n, -1) };
          if (dot(sub(pm.start, s.P), s.n) <= dot(sub(pm.end, s.P), s.n)) pm.startCut = cut; else pm.endCut = cut;
        }
        if (op.clipHost && s.host && !s.cross) pm.partDesc = `${pm.partDesc ?? pm.label} (קצה חתוך בזווית)`;
        members.push(pm);
      } else if (op.k === 'endplate') {
        const t = ev(op.t, `${op.id}.t`, 15), w = ev(op.w, `${op.id}.w`, s.mh + 40), h = ev(op.h, `${op.id}.h`, s.mb + 40);
        const dx = ev(op.dx, `${op.id}.dx`), dy = ev(op.dy, `${op.id}.dy`);
        Object.assign(vals, { [`${op.id}.w`]: w, [`${op.id}.h`]: h, [`${op.id}.t`]: t });
        // פלטת הקצה תופסת את tp האחרונים של האלמנט: האלמנט מתקצר בעוביה
        const center = add(add(add(s.P, scale(s.u, sEnd - t / 2)), scale(s.a, dx)), scale(s.w, dy));
        const g: PlateGeom = { id: op.id, center, X: s.a, Y: s.w, Z: scale(s.u, -1), t, w, h, poly: platePoly('rect', w, h, 0, [false, false, false, false]), hand: s.hand, memberId: `${cid}.${op.id}`, target: s.main.id };
        plates.set(op.id, g);
        members.push(plateMember(g, 'פלטת קצה', false));
        const newEnd = add(s.P, scale(s.u, sEnd));
        const pl: Plane = { point: newEnd, normal: s.u };
        if (s.end === 'start') { main.start = newEnd; main.startCut = pl; } else { main.end = newEnd; main.endCut = pl; }
        endT = t;
      } else if (op.k === 'holes') {
        const fr = frame(op.ref);
        if (!fr) { errors[op.id] = 'הפנים לא קיימות'; continue; }
        const rows = Math.max(1, Math.round(ev(op.rows, `${op.id}.rows`, 1))), cols = Math.max(1, Math.round(ev(op.cols, `${op.id}.cols`, 2)));
        const px = ev(op.px, `${op.id}.px`, 60), py = ev(op.py, `${op.id}.py`, 60), d0 = ev(op.d0, `${op.id}.d0`, 18);
        const along = ev(op.ref.along, `${op.id}.along`), across = ev(op.ref.across, `${op.id}.across`);
        Object.assign(vals, { [`${op.id}.px`]: px, [`${op.id}.py`]: py, [`${op.id}.d0`]: d0 });
        const cs: Vec3[] = [];
        for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) if (!op.ring || i === 0 || i === rows - 1 || j === 0 || j === cols - 1) cs.push(at(fr, along + (i - (rows - 1) / 2) * py, across + (j - (cols - 1) / 2) * px));
        holeSets.set(op.id, { cs, axis: op.rev !== undefined && ev(op.rev, `${op.id}.rev`) ? scale(fr.n, -1) : fr.n, d0, plate: op.ref.on });
      } else if (op.k === 'bolts') {
        if (op.when !== undefined && op.when !== '' && !ev(op.when, `${op.id}.when`, 1)) continue;
        const hs = holeSets.get(op.holes);
        if (!hs) { errors[op.id] = 'אין קבוצת חורים — הוסיפו קודם חורים'; continue; }
        const d = Math.round(ev(op.d, `${op.id}.d`, 16));
        vals[`${op.id}.d`] = d;
        const cand: Member[] = [...members.filter((m) => m.kind === 'plate' || m.kind === 'cleat'), ...(opts.extra ?? []), ...(op.noMain || s.mid?.through ? [] : [main]), ...(s.host ? [s.host] : [])];
        const testers = cand.map((m) => ({ m, t: new PrismTester(m) }));
        const own = plates.get(hs.plate)?.memberId;
        const scanR = op.reach !== undefined ? Math.ceil(ev(op.reach, `${op.id}.reach`)) + 60 : 200; // חלון הסריקה לאורך הבורג
        hs.cs.forEach((c, i) => {
          // סריקה לאורך ציר הבורג: קטעי חומר רציפים סביב הפלטה של החורים
          const segs: { m: string; lo: number; hi: number }[] = [];
          for (const { m, t } of testers) {
            const inside = (k: number) => t.depth(add(c, scale(hs.axis, k))) > 0;
            // חידוד הגבולות בחיפוש בינארי (דיוק 0.01 מ"מ) — ראש/אום צמודים לפני החלק בלי חדירה
            const edge = (a: number, b: number) => { for (let it = 0; it < 14; it++) { const mdl = (a + b) / 2; if (inside(mdl)) a = mdl; else b = mdl; } return b; };
            // קטעים רציפים בלבד (בחתך I — כל אגף בנפרד)
            let run: number | null = null;
            for (let k = -scanR; k <= scanR + 1; k += 1) {
              const In = k <= scanR && inside(k);
              if (In && run === null) run = k;
              if (!In && run !== null) { segs.push({ m: m.id, lo: edge(run, run - 1), hi: edge(k - 1, k) }); run = null; }
            }
          }
          const start = segs.find((g) => g.m === own) ?? segs.find((g) => g.lo <= 0.5 && g.hi >= -0.5);
          if (!start) { errors[op.id] = 'הבורג לא עובר בשום חלק'; return; }
          let lo = start.lo, hi = start.hi; const used = new Set([start.m]);
          // ברגי עוגן: רק הפלטה — לא מצרפים את חומר העמוד שמעליה (גם כשהבורג בתוך שטח החתך, כמו בקוד הישן)
          const gap = op.reach !== undefined ? ev(op.reach, `${op.id}.reach`) : 2;
          for (let ch = !op.anchor; ch;) { ch = false; for (const g of segs) if (!used.has(g.m) && g.lo <= hi + gap && g.hi >= lo - gap) { lo = Math.min(lo, g.lo); hi = Math.max(hi, g.hi); used.add(g.m); ch = true; } }
          if (used.size < 2 && !op.anchor) issues.push({ code: 'CD_BOLT', severity: 'warning', elementId: cid, message: `פרט ${det.name}: בורג ${op.id}-${i + 1} עובר בחלק אחד בלבד — חסרה פלטה נגדית?` });
          // ברגי עוגן: הראש/האום מעל הפלטה (w + m + 2P), האורך = עיגון + עובי + אותו מרווח — כמו הקוד הישן
          const hb = hw(d), lead = op.anchor ? hb.w + hb.m + 2 * hb.P : 0;
          const grip = op.grip !== undefined && op.grip !== '' ? ev(op.grip, `${op.id}.grip`) : Math.round(hi - lo);
          const head = add(c, scale(hs.axis, lo - lead));
          let ru = frame({ on: hs.plate, face: 'z+' })?.e1 ?? s.a;
          if (Math.abs(dot(ru, hs.axis)) > 0.99) ru = s.mid?.bu ?? s.mid?.up ?? s.a; // כיוון הראש לא מקביל לציר הבורג (בסיס: e1 = ציר העמוד)
          if (op.headUp) ru = op.headUp === 'Z' ? v3(0, 0, 1) : v3(1, 0, 0);
          else if (op.anchor && Math.abs(hs.axis.x) < 0.5) ru = v3(1, 0, 0); // ברגי עוגן אנכיים: הראש מכוון ל-X העולמי (כמו הקוד הישן)
          bolts.push(makeBolt(`${cid}.${op.id}.${i + 1}`, cid, head, hs.axis, { d, grade: op.grade, standard: op.standard ?? 'ISO 4017', clearance: Math.max(1, hs.d0 - d) }, grip, op.site ? 'site' : 'shop', [...used], ru, members, op.anchor ? ev(op.anchor, `${op.id}.anchor`) + grip + lead : undefined));
        });
      } else if (op.k === 'weld') {
        const a = ev(op.a, `${op.id}.a`, 5);
        // ריתוך ישיר של האלמנט הראשי למארח (בלי פלטה): part = 'main', האורך מפורש
        if (op.part === 'main') {
          if (!s.host || op.len === undefined || op.len === '') { errors[op.id] = 'ריתוך ישיר דורש מארח ואורך מפורש'; continue; }
          welds.push({ id: `${cid}.${op.id}`, connId: cid, type: 'fillet', a, length: Math.round(ev(op.len, `${op.id}.len`)), location: op.site ? 'site' : 'shop', between: [s.host.id, s.main.id], from: s.P, to: s.P });
          if (op.site && !BUILTIN_RECIPES[det.id]) issues.push({ code: 'CD_SITE_WELD', severity: 'warning', elementId: cid, message: `פרט ${det.name}: ריתוך בשטח — סותר את עיקרון הגלוון (ריתוך במסגריה, ברגים בשטח)` });
          continue;
        }
        const g = plates.get(op.part);
        if (!g) { errors[op.id] = 'בחרו פלטה לריתוך'; continue; }
        const to = op.to ? targetOf(op.to) : g.target;
        if (!to) { errors[op.id] = 'אין למה לרתך'; continue; }
        const pOp = det.ops.find((x) => x.id === op.part);
        let length = 0; let from = g.center, toP = g.center;
        if (pOp?.k === 'endplate') { length = 2 * (s.mh + s.mb); }
        else if (pOp?.k === 'plate' && pOp.mode === 'flat') { for (let i = 0; i < g.poly.length; i++) { const p = g.poly[i], q = g.poly[(i + 1) % g.poly.length]; length += Math.hypot(q[0] - p[0], q[1] - p[1]); } }
        else if (pOp?.k === 'plate') {
          const off = ev(pOp.off, '_'), x0 = -g.w / 2;
          if (pOp.ref.on === 'main' && pOp.ref.face === 'end' && off < 0) length = 4 * -off;
          else for (let i = 0; i < g.poly.length; i++) { const p = g.poly[i], q = g.poly[(i + 1) % g.poly.length]; if (Math.abs(p[0] - x0) < 0.5 && Math.abs(q[0] - x0) < 0.5) { length += 2 * Math.abs(q[1] - p[1]); from = add(add(g.center, scale(g.X, x0)), scale(g.Y, p[1])); toP = add(add(g.center, scale(g.X, x0)), scale(g.Y, q[1])); } }
        }
        if (op.len !== undefined && op.len !== '') length = ev(op.len, `${op.id}.len`);
        if (op.ax !== undefined && s.mid) { from = add(s.P, scale(s.u, ev(op.ax, `${op.id}.ax`))); toP = from; }
        welds.push({ id: `${cid}.${op.id}`, connId: cid, type: 'fillet', a, length: op.exact ? length : Math.round(length), location: op.site ? 'site' : 'shop', between: s.mid ? [to, g.memberId] : [g.memberId, to], from, to: toP });
        if (op.site && !BUILTIN_RECIPES[det.id]) issues.push({ code: 'CD_SITE_WELD', severity: 'warning', elementId: cid, message: `פרט ${det.name}: ריתוך בשטח — סותר את עיקרון הגלוון (ריתוך במסגריה, ברגים בשטח)` });
      } else if (op.k === 'vent') {
        const d = ev(op.d, `${op.id}.d`, 12), atS = ev(op.at, `${op.id}.at`, 30);
        for (const sg of [1, -1]) vents.push({ memberId: s.main.id, p: add(add(s.P, scale(s.u, sEnd + atS)), scale(s.a, (sg * s.mh) / 2)), axis: scale(s.a, -sg), d });
      } else if (op.k === 'angle') {
        const H = ev(op.H, `${op.id}.H`, 100), B = ev(op.B, `${op.id}.B`, 60), t = ev(op.t, `${op.id}.t`, 8), w = ev(op.w, `${op.id}.w`, 100);
        Object.assign(vals, { [`${op.id}.H`]: H, [`${op.id}.B`]: B, [`${op.id}.t`]: t, [`${op.id}.w`]: w });
        const fr = frame(op.ref);
        if (!fr) { errors[op.id] = 'הפנים שנבחרו לא קיימות באתר הזה'; continue; }
        const Q = at(fr, ev(op.ref.along, `${op.id}.along`), ev(op.ref.across, `${op.id}.across`));
        const up = fr.e1, dd = fr.n, Yw = v3(0, 1, 0);
        let yd = fr.e2; if (dot(yd, Yw) < 0) yd = scale(yd, -1);
        if (op.vert) {
          // זוויתן עומד: ציר לאורך up (אורך w), רגל מוברגת צמודה לפנים (dd), הפינה מוסטת ב-off לאורך yd
          const off = ev(op.off ?? '0', `${op.id}.off`), C0 = add(Q, scale(yd, off));
          const prof = H === B ? `L${Math.round(H)}x${Math.round(t)}` : `L${Math.round(H)}x${Math.round(B)}x${Math.round(t)}`;
          const desc = `${op.name || 'זוויתן עומד'} ${prof} באורך ${Math.round(w * 100) / 100}`;
          const gv: PlateGeom = { id: op.id, center: add(add(C0, scale(up, w / 2)), scale(dd, t / 2)), X: yd, Y: up, Z: dd, t, w: B, h: w, poly: platePoly('rect', B, w, 0, [false, false, false, false]), hand: fr.hand, memberId: `${cid}.${op.id}`, target: s.host?.id ?? '' };
          plates.set(op.id, gv);
          members.push({
            id: gv.memberId, kind: 'cleat', label: desc, start: C0, end: add(C0, scale(up, w)), profile: prof, material: mat,
            rollDeg: 0, mirror: dot(cross(dd, up), Yw) < 0, anchor: 'corner', refUp: dd, source: 'generated', manualPlacement: false, connId: cid, partDesc: desc,
          });
          continue;
        }
        const mid = add(Q, scale(up, H / 2));
        const g: PlateGeom = { id: op.id, center: add(mid, scale(dd, t / 2)), X: yd, Y: up, Z: dd, t, w, h: H, poly: platePoly('rect', w, H, 0, [false, false, false, false]), hand: fr.hand, memberId: `${cid}.${op.id}`, target: s.host?.id ?? '' };
        plates.set(op.id, g);
        const desc = `${op.name || 'זוויתן'} L${Math.round(H)}×${Math.round(B)}×${Math.round(t)}, רוחב ${Math.round(w)}`;
        members.push({
          id: g.memberId, kind: 'cleat', label: desc, start: sub(Q, scale(yd, w / 2)), end: add(Q, scale(yd, w / 2)), profile: `L${Math.round(H)}x${Math.round(B)}x${Math.round(t)}`, material: mat,
          rollDeg: 0, mirror: dot(cross(up, Yw), dd) < 0, anchor: 'corner', refUp: up, source: 'generated', manualPlacement: false, connId: cid, partDesc: desc,
        });
      } else if (op.k === 'rod' && op.holes) {
        // מוט בכל חור של הקבוצה (G5/G6): מרותך לפלטה `to`, והחורים נרשמים בפלטה
        const hs = holeSets.get(op.holes), pg = op.to ? plates.get(op.to) : undefined;
        if (!hs || !pg) { errors[op.id] = 'אין קבוצת חורים או פלטה למוטות'; continue; }
        const d = ev(op.d, `${op.id}.d`, 20), L = ev(op.L, `${op.id}.L`, 200), a = ev(op.a, `${op.id}.a`, 5);
        hs.cs.forEach((c, i) => {
          const id = `${cid}.${op.id}${i + 1}`;
          members.push({ id, kind: 'anchor', label: op.label ? `${op.label} Φ${Math.round(d)}` : `מוט הברגה M${Math.round(d)}×${Math.round(L)}`, start: c, end: add(c, scale(hs.axis, L)), profile: `RD${Math.round(d)}`, material: op.material ?? mat, rollDeg: 0, mirror: false, anchor: 'center', refUp: s.a, source: 'generated', manualPlacement: false, connId: cid, partDesc: op.label ? `${op.label} Φ${Math.round(d)}${op.desc ? ` L=${Math.round(L)} ${op.desc}` : ''}` : `מוט הברגה M${Math.round(d)}×${Math.round(L)}` });
          welds.push({ id: `${cid}.${op.id}W${i + 1}`, connId: cid, type: 'fillet', a, length: Math.round(Math.PI * d), location: 'shop', between: [pg.memberId, id], from: c, to: c });
          (connHoles ??= []).push({ id: `${cid}.${op.id}H${i + 1}`, memberId: pg.memberId, p: c, axis: hs.axis, d: hs.d0 });
        });
      } else if (op.k === 'rod') {
        const fr = frame(op.ref);
        if (!fr) { errors[op.id] = 'הפנים לא קיימות'; continue; }
        const d = ev(op.d, `${op.id}.d`, 20), L = ev(op.L, `${op.id}.L`, 200);
        const o = at(fr, ev(op.ref.along, `${op.id}.along`), ev(op.ref.across, `${op.id}.across`));
        const id = `${cid}.${op.id}`;
        members.push({ id, kind: 'anchor', label: `מוט הברגה M${Math.round(d)}×${Math.round(L)}`, start: o, end: add(o, scale(fr.n, L)), profile: `RD${Math.round(d)}`, material: mat, rollDeg: 0, mirror: false, anchor: 'center', refUp: fr.e1, source: 'generated', manualPlacement: false, connId: cid, partDesc: `מוט הברגה M${Math.round(d)}×${Math.round(L)}` });
        const tgt = targetOf(op.ref.on);
        if (tgt) welds.push({ id: `${id}.W`, connId: cid, type: 'fillet', a: 4, length: Math.round(Math.PI * d), location: 'shop', between: [id, tgt], from: o, to: o });
      } else if (op.k === 'slot') {
        vals[`${op.id}.L`] = ev(op.L, `${op.id}.L`, 100); vals[`${op.id}.w`] = ev(op.w, `${op.id}.w`, 12);
      }
    } catch (e) { errors[op.id] = (e as Error).message; }
  }

  // בדיקות: מרחק שפה לחורים, התנגשויות
  const d0Of = (b: BoltInfo) => b.hole;
  for (const pm of members.filter((m) => m.kind === 'plate')) {
    const f = localFrame(pm), b = getProfile(pm.profile).dims.b ?? 0, L = len(sub(pm.end, pm.start));
    const poly = pm.contour ? pm.contour.map((q) => [q.s, q.u] as [number, number]) : [[0, -b / 2], [L, -b / 2], [L, b / 2], [0, b / 2]] as [number, number][];
    for (const bo of bolts.filter((x) => x.holesIn.includes(pm.id))) {
      const r = sub(bo.p, pm.start), q: [number, number] = [dot(r, f.ex), dot(r, f.u)];
      let dmin = Infinity;
      for (let i = 0; i < poly.length; i++) { const A = poly[i], B = poly[(i + 1) % poly.length]; const dx = B[0] - A[0], dy = B[1] - A[1], LL = dx * dx + dy * dy || 1; const tt = Math.max(0, Math.min(1, ((q[0] - A[0]) * dx + (q[1] - A[1]) * dy) / LL)); dmin = Math.min(dmin, Math.hypot(A[0] + tt * dx - q[0], A[1] + tt * dy - q[1])); }
      if (dmin < 1.2 * d0Of(bo) - 0.5) { issues.push({ code: 'CD_EDGE', severity: 'warning', elementId: cid, message: `פרט ${det.name}: ${pm.label} — מרחק שפה לחור ${dmin.toFixed(0)} < 1.2·d0 = ${(1.2 * d0Of(bo)).toFixed(0)} מ"מ` }); break; }
    }
  }
  const slot = det.ops.some((o) => o.k === 'slot');
  const parts = members.filter((m) => m.kind === 'plate' || m.kind === 'anchor');
  const hard = [...(s.mid?.through ? [] : [main]), ...(s.host ? [s.host] : [])];
  // ברגי עוגן עוברים בפלטה (ובחתך העמוד) מעצם הגדרתם — לא נבדקים (כמו בקוד הישן)
  const anchorPre = det.ops.filter((o) => o.k === 'bolts' && o.anchor).map((o) => `${cid}.${o.id}.`);
  const bh = members.filter((m) => m.kind === 'bolt' && /\.(H|N|W)$/.test(m.id) && !anchorPre.some((x) => m.id.startsWith(x)));
  const tests: [Member, Member][] = [];
  for (const p of parts) {
    for (const h of hard) {
      const pOp = det.ops.find((o) => `${cid}.${o.id}` === p.id);
      if (h === main && slot && pOp?.k === 'plate' && pOp.ref.on === 'main') continue;
      tests.push([p, h]);
    }
  }
  const rodThru = new Set(det.ops.filter((o) => o.k === 'rod' && o.holes && o.to).map((o) => `${cid}.${(o as { to: string }).to}`));
  for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) { if ((parts[i].kind === 'anchor' && rodThru.has(parts[j].id)) || (parts[j].kind === 'anchor' && rodThru.has(parts[i].id))) continue; tests.push([parts[i], parts[j]]); } // מוט עוגן עובר בחור הפלטה
  for (const b of bh) for (const h of [...hard, ...parts]) tests.push([b, h]);
  for (const o of opts.others ?? []) for (const p of parts) tests.push([p, o]);
  for (const [x, y] of tests) {
    const c = clash(x, y);
    // דיסקית: סבולת ליציאה קלה (פילט/רדיוס שורש מול שפת הטבעת) — חדירה עד 1 מ"מ אינה התנגשות (קוטר חיצוני בסבולת, רדיוסי כיפוף לא מדגמנים)
    if (c && !(x.id.endsWith('.W') && c.depth <= 1)) issues.push({ code: 'CLASH', severity: 'error', elementId: x.id, message: `פרט ${det.name}: התנגשות ${x.label} ↔ ${y.label} — חדירה ${c.depth.toFixed(1)} מ"מ` });
  }
  if (!s.host && !BUILTIN_RECIPES[det.id]) issues.push({ code: 'CD_FREE', severity: 'info', elementId: cid, message: `פרט ${det.name}: קצה חופשי — לא נמצא אלמנט מארח מול הקצה` });
  for (const [k, e] of Object.entries(errors)) issues.push({ code: 'CD_EXPR', severity: 'error', elementId: cid, message: `פרט ${det.name}: ${k} — ${e}` });

  const conn: Connection = {
    id: cid, type: 'custom', label: `${det.name} — ${s.main.label} (${s.mid ? `חיבור המשך ${(s.mid.t / 1000).toFixed(3)} מ'` : s.cross ? `תושבת ${s.host?.label ?? ''}` : s.end === 'start' ? 'התחלה' : 'סוף'})`,
    members: [...(s.host ? [s.host.id] : []), s.main.id, ...(s.mid?.partner ? [s.mid.partner] : [])], parts: [...members.filter((m) => !(m.kind === 'bolt')).map((m) => m.id), ...bolts.map((b) => b.id)],
    bolts, welds, status: 'not-verified', fixity: 'pinned', overridden: true, vents: vents.length ? vents : undefined, ...(connHoles ? { holes: connHoles } : {}), custom: { detailId: det.id, site: s.key },
  };
  return { site: s, main, members, conn, issues, values: vals, errors, plates, frame, sEnd };
}

/**
 * החלת פרטים מותאמים על המודל: לכל אתר משויך — הסרת חלקי החיבור הקיימים בקצה, חיתוך האלמנט מחדש ובניית הפרט.
 * משנה את members/connections במקום.
 */
export function applyCustomDetails(project: Project, members: Member[], connections: Connection[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  // שיוך מפורש (פרויקט) קודם; שיוך משתמע ממתכון מובנה (`Connection.recipe`) — רק לקצוות שאין להם שיוך מפורש
  const { assign: implicit, params: implicitParams, pairs, own, anchors } = recipeSites(project, connections);
  const assign: Record<string, string> = { ...implicit, ...(project.detailAssign ?? {}) };
  const lib = new Map((project.customDetails ?? []).map((d) => [d.id, d]));
  // אינדקס מזהים אחד לכל הריצה (ולא בנייה מחדש בכל אתר) — מתעדכן עם כל הוספה/הסרה/החלפה של אלמנט
  const index = new Map(members.map((x) => [x.id, x]));
  const orig = new Map<string, Member>();
  const ctx: SiteCtx = { splices: project.splices, anchors };
  for (const [key, did] of Object.entries(assign)) {
    const det = lib.get(did) ?? builtinRecipe(did);
    const { id, end } = parseSiteKey(key);
    const idx = members.findIndex((m) => m.id === id);
    if (idx < 0) continue; // האלמנט לא קיים במודל הנוכחי (מסגרת שנמחקה וכד')
    if (!det) { issues.push({ code: 'CD_MISSING', severity: 'warning', elementId: id, message: `פרט מותאם לא נמצא בספרייה עבור ${id}` }); continue; }
    // כל קצה נבנה מהאלמנט המקורי (לפני שהקצה השני הוחל): אחרת הקצה הראשון מטה את הציר והשני נמדד על ציר מוטה (רעש עיגול בפרטים תלויי-זווית)
    const cur = members[idx];
    const m = orig.get(id) ?? cur;
    orig.set(id, m);
    const sees = () => (m === cur ? members : members.map((x) => (x === cur ? m : x)));
    const site = findSite(sees(), m, end, ctx);
    if (!site) continue;
    // הסרת חלקי חיבור קיימים בקצה הזה
    const ownConn = site.cross?.conn ?? own[key] ?? site.mid?.conn;
    const kill = partsToReplace(members, connections, m, site.E, site.O, ownConn, index);
    if (ownConn) { const i = connections.findIndex((c) => c.id === ownConn); if (i >= 0) connections.splice(i, 1); }
    const touched = new Set<Connection>();
    for (const c of connections) {
      if (!c.parts.some((p) => kill.has(p)) && !c.bolts.some((b) => kill.has(b.id))) continue;
      touched.add(c);
      c.parts = c.parts.filter((p) => !kill.has(p));
      c.bolts = c.bolts.filter((b) => !kill.has(b.id));
      c.welds = c.welds.filter((w) => !w.between.some((x) => kill.has(x)));
    }
    for (let i = connections.length - 1; i >= 0; i--) {
      const c = connections[i];
      // רק חיבורים שאיבדו חלקים עכשיו (חיבור ריתוכי כמו מסבך הנעילה, שחלקיו אלכסונים, לא נמחק רק כי אין בו פלטות)
      if (touched.has(c) && c.type !== 'custom' && !c.bolts.length && !c.parts.some((p) => members.some((x) => x.id === p && REMOVABLE.has(x.kind) && !kill.has(p)))) connections.splice(i, 1);
    }
    for (let i = members.length - 1; i >= 0; i--) if (kill.has(members[i].id)) { index.delete(members[i].id); members.splice(i, 1); }
    const site2 = findSite(sees(), m, end, ctx) ?? site;
    // אלמנטים סמוכים (פטות, קושרות, פלטות של חיבורים אחרים) — לבדיקת התנגשות עם חלקי הפרט
    const box = { c: site2.P, r: 900 };
    const others = members.filter((x) => x.id !== m.id && x.id !== site2.host?.id && x.kind !== 'bolt' && ['column', 'rafter', 'purlin', 'cleat', 'plate', 'brace', 'beam', 'girt'].includes(x.kind)
      && !x.connId?.startsWith('C.CD.') && Math.min(len(sub(x.start, box.c)), len(sub(x.end, box.c)), len(sub(scale(add(x.start, x.end), 0.5), box.c))) < box.r);
    const ovr = (k: string) => (implicitParams[k] || project.detailParams?.[k] ? { ...implicitParams[k], ...project.detailParams?.[k] } : undefined);
    // אתר זוגי: הפלטה של האתר שכנגד נבנית מראש (טהור) כדי שהברגים המשותפים יעברו גם דרכה
    let extra: Member[] | undefined;
    if (site2.mid?.partner) { const pm0 = index.get(site2.mid.partner); if (pm0) extra = [pm0]; }
    const pk = pairs[key];
    if (pk) {
      const pp = parseSiteKey(pk), pm = members.find((x) => x.id === pp.id), ps = pm ? findSite(members, pm, pp.end, ctx) : null;
      if (ps) extra = buildDetail(ps, det, { material: project.building.material, others, overrides: ovr(pk) }).members.filter((x) => x.kind === 'plate');
    }
    const r = buildDetail(site2, det, { material: project.building.material, others, overrides: ovr(key), extra, ...(site2.mid && ownConn ? { connId: ownConn } : {}) });
    const k = members.findIndex((x) => x.id === m.id);
    if (k >= 0) {
      const merged: Member = site2.cross || site2.mid ? r.main : { ...members[k]!, ...(end === 'start' ? { start: r.main.start, startCut: r.main.startCut } : { end: r.main.end, endCut: r.main.endCut }), connId: r.main.connId };
      members[k] = merged; index.set(merged.id, merged);
    }
    members.push(...r.members);
    for (const x of r.members) index.set(x.id, x);
    connections.push(r.conn);
    issues.push(...r.issues);
  }
  return issues;
}

const recipeCache = new Map<string, CustomDetail>();
/** מתכון מובנה לפי מזהה (אותו אובייקט בכל קריאה) */
export function builtinRecipe(id: string): CustomDetail | undefined {
  let r = recipeCache.get(id);
  if (!r && BUILTIN_RECIPES[id]) { r = BUILTIN_RECIPES[id]!(); recipeCache.set(id, r); }
  return r;
}
/** פרט לפי מזהה: הספרייה בפרויקט, ואחריה המתכונים המובנים */
export function findDetail(project: Project, id: string): CustomDetail | undefined { return (project.customDetails ?? []).find((x) => x.id === id) ?? builtinRecipe(id); }

/** קצוות שמתכון מובנה מוחל עליהם אוטומטית (חיבור עם `recipe`): שיוך וערכי פרמטרים לשני קצוות האלמנט הראשי של החיבור */
function recipeSites(project: Project, connections: Connection[]): { assign: Record<string, string>; params: Record<string, Record<string, number>>; pairs: Record<string, string>; own: Record<string, string>; anchors: Record<string, SiteAnchor> } {
  const assign: Record<string, string> = {}, params: Record<string, Record<string, number>> = {}, pairs: Record<string, string> = {}, own: Record<string, string> = {}, anchors: Record<string, SiteAnchor> = {};
  for (const c of connections) {
    if (!c.recipe) continue;
    for (const k of c.recipe.sites ?? ['start', 'end'].map((end) => `${c.parts[0]}|${end}`)) { if (project.detailAssign?.[k]) continue; assign[k] = c.recipe.id; params[k] = { ...c.recipe.params, ...c.recipe.siteParams?.[k] }; if (c.recipe.own) own[k] = c.id; const an = c.recipe.anchors?.[k]; if (an) anchors[k] = an; }
    // אתר זוגי: אם לאחד מהצדדים הוקצה במפורש פרט אחר — הצד הנותר בונה את הברגים לבדו (ללא שותף)
    for (const [b, q] of Object.entries(c.recipe.pairs ?? {})) {
      const ab = assign[b] === c.recipe.id, aq = assign[q] === c.recipe.id;
      if (ab && aq) pairs[b] = q;
      else if (ab) params[b] = { ...params[b], prt: 0 };
      else if (aq) params[q] = { ...params[q], bld: 1, prt: 0 };
    }
  }
  return { assign, params, pairs, own, anchors };
}

/** חלקי החיבורים הקיימים בקצה האלמנט (פלטות, זוויתנים, ברגים, עיגונים) — מוחלפים בפרט המותאם */
export function partsToReplace(members: Member[], connections: Connection[], m: Member, E: Vec3, O: Vec3, crossConn?: string, index?: Map<string, Member>): Set<string> {
  if (crossConn) {
    const c = connections.find((x) => x.id === crossConn), kill = new Set<string>();
    if (c) { for (const p of c.parts) kill.add(p); for (const b of c.bolts) { kill.add(b.id); for (const k of ['H', 'S', 'N', 'W']) kill.add(`${b.id}.${k}`); } }
    return kill;
  }
  const near = (p: Vec3) => len(sub(p, E)) < len(sub(p, O)) && len(sub(p, E)) < 800;
  const kill = new Set<string>();
  const byId = index ?? new Map(members.map((x) => [x.id, x]));
  for (const c of connections) {
    if (c.type === 'custom' || !(c.parts.includes(m.id) || c.members.includes(m.id))) continue;
    for (const pid of c.parts) {
      const pm = byId.get(pid);
      if (pm && REMOVABLE.has(pm.kind) && near(scale(add(pm.start, pm.end), 0.5))) kill.add(pid);
    }
    for (const b of c.bolts) if (near(b.p)) { kill.add(b.id); for (const k of ['H', 'S', 'N', 'W']) kill.add(`${b.id}.${k}`); }
  }
  return kill;
}

/** חתימת "דומים" לאתר: אותו סוג אלמנט, אותו קצה-מארח, ואותו חתך (אופציונלי) */
export function siteSignature(members: Member[], m: Member, end: End, withProfile = true): string {
  const s = findSite(members, m, end);
  const role = m.id.split('.')[0];
  return [m.kind, role, s?.host?.kind ?? 'free', withProfile ? m.profile : '', s ? Math.round(s.ang / 5) * 5 : 0].join('|');
}
export function similarSites(members: Member[], key: string, withProfile = true, connections?: Connection[]): string[] {
  const { id, end } = parseSiteKey(key);
  const m = members.find((x) => x.id === id); if (!m) return [key];
  if (end.startsWith('x:')) {
    // תושבות פטה: כל התושבות (אותו חתך פטה — אופציונלי)
    const byId = new Map(members.map((x) => [x.id, x]));
    const ks = (connections ?? []).filter((c) => c.type === 'purlin-cleat' || (c.custom && c.custom.site.includes('|x:'))).map((c) => c.custom ? c.custom.site : `${c.members[0]}|x:${c.id.split('.').pop()}`)
      .filter((k) => { const p = byId.get(parseSiteKey(k).id); return p && (!withProfile || p.profile === m.profile); });
    return [...new Set([key, ...ks])];
  }
  const sig = siteSignature(members, m, end, withProfile);
  const out: string[] = [];
  for (const x of members) {
    if (x.kind !== m.kind || x.id.split('.')[0] !== m.id.split('.')[0]) continue;
    if (!withProfile && false) continue;
    for (const e of ['start', 'end'] as End[]) if (siteSignature(members, x, e, withProfile) === sig) out.push(siteKey(x.id, e));
  }
  return out.length ? out : [key];
}

// ---------- פרטים מוכנים לספרייה ----------
/** האם פרט מוכן מתאים לאתר (לפי תנאי ההתאמה שלו); פרט בלי תנאים — מתאים לכל אתר שאינו תושבת */
export function presetFits(det: CustomDetail, site: Site | null): boolean {
  if (!site) return false;
  if ((det.family === 'cleat') !== !!site.cross) return false;
  if ((det.family === 'splice') !== !!site.mid) return false;
  const mt = det.match;
  if (!mt) return true;
  const fam = (id?: string) => (id ? tryProfile(id)?.family ?? '' : '');
  if (mt.member?.length && !mt.member.includes(fam(site.main.profile))) return false;
  if (mt.host?.length && !mt.host.includes(fam(site.host?.profile))) return false;
  const a = Math.round(site.ang);
  return !((mt.angMin !== undefined && a < mt.angMin) || (mt.angMax !== undefined && a > mt.angMax));
}
const R = (on: string, face: string, along = '0', across = '0'): DetailRef => ({ on, face, along, across });
const pBolt = (opts: number[]): DetailParam => ({ name: 'd', label: 'קוטר בורג', kind: 'select', group: 'ברגים', options: opts.map((v) => ({ value: v, label: `M${v}` })) });
const pNum = (name: string, label: string, min: number, max: number, group: string, hint?: string): DetailParam => ({ name, label, kind: 'number', unit: 'מ"מ', min, max, group, ...(hint ? { hint } : {}) });
export function detailPresets(): CustomDetail[] {
  return [...basePresets(), ...(structuredClone(CONN_LIBRARY) as CustomDetail[])];
}
function basePresets(): CustomDetail[] {
  return [
    {
      id: 'preset-flange', name: 'פלטה מוברגת לפני המארח', family: 'any',
      note: 'פלטה שוכבת על פני המארח, מרותכת לקצה האלמנט במסגריה ומוברגת למארח בשטח. 4 ברגים מחוץ להיטל האלמנט.',
      vars: [
        { name: 'd', expr: '16', note: 'קוטר בורג' }, { name: 'd0', expr: 'd+2', note: 'קוטר חור' }, { name: 'e', expr: 'max(30, r5(1.5*d0))', note: 'מרחק שפה' },
        { name: 'c2', expr: 'hb >= r5(mb + 2*d0 + 20) + 2*e', note: '1 = הברגים לצד האלמנט; 0 = אגף צר — הברגים לפני ואחרי האלמנט, משני צדי הווב' },
        { name: 'g', expr: 'if(c2, r5(mb + 2*d0 + 20), r5(htw + 2*d + 40))', note: 'מרחק בין עמודות ברגים' },
        { name: 'p', expr: 'r5(mh/sin(ang) + if(c2, 2*d0 + 20, 4*d/tan(ang) + 2*d + 20))', note: 'מרחק בין שורות ברגים' },
      ],
      params: [pBolt([12, 16, 20, 24]), pNum('e', 'מרחק שפה', 25, 100, 'ברגים'), pNum('p', 'מרחק בין שורות ברגים', 40, 300, 'ברגים', 'ברירת המחדל מחושבת מגובה האלמנט והזווית')],
      ops: [
        { k: 'plate', id: 'P1', name: 'פלטת חיבור', ref: R('host', 'hit'), mode: 'flat', spin: '0', off: '0', shape: 'rect', w: 'max(g+2*e, mb+20)', h: 'p+2*e', t: '12', ch: '0', corners: [false, false, false, false] },
        { k: 'cut', id: 'C1', kind: 'host', at: 'P1.t' },
        { k: 'holes', id: 'H1', ref: R('P1', 'z+'), rows: '2', cols: '2', px: 'g', py: 'p', d0: 'd0' },
        { k: 'bolts', id: 'B1', holes: 'H1', d: 'd', grade: '8.8', site: true },
        { k: 'weld', id: 'W1', part: 'P1', a: 'max(4, ceil(mt))', site: false, to: 'main' },
      ],
    },
    {
      id: 'preset-fin', name: 'סנפיר על המארח + לשונית בחריץ', family: 'any',
      note: 'סנפיר מרותך למארח במסגריה; לשונית בחריץ האלמנט, מרותכת אליו; בשטח — שני ברגים בחפיפה. מתאים לכל זווית.',
      vars: [
        { name: 'd', expr: '16' }, { name: 'd0', expr: 'd+2' }, { name: 'e', expr: 'max(30, r5(1.5*d0))' }, { name: 'p', expr: 'r5(2.6*d0)', note: 'מרווח ברגים' },
        { name: 'tk', expr: '10', note: 'עובי לשונית' }, { name: 'tg', expr: '10', note: 'עובי סנפיר' }, { name: 'kh', expr: 'mh+40', note: 'גובה לשונית' },
        { name: 'ins', expr: 'r5(max(80, mh))', note: 'אורך הכניסה לחריץ' },
        { name: 'stip', expr: '(10 + kh/2*cos(ang))/sin(ang)', note: 'קצה הלשונית מהמארח (לאורך הציר)' },
        { name: 'sb1', expr: 'stip + e' }, { name: 'sb2', expr: 'sb1 + p' }, { name: 'sm', expr: '(sb1+sb2)/2' },
        { name: 'gw', expr: 'r5(sb2*sin(ang) + e)', note: 'בליטת הסנפיר מהמארח' },
        { name: 'gh', expr: 'r5((sb2-sb1)*cos(ang) + 2*e + 40)', note: 'גובה הסנפיר' },
        { name: 'cutAt', expr: 'r5(max(sb2 + e + 20, (gw + 10 + mh/2*cos(ang))/sin(ang)))', note: 'קצה האלמנט מהמפגש' },
      ],
      params: [pBolt([12, 16, 20]), pNum('p', 'מרווח בין ברגים', 40, 150, 'ברגים'), pNum('tk', 'עובי לשונית', 6, 25, 'פלטות'), pNum('tg', 'עובי סנפיר', 6, 25, 'פלטות'), pNum('kh', 'גובה לשונית', 60, 400, 'פלטות')],
      ops: [
        { k: 'cut', id: 'C1', kind: 'perp', at: 'cutAt' },
        { k: 'slot', id: 'S1', L: 'ins+10', w: 'tk+2', dir: 'a' },
        { k: 'plate', id: 'T1', name: 'לשונית', ref: R('main', 'end'), mode: 'stand', spin: '0', off: '-ins', shape: 'rect', w: 'cutAt - stip + ins', h: 'kh', t: 'tk', ch: '0', corners: [false, false, false, false] },
        { k: 'plate', id: 'G1', name: 'סנפיר', ref: R('host', 'hit', 'sm*cos(ang)', '-(tg+tk)/2'), mode: 'stand', spin: '0', off: '0', shape: 'rect', w: 'gw', h: 'gh', t: 'tg', ch: '0', corners: [false, false, false, false] },
        { k: 'holes', id: 'H1', ref: R('T1', 'z+', '0', 'sm - (cutAt - T1.w/2 + ins)'), rows: '1', cols: '2', px: 'p', py: '60', d0: 'd0' },
        { k: 'bolts', id: 'B1', holes: 'H1', d: 'd', grade: '8.8', site: true },
        { k: 'weld', id: 'W1', part: 'T1', a: '5', site: false },
        { k: 'weld', id: 'W2', part: 'G1', a: '5', site: false },
      ],
    },
    {
      id: 'preset-cleat-plate', name: 'תושבת פטה: פלטה + משולש תמיכה', family: 'cleat',
      note: 'פלטה אנכית צמודה לווב הפטה (2 חורים), משולש תמיכה מאחוריה; הכל מרותך לקורה במסגריה, מוברג לפטה בשטח.',
      vars: [
        { name: 'd', expr: '12', note: 'קוטר בורג' }, { name: 'd0', expr: 'd+2', note: 'קוטר חור' }, { name: 'e', expr: 'max(25, r5(1.5*d0))', note: 'מרחק שפה' },
        { name: 'g', expr: '60', note: 'מרחק בין הברגים (לאורך הפטה)' }, { name: 'H', expr: 'mh - 20', note: 'גובה הפלטה' }, { name: 'B', expr: '60', note: 'בסיס משולש התמיכה' },
      ],
      params: [pBolt([10, 12, 16]), pNum('g', 'מרחק בין הברגים (לאורך הפטה)', 40, 150, 'ברגים'), pNum('H', 'גובה הפלטה', 40, 300, 'פלטות'), pNum('B', 'בסיס משולש התמיכה', 30, 150, 'פלטות')],
      ops: [
        { k: 'plate', id: 'P1', name: 'פלטת תושבת', ref: R('host', 'hit', '0', 'cs*(wo + P1.t/2)'), mode: 'stand', spin: '0', off: '0', shape: 'rect', w: 'H', h: 'g + 2*e', t: '8', ch: '0', corners: [false, false, false, false] },
        { k: 'plate', id: 'G1', name: 'משולש תמיכה', ref: R('host', 'hit', '0', 'cs*(wo + P1.t + B/2)'), mode: 'stand', spin: 'sr', off: '0', shape: 'tri', w: 'H - 15', h: 'B', t: '8', ch: '0', corners: [false, false, false, false] },
        { k: 'holes', id: 'H1', ref: R('P1', 'z+'), rows: '2', cols: '1', px: '40', py: 'g', d0: 'd0' },
        { k: 'bolts', id: 'B1', holes: 'H1', d: 'd', grade: '8.8', site: true },
        { k: 'weld', id: 'W1', part: 'P1', a: '4', site: false },
        { k: 'weld', id: 'W2', part: 'G1', a: '4', site: false },
        { k: 'weld', id: 'W3', part: 'G1', a: '4', site: false, to: 'P1' },
      ],
    },
  ];
}

export function blankDetail(name = 'פרט חדש'): CustomDetail {
  return { id: `cd-${Date.now().toString(36)}`, name, vars: [{ name: 'd', expr: '16', note: 'קוטר בורג' }, { name: 'd0', expr: 'd+2', note: 'קוטר חור' }, { name: 'e', expr: 'max(30, r5(1.5*d0))', note: 'מרחק שפה' }], ops: [] };
}
