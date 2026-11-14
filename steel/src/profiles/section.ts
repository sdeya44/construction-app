/**
 * גיאומטריית חתך ותכונות חתך.
 * מערכת חתך מקומית (u, v): v = כיוון הגובה/הווב של החתך, u = כיוון הרוחב/האגפים.
 * הראשית במרכז מלבן החסימה של החתך. יחידות mm.
 */
export interface P2 { u: number; v: number }
export interface Outline { outer: P2[]; holes: P2[][] }

export interface SectionProps {
  area: number;        // mm²
  cu: number; cv: number; // מרכז כובד ביחס לראשית
  Iy: number;          // ∫v² dA סביב ציר u דרך מרכז הכובד (ציר חזק לחתך I) mm⁴
  Iz: number;          // ∫u² dA סביב ציר v דרך מרכז הכובד mm⁴
  Wy: number; Wz: number; // מודולי חתך אלסטיים mm³
  iy: number; iz: number; // רדיוסי התמד mm
  h: number; b: number;   // מידות חוסמות
}

function arc(cu: number, cv: number, r: number, a0: number, a1: number, n = 4): P2[] {
  const pts: P2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    pts.push({ u: cu + r * Math.cos(a), v: cv + r * Math.sin(a) });
  }
  return pts;
}
const H = Math.PI / 2;

/** חתך I דו־סימטרי עם רדיוסי שורש. סדר נקודות נגד כיוון השעון. */
export function iShape(h: number, b: number, tw: number, tf: number, r: number): Outline {
  const hh = h / 2, hb = b / 2, ht = tw / 2;
  const yi = hh - tf; // פני אגף פנימיים
  const p: P2[] = [];
  p.push({ u: -hb, v: -hh }, { u: hb, v: -hh }, { u: hb, v: -yi });
  // רדיוס תחתון ימני: מרכז (ht + r, -yi + r)
  p.push(...arc(ht + r, -yi + r, r, -H, -Math.PI, 4));
  p.push(...arc(ht + r, yi - r, r, Math.PI, H, 4));
  p.push({ u: hb, v: yi }, { u: hb, v: hh }, { u: -hb, v: hh }, { u: -hb, v: yi });
  p.push(...arc(-ht - r, yi - r, r, H, 0, 4));
  p.push(...arc(-ht - r, -yi + r, r, 0, -H, 4));
  p.push({ u: -hb, v: -yi });
  return { outer: dedupe(p), holes: [] };
}

/** תעלה U: ווב בצד u שלילי, אגפים פונים ל-u חיובי. */
export function uShape(h: number, b: number, tw: number, tf: number, r: number): Outline {
  const hh = h / 2, hb = b / 2;
  const yi = hh - tf, xw = -hb + tw;
  const p: P2[] = [];
  p.push({ u: -hb, v: -hh }, { u: hb, v: -hh }, { u: hb, v: -yi });
  p.push(...arc(xw + r, -yi + r, r, -H, -Math.PI, 4));
  p.push(...arc(xw + r, yi - r, r, Math.PI, H, 4));
  p.push({ u: hb, v: yi }, { u: hb, v: hh }, { u: -hb, v: hh });
  return { outer: dedupe(p), holes: [] };
}

function roundedRect(w: number, h: number, r: number, seg = 3): P2[] {
  const hw = w / 2, hh = h / 2;
  if (r <= 0) return [{ u: -hw, v: -hh }, { u: hw, v: -hh }, { u: hw, v: hh }, { u: -hw, v: hh }];
  return [
    ...arc(hw - r, -hh + r, r, -H, 0, seg),
    ...arc(hw - r, hh - r, r, 0, H, seg),
    ...arc(-hw + r, hh - r, r, H, Math.PI, seg),
    ...arc(-hw + r, -hh + r, r, Math.PI, 1.5 * Math.PI, seg),
  ];
}

/** RHS/SHS סגור חלול. רדיוסים לפי קירוב EN 10219: חיצוני 2t, פנימי t (לא מאומת). */
export function rhsShape(h: number, b: number, t: number): Outline {
  const ro = Math.min(2 * t, Math.min(h, b) / 2 - 1e-3);
  const ri = Math.max(ro - t, 0);
  return { outer: roundedRect(b, h, ro), holes: [roundedRect(b - 2 * t, h - 2 * t, ri).reverse()] };
}

export function chsShape(d: number, t: number, n = 32): Outline {
  const ro = d / 2, ri = d / 2 - t;
  const o: P2[] = [], i: P2[] = [];
  for (let k = 0; k < n; k++) {
    const a = (2 * Math.PI * k) / n;
    o.push({ u: ro * Math.cos(a), v: ro * Math.sin(a) });
    i.push({ u: ri * Math.cos(a), v: ri * Math.sin(a) });
  }
  return { outer: o, holes: [i.reverse()] };
}

/** זוויתן L: רגל a לאורך v (אנכית), רגל b לאורך u (אופקית), פינה בצד (-u, -v). */
export function lShape(a: number, b: number, t: number): Outline {
  const hu = b / 2, hv = a / 2;
  return {
    outer: [
      { u: -hu, v: -hv }, { u: hu, v: -hv }, { u: hu, v: -hv + t },
      { u: -hu + t, v: -hv + t }, { u: -hu + t, v: hv }, { u: -hu, v: hv },
    ],
    holes: [],
  };
}

