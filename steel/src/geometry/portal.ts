import { add, scale, sub, v3, norm, type Vec3 } from '../core/vec';
import type { BoltInfo, Connection, Member, PortalBraceParams, ValidationIssue, WeldInfo } from '../model/types';
import { getProfile, tryProfile } from '../profiles/library';
import { hw, makeBolt } from './connections';

/** אגד B (ברירת מחדל): קורת RHS100/100/5 בין העמודים, שני אלכסוני RHS60/60/4 ב-45°, פלטות 10, M16 */
export function defaultPortal(): PortalBraceParams {
  return {
    beam: 'RHS100x100x5', brace: 'RHS60x60x4', gap: 150, drop: 600, angle: 45,
    plateT: 10, bolt: { d: 16, grade: '8.8', standard: 'ISO 4017', clearance: 2 }, pitch: 180, weldSize: 5,
  };
}

interface Out { members: Member[]; connections: Connection[]; issues: ValidationIssue[] }

/**
 * אגד B — קשיחות לאורך במפתח: קורה אופקית בין שני עמודים סמוכים בציר, ושני אלכסונים קטנים מהעמודים
 * לתחתית הקורה (דומים לאלכסון עמוד-קורה). במישור הקיר x = ציר העמודים.
 * חיבורים (ריתוך במסגריה, ברגים בשטח):
 *  · קורה-עמוד: פלטת קצה על הקורה, 4 ברגים לווב העמוד, ברגים מעל ומתחת לקורה (האום בצד השני של הווב)
 *  · אלכסון-עמוד: פלטת קצה על האלכסון, 4 ברגים לווב העמוד, מעל ומתחת להיטל האלכסון
 *  · אלכסון-קורה: פח רפידה מרותך מתחת לקורה, פלטת קצה על האלכסון, 4 ברגים מחוץ לרוחב ה-RHS
 * גיאומטריה בלבד — אין בדיקת חוזק.
 */
