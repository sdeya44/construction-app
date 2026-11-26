import { add, cross, dot, norm, scale, sub, v3, type Vec3 } from '../core/vec';
import type { Member, SiteAnchor } from '../model/types';
import { tryProfile } from '../profiles/library';
import { localFrame } from './frame';
import type { Site } from './detail';

/**
 * אתר באמצע אלמנט (G9) — חיבור המשך: נקודה על ציר האלמנט במרחק `t` מההתחלה. האלמנט רציף (אין מארח, אין חיתוך);
 * הפרט מוסיף פלטות/ברגים/ריתוכים סביב התפר. המפתח `מזהה|s:k` — k הוא מספר התפר (מ-1) ברשימת התפרים הממוינת והייחודית של האלמנט,
 * אותו אינדקס שבמזהי החיבורים המובנים (`C.PS.<אלמנט>.<k>`), כך שהחיבור המוחלף נמצא ונמחק לפי מזהה.
 * `splices` — התפרים האפקטיביים (כולל אוטומטיים); חסר/מחוץ לטווח ⇒ אין אתר.
 */
export function midSite(m: Member, k: number, splices: number[] | undefined): Site | null {
  const pp = tryProfile(m.profile);
  if (!pp || !splices || !Number.isInteger(k) || k < 1) return null;
  const ts = [...new Set(splices)].sort((a, b) => a - b);
  const t = ts[k - 1];
  if (t === undefined) return null;
  const lf = localFrame(m);
  const P = add(m.start, scale(lf.ex, t));
  if (pp.family === 'C' || pp.family === 'Z') return purlinWebSite(m, pp, lf, P, k, t);
  return null;
}

/** פטה C/Z: a = כיוון הווב לצד הזוויתן (Z: u, C: −u), `up` = לאורך הווב, פנים a- = הצד הנגדי (הפנימי) של הווב */
function purlinWebSite(m: Member, pp: NonNullable<ReturnType<typeof tryProfile>>, lf: ReturnType<typeof localFrame>, P: Site['P'], k: number, t: number): Site {
  const d = pp.family === 'Z' ? lf.u : scale(lf.u, -1);
  const tw = pp.dims.t ?? pp.dims.tw ?? 3;
  const back = scale(d, -1);
  // e2 של פנים a- (n = back, e1 = up): cross(n, e1) — הסימן ביחס לציר האלמנט
  const e2 = cross(back, lf.v);
  const xs: 1 | -1 = dot(e2, lf.ex) >= 0 ? 1 : -1;
  const E = add(m.start, scale(lf.ex, t)), O = m.start;
  return {
    key: `${m.id}|s:${k}`, main: m, end: `s:${k}`, host: null, P, u: lf.ex, n: lf.ex, a: d, w: lf.v, hand: 1, handA: 1,
    mh: pp.props.h, mb: pp.props.b ?? pp.props.h, hd: 0, webOff: null, hostAxis: null, ang: 90, E, O: O ?? v3(0, 0, 0),
    mid: { conn: `C.PS.${m.id}.${k}`, t, k, wa: tw / 2, ww: 0, up: lf.v, xs },
  };
}

const V = (a: [number, number, number]): Vec3 => v3(a[0], a[1], a[2]);

/**
 * אתר עוגן (G9): מיקום וכיוונים שהחיבור המובנה סיפק במפורש (`Connection.recipe.anchors`) — למקומות שאין בהם קצה/תפר/מארח טבעי,
 * למשל הצטלבות שתי קושרות X: `P` = נקודת הבורג, `a` = נורמל מישור הקושרות (פנים a±), `up` = כיוון e1 של הפנים, `partner` = הקושרת השנייה.
 * אין היסט חומר (wa = ww = 0): הפנים עוברות דרך `P`. האלמנט רציף ואינו נחתך.
 */
export function anchorSite(m: Member, end: `p:${string}`, an: SiteAnchor | undefined): Site | null {
  if (!an || !tryProfile(m.profile)) return null;
  const P = V(an.P), a = norm(V(an.a)), up = norm(V(an.up));
  const ex = norm(sub(m.end, m.start));
  const w = norm(cross(a, up));
  const pp = tryProfile(m.profile)!;
  const e2 = cross(scale(a, -1), up);
  return {
    key: `${m.id}|${end}`, main: m, end, host: null, P, u: ex, n: ex, a, w, hand: 1, handA: 1,
    mh: pp.props.h, mb: pp.props.b ?? pp.props.h, hd: 0, webOff: null, hostAxis: null, ang: 90, E: P, O: m.start,
    mid: { conn: an.conn, t: 0, k: 0, wa: 0, ww: 0, up, xs: dot(e2, ex) >= 0 ? 1 : -1, ...(an.bu ? { bu: V(an.bu) } : {}), ...(an.partner ? { partner: an.partner } : {}) },
  };
}