/**
 * C מכופף בקר (עם/בלי שפתיים): ווב ב-u שלילי, שני האגפים פונים ל-u חיובי (אותו צד).
 * פינות חדות — קירוב גיאומטרי (רדיוס כיפוף מוזנח).
 */
export function cShape(h: number, b: number, c: number, t: number): Outline {
  const hh = h / 2, hb = b / 2;
  const p: P2[] = [{ u: -hb, v: -hh }, { u: hb, v: -hh }];
  if (c > 0) p.push({ u: hb, v: -hh + c }, { u: hb - t, v: -hh + c }, { u: hb - t, v: -hh + t });
  else p.push({ u: hb, v: -hh + t });
  p.push({ u: -hb + t, v: -hh + t }, { u: -hb + t, v: hh - t });
  if (c > 0) p.push({ u: hb - t, v: hh - t }, { u: hb - t, v: hh - c }, { u: hb, v: hh - c });
  else p.push({ u: hb, v: hh - t });
  p.push({ u: hb, v: hh }, { u: -hb, v: hh });
  return { outer: ensureCCW(dedupe(p)), holes: [] };
}

/**
 * Z מכופף בקר: ווב במרכז, אגף עליון פונה ל-u חיובי, אגף תחתון ל-u שלילי (כיוונים מנוגדים).
 * b = רוחב אגף (כל אגף, כולל עובי הווב). פינות חדות.
 */
export function zShape(h: number, b: number, c: number, t: number): Outline {
  const hh = h / 2, ht = t / 2;
  const p: P2[] = [];
  // אגף תחתון לכיוון -u
  const ub = -ht - (b - t);
  p.push({ u: ht, v: -hh });
  p.push({ u: ht, v: hh - t });
  // אגף עליון לכיוון +u
  const ut = ht + (b - t);
  if (c > 0) {
    p.push({ u: ut - t, v: hh - t }, { u: ut - t, v: hh - c }, { u: ut, v: hh - c });
  } else {
    p.push({ u: ut, v: hh - t });
  }
  p.push({ u: ut, v: hh }, { u: -ht, v: hh }, { u: -ht, v: -hh + t });
  if (c > 0) {
    p.push({ u: ub + t, v: -hh + t }, { u: ub + t, v: -hh + c }, { u: ub, v: -hh + c });
  } else {
    p.push({ u: ub, v: -hh + t });
  }
  p.push({ u: ub, v: -hh });
  return { outer: ensureCCW(dedupe(p)), holes: [] };
}

export function plateShape(b: number, t: number): Outline {
  return { outer: roundedRect(b, t, 0), holes: [] };
}

function dedupe(p: P2[]): P2[] {
  const out: P2[] = [];
  for (const q of p) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.u - q.u) > 1e-9 || Math.abs(last.v - q.v) > 1e-9) out.push(q);
  }
  const f = out[0], l = out[out.length - 1];
  if (out.length > 1 && Math.abs(f.u - l.u) < 1e-9 && Math.abs(f.v - l.v) < 1e-9) out.pop();
  return out;
}

export function signedArea(p: P2[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    s += a.u * b.v - b.u * a.v;
  }
  return s / 2;
}
function ensureCCW(p: P2[]): P2[] { return signedArea(p) < 0 ? [...p].reverse() : p; }

/** תכונות חתך מפוליגון (משפט גרין), כולל חורים. */
export function sectionProps(o: Outline): SectionProps {
  let A = 0, Su = 0, Sv = 0, Iuu = 0, Ivv = 0;
  const acc = (poly: P2[], sign: number) => {
    const s = Math.sign(signedArea(poly)) * sign; // מנרמל את הכיוון
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const c = (a.u * b.v - b.u * a.v) * s;
      A += c / 2;
      Su += ((a.u + b.u) * c) / 6;
      Sv += ((a.v + b.v) * c) / 6;
      Ivv += ((a.v * a.v + a.v * b.v + b.v * b.v) * c) / 12; // ∫v²
      Iuu += ((a.u * a.u + a.u * b.u + b.u * b.u) * c) / 12; // ∫u²
    }
  };
  acc(o.outer, 1);
  for (const h of o.holes) acc(h, -1);
  const cu = Su / A, cv = Sv / A;
  const Iy = Ivv - A * cv * cv;
  const Iz = Iuu - A * cu * cu;
  let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
  for (const q of o.outer) {
    umin = Math.min(umin, q.u); umax = Math.max(umax, q.u);
    vmin = Math.min(vmin, q.v); vmax = Math.max(vmax, q.v);
  }
  const ev = Math.max(vmax - cv, cv - vmin), eu = Math.max(umax - cu, cu - umin);
  return {
    area: A, cu, cv, Iy, Iz, Wy: Iy / ev, Wz: Iz / eu,
    iy: Math.sqrt(Iy / A), iz: Math.sqrt(Iz / A), h: vmax - vmin, b: umax - umin,
  };
}
