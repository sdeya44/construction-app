import { add, cross, dot, norm, scale, sub, type Vec3 } from '../core/vec';
import type { BoltInfo, BoltSpec, Member, ValidationIssue, WeldInfo } from '../model/types';
import type { Profile } from '../profiles/library';
import { makeBolt } from './connections';

/**
 * פרט חיבור אחיד לאלכסונים ולקורות אגד (פרט הלקוח, תמונות האתר 15.11.2026):
 *   פח מרותך למארח (מסגריה), 2 חורים;
 *   ב-RHS חריץ ברוחב עובי הפח, ובתוכו פח שני (לשונית) עם 2 חורים, מרותך לפרופיל (מסגריה);
 *   בשטח — הלשונית צמודה לפח ומוברגת (חפיפה). לכל אלמנט פח בשני הקצוות.
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
}

export interface FinJointOut {
  /** קצה ה-RHS (נקודה על הציר המוסט) */
  start: Vec3;
  members: Member[]; bolts: BoltInfo[]; welds: WeldInfo[]; parts: string[]; issues: ValidationIssue[];
  finW: number; finL: number; tongueL: number;
}

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
  // רוחב הלשונית = מידת ה-RHS במישור הפח
  const wt = j.prof.props.b;
  const dn = dot(d, j.n), un = Math.abs(dot(u, j.n));
  if (dn < 0.25) issues.push({ code: 'BRACE_ANGLE', severity: 'warning', elementId: j.cid, message: `${j.desc}: זווית חדה מדי למארח` });
  const k = Math.max(dn, 0.25);
  const sTip = (clr + (wt / 2) * un) / k; // פינות הלשונית במרחק clearance מהמארח
  const sB = Array.from({ length: Math.max(1, j.bolts) }, (_, i) => sTip + edge + i * pitch);
  const sLast = sB[sB.length - 1];
  const off = scale(pn, side * (j.finT + j.tongueT) / 2);
  const ax = (s: number) => add(j.P, scale(d, s));
  // הפח: מלבן מפני המארח (b = 0) עד מעבר לבורג האחרון + שפה; לאורך המארח — מכסה את הברגים ואת קצה הלשונית
  const pa = (Q: Vec3) => dot(sub(Q, j.P), hdir), pb = (Q: Vec3) => dot(sub(Q, j.P), j.n);
  const boltPts = sB.map(ax);
  const tipCorners = [add(ax(sTip), scale(u, wt / 2)), add(ax(sTip), scale(u, -wt / 2))];
  const aVals = [...boltPts.map(pa).flatMap((a) => [a - edge, a + edge]), ...tipCorners.map(pa)];
  const a0 = Math.min(...aVals), a1 = Math.max(...aVals);
  const bMax = Math.max(...boltPts.map(pb)) + edge;
  const finL = Math.ceil((a1 - a0) / 5) * 5, finW = Math.ceil(bMax / 5) * 5;
  // קצה ה-RHS: אחרי הבורג האחרון, ופינותיו מעבר לפח (ה-RHS מוסט ואינו נכנס לפח)
  const sEnd = Math.max(sLast + endDist, (finW + 10 + (j.prof.props.h / 2) * un) / k);
  const base = j.tag ? `${j.cid}.${j.tag}` : j.cid;
  const fin = `${base}.PL`, tg = `${base}.T`;
  const fc = add(add(j.P, scale(hdir, (a0 + a1) / 2)), scale(j.n, finW / 2));
  members.push({
    id: fin, kind: 'plate', label: `פח חיבור ${j.desc} PL${j.finT}×${finW}×${finL}`, start: add(fc, scale(hdir, -finL / 2)), end: add(fc, scale(hdir, finL / 2)),
    profile: `PL${finW}x${j.finT}`, material: j.mat, rollDeg: 0, mirror: false, anchor: 'center', refUp: pn,
    source: 'generated', manualPlacement: false, connId: j.cid, partDesc: `פח חיבור ${j.desc} PL${j.finT}×${finW}×${finL}`,
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
  welds.push(
    { id: `${base}.W1`, connId: j.cid, type: 'fillet', a: j.weldSize, length: 2 * finL, location: 'shop', between: [j.hostId, fin], from: add(j.P, scale(hdir, a0)), to: add(j.P, scale(hdir, a1)) },
    { id: `${base}.W2`, connId: j.cid, type: 'fillet', a: j.weldSize, length: 4 * insert, location: 'shop', between: [j.memberId, tg], from: add(ax(sEnd), off), to: add(ax(sEnd + insert), off) },
  );
  return { start: add(ax(sEnd), off), members, bolts, welds, parts: [fin, tg, ...bolts.map((b) => b.id)], issues, finW, finL, tongueL };
}
