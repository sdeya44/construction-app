import { add, cross, dot, linePlaneT, norm, scale, sub, v3, type Plane, type Vec3 } from '../core/vec';
import { getProfile, tryProfile } from '../profiles/library';
import type {
  ApprovalStatus, BoltInfo, BoltSpec, CleatParams, Connection, Member, PlateConnParams, Project,
  SupportPoint, ValidationIssue, WeldInfo,
} from '../model/types';
import { localFrame } from './frame';
import { aabb, aabbOverlap, clash } from './clash';
import { checkEavePlate } from './eavePlate';
import { zAt, type SectionTopology } from '../model/section';
import { defaultSideConn } from '../model/defaults';
import { buildKneeBraces } from './knee';
import { purlinParams } from './purlins';

/** מידות בורג/אום/דיסקית לפי ISO 4017/4032/7089 (מידע גיאומטרי בלבד — לא מאומת). */
const HW: Record<number, { s: number; k: number; m: number; w: number; P: number }> = {
  10: { s: 16, k: 6.4, m: 8.4, w: 2, P: 1.5 },
  12: { s: 18, k: 7.5, m: 10.8, w: 2.5, P: 1.75 },
  16: { s: 24, k: 10, m: 14.8, w: 3, P: 2 },
  20: { s: 30, k: 12.5, m: 18, w: 3, P: 2.5 },
  24: { s: 36, k: 15, m: 21.5, w: 4, P: 3 },
};
export const hw = (d: number) => HW[d] ?? { s: 1.5 * d, k: 0.62 * d, m: 0.85 * d, w: 0.2 * d, P: 0.15 * d };
const STD_LEN = [16, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 180, 200];

/** אורך בורג: אחיזה + 2 דיסקיות + אום + בליטה של 2 פסיעות, מעוגל לאורך תקני. */
export function boltLength(d: number, grip: number): number {
  const h = hw(d);
  const need = grip + 2 * h.w + h.m + 2 * h.P;
  return STD_LEN.find((l) => l >= need) ?? Math.ceil(need / 10) * 10;
}

export type ConnResult = { members: Member[]; connections: Connection[]; issues: ValidationIssue[] };

const Z = v3(0, 0, 1);

function effPlate(p: Project, type: 'eave' | 'ridge' | 'base' | 'side', id: string): PlateConnParams {
  const o = p.connectionOverrides[id] ?? {};
  const base = type === 'side' ? (p.connectionDefaults.side ?? defaultSideConn()) : p.connectionDefaults[type];
  const { status: _s, fixity: _f, ...rest } = o;
  void _s; void _f;
  return { ...base, ...rest, bolt: { ...base.bolt, ...(rest.bolt ?? {}) } };
}
export function effCleat(p: Project, side: string, cleatId: string): CleatParams {
  const base = purlinParams(p.building.purlins, side).cleat;
  const o = p.cleatOverrides[cleatId] ?? {};
  return { ...base, ...o, bolt: { ...base.bolt, ...(o.bolt ?? {}) } };
}
const statusOf = (p: Project, id: string): ApprovalStatus => p.connectionOverrides[id]?.status ?? 'not-verified';

/** חלק לוחי/זוויתן כאלמנט: קו ייחוס, כיוון v ואופן עיגון. */
function partMember(id: string, kind: 'plate' | 'cleat', profile: string, start: Vec3, end: Vec3, refUp: Vec3, anchor: Member['anchor'], connId: string, desc: string, material: string, mirror = false): Member {
  return {
    id, kind, label: desc, start, end, profile, material, rollDeg: 0, mirror, anchor, refUp,
    source: 'generated', manualPlacement: false, connId, partDesc: desc,
  };
}

/** בורג כשלושה מוצקים להצגה (ראש, גוף, אום) + רשומת בורג. */
export function makeBolt(id: string, connId: string, head: Vec3, axis: Vec3, spec: BoltSpec, grip: number, location: 'site' | 'shop', holesIn: string[], refUp: Vec3, members: Member[], anchorLen?: number): BoltInfo {
  const h = hw(spec.d);
  const length = anchorLen ?? boltLength(spec.d, grip);
  const mk = (sid: string, prof: string, a: Vec3, b: Vec3, desc: string): Member => ({
    id: sid, kind: 'bolt', label: desc, start: a, end: b, profile: prof, material: 'S235', rollDeg: 0, mirror: false,
    anchor: 'center', refUp, source: 'generated', manualPlacement: false, connId, partDesc: desc,
  });
  const desc = anchorLen ? `בורג עיגון M${spec.d}×${length}` : `בורג M${spec.d}×${length} ${spec.grade}`;
  if (!anchorLen) members.push(mk(`${id}.H`, `HX${h.s}`, sub(head, scale(axis, h.k)), head, desc));
  members.push(mk(`${id}.S`, `RD${spec.d}`, head, add(head, scale(axis, length)), desc));
  const nutAt = add(head, scale(axis, grip + h.w));
  members.push(mk(`${id}.N`, `HX${h.s}`, nutAt, add(nutAt, scale(axis, h.m)), desc));
  return { id, connId, p: head, axis, d: spec.d, hole: spec.d + spec.clearance, grade: spec.grade, standard: spec.standard, grip, length, location, holesIn };
}

const grid = (n: number, step: number) => Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * step);

/** בדיקות מרחקי קצה ומרווחים לפי ערכי מינימום מקובלים (EN 1993-1-8 טבלה 3.3) — אזהרה בלבד. */
function edgeChecks(label: string, id: string, d0: number, e1: number, e2: number, p1: number | null, p2: number | null, out: ValidationIssue[]) {
  const w = (msg: string) => out.push({ code: 'BOLT_EDGE', severity: 'warning', elementId: id, message: `${label}: ${msg} (מינימום מקובל, אינו בדיקת חוזק)` });
  if (e1 < 1.2 * d0 - 0.01) w(`מרחק קצה ${e1.toFixed(1)} < 1.2·d0 = ${(1.2 * d0).toFixed(1)} מ"מ`);
  if (e2 < 1.2 * d0 - 0.01) w(`מרחק שפה ${e2.toFixed(1)} < 1.2·d0 = ${(1.2 * d0).toFixed(1)} מ"מ`);
  if (p1 !== null && p1 < 2.2 * d0 - 0.01) w(`מרווח ברגים ${p1.toFixed(1)} < 2.2·d0 = ${(2.2 * d0).toFixed(1)} מ"מ`);
  if (p2 !== null && p2 < 2.4 * d0 - 0.01) w(`מרווח שורות ${p2.toFixed(1)} < 2.4·d0 = ${(2.4 * d0).toFixed(1)} מ"מ`);
}

function outlinePerimeter(profile: string): number {
  const o = getProfile(profile).outline.outer;
  let s = 0;
  for (let i = 0; i < o.length; i++) { const a = o[i], b = o[(i + 1) % o.length]; s += Math.hypot(b.u - a.u, b.v - a.v); }
  return s;
}

/**
 * בניית חיבורים: ראש עמוד (פלטת כיפה), רכס (פלטות קצה), בסיס (פלטת בסיס), פטה-קורה (זוויתן L).
 * עיקרון ייצור: ריתוך במסגריה בלבד, הרכבה בשטח בברגים בלבד. משנה את חיתוכי הקצה של העמודים/קורות
 * בהתאם לעובי הפלטות (מקור אמת אחד — אין גיאומטריה כפולה).
 */
