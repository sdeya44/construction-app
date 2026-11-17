import { add, cross, dot, len, norm, rotateAxis, scale, sub, v3, type Plane, type Vec3 } from '../core/vec';
import { tryExpr, type Vars } from '../core/expr';
import { getProfile, tryProfile } from '../profiles/library';
import type { BoltInfo, Connection, CustomDetail, DetailOp, DetailRef, Member, Project, ValidationIssue, WeldInfo } from '../model/types';
import { localFrame } from './frame';
import { memberSolid } from './solid';
import { axialExtent } from './parts';
import { clash, PrismTester } from './clash';
import { makeBolt } from './connections';

/**
 * פרטי חיבור מותאמים — "מתכון": רשימת פעולות (חיתוך, פלטות, חורים, ברגים, ריתוך...) שכל אחת יושבת על פנים
 * של אחד הרכיבים (האלמנט, המארח או פלטה קודמת), עם מידות בנוסחאות. הפרט מוחל על "קצה" של אלמנט (אתר):
 * האלמנט הראשי (שהקצה שלו מפורט) והמארח (האלמנט שהציר פוגע בו). כל המיקומים נגזרים מהגיאומטריה של האתר —
 * לכן אותו פרט מתאים לחתכים, זוויות וצדדים שונים (כולל מראה).
 */

export type End = 'start' | 'end';
const STRUCT = new Set(['column', 'rafter', 'beam', 'purlin', 'girt', 'brace']);
const REMOVABLE = new Set(['plate', 'cleat', 'bolt', 'anchor']);

export interface Site {
  key: string;
  main: Member; end: End;
  host: Member | null;
  /** נקודת מפגש ציר האלמנט עם פני המארח */
  P: Vec3;
  /** ציר האלמנט, מהמארח אל האלמנט */
  u: Vec3;
  /** נורמל פני המארח (לכיוון האלמנט); בקצה חופשי = u */
  n: Vec3;
  /** a — ניצב לציר במישור (n,u); w — ניצב למישור */
  a: Vec3; w: Vec3;
  hand: 1 | -1;
  /** מידות החתך הראשי לאורך a ו-w */
  mh: number; mb: number;
  /** עומק המארח לאורך n (לפנים הנגדיות), ומרחק פני המארח לווב */
  hd: number; webOff: number | null;
  /** ציר המארח (לכיוון e1 כשהאלמנט ניצב לפנים) ונקודה על קו מרכז החתך שלו */
  hostAxis: Vec3 | null;
  ang: number;
  /** הקצה המקורי של האלמנט והקצה השני */
  E: Vec3; O: Vec3;
}

export const siteKey = (memberId: string, end: End) => `${memberId}|${end}`;
export function parseSiteKey(k: string): { id: string; end: End } { const i = k.lastIndexOf('|'); return { id: k.slice(0, i), end: k.slice(i + 1) as End }; }

/** תיבת החתך של אלמנט במערכת המקומית שלו */
function secBox(m: Member) {
  const prof = getProfile(m.profile), s = memberSolid(m);
  const us = prof.outline.outer.map((p) => p.u + s.du), vs = prof.outline.outer.map((p) => p.v + s.dv);
  return { u0: Math.min(...us), u1: Math.max(...us), v0: Math.min(...vs), v1: Math.max(...vs) };
}

/** פגיעת קרן בפריזמה של אלמנט: הפנים הראשונות שהקרן נכנסת דרכן */
function rayHit(o: Vec3, d: Vec3, m: Member): { t: number; n: Vec3; depth: number; webOff: number | null } | null {
  if (m.contour) return null;
  const f = localFrame(m), bx = secBox(m), { tMin, tMax } = axialExtent(m);
  const prof = getProfile(m.profile);
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
      const isI = ['IPE', 'HEA', 'HEB', 'HEM', 'INP', 'UPN', 'UPE'].includes(prof.family);
      const webOff = isI && ax === 'v' ? depth / 2 - (prof.dims.tw ?? 8) / 2 : null;
      best = { t, n: scale(nn, 1), depth, webOff };
    }
  }
  return best;
}

