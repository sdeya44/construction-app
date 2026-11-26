import { add, cross, dot, norm, scale, sub, v3, type Vec3 } from '../core/vec';
import type { BoltInfo, Member, RhsTrussParams, ValidationIssue, Connection, WeldInfo } from '../model/types';
import { getProfile, tryProfile } from '../profiles/library';
import { makeBolt } from './connections';

/** ברירת מחדל לפי תוכניות הלקוח: מוטות RHS100/100/5, אלכסונים RHS80/80/4; לשונית t=10 מרותכת בחריץ, 2×M16 לפח */
export function defaultRhsTruss(): RhsTrussParams {
  return {
    strut: 'RHS100x100x5', diag: 'RHS80x80x4', panels: 0, tongueT: 10, insert: 80,
    bolt: { d: 16, grade: '8.8', standard: 'ISO 4017', clearance: 2 }, boltsPerEnd: 2, pitch: 50, endDist: 40, edge: 30,
    gussetT: 10, clearance: 15, weldSize: 5,
  };
}

interface Ctx {
  res: { members: Member[]; connections: Connection[]; issues: ValidationIssue[] };
  mat: string;
}

/**
 * סבכה אופקית במפתח קשור (החלטת משתמש 15.11.2026): "חיזוק אופקי במקום ה-X".
 * מוטות לחיצה RHS לאורך Y בכל צומת, ואלכסוני RHS מקבילים בתבנית N (צומת אחד = מוט + לכל היותר אלכסון אחד).
 * חיבור: פח מרותך לווב הקורה במישור אמצע גובה הקורה (מסגריה); לשונית מרותכת בחריץ בקצה ה-RHS (מסגריה);
 * מוברג לפח בשטח. המוט מעל הפח, האלכסון מתחתיו — הלשוניות אינן חופפות. גיאומטריה בלבד, ללא בדיקת חוזק.
 */
