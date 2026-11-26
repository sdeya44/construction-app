import { add, cross, dot, norm, rotateAxis, scale, sub, v3, type Vec3 } from '../core/vec';
import type { Connection, DerivedModel, FabPart, Member, Project, ValidationIssue } from '../model/types';
import { getProfile } from '../profiles/library';
import { axialExtent } from './parts';
import { localFrame } from './frame';

/**
 * תוכנית לא מלבנית (בקשת משתמש 18.11.2026, פריט 13): המודל נבנה מלבני (מערכת מקומית) וממופה לעולם.
 *  · מקבילית (skew): כל מסגרת מוסטת ב-x בשיעור tan(α)·(y−y0). המסגרות נשארות מקבילות וזהות; הפטות והקושרות
 *    מקבילות לקירות האורך המשופעים; קירות הקצה משופעים.
 *  · טרפז (taper): ציר קצה אחד זז החוצה באופן ליניארי לאורך הבניין — המפתח משתנה. שיפוע הגג נשמר: החלק שמעבר
 *    ל"קו הפיצול" זז במקביל למישור הגג (x ו-z), העמוד בציר המשופע מתארך/מתקצר, הבסיס נשאר במפלס.
 * חלקי חיבור (זוויתנים, פחי חיבור, ברגים) לא "נמתחים": כל חיבור שמחבר אלמנט לאורך (פטה, קושרת, סיב) למסגרת
 * מסתובב כגוף קשיח סביב נקודת הריתוך כך שיתיישר עם האלמנט המשופע.
 */
export interface PlanMap { T: (p: Vec3) => Vec3; J: (p: Vec3, v: Vec3) => Vec3; issues: ValidationIssue[]; label: string }

export function planMap(local: DerivedModel, project: Project): PlanMap | null {
  const pl = project.building.plan;
  if (!pl || pl.shape === 'rect') return null;
  const fr = [...project.building.frames].sort((a, b) => a.y - b.y);
  const y0 = fr[0]!.y, y1 = fr[fr.length - 1]!.y;
  const issues: ValidationIssue[] = [];
  if (pl.shape === 'skew') {
    const deg = Math.max(-40, Math.min(40, pl.skewDeg ?? 0));
    const k = Math.tan((deg * Math.PI) / 180);
    const T = (p: Vec3) => v3(p.x + k * (p.y - y0), p.y, p.z);
    const J = (_p: Vec3, v: Vec3) => v3(v.x + k * v.y, v.y, v.z);
    if (Math.abs(deg) > 15) issues.push({ code: 'PLAN_SKEW', severity: 'warning', message: `מקבילית ${deg}°: הפטות אינן ניצבות לקורות — תושבות הפטות מסובבות ב-${Math.abs(deg)}°, ובשיפוע הגג נוצר פיתול קטן (≈${(Math.abs(k) * 0.1 * 57.3).toFixed(1)}° ב-10%) בין הפטה לתושבת. לבדוק פרט תושבת משופעת.` });
    return { T, J, issues, label: `מקבילית — הסטה ${deg}° (${Math.round(k * (y1 - y0))} מ"מ בין המסגרת הראשונה לאחרונה)` };
  }
  const sec = local.section;
  if (!sec || sec.lines.length < 1) return null;
  const lines = [...sec.lines].sort((a, b) => a.x - b.x);
  const last = (pl.taperLine ?? 'last') === 'last';
  const edge = last ? lines[lines.length - 1]! : lines[0]!;
  const out = last ? 1 : -1;
  const prev = lines.length > 1 ? (last ? lines[lines.length - 2]! : lines[1]!) : null;
  // מישור הגג מעל ציר הקצה — שיפוע dz/dx
  const cover = sec.planes.filter((p) => Math.min(p.a.x, p.b.x) - 1 <= edge.x && edge.x <= Math.max(p.a.x, p.b.x) + 1);
  const zAt = (p: typeof sec.planes[number], x: number) => p.a.z + ((p.b.z - p.a.z) * (x - p.a.x)) / (p.b.x - p.a.x);
  const cap = cover.sort((a, b) => zAt(b, edge.x) - zAt(a, edge.x))[0];
  if (!cap) return null;
  const dzdx = (cap.b.z - cap.a.z) / (cap.b.x - cap.a.x);
  // קו הפיצול: בין הציר הקודם לציר הקצה, מחוץ לאזור המכפל/האלכסונים ליד העמוד
  const hn = project.building.haunch?.enabled ? project.building.haunch.length + 700 : 0;
  const kb = project.building.kneeBraces?.enabled ? 1800 : 0;
  const gap = prev ? Math.abs(edge.x - prev.x) : 4000;
  const dIn = Math.min(gap * 0.6, Math.max(gap * 0.35, hn, kb));
  const split = edge.x - out * dIn;
  const right = (p: Vec3) => (p.x - split) * out > 0;
  const dEnd = pl.taperEnd ?? 0;
  const delta = (y: number) => (y1 > y0 ? (dEnd * (y - y0)) / (y1 - y0) : 0);
  // מפלס בסיס ועד ראש העמוד בציר הקצה — מעבר הדרגתי בגובה (העמוד מתארך, הבסיס לא זז)
  const col = local.members.find((m) => m.kind === 'column' && m.lineId === edge.id);
  const zB = col ? Math.min(col.start.z, col.end.z) : project.building.baseElevation;
  const zTop = col ? Math.max(col.start.z, col.end.z) : zAt(cap, edge.x);
  // העמוד מתארך באזור התחתון; 1.8 מ' העליונים (חיבורי ראש עמוד, אלכסונים, מכפל, סיבי נעילה) זזים כגוף אחד עם הגג
  const zFull = Math.max(zB + 500, zTop - 1800);
  const blend = (z: number) => Math.max(0, Math.min(1, (z - zB) / Math.max(1, zFull - zB)));
  const Tr = (p: Vec3, isRight: boolean) => {
    if (!isRight) return p;
    const d = delta(p.y);
    return v3(p.x + out * d, p.y, p.z + dzdx * out * d * blend(p.z));
  };
  const T = (p: Vec3) => Tr(p, right(p));
  const J = (p: Vec3, v: Vec3) => {
    const r = right(p), e = 1;
    const a = Tr(add(p, scale(v, e)), r), b = Tr(sub(p, scale(v, e)), r);
    return scale(sub(a, b), 0.5 / e);
  };
  if (!col) issues.push({ code: 'PLAN_TAPER', severity: 'warning', message: 'טרפז: לא נמצא עמוד בציר הקצה המשופע' });
  return { T, J, issues, label: `טרפז — ציר ${edge.label} זז ${Math.round(dEnd)} מ"מ ${dEnd >= 0 ? 'החוצה' : 'פנימה'} עד המסגרת האחרונה (שיפוע הגג נשמר)` };
}

