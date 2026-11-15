import { cross, norm, sub, v3 } from '../core/vec';
import type { Connection, Member, PortalBraceParams, ValidationIssue } from '../model/types';
import { getProfile, tryProfile } from '../profiles/library';
import { stubJoint } from './stubJoint';

/** אגד B (ברירת מחדל): קורת RHS100/100/5 בין העמודים, שני אלכסוני RHS60/60/4 ב-45°, פלטות 12, M16 */
export function defaultPortal(): PortalBraceParams {
  return {
    beam: 'RHS100x100x5', brace: 'RHS60x60x4', gap: 150, drop: 600, angle: 45,
    plateT: 12, bolt: { d: 16, grade: '8.8', standard: 'ISO 4017', clearance: 2 }, pitch: 180, weldSize: 5,
    boltsPerEnd: 2, continuous: true,
  };
}

interface Out { members: Member[]; connections: Connection[]; issues: ValidationIssue[] }

export interface PortalLine {
  /** מזהה צד לשמות (מזהה ציר) ותווית */
  side: string; label: string; x: number;
  frames: { id: string; y: number }[];
  /** מפתחים עם אגד B (קורה + 2 אלכסונים) */
  portalBays: number[];
  colProfile: string; zBase: number;
  /** ראש קורת האגד המרבי (מתחת לקורה הראשית) */
  zTop: number;
  mat: string;
}

/**
 * אגד B לאורך ציר עמודים: במפתחים שנבחרו — קורה + שני אלכסונים קטנים מהעמודים לתחתית הקורה;
 * בשאר המפתחים (continuous) — קורה באותו חתך בלבד, להעברת הכוחות האופקיים לאגד.
 * כל החיבורים לפי פרט הלקוח: זיז מרותך למארח + שתי פלטות ניצבות לציר, ברגים בשטח מחוץ לפרופיל.
 * קורה-עמוד: זיז על ווב העמוד, 4 ברגים (2 מעל ו-2 מתחת לקורה). אלכסון: 2 (או 4) ברגים.
 * גיאומטריה בלבד — אין בדיקת חוזק.
 */
