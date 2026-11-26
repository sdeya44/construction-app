import { add, cross, dot, norm, scale, sub, type Vec3 } from '../core/vec';
import type { BoltInfo, BoltSpec, Member, SlotCut, ValidationIssue, WeldInfo } from '../model/types';
import type { Profile } from '../profiles/library';
import { makeBolt } from './connections';

/**
 * פרט חיבור אחיד לאלכסונים ולקורות אגד (פרט הלקוח, תמונות האתר 15.11.2026):
 *   פח מרותך למארח (מסגריה) — פס ברוחב ה-RHS + 10 מכל צד לאורך ציר האלמנט, קצהו חתוך בזווית לפני המארח (סקיצה 15.11.2026);
 *   ב-RHS חריץ ברוחב עובי הפח, ובתוכו פח שני (לשונית) עם 2 חורים, מרותך לפרופיל (מסגריה);
 *   בשטח — הלשונית צמודה לפח ומוברגת (חפיפה), שני ברגים לרוחב. לכל אלמנט פח בשני הקצוות.
 * הפח במישור האלמנט, ממורכז על קו המארח; ציר ה-RHS מוסט בעובי (פח+לשונית)/2 לצד הלשונית.
 */
export interface FinJointIn {
  cid: string;
  /** תת-מזהה כשיש כמה קצוות באותו חיבור */
  tag?: string;
  desc: string;
  hostId: string; memberId: string;
  /** נקודת פגיעת ציר האלמנט (ללא ההסטה) בפני המארח */
  P: Vec3;
  /** נורמל פני המארח, לכיוון האלמנט */
  n: Vec3;
  /** כיוון ציר האלמנט, מהמארח החוצה */
  d: Vec3;
  /** נורמל מישור הפח (ניצב למישור האלמנט) */
  pn: Vec3;
  /** צד הלשונית ביחס לפח (+1/-1 לאורך pn) */
  side?: 1 | -1;
  prof: Profile; profile: string;
  finT: number; tongueT: number; bolt: BoltSpec;
  bolts: number;
  weldSize: number; mat: string;
  /** מרווחים: בין ברגים, בורג-קצה הפח, בורג אחרון-קצה ה-RHS, אורך הלשונית בתוך ה-RHS, מרווח קצה הלשונית מהמארח */
  pitch?: number; edge?: number; endDist?: number; insert?: number; clearance?: number;
  /** הרחבת הפח והלשונית מעבר לרוחב ה-RHS, מכל צד (ברירת מחדל 10) */
  extra?: number;
}

export interface FinJointOut {
  /** קצה ה-RHS (נקודה על הציר המוסט) */
  start: Vec3;
  members: Member[]; bolts: BoltInfo[]; welds: WeldInfo[]; parts: string[]; issues: ValidationIssue[];
  finW: number; finL: number; tongueL: number;
  /** חריץ הלשונית ב-RHS: רוחב עובי הלשונית + 1, עומק חפיפת הלשונית ב-RHS + 2 (כמו שהופיע בשרטוט החלק מאז 1.2x) */
  slots: SlotCut[];
}

/** פריסה לאובייקט חיבור: `...slotsOf(j1, j2)` — מוסיף `slots` רק אם יש. */
export const slotsOf = (...js: object[]): { slots?: SlotCut[] } => { const s = js.flatMap((x) => (x as { slots?: SlotCut[] }).slots ?? []); return s.length ? { slots: s } : {}; };