const Y = v3(0, 1, 0);
/** סיבוב מינימלי שמעביר את a ל-b (וקטורי יחידה) */
function minRot(a: Vec3, b: Vec3): (v: Vec3) => Vec3 {
  const ax = cross(a, b), s = Math.hypot(ax.x, ax.y, ax.z), c = dot(a, b);
  if (s < 1e-9) return (v) => v;
  const k = scale(ax, 1 / s), ang = Math.atan2(s, c);
  return (v) => rotateAxis(v, k, ang);
}
/** סיבוב סביב ציר a שמעביר את ההיטל של u (ניצב ל-a) להיטל של w */
function rotAbout(a: Vec3, u: Vec3, w: Vec3): (v: Vec3) => Vec3 {
  const pu = sub(u, scale(a, dot(u, a))), pw = sub(w, scale(a, dot(w, a)));
  if (Math.hypot(pu.x, pu.y, pu.z) < 1e-9 || Math.hypot(pw.x, pw.y, pw.z) < 1e-9) return (v) => v;
  const nu = norm(pu), nw = norm(pw);
  const ang = Math.atan2(dot(cross(nu, nw), a), dot(nu, nw));
  return (v) => rotateAxis(v, a, ang);
}

/** מיפוי המודל המקומי לעולם */
export function applyPlan(project: Project, local: DerivedModel, map: PlanMap): DerivedModel {
  const { T, J } = map;
  const lm = new Map(local.members.map((m) => [m.id, m]));
  const SMALL = new Set(['plate', 'cleat', 'bolt', 'anchor']);
  const isAlong = (m?: Member) => !!m && !SMALL.has(m.kind) && Math.abs(localFrame(m).ex.y) > 0.4 && m.kind !== 'column' && m.kind !== 'rafter';
  const isFrame = (m?: Member) => !!m && Math.abs(localFrame(m).ex.y) < 0.2 && ['column', 'rafter', 'beam'].includes(m.kind);
  // מיפוי קשיח לכל חיבור שמחבר אלמנט לאורך למסגרת
  type Rigid = { P: Vec3; R: (v: Vec3) => Vec3 };
  const rigidOf = new Map<string, Rigid>();
  const partConn = new Map<string, string>();
  for (const c of local.connections) {
    for (const id of c.parts) partConn.set(id, c.id);
    for (const b of c.bolts) for (const s of ['H', 'S', 'N', 'W']) partConn.set(`${b.id}.${s}`, c.id);
  }
  for (const m of local.members) if (m.connId && !partConn.has(m.id)) partConn.set(m.id, m.connId);
  for (const c of local.connections) {
    const along = c.members.map((id) => lm.get(id)).filter((m): m is Member => isAlong(m));
    const host = c.members.map((id) => lm.get(id)).find((m): m is Member => isFrame(m));
    if (!along.length || !host) continue;
    const parts = local.members.filter((m) => partConn.get(m.id) === c.id);
    if (!parts.length) continue;
    const w = c.welds.find((x) => x.between.includes(host.id));
    const P = w ? w.from : scale(parts.reduce((a, m) => add(a, scale(add(m.start, m.end), 0.5)), v3()), 1 / parts.length);
    const hf = localFrame(host);
    const axis = c.type === 'purlin-cleat' ? hf.v : hf.ex;
    const dY = localFrame(along[0]!).ex;
    const R = rotAbout(norm(axis), dY, norm(J(P, dY)));
    rigidOf.set(c.id, { P, R });
  }
  const rigidPt = (r: Rigid, p: Vec3) => add(T(r.P), r.R(sub(p, r.P)));
  // חיבור בין שני אלמנטים לאורך בלי מארח במסגרת (הצטלבות קושרות): אותו סיבוב כמו פחי הקצה של הקושרת, סביב מרכז החלקים
  {
    const byMember = new Map<string, Rigid>();
    for (const c of local.connections) { const r = rigidOf.get(c.id); if (r) for (const id of c.members) if (isAlong(lm.get(id))) byMember.set(id, r); }
    for (const c of local.connections) {
      if (rigidOf.has(c.id)) continue;
      const along = c.members.filter((id) => isAlong(lm.get(id)) && !lm.get(id)!.purlin);
      const r0 = along.map((id) => byMember.get(id)).find((x) => !!x);
      if (!r0 || along.length < 2) continue;
      const parts = local.members.filter((m) => partConn.get(m.id) === c.id);
      if (!parts.length) continue;
      const P = scale(parts.reduce((a, m) => add(a, scale(add(m.start, m.end), 0.5)), v3()), 1 / parts.length);
      rigidOf.set(c.id, { P, R: r0.R });
    }
  }
  // קצוות של אלמנטים לאורך (קושרות, סיבים — לא פטות) שצמודים לחיבור קשיח: הקצה נע עם החיבור, הגוף נמתח
  const endRigid = new Map<string, { r: Rigid; d: number }>();
  for (const c of local.connections) {
    const r = rigidOf.get(c.id);
    if (!r) continue;
    for (const id of c.members) {
      const m = lm.get(id);
      if (!m || !isAlong(m) || m.purlin) continue;
      for (const e of ['start', 'end'] as const) {
        const d = Math.hypot(m[e].x - r.P.x, m[e].y - r.P.y, m[e].z - r.P.z);
        const k = `${id}|${e}`;
        if (d < 1500 && d < (endRigid.get(k)?.d ?? Infinity)) endRigid.set(k, { r, d });
      }
    }
  }
  // חלק קטן מרותך (מסגריה) לאלמנט שאינו חלק קטן: נקודת הריתוך
  const weldHost = new Map<string, { id: string; at: Vec3 }>();
  for (const c of local.connections) for (const w of c.welds) {
    const [a, b] = w.between;
    const ma = lm.get(a), mb = lm.get(b);
    if (ma && mb && SMALL.has(ma.kind) && !SMALL.has(mb.kind) && !weldHost.has(a)) weldHost.set(a, { id: b, at: w.from });
    if (ma && mb && SMALL.has(mb.kind) && !SMALL.has(ma.kind) && !weldHost.has(b)) weldHost.set(b, { id: a, at: w.from });
  }
  // סיבוב אלמנט (במישור המסגרת) בעקבות המיפוי — null אם זניח
  const memberRot = (m: Member) => {
    const ex0 = localFrame(m).ex, ex1 = norm(sub(T(m.end), T(m.start)));
    if (dot(ex0, ex1) > 1 - 1e-7) return null;
    return minRot(ex0, ex1);
  };
  const mapMember = (m: Member): Member => {
    const cid = partConn.get(m.id);
    const r = cid ? rigidOf.get(cid) : undefined;
    if (r) {
      return {
        ...m, start: rigidPt(r, m.start), end: rigidPt(r, m.end), refUp: r.R(m.refUp),
        ...(m.startCut ? { startCut: { point: rigidPt(r, m.startCut.point), normal: r.R(m.startCut.normal) } } : {}),
        ...(m.endCut ? { endCut: { point: rigidPt(r, m.endCut.point), normal: r.R(m.endCut.normal) } } : {}),
      };
    }
    if (SMALL.has(m.kind)) {
      // חלק קטן שאינו בחיבור לאורך: גוף קשיח — מסתובב עם האלמנט שאליו הוא מרותך (אם האלמנט הסתובב), אחרת הזזה לפי המרכז
      const host = weldHost.get(m.id);
      if (host) {
        const hm = lm.get(host.id)!;
        const r = memberRot(hm);
        if (r) {
          const a = host.at, A = T(a);
          const mv = (q: Vec3) => add(A, r(sub(q, a)));
          return { ...m, start: mv(m.start), end: mv(m.end), refUp: r(m.refUp),
            ...(m.startCut ? { startCut: { point: mv(m.startCut.point), normal: r(m.startCut.normal) } } : {}),
            ...(m.endCut ? { endCut: { point: mv(m.endCut.point), normal: r(m.endCut.normal) } } : {}) };
        }
      }
      const mid = scale(add(m.start, m.end), 0.5), dv = sub(T(mid), mid);
      const mv = (q: Vec3) => add(q, dv);
      return { ...m, start: mv(m.start), end: mv(m.end),
        ...(m.startCut ? { startCut: { point: mv(m.startCut.point), normal: m.startCut.normal } } : {}),
        ...(m.endCut ? { endCut: { point: mv(m.endCut.point), normal: m.endCut.normal } } : {}) };
    }
    const rs = endRigid.get(`${m.id}|start`), re = endRigid.get(`${m.id}|end`);
    const S = rs ? rigidPt(rs.r, m.start) : T(m.start), E = re ? rigidPt(re.r, m.end) : T(m.end);
    const ex0 = localFrame(m).ex;
    const ex1 = norm(sub(E, S));
    const rot = minRot(ex0, ex1);
    // אלמנט במישור המסגרת: המיפוי רק בתוך המישור (ללא גזירה ב-y) — החתך והחיתוכים נשארים ניצבים למסגרת
    const Jf = (p: Vec3, v: Vec3) => { const a = J(p, v3(v.x, 0, v.z)); return v3(a.x, v.y, a.z); };
    // נקודת המישור — ליד קצה האלמנט (נקודה רחוקה על המישור עלולה ליפול באזור מיפוי אחר)
    const near = (pl: { point: Vec3; normal: Vec3 }, e: Vec3) => { const den = dot(ex0, pl.normal); if (Math.abs(den) < 1e-9) return pl.point; return add(e, scale(ex0, dot(sub(pl.point, e), pl.normal) / den)); };
    const nrm = (pl: { point: Vec3; normal: Vec3 }, e: Vec3) => { const q = near(pl, e); return { point: T(q), normal: isAlong(m) ? rot(pl.normal) : norm(invT(Jf, q, pl.normal)) }; };
    // פטה: ה"למעלה" נשאר ניצב לאגף הקורה (יושבת שטוחה על התושבת); שאר האלמנטים לאורך — סיבוב מינימלי
    const out: Member = { ...m, start: S, end: E, refUp: m.purlin ? m.refUp : (rs ?? re) ? (rs ?? re)!.r.R(m.refUp) : isAlong(m) ? rot(m.refUp) : norm(Jf(m.start, m.refUp)) };
    if (m.startCut) out.startCut = nrm(m.startCut, m.start);
    if (m.endCut) out.endCut = nrm(m.endCut, m.end);
    if (m.purlin) out.purlin = { ...m.purlin, roofNormal: rot(m.purlin.roofNormal) };
    return out;
  };
  const members = local.members.map(mapMember);
  const byId = new Map(members.map((m) => [m.id, m]));
  const ptOf = (cid: string | undefined, p: Vec3) => { const r = cid ? rigidOf.get(cid) : undefined; return r ? rigidPt(r, p) : T(p); };
  const vecOf = (cid: string | undefined, p: Vec3, v: Vec3) => { const r = cid ? rigidOf.get(cid) : undefined; return r ? r.R(v) : norm(J(p, v)); };
  const connections: Connection[] = local.connections.map((c) => ({
    ...c,
    bolts: c.bolts.map((b) => ({ ...b, p: ptOf(c.id, b.p), axis: vecOf(c.id, b.p, b.axis) })),
    welds: c.welds.map((w) => ({ ...w, from: ptOf(c.id, w.from), to: ptOf(c.id, w.to) })),
    ...(c.slots ? { slots: c.slots.map((v) => ({ ...v, p: ptOf(c.id, v.p), axis: vecOf(c.id, v.p, v.axis), nrm: vecOf(c.id, v.p, v.nrm) })) } : {}),
    ...(c.vents ? { vents: c.vents.map((v) => ({ ...v, p: ptOf(c.id, v.p), axis: vecOf(c.id, v.p, v.axis) })) } : {}),
    ...(c.holes ? { holes: c.holes.map((h) => ({ ...h, p: ptOf(c.id, h.p), axis: vecOf(c.id, h.p, h.axis) })) } : {}),
  }));
  // חלקי ייצור: t לאורך הציר החדש (הקושרות/פטות מתארכות במקבילית)
  const tMap = (lmOld: Member, mNew: Member, t: number) => {
    const f0 = localFrame(lmOld), f1 = localFrame(mNew);
    const q = add(lmOld.start, scale(f0.ex, t));
    const cid = partConn.get(lmOld.id);
    return dot(sub(ptOf(cid, q), mNew.start), f1.ex);
  };
  const extCache = new Map<string, { tMin: number; tMax: number }>();
  const ext = (m: Member) => { let e = extCache.get(m.id); if (!e) { e = axialExtent(m); extCache.set(m.id, e); } return e; };
  const parts: FabPart[] = local.parts.map((p) => {
    const o = lm.get(p.memberId), n = byId.get(p.memberId);
    if (!o || !n) return p;
    const eo = ext(o), en = ext(n);
    const t0 = Math.abs(p.t0 - eo.tMin) < 0.5 ? en.tMin : tMap(o, n, p.t0);
    const t1 = Math.abs(p.t1 - eo.tMax) < 0.5 ? en.tMax : tMap(o, n, p.t1);
    return { ...p, t0, t1, length: t1 - t0 };
  });
  const splices = local.splices.map((s) => { const o = lm.get(s.memberId), n = byId.get(s.memberId); return o && n ? { ...s, t: tMap(o, n, s.t), p: T(s.p) } : s; });
  const issues: ValidationIssue[] = [...local.issues, ...map.issues, { code: 'PLAN_SHAPE', severity: 'info', message: `תוכנית לא מלבנית: ${map.label}. חלקי החיבור מסובבים כגוף קשיח בהתאם לזווית; קירות הקצה/הצד המשופע — לבדוק חיפוי ופחים.` }];
  // התאמת פחי החיבור לחתך: הפרופילים לא משתנים, רק המיקום
  void getProfile;
  return {
    ...local, members, connections, byId, connById: new Map(connections.map((c) => [c.id, c])), parts, splices, issues,
    nodes: local.nodes.map((nd) => ({ ...nd, p: T(nd.p) })),
    supports: local.supports.map((sp) => ({ ...sp, p: T(sp.p) })),
    plan: { shape: project.building.plan!.shape as 'skew' | 'taper', local: { project, derived: local }, P: T },
  };
}

/** נורמל של מישור: J^-T·n (לפי J מספרי) */
function invT(J: (p: Vec3, v: Vec3) => Vec3, p: Vec3, n: Vec3): Vec3 {
  const c0 = J(p, v3(1, 0, 0)), c1 = J(p, v3(0, 1, 0)), c2 = J(p, v3(0, 0, 1));
  // J = [c0 c1 c2]; (J^-T) n = (cof(J) / det) n, cof columns = cross products of columns
  const r0 = cross(c1, c2), r1 = cross(c2, c0), r2 = cross(c0, c1);
  const det = dot(c0, r0);
  return scale(add(add(scale(r0, n.x), scale(r1, n.y)), scale(r2, n.z)), 1 / (det || 1));
}

void Y;