export function buildPortalLine(out: Out, pp: PortalBraceParams, L: PortalLine) {
  const bp = tryProfile(pp.beam), kp = tryProfile(pp.brace);
  if (!bp || !kp) { out.issues.push({ code: 'PROFILE', severity: 'error', message: `אגד B: חתך לא מוכר ${!bp ? pp.beam : pp.brace}` }); return; }
  if (!L.portalBays.length) return;
  const cp = getProfile(L.colProfile);
  const tw = cp.dims.tw ?? cp.dims.t ?? 8;
  const inner = cp.props.h - 2 * (cp.dims.tf ?? 10) - 2 * (cp.dims.r ?? 0);
  const X = v3(1, 0, 0), Z = v3(0, 0, 1);
  const hb = bp.props.h;
  const zc = L.zTop - pp.gap - hb / 2, zBot = zc - hb / 2;
  const x = L.x;
  const nb = L.frames.length - 1;
  const portal = new Set(L.portalBays);
  const bays = (pp.continuous ?? true) ? Array.from({ length: nb }, (_, i) => i) : [...portal];
  const tA = Math.tan((Math.max(20, Math.min(70, pp.angle)) * Math.PI) / 180);
  const reach = pp.drop / tA;
  const base = { plateT: pp.plateT, bolt: pp.bolt, weldSize: pp.weldSize, mat: L.mat };
  for (const bay of bays) {
    const f0 = L.frames[bay], f1 = L.frames[bay + 1];
    const key = `${bay + 1}.${L.side}`;
    const lab = portal.has(bay) ? `אגד B ציר ${L.label} מפתח ${bay + 1}` : `קורת אגד ציר ${L.label} מפתח ${bay + 1}`;
    const withDiag = portal.has(bay);
    if (withDiag && zBot - pp.drop < L.zBase + 500) { out.issues.push({ code: 'BRACE_SHORT', severity: 'warning', message: `${lab}: גובה לא מספיק לאגד B` }); continue; }
    const ya = Math.min(f0.y, f1.y) + tw / 2, yb = Math.max(f0.y, f1.y) - tw / 2; // פני הווב
    const c0 = `${f0.id}.COL.${L.side}`, c1 = `${f1.id}.COL.${L.side}`;
    const colA = f0.y < f1.y ? c0 : c1, colB = f0.y < f1.y ? c1 : c0;
    const bid = `BB.${key}`;
    // קורה-עמוד בשני הקצוות
    const ends = ([['E0', ya, 1, colA], ['E1', yb, -1, colB]] as const).map(([k, yF, sg, col]) => {
      const cid = `C.BB.${key}.${k}`;
      const j = stubJoint({ ...base, cid, desc: 'קורת אגד', hostId: col, memberId: bid, P: v3(x, yF, zc), n: v3(0, sg, 0), d: v3(0, sg, 0), u: Z, prof: bp, profile: pp.beam, refUp: Z, bolts: 4 });
      if (j.plateW > inner + 0.5) out.issues.push({ code: 'PLATE_WIDE', severity: 'warning', elementId: cid, message: `${lab}: פלטת הזיז (${j.plateW}) רחבה מהמרווח בין אגפי העמוד (${Math.round(inner)})` });
      return { cid, col, j, label: `${lab} — קורה לעמוד` };
    });
    out.members.push({ id: bid, kind: 'beam', label: lab, start: ends[0].j.start, end: ends[1].j.start, profile: pp.beam, material: L.mat, rollDeg: 0, mirror: false, anchor: 'center', refUp: Z, source: 'generated', manualPlacement: false, partDesc: `קורת אגד ${pp.beam}` });
    for (const e of ends) {
      out.members.push(...e.j.members); out.issues.push(...e.j.issues);
      out.connections.push({ id: e.cid, type: 'knee', label: e.label, members: [e.col, bid], parts: e.j.parts, bolts: e.j.bolts, welds: e.j.welds, status: 'not-verified', fixity: 'pinned', overridden: false });
    }
    if (!withDiag) continue;
    // שני אלכסונים: מווב העמוד בגובה zBot−drop אל תחתית הקורה, בזווית מהאופק
    for (const [k, yF, sg, col] of [['1', ya, 1, colA], ['2', yb, -1, colB]] as const) {
      const kid = `${bid}.K${k}`;
      const C0 = v3(x, yF, zBot - pp.drop), R0 = v3(x, yF + sg * reach, zBot);
      const dir = norm(sub(R0, C0));
      const u = norm(cross(X, dir));
      const common = { ...base, desc: 'אלכסון אגד', memberId: kid, prof: kp, profile: pp.brace, refUp: X, bolts: (pp.boltsPerEnd ?? 2) as 2 | 4, u };
      const cidC = `C.BB.${key}.K${k}C`, cidB = `C.BB.${key}.K${k}B`;
      const jc = stubJoint({ ...common, cid: cidC, hostId: col, P: C0, n: v3(0, sg, 0), d: dir });
      const jb = stubJoint({ ...common, cid: cidB, hostId: bid, P: R0, n: v3(0, 0, -1), d: v3(-dir.x, -dir.y, -dir.z) });
      out.members.push({ id: kid, kind: 'brace', label: `${lab} — אלכסון`, start: jc.start, end: jb.start, profile: pp.brace, material: L.mat, rollDeg: 0, mirror: false, anchor: 'center', refUp: X, source: 'generated', manualPlacement: false, partDesc: `אלכסון אגד B ${pp.brace}` });
      for (const [cid, j, hostId, t] of [[cidC, jc, col, 'אלכסון לעמוד'], [cidB, jb, bid, 'אלכסון לקורה']] as const) {
        out.members.push(...j.members); out.issues.push(...j.issues);
        out.connections.push({ id: cid, type: 'knee', label: `${lab} — ${t}`, members: [hostId, kid], parts: j.parts, bolts: j.bolts, welds: j.welds, status: 'not-verified', fixity: 'pinned', overridden: false });
      }
    }
  }
}
