import { dot, norm, scale, sub, v3, type Vec3 } from '../core/vec';
import type { Connection, Member, PortalBraceParams, ValidationIssue } from '../model/types';
import { getProfile, tryProfile } from '../profiles/library';
import { finJoint } from './finJoint';
import { KNEE_FIN_BBDIAG_RECIPE_ID, KNEE_FIN_BEAM_RECIPE_ID } from './convRecipes';

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
 * כל החיבורים לפי פרט הלקוח: פח מרותך למארח (מסגריה), לשונית בחריץ ה-RHS מרותכת לפרופיל (מסגריה),
 * מוברגים בחפיפה בשטח (2 ברגים). קורת האגד מוסטת מציר העמודים בעובי פח; האלכסונים על ציר העמודים.
 * גיאומטריה בלבד — אין בדיקת חוזק.
 */
export function buildPortalLine(out: Out, pp: PortalBraceParams, L: PortalLine) {
  const bp = tryProfile(pp.beam), kp = tryProfile(pp.brace);
  if (!bp || !kp) { out.issues.push({ code: 'PROFILE', severity: 'error', message: `אגד B: חתך לא מוכר ${!bp ? pp.beam : pp.brace}` }); return; }
  if (!L.portalBays.length) return;
  const cp = getProfile(L.colProfile);
  // עמוד I: הפח על הווב, בין האגפים. עמוד חלול (RHS/SHS/CHS): הפח על הדופן החיצונית (פני העמוד ב-±b/2)
  const hollow = ['RHS', 'SHS', 'CHS'].includes(cp.family);
  const tw = hollow ? cp.props.b : cp.dims.tw ?? cp.dims.t ?? 8;
  const inner = hollow ? cp.props.h : cp.props.h - 2 * (cp.dims.tf ?? 10) - 2 * (cp.dims.r ?? 0);
  const X = v3(1, 0, 0), Z = v3(0, 0, 1);
  void Z;
  const hb = bp.props.h;
  // הפוך (בקשת משתמש 18.11.2026): האלכסונים עולים מראש קורת האגד אל העמוד — הקורה יורדת ב-drop; gap = מתחת לקורה הראשית עד ראש האלכסון בעמוד
  const inv = !!pp.invert;
  const zc = L.zTop - pp.gap - (inv ? pp.drop : 0) - hb / 2, zBot = zc - hb / 2, zTopB = zc + hb / 2;
  const x = L.x;
  const nb = L.frames.length - 1;
  const portal = new Set(L.portalBays);
  const bays = (pp.continuous ?? true) ? Array.from({ length: nb }, (_, i) => i) : [...portal];
  const tA = Math.tan((Math.max(20, Math.min(70, pp.angle)) * Math.PI) / 180);
  const reach = pp.drop / tA;
  const base = { finT: pp.plateT, tongueT: pp.plateT, bolt: pp.bolt, weldSize: pp.weldSize, mat: L.mat };
  const T = pp.plateT; // הסטת ציר ה-RHS מהפח: (פח + לשונית) / 2
  // חיבור קורת האגד: פח ולשונית שוכבים (ברירת מחדל) — הקורה על ציר העמודים; אחרת במישור הקיר והקורה מוסטת ב-T
  const horiz = (pp.finOrient ?? 'horizontal') === 'horizontal';
  // מתכון מובנה (שלב D): חתכי RHS/SHS, בורג 8.8 ISO 4017 עם חור d+2; קורת האגד — רק בפח ולשונית שוכבים
  const HOLLOW = ['RHS', 'SHS'];
  // עמוד I: `th` — הפרט נבנה על פני הווב האמיתיים (פגיעה במתאר החתך) ולא על תיבת החתך (קצה האגף)
  const colI = ['IPE', 'HEA', 'HEB', 'HEM', 'INP', 'UPN', 'UPE', 'C'].includes(cp.family);
  const colOk = ['RHS', 'SHS'].includes(cp.family) || colI;
  const specOk = pp.engine === 'recipe' && colOk && pp.bolt.grade === '8.8' && pp.bolt.standard === 'ISO 4017' && pp.bolt.clearance === 2;
  // הקוד הישן ממקם את קצה האלמנט לפי ציר העמוד ± tw/2 — נכון ל-I בלבד; בעמוד U/C הווב בקצה החתך (התנגשות עם האגף)
  if (!specOk && ['UPN', 'UPE', 'C'].includes(cp.family)) out.issues.push({ code: 'COL_U_LEGACY', severity: 'warning', message: `אגד B ציר ${L.label}: עמוד ${L.colProfile} (U/C) בקוד הישן — הקצה ממוקם לפי ציר העמוד ויתנגש באגף. הפעל "בנה ממתכון" (בורג 8.8 ISO 4017, פער 2)` });
  // קורת האגד (פח ולשונית שוכבים): במצב מתכון הציר נשמר ללא ההסטה (על קו הפח) והמתכון מחיל אותה — אחרת היא מוחלת פעמיים.
  // אלכסונים: הציר כבר על מישור הלשונית וממורכז על המארח (`findSite` ממרכז היסט < 25 מ"מ) — `bs: 0`, הפח מוזז מהציר ב-T
  const unshift = (start: Vec3, pnV: Vec3, dV: Vec3, sd: 1 | -1) => { const dn = norm(dV); return sub(start, scale(norm(sub(pnV, scale(dn, dot(pnV, dn)))), sd * T)); };
  const rcp = (ok: boolean, rid: string, member: string, end: 'start' | 'end', nb: number, sd: 1 | -1, bs = 1) => (specOk && ok ? { recipe: { id: rid, params: { d: pp.bolt.d, nb, ft: T, tt: T, sd, bs, wa: pp.weldSize, ...(colI ? { th: 1 } : {}) }, sites: [`${member}|${end}`] } } : {});
  for (const bay of bays) {
    const f0 = L.frames[bay], f1 = L.frames[bay + 1];
    const key = `${bay + 1}.${L.side}`;
    const lab = portal.has(bay) ? `אגד B ציר ${L.label} מפתח ${bay + 1}` : `קורת אגד ציר ${L.label} מפתח ${bay + 1}`;
    const withDiag = portal.has(bay);
    if (withDiag && (inv ? zBot : zBot - pp.drop) < L.zBase + 500) { out.issues.push({ code: 'BRACE_SHORT', severity: 'warning', message: `${lab}: גובה לא מספיק לאגד B` }); continue; }
    const ya = Math.min(f0.y, f1.y) + tw / 2, yb = Math.max(f0.y, f1.y) - tw / 2; // פני הווב
    const c0 = `${f0.id}.COL.${L.side}`, c1 = `${f1.id}.COL.${L.side}`;
    const colA = f0.y < f1.y ? c0 : c1, colB = f0.y < f1.y ? c1 : c0;
    const bid = `BB.${key}`;
    // קורה-עמוד בשני הקצוות
    const ends = ([['E0', ya, 1, colA], ['E1', yb, -1, colB]] as const).map(([k, yF, sg, col]) => {
      const cid = `C.BB.${key}.${k}`;
      const j = finJoint({ ...base, cid, desc: 'קורת אגד', hostId: col, memberId: bid, P: horiz ? v3(x, yF, zc - T) : v3(x, yF, zc), n: v3(0, sg, 0), d: v3(0, sg, 0), pn: horiz ? v3(0, 0, 1) : X, side: 1, prof: bp, profile: pp.beam, bolts: pp.beamBolts ?? 2 });
      if (!hollow && bp.props.b / 2 + T > inner / 2 + 0.5) out.issues.push({ code: 'PLATE_WIDE', severity: 'warning', elementId: cid, message: `${lab}: קורת האגד המוסטת ${hollow ? 'רחבה מפני העמוד' : 'אינה נכנסת בין אגפי העמוד'} (${Math.round(inner)})` });
      return { cid, col, j, label: `${lab} — קורה לעמוד` };
    });
    const beamR = specOk && horiz && HOLLOW.includes(bp.family);
    out.members.push({ id: bid, kind: 'beam', label: lab, start: beamR ? unshift(ends[0].j.start, Z, v3(0, 1, 0), 1) : ends[0].j.start, end: beamR ? unshift(ends[1].j.start, Z, v3(0, -1, 0), 1) : ends[1].j.start, profile: pp.beam, material: L.mat, rollDeg: 0, mirror: false, anchor: 'center', refUp: Z, source: 'generated', manualPlacement: false, partDesc: `קורת אגד ${pp.beam}` });
    for (const e of ends) {
      out.members.push(...e.j.members); out.issues.push(...e.j.issues);
      out.connections.push({ id: e.cid, type: 'knee', label: e.label, members: [e.col, bid], parts: e.j.parts, bolts: e.j.bolts, welds: e.j.welds, status: 'not-verified', fixity: 'pinned', overridden: false, ...rcp(horiz && HOLLOW.includes(bp.family), KNEE_FIN_BEAM_RECIPE_ID, bid, e.cid.endsWith('.E0') ? 'start' : 'end', pp.beamBolts ?? 2, 1) });
    }
    if (!withDiag) continue;
    // שני אלכסונים: מווב העמוד בגובה zBot−drop אל תחתית הקורה, בזווית מהאופק; הפוך — מראש הקורה עד zTop+drop בעמוד
    for (const [k, yF, sg, col] of [['1', ya, 1, colA], ['2', yb, -1, colB]] as const) {
      const kid = `${bid}.K${k}`;
      // הפחים לאלכסון: על ציר קורת האגד (x+T); הלשונית בצד השני — ציר האלכסון על ציר העמודים
      const C0 = inv ? v3(x + T, yF, zTopB + pp.drop) : v3(x + T, yF, zBot - pp.drop), R0 = v3(x + T, yF + sg * reach, inv ? zTopB : zBot);
      const dir = norm(sub(R0, C0));
      const common = { ...base, desc: 'אלכסון אגד', memberId: kid, prof: kp, profile: pp.brace, bolts: pp.boltsPerEnd ?? 2, pn: X, side: -1 as const };
      const cidC = `C.BB.${key}.K${k}C`, cidB = `C.BB.${key}.K${k}B`;
      const jc = finJoint({ ...common, cid: cidC, hostId: col, P: C0, n: v3(0, sg, 0), d: dir });
      const jb = finJoint({ ...common, cid: cidB, hostId: bid, P: R0, n: v3(0, 0, inv ? 1 : -1), d: v3(-dir.x, -dir.y, -dir.z) });
      out.members.push({ id: kid, kind: 'brace', label: `${lab} — אלכסון`, start: jc.start, end: jb.start, profile: pp.brace, material: L.mat, rollDeg: 0, mirror: false, anchor: 'center', refUp: X, source: 'generated', manualPlacement: false, partDesc: `אלכסון אגד B ${pp.brace}` });
      for (const [cid, j, hostId, t] of [[cidC, jc, col, 'אלכסון לעמוד'], [cidB, jb, bid, 'אלכסון לקורה']] as const) {
        out.members.push(...j.members); out.issues.push(...j.issues);
        out.connections.push({ id: cid, type: 'knee', label: `${lab} — ${t}`, members: [hostId, kid], parts: j.parts, bolts: j.bolts, welds: j.welds, status: 'not-verified', fixity: 'pinned', overridden: false, ...rcp(HOLLOW.includes(kp.family) && T < 25, KNEE_FIN_BBDIAG_RECIPE_ID, kid, cid.endsWith('C') ? 'start' : 'end', pp.boltsPerEnd ?? 2, -1, 0) });
      }
    }
  }
}