export function buildConnections(project: Project, members: Member[], byId: Map<string, Member>, supports: SupportPoint[], topo: SectionTopology): ConnResult {
  const res: ConnResult = { members: [], connections: [], issues: [] };
  const b = project.building;
  const mat = b.material;
  const issue = (i: ValidationIssue) => res.issues.push(i);
  const isGen = (m?: Member) => !!m && m.source === 'generated' && !m.manualPlacement;

  for (const f of b.frames) {
    const fi = b.frames.indexOf(f) + 1;
    // ---- ראש עמוד: פלטה מרותכת לעמוד ופלטה מרותכת לקורה (מסגריה), מוברגות זו לזו (שטח)
    for (const jn of topo.junctions.filter((j) => j.kind === 'cap')) {
      const side = jn.line.id;
      const sideName = topo.sec.custom ? `ציר ${jn.line.label}` : side === 'L' ? 'שמאל' : 'ימין';
      const id = `C.EAVE.${f.id}.${side}`;
      const col = byId.get(`${f.id}.COL.${side}`);
      const raf = byId.get(jn.plane.rafterId(f.id));
      const prm = effPlate(project, 'eave', id);
      if (!prm.enabled || !isGen(col) || !isGen(raf) || !col!.endCut) continue;
      const U = col!.endCut!;
      const n = U.normal;
      const exr = norm(sub(raf!.end, raf!.start));
      const tAx = linePlaneT(col!.end, Z, U) ?? 0;
      const P0 = add(col!.end, scale(Z, tAx)); // מרכז פני עליון של הפלטה (במישור תחתון הקורה)
      // split (החלטת משתמש 15.11.2026): פלטה על ראש העמוד + פלטה מרותכת לתחתית הקורה, מוברגות זו לזו בשטח
      const split = prm.split !== false;
      const T = split ? 2 * prm.t : prm.t;
      col!.endCut = { point: sub(U.point, scale(n, T)), normal: n };
      const pid = `${id}.PL`, pid2 = `${id}.PL2`;
      const Pc = split ? sub(P0, scale(n, prm.t)) : P0; // פני עליון של פלטת העמוד
      res.members.push(partMember(pid, 'plate', `PL${prm.w}x${prm.t}`, sub(Pc, scale(exr, prm.l / 2)), add(Pc, scale(exr, prm.l / 2)), n, 'top', id, `פלטת ראש עמוד PL${prm.t}×${prm.w}×${prm.l}`, mat));
      if (split) res.members.push(partMember(pid2, 'plate', `PL${prm.w}x${prm.t}`, sub(P0, scale(exr, prm.l / 2)), add(P0, scale(exr, prm.l / 2)), n, 'top', id, `פלטת קורה PL${prm.t}×${prm.w}×${prm.l}`, mat));
      const rp = getProfile(raf!.profile), cp = getProfile(col!.profile);
      const tf = rp.dims.tf ?? rp.dims.t ?? 10;
      const yDir = norm(cross(n, exr));
      const bolts: BoltInfo[] = [];
      grid(prm.cols, prm.gauge).forEach((gy, ci) => grid(prm.rows, prm.pitch).forEach((px, ri) => {
        const head = add(add(sub(P0, scale(n, T)), scale(yDir, gy)), scale(exr, px));
        bolts.push(makeBolt(`${id}.B${ci + 1}${ri + 1}`, id, head, n, prm.bolt, split ? 2 * prm.t : prm.t + tf, 'site', split ? [pid, pid2] : [pid, raf!.id], exr, res.members));
      }));
      const d0 = prm.bolt.d + prm.bolt.clearance;
      const label = `חיבור ראש עמוד ${sideName} מסגרת ${fi}`;
      const rStart = (raf!.startCut ? linePlaneT(P0, exr, raf!.startCut) : null) ?? dot(sub(raf!.start, P0), exr);
      edgeChecks(label, id, d0, prm.l / 2 - ((prm.rows - 1) / 2) * prm.pitch, prm.w / 2 - ((prm.cols - 1) / 2) * prm.gauge,
        prm.rows > 1 ? prm.pitch : null, prm.cols > 1 ? prm.gauge : null, res.issues);
      const hwb = hw(prm.bolt.d);
      const cosA = Math.abs(dot(exr, v3(1, 0, 0))) || 1;
      if (split) {
        // פלטת הקורה בתחום הקורה
        if (-prm.l / 2 < rStart - 1) issue({ code: 'BOLT_OUTSIDE', severity: 'error', elementId: id, message: `${label}: פלטת הקורה חורגת מקצה קורת הגג — הגדל קונזולה או קצר את הפלטה` });
        const ck = checkEavePlate(prm, raf!.profile, col!.profile, cosA);
        if (ck.bolts.some((x) => x.nutHit)) issue({ code: 'EAVE_FIT', severity: 'error', elementId: id, message: `${label}: אום מעל פלטת הקורה מתנגש באגף הקורה — פתח "בדיקת פלטה" להצעת מידות` });
        if (ck.bolts.some((x) => x.headHit)) issue({ code: 'EAVE_FIT', severity: 'error', elementId: id, message: `${label}: ראש בורג מתחת לפלטת העמוד בתוך היטל העמוד — פתח "בדיקת פלטה" להצעת מידות` });
        if (!ck.coverOk) issue({ code: 'EAVE_FIT', severity: 'warning', elementId: id, message: `${label}: הפלטה אינה מכסה את חתך העמוד עם מקום לריתוך` });
      } else {
        for (const bo of bolts) {
          const tb = dot(sub(bo.p, P0), exr);
          if (tb - d0 / 2 < rStart + 1.2 * d0 - 0.01) issue({ code: 'BOLT_OUTSIDE', severity: 'error', elementId: id, message: `${label}: בורג ${bo.id} מחוץ לקורת הגג או קרוב מדי לקצה שלה — הגדל קונזולה או קצר את הפלטה` });
        }
        const flangeEdge = rp.props.b / 2 - ((prm.cols - 1) / 2) * prm.gauge;
        if (flangeEdge < 1.2 * d0) issue({ code: 'BOLT_EDGE', severity: 'warning', elementId: id, message: `${label}: ברגים קרובים לשפת אגף הקורה (${flangeEdge.toFixed(1)} מ"מ)` });
        if (prm.w > rp.props.b + 0.5) issue({ code: 'PLATE_WIDE', severity: 'info', elementId: id, message: `${label}: הפלטה רחבה מאגף הקורה` });
        const colHalf = cp.props.h / 2 / cosA;
        if (prm.rows > 1 && (prm.pitch / 2 - (prm.bolt.d + 2 * hwb.s) / 2) < colHalf) {
          issue({ code: 'BOLT_ACCESS', severity: 'warning', elementId: id, message: `${label}: ברגים בתוך היטל העמוד — אין גישה לכלי עבודה מתחת לפלטה` });
        }
      }
      const welds: WeldInfo[] = [{ id: `${id}.W1`, connId: id, type: 'fillet', a: prm.weldSize, length: outlinePerimeter(col!.profile), location: 'shop', between: [col!.id, pid], from: sub(P0, scale(n, T)), to: sub(P0, scale(n, T)) }];
      if (split) welds.push({ id: `${id}.W2`, connId: id, type: 'fillet', a: prm.weldSize, length: 2 * Math.min(prm.l, prm.l) + 2 * rp.props.b, location: 'shop', between: [raf!.id, pid2], from: P0, to: P0 });
      res.connections.push({ id, type: 'eave', label, members: [col!.id, raf!.id], parts: [pid, ...(split ? [pid2] : []), ...bolts.map((x) => x.id)], bolts, welds, status: statusOf(project, id), fixity: project.connectionOverrides[id]?.fixity ?? 'rigid', overridden: !!project.connectionOverrides[id] });
    }

    // ---- רכס: פלטות קצה מרותכות לקורות (מסגריה), מוברגות זו לזו (שטח)
    for (const rg of topo.ridges) {
      const legacy = !topo.sec.custom;
      const id = legacy ? `C.RIDGE.${f.id}` : `C.RIDGE.${f.id}.${rg.pa.id}.${rg.pb.id}`;
      // rl: הקורה שמשמאל לרכס
      const aLeft = (rg.ea === 'a' ? rg.pa.b.x : rg.pa.a.x) < rg.x;
      const [pl0, e0, pr0, e1] = aLeft ? [rg.pa, rg.ea, rg.pb, rg.eb] : [rg.pb, rg.eb, rg.pa, rg.ea];
      const rl = byId.get(pl0.rafterId(f.id)), rr = byId.get(pr0.rafterId(f.id));
      const setCut = (m: Member, e: 'a' | 'b', pl: Plane) => { if (e === 'b') m.endCut = pl; else m.startCut = pl; };
      const prm = effPlate(project, 'ridge', id);
      if (prm.enabled && isGen(rl) && isGen(rr)) {
        const rp = getProfile(rl!.profile);
        const sl = Math.abs((rl!.end.z - rl!.start.z) / (rl!.end.x - rl!.start.x));
        const sr = Math.abs((rr!.end.z - rr!.start.z) / (rr!.end.x - rr!.start.x));
        const hv = Math.max(rp.props.h * Math.sqrt(1 + sl * sl), getProfile(rr!.profile).props.h * Math.sqrt(1 + sr * sr));
        const rr0 = b.ridgeReinf;
        const haunch = rr0?.type === 'plate';
        // שיטת הפלטה: פלטת הקצה מוגבהת מתחת לקורות לעומק ההגבהה, ושורת ברגים נוספת
        const ext = haunch ? Math.max(prm.l, rr0!.depth) : prm.l;
        const Hp = hv + ext;
        const rows = haunch ? Math.max(prm.rows, 3) : prm.rows;
        const top = v3(rg.x, f.y, rg.z); // נקודת הרכס על קו הייחוס
        const X = v3(1, 0, 0);
        setCut(rl!, e0, { point: sub(top, scale(X, prm.t)), normal: X });
        setCut(rr!, e1, { point: add(top, scale(X, prm.t)), normal: X });
        const pl = `${id}.PL1`, pr = `${id}.PL2`;
        res.members.push(partMember(pl, 'plate', `PL${prm.w}x${Hp.toFixed(1)}`, sub(top, scale(X, prm.t)), top, Z, 'top', id, `פלטת קצה PL${prm.t}×${prm.w}×${Math.ceil(Hp)}`, mat));
        res.members.push(partMember(pr, 'plate', `PL${prm.w}x${Hp.toFixed(1)}`, top, add(top, scale(X, prm.t)), Z, 'top', id, `פלטת קצה PL${prm.t}×${prm.w}×${Math.ceil(Hp)}`, mat));
        const e = Math.max(40, 1.5 * (prm.bolt.d + prm.bolt.clearance));
        const zs = rows <= 1 ? [Hp / 2] : Array.from({ length: rows }, (_, i) => e + ((Hp - 2 * e) * i) / (rows - 1));
        const bolts: BoltInfo[] = [];
        grid(prm.cols, prm.gauge).forEach((gy, ci) => zs.forEach((zz, ri) => {
          const head = add(sub(top, scale(X, prm.t)), v3(0, gy, -zz));
          bolts.push(makeBolt(`${id}.B${ci + 1}${ri + 1}`, id, head, X, prm.bolt, 2 * prm.t, 'site', [pl, pr], Z, res.members));
        }));
        const d0 = prm.bolt.d + prm.bolt.clearance;
        const label = `חיבור רכס מסגרת ${fi}`;
        edgeChecks(label, id, d0, e, prm.w / 2 - ((prm.cols - 1) / 2) * prm.gauge, null, prm.cols > 1 ? prm.gauge : null, res.issues);
        const tf = rp.dims.tf ?? 10;
        for (const zz of zs) {
          const toFlange = haunch ? zz - tf : Math.min(zz - tf, Hp - prm.l - tf - zz);
          if (toFlange < hw(prm.bolt.d).s / 2 + 2) issue({ code: 'BOLT_ACCESS', severity: 'warning', elementId: id, message: `${label}: שורת ברגים קרובה לאגף הקורה (${toFlange.toFixed(1)} מ"מ) — מרווח אום/מפתח לבדיקה` });
        }
        const welds: WeldInfo[] = [rl!, rr!].map((r, k) => ({ id: `${id}.W${k + 1}`, connId: id, type: 'fillet' as const, a: prm.weldSize, length: outlinePerimeter(r.profile), location: 'shop' as const, between: [r.id, k ? pr : pl] as [string, string], from: top, to: top }));
        const extra: string[] = [];
        if (haunch) {
          // פלטת חיזוק משולשת מתחת לכל קורה: מתחתית פלטת הקצה עד תחתית הקורה במרחק length מהרכס
          for (const [k, r, sgn, plId] of [[1, rl!, -1, pl], [2, rr!, 1, pr]] as const) {
            const sid = `${id}.ST${k}`;
            const slope = (r.end.z - r.start.z) / (r.end.x - r.start.x);
            const rph = getProfile(r.profile);
            const hvr = rph.props.h * Math.sqrt(1 + slope * slope);
            const x0 = rg.x + sgn * prm.t, x1 = rg.x + sgn * rr0!.length;
            const under = (x: number) => rg.z + slope * (x - rg.x) - hvr; // תחתית הקורה (TOS − עומק אנכי)
            const B = v3(x0, f.y, under(x0)), Cp = v3(x1, f.y, under(x1));
            const A = v3(x0, f.y, top.z - Hp);
            const ex = norm(sub(Cp, B));
            const a = Math.ceil(under(x0) - A.z); // גובה המשולש בפלטת הקצה (מעוגל — הקצה העליון בדיוק בתחתית הקורה)
            let nUp = norm(sub(Z, scale(ex, dot(Z, ex)))); if (nUp.z < 0) nUp = scale(nUp, -1);
            // גובה המשולש בניצב לקורה (a הוא אנכי): הצלע התחתונה של הפריזמה עוברת בדיוק בנקודה A — גם בשיפוע תלול
            const aP = Math.round(a * Math.abs(nUp.z) * 10) / 10;
            const off = scale(nUp, -aP / 2);
            const nCut = norm(cross(sub(Cp, A), v3(0, 1, 0)));
            const nOut = dot(nCut, ex) > 0 ? nCut : scale(nCut, -1);
            const len = Math.hypot(x1 - x0, Cp.z - B.z) + a;
            res.members.push({ id: sid, kind: 'plate', label: `פלטת חיזוק רכס PL${rr0!.stiffT}`, start: sub(add(B, off), scale(ex, a)), end: add(add(B, off), scale(ex, len)), profile: `PL${aP}x${rr0!.stiffT}`, material: mat, rollDeg: 0, mirror: false, anchor: 'center', refUp: v3(0, 1, 0), source: 'generated', manualPlacement: false, connId: id, startCut: { point: B, normal: scale(X, -sgn) }, endCut: { point: Cp, normal: nOut }, partDesc: `פלטת חיזוק רכס משולשת PL${rr0!.stiffT}×${Math.ceil(a)}×${Math.ceil(Math.abs(x1 - x0))}` });
            extra.push(sid);
            welds.push({ id: `${sid}.W1`, connId: id, type: 'fillet', a: rr0!.weldSize, length: 2 * Math.abs(x1 - x0), location: 'shop', between: [r.id, sid], from: B, to: Cp });
            welds.push({ id: `${sid}.W2`, connId: id, type: 'fillet', a: rr0!.weldSize, length: 2 * a, location: 'shop', between: [plId, sid], from: A, to: B });
          }
          issue({ code: 'RIDGE_HAUNCH', severity: 'info', elementId: id, message: `${label}: חיזוק רכס בשיטת הפלטה — פלטת קצה מוגבהת ${Math.round(ext)} מ"מ ופלטות חיזוק משולשות (גיאומטריה בלבד)` });
        }
        res.connections.push({ id, type: 'ridge', label, members: [rl!.id, rr!.id], parts: [pl, pr, ...extra, ...bolts.map((x) => x.id)], bolts, welds, status: statusOf(project, id), fixity: project.connectionOverrides[id]?.fixity ?? 'rigid', overridden: !!project.connectionOverrides[id] });
        if (rr0?.type === 'tie') buildRidgeTie(res, project, f.id, fi, rg.x, rg.z, rl!, rr!, top.z - hv, mat);
      }
    }

    // ---- חיבור צד: קורה שמסתיימת בעמוד שממשיך מעליה (גג מדורג / רכס מעל עמוד).
    //      פלטת קצה מרותכת לקורה (מסגריה), מוברגת לאגף העמוד (שטח) — אום בין האגף לווב העמוד.
    for (const jn of topo.junctions.filter((j) => j.kind === 'side')) {
      const id = `C.SIDE.${f.id}.${jn.line.id}.${jn.plane.id}`;
      const col = byId.get(`${f.id}.COL.${jn.line.id}`), raf = byId.get(jn.plane.rafterId(f.id));
      const prm = effPlate(project, 'side', id);
      if (!prm.enabled || !isGen(col) || !isGen(raf)) continue;
      const cp = getProfile(col!.profile), rp = getProfile(raf!.profile);
      const X = v3(1, 0, 0);
      const sgn = jn.side;
      const xFace = jn.line.x + sgn * cp.props.h / 2;
      const cut: Plane = { point: v3(xFace + sgn * prm.t, f.y, 0), normal: X };
      if (jn.end === 'b') raf!.endCut = cut; else raf!.startCut = cut;
      const pl = jn.plane;
      const sl = (pl.b.z - pl.a.z) / (pl.b.x - pl.a.x);
      const hv = rp.props.h * Math.sqrt(1 + sl * sl);
      const zRef = zAt(pl, xFace);
      const tos = raf!.anchor === 'top' ? zRef : zRef + hv / 2;
      const zTop = tos + prm.l, zBot = tos - hv - prm.l; // l = הארכת הפלטה מעל/מתחת לקורה
      const Hp = zTop - zBot;
      const pid = `${id}.PL`;
      // פלטה: עובי לאורך X, רוחב לאורך Y, גובה לאורך Z — קו ייחוס אנכי במרכז עובי הפלטה
      const xc = xFace + sgn * prm.t / 2;
      res.members.push(partMember(pid, 'plate', `PL${prm.w}x${prm.t}`, v3(xc, f.y, zBot), v3(xc, f.y, zTop), X, 'center', id, `פלטת קצה PL${prm.t}×${prm.w}×${Math.ceil(Hp)}`, mat));
      const e = Math.max(40, 1.5 * (prm.bolt.d + prm.bolt.clearance));
      const zs = prm.rows <= 1 ? [(zTop + zBot) / 2] : Array.from({ length: prm.rows }, (_, i) => zTop - e - ((Hp - 2 * e) * i) / (prm.rows - 1));
      const bolts: BoltInfo[] = [];
      const tfc = cp.dims.tf ?? cp.dims.t ?? 10;
      grid(prm.cols, prm.gauge).forEach((gy, ci) => zs.forEach((zz, ri) => {
        const head = v3(xFace + sgn * prm.t, f.y + gy, zz);
        bolts.push(makeBolt(`${id}.B${ci + 1}${ri + 1}`, id, head, scale(X, -sgn), prm.bolt, prm.t + tfc, 'site', [pid, col!.id], Z, res.members));
      }));
      const d0 = prm.bolt.d + prm.bolt.clearance;
      const label = `חיבור ${pl.label} לצד עמוד ציר ${jn.line.label} מסגרת ${fi}`;
      edgeChecks(label, id, d0, e, prm.w / 2 - ((prm.cols - 1) / 2) * prm.gauge, null, prm.cols > 1 ? prm.gauge : null, res.issues);
      if (prm.w > cp.props.b + 0.5) issue({ code: 'PLATE_WIDE', severity: 'warning', elementId: id, message: `${label}: הפלטה רחבה מאגף העמוד (${cp.props.b})` });
      const nutR = hw(prm.bolt.d).s / Math.sqrt(3) + 2;
      const tw = cp.dims.tw ?? 8;
      if (prm.gauge / 2 - nutR < tw / 2 + 2) issue({ code: 'BOLT_ACCESS', severity: 'warning', elementId: id, message: `${label}: אום בתוך העמוד קרוב לווב — הגדל מרווח ברגים` });
      if (zTop > (col!.end.z) + 1) issue({ code: 'SIDE_ABOVE', severity: 'error', elementId: id, message: `${label}: הפלטה גבוהה מראש העמוד — הגבה את העמוד או הנמך את המישור` });
      const welds: WeldInfo[] = [{ id: `${id}.W1`, connId: id, type: 'fillet', a: prm.weldSize, length: outlinePerimeter(raf!.profile), location: 'shop', between: [raf!.id, pid], from: v3(xc, f.y, tos), to: v3(xc, f.y, tos) }];
      res.connections.push({ id, type: 'rafter-side', label, members: [col!.id, raf!.id], parts: [pid, ...bolts.map((x) => x.id)], bolts, welds, status: statusOf(project, id), fixity: project.connectionOverrides[id]?.fixity ?? 'rigid', overridden: !!project.connectionOverrides[id] });
    }

    // ---- בסיס. embedded (ברירת מחדל, לפי החלטת המשתמש): פלטה מבוטנת + מוטות עיגון מרותכים במסגריה, העמוד מרותך בשטח.
    //      bolted: פלטה מרותכת לעמוד במסגריה, ברגי עיגון בשטח.
    for (const ln of topo.sec.lines) {
      const side = ln.id;
      const id = `C.BASE.${f.id}.${side}`;
      const col = byId.get(`${f.id}.COL.${side}`);
      const prm = effPlate(project, 'base', id);
      if (!prm.enabled || !isGen(col)) continue;
      const X = v3(1, 0, 0);
      const pid = `${id}.PL`;
      const label = `פלטת בסיס ${topo.sec.custom ? `ציר ${ln.label}` : side === 'L' ? 'שמאל' : 'ימין'} מסגרת ${fi}`;
      const cp = getProfile(col!.profile);
      const embedded = (prm.mode ?? 'embedded') === 'embedded';
      const base = col!.start;
      const top = embedded ? base : add(base, scale(Z, prm.t));
      if (!embedded) col!.startCut = { point: top, normal: Z };
      res.members.push(partMember(pid, 'plate', `PL${prm.w}x${prm.t}`, sub(top, scale(X, prm.l / 2)), add(top, scale(X, prm.l / 2)), Z, 'top', id,
        embedded ? `פלטה מבוטנת PL${prm.t}×${prm.w}×${prm.l}` : `פלטת בסיס PL${prm.t}×${prm.w}×${prm.l}`, mat));
      const bolts: BoltInfo[] = [];
      const welds: WeldInfo[] = [];
      const h = hw(prm.bolt.d);
      if (embedded) {
        // מוטות עיגון בהיקף רשת cols×rows, מרותכים מתחת לפלטה (מסגריה)
        const gx = grid(prm.rows, prm.pitch), gy = grid(prm.cols, prm.gauge);
        let k = 0;
        gy.forEach((yy, ci) => gx.forEach((xx, ri) => {
          if (!(ci === 0 || ci === prm.cols - 1 || ri === 0 || ri === prm.rows - 1)) return;
          k++;
          const p0 = add(top, v3(xx, yy, -prm.t));
          const aid = `${id}.A${k}`;
          res.members.push({ id: aid, kind: 'anchor', label: `מוט עיגון Φ${prm.bolt.d}`, start: p0, end: add(p0, v3(0, 0, -(prm.anchorLength ?? 800))), profile: `RD${prm.bolt.d}`, material: 'S235', rollDeg: 0, mirror: false, anchor: 'center', refUp: X, source: 'generated', manualPlacement: false, connId: id, partDesc: `מוט עיגון Φ${prm.bolt.d} L=${prm.anchorLength ?? 800} מרותך לפלטה` });
          welds.push({ id: `${id}.WA${k}`, connId: id, type: 'fillet', a: prm.weldSize, length: Math.PI * prm.bolt.d, location: 'shop', between: [pid, aid], from: p0, to: p0 });
        }));
        const edge = Math.min(prm.l / 2 - ((prm.rows - 1) / 2) * prm.pitch, prm.w / 2 - ((prm.cols - 1) / 2) * prm.gauge);
        if (edge < prm.bolt.d) issue({ code: 'ANCHOR_EDGE', severity: 'warning', elementId: id, message: `${label}: מוט עיגון קרוב לשפת הפלטה (${edge.toFixed(1)} מ"מ)` });
        welds.push({ id: `${id}.W1`, connId: id, type: 'fillet', a: prm.weldSize, length: outlinePerimeter(col!.profile), location: 'site', between: [col!.id, pid], from: top, to: top });
        issue({ code: 'SITE_WELD_OK', severity: 'info', elementId: id, message: `${label}: ריתוך העמוד לפלטה המבוטנת בשטח — חריג מאושר לעיקרון; נדרש תיקון גלוון. לקבע את הפלטה במקומה ובמפלס לפני היציקה.` });
      } else {
        const anchorLen = (prm.anchorLength ?? 500) + prm.t + h.w + h.m + 2 * h.P;
        grid(prm.cols, prm.gauge).forEach((gy, ci) => grid(prm.rows, prm.pitch).forEach((px, ri) => {
          const headTop = add(top, v3(px, gy, h.w + h.m + 2 * h.P));
          bolts.push(makeBolt(`${id}.A${ci + 1}${ri + 1}`, id, headTop, v3(0, 0, -1), prm.bolt, prm.t, 'site', [pid], X, res.members, anchorLen));
        }));
        const d0 = prm.bolt.d + prm.bolt.clearance;
        edgeChecks(label, id, d0, prm.l / 2 - ((prm.rows - 1) / 2) * prm.pitch, prm.w / 2 - ((prm.cols - 1) / 2) * prm.gauge, prm.rows > 1 ? prm.pitch : null, prm.cols > 1 ? prm.gauge : null, res.issues);
        if (prm.rows > 1 && prm.pitch / 2 - h.s / 2 < cp.props.h / 2 + 5) issue({ code: 'BOLT_ACCESS', severity: 'warning', elementId: id, message: `${label}: ברגי העיגון קרובים מדי לעמוד — אין מקום לאום/מפתח` });
        welds.push({ id: `${id}.W1`, connId: id, type: 'fillet', a: prm.weldSize, length: outlinePerimeter(col!.profile), location: 'shop', between: [col!.id, pid], from: top, to: top });
      }
      if (prm.l < cp.props.h + 2 * prm.weldSize || prm.w < cp.props.b + 2 * prm.weldSize) issue({ code: 'PLATE_SMALL', severity: 'warning', elementId: id, message: `${label}: הפלטה קטנה מחתך העמוד בתוספת מקום לריתוך` });
      res.connections.push({ id, type: 'base', label, members: [col!.id], parts: [pid, ...bolts.map((x) => x.id), ...res.members.filter((m) => m.connId === id && m.kind === 'anchor').map((m) => m.id)], bolts, welds, status: statusOf(project, id), fixity: project.connectionOverrides[id]?.fixity ?? 'pinned', overridden: !!project.connectionOverrides[id] });
    }
  }

  // ---- חיבור המשך פטה: פלטה בצד הפנימי של הווב (מול הזוויתן), 2 ברגים בכל פטה (שטח). החלטת משתמש 15.11.2026
  const splicePlates = new Map<string, { id: string; y0: number; y1: number; T: number }[]>();
  const sp0 = b.purlins.splice;
  for (const pur of members) {
    if (!pur.purlin || !isGen(pur)) continue;
    const ts = [...new Set(project.splices[pur.id] ?? [])].sort((a, c) => a - c);
    if (!ts.length) continue;
    const pp = tryProfile(pur.profile);
    if (!pp || (pp.family !== 'C' && pp.family !== 'Z')) continue;
    const lf = localFrame(pur);
    const n = lf.v, tw = pp.dims.t;
    const d = pp.family === 'Z' ? lf.u : scale(lf.u, -1); // צד הזוויתן
    const back = scale(d, -1);
    const h = pp.props.h;
    const H = sp0.plateH ?? Math.floor((h - 4 * tw - 20) / 10) * 10;
    const gV = H - 2 * sp0.edge;
    const side = pur.purlin.paramKey ?? (pur.purlin.side === 'R' ? 'right' : 'left');
    const cl = purlinParams(b.purlins, side).cleat;
    const supT = supports.filter((x) => x.purlinId === pur.id).map((x) => dot(sub(x.p, pur.start), lf.ex));
    ts.forEach((t, k) => {
      if (!(t > 100 && t < lf.length - 100)) return; // נבדק ב-buildParts (SPLICE_RANGE)
      const id = `C.PS.${pur.id}.${k + 1}`;
      const pid = `${id}.PL`;
      // מרחק עמודת הברגים מהתפר בכל צד: לפחות jointOffset, ומחוץ לרוחב הזוויתן (+ מרווח) אם יש תומך סמוך
      const clr = sp0.edge + 5;
      const offFor = (sg: number) => {
        let o = sp0.jointOffset;
        if (!cl.enabled) return o;
        for (let g = 0; g < 20; g++) {
          const tb = t + sg * o;
          const hit = supT.find((st) => Math.abs(tb - st) < cl.width / 2 + clr);
          if (hit === undefined) break;
          o = Math.abs(hit + sg * (cl.width / 2 + clr) - t);
        }
        return o;
      };
      const oL = offFor(-1), oR = offFor(1);
      const L = oL + oR + 2 * sp0.edge;
      const J = add(pur.start, scale(lf.ex, t));
      const C = add(add(J, scale(n, h / 2)), scale(back, tw / 2 + sp0.plateT / 2));
      const y0p = -(oL + sp0.edge), y1p = oR + sp0.edge;
      res.members.push(partMember(pid, 'plate', `PL${H}x${sp0.plateT}`, add(C, scale(lf.ex, y0p)), add(C, scale(lf.ex, y1p)), back, 'center', id,
        `פלטת המשך פטה PL${sp0.plateT}×${H}×${L}`, b.purlins.material));
      const bolts: BoltInfo[] = [];
      [-1, 1].forEach((sg, si) => [-gV / 2, gV / 2].forEach((zz, zi) => {
        const head = add(add(add(J, scale(lf.ex, sg < 0 ? -oL : oR)), scale(n, h / 2 + zz)), scale(d, tw / 2));
        bolts.push(makeBolt(`${id}.B${si + 1}${zi + 1}`, id, head, back, sp0.bolt, tw + sp0.plateT, 'site', [pur.id, pid], n, res.members));
      }));
      const d0 = sp0.bolt.d + sp0.bolt.clearance;
      const label = `חיבור המשך ${pur.label} (${(t / 1000).toFixed(3)} מ')`;
      edgeChecks(label, id, d0, sp0.edge, sp0.edge, gV, null, res.issues);
      if (Math.min(oL, oR) < 1.2 * d0) issue({ code: 'BOLT_EDGE', severity: 'warning', elementId: id, message: `${label}: מרחק הבורג מקצה הפטה ${Math.min(oL, oR)} מ"מ < 1.2·d0` });
      const flat0 = 2 * tw, flat1 = h - 2 * tw;
      if (h / 2 - gV / 2 - d0 / 2 < flat0 || h / 2 + gV / 2 + d0 / 2 > flat1) issue({ code: 'HOLE_FLAT', severity: 'warning', elementId: id, message: `${label}: חור מחוץ לאזור השטוח של ווב הפטה` });
      if (pp.family === 'C' && H > h - 2 * tw - 2 * (pp.dims.r ?? tw)) issue({ code: 'PLATE_WIDE', severity: 'warning', elementId: id, message: `${label}: גובה הפלטה ${H} גדול מהאזור השטוח בין האגפים` });
      const arr = splicePlates.get(pur.id) ?? [];
      arr.push({ id: pid, y0: t + y0p, y1: t + y1p, T: sp0.plateT });
      splicePlates.set(pur.id, arr);
      res.connections.push({ id, type: 'purlin-splice', label, members: [pur.id], parts: [pid, ...bolts.map((x) => x.id)], bolts, welds: [], status: statusOf(project, id), fixity: 'pinned', overridden: false });
    });
  }

  // ---- אלכסוני עמוד-קורה
  { const kbr = buildKneeBraces(project, topo, byId); res.members.push(...kbr.members); res.connections.push(...kbr.connections); res.issues.push(...kbr.issues); }

  // ---- פטה-קורה: זוויתן L מרותך לקורה (מסגריה), מוברג לווב הפטה (שטח)
  for (const sp of supports) {
    const pur = byId.get(sp.purlinId), raf = byId.get(sp.rafterId);
    if (!pur || !raf || !pur.purlin) continue;
    const side = pur.purlin.paramKey ?? (pur.purlin.side === 'R' ? 'right' : 'left');
    const cid = `CL.${sp.purlinId}.${sp.frameId}`;
    const id = `C.PC.${sp.purlinId}.${sp.frameId}`;
    const prm = effCleat(project, side, cid);
    if (!prm.enabled) continue;
    const pp = tryProfile(pur.profile);
    if (!pp) continue;
    const lf = localFrame(pur);
    const n = lf.v;
    const tw = pp.family === 'C' || pp.family === 'Z' ? pp.dims.t : pp.family === 'RHS' || pp.family === 'SHS' ? pp.dims.t : pp.dims.tw ?? pp.dims.t ?? 3;
    // צד הזוויתן: הרחק מהאגף התחתון של הפטה. C: האגפים לכיוון +u ⇒ הזוויתן ב-u-. Z: האגף התחתון ב-u- ⇒ הזוויתן ב-u+.
    const d = pp.family === 'Z' ? lf.u : scale(lf.u, -1);
    let wb: number;
    if (pp.family === 'C' || pp.family === 'Z') wb = tw / 2;
    else {
      const sign = dot(d, lf.u);
      wb = Math.max(...pp.outline.outer.map((q) => q.u * sign));
    }
    // גובה אוטומטי: גובה הפטה; בפטת Z הזוויתן בצד האגף העליון — נעצר מתחת לאגף ולרדיוס הכיפוף (החלטת משתמש 15.11.2026)
    const autoH = pp.family === 'Z' ? Math.floor((pp.props.h - pp.dims.t - (pp.dims.r ?? 2 * pp.dims.t) - 5) / 5) * 5 : pp.props.h;
    const H = prm.height ?? autoH;
    if (prm.height !== null && Math.abs(prm.height - autoH) > 0.5) {
      issue({ code: 'CLEAT_MANUAL', severity: 'info', elementId: cid, message: `תומך ${cid}: גובה ${prm.height} מ"מ נקבע ידנית (אוטומטי: ${autoH} מ"מ)` });
    }
    if (pp.family === 'Z' && H > autoH + 0.5) issue({ code: 'CLASH', severity: 'error', elementId: cid, message: `תומך ${cid}: הזוויתן (${H}) חודר לאגף העליון של פטת Z — גובה מרבי ${autoH} מ"מ`, cleatFix: { label: `גובה ${autoH}`, side, cleatId: project.cleatOverrides[cid] ? cid : undefined, patch: { height: null } } });
    const Q = add(sp.p, scale(d, wb)); // פינת הזוויתן: על מישור הגג, צמודה לפני הווב (0 מ"מ)
    const Y = v3(0, 1, 0);
    const prof = `L${H}x${prm.base}x${prm.thickness}`;
    const uC = cross(n, Y);
    const mirror = dot(uC, d) < 0;
    const cleat = partMember(cid, 'cleat', prof, sub(Q, scale(Y, prm.width / 2)), add(Q, scale(Y, prm.width / 2)), n, 'corner', id, `זוויתן L${H}×${prm.base}×${prm.thickness}, רוחב ${prm.width}`, project.building.purlins.material, mirror);
    res.members.push(cleat);
    const hh0 = prm.holeHeight ?? (H - (prm.rows - 1) * prm.rowPitch) / 2;
    const bolts: BoltInfo[] = [];
    const backD = scale(d, -1);
    for (let r = 0; r < prm.rows; r++) {
      grid(prm.perRow, prm.pitch).forEach((gy, ci) => {
        const head = add(add(add(Q, scale(d, prm.thickness)), scale(n, hh0 + r * prm.rowPitch)), scale(Y, gy));
        // בורג התומך שעובר גם בפלטת חיבור המשך (תפר מעל התומך)
        const tb = dot(sub(head, pur.start), lf.ex);
        const spl = (splicePlates.get(pur.id) ?? []).find((q) => tb > q.y0 + 1 && tb < q.y1 - 1);
        bolts.push(makeBolt(`${id}.B${r + 1}${ci + 1}`, id, head, backD, prm.bolt, prm.thickness + tw + (spl?.T ?? 0), 'site', spl ? [cid, pur.id, spl.id] : [cid, pur.id], n, res.members));
      });
    }
    const d0 = prm.bolt.d + prm.bolt.clearance;
    const label = `תומך ${cid}`;
    const yMin = Math.min(pur.start.y, pur.end.y), yMax = Math.max(pur.start.y, pur.end.y);
    for (const bo of bolts) {
      if (bo.p.y - d0 / 2 < yMin + 1.2 * d0 - 0.01 || bo.p.y + d0 / 2 > yMax - 1.2 * d0 + 0.01) {
        issue({ code: 'BOLT_OUTSIDE', severity: 'error', elementId: cid, message: `${label}: בורג ${bo.id} מחוץ לפטה או קרוב מדי לקצה שלה — הארך את קונזולת הפטות` });
      }
    }
    const top = hh0 + (prm.rows - 1) * prm.rowPitch;
    const nIss = res.issues.length;
    edgeChecks(label, cid, d0, prm.width / 2 - ((prm.perRow - 1) / 2) * prm.pitch, H - top, prm.perRow > 1 ? prm.pitch : null, prm.rows > 1 ? prm.rowPitch : null, res.issues);
    // הצעת תיקון: הרחבת הזוויתן כך שמרחק הקצה ≥ 1.2·d0 (מעוגל ל-5), או הורדת החורים
    for (const iss of res.issues.slice(nIss)) {
      const minE = Math.ceil((1.2 * d0) / 5) * 5;
      const ov = project.cleatOverrides[cid] ? cid : undefined;
      if (iss.message.includes('מרחק קצה')) {
        const w = (prm.perRow - 1) * prm.pitch + 2 * minE;
        iss.cleatFix = { label: `רוחב זוויתן ${w}`, side, cleatId: ov, patch: { width: w } };
      } else if (iss.message.includes('מרחק שפה')) {
        const hh = Math.max(prm.thickness + 15, H - minE - (prm.rows - 1) * prm.rowPitch);
        iss.cleatFix = { label: `גובה חורים ${hh}`, side, cleatId: ov, patch: { holeHeight: hh } };
      }
    }
    const h = hw(prm.bolt.d);
    // מרווח כלי עבודה: ראש הבורג מעל רגל הבסיס
    if (hh0 - (h.s / Math.sqrt(3)) < prm.thickness + 5) issue({ code: 'BOLT_ACCESS', severity: 'warning', elementId: cid, message: `${label}: ראש הבורג קרוב לרגל הבסיס — מרווח מפתח לבדיקה` });
    // הבורג בתוך האזור השטוח של הווב (בין האגפים)
    if (pp.family === 'C' || pp.family === 'Z') {
      const flat0 = 2 * pp.dims.t, flat1 = pp.props.h - 2 * pp.dims.t;
      if (hh0 - d0 / 2 < flat0 || top + d0 / 2 > flat1) issue({ code: 'HOLE_FLAT', severity: 'warning', elementId: cid, message: `${label}: חור מחוץ לאזור השטוח של ווב הפטה` });
      const protrude = boltLength(prm.bolt.d, prm.thickness + tw) - prm.thickness - tw;
      if (pp.family === 'C' && protrude > pp.dims.b - tw) issue({ code: 'BOLT_LONG', severity: 'warning', elementId: cid, message: `${label}: הבורג בולט מעבר לרוחב אגף הפטה` });
    }
    const welds: WeldInfo[] = [{
      id: `${id}.W1`, connId: id, type: 'fillet', a: prm.weldSize, length: prm.width + 2 * prm.base, location: 'shop', between: [raf.id, cid],
      from: add(sub(Q, scale(Y, prm.width / 2)), scale(d, prm.base)), to: add(add(Q, scale(Y, prm.width / 2)), scale(d, prm.base)),
    }];
    res.connections.push({ id, type: 'purlin-cleat', label: `פטה-קורה ${sp.purlinId} / ${sp.frameId}`, members: [pur.id, raf.id], parts: [cid, ...bolts.map((x) => x.id)], bolts, welds, status: statusOf(project, id), fixity: 'pinned', overridden: !!project.cleatOverrides[cid] });
  }

  // כלל ייצור: ריתוך רק במסגריה
  for (const c of res.connections) for (const w of c.welds) {
    if (w.location === 'site' && !(c.type === 'base' && res.issues.some((i) => i.code === 'SITE_WELD_OK' && i.elementId === c.id))) issue({ code: 'SITE_WELD', severity: 'warning', elementId: c.id, message: `${c.label}: ריתוך בשטח — מנוגד לעיקרון (ריתוך במסגריה, גלוון, הרכבה בברגים)` });
  }
  // חיזוק רכס: הודעה אחת לכל המסגרות
  const rh = res.issues.filter((i) => i.code === 'RIDGE_HAUNCH');
  if (rh.length > 1) {
    res.issues = res.issues.filter((i) => i.code !== 'RIDGE_HAUNCH');
    res.issues.push({ ...rh[0], elementId: undefined, message: `חיזוק רכס בשיטת הפלטה ב-${rh.length} חיבורים: ${rh[0].message.split(': ').slice(1).join(': ')}` });
  }
  // הודעה אחת (במקום אחת לכל עמוד) על ריתוך הפלטות המבוטנות בשטח
  const okW = res.issues.filter((i) => i.code === 'SITE_WELD_OK');
  if (okW.length) {
    res.issues = res.issues.filter((i) => i.code !== 'SITE_WELD_OK');
    res.issues.push({ code: 'SITE_WELD_OK', severity: 'info', message: `${okW.length} פלטות בסיס מבוטנות: העמוד מרותך לפלטה בשטח — חריג מאושר לעיקרון; נדרש תיקון גלוון במקום הריתוך. לקבע את הפלטות במקומן ובמפלס לפני היציקה.` });
  }
  void members;
  return res;
}

