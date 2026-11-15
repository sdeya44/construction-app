import { add, dot, norm, scale, sub, v3, type Vec3 } from '../core/vec';
import { getProfile, tryProfile } from '../profiles/library';
import type { BoltInfo, BraceConnParams, BracingParams, BuildingParams, Connection, Member, ValidationIssue, WeldInfo } from '../model/types';
import { zAt, type SectionTopology } from '../model/section';
import { hw, makeBolt } from './connections';
import { defaultRhsTruss, rhsTruss } from './hbrace';
import { buildPortalLine, defaultPortal } from './portal';
import { localFrame } from './frame';
import { bolt } from '../model/defaults';

export interface BracingResult { members: Member[]; connections: Connection[]; issues: ValidationIssue[] }

/** מפתחי קיר לכל ציר עמודים: byLine אם הוגדר, אחרת left לציר הראשון ו-right לאחרון (סדר לפי X) */
export function wallBays(br: BracingParams, lineIds: string[]): [string, number[]][] {
  const w = br.walls;
  if (w.byLine) return lineIds.filter((id) => w.byLine![id]?.length).map((id) => [id, w.byLine![id]]);
  if (!lineIds.length) return [];
  return lineIds.length > 1 ? [[lineIds[0], w.left], [lineIds[lineIds.length - 1], w.right]] : [[lineIds[0], w.left]];
}

/** מפתחים: אינדקסים שליליים נספרים מהסוף (‎-1 = המפתח האחרון). */
export function resolveBays(bays: number[], count: number): number[] {
  const out = new Set<number>();
  for (const b of bays) { const i = b < 0 ? count + b : b; if (i >= 0 && i < count) out.add(i); }
  return [...out].sort((a, b) => a - b);
}

const Yn = v3(0, 1, 0);
/** cut=true: חיתוך הקצוות במקביל לפני הווב/האגף (מישור Y קבוע), כדי שפינת הקושרת האלכסונית לא תחדור לאלמנט */
const mk = (id: string, label: string, profile: string, start: Vec3, end: Vec3, refUp: Vec3, material: string, anchor: Member['anchor'] = 'center', cut = false): Member => ({
  id, kind: 'brace', label, start, end, profile, material, rollDeg: 0, mirror: false, anchor, refUp,
  source: 'generated', manualPlacement: false, partDesc: `${label} ${profile}`,
  ...(cut ? { startCut: { point: start, normal: Yn }, endCut: { point: end, normal: Yn } } : {}),
});

/**
 * קושרות X בגג ובקירות ושורות קשירה לפטות. קושרות X עובדות במתיחה בלבד (לפי תוכנית K-02).
 * חיבור: פח מרותך במסגריה, זוויתן מוברג בשטח (M16), בורג בהצטלבות — החלטת משתמש 15.11.2026.
 */
