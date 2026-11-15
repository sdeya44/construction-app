import { add, cross, dot, norm, scale, sub, type Vec3 } from '../core/vec';
import type { BoltInfo, BoltSpec, Member, ValidationIssue, WeldInfo } from '../model/types';
import type { Profile } from '../profiles/library';
import { hw, makeBolt } from './connections';

/**
 * פרט חיבור אחיד לאלכסונים ולקורות אגד (לפי פרט הלקוח):
 *   מארח ── זיז (קטע קצר מאותו פרופיל, מרותך למארח במסגריה) ── פלטת זיז ┃ פלטת קצה ── האלמנט
 * שתי הפלטות ניצבות לציר האלמנט ומוברגות זו לזו בשטח; הברגים מחוץ להיטל הפרופיל (בכיוון u),
 * והזיז ארוך מספיק כדי שהאום לא ייגע במארח. אין קידוח במארח ואין ברגים דרך הווב.
 */
export interface StubJointIn {
  cid: string;
  /** תת-מזהה כשיש כמה קצוות באותו חיבור */
  tag?: string;
  /** תיאור לחלקים (לדוגמה "אלכסון") */
  desc: string;
  hostId: string; memberId: string;
  /** נקודת פגיעת ציר האלמנט בפני המארח */
  P: Vec3;
  /** נורמל פני המארח, לכיוון האלמנט */
  n: Vec3;
  /** כיוון ציר האלמנט, מהמארח החוצה */
  d: Vec3;
  /** כיוון פריסת הברגים (ניצב ל-d) */
  u: Vec3;
  prof: Profile; profile: string; refUp: Vec3;
  plateT: number; bolt: BoltSpec;
  /** 2 = בורג אחד מכל צד; 4 = שתי שורות */
  bolts: 2 | 4;
  weldSize: number; mat: string;
  /** אורך זיז מזערי (בציר) */
  minStub?: number;
}

export interface StubJointOut {
  /** נקודת תחילת האלמנט — פני פלטת הקצה */
  start: Vec3;
  members: Member[]; bolts: BoltInfo[]; welds: WeldInfo[]; parts: string[]; issues: ValidationIssue[];
  plateW: number; plateL: number; stubLen: number;
}

export function stubJoint(j: StubJointIn): StubJointOut {
  const members: Member[] = [], welds: WeldInfo[] = [], issues: ValidationIssue[] = [];
  const d = norm(j.d), u = norm(sub(j.u, scale(d, dot(j.u, d))));
  const w = norm(cross(d, u));
  const t = j.plateT;
  const h = hw(j.bolt.d);
  const nutR = h.s / Math.sqrt(3) + 2;
  const d0 = j.bolt.d + j.bolt.clearance;
  const e = Math.max(30, Math.ceil((1.5 * d0) / 5) * 5);
  // היטל החתך בכיווני u ו-w (בקירוב: מלבן חוסם)
  const P0 = j.prof.props.h / 2, B0 = j.prof.props.b / 2;
  const ru = Math.abs(dot(u, j.refUp)), extU = ru * P0 + (1 - ru) * B0, extW = ru * B0 + (1 - ru) * P0;
  const g = Math.ceil((2 * (extU + nutR + 2)) / 5) * 5; // מרחק בין הברגים: מחוץ לפרופיל
  const rowP = j.bolts === 4 ? Math.max(Math.ceil((2.4 * d0) / 5) * 5, Math.floor(Math.min(2 * extW - 2 * nutR, 80) / 5) * 5) : 0;
  const plateL = g + 2 * e;
  const plateW = Math.max(Math.ceil((2 * extW + 20) / 5) * 5, rowP + 2 * e);
  const dn = dot(d, j.n);
  if (dn < 0.2) issues.push({ code: 'BRACE_ANGLE', severity: 'warning', elementId: j.cid, message: `${j.desc}: זווית חדה מדי למארח` });
  const k = Math.max(dn, 0.2);
  const along = (o: number, vec: Vec3) => (o * dot(vec, j.n)) / k; // הפרש מרחק למארח לאורך הציר בהיסט o בכיוון vec
  // אורך הזיז: האום (דסקית + אום + מרווח) לא נוגע במארח, ופינות הזיז ארוכות 20 מ"מ לפחות
  const need = h.w + h.m + 8;
  let L = j.minStub ?? 30;
  for (const su of [-1, 1]) for (const sw of [-1, 1]) {
    L = Math.max(L, need - along(su * g / 2, u) - along(sw * rowP / 2, w));
    L = Math.max(L, 20 - along(su * extU, u) - along(sw * extW, w));
  }
  L = Math.ceil(L / 5) * 5;
  const S0 = add(j.P, scale(d, L)); // פני הפלטה של הזיז (בצד המארח)
  const base = j.tag ? `${j.cid}.${j.tag}` : j.cid;
  const stubId = `${base}.S`, pS = `${base}.P1`, pM = `${base}.P2`;
  members.push({
    id: stubId, kind: 'brace', label: `זיז ${j.desc} ${j.profile}`, start: j.P, end: S0, profile: j.profile, material: j.mat, rollDeg: 0, mirror: false,
    anchor: 'center', refUp: j.refUp, source: 'generated', manualPlacement: false, connId: j.cid, partDesc: `זיז ${j.desc} ${j.profile}`,
    startCut: { point: j.P, normal: scale(j.n, -1) },
  });
  const plate = (id: string, desc: string, c: Vec3): Member => ({
    id, kind: 'plate', label: `${desc} PL${t}×${plateW}×${plateL}`, start: sub(c, scale(u, plateL / 2)), end: add(c, scale(u, plateL / 2)),
    profile: `PL${plateW}x${t}`, material: j.mat, rollDeg: 0, mirror: false, anchor: 'center', refUp: d,
    source: 'generated', manualPlacement: false, connId: j.cid, partDesc: `${desc} PL${t}×${plateW}×${plateL}`,
  });
  members.push(plate(pS, `פלטת זיז ${j.desc}`, add(S0, scale(d, t / 2))));
  members.push(plate(pM, `פלטת קצה ${j.desc}`, add(S0, scale(d, 1.5 * t))));
  const start = add(S0, scale(d, 2 * t));
  const bolts: BoltInfo[] = [];
  const rows = j.bolts === 4 ? [-rowP / 2, rowP / 2] : [0];
  for (const ow of rows) for (const ou of [-g / 2, g / 2]) {
    const head = add(add(start, scale(u, ou)), scale(w, ow));
    bolts.push(makeBolt(`${base}.B${bolts.length + 1}`, j.cid, head, scale(d, -1), j.bolt, 2 * t, 'site', [pM, pS], w, members));
  }
  const per = 2 * (j.prof.props.h + j.prof.props.b);
  welds.push(
    { id: `${base}.W1`, connId: j.cid, type: 'fillet', a: j.weldSize, length: Math.round(per / Math.max(dn, 0.5)), location: 'shop', between: [j.hostId, stubId], from: j.P, to: j.P },
    { id: `${base}.W2`, connId: j.cid, type: 'fillet', a: j.weldSize, length: per, location: 'shop', between: [stubId, pS], from: S0, to: S0 },
    { id: `${base}.W3`, connId: j.cid, type: 'fillet', a: j.weldSize, length: per, location: 'shop', between: [j.memberId, pM], from: start, to: start },
  );
  return { start, members, bolts, welds, parts: [stubId, pS, pM, ...bolts.map((b) => b.id)], issues, plateW, plateL, stubLen: L };
}