export function buildPortal(out: Out, pp: PortalBraceParams, key: string, label: string, x: number, yF0: number, yF1: number,
  colIds: [string, string], colProfile: string, zBase: number, zTop: number, mat: string) {
  const col0 = { id: colIds[0] }, col1 = { id: colIds[1] };
  const bp = tryProfile(pp.beam), kp = tryProfile(pp.brace);
  if (!bp || !kp) { out.issues.push({ code: 'PROFILE', severity: 'error', message: `אגד B: חתך לא מוכר ${!bp ? pp.beam : pp.brace}` }); return; }
  const cp = getProfile(colProfile);
  const tw = cp.dims.tw ?? cp.dims.t ?? 8;
  const inner = cp.props.h - 2 * (cp.dims.tf ?? 10) - 2 * (cp.dims.r ?? 0);
  const X = v3(1, 0, 0), Y = v3(0, 1, 0), Z = v3(0, 0, 1);
  const t = pp.plateT;
  const nutR = hw(pp.bolt.d).s / Math.sqrt(3) + 2;
  const d0 = pp.bolt.d + pp.bolt.clearance;
  const e = Math.max(30, Math.ceil(1.5 * d0 / 5) * 5);
  const ya = Math.min(yF0, yF1) + tw / 2, yb = Math.max(yF0, yF1) - tw / 2; // פני הווב הפנימיים
  const hb = bp.props.h, bb = bp.props.b;
  const zc = zTop - pp.gap - hb / 2, zBot = zc - hb / 2;
  if (zBot - pp.drop < zBase + 500) { out.issues.push({ code: 'BRACE_SHORT', severity: 'warning', message: `${label}: גובה לא מספיק לאגד B` }); return; }
  const plate = (id: string, desc: string, c: Vec3, lDir: Vec3, L: number, refUp: Vec3, W: number, cid: string): Member => ({
    id, kind: 'plate', label: `${desc} PL${t}×${W}×${L}`, start: sub(c, scale(lDir, L / 2)), end: add(c, scale(lDir, L / 2)), profile: `PL${W}x${t}`, material: mat,
    rollDeg: 0, mirror: false, anchor: 'center', refUp, source: 'generated', manualPlacement: false, connId: cid, partDesc: `${desc} PL${t}×${W}×${L}`,
  });
  const bid = `BB.${key}`;
  out.members.push({ id: bid, kind: 'beam', label: `${label} — קורה`, start: v3(x, ya + t, zc), end: v3(x, yb - t, zc), profile: pp.beam, material: mat, rollDeg: 0, mirror: false, anchor: 'center', refUp: Z, source: 'generated', manualPlacement: false, partDesc: `אגד B ${pp.beam}` });
  // קורה-עמוד: פלטת קצה (רוחב לאורך X בתוך העמוד, גובה לאורך Z), ברגים מעל ומתחת לקורה
  const plW = Math.min(Math.floor(inner / 5) * 5, Math.max(bb, 120));
  const gz = hb + 2 * nutR + 4, gx = Math.min(plW - 2 * e, 80);
  const plH = Math.ceil((gz + 2 * e) / 5) * 5;
  if (plW < gx + 2 * e - 0.5 || plW < bb) out.issues.push({ code: 'PLATE_WIDE', severity: 'warning', message: `${label}: פלטת הקצה אינה נכנסת בין אגפי העמוד (${Math.round(inner)} מ"מ)` });
  for (const [k, yFace, sg, col] of [['0', ya, 1, col0], ['1', yb, -1, col1]] as const) {
    const cid = `C.BB.${key}.E${k}`, pid = `${cid}.PL`;
    out.members.push(plate(pid, 'פלטת קצה אגד', v3(x, yFace + sg * t / 2, zc), Z, plH, Y, plW, cid));
    const bolts: BoltInfo[] = [];
    for (const dz of [-gz / 2, gz / 2]) for (const dx of [-gx / 2, gx / 2]) {
      const head = v3(x + dx, yFace + sg * t, zc + dz);
      bolts.push(makeBolt(`${cid}.B${bolts.length + 1}`, cid, head, scale(Y, -sg), pp.bolt, t + tw, 'site', [pid, col.id], Z, out.members));
    }
    const welds: WeldInfo[] = [{ id: `${cid}.W`, connId: cid, type: 'fillet', a: pp.weldSize, length: 4 * bb, location: 'shop', between: [bid, pid], from: v3(x, yFace, zc), to: v3(x, yFace, zc) }];
    out.connections.push({ id: cid, type: 'knee', label: `${label} — קורה לעמוד`, members: [col.id, bid], parts: [pid, ...bolts.map((b) => b.id)], bolts, welds, status: 'not-verified', fixity: 'pinned', overridden: false });
  }
  // אלכסונים: מהווב בגובה zBot−drop אל תחתית הקורה בזווית
  const tA = Math.tan((Math.max(20, Math.min(70, pp.angle)) * Math.PI) / 180);
  const reach = pp.drop / tA;
  const padW = Math.ceil((bb + 2 * nutR + 2 * e + 10) / 5) * 5; // פח רפידה רחב מה-RHS: הברגים מחוץ לו
  const gB = padW - 2 * e;
  for (const [k, yFace, sg, col] of [['1', ya, 1, col0], ['2', yb, -1, col1]] as const) {
    const kid = `${bid}.K${k}`;
    const zC = zBot - pp.drop;
    // הקצה בעמוד: פני פלטת הקצה (yFace + sg·t); הקצה בקורה: פני פלטת הקצה מתחת לפח הרפידה (zBot − 2t)
    const C0 = v3(x, yFace + sg * t, zC), R0 = v3(x, yFace + sg * reach, zBot - 2 * t);
    const dir = norm(sub(R0, C0));
    out.members.push({ id: kid, kind: 'brace', label: `${label} — אלכסון`, start: C0, end: R0, profile: pp.brace, material: mat, rollDeg: 0, mirror: false, anchor: 'center', refUp: X, source: 'generated', manualPlacement: false, partDesc: `אלכסון אגד B ${pp.brace}`, startCut: { point: C0, normal: scale(Y, -sg) }, endCut: { point: R0, normal: Z } });
    const sinC = Math.abs(dir.y) || 1, sinB = Math.abs(dir.z) || 1;
    // אלכסון-עמוד
    {
      const cid = `C.BB.${key}.K${k}C`, pid = `${cid}.PL`;
      const footL = kp.props.h / sinC / 2 + nutR;
      const pit = Math.max(pp.pitch, Math.ceil((2 * footL) / 5) * 5);
      const L = pit + 2 * e, W = Math.min(plW, Math.max(kp.props.b + 20, 2 * e + 40));
      const c = v3(x, yFace + sg * t / 2, zC + 0);
      out.members.push(plate(pid, 'פלטת קצה לאלכסון', c, Z, L, Y, W, cid));
      const bolts: BoltInfo[] = [];
      for (const dz of [-pit / 2, pit / 2]) for (const dx of [-(W - 2 * e) / 2, (W - 2 * e) / 2]) {
        bolts.push(makeBolt(`${cid}.B${bolts.length + 1}`, cid, v3(x + dx, yFace + sg * t, zC + dz), scale(Y, -sg), pp.bolt, t + tw, 'site', [pid, col.id], Z, out.members));
      }
      out.connections.push({ id: cid, type: 'knee', label: `${label} — אלכסון לעמוד`, members: [col.id, kid], parts: [pid, ...bolts.map((b) => b.id)], bolts, welds: [{ id: `${cid}.W`, connId: cid, type: 'fillet', a: pp.weldSize, length: 4 * kp.props.b, location: 'shop', between: [kid, pid], from: c, to: c }], status: 'not-verified', fixity: 'pinned', overridden: false });
    }
    // אלכסון-קורה: פח רפידה מרותך לקורה + פלטת קצה על האלכסון
    {
      const cid = `C.BB.${key}.K${k}B`, pad = `${cid}.P1`, endp = `${cid}.P2`;
      const footL = kp.props.h / sinB / 2 + 5;
      const L = Math.ceil((2 * footL + 2 * e) / 5) * 5 + 20;
      const yc = yFace + sg * reach;
      out.members.push(plate(pad, 'פח רפידה לאגד', v3(x, yc, zBot - t / 2), Y, L, Z, padW, cid));
      out.members.push(plate(endp, 'פלטת קצה לאלכסון', v3(x, yc, zBot - 1.5 * t), Y, L, Z, padW, cid));
      const bolts: BoltInfo[] = [];
      for (const dy of [-(L - 2 * e) / 2, (L - 2 * e) / 2]) for (const dx of [-gB / 2, gB / 2]) {
        bolts.push(makeBolt(`${cid}.B${bolts.length + 1}`, cid, v3(x + dx, yc + dy, zBot - 2 * t), Z, pp.bolt, 2 * t, 'site', [endp, pad], Y, out.members));
      }
      if (gB / 2 - nutR < bb / 2) out.issues.push({ code: 'BOLT_ACCESS', severity: 'warning', message: `${label}: אום מתחת לקורה קרוב ל-RHS` });
      out.connections.push({ id: cid, type: 'knee', label: `${label} — אלכסון לקורה`, members: [bid, kid], parts: [pad, endp, ...bolts.map((b) => b.id)], bolts, welds: [
        { id: `${cid}.W1`, connId: cid, type: 'fillet', a: pp.weldSize, length: 2 * L, location: 'shop', between: [bid, pad], from: v3(x, yc, zBot), to: v3(x, yc, zBot) },
        { id: `${cid}.W2`, connId: cid, type: 'fillet', a: pp.weldSize, length: 4 * kp.props.b, location: 'shop', between: [kid, endp], from: R0, to: R0 },
      ], status: 'not-verified', fixity: 'pinned', overridden: false });
    }
  }
}