export function buildBracing(b: BuildingParams, topo: SectionTopology, purlins: Member[], eff: BuildingParams, stockLen = 12000): BracingResult {
  const res: BracingResult = { members: [], connections: [], issues: [] };
  const br = b.bracing;
  const frames = b.frames;
  const nb = frames.length - 1;
  const mat = b.material;
  const raf = getProfile(b.rafterProfile), col = getProfile(b.columnProfile);
  const tw = raf.dims.tw ?? raf.dims.t ?? 6;
  for (const [key, prof] of [['roof', br.roof.profile], ['walls', br.walls.profile], ['ties', br.purlinTies.profile]] as const) {
    if (!tryProfile(prof)) res.issues.push({ code: 'PROFILE', severity: 'error', message: `חתך קושרת לא מוכר (${key}): ${prof}` });
  }
  if (res.issues.length) return res;

  const bc = br.conn;
  const xbrace = (key: string, label: string, profile: string, plane0: Vec3, n: Vec3, wDir: Vec3,
    pA: { y: number; w: number }, pC: { y: number; w: number }, yFace0: number, yFace1: number, host0: string, host1: string) =>
    xBrace(res, b, bc, key, label, profile, plane0, n, wDir, pA, pC, yFace0, yFace1, host0, host1);

  // ---- קושרות גג: במישור אמצע גובה קורת הגג, פח חיבור מרותך לווב הקורה בכל קצה
  if (br.roof.enabled) {
    const slopes: { side: string; a: { x: number; z: number }; c: { x: number; z: number }; rid: (f: string) => string }[] = [];
    const ridgeGap = 150 + bc.gussetEdge;
    // לכל מישור: מהעמוד הקיצוני בכל צד (או מהקצה פחות מרווח, אם אין עמוד באותו חצי — רכס/חיבור צד/קונזולה)
    // קושרות לכל אורך המישור, מחולקות לקטעים בכל עמוד פנימי (החלטת משתמש 15.11.2026: "אלכסונים בגג" עד הרכס)
    for (const pl of topo.sec.planes) {
      const lo = Math.min(pl.a.x, pl.b.x), hi = Math.max(pl.a.x, pl.b.x);
      const inside = topo.sec.lines.filter((l) => l.x > lo + 1 && l.x < hi - 1).map((l) => l.x).sort((p, q) => p - q);
      const isJoined = (e: 'a' | 'b') => topo.ridges.some((r) => (r.pa === pl && r.ea === e) || (r.pb === pl && r.eb === e))
        || topo.junctions.some((j) => j.plane === pl && j.kind === 'side' && j.end === e);
      // קצה חופשי (מרזב/קונזולה): מהעמוד הקרוב; קצה מחובר (רכס/צד עמוד): מהקצה פחות מרווח
      const endX = (e: 'a' | 'b') => {
        const E = pl[e], toward = E.x < (lo + hi) / 2 ? 1 : -1;
        if (!isJoined(e) && inside.length) return toward > 0 ? inside[0] : inside[inside.length - 1];
        return E.x + toward * ridgeGap;
      };
      const xa = endX('a'), xc = endX('b');
      const x0 = Math.min(xa, xc), x1 = Math.max(xa, xc);
      const st = [x0, ...inside.filter((x) => x > x0 + 500 && x < x1 - 500), x1];
      // סדר מנקודה a לנקודה c (תאימות למזהים בגג הקלאסי)
      const ordered = xa <= xc ? st : [...st].reverse();
      const nseg = ordered.length - 1;
      for (let k = 0; k < nseg; k++) {
        const s0 = ordered[k], s1 = ordered[k + 1];
        slopes.push({ side: nseg > 1 ? `${pl.id}${k + 1}` : pl.id, a: { x: s0, z: zAt(pl, s0) }, c: { x: s1, z: zAt(pl, s1) }, rid: pl.rafterId });
      }
    }
    for (const bay of resolveBays(br.roof.bays, nb)) {
      const f0 = frames[bay], f1 = frames[bay + 1];
      for (const sl of slopes) {
        const dir = norm(v3(sl.c.x - sl.a.x, 0, sl.c.z - sl.a.z));
        const n = norm(v3(-dir.z * Math.sign(dir.x), 0, Math.abs(dir.x)));
        // מישור הקושרות: אמצע גובה הקורה (קו הייחוס הוא פני עליון)
        const o = add(v3(sl.a.x, 0, sl.a.z), scale(n, -raf.props.h / 2));
        const L = Math.hypot(sl.c.x - sl.a.x, sl.c.z - sl.a.z);
        const rid = sl.rid;
        if (br.roof.type === 'rhs') rhsTruss({ res, mat: b.material }, br.roof.rhs ?? defaultRhsTruss(), `R${bay + 1}.${sl.side}`, `סבכה אופקית מפתח ${bay + 1}`, o, n, dir, L,
          f0.y, f1.y, f0.y + tw / 2, f1.y - tw / 2, rid(f0.id), rid(f1.id));
        else {
          // שיפוע ארוך: חלוקה לכמה פנלי X לאורך השיפוע, כך שאלכסון לא יעלה על חומר הגלם (החלטת משתמש 15.11.2026)
          const bayW = Math.abs(f1.y - f0.y), stock = stockLen;
          let k = 1;
          while (k < 8 && Math.hypot(L / k, bayW) > stock - 100) k++;
          const gap = k > 1 ? bc.gussetEdge + 120 : 0; // פחי החיבור של שני פנלים סמוכים זה ליד זה על הקורה
          for (let j = 0; j < k; j++) {
            const w0 = (L * j) / k + (j > 0 ? gap : 0), w1 = (L * (j + 1)) / k - (j < k - 1 ? gap : 0);
            xbrace(`R${bay + 1}.${sl.side}${k > 1 ? `.${j + 1}` : ''}`, `קושרת גג מפתח ${bay + 1}${k > 1 ? ` פנל ${j + 1}` : ''}`, br.roof.profile, o, n, dir,
              { y: f0.y, w: w0 }, { y: f1.y, w: w1 }, f0.y + tw / 2, f1.y - tw / 2, rid(f0.id), rid(f1.id));
          }
        }
      }
    }
  }

  // ---- קושרות קיר: במישור ציר העמודים, פח חיבור מרותך לווב העמוד בכל קצה
  if (br.walls.enabled) {
    const ctw = col.dims.tw ?? col.dims.t ?? 6;
    const ls = [...topo.sec.lines].sort((p, q) => p.x - q.x);
    for (const [lid, bays] of wallBays(b.bracing, ls.map((l) => l.id))) {
      const l = ls.find((q) => q.id === lid)!;
      const ct = topo.colTop.get(l.id);
      if (!ct) continue;
      const cap = ct.cap ?? topo.junctions.find((j) => j.line === l)?.plane;
      const sl = cap ? Math.abs((cap.b.z - cap.a.z) / (cap.b.x - cap.a.x)) : 0;
      const rafV = raf.props.h * Math.sqrt(1 + sl * sl);
      const side = l.id;
      const x = l.x, eave = ct.z;
      if ((br.walls.type ?? 'x') === 'portal') {
        buildPortalLine(res, br.walls.portal ?? defaultPortal(), {
          side, label: l.label, x, frames: frames.map((f) => ({ id: f.id, y: f.y })), portalBays: resolveBays(bays, nb),
          colProfile: b.columnProfile, zBase: b.baseElevation, zTop: eave - rafV - 60, mat,
        });
        continue;
      }
      for (const bay of resolveBays(bays, nb)) {
        const f0 = frames[bay], f1 = frames[bay + 1];
        const z0 = b.baseElevation + 300, z1 = eave - rafV - 60 - 150;
        if (z1 - z0 < 1000) { res.issues.push({ code: 'BRACE_SHORT', severity: 'warning', message: `קושרת קיר ציר ${l.label} מפתח ${bay + 1}: גובה קטן מדי` }); continue; }
        xbrace(`W${bay + 1}.${side}`, `קושרת קיר ציר ${l.label} מפתח ${bay + 1}`, br.walls.profile, v3(x, 0, z0), v3(1, 0, 0), v3(0, 0, 1),
          { y: f0.y, w: 0 }, { y: f1.y, w: z1 - z0 }, f0.y + ctw / 2, f1.y - ctw / 2, `${f0.id}.COL.${l.id}`, `${f1.id}.COL.${l.id}`);
      }
    }
  }

  // ---- שורת קשירה לאגף התחתון של הפטות, באמצע כל מפתח, לכל שיפוע
  if (br.purlinTies.enabled) {
    for (const side of topo.sec.planes.map((p) => p.id)) {
      const ps = purlins.filter((m) => m.purlin?.side === side).sort((a, c) => a.purlin!.index - c.purlin!.index);
      if (ps.length < 2) continue;
      const first = ps[0], last = ps[ps.length - 1];
      const dir = norm(sub(v3(last.start.x, 0, last.start.z), v3(first.start.x, 0, first.start.z)));
      const n = first.purlin!.roofNormal;
      const a0 = sub(v3(first.start.x, 0, first.start.z), scale(dir, 60));
      const a1 = add(v3(last.start.x, 0, last.start.z), scale(dir, 60));
      const tieProf = getProfile(br.purlinTies.profile);
      const tieT = tieProf.dims.t ?? 4;
      for (let bay = 0; bay < nb; bay++) {
        const ym = (frames[bay].y + frames[bay + 1].y) / 2;
        const id = `BR.T${bay + 1}.${side}`;
        // זוויתן מסובב 180°: הרגל האופקית למעלה, צמודה מתחת לאגף התחתון של הפטות (מגע 0 מ"מ)
        const tie = mk(id, `שורת קשירה לפטות מפתח ${bay + 1}`, br.purlinTies.profile, v3(a0.x, ym, a0.z), v3(a1.x, ym, a1.z), n, mat, 'purlin');
        tie.rollDeg = 180;
        res.members.push(tie);
        const cid = `C.BR.TIE.${side}.${bay + 1}`;
        // בורג M12 בכל הצטלבות: דרך הרגל האופקית ואמצע האגף התחתון של הפטה (בשטח)
        const bolts: BoltInfo[] = [];
        for (const pm of ps) {
          const pp = getProfile(pm.profile);
          const lf = localFrame(pm);
          const flangeDir = pp.family === 'Z' ? scale(lf.u, -1) : lf.u;
          if (pp.family !== 'C' && pp.family !== 'Z') continue;
          const at = add(v3(pm.start.x, ym, pm.start.z), scale(flangeDir, pp.props.b / 2));
          const head = sub(at, scale(n, tieT));
          bolts.push(makeBolt(`${cid}.B${pm.purlin!.index}`, cid, head, n, bolt(12), tieT + pp.dims.t, 'site', [id, pm.id], flangeDir, res.members));
        }
        res.connections.push({ id: cid, type: 'brace', label: `שורת קשירה מפתח ${bay + 1} — מוברגת לאגף התחתון של כל פטה`, members: ps.map((m) => m.id), parts: [id, ...bolts.map((b2) => b2.id)], bolts, welds: [], status: 'not-verified', fixity: 'pinned', overridden: false });
      }
    }
  }
  void eff;
  return res;
}