/** בדיקת התנגשויות מקומית: זוויתן מול פטה/קורה, פטה מול קורה, אזור הרכס, פלטות מול עמוד/קורה. */
export function checkClashes(conns: Connection[], byId: Map<string, Member>): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const seen = new Set<string>();
  const test = (a?: Member, b?: Member, note = '') => {
    if (!a || !b) return;
    const key = [a.id, b.id].sort().join('|');
    if (seen.has(key)) return;
    seen.add(key);
    const c = clash(a, b);
    if (c) out.push({ code: 'CLASH', severity: 'error', elementId: a.id, message: `התנגשות ${a.id} ↔ ${b.id}: חדירה ${c.depth.toFixed(1)} מ"מ${note}` });
  };
  const ridgeGroup: Member[] = [];
  for (const c of conns) {
    if (c.type === 'custom') continue; // נבדק בבניית הפרט המותאם
    if (c.type === 'purlin-cleat') {
      const [pid, rid] = c.members;
      const cl = byId.get(c.parts[0]);
      test(cl, byId.get(pid)); test(cl, byId.get(rid)); test(byId.get(pid), byId.get(rid));
      const pur = byId.get(pid);
      if (pur?.purlin && pur.purlin.index === 1 && pur.purlin.side !== 'M' && cl) ridgeGroup.push(cl);
      // ראשי ברגים ואומים מול הקורה
      for (const bo of c.bolts) { test(byId.get(`${bo.id}.H`), byId.get(rid)); test(byId.get(`${bo.id}.N`), byId.get(rid)); test(byId.get(`${bo.id}.N`), byId.get(pid), ' (אום מול חתך הפטה)'); }
    } else if (c.type === 'beam-splice') {
      // פלטות ההמשך יושבות בתפר של האלמנט (שאינו מפוצל במודל) — נבדקות מול שאר האלמנטים בלבד
      for (const part of c.parts.filter((x) => byId.get(x)?.kind === 'plate')) for (const o of byId.values()) if (['purlin', 'cleat', 'brace', 'plate'].includes(o.kind) && !c.parts.includes(o.id) && aabbOverlap(aabb(byId.get(part)!), aabb(o))) test(byId.get(part), o, ' (חיבור המשך)');
    } else {
      // לשונית (".T") בחריץ ה-RHS של האלמנט המחובר — מותר; מול המארח — נבדקת
      for (const part of c.parts.filter((x) => ['plate', 'beam'].includes(byId.get(x)?.kind ?? ''))) for (const mid of c.members) {
        const m = byId.get(mid);
        if (/\.T$/.test(part) && m && (m.kind === 'brace' || m.kind === 'beam') && m.profile.startsWith('RHS')) continue;
        test(byId.get(part), m);
      }
    }
  }
  // קושרות ושורות קשירה מול עמודים, קורות, פטות, תומכים וקושרות אחרות (סינון לפי תיבה חוסמת)
  // חלקי פרט מותאם נבדקים בבניית הפרט עצמו
  const others = [...byId.values()].filter((m) => ['column', 'rafter', 'purlin', 'cleat', 'plate', 'brace'].includes(m.kind) && !m.connId?.startsWith('C.CD.'));
  const boxes = new Map(others.map((m) => [m.id, aabb(m)]));
  for (const c of conns.filter((x) => x.type === 'brace' || x.type === 'knee')) {
    for (const pid of c.parts) {
      const a = byId.get(pid);
      if (!a) continue;
      const ba = boxes.get(pid) ?? aabb(a);
      for (const o of others) {
        if (o.id === pid || (o.kind === 'brace' && c.parts.includes(o.id))) continue;
        // לשונית בחריץ ה-RHS של אותו חיבור — מותר (החריץ חותך את דפנות הפרופיל)
        const own = (id: string) => c.parts.includes(id) || c.members.includes(id);
        const isTongue = (id: string) => /\.T$/.test(id) && c.parts.includes(id);
        if ((isTongue(pid) && o.kind === 'brace' && own(o.id)) || (isTongue(o.id) && a.kind === 'brace' && own(pid))) continue;
        if (aabbOverlap(ba, boxes.get(o.id)!)) test(a, o, ' (קושרת)');
      }
    }
  }
  // סבכה אופקית (RHS): מוטות, אלכסונים, לשוניות ופחים מול כל השאר. לשונית בתוך ה-RHS שלה — מותר (חריץ)
  for (const c of conns.filter((x) => x.id.startsWith('C.HB.'))) {
    const own = new Set([...c.parts, ...c.members]);
    for (const pid of [...c.parts, ...c.members.filter((m) => byId.get(m)?.kind === 'brace')]) {
      const a = byId.get(pid);
      if (!a || a.kind === 'bolt') continue;
      const ba = boxes.get(pid) ?? aabb(a);
      for (const o of others) {
        if (o.id === pid) continue;
        const ownPair = own.has(o.id) && (a.kind === 'plate' || o.kind === 'plate');
        const tongueOfOther = (a.kind === 'brace' && o.id.startsWith(`${a.id}.T`)) || (o.kind === 'brace' && pid.startsWith(`${o.id}.T`));
        if (ownPair || tongueOfOther || c.members[0] === o.id && a.kind === 'plate' && pid.endsWith('.PL')) continue;
        if (aabbOverlap(ba, boxes.get(o.id)!)) test(a, o, ' (סבכה אופקית)');
      }
    }
  }
  // אזור הרכס: פטות ותומכים של שני הצדדים
  const ridgeP = [...byId.values()].filter((m) => m.purlin?.index === 1 && m.purlin.side !== 'M');
  const all = [...ridgeP, ...ridgeGroup];
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const a = all[i], b = all[j];
    if (Math.abs((a.start.y + a.end.y) / 2 - (b.start.y + b.end.y) / 2) > 2000 && a.kind === 'cleat' && b.kind === 'cleat') continue;
    if (a.kind === 'cleat' && b.kind === 'cleat' && a.connId === b.connId) continue;
    test(a, b, ' (אזור הרכס)');
  }
  return out;
}