/** מציאת אתר לקצה אלמנט: המארח שהציר פוגע בו (עד 600 מ"מ מעבר לקצה), או קצה חופשי. */
export function findSite(members: Member[], m: Member, end: End): Site | null {
  if (!tryProfile(m.profile)) return null;
  const E = end === 'start' ? m.start : m.end, O = end === 'start' ? m.end : m.start;
  const L = len(sub(E, O)); if (L < 1) return null;
  const dOut = norm(sub(E, O));
  const o = sub(E, scale(dOut, Math.min(250, L / 2)));
  let best: { m: Member; t: number; n: Vec3; depth: number; webOff: number | null } | null = null;
  for (const x of members) {
    if (x === m || !STRUCT.has(x.kind) || !tryProfile(x.profile)) continue;
    const h = rayHit(o, dOut, x);
    if (!h || h.t < 0 || h.t > Math.min(250, L / 2) + 600) continue;
    if (!best || h.t < best.t) best = { m: x, ...h };
  }
  const u = scale(dOut, -1);
  const P = best ? add(o, scale(dOut, best.t)) : E;
  const n = best ? best.n : u;
  let w0 = cross(n, u);
  if (len(w0) < 0.05) { const f = localFrame(m); w0 = sub(f.v, scale(u, dot(f.v, u))); }
  const w = norm(w0), a = norm(cross(w, u));
  const ax = Math.abs(w.x) >= Math.abs(w.y) && Math.abs(w.x) >= Math.abs(w.z) ? w.x : Math.abs(w.y) >= Math.abs(w.z) ? w.y : w.z;
  const hand: 1 | -1 = ax >= 0 ? 1 : -1;
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
    key: siteKey(m.id, end), main: m, end, host: best?.m ?? null, P: Pc, u, n, a, w, hand, mh, mb,
    hd: best?.depth ?? 0, webOff: best?.webOff ?? null, hostAxis: best ? localFrame(best.m).ex : null, ang, E, O,
  };
}

/** פרמטרים מספריים של האתר לנוסחאות */
export function siteVars(s: Site): Vars {
  const mp = getProfile(s.main.profile), hp = s.host ? getProfile(s.host.profile) : null;
  return {
    mh: s.mh, mb: s.mb, mt: mp.dims.t ?? mp.dims.tw ?? 5, mtf: mp.dims.tf ?? mp.dims.t ?? 5,
    hh: hp?.props.h ?? 0, hb: hp?.props.b ?? 0, htf: hp?.dims.tf ?? hp?.dims.t ?? 0, htw: hp?.dims.tw ?? hp?.dims.t ?? 0,
    hd: s.hd, ang: Math.max(1, s.ang),
  };
}
export const VAR_HELP: [string, string][] = [
  ['mh', 'גובה חתך האלמנט (במישור)'], ['mb', 'רוחב חתך האלמנט (ניצב למישור)'], ['mt', 'עובי דופן/ווב האלמנט'], ['mtf', 'עובי אגף האלמנט'],
  ['hh', 'גובה חתך המארח'], ['hb', 'רוחב חתך המארח'], ['htf', 'עובי אגף המארח'], ['htw', 'עובי ווב המארח'], ['hd', 'עומק המארח בכיוון הפגיעה'],
  ['ang', 'זווית בין ציר האלמנט לפני המארח (90 = ניצב)'],
];

export interface Frame { base: Vec3; n: Vec3; e1: Vec3; e2: Vec3; hand: 1 | -1 }
export interface PlateGeom { id: string; center: Vec3; X: Vec3; Y: Vec3; Z: Vec3; t: number; w: number; h: number; poly: [number, number][]; hand: 1 | -1; memberId: string; target: string }