/** קו ברגים סטנדרטי מגב זוויתן לפי רוחב הרגל (מקובל; אינו מאומת מקטלוג). */
export function angleGauge(leg: number): number {
  const T: Record<number, number> = { 40: 22, 45: 25, 50: 28, 60: 35, 65: 35, 70: 40, 75: 40, 80: 45, 90: 50, 100: 55, 120: 50 };
  return T[leg] ?? Math.round(leg * 0.55);
}

/**
 * קושרת X אחת: שני זוויתנים במישור P (נקודה plane0, נורמל n). נקודות העבודה pA/pC בקואורדינטות (y, w)
 * כאשר w לאורך wDir במישור. זוויתן 1 מעל המישור, זוויתן 2 מתחתיו — הרגל השטוחה צמודה לפח החיבור (עובי tg במישור).
 * כל קצה: פח חיבור מרותך לווב (מסגריה) ו-boltsPerEnd ברגים (שטח). בהצטלבות: פח מילוי ובורג אחד.
 * הקושרות עובדות במתיחה בלבד (לפי K-02). בדיקת חוזק — אינה מבוצעת.
 */
function xBrace(res: BracingResult, b: BuildingParams, bc: BraceConnParams, key: string, label: string, profile: string,
  plane0: Vec3, n: Vec3, wDir: Vec3, pA: { y: number; w: number }, pC: { y: number; w: number },
  yFace0: number, yFace1: number, host0: string, host1: string) {
  const mat = b.material;
  const prof = getProfile(profile);
  const leg = prof.props.b, t = prof.dims.t ?? 5;
  const g = bc.gauge ?? angleGauge(leg);
  const tg = bc.gussetT;
  const d0 = bc.bolt.d + bc.bolt.clearance;
  const P = (y: number, w: number) => add(add(plane0, v3(0, y, 0)), scale(wDir, w));
  const issues = res.issues;
  if (leg - g < 1.2 * d0 - 0.01 || g - t < hw(bc.bolt.d).s / 2 + 2) {
    issues.push({ code: 'BOLT_EDGE', severity: 'warning', message: `${label}: קו ברגים ${g} מ"מ ברגל ${leg} — מרחק שפה/מרווח מפתח לבדיקה` });
  }
  if (bc.pitch < 2.2 * d0 - 0.01 && bc.boltsPerEnd > 1) issues.push({ code: 'BOLT_EDGE', severity: 'warning', message: `${label}: מרווח ברגים ${bc.pitch} < 2.2·d0 (מינימום מקובל)` });
  if (bc.endDist < 1.2 * d0 - 0.01) issues.push({ code: 'BOLT_EDGE', severity: 'warning', message: `${label}: מרחק קצה ${bc.endDist} < 1.2·d0 (מינימום מקובל)` });

  // שני האלכסונים: 1 מ-(A, y0) ל-(C, y1); 2 מ-(A, y1) ל-(C, y0)
  const diag = [
    { k: 1, s: { y: pA.y, w: pA.w }, e: { y: pC.y, w: pC.w }, side: 1 },
    { k: 2, s: { y: pC.y, w: pA.w }, e: { y: pA.y, w: pC.w }, side: -1 },
  ];
  const lines: { id: string; S: Vec3; ex: Vec3 }[] = [];
  for (const dg of diag) {
    const id = `BR.${key}.${dg.k}`;
    const S = P(dg.s.y, dg.s.w), E = P(dg.e.y, dg.e.w);
    const ex = norm(sub(E, S));
    const vUp = scale(n, dg.side);
    const lf = localFrame({ start: S, end: E, refUp: vUp, rollDeg: 0, mirror: false });
    // u: כיוון הרגל השטוחה. חתך הזוויתן ביחס לקו הברגים: u ∈ [-g, leg-g]
    const yLo = Math.min(-g * lf.u.y, (leg - g) * lf.u.y), yHi = Math.max(-g * lf.u.y, (leg - g) * lf.u.y);
    // קצוות ריבועיים: כל פינות החתך במרחק clearance לפחות מפני הווב
    const ey = ex.y; // ≠ 0
    const y0 = Math.min(yFace0, yFace1), y1 = Math.max(yFace0, yFace1);
    const sAt = (y: number) => (y - S.y) / ey;
    const sS = ey > 0 ? sAt(y0 + bc.clearance - yLo) : sAt(y1 - bc.clearance - yHi);
    const sE = ey > 0 ? sAt(y1 - bc.clearance - yHi) : sAt(y0 + bc.clearance - yLo);
    const len = Math.hypot(E.x - S.x, E.y - S.y, E.z - S.z);
    if (!(sE - sS > 2 * (bc.endDist + (bc.boltsPerEnd - 1) * bc.pitch) + 100) || sS < -len) {
      issues.push({ code: 'BRACE_SHORT', severity: 'warning', message: `${label}: מפתח קצר מדי לקושרת עם פחי חיבור` });
      return;
    }
    const off = add(scale(lf.u, -g), scale(n, dg.side * tg / 2));
    const a0 = add(add(S, scale(ex, sS)), off), a1 = add(add(S, scale(ex, sE)), off);
    const m = mk(id, label, profile, a0, a1, vUp, mat, 'corner');
    res.members.push(m);
    lines.push({ id, S, ex });

    // קצוות: פח חיבור + ברגים
    for (const [endKey, sEnd, dirIn, yFace, host] of [['S', sS, 1, ey > 0 ? y0 : y1, ey > 0 ? host0 : host1], ['E', sE, -1, ey > 0 ? y1 : y0, ey > 0 ? host1 : host0]] as const) {
      const cid = `C.BR.${key}.${dg.k}${endKey}`;
      const gid = `${cid}.PL`;
      const bolts: BoltInfo[] = [];
      const pts: Vec3[] = [];
      for (let i = 0; i < bc.boltsPerEnd; i++) {
        const s = sEnd + dirIn * (bc.endDist + i * bc.pitch);
        const onPlane = add(S, scale(ex, s));
        pts.push(onPlane);
        const head = add(onPlane, scale(n, dg.side * (tg / 2 + t)));
        bolts.push(makeBolt(`${cid}.B${i + 1}`, cid, head, scale(n, -dg.side), bc.bolt, t + tg, 'site', [id, gid], ex, res.members));
      }
      // פח חיבור: מלבן במישור (y, w) — מפני הווב ועד מעבר לבורג האחרון + מרחק שפה
      const ys = pts.map((p) => p.y), ws = pts.map((p) => dot(sub(p, plane0), wDir));
      const yIn = yFace === y0 ? Math.max(...ys) + bc.gussetEdge : Math.min(...ys) - bc.gussetEdge;
      const ya = Math.min(yFace, yIn), yb = Math.max(yFace, yIn);
      const wa = Math.min(...ws) - bc.gussetEdge, wb = Math.max(...ws) + bc.gussetEdge;
      const W = Math.ceil((yb - ya) / 5) * 5, Lg = Math.ceil((wb - wa) / 5) * 5;
      const yc = yFace === y0 ? ya + W / 2 : yb - W / 2;
      const wc = (wa + wb) / 2;
      const gs = add(P(yc, wc), scale(wDir, -Lg / 2)), ge = add(P(yc, wc), scale(wDir, Lg / 2));
      res.members.push({
        id: gid, kind: 'plate', label: `פח חיבור קושרת PL${tg}×${W}×${Lg}`, start: gs, end: ge, profile: `PL${W}x${tg}`, material: mat,
        rollDeg: 0, mirror: false, anchor: 'center', refUp: n, source: 'generated', manualPlacement: false, connId: cid, partDesc: `פח חיבור קושרת PL${tg}×${W}×${Lg}`,
      });
      const wf = P(yFace, wa), wt = P(yFace, wa + Lg);
      const welds: WeldInfo[] = [{ id: `${cid}.W1`, connId: cid, type: 'fillet', a: bc.weldSize, length: 2 * Lg, location: 'shop', between: [host, gid], from: wf, to: wt }];
      res.connections.push({
        id: cid, type: 'brace-end', label: `${label} — פח חיבור ${endKey === 'S' ? 'התחלה' : 'סוף'} אלכסון ${dg.k}`,
        members: [host, id], parts: [gid, ...bolts.map((x) => x.id)], bolts, welds, status: 'not-verified', fixity: 'pinned', overridden: false,
      });
    }
  }
  // הצטלבות: חיתוך קווי הברגים במישור; פח מילוי בעובי פח החיבור ובורג אחד
  if (bc.crossBolt && lines.length === 2) {
    const [l1, l2] = lines;
    const a = l1.ex, c = l2.ex, r = sub(l2.S, l1.S);
    const aa = dot(a, a), ac = dot(a, c), cc = dot(c, c), ar = dot(a, r), cr = dot(c, r);
    const den = aa * cc - ac * ac;
    if (Math.abs(den) > 1e-9) {
      const s1 = (ar * cc - ac * cr) / den;
      const X = add(l1.S, scale(a, s1));
      const cid = `C.BR.${key}.X`;
      const fid = `${cid}.PL`;
      const fw = Math.ceil((d0 + 2 * bc.gussetEdge) / 5) * 5;
      res.members.push({
        id: fid, kind: 'plate', label: `פח מילוי PL${tg}×${fw}×${fw}`, start: add(X, scale(a, -fw / 2)), end: add(X, scale(a, fw / 2)), profile: `PL${fw}x${tg}`, material: mat,
        rollDeg: 0, mirror: false, anchor: 'center', refUp: n, source: 'generated', manualPlacement: false, connId: cid, partDesc: `פח מילוי PL${tg}×${fw}×${fw}`,
      });
      const head = add(X, scale(n, tg / 2 + t));
      const bo = makeBolt(`${cid}.B1`, cid, head, scale(n, -1), bc.bolt, 2 * t + tg, 'site', [l1.id, fid, l2.id], a, res.members);
      res.connections.push({ id: cid, type: 'brace-cross', label: `${label} — הצטלבות`, members: [l1.id, l2.id], parts: [fid, bo.id], bolts: [bo], welds: [], status: 'not-verified', fixity: 'pinned', overridden: false });
    }
  }
}
