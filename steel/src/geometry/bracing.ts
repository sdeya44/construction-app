import { add, cross, dot, norm, scale, sub, v3, type Vec3 } from '../core/vec';
import { getProfile, tryProfile } from '../profiles/library';
import type { BoltInfo, BraceConnParams, BracingParams, BuildingParams, Connection, Member, RodEndParams, ValidationIssue, WeldInfo } from '../model/types';
import { zAt, type SectionTopology } from '../model/section';
import { hw, makeBolt } from './connections';
import { defaultRhsTruss, rhsTruss } from './hbrace';
import { buildPortalLine, defaultPortal } from './portal';
import { buildLockTrussLine, defaultLockTruss } from './lockTruss';
import { localFrame } from './frame';
import { buildFlyBraces, buildLineTies, buildSagRods } from './roofExtras';
import { buildRafterStruts, defaultRafterStruts, strutCutsIn, strutLines, strutPlateHalf } from './rafterStruts';
import { bolt } from '../model/defaults';
import { BRACE_CROSS_GUSSET_RECIPE_ID, BRACE_CROSS_ROD_RECIPE_ID } from './crossRecipes';

/** פרט מוט הברגה (תוכנית 110): M18 L=250 מרותך בחפיפה 100, זוויתן דסקית L50/50/5 L=100, בורג הצטלבות M12 */
export function defaultRodEnd(): RodEndParams {
  return { d: 18, length: 250, overlap: 100, washer: 'L50x50x5', washerL: 100, slotExtra: 10, crossD: 12, weldSize: 4 };
}