export function rhsTruss(ctx: Ctx, rp: RhsTrussParams, key: string, label: string,
  plane0: Vec3, n: Vec3, wDir: Vec3, L: number, yF0: number, yF1: number, yFace0: number, yFace1: number, host0: string, host1: string) {
  const { res, mat } = ctx;
  for (const pr of [rp.strut, rp.diag]) if (!tryProfile(pr)) { res.issues.push({ code: 'PROFILE', severity: 'error', message: `סבכה אופקית: חתך לא מוכר ${pr}` }); return; }
  const bay = Math.abs(yF1 - yF0);
  const k = rp.panels > 0 ? rp.panels : Math.max(1, Math.round(L / bay));
  const ws = Array.from({ length: k + 1 }, (_, i) => (L * i) / k);
  const P = (y: number, w: number) => add(add(plane0, v3(0, y, 0)), scale(wDir, w));
  const tg = rp.gussetT, tt = rp.tongueT;
  const ext = rp.endDist + (rp.boltsPerEnd - 1) * rp.pitch + rp.edge; // אורך הלשונית מחוץ ל-RHS
  const y0 = Math.min(yFace0, yFace1), y1 = Math.max(yFace0, yFace1);
  // נקודות ברגים לכל צומת (לפח): מפתח = 0/1 (מסגרת) + אינדקס צומת
  const nodePts = new Map<string, { pts: Vec3[]; bolts: BoltInfo[]; yFace: number; host: string; w: number; members: string[]; welds: WeldInfo[] }>();
  const node = (f: 0 | 1, i: number) => {
    const nk = `${f}${i}`;
    if (!nodePts.has(nk)) nodePts.set(nk, { pts: [], bolts: [], yFace: f ? (yF1 > yF0 ? y1 : y0) : (yF1 > yF0 ? y0 : y1), host: f ? host1 : host0, w: ws[i], members: [], welds: [] });
    return nodePts.get(nk)!;
  };
  const place = (id: string, profile: string, a: { f: 0 | 1; i: number }, b: { f: 0 | 1; i: number }, side: 1 | -1, desc: string) => {
    const pr = getProfile(profile);
    const wt = pr.props.b; // רוחב הלשונית = רוחב ה-RHS
    const S = P(a.f ? yF1 : yF0, ws[a.i]), E = P(b.f ? yF1 : yF0, ws[b.i]);
    const ex = norm(sub(E, S));
    const uIn = norm(cross(n, ex)); // רוחבי במישור
    const ey = ex.y;
    const yEx = Math.abs(wt / 2 * uIn.y);
    const sAt = (y: number) => (y - S.y) / ey;
    // קצה הלשונית (פינות) במרחק clearance מפני הווב
    const tipS = ey > 0 ? sAt(y0 + rp.clearance + yEx) : sAt(y1 - rp.clearance - yEx);
    const tipE = ey > 0 ? sAt(y1 - rp.clearance - yEx) : sAt(y0 + rp.clearance + yEx);
    const sS = tipS + ext, sE = tipE - ext;
    if (!(sE - sS > 200)) { res.issues.push({ code: 'BRACE_SHORT', severity: 'warning', message: `${label}: ${desc} קצר מדי` }); return; }
    const off = scale(n, side * (tg + tt) / 2);
    const at = (s: number) => add(add(S, scale(ex, s)), off);
    res.members.push({ id, kind: 'brace', label: `${label} — ${desc}`, start: at(sS), end: at(sE), profile, material: mat, rollDeg: 0, mirror: false, anchor: 'center', refUp: n, source: 'generated', manualPlacement: false, partDesc: `${desc} ${profile}` });
    for (const [endKey, sEnd, dirIn, nd] of [['S', sS, -1, node(a.f, a.i)], ['E', sE, 1, node(b.f, b.i)]] as const) {
      const tid = `${id}.T${endKey}`;
      // לשונית: מחוץ ל-RHS לאורך ext, ובתוכו לאורך insert
      const t0 = sEnd - dirIn * rp.insert, t1 = sEnd + dirIn * ext;
      res.members.push({ id: tid, kind: 'plate', label: `לשונית PL${tt}×${wt}`, start: at(Math.min(t0, t1)), end: at(Math.max(t0, t1)), profile: `PL${wt}x${tt}`, material: mat, rollDeg: 0, mirror: false, anchor: 'center', refUp: n, source: 'generated', manualPlacement: false, partDesc: `לשונית PL${tt}×${wt}×${Math.round(ext + rp.insert)}` });
      nd.members.push(id, tid);
      nd.welds.push({ id: `${tid}.W`, connId: '', type: 'fillet', a: rp.weldSize, length: 4 * rp.insert, location: 'shop', between: [id, tid], from: at(sEnd), to: at(sEnd) });
      for (let j = 0; j < rp.boltsPerEnd; j++) {
        const s = sEnd + dirIn * (rp.endDist + j * rp.pitch);
        const onPlane = add(S, scale(ex, s));
        nd.pts.push(onPlane);
        const head = add(onPlane, scale(n, side * (tg / 2 + tt)));
        nd.bolts.push(makeBolt(`${tid}.B${j + 1}`, '', head, scale(n, -side), rp.bolt, tt + tg, 'site', [tid, ''], ex, res.members));
      }
    }
  };
  for (let i = 0; i <= k; i++) place(`HB.${key}.S${i + 1}`, rp.strut, { f: 0, i }, { f: 1, i }, 1, `מוט ${i + 1}`);
  for (let i = 0; i < k; i++) place(`HB.${key}.D${i + 1}`, rp.diag, { f: 0, i }, { f: 1, i: i + 1 }, -1, `אלכסון ${i + 1}`);
  // פח בכל צומת: מלבן במישור (y, w) מפני הווב ועד מעבר לברגים + שפה
  for (const [nk, nd] of nodePts) {
    if (!nd.pts.length) continue;
    const cid = `C.HB.${key}.${nk[0] === '0' ? 'A' : 'B'}${Number(nk.slice(1)) + 1}`;
    const gid = `${cid}.PL`;
    const ys = nd.pts.map((p) => p.y), wv = nd.pts.map((p) => dot(sub(p, plane0), wDir));
    const yIn = nd.yFace === y0 ? Math.max(...ys) + rp.edge : Math.min(...ys) - rp.edge;
    const ya = Math.min(nd.yFace, yIn), yb = Math.max(nd.yFace, yIn);
    const wa = Math.min(...wv) - rp.edge, wb = Math.max(...wv) + rp.edge;
    const W = Math.ceil((yb - ya) / 5) * 5, Lg = Math.ceil((wb - wa) / 5) * 5;
    const yc = nd.yFace === y0 ? ya + W / 2 : yb - W / 2, wc = (wa + wb) / 2;
    const c = P(yc, wc);
    res.members.push({ id: gid, kind: 'plate', label: `פח צומת סבכה PL${tg}×${W}×${Lg}`, start: add(c, scale(wDir, -Lg / 2)), end: add(c, scale(wDir, Lg / 2)), profile: `PL${W}x${tg}`, material: mat, rollDeg: 0, mirror: false, anchor: 'center', refUp: n, source: 'generated', manualPlacement: false, connId: cid, partDesc: `פח צומת סבכה PL${tg}×${W}×${Lg}` });
    for (const bo of nd.bolts) {
      bo.connId = cid; bo.holesIn = [bo.holesIn[0], gid];
      for (const suf of ['.H', '.S', '.N', '.W']) { const m = res.members.find((x) => x.id === bo.id + suf); if (m) m.connId = cid; }
    }
    for (const m of res.members) if (nd.members.includes(m.id) && m.kind === 'plate') m.connId = cid;
    const welds: WeldInfo[] = [
      { id: `${cid}.W1`, connId: cid, type: 'fillet', a: rp.weldSize, length: 2 * Lg, location: 'shop', between: [nd.host, gid], from: P(nd.yFace, wa), to: P(nd.yFace, wa + Lg) },
      ...nd.welds.map((w) => ({ ...w, connId: cid })),
    ];
    res.connections.push({
      id: cid, type: 'brace-end', label: `${label} — צומת ${nk[0] === '0' ? 'א' : 'ב'}${Number(nk.slice(1)) + 1}`,
      members: [nd.host, ...nd.members.filter((x) => !x.includes('.T'))], parts: [gid, ...nd.members.filter((x) => x.includes('.T')), ...nd.bolts.map((b) => b.id)],
      bolts: nd.bolts, welds, status: 'not-verified', fixity: 'pinned', overridden: false,
    });
  }
}