export function platePoly(shape: string, w: number, h: number, ch: number, co: boolean[]): [number, number][] {
  const W = w / 2, H = h / 2;
  if (shape === 'round') return Array.from({ length: 32 }, (_, i) => [W * Math.cos((i / 32) * Math.PI * 2), W * Math.sin((i / 32) * Math.PI * 2)]);
  if (shape === 'tri') return [[-W, -H], [W, -H], [-W, H]];
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

/** בניית פרט על אתר. טהור — אינו משנה את האלמנט המקורי. */
export function buildDetail(site: Site, det: CustomDetail, opts: { connId?: string; material?: string; others?: Member[] } = {}): DetailResult {
  const s = site, cid = opts.connId ?? `C.CD.${s.key.replace('|', '.')}`, mat = opts.material ?? s.main.material;
  const vals: Vars = siteVars(s), errors: Record<string, string> = {}, issues: ValidationIssue[] = [];
  const ev = (src: string | number | undefined, key: string, dflt = 0) => {
    const r = tryExpr(src ?? dflt, vals, dflt);
    if (r.err) errors[key] = r.err;
    if (!key.startsWith('_') && !(key in vals)) vals[key] = r.v;
    return r.v;
  };
  for (const v of det.vars) { const x = ev(v.expr, `var.${v.name}`); vals[v.name] = x; }
  // מעבר מקדים: מידות הפלטות זמינות לנוסחאות של כל הפעולות (גם לחיתוך שלפניהן)
  for (let pass = 0; pass < 2; pass++) for (const op of det.ops) if (op.k === 'plate' || op.k === 'endplate') {
    for (const k of ['w', 'h', 't'] as const) { const r = tryExpr((op as Record<string, unknown>)[k] as string, vals, NaN); if (!r.err) vals[`${op.id}.${k}`] = r.v; }
    if (op.k === 'plate' && op.shape === 'round') vals[`${op.id}.h`] = vals[`${op.id}.w`];
  }
  const members: Member[] = [], bolts: BoltInfo[] = [], welds: WeldInfo[] = [], vents: NonNullable<Connection['vents']> = [];
  const plates = new Map<string, PlateGeom>();
  // חיתוך: ברירת מחדל — מקביל לפני המארח, בפנים
  const cutOp = det.ops.find((o) => o.k === 'cut') as Extract<DetailOp, { k: 'cut' }> | undefined;
  let sEnd = 0; let cutPlane: Plane = { point: s.P, normal: s.n };
  const sinA = Math.max(0.05, Math.abs(dot(s.u, s.n)));
  if (cutOp) {
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
  const endPt = add(s.P, scale(s.u, sEnd));
  const main: Member = { ...s.main, ...(s.end === 'start' ? { start: endPt, startCut: cutPlane } : { end: endPt, endCut: cutPlane }), connId: s.main.connId };
  vals.send = sEnd;
  let endT = 0;

  const frame = (ref: Pick<DetailRef, 'on' | 'face'>): Frame | null => {
    let base: Vec3, n: Vec3, e1: Vec3;
    if (ref.on === 'main') {
      if (ref.face === 'end') { base = add(s.P, scale(s.u, sEnd - endT)); n = scale(s.u, -1); e1 = s.a; }
      else {
        const sg = ref.face.endsWith('-') ? -1 : 1, isA = ref.face.startsWith('a');
        n = scale(isA ? s.a : s.w, sg); base = add(s.P, scale(n, (isA ? s.mh : s.mb) / 2)); e1 = s.u;
      }
    } else if (ref.on === 'host') {
      n = s.n;
      const proj = sub(s.u, scale(n, dot(s.u, n)));
      e1 = len(proj) > 0.05 ? norm(proj) : s.hostAxis ? norm(sub(s.hostAxis, scale(n, dot(s.hostAxis, n)))) : s.a;
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

  const plateMember = (g: PlateGeom, name: string, contour: boolean): Member => {
    const xs = g.poly.map((p) => p[0]), ys = g.poly.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), yc = (y0 + y1) / 2;
    const W = (x: number, y: number) => add(add(g.center, scale(g.X, x)), scale(g.Y, y));
    const start = W(x0, yc), end = W(x1, yc);
    const b = Math.round(y1 - y0), t = Math.round(g.t);
    const desc = `${name} PL${t}×${b}×${Math.round(x1 - x0)}`;
    const m: Member = {
      id: g.memberId, kind: 'plate', label: desc, start, end, profile: `PL${b}x${t}`, material: mat, rollDeg: 0, mirror: false,
      anchor: 'center', refUp: g.Z, source: 'generated', manualPlacement: false, connId: cid, partDesc: contour ? `${desc} (צורה)` : desc,
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
        const g: PlateGeom = { id: op.id, center, X, Y, Z, t, w, h, poly: platePoly(op.shape, w, h, ch, op.corners), hand: fr.hand, memberId: `${cid}.${op.id}`, target: targetOf(op.ref.on) };
        plates.set(op.id, g);
        members.push(plateMember(g, op.name || 'פלטה', op.shape !== 'rect' && !(op.shape === 'cham' && (ch <= 0 || !op.corners.some(Boolean)))));
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
        for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) cs.push(at(fr, along + (i - (rows - 1) / 2) * py, across + (j - (cols - 1) / 2) * px));
        holeSets.set(op.id, { cs, axis: fr.n, d0, plate: op.ref.on });
      } else if (op.k === 'bolts') {
        const hs = holeSets.get(op.holes);
        if (!hs) { errors[op.id] = 'אין קבוצת חורים — הוסיפו קודם חורים'; continue; }
        const d = Math.round(ev(op.d, `${op.id}.d`, 16));
        vals[`${op.id}.d`] = d;
        const cand: Member[] = [...members.filter((m) => m.kind === 'plate'), main, ...(s.host ? [s.host] : [])];
        const testers = cand.map((m) => ({ m, t: new PrismTester(m) }));
        const own = plates.get(hs.plate)?.memberId;
        hs.cs.forEach((c, i) => {
          // סריקה לאורך ציר הבורג: קטעי חומר רציפים סביב הפלטה של החורים
          const segs: { m: string; lo: number; hi: number }[] = [];
          for (const { m, t } of testers) {
            const inside = (k: number) => t.depth(add(c, scale(hs.axis, k))) > 0;
            // חידוד הגבולות בחיפוש בינארי (דיוק 0.01 מ"מ) — ראש/אום צמודים לפני החלק בלי חדירה
            const edge = (a: number, b: number) => { for (let it = 0; it < 14; it++) { const mdl = (a + b) / 2; if (inside(mdl)) a = mdl; else b = mdl; } return b; };
            // קטעים רציפים בלבד (בחתך I — כל אגף בנפרד)
            let run: number | null = null;
            for (let k = -200; k <= 201; k += 1) {
              const In = k <= 200 && inside(k);
              if (In && run === null) run = k;
              if (!In && run !== null) { segs.push({ m: m.id, lo: edge(run, run - 1), hi: edge(k - 1, k) }); run = null; }
            }
          }
          const start = segs.find((g) => g.m === own) ?? segs.find((g) => g.lo <= 0.5 && g.hi >= -0.5);
          if (!start) { errors[op.id] = 'הבורג לא עובר בשום חלק'; return; }
          let lo = start.lo, hi = start.hi; const used = new Set([start.m]);
          for (let ch = true; ch;) { ch = false; for (const g of segs) if (!used.has(g.m) && g.lo <= hi + 2 && g.hi >= lo - 2) { lo = Math.min(lo, g.lo); hi = Math.max(hi, g.hi); used.add(g.m); ch = true; } }
          if (used.size < 2) issues.push({ code: 'CD_BOLT', severity: 'warning', elementId: cid, message: `פרט ${det.name}: בורג ${op.id}-${i + 1} עובר בחלק אחד בלבד — חסרה פלטה נגדית?` });
          const head = add(c, scale(hs.axis, lo));
          bolts.push(makeBolt(`${cid}.${op.id}.${i + 1}`, cid, head, hs.axis, { d, grade: op.grade, standard: 'ISO 4017', clearance: Math.max(1, hs.d0 - d) }, Math.round(hi - lo), op.site ? 'site' : 'shop', [...used], frame({ on: hs.plate, face: 'z+' })?.e1 ?? s.a, members));
        });
      } else if (op.k === 'weld') {
        const g = plates.get(op.part);
        const a = ev(op.a, `${op.id}.a`, 5);
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
        welds.push({ id: `${cid}.${op.id}`, connId: cid, type: 'fillet', a, length: Math.round(length), location: op.site ? 'site' : 'shop', between: [g.memberId, to], from, to: toP });
        if (op.site) issues.push({ code: 'CD_SITE_WELD', severity: 'warning', elementId: cid, message: `פרט ${det.name}: ריתוך בשטח — סותר את עיקרון הגלוון (ריתוך במסגריה, ברגים בשטח)` });
      } else if (op.k === 'vent') {
        const d = ev(op.d, `${op.id}.d`, 12), atS = ev(op.at, `${op.id}.at`, 30);
        for (const sg of [1, -1]) vents.push({ memberId: s.main.id, p: add(add(s.P, scale(s.u, sEnd + atS)), scale(s.a, (sg * s.mh) / 2)), axis: scale(s.a, -sg), d });
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
  const hard = [main, ...(s.host ? [s.host] : [])];
  const bh = members.filter((m) => m.kind === 'bolt' && /\.(H|N)$/.test(m.id));
  const tests: [Member, Member][] = [];
  for (const p of parts) {
    for (const h of hard) {
      const pOp = det.ops.find((o) => `${cid}.${o.id}` === p.id);
      if (h === main && slot && pOp?.k === 'plate' && pOp.ref.on === 'main') continue;
      tests.push([p, h]);
    }
  }
  for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) tests.push([parts[i], parts[j]]);
  for (const b of bh) for (const h of [...hard, ...parts]) tests.push([b, h]);
  for (const o of opts.others ?? []) for (const p of parts) tests.push([p, o]);
  for (const [x, y] of tests) {
    const c = clash(x, y);
    if (c) issues.push({ code: 'CLASH', severity: 'error', elementId: x.id, message: `פרט ${det.name}: התנגשות ${x.label} ↔ ${y.label} — חדירה ${c.depth.toFixed(1)} מ"מ` });
  }
  if (!s.host) issues.push({ code: 'CD_FREE', severity: 'info', elementId: cid, message: `פרט ${det.name}: קצה חופשי — לא נמצא אלמנט מארח מול הקצה` });
  for (const [k, e] of Object.entries(errors)) issues.push({ code: 'CD_EXPR', severity: 'error', elementId: cid, message: `פרט ${det.name}: ${k} — ${e}` });

  const conn: Connection = {
    id: cid, type: 'custom', label: `${det.name} — ${s.main.label} (${s.end === 'start' ? 'התחלה' : 'סוף'})`,
    members: [...(s.host ? [s.host.id] : []), s.main.id], parts: [...members.filter((m) => !(m.kind === 'bolt')).map((m) => m.id), ...bolts.map((b) => b.id)],
    bolts, welds, status: 'not-verified', fixity: 'pinned', overridden: true, vents: vents.length ? vents : undefined, custom: { detailId: det.id, site: s.key },
  };
  return { site: s, main, members, conn, issues, values: vals, errors, plates, frame, sEnd };
}

/**
 * החלת פרטים מותאמים על המודל: לכל אתר משויך — הסרת חלקי החיבור הקיימים בקצה, חיתוך האלמנט מחדש ובניית הפרט.
 * משנה את members/connections במקום.
 */
export function applyCustomDetails(project: Project, members: Member[], connections: Connection[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const assign = project.detailAssign ?? {};
  const lib = new Map((project.customDetails ?? []).map((d) => [d.id, d]));
  for (const [key, did] of Object.entries(assign)) {
    const det = lib.get(did);
    const { id, end } = parseSiteKey(key);
    const idx = members.findIndex((m) => m.id === id);
    if (idx < 0) continue; // האלמנט לא קיים במודל הנוכחי (מסגרת שנמחקה וכד')
    if (!det) { issues.push({ code: 'CD_MISSING', severity: 'warning', elementId: id, message: `פרט מותאם לא נמצא בספרייה עבור ${id}` }); continue; }
    const m = members[idx];
    const site = findSite(members, m, end);
    if (!site) continue;
    // הסרת חלקי חיבור קיימים בקצה הזה
    const kill = partsToReplace(members, connections, m, site.E, site.O);
    for (const c of connections) {
      if (!c.parts.some((p) => kill.has(p)) && !c.bolts.some((b) => kill.has(b.id))) continue;
      c.parts = c.parts.filter((p) => !kill.has(p));
      c.bolts = c.bolts.filter((b) => !kill.has(b.id));
      c.welds = c.welds.filter((w) => !w.between.some((x) => kill.has(x)));
    }
    for (let i = connections.length - 1; i >= 0; i--) {
      const c = connections[i];
      if (c.type !== 'custom' && !c.bolts.length && !c.parts.some((p) => members.some((x) => x.id === p && REMOVABLE.has(x.kind) && !kill.has(p)))) connections.splice(i, 1);
    }
    for (let i = members.length - 1; i >= 0; i--) if (kill.has(members[i].id)) members.splice(i, 1);
    const site2 = findSite(members, m, end) ?? site;
    // אלמנטים סמוכים (פטות, קושרות, פלטות של חיבורים אחרים) — לבדיקת התנגשות עם חלקי הפרט
    const box = { c: site2.P, r: 900 };
    const others = members.filter((x) => x.id !== m.id && x.id !== site2.host?.id && x.kind !== 'bolt' && ['column', 'rafter', 'purlin', 'cleat', 'plate', 'brace', 'beam', 'girt'].includes(x.kind)
      && !x.connId?.startsWith('C.CD.') && Math.min(len(sub(x.start, box.c)), len(sub(x.end, box.c)), len(sub(scale(add(x.start, x.end), 0.5), box.c))) < box.r);
    const r = buildDetail(site2, det, { material: project.building.material, others });
    const k = members.findIndex((x) => x.id === m.id);
    if (k >= 0) members[k] = r.main;
    members.push(...r.members);
    connections.push(r.conn);
    issues.push(...r.issues);
  }
  return issues;
}

/** חלקי החיבורים הקיימים בקצה האלמנט (פלטות, זוויתנים, ברגים, עיגונים) — מוחלפים בפרט המותאם */
export function partsToReplace(members: Member[], connections: Connection[], m: Member, E: Vec3, O: Vec3): Set<string> {
  const near = (p: Vec3) => len(sub(p, E)) < len(sub(p, O)) && len(sub(p, E)) < 800;
  const kill = new Set<string>();
  const byId = new Map(members.map((x) => [x.id, x]));
  for (const c of connections) {
    if (c.type === 'custom' || !(c.parts.includes(m.id) || c.members.includes(m.id))) continue;
    for (const pid of c.parts) {
      const pm = byId.get(pid);
      if (pm && REMOVABLE.has(pm.kind) && near(scale(add(pm.start, pm.end), 0.5))) kill.add(pid);
    }
    for (const b of c.bolts) if (near(b.p)) { kill.add(b.id); for (const k of ['H', 'S', 'N']) kill.add(`${b.id}.${k}`); }
  }
  return kill;
}

/** חתימת "דומים" לאתר: אותו סוג אלמנט, אותו קצה-מארח, ואותו חתך (אופציונלי) */
export function siteSignature(members: Member[], m: Member, end: End, withProfile = true): string {
  const s = findSite(members, m, end);
  const role = m.id.split('.')[0];
  return [m.kind, role, s?.host?.kind ?? 'free', withProfile ? m.profile : '', s ? Math.round(s.ang / 5) * 5 : 0].join('|');
}
export function similarSites(members: Member[], key: string, withProfile = true): string[] {
  const { id, end } = parseSiteKey(key);
  const m = members.find((x) => x.id === id); if (!m) return [key];
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
const R = (on: string, face: string, along = '0', across = '0'): DetailRef => ({ on, face, along, across });
export function detailPresets(): CustomDetail[] {
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
  ];
}

export function blankDetail(name = 'פרט חדש'): CustomDetail {
  return { id: `cd-${Date.now().toString(36)}`, name, vars: [{ name: 'd', expr: '16', note: 'קוטר בורג' }, { name: 'd0', expr: 'd+2', note: 'קוטר חור' }, { name: 'e', expr: 'max(30, r5(1.5*d0))', note: 'מרחק שפה' }], ops: [] };
}