export interface BracingResult { members: Member[]; connections: Connection[]; issues: ValidationIssue[]; segments?: { id: string; plane: string; x0: number; x1: number }[] }

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
export function buildBracing(b: BuildingParams, topo: SectionTopology, purlins: Member[], eff: BuildingParams, stockLen = 12000, profOf?: (id: string) => string | undefined, colTopOf?: (id: string) => number | undefined): BracingResult {
  const res: BracingResult = { members: [], connections: [], issues: [] };
  const br = b.bracing;
  const frames = b.frames;
  const nb = frames.length - 1;
  const mat = b.material;
  const raf = getProfile(b.rafterProfile), col = getProfile(b.columnProfile);
  const tw = raf.dims.tw ?? raf.dims.t ?? 6;
  // עובי ווב לפי החתך בפועל של הקורה (כולל חריג לקורה אחת) — פח החיבור מרותך לפני הווב
  const rtw = (id: string) => { const nm = profOf?.(id); const pr = nm ? tryProfile(nm) : null; return pr ? pr.dims.tw ?? pr.dims.t ?? tw : tw; };
  for (const [key, prof] of [['roof', br.roof.profile], ['walls', br.walls.profile], ['ties', br.purlinTies.profile]] as const) {
    if (!tryProfile(prof)) res.issues.push({ code: 'PROFILE', severity: 'error', message: `חתך קושרת לא מוכר (${key}): ${prof}` });
  }
  if (res.issues.length) return res;

  const bc = br.conn;
  const xbrace = (key: string, label: string, profile: string, plane0: Vec3, n: Vec3, wDir: Vec3,
    pA: { y: number; w: number }, pC: { y: number; w: number }, yFace0: number, yFace1: number, host0: string, host1: string) =>
    xBrace(res, b, bc, key, label, profile, plane0, n, wDir, pA, pC, yFace0, yFace1, host0, host1);

  /**
   * תמוכת קושרות גג: RHS לאורך השיפוע (במקביל לקורות) בגבול תת־מפתח, במישור הקושרות. תלויה מכל פטה שמעליה
   * בפח תלייה מרותך לפאה העליונה (מסגריה) ומוברג לווב הפטה (2×M12, שטח). הקושרות מתחברות אליה בפחי חיבור כמו לקורה.
   */
  const roofStrut = (id: string, label: string, profile: string, _sb: number, sh: number, o: Vec3, n: Vec3, dir: Vec3, L: number, y: number, plane: string, bay: number) => {
    const P = (w: number) => add(add(o, v3(0, y, 0)), scale(dir, w));
    res.members.push(mk(id, label, profile, P(0), P(L), n, mat, 'center'));
    const tp = 8, Wp = 80;
    for (const pm of purlins.filter((m) => m.purlin?.side === plane)) {
      const pp = getProfile(pm.profile);
      const Pp = v3(pm.start.x, y, pm.start.z);
      const w = dot(sub(Pp, P(0)), dir);
      if (w < 50 || w > L - 50) continue;
      const Q = P(w), gapN = dot(sub(Pp, Q), n) - sh / 2;
      if (gapN < 5) { if (!res.issues.some((i) => i.code === 'STRUT_CLASH')) res.issues.push({ code: 'STRUT_CLASH', severity: 'warning', elementId: id, message: `${label}: התמוכה גבוהה מדי — נוגעת בפטות (בחר חתך נמוך יותר)` }); continue; }
      const lf = localFrame(pm);
      const fl = pp.family === 'Z' ? scale(lf.u, -1) : lf.u;
      const back = Math.sign(dot(fl, dir)) || 1; // הצד ללא האגפים (גב הווב בפטת C)
      const off = scale(dir, -back * ((pp.dims.t ?? 2) / 2 + tp / 2));
      const cid = `C.${id}.P${pm.purlin!.index}`, pid = `${cid}.PL`;
      const top = add(add(Q, scale(n, sh / 2)), off), end = add(add(Pp, scale(n, 70)), off);
      res.members.push({ id: pid, kind: 'plate', label: `פח תלייה PL${tp}×${Wp}`, start: top, end, profile: `PL${Wp}x${tp}`, material: mat, rollDeg: 0, mirror: false, anchor: 'center', refUp: dir, source: 'generated', manualPlacement: false, connId: cid, partDesc: `פח תלייה לפטה PL${tp}×${Wp}×${Math.round(gapN + 70)}` });
      const bolts: BoltInfo[] = [-20, 20].map((dy, i) => {
        const at = add(add(Pp, v3(0, dy, 0)), scale(n, 40));
        const head = add(at, scale(dir, -back * ((pp.dims.t ?? 2) / 2 + tp)));
        return makeBolt(`${cid}.B${i + 1}`, cid, head, scale(dir, back), bolt(12), tp + (pp.dims.t ?? 2), 'site', [pid, pm.id], n, res.members);
      });
      const welds: WeldInfo[] = [{ id: `${cid}.W1`, connId: cid, type: 'fillet', a: 4, length: 2 * Wp, location: 'shop', between: [id, pid], from: add(top, v3(0, -Wp / 2, 0)), to: add(top, v3(0, Wp / 2, 0)) }];
      res.connections.push({ id: cid, type: 'brace', label: `${label} — תלייה לפטה ${pm.purlin!.index}`, members: [id, pm.id], parts: [pid, ...bolts.map((x) => x.id)], bolts, welds, status: 'not-verified', fixity: 'pinned', overridden: false });
    }
    void bay;
  };

  const skipTie = new Set<string>();
  // ---- תמוכות בין הקורות (1.40): נבנות תמיד כשהוגדרו; בקושרות הגג הן גבולות הפנלים
  const sLines = strutLines(b, topo);
  { const rs = buildRafterStruts(b, topo, profOf); res.members.push(...rs.members); res.connections.push(...rs.connections); res.issues.push(...rs.issues); }
  // ---- קושרות גג: במישור אמצע גובה קורת הגג, פח חיבור מרותך לווב הקורה בכל קצה
  if (br.roof.enabled) {
    const slopes: { side: string; pid: string; a: { x: number; z: number }; c: { x: number; z: number }; rid: (f: string) => string }[] = [];
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
        // קונזולה: עם toEave — עד קצה הגג (העמוד הקיצוני הופך לגבול קטע); אחרת מהעמוד הקיצוני
        if (!isJoined(e) && inside.length && !(br.roof.toEave && Math.abs(E.x - (toward > 0 ? inside[0] : inside[inside.length - 1])) > 1200)) return toward > 0 ? inside[0] : inside[inside.length - 1];
        // סבכת RHS בקצה שמחובר לצד עמוד שממשיך למעלה: צומת הסבכה (פח + לשוניות) רחב — מתרחקים גם בחצי עומק העמוד
        const side = topo.junctions.some((j) => j.plane === pl && j.kind === 'side' && j.end === e);
        // צד עמוד שממשיך מעל הגג: מרחק מפני העמוד (ניתן לשינוי) — אחרת הפח/המוט חודרים לעמוד
        if (side) { const jn = topo.junctions.find((j) => j.plane === pl && j.kind === 'side' && j.end === e)!; const ch = getProfile(profOf?.(`${frames[0].id}.COL.${jn.line.id}`) ?? b.columnProfile).props.h;
          return jn.line.x + toward * (ch / 2 + (br.roof.colClear ?? 150) + (br.roof.type === 'rhs' ? 40 : bc.gussetEdge)); }
        return E.x + toward * ridgeGap;
      };
      let xa = endX('a'), xc = endX('b');
      // עמוד יחיד מתחת למישור (סככת T / קונזולה): הקושרות עד קצות המישור
      if (Math.abs(xc - xa) < 1000) {
        const g = (e: 'a' | 'b') => { const E = pl[e]; return E.x + (E.x < (lo + hi) / 2 ? 1 : -1) * ridgeGap; };
        xa = g('a'); xc = g('b');
      }
      const x0 = Math.min(xa, xc), x1 = Math.max(xa, xc);
      // סבכת RHS: מישור שלם (המוטות מחברים קורות, לא עמודים) — פיצול בעמוד פנימי יוצר שתי סבכות עם צומת משותף מתנגש
      const st = br.roof.type === 'rhs' ? [x0, x1] : [x0, ...inside.filter((x) => x > x0 + 500 && x < x1 - 500), x1];
      // סדר מנקודה a לנקודה c (תאימות למזהים בגג הקלאסי)
      const ordered = xa <= xc ? st : [...st].reverse();
      const nseg = ordered.length - 1;
      // שני קטעים שנפגשים בציר פנימי: הקצוות מוזזים זה מזה (שני חורים/פחים זה ליד זה, מרווח sameGap)
      const half = (br.roof.sameGap ?? 200) / 2, dirO = Math.sign(ordered[nseg] - ordered[0]) || 1;
      for (let k = 0; k < nseg; k++) {
        const s0 = ordered[k] + (k > 0 ? dirO * half : 0), s1 = ordered[k + 1] - (k < nseg - 1 ? dirO * half : 0);
        slopes.push({ side: nseg > 1 ? `${pl.id}${k + 1}` : pl.id, pid: pl.id, a: { x: s0, z: zAt(pl, s0) }, c: { x: s1, z: zAt(pl, s1) }, rid: pl.rafterId });
      }
    }
    res.segments = slopes.map((q) => ({ id: q.side, plane: q.pid, x0: Math.min(q.a.x, q.c.x), x1: Math.max(q.a.x, q.c.x) }));
    const roofBays = resolveBays(br.roof.bays, nb);
    for (const bay of roofBays) {
      const f0 = frames[bay], f1 = frames[bay + 1];
      for (const sl of slopes) {
        if (br.roof.segOff?.includes(`${bay}|${sl.side}`)) continue;
        const dir = norm(v3(sl.c.x - sl.a.x, 0, sl.c.z - sl.a.z));
        const n = norm(v3(-dir.z * Math.sign(dir.x), 0, Math.abs(dir.x)));
        // מישור הקושרות: אמצע גובה הקורה (קו הייחוס הוא פני עליון). קורה רדודה: יורדים כך שהקושרת עוברת מתחת
        // לשורות הקשירה (זוויתן שתלוי מתחת לפטות) — אבל נשארים בתחום הווב לריתוך הפח
        const tieDrop = br.purlinTies.enabled ? (tryProfile(br.purlinTies.profile)?.props.h ?? 40) : 0;
        const brLeg = br.roof.type === 'rhs' ? (tryProfile(br.roof.rhs?.strut ?? '')?.props.h ?? 100) : (tryProfile(br.roof.profile)?.props.b ?? 50);
        const tfR = raf.dims.tf ?? 8;
        const need = tieDrop + 15 + brLeg, maxD = raf.props.h - tfR - brLeg / 2 - bc.gussetEdge - 3;
        // אין מקום לשניהם בקורה רדודה: הקושרת באמצע הגובה, ושורת הקשירה לא נבנית במפתח הזה (הקושרת מייצבת את הפטות)
        if (tieDrop && need > Math.max(raf.props.h / 2, maxD)) skipTie.add(`${bay}|${sl.pid}`);
        let depth = need > Math.max(raf.props.h / 2, maxD) ? raf.props.h / 2 : Math.max(raf.props.h / 2, Math.min(need, maxD));
        // מוט הברגה ושני מפתחים סמוכים עם קושרות: המוטות מגיעים לאותה נקודה משני צדי הווב — מישור הקושרות במפתחים
        // לסירוגין גבוה/נמוך, כך שהחורים יוצאים זה מעל זה (מרווח adjGap)
        const rodMode = (br.roof.endDetail ?? 'gusset') === 'rod' && br.roof.type !== 'rhs';
        if (rodMode && roofBays.some((x) => Math.abs(x - bay) === 1)) depth += (bay % 2 ? 1 : -1) * (br.roof.adjGap ?? 40) / 2;
        const o = add(v3(sl.a.x, 0, sl.a.z), scale(n, -depth));
        const L = Math.hypot(sl.c.x - sl.a.x, sl.c.z - sl.a.z);
        const rid = sl.rid;
        // מישור צר מדי לסבכה (זווית האלכסון למוט < ~30°): הלשוניות בצמתים חופפות — קושרות X במישור הזה
        const narrow = br.roof.type === 'rhs' && L / Math.max(1, Math.abs(f1.y - f0.y)) < 0.58 && (br.roof.rhs?.panels ?? 0) <= 1;
        if (narrow && !res.issues.some((i) => i.code === 'HB_NARROW' && i.elementId === sl.side)) res.issues.push({ code: 'HB_NARROW', severity: 'info', elementId: sl.side, message: `סבכה אופקית: מישור ${sl.side} צר (${(L / 1000).toFixed(2)} מ' לעומת מפתח ${(Math.abs(f1.y - f0.y) / 1000).toFixed(2)} מ') — ללא סבכה במישור זה (הצמתים היו מתנגשים); המישור נתמך דרך הסבכה במישור הסמוך` });
        if (narrow) continue;
        const sCuts = strutCutsIn(sLines, bay, sl.pid, sl.a, dir, L, 300);
        if (sCuts.length && br.roof.type === 'rhs' && !res.issues.some((i) => i.code === 'RS_RHS')) res.issues.push({ code: 'RS_RHS', severity: 'warning', message: `סבכה אופקית RHS מפתח ${bay + 1}: יש תמוכות בין הקורות בתוך הסבכה — הסבכה אינה מחולקת לפיהן; לבדוק התנגשות או לעבור לקושרות X` });
        if (br.roof.type === 'rhs') rhsTruss({ res, mat: b.material }, br.roof.rhs ?? defaultRhsTruss(), `R${bay + 1}.${sl.side}`, `סבכה אופקית מפתח ${bay + 1}`, o, n, dir, L,
          f0.y, f1.y, f0.y + rtw(rid(f0.id)) / 2, f1.y - rtw(rid(f1.id)) / 2, rid(f0.id), rid(f1.id));
        else {
          // מפתח ארוך בין מסגרות: חלוקה לאורך המבנה ל-nY תת־מפתחים עם תמוכת RHS רוחבית בכל גבול (תלויה מהפטות);
          // אוטומטי מעל 9 מ' (תת־מפתח עד ~6 מ'), או לפי בחירת המשתמש (ySplit לפי מפתח)
          const fullW = Math.abs(f1.y - f0.y), stock = stockLen;
          const nYu = br.roof.ySplit?.[String(bay)];
          const nY = Math.max(1, Math.min(6, Math.round(nYu ?? (fullW > 9000 ? Math.ceil(fullW / 6000) : 1))));
          const strutP = tryProfile(br.roof.strut ?? 'RHS100x100x5') ?? getProfile('RHS100x100x5');
          const strutName = tryProfile(br.roof.strut ?? '') ? br.roof.strut! : 'RHS100x100x5';
          const sb = strutP.props.b, sh = strutP.props.h;
          const sgn = Math.sign(f1.y - f0.y) || 1;
          const yB = Array.from({ length: nY + 1 }, (_, i) => f0.y + (f1.y - f0.y) * i / nY);
          const strutId = (i: number) => `BR.S${bay + 1}.${sl.side}.${i}`;
          for (let i = 1; i < nY; i++) roofStrut(strutId(i), `תמוכת קושרות גג מפתח ${bay + 1} (${i}/${nY - 1})`, strutName, sb, sh, o, n, dir, L, yB[i], sl.pid, bay);
          const bayW = fullW / nY;
          let k = 1;
          // אלכסון שלא נכנס בחומר הגלם גם בפנל צר מאוד: אין טעם לחלק עוד לאורך השיפוע (הרוחב לבדו ארוך מדי)
          if (bayW <= stock - 300) while (k < 8 && Math.hypot(L / k, bayW) > stock - 100) k++;
          else if (!res.issues.some((i) => i.code === 'BRACE_LONG' && i.elementId === `R${bay}`)) res.issues.push({ code: 'BRACE_LONG', severity: 'warning', elementId: `R${bay}`, message: `קושרות גג מפתח ${bay + 1}: רוחב תת־המפתח ${(bayW / 1000).toFixed(1)} מ' — האלכסון ארוך מחומר הגלם בכל חלוקה לאורך השיפוע; הגדל את מספר החלוקות לאורך המבנה` });
          // מספר X בקטע שנקבע ידנית (לא פחות מהנדרש לחומר הגלם)
          const kUser = br.roof.segCount?.[`${bay}|${sl.side}`];
          if (kUser && kUser > k) k = Math.min(8, Math.round(kUser));
          if (kUser && kUser < k && !res.issues.some((i) => i.code === 'X_COUNT' && i.elementId === `${bay}|${sl.side}`)) res.issues.push({ code: 'X_COUNT', severity: 'info', elementId: `${bay}|${sl.side}`, message: `קטע ${sl.side} מפתח ${bay + 1}: נדרשים לפחות ${k} פנלי X (אורך האלכסון מוגבל לחומר הגלם)` });
          if (sCuts.length && nY > 1 && !res.issues.some((i) => i.code === 'RS_YSPLIT' && i.elementId === `R${bay}`)) res.issues.push({ code: 'RS_YSPLIT', severity: 'warning', elementId: `R${bay}`, message: `קושרות גג מפתח ${bay + 1}: המפתח מחולק לאורך המבנה (תמוכות לאורך השיפוע) וגם יש תמוכות בין הקורות — הן חוצות זו את זו. לבטל את החלוקה לאורך המבנה במפתח הזה` });
          const gap = k > 1 ? (br.roof.sameGap ?? 200) / 2 : 0; // שני פנלים סמוכים: קצוות זה ליד זה (מרווח sameGap)
          const rod = (br.roof.endDetail ?? 'gusset') === 'rod' && getProfile(br.roof.profile).family === 'L';
          if ((br.roof.endDetail ?? 'gusset') === 'rod' && !rod && !res.issues.some((i) => i.code === 'ROD_PROFILE')) res.issues.push({ code: 'ROD_PROFILE', severity: 'warning', message: `פרט מוט הברגה דורש זוויתן (החתך ${br.roof.profile}) — נבנה פרט פח חיבור` });
          // גבולות הפנלים: שווים, או על הפטה הקרובה לכל גבול (צמתי X בפטות) — בתנאי שהאלכסון עדיין באורך חומר הגלם
          const cuts = Array.from({ length: k + 1 }, (_, j) => (L * j) / k);
          if (br.roof.split === 'purlins' && k > 1) {
            const ws = purlins.filter((m) => m.purlin?.side === sl.pid).map((m) => (m.start.x - sl.a.x) * dir.x + (m.start.z - sl.a.z) * dir.z).filter((w) => w > 300 && w < L - 300).sort((p, q) => p - q);
            const trial = [...cuts];
            for (let j = 1; j < k; j++) { const near = ws.filter((w) => w > trial[j - 1] + 500).sort((p, q) => Math.abs(p - cuts[j]) - Math.abs(q - cuts[j]))[0]; if (near !== undefined) trial[j] = near; }
            const ok = trial.every((w, j) => j === 0 || (w > trial[j - 1] + 500 && Math.hypot(w - trial[j - 1], bayW) <= stock - 100));
            if (ok) cuts.splice(0, cuts.length, ...trial);
            else if (!res.issues.some((i) => i.code === 'X_SNAP' && i.elementId === `${bay}|${sl.side}`)) res.issues.push({ code: 'X_SNAP', severity: 'info', elementId: `${bay}|${sl.side}`, message: `קטע ${sl.side} מפתח ${bay + 1}: לא ניתן להעמיד את צמתי ה-X על פטות (אורך חומר הגלם / מרווח) — פנלים שווים` });
          }
          // פנלים לאורך השיפוע [w0, w1]: לפי החלוקה (k), או — כשיש תמוכות בין הקורות — לפי התמוכות: האלכסונים מגיעים
          // עד לפני פלטת התמוכה, וחלוקה אחרת מבוטלת (אחרת צומת X נופל על התמוכה)
          let panels: [number, number][] = Array.from({ length: k }, (_, j) => [cuts[j] + (j > 0 ? gap : 0), cuts[j + 1] - (j < k - 1 ? gap : 0)]);
          if (sCuts.length) {
            const rsP = br.rafterStruts ?? defaultRafterStruts();
            if ((kUser && kUser > 1) || k > 1 || (br.roof.split === 'purlins' && k > 1)) {
              if (!res.issues.some((i) => i.code === 'X_STRUT' && i.elementId === `${bay}|${sl.side}`)) res.issues.push({ code: 'X_STRUT', severity: 'warning', elementId: `${bay}|${sl.side}`, message: `קטע ${sl.side} מפתח ${bay + 1}: יש תמוכות בין הקורות — החלוקה ל-${k} פנלי X בוטלה כדי שלא תהיה התנגשות; הפנלים נקבעים לפי התמוכות` });
            }
            const B = [{ w: 0, h: 0 }, ...sCuts.map((c) => ({ w: c.w, h: strutPlateHalf(rsP, c.profile, c.detail) + bc.gussetEdge + 20 })), { w: L, h: 0 }];
            panels = [];
            for (let j = 0; j < B.length - 1; j++) {
              const a0 = B[j].w + B[j].h, a1 = B[j + 1].w - B[j + 1].h;
              if (a1 - a0 < 600) { res.issues.push({ code: 'X_STRUT_SHORT', severity: 'warning', elementId: `${bay}|${sl.side}`, message: `קטע ${sl.side} מפתח ${bay + 1}: פנל בין תמוכות קצר מדי (${Math.round(a1 - a0)} מ"מ) — ללא X בפנל` }); continue; }
              // פנל בין תמוכות שעדיין ארוך מחומר הגלם: חלוקה שווה בתוכו
              let kk = 1;
              if (bayW <= stock - 300) while (kk < 6 && Math.hypot((a1 - a0) / kk, bayW) > stock - 100) kk++;
              const g2 = kk > 1 ? (br.roof.sameGap ?? 200) / 2 : 0;
              for (let i = 0; i < kk; i++) panels.push([a0 + ((a1 - a0) * i) / kk + (i > 0 ? g2 : 0), a0 + ((a1 - a0) * (i + 1)) / kk - (i < kk - 1 ? g2 : 0)]);
            }
          }
          const np = panels.length;
          for (let q = 0; q < nY; q++) {
            const ya = yB[q], yb = yB[q + 1];
            const h0 = q === 0 ? rid(f0.id) : strutId(q), h1 = q === nY - 1 ? rid(f1.id) : strutId(q + 1);
            const face0 = q === 0 ? f0.y + sgn * rtw(rid(f0.id)) / 2 : ya + sgn * sb / 2, face1 = q === nY - 1 ? f1.y - sgn * rtw(rid(f1.id)) / 2 : yb - sgn * sb / 2;
            const sub = nY > 1 ? `.Y${q + 1}` : '', subL = nY > 1 ? ` תת־מפתח ${q + 1}/${nY}` : '';
            for (let j = 0; j < np; j++) {
              const [w0, w1] = panels[j];
              const key = `R${bay + 1}.${sl.side}${sub}${np > 1 ? `.${j + 1}` : ''}`, lab = `קושרת גג מפתח ${bay + 1}${subL}${np > 1 ? ` פנל ${j + 1}` : ''}`;
              if (rod && nY === 1) {
                xBraceRod(res, b, br.roof.rod ?? defaultRodEnd(), bc.crossBolt, key, lab, br.roof.profile, o, n, dir,
                  { y: f0.y, w: w0 }, { y: f1.y, w: w1 }, rtw(rid(f0.id)), rtw(rid(f1.id)), rid(f0.id), rid(f1.id));
                continue;
              }
              xbrace(key, lab, br.roof.profile, o, n, dir, { y: ya, w: w0 }, { y: yb, w: w1 }, face0, face1, h0, h1);
            }
          }
          if (rod && nY > 1 && !res.issues.some((i) => i.code === 'ROD_SPLIT')) res.issues.push({ code: 'ROD_SPLIT', severity: 'info', message: 'מפתח מחולק לאורך המבנה: בתת־המפתחים נבנה פרט פח חיבור (מוט הברגה דרך חור אובלי — רק בווב קורה)' });
        }
      }
    }
  }

  // ---- קושרות קיר: במישור ציר העמודים, פח חיבור מרותך לווב העמוד בכל קצה
  if (br.walls.enabled) {
    const ctw = col.dims.tw ?? col.dims.t ?? 6;
    // עובי הווב של העמוד בפועל (חתך שהוחלף לעמוד מסוים)
    // עמוד חלול (RHS/SHS): פני ההלחמה הם הדופן החיצונית (רוחב מלא), לא עובי הדופן
    const twOf = (id: string) => { const n = profOf?.(id); const pr = (n ? tryProfile(n) : null) ?? col; return pr.family === 'RHS' || pr.family === 'SHS' ? pr.props.b : pr.dims.tw ?? pr.dims.t ?? ctw; };
    const ls = [...topo.sec.lines].sort((p, q) => p.x - q.x);
    for (const [lid, bays] of wallBays(b.bracing, ls.map((l) => l.id))) {
      const l = ls.find((q) => q.id === lid)!;
      if (l.wall) continue;
      const ct = topo.colTop.get(l.id);
      if (!ct) continue;
      const cap = ct.cap ?? topo.junctions.find((j) => j.line === l)?.plane;
      const sl = cap ? Math.abs((cap.b.z - cap.a.z) / (cap.b.x - cap.a.x)) : 0;
      const rafV = raf.props.h * Math.sqrt(1 + sl * sl);
      const side = l.id;
      const x = l.x, eave = ct.z;
      const lType = br.walls.lineType?.[l.id] ?? br.walls.type ?? 'x';
      if (lType === 'truss') {
        buildLockTrussLine(res, { ...(br.walls.truss ?? defaultLockTruss()), ...(br.walls.lineTruss?.[l.id] ?? {}) }, {
          side, label: l.label, x, frames: frames.map((f) => ({ id: f.id, y: f.y })), portalBays: resolveBays(bays, nb),
          colProfile: profOf?.(`${frames[0].id}.COL.${l.id}`) ?? b.columnProfile, zBase: b.lineBase?.[l.id] ?? b.baseElevation, zTop: eave - rafV - 60, mat,
        });
        continue;
      }
      if (lType === 'portal') {
        buildPortalLine(res, { ...(br.walls.portal ?? defaultPortal()), ...(br.walls.linePortal?.[l.id] ?? {}) }, {
          side, label: l.label, x, frames: frames.map((f) => ({ id: f.id, y: f.y })), portalBays: resolveBays(bays, nb),
          colProfile: b.columnProfile, zBase: b.lineBase?.[l.id] ?? b.baseElevation, zTop: eave - rafV - 60, mat,
        });
        continue;
      }
      for (const bay of resolveBays(bays, nb)) {
        const f0 = frames[bay], f1 = frames[bay + 1];
        // עמוד מקוצר (קורה נושאת על ראשו): הקושרת מתחת לראש העמוד בפועל
        const cTop = Math.min(...[f0, f1].map((f) => colTopOf?.(`${f.id}.COL.${l.id}`) ?? Infinity));
        const z0 = (b.lineBase?.[l.id] ?? b.baseElevation) + 300, z1 = Math.min(eave - rafV - 60 - 150, cTop - 60 - 150);
        if (z1 - z0 < 1000) { res.issues.push({ code: 'BRACE_SHORT', severity: 'warning', message: `קושרת קיר ציר ${l.label} מפתח ${bay + 1}: גובה קטן מדי` }); continue; }
        // עמוד גבוה: האלכסון ארוך מחומר הגלם — חלוקה לכמה פנלי X לגובה (כמו בגג)
        const H = z1 - z0, bayW = Math.abs(f1.y - f0.y);
        let k = 1;
        if (bayW <= stockLen - 300) while (k < 6 && Math.hypot(H / k, bayW) > stockLen - 100) k++;
        else if (!res.issues.some((i) => i.code === 'BRACE_LONG' && i.elementId === `W${l.id}${bay}`)) res.issues.push({ code: 'BRACE_LONG', severity: 'warning', elementId: `W${l.id}${bay}`, message: `קושרת קיר ציר ${l.label} מפתח ${bay + 1}: המפתח (${(bayW / 1000).toFixed(1)} מ') ארוך מחומר הגלם — חלוקה לגובה לא תעזור. מומלץ אגד B / נעילה אופקית בציר הזה, או חיבור המשך באלכסון` });
        const gap = k > 1 ? bc.gussetEdge + 120 : 0;
        for (let j = 0; j < k; j++) {
          const w0 = (H * j) / k + (j > 0 ? gap : 0), w1 = (H * (j + 1)) / k - (j < k - 1 ? gap : 0);
          xbrace(`W${bay + 1}.${side}${k > 1 ? `.${j + 1}` : ''}`, `קושרת קיר ציר ${l.label} מפתח ${bay + 1}${k > 1 ? ` פנל ${j + 1}` : ''}`, br.walls.profile, v3(x, 0, z0), v3(1, 0, 0), v3(0, 0, 1),
            { y: f0.y, w: w0 }, { y: f1.y, w: w1 }, f0.y + twOf(`${f0.id}.COL.${l.id}`) / 2, f1.y - twOf(`${f1.id}.COL.${l.id}`) / 2, `${f0.id}.COL.${l.id}`, `${f1.id}.COL.${l.id}`);
        }
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
      // ליד רכס — הארכה קצרה, כדי שלא תיגע בשורת הקשירה של השיפוע השני
      const nearRidge = (q: Vec3) => topo.ridges.some((r) => Math.abs(r.x - q.x) < 600);
      const a0 = sub(v3(first.start.x, 0, first.start.z), scale(dir, nearRidge(first.start) ? 20 : 60));
      const a1 = add(v3(last.start.x, 0, last.start.z), scale(dir, nearRidge(last.start) ? 20 : 60));
      const tieProf = getProfile(br.purlinTies.profile);
      const tieT = tieProf.dims.t ?? 4;
      for (let bay = 0; bay < nb; bay++) {
        if (skipTie.has(`${bay}|${side}`)) { if (!res.issues.some((i) => i.code === 'TIE_SKIP')) res.issues.push({ code: 'TIE_SKIP', severity: 'info', message: 'שורות קשירה לפטות: במפתחים עם קושרות גג ובקורה רדודה אין מקום לשניהם — שורת הקשירה לא נבנתה במפתחים האלה (הקושרת מייצבת את הפטות)' }); continue; }
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
  // ---- מוטות תלייה, תמיכה צידית לפטות, סיב רציף בשורת עמודים (1.41)
  {
    // תמיכה צידית: דילוג ליד תמוכה בין הקורות ולידי פחי קושרות הגג על ווב הקורה (מניעת התנגשות)
    const plates = res.members.filter((m) => m.kind === 'plate' && /^C\.(BR\.R|RS\d)/.test(m.connId ?? '')).map((m) => ({ x: (m.start.x + m.end.x) / 2, y: (m.start.y + m.end.y) / 2, r: Math.hypot(m.end.x - m.start.x, m.end.y - m.start.y) / 2 }));
    const avoid = (x: number, y: number) => plates.some((q) => Math.abs(q.x - x) < q.r + 120 && Math.abs(q.y - y) < 500);
    for (const part of [buildSagRods(b, topo, purlins), buildFlyBraces(b, topo, purlins, profOf, avoid, res.members.filter((m) => (m.kind === 'brace' || m.kind === 'plate' || m.kind === 'beam') && /^(C\.)?(BR\.R|RS\d|HB\.)/.test(m.connId ?? m.id))), buildLineTies(b, topo, profOf)]) {
      res.members.push(...part.members); res.connections.push(...part.connections); res.issues.push(...part.issues);
    }
  }
  void eff;
  return res;
}

/** מתכון הצטלבות (G9): אתר עוגן על הזוויתן הראשון בנקודת הבורג; `a` = נורמל מישור הקושרות, `up` = ניצב לזוויתן במישור (כיוון הפלטה), `bu` = כיוון הזוויתן (ראש הבורג) */
function crossRecipe(id: string, cid: string, l1: string, l2: string, P: Vec3, n: Vec3, ex1: Vec3, params: Record<string, number>): Pick<Connection, 'recipe'> {
  const key = `${l1}|p:X`, up = cross(ex1, n);
  return { recipe: { id, own: true, params, sites: [key], anchors: { [key]: { conn: cid, P: [P.x, P.y, P.z], a: [n.x, n.y, n.z], up: [up.x, up.y, up.z], bu: [ex1.x, ex1.y, ex1.z], partner: l2 } } } };
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
      // מתכון מובנה (G9, שלב D): אתר עוגן `זוויתן1|p:X` בנקודת הבורג; בורג 8.8 ISO 4017. אחרת — הקוד הישן
      const crossRcp = bc.engine === 'recipe' && bc.bolt.grade === '8.8' && bc.bolt.standard === 'ISO 4017'
        ? crossRecipe(BRACE_CROSS_GUSSET_RECIPE_ID, cid, l1.id, l2.id, X, n, a, { tg, fw, d: bc.bolt.d, cl: bc.bolt.clearance, t }) : {};
      res.connections.push({ id: cid, type: 'brace-cross', label: `${label} — הצטלבות`, members: [l1.id, l2.id], parts: [fid, bo.id], bolts: [bo], welds: [], status: 'not-verified', fixity: 'pinned', overridden: false, ...crossRcp });
    }
  }
}

/**
 * קושרת X בפרט "מוט הברגה" (פרט הלקוח, תוכנית 110 — פרט A וחתך A-A):
 *  · זוויתן (L50/50/4) מקוצר; בכל קצה מוט הברגה (M18 L=250) מרותך בפינת הזוויתן בחפיפה (100) — מסגריה;
 *  · המוט עובר דרך חור אובלי בווב הקורה (האלכסון אינו ניצב לווב);
 *  · בצד השני של הווב זוויתן קצר (L50/50/5 L=100) שהעקב שלו צמוד לווב — רגל אחת כמעט ניצבת למוט (התאמת זווית) — ואום;
 *  · בהצטלבות: שני הזוויתנים גב אל גב (רגל שטוחה על רגל שטוחה), בורג אחד (M12).
 * קווי העבודה: מרכזי הווב של שתי הקורות. גיאומטריה בלבד — ללא בדיקת חוזק.
 */
function xBraceRod(res: BracingResult, b: BuildingParams, rp: RodEndParams, crossBolt: boolean, key: string, label: string, profile: string,
  plane0: Vec3, n: Vec3, wDir: Vec3, pA: { y: number; w: number }, pC: { y: number; w: number }, tw0: number, tw1: number, host0: string, host1: string) {
  const mat = b.material;
  const prof = getProfile(profile);
  const t = prof.dims.t ?? 4, leg = prof.props.b;
  const off = t + rp.d / 2; // ציר המוט מעקב הזוויתן (בפינה הפנימית)
  const wp = getProfile(rp.washer);
  const wt = wp.dims.t ?? 5, wleg = wp.props.b;
  const h = hw(rp.d);
  const P = (y: number, w: number) => add(add(plane0, v3(0, y, 0)), scale(wDir, w));
  const spec = { d: rp.d, grade: '4.6', standard: 'ROD', clearance: 2 };
  const diag = [
    { k: 1, s: { y: pA.y, w: pA.w }, e: { y: pC.y, w: pC.w }, sg: 1 },
    { k: 2, s: { y: pC.y, w: pA.w }, e: { y: pA.y, w: pC.w }, sg: -1 },
  ];
  const lines: { id: string; X0: Vec3; ex: Vec3; lat: Vec3 }[] = [];
  for (const dg of diag) {
    const id = `BR.${key}.${dg.k}`;
    const S0 = P(dg.s.y, dg.s.w), E0 = P(dg.e.y, dg.e.w);
    const ex = norm(sub(E0, S0));
    const up = scale(n, dg.sg);
    const lat = norm(cross(up, ex));
    const o = scale(up, off);
    const ends: { tip: Vec3; inner: Vec3 }[] = [];
    const conns: Connection[] = [];
    for (const [ek, W0, sgn, host, tw] of [['S', S0, -1, dg.s.y === pA.y ? host0 : host1, dg.s.y === pA.y ? tw0 : tw1], ['E', E0, 1, dg.e.y === pA.y ? host0 : host1, dg.e.y === pA.y ? tw0 : tw1]] as const) {
      const W = add(W0, o);
      const r = scale(ex, sgn); // מהזוויתן החוצה, דרך הווב
      const fN = v3(0, Math.sign(r.y) || 1, 0);
      const rN = Math.abs(r.y), rW = dot(r, wDir);
      const Pw = add(W, scale(r, (tw / 2) / Math.max(rN, 0.2)));
      // זוויתן דסקית (בקשת משתמש 18.11.2026): שתי הרגליים צמודות לווב (קצות הרגליים על הפנים), העקב בולט החוצה;
      // המוט חודר את הרגל שכמעט ניצבת לו, והאום על הפנים החיצוניות שלה
      const sig = Math.sign(rW) || 1;
      const eLeg = norm(add(scale(fN, -1), scale(wDir, sig))), eLeg2 = norm(sub(scale(fN, -1), scale(wDir, sig)));
      const hd = wleg / Math.SQRT2; // מרחק העקב מפני הווב
      const lam = wleg / (2 * Math.SQRT2 * Math.max(rN, 0.2));
      const hw = lam * rW - (sig * wleg) / (2 * Math.SQRT2);
      const H = add(add(add(Pw, scale(fN, hd)), scale(wDir, hw)), scale(up, -off)); // העקב (פינה חיצונית) — במישור הקושרות
      const pierce = add(add(H, scale(up, off)), scale(eLeg, wleg / 2));
      void wt;
      const nutS = pierce;
      const tip = add(nutS, scale(r, h.m + 8));
      const inner = add(tip, scale(r, -rp.length));
      ends.push({ tip, inner });
      const cid = `C.BR.${key}.${dg.k}${ek}`;
      const rodId = `${cid}.ROD`, wId = `${cid}.WA`, nutId = `${cid}.N`;
      res.members.push({
        id: rodId, kind: 'brace', label: `מוט הברגה M${rp.d} L=${rp.length}`, start: tip, end: inner, profile: `RD${rp.d}`, material: mat, rollDeg: 0, mirror: false, anchor: 'center', refUp: up,
        source: 'generated', manualPlacement: false, connId: cid, partDesc: `מוט הברגה M${rp.d} L=${rp.length} (מרותך לזוויתן בחפיפה ${rp.overlap})`,
      });
      const wm: Member = {
        id: wId, kind: 'brace', label: `זוויתן דסקית ${wp.name} L=${rp.washerL}`, start: add(add(H, scale(up, off)), scale(n, -rp.washerL / 2)), end: add(add(H, scale(up, off)), scale(n, rp.washerL / 2)),
        profile: rp.washer, material: mat, rollDeg: 0, mirror: false, anchor: 'corner', refUp: eLeg2, source: 'generated', manualPlacement: false, connId: cid,
        partDesc: `זוויתן דסקית ${wp.name} L=${rp.washerL} — חור Ø${rp.d + 2} (התאמת זווית)`,
      };
      if (dot(localFrame(wm).u, eLeg) < 0) wm.mirror = true;
      res.members.push(wm);
      res.members.push({
        id: nutId, kind: 'bolt', label: `אום M${rp.d}`, start: nutS, end: add(nutS, scale(r, h.m)), profile: `HX${h.s}`, material: 'S235', rollDeg: 0, mirror: false, anchor: 'center', refUp: up,
        source: 'generated', manualPlacement: false, connId: cid, partDesc: `אום M${rp.d}`,
      });
      const hole = rp.d + 2;
      const tanb = Math.sqrt(Math.max(0, 1 - rN * rN)) / Math.max(rN, 0.2);
      const slot = Math.ceil((hole / Math.max(rN, 0.2) + tw * tanb + rp.slotExtra) / 5) * 5;
      const bi: BoltInfo = { id: `${cid}.R`, connId: cid, p: W, axis: r, d: rp.d, hole, grade: spec.grade, standard: spec.standard, grip: tw + wt, length: rp.length, location: 'site', holesIn: [host, wId], slots: { [host]: slot }, rod: true };
      conns.push({
        id: cid, type: 'brace-end', label: `${label} — מוט הברגה ${ek === 'S' ? 'התחלה' : 'סוף'} אלכסון ${dg.k} (חור אובלי ${hole}×${slot} בווב)`,
        members: [host, id], parts: [rodId, wId, nutId], bolts: [bi],
        welds: [{ id: `${cid}.W1`, connId: cid, type: 'fillet', a: rp.weldSize, length: 2 * rp.overlap, location: 'shop', between: [id, rodId], from: inner, to: add(inner, scale(r, -rp.overlap)) }],
        status: 'not-verified', fixity: 'pinned', overridden: false,
      });
    }
    // הזוויתן: מקצה החפיפה בקצה אחד לקצה החפיפה בשני; העקב במישור, הרגל השטוחה לכיוון lat
    const a0 = add(ends[0].inner, scale(ex, -rp.overlap)), a1 = add(ends[1].inner, scale(ex, rp.overlap));
    const heel = (q: Vec3) => add(sub(q, o), scale(lat, -off));
    const len = Math.hypot(a1.x - a0.x, a1.y - a0.y, a1.z - a0.z);
    if (dot(sub(a1, a0), ex) < 300) { res.issues.push({ code: 'BRACE_SHORT', severity: 'warning', message: `${label}: מפתח קצר מדי לקושרת עם מוטות הברגה` }); for (const c of conns) res.members = res.members.filter((m) => !c.parts.includes(m.id)); return; }
    const work = Math.hypot(E0.x - S0.x, E0.y - S0.y, E0.z - S0.z);
    res.members.push({
      id, kind: 'brace', label, start: heel(a0), end: heel(a1), profile, material: mat, rollDeg: 0, mirror: false, anchor: 'corner', refUp: up,
      source: 'generated', manualPlacement: false, partDesc: `${label} ${profile} (קצר ב-${Math.round(work - len)} מקו העבודה, מוטות הברגה בקצוות)`,
    });
    res.connections.push(...conns);
    lines.push({ id, X0: S0, ex, lat });
  }
  if (crossBolt && lines.length === 2) {
    const [l1, l2] = lines;
    const a = l1.ex, c = l2.ex, rr = sub(l2.X0, l1.X0);
    const aa = dot(a, a), ac = dot(a, c), cc = dot(c, c), ar = dot(a, rr), cr = dot(c, rr);
    const den = aa * cc - ac * ac;
    if (Math.abs(den) > 1e-9) {
      const X = add(l1.X0, scale(a, (ar * cc - ac * cr) / den));
      const sOff = leg / 2 - off; // חור באמצע הרגל השטוחה של שני הזוויתנים
      const cl = dot(l1.lat, l2.lat);
      const Q = add(X, scale(add(l1.lat, l2.lat), sOff / (1 + cl)));
      const cid = `C.BR.${key}.X`;
      const bo = makeBolt(`${cid}.B1`, cid, add(Q, scale(n, t)), scale(n, -1), { d: rp.crossD, grade: '8.8', standard: 'ISO 4017', clearance: 2 }, 2 * t, 'site', [l1.id, l2.id], a, res.members);
      const crossRcp = rp.engine === 'recipe' ? crossRecipe(BRACE_CROSS_ROD_RECIPE_ID, cid, l1.id, l2.id, Q, n, a, { d: rp.crossD, cl: 2, t }) : {};
      res.connections.push({ id: cid, type: 'brace-cross', label: `${label} — הצטלבות (גב אל גב, בורג M${rp.crossD})`, members: [l1.id, l2.id], parts: [bo.id], bolts: [bo], welds: [], status: 'not-verified', fixity: 'pinned', overridden: false, ...crossRcp });
    }
  }
}
