import { add, cross, dot, linePlaneT, norm, scale, sub, v3, type Vec3 } from '../core/vec';
import { getProfile, tryProfile } from '../profiles/library';
import type {
  ApprovalStatus, BoltInfo, BoltSpec, CleatParams, Connection, Member, PlateConnParams, Project,
  SupportPoint, ValidationIssue, WeldInfo,
} from '../model/types';
import { localFrame } from './frame';
import { clash } from './clash';

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

function effPlate(p: Project, type: 'eave' | 'ridge' | 'base', id: string): PlateConnParams {
  const o = p.connectionOverrides[id] ?? {};
  const base = p.connectionDefaults[type];
  const { status: _s, fixity: _f, ...rest } = o;
  void _s; void _f;
  return { ...base, ...rest, bolt: { ...base.bolt, ...(rest.bolt ?? {}) } };
}
export function effCleat(p: Project, side: 'left' | 'right', cleatId: string): CleatParams {
  const base = p.building.purlins[side].cleat;
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
function makeBolt(id: string, connId: string, head: Vec3, axis: Vec3, spec: BoltSpec, grip: number, location: 'site' | 'shop', holesIn: string[], refUp: Vec3, members: Member[], anchorLen?: number): BoltInfo {
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
export function buildConnections(project: Project, members: Member[], byId: Map<string, Member>, supports: SupportPoint[]): ConnResult {
  const res: ConnResult = { members: [], connections: [], issues: [] };
  const b = project.building;
  const mat = b.material;
  const issue = (i: ValidationIssue) => res.issues.push(i);
  const isGen = (m?: Member) => !!m && m.source === 'generated' && !m.manualPlacement;

  for (const f of b.frames) {
    const fi = b.frames.indexOf(f) + 1;
    // ---- ראש עמוד: פלטת כיפה מרותכת לעמוד (מסגריה), ברגים דרך האגף התחתון של הקורה (שטח)
    for (const side of ['L', 'R'] as const) {
      const id = `C.EAVE.${f.id}.${side}`;
      const col = byId.get(`${f.id}.COL.${side}`);
      const raf = byId.get(b.roofType === 'gable' ? `${f.id}.RAF.${side}` : `${f.id}.RAF`);
      const prm = effPlate(project, 'eave', id);
      if (!prm.enabled || !isGen(col) || !isGen(raf) || !col!.endCut) continue;
      const U = col!.endCut!;
      const n = U.normal;
      const exr = norm(sub(raf!.end, raf!.start));
      const tAx = linePlaneT(col!.end, Z, U) ?? 0;
      const P0 = add(col!.end, scale(Z, tAx)); // מרכז פני עליון של הפלטה (במישור תחתון הקורה)
      col!.endCut = { point: sub(U.point, scale(n, prm.t)), normal: n };
      const pid = `${id}.PL`;
      const plate = partMember(pid, 'plate', `PL${prm.w}x${prm.t}`, sub(P0, scale(exr, prm.l / 2)), add(P0, scale(exr, prm.l / 2)), n, 'top', id, `פלטת כיפה PL${prm.t}×${prm.w}×${prm.l}`, mat);
      res.members.push(plate);
      const rp = getProfile(raf!.profile), cp = getProfile(col!.profile);
      const tf = rp.dims.tf ?? rp.dims.t ?? 10;
      const yDir = norm(cross(n, exr));
      const bolts: BoltInfo[] = [];
      grid(prm.cols, prm.gauge).forEach((gy, ci) => grid(prm.rows, prm.pitch).forEach((px, ri) => {
        const head = add(add(sub(P0, scale(n, prm.t)), scale(yDir, gy)), scale(exr, px));
        bolts.push(makeBolt(`${id}.B${ci + 1}${ri + 1}`, id, head, n, prm.bolt, prm.t + tf, 'site', [pid, raf!.id], exr, res.members));
      }));
      const d0 = prm.bolt.d + prm.bolt.clearance;
      const label = `חיבור ראש עמוד ${side === 'L' ? 'שמאל' : 'ימין'} מסגרת ${fi}`;
      // כל בורג חייב לעבור דרך אגף הקורה: מיקום לאורך הקורה בתוך התחום, עם מרחק קצה
      // קצה הקורה בגובה האגף התחתון: חיתוך קו תחתון הקורה עם מישור חיתוך הקצה
      const rStart = (raf!.startCut ? linePlaneT(P0, exr, raf!.startCut) : null) ?? dot(sub(raf!.start, P0), exr);
      for (const bo of bolts) {
        const tb = dot(sub(bo.p, P0), exr);
        if (tb - d0 / 2 < rStart + 1.2 * d0 - 0.01) issue({ code: 'BOLT_OUTSIDE', severity: 'error', elementId: id, message: `${label}: בורג ${bo.id} מחוץ לקורת הגג או קרוב מדי לקצה שלה — הגדל קונזולה או קצר את הפלטה` });
      }
      edgeChecks(label, id, d0, prm.l / 2 - ((prm.rows - 1) / 2) * prm.pitch, prm.w / 2 - ((prm.cols - 1) / 2) * prm.gauge,
        prm.rows > 1 ? prm.pitch : null, prm.cols > 1 ? prm.gauge : null, res.issues);
      const flangeEdge = rp.props.b / 2 - ((prm.cols - 1) / 2) * prm.gauge;
      if (flangeEdge < 1.2 * d0) issue({ code: 'BOLT_EDGE', severity: 'warning', elementId: id, message: `${label}: ברגים קרובים לשפת אגף הקורה (${flangeEdge.toFixed(1)} מ"מ)` });
      if (prm.w > rp.props.b + 0.5) issue({ code: 'PLATE_WIDE', severity: 'info', elementId: id, message: `${label}: הפלטה רחבה מאגף הקורה` });
      const colHalf = cp.props.h / 2 / Math.abs(dot(exr, v3(1, 0, 0)) || 1);
      if (prm.rows > 1 && (prm.pitch / 2 - (prm.bolt.d + 2 * hw(prm.bolt.d).s) / 2) < colHalf) {
        issue({ code: 'BOLT_ACCESS', severity: 'warning', elementId: id, message: `${label}: ברגים בתוך היטל העמוד — אין גישה לכלי עבודה מתחת לפלטה` });
      }
      const welds: WeldInfo[] = [{ id: `${id}.W1`, connId: id, type: 'fillet', a: prm.weldSize, length: outlinePerimeter(col!.profile), location: 'shop', between: [col!.id, pid], from: sub(P0, scale(n, prm.t)), to: sub(P0, scale(n, prm.t)) }];
      res.connections.push({ id, type: 'eave', label, members: [col!.id, raf!.id], parts: [pid, ...bolts.map((x) => x.id)], bolts, welds, status: statusOf(project, id), fixity: project.connectionOverrides[id]?.fixity ?? 'rigid', overridden: !!project.connectionOverrides[id] });
    }

    // ---- רכס: פלטות קצה מרותכות לקורות (מסגריה), מוברגות זו לזו (שטח)
    if (b.roofType === 'gable') {
      const id = `C.RIDGE.${f.id}`;
      const rl = byId.get(`${f.id}.RAF.L`), rr = byId.get(`${f.id}.RAF.R`);
      const prm = effPlate(project, 'ridge', id);
      if (prm.enabled && isGen(rl) && isGen(rr)) {
        const rp = getProfile(rl!.profile);
        const sl = Math.abs((rl!.end.z - rl!.start.z) / (rl!.end.x - rl!.start.x));
        const sr = Math.abs((rr!.end.z - rr!.start.z) / (rr!.end.x - rr!.start.x));
        const hv = Math.max(rp.props.h * Math.sqrt(1 + sl * sl), getProfile(rr!.profile).props.h * Math.sqrt(1 + sr * sr));
        const Hp = hv + prm.l;
        const top = rl!.end; // נקודת הרכס על קו TOS
        const X = v3(1, 0, 0);
        rl!.endCut = { point: sub(top, scale(X, prm.t)), normal: X };
        rr!.endCut = { point: add(top, scale(X, prm.t)), normal: X };
        const pl = `${id}.PL1`, pr = `${id}.PL2`;
        res.members.push(partMember(pl, 'plate', `PL${prm.w}x${Hp.toFixed(1)}`, sub(top, scale(X, prm.t)), top, Z, 'top', id, `פלטת קצה PL${prm.t}×${prm.w}×${Math.ceil(Hp)}`, mat));
        res.members.push(partMember(pr, 'plate', `PL${prm.w}x${Hp.toFixed(1)}`, top, add(top, scale(X, prm.t)), Z, 'top', id, `פלטת קצה PL${prm.t}×${prm.w}×${Math.ceil(Hp)}`, mat));
        const e = Math.max(40, 1.5 * (prm.bolt.d + prm.bolt.clearance));
        const zs = prm.rows <= 1 ? [Hp / 2] : Array.from({ length: prm.rows }, (_, i) => e + ((Hp - 2 * e) * i) / (prm.rows - 1));
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
          const toFlange = Math.min(zz - tf, Hp - prm.l - tf - zz);
          if (toFlange < hw(prm.bolt.d).s / 2 + 2) issue({ code: 'BOLT_ACCESS', severity: 'warning', elementId: id, message: `${label}: שורת ברגים קרובה לאגף הקורה (${toFlange.toFixed(1)} מ"מ) — מרווח אום/מפתח לבדיקה` });
        }
        const welds: WeldInfo[] = [rl!, rr!].map((r, k) => ({ id: `${id}.W${k + 1}`, connId: id, type: 'fillet' as const, a: prm.weldSize, length: outlinePerimeter(r.profile), location: 'shop' as const, between: [r.id, k ? pr : pl] as [string, string], from: top, to: top }));
        res.connections.push({ id, type: 'ridge', label, members: [rl!.id, rr!.id], parts: [pl, pr, ...bolts.map((x) => x.id)], bolts, welds, status: statusOf(project, id), fixity: project.connectionOverrides[id]?.fixity ?? 'rigid', overridden: !!project.connectionOverrides[id] });
      }
    }

    // ---- בסיס: פלטה מרותכת לעמוד (מסגריה), ברגי עיגון (שטח)
    for (const side of ['L', 'R'] as const) {
      const id = `C.BASE.${f.id}.${side}`;
      const col = byId.get(`${f.id}.COL.${side}`);
      const prm = effPlate(project, 'base', id);
      if (!prm.enabled || !isGen(col)) continue;
      const base = col!.start;
      const top = add(base, scale(Z, prm.t));
      col!.startCut = { point: top, normal: Z };
      const X = v3(1, 0, 0);
      const pid = `${id}.PL`;
      res.members.push(partMember(pid, 'plate', `PL${prm.w}x${prm.t}`, sub(top, scale(X, prm.l / 2)), add(top, scale(X, prm.l / 2)), Z, 'top', id, `פלטת בסיס PL${prm.t}×${prm.w}×${prm.l}`, mat));
      const bolts: BoltInfo[] = [];
      const h = hw(prm.bolt.d);
      const anchorLen = (prm.anchorLength ?? 500) + prm.t + h.w + h.m + 2 * h.P;
      grid(prm.cols, prm.gauge).forEach((gy, ci) => grid(prm.rows, prm.pitch).forEach((px, ri) => {
        // בורג עיגון: מבצבץ מעל הפלטה (אום + דיסקית), ממשיך מתחת לבסיס
        const headTop = add(top, v3(px, gy, h.w + h.m + 2 * h.P));
        const bi = makeBolt(`${id}.A${ci + 1}${ri + 1}`, id, headTop, v3(0, 0, -1), prm.bolt, prm.t, 'site', [pid], X, res.members, anchorLen);
        bolts.push(bi);
      }));
      const d0 = prm.bolt.d + prm.bolt.clearance;
      const label = `פלטת בסיס ${side === 'L' ? 'שמאל' : 'ימין'} מסגרת ${fi}`;
      edgeChecks(label, id, d0, prm.l / 2 - ((prm.rows - 1) / 2) * prm.pitch, prm.w / 2 - ((prm.cols - 1) / 2) * prm.gauge, prm.rows > 1 ? prm.pitch : null, prm.cols > 1 ? prm.gauge : null, res.issues);
      const cp = getProfile(col!.profile);
      if (prm.rows > 1 && prm.pitch / 2 - h.s / 2 < cp.props.h / 2 + 5) issue({ code: 'BOLT_ACCESS', severity: 'warning', elementId: id, message: `${label}: ברגי העיגון קרובים מדי לעמוד — אין מקום לאום/מפתח` });
      if (prm.l < cp.props.h || prm.w < cp.props.b) issue({ code: 'PLATE_SMALL', severity: 'warning', elementId: id, message: `${label}: הפלטה קטנה מחתך העמוד` });
      const welds: WeldInfo[] = [{ id: `${id}.W1`, connId: id, type: 'fillet', a: prm.weldSize, length: outlinePerimeter(col!.profile), location: 'shop', between: [col!.id, pid], from: top, to: top }];
      res.connections.push({ id, type: 'base', label, members: [col!.id], parts: [pid, ...bolts.map((x) => x.id)], bolts, welds, status: statusOf(project, id), fixity: project.connectionOverrides[id]?.fixity ?? 'pinned', overridden: !!project.connectionOverrides[id] });
    }
  }

  // ---- פטה-קורה: זוויתן L מרותך לקורה (מסגריה), מוברג לווב הפטה (שטח)
  for (const sp of supports) {
    const pur = byId.get(sp.purlinId), raf = byId.get(sp.rafterId);
    if (!pur || !raf || !pur.purlin) continue;
    const side = pur.purlin.side === 'R' ? 'right' : 'left';
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
    const H = prm.height ?? pp.props.h;
    if (prm.height !== null && Math.abs(prm.height - pp.props.h) > 0.5) {
      issue({ code: 'CLEAT_MANUAL', severity: 'warning', elementId: cid, message: `תומך ${cid}: גובה ${prm.height} מ"מ נקבע ידנית ושונה מגובה הפטה (${pp.props.h} מ"מ)` });
    }
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
        bolts.push(makeBolt(`${id}.B${r + 1}${ci + 1}`, id, head, backD, prm.bolt, prm.thickness + tw, 'site', [cid, pur.id], n, res.members));
      });
    }
    const d0 = prm.bolt.d + prm.bolt.clearance;
    const label = `תומך ${cid}`;
    const top = hh0 + (prm.rows - 1) * prm.rowPitch;
    edgeChecks(label, cid, d0, prm.width / 2 - ((prm.perRow - 1) / 2) * prm.pitch, H - top, prm.perRow > 1 ? prm.pitch : null, prm.rows > 1 ? prm.rowPitch : null, res.issues);
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
    if (w.location === 'site') issue({ code: 'SITE_WELD', severity: 'warning', elementId: c.id, message: `${c.label}: ריתוך בשטח — מנוגד לעיקרון (ריתוך במסגריה, גלוון, הרכבה בברגים)` });
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
    if (c.type === 'purlin-cleat') {
      const [pid, rid] = c.members;
      const cl = byId.get(c.parts[0]);
      test(cl, byId.get(pid)); test(cl, byId.get(rid)); test(byId.get(pid), byId.get(rid));
      const pur = byId.get(pid);
      if (pur?.purlin && pur.purlin.index === 1 && pur.purlin.side !== 'M' && cl) ridgeGroup.push(cl);
      // ראשי ברגים ואומים מול הקורה
      for (const bo of c.bolts) { test(byId.get(`${bo.id}.H`), byId.get(rid)); test(byId.get(`${bo.id}.N`), byId.get(rid)); test(byId.get(`${bo.id}.N`), byId.get(pid), ' (אום מול חתך הפטה)'); }
    } else {
      for (const part of c.parts.filter((x) => byId.get(x)?.kind === 'plate')) for (const mid of c.members) test(byId.get(part), byId.get(mid));
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