export function finJoint(j: FinJointIn): FinJointOut {
  const members: Member[] = [], welds: WeldInfo[] = [], issues: ValidationIssue[] = [];
  const d = norm(j.d);
  const pn = norm(sub(j.pn, scale(d, dot(j.pn, d))));
  const u = norm(cross(pn, d)); // רוחבי במישור הפח
  const hdir = norm(cross(pn, j.n)); // לאורך פני המארח, במישור הפח
  const side = j.side ?? 1;
  const d0 = j.bolt.d + j.bolt.clearance;
  const edge = j.edge ?? Math.max(35, Math.ceil((1.5 * d0) / 5) * 5);
  const pitch = j.pitch ?? Math.max(60, Math.ceil((2.4 * d0) / 5) * 5);
  const endDist = j.endDist ?? Math.max(45, Math.ceil((2.2 * d0) / 5) * 5);
  const insert = j.insert ?? 80;
  const clr = j.clearance ?? 10;
  // רוחב הלשונית והפח = מידת ה-RHS במישור הפח
  // רוחב הפח והלשונית: רוחב ה-RHS + 10 מכל צד (RHS80 ⇒ 100), כדי ששני ברגים ייכנסו לרוחב
  // לפחות כך ששני ברגים ייכנסו לרוחב (2 × שפה + מרווח 2.4·d0) — RHS60 ⇒ 95
  const eW0 = Math.max(25, Math.ceil((1.2 * (j.bolt.d + j.bolt.clearance)) / 5) * 5);
  const wt = Math.max(j.prof.props.b + 2 * (j.extra ?? 10), 2 * eW0 + Math.ceil((2.4 * (j.bolt.d + j.bolt.clearance)) / 5) * 5);
  const dn = dot(d, j.n), un = Math.abs(dot(u, j.n));
  if (dn < 0.25) issues.push({ code: 'BRACE_ANGLE', severity: 'warning', elementId: j.cid, message: `${j.desc}: זווית חדה מדי למארח` });
  const k = Math.max(dn, 0.25);
  const sTip = (clr + (wt / 2) * un) / k; // פינות הלשונית במרחק clearance מהמארח
  // ברגים: שניים לרוחב (באותו חתך), ושורות לאורך הציר; מרחק שפה לרוחב ≥ 1.2·d0 מעוגל ל-5
  const nb = Math.max(1, j.bolts);
  const eW = Math.max(25, Math.ceil((1.2 * d0) / 5) * 5);
  const gauge = wt - 2 * eW;
  const across = nb > 1 && gauge >= 2.4 * d0 - 0.01 ? 2 : 1;
  if (nb > 1 && across === 1) issues.push({ code: 'BOLT_EDGE', severity: 'warning', elementId: j.cid, message: `${j.desc}: הפח צר מכדי שני ברגים לרוחב — ברגים בשורה לאורך הציר` });
  const rows = Math.ceil(nb / across);
  const sB = Array.from({ length: rows }, (_, i) => sTip + edge + i * pitch);
  const sLast = sB[sB.length - 1];
  const off = scale(pn, side * (j.finT + j.tongueT) / 2);
  const ax = (s: number) => add(j.P, scale(d, s));
  const boltPts = sB.flatMap((s) => (across === 2 ? [-gauge / 2, gauge / 2] : [0]).map((w) => add(ax(s), scale(u, w)))).slice(0, nb);
  // הפח: פס ברוחב ה-RHS לאורך ציר האלמנט, קצהו במארח חתוך בזווית לפני המארח, ועד הבורג האחרון + שפה
  const s0 = -((wt / 2) * un) / k, sFin = sLast + edge;
  const finL = Math.ceil((sFin - s0) / 5) * 5, finW = wt;
  // קצה ה-RHS אחרי קצה הפח (ה-RHS מוסט ואינו נכנס לפח) ואחרי הבורג האחרון
  const sEnd = Math.max(sLast + endDist, s0 + finL + 10);
  const base = j.tag ? `${j.cid}.${j.tag}` : j.cid;
  const fin = `${base}.PL`, tg = `${base}.T`;
  members.push({
    id: fin, kind: 'plate', label: `פח חיבור ${j.desc} PL${j.finT}×${finW}×${finL}`, start: ax(s0), end: ax(s0 + finL),
    profile: `PL${finW}x${j.finT}`, material: j.mat, rollDeg: 0, mirror: false, anchor: 'center', refUp: pn,
    startCut: { point: j.P, normal: scale(j.n, -1) },
    source: 'generated', manualPlacement: false, connId: j.cid, partDesc: `פח חיבור ${j.desc} PL${j.finT}×${finW}×${finL} (קצה חתוך בזווית)`,
  });
  const tongueL = Math.ceil((sEnd + insert - sTip) / 5) * 5;
  members.push({
    id: tg, kind: 'plate', label: `לשונית ${j.desc} PL${j.tongueT}×${wt}×${tongueL}`, start: add(ax(sTip), off), end: add(ax(sTip + tongueL), off),
    profile: `PL${wt}x${j.tongueT}`, material: j.mat, rollDeg: 0, mirror: false, anchor: 'center', refUp: pn,
    source: 'generated', manualPlacement: false, connId: j.cid, partDesc: `לשונית ${j.desc} PL${j.tongueT}×${wt}×${tongueL}`,
  });
  const bolts: BoltInfo[] = boltPts.map((Q, i) => {
    const head = add(Q, scale(pn, side * (j.finT / 2 + j.tongueT)));
    return makeBolt(`${base}.B${i + 1}`, j.cid, head, scale(pn, -side), j.bolt, j.finT + j.tongueT, 'site', [tg, fin], d, members);
  });
  const weldL = Math.round(wt / Math.max(Math.sqrt(1 - un * un), 0.25));
  welds.push(
    { id: `${base}.W1`, connId: j.cid, type: 'fillet', a: j.weldSize, length: 2 * weldL, location: 'shop', between: [j.hostId, fin], from: add(j.P, scale(hdir, -weldL / 2)), to: add(j.P, scale(hdir, weldL / 2)) },
    { id: `${base}.W2`, connId: j.cid, type: 'fillet', a: j.weldSize, length: 4 * insert, location: 'shop', between: [j.memberId, tg], from: add(ax(sEnd), off), to: add(ax(sEnd + insert), off) },
  );
  const slots: SlotCut[] = !['RHS', 'SHS', 'CHS'].includes(j.prof.family) ? [] : [{ memberId: j.memberId, p: add(ax(sEnd), off), axis: d, nrm: pn, L: tongueL + sTip - sEnd + 2, w: j.tongueT + 1 }];
  return { start: add(ax(sEnd), off), members, bolts, welds, parts: [fin, tg, ...bolts.map((b) => b.id)], issues, finW, finL, tongueL, slots };
}