/**
 * חיזוק רכס בפרופיל אופקי: קורה אופקית בין שתי קורות הגג מתחת לרכס (פני עליון tieGap מתחת לתחתית הקורות ברכס).
 * בכל קצה פח אנכי מרותך לתחתית הקורה (מסגריה); ווב הפרופיל מוברג לפח (שטח, 2×2 ברגים). גיאומטריה בלבד.
 */
function buildRidgeTie(res: ConnResult, project: Project, fid: string, fi: number, xr: number, ztos: number, rl: Member, rr: Member, underRidge: number, mat: string) {
  const r = project.building.ridgeReinf!;
  const tp = tryProfile(r.tieProfile);
  if (!tp) { res.issues.push({ code: 'PROFILE', severity: 'error', message: `חיזוק רכס: חתך לא מוכר ${r.tieProfile}` }); return; }
  const id = `C.RT.${fid}`;
  const Y = v3(0, 1, 0), X = v3(1, 0, 0);
  const h = tp.props.h, tw = tp.dims.tw ?? tp.dims.t ?? 6;
  const zTop = underRidge - r.tieGap, zc = zTop - h / 2;
  const sides = [[rl, -1], [rr, 1]] as const;
  const ends: { x: number; r: Member; s: -1 | 1; nUp: Vec3; slope: number }[] = [];
  for (const [m, s] of sides) {
    const slope = (m.end.z - m.start.z) / (m.end.x - m.start.x);
    const hv = getProfile(m.profile).props.h * Math.sqrt(1 + slope * slope);
    const under = (x: number) => ztos + slope * (x - xr) - hv;
    // קצה הפרופיל: היכן שתחתית הקורה גבוהה מפני הפרופיל ב-20 מ"מ
    const ds = Math.abs(slope);
    if (ds < 1e-3) { res.issues.push({ code: 'RIDGE_TIE', severity: 'error', message: `חיזוק רכס מסגרת ${fi}: קורה שטוחה — אין מפגש לפרופיל אופקי` }); return; }
    const dx = (r.tieGap - 20) / ds;
    void under;
    const exr = norm(v3(1, 0, slope));
    let nUp = norm(sub(v3(0, 0, 1), scale(exr, exr.z))); if (nUp.z < 0) nUp = scale(nUp, -1);
    // לפחות מקום לשתי עמודות ברגים בין הקצה לרכס
    ends.push({ x: xr + s * Math.max(dx, 2 * r.edge + r.pitch + 60), r: m, s, nUp, slope });
  }
  // קצה הפרופיל במקום שבו תחתית הקורה 20 מ"מ מעל פני הפרופיל; הברגים פנימה (לכיוון הרכס)
  const xL = ends[0].x, xR = ends[1].x;
  const tid = `RT.${fid}`;
  res.members.push({ id: tid, kind: 'beam', label: `חיזוק רכס אופקי מסגרת ${fi}`, start: v3(xL, 0, zc), end: v3(xR, 0, zc), profile: r.tieProfile, material: mat, rollDeg: 0, mirror: false, anchor: 'center', refUp: v3(0, 0, 1), source: 'generated', manualPlacement: false, connId: id, partDesc: `חיזוק רכס ${r.tieProfile}` });
  // y של המסגרת: מהקורות
  const fy = rl.start.y;
  const tm = res.members[res.members.length - 1];
  tm.start = { ...tm.start, y: fy }; tm.end = { ...tm.end, y: fy };
  const bolts: BoltInfo[] = [], welds: WeldInfo[] = [], parts: string[] = [tid];
  for (const e of ends) {
    const gid = `${id}.${e.s < 0 ? 'L' : 'R'}`;
    // עמודות ברגים: מקצה הפרופיל פנימה
    const xEnd = e.s < 0 ? xL : xR;
    const bx = [xEnd - e.s * r.edge, xEnd - e.s * (r.edge + r.pitch)];
    const zb = [zc - r.gauge / 2, zc + r.gauge / 2];
    const gx0 = Math.min(...bx) - r.edge, gx1 = Math.max(...bx) + r.edge;
    const zBot = zb[0] - r.edge;
    const yg = fy + tw / 2 + r.gussetT / 2;
    const xc = (gx0 + gx1) / 2;
    const zTopG = ztos + e.slope * (xc - xr) + Math.abs(e.slope) * (gx1 - gx0); // מעל תחתית הקורה — נחתך במישור התחתון
    const hvR = getProfile(e.r.profile).props.h * Math.sqrt(1 + e.slope * e.slope);
    const underPl = { point: v3(xr, fy, ztos - hvR), normal: e.nUp };
    res.members.push({ id: gid, kind: 'plate', label: `פח חיזוק רכס PL${r.gussetT}`, start: v3(xc, yg, zBot), end: v3(xc, yg, zTopG), profile: `PL${Math.ceil(gx1 - gx0)}x${r.gussetT}`, material: mat, rollDeg: 0, mirror: false, anchor: 'center', refUp: Y, source: 'generated', manualPlacement: false, connId: id, endCut: underPl, partDesc: `פח חיזוק רכס PL${r.gussetT}×${Math.ceil(gx1 - gx0)}` });
    parts.push(gid);
    welds.push({ id: `${gid}.W`, connId: id, type: 'fillet', a: r.weldSize, length: 2 * (gx1 - gx0), location: 'shop', between: [e.r.id, gid], from: v3(gx0, fy, zTopG), to: v3(gx1, fy, zTopG) });
    bx.forEach((xx, ci) => zb.forEach((zz, ri) => {
      const head = v3(xx, fy + tw / 2 + r.gussetT, zz);
      bolts.push(makeBolt(`${gid}.B${ci + 1}${ri + 1}`, id, head, scale(Y, -1), r.bolt, tw + r.gussetT, 'site', [gid, tid], X, res.members));
    }));
    if (zTopG - zBot < 60) res.issues.push({ code: 'RIDGE_TIE', severity: 'warning', elementId: id, message: `חיזוק רכס מסגרת ${fi}: פח קצר מדי` });
  }
  const inner = h - 2 * (tp.dims.tf ?? 8);
  if (r.gauge + (r.bolt.d + r.bolt.clearance) + 2 * hw(r.bolt.d).s / Math.sqrt(3) > inner + 10) res.issues.push({ code: 'BOLT_ACCESS', severity: 'warning', elementId: id, message: `חיזוק רכס מסגרת ${fi}: הברגים קרובים לאגפי ${r.tieProfile} — הקטן מרווח או הגדל חתך` });
  parts.push(...bolts.map((b) => b.id));
  res.connections.push({ id, type: 'ridge-tie', label: `חיזוק רכס אופקי מסגרת ${fi}`, members: [rl.id, rr.id], parts, bolts, welds, status: 'not-verified', fixity: 'pinned', overridden: false });
}