/**
 * פרט זוויתן (1.41): פח מרותך למארח (מסגריה) והזוויתן מוברג ישירות לפח (שטח) — רגל שטוחה על פני הפח, ברגים
 * בשורה אחת על קו הברגים של הרגל (gauge). ללא לשונית וללא חריץ. מתאים לאלכסוני זוויתן (L50 וכו').
 * קו הברגים = קו העבודה (P + s·d); הזוויתן מונח בצד +pn של הפח.
 */
export interface AngleFinIn { cid: string; tag?: string; desc: string; hostId: string; memberId: string; P: Vec3; n: Vec3; d: Vec3; pn: Vec3; prof: Profile; finT: number; bolt: BoltSpec; bolts: number; weldSize: number; mat: string; gauge: number; clearance?: number; /** כיוון הרגל השטוחה (אחיד לשני הקצוות) */ uDir?: Vec3 }
export interface AngleFinOut { start: Vec3; boltLine: Vec3; members: Member[]; bolts: BoltInfo[]; welds: WeldInfo[]; parts: string[]; issues: ValidationIssue[] }
export function angleFin(j: AngleFinIn): AngleFinOut {
  const members: Member[] = [], welds: WeldInfo[] = [], issues: ValidationIssue[] = [];
  const d = norm(j.d);
  const pn = norm(sub(j.pn, scale(d, dot(j.pn, d))));
  const u = j.uDir ? norm(j.uDir) : norm(cross(pn, d)); // כיוון הרגל השטוחה במישור הפח
  const hdir = norm(cross(pn, j.n));
  const leg = j.prof.props.b, t = j.prof.dims.t ?? 5, g = j.gauge;
  const d0 = j.bolt.d + j.bolt.clearance;
  const edge = Math.max(25, Math.ceil((1.5 * d0) / 5) * 5);
  const pitch = Math.max(50, Math.ceil((2.4 * d0) / 5) * 5);
  const clr = j.clearance ?? 10;
  if (leg - g < 1.2 * d0 - 0.01) issues.push({ code: 'BOLT_EDGE', severity: 'warning', elementId: j.cid, message: `${j.desc}: קו ברגים ${g} ברגל ${leg} — מרחק שפה קטן לבורג M${j.bolt.d}` });
  const dn = Math.max(dot(d, j.n), 0.25), un = Math.abs(dot(u, j.n));
  // פינות הזוויתן (לרוחב: [-g, leg-g] מקו הברגים) במרחק clearance מהמארח
  const sTip = (clr + Math.max(g, leg - g) * un) / dn;
  const nb = Math.max(1, j.bolts);
  const sB = Array.from({ length: nb }, (_, i) => sTip + edge + i * pitch);
  const sLast = sB[sB.length - 1];
  const ax = (s: number) => add(j.P, scale(d, s));
  // הפח: מכסה את הרגל השטוחה + 10 מכל צד, מהמארח (קצה חתוך בזווית) עד הבורג האחרון + שפה
  const W = Math.ceil((leg + 20) / 5) * 5, uc = leg / 2 - g;
  const s0 = -((W / 2 + Math.abs(uc)) * un) / dn, finL = Math.ceil((sLast + edge - s0) / 5) * 5;
  const base = j.tag ? `${j.cid}.${j.tag}` : j.cid;
  const fin = `${base}.PL`;
  const offC = scale(u, uc);
  members.push({ id: fin, kind: 'plate', label: `פח חיבור ${j.desc} PL${j.finT}×${W}×${finL}`, start: add(ax(s0), offC), end: add(ax(s0 + finL), offC), profile: `PL${W}x${j.finT}`, material: j.mat, rollDeg: 0, mirror: false, anchor: 'center', refUp: pn, startCut: { point: j.P, normal: scale(j.n, -1) }, source: 'generated', manualPlacement: false, connId: j.cid, partDesc: `פח חיבור ${j.desc} PL${j.finT}×${W}×${finL} (קצה חתוך בזווית)` });
  const bolts: BoltInfo[] = sB.map((s, i) => makeBolt(`${base}.B${i + 1}`, j.cid, add(ax(s), scale(pn, j.finT / 2 + t)), scale(pn, -1), j.bolt, j.finT + t, 'site', [j.memberId, fin], d, members));
  const weldL = Math.round(W / Math.max(Math.sqrt(1 - un * un), 0.25));
  welds.push({ id: `${base}.W1`, connId: j.cid, type: 'fillet', a: j.weldSize, length: 2 * weldL, location: 'shop', between: [j.hostId, fin], from: add(j.P, scale(hdir, -weldL / 2)), to: add(j.P, scale(hdir, weldL / 2)) });
  // קצה הזוויתן: על קו הפינה (עקב) — קו הברגים מוסט ב-g לרוחב ובחצי עובי הפח
  const corner = (s: number) => add(add(ax(s), scale(u, -g)), scale(pn, j.finT / 2));
  return { start: corner(sTip), boltLine: ax(sTip), members, bolts, welds, parts: [fin, ...bolts.map((b) => b.id)], issues };
}
