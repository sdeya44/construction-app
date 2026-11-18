/**
 * דילול עמודים וקורות נושאות (החלטות משתמש 16.11.2026):
 *  · המשתמש מסמן עמודים להסרה; לכל רצף עמודים מוסרים בשורה — קורה נושאת (TB) בין העמודים שנותרו.
 *  · תמיכה בעמוד: A1 על ראש העמוד (העמוד מתקצר) · A2 פלטת קצה לווב העמוד · A3 פלטת סנפיר · A4 זוויתני ווב · A5 תושבת.
 *  · קורת הגג על ה-TB: B1 כיסא משופע + 2 פלטות + 4 ברגים · B2 טריז ישירות לאגף · B3 עמוד קצר · B4 חיבור צד לווב ה-TB.
 *  · ריתוך במסגריה בלבד, ברגים בשטח. גיאומטריה בלבד — אין בדיקת חוזק; היציבות לרוחב של מסגרות ללא עמוד — באחריות המהנדס.
 */
import { add, norm, scale, sub, v3, type Plane, type Vec3 } from '../core/vec';
import { getProfile, tryProfile } from '../profiles/library';
import type { BoltInfo, BuildingParams, Connection, FrameDef, Member, Project, TransferDef, ValidationIssue, WeldInfo } from '../model/types';
import type { NLine, NSection } from '../model/section';
import { buildTrussPlane, trussNodes } from './truss';
import { makeBolt } from './connections';

const Z = v3(0, 0, 1), X = v3(1, 0, 0), Y = v3(0, 1, 0);
const BOLT = { d: 20, grade: '8.8', standard: 'ISO 4017', clearance: 2 };
export const SUPPORT_HE: Record<TransferDef['support'], string> = { A1: 'על ראש העמוד', A2: 'פלטת קצה לעמוד', A3: 'פלטת סנפיר', A4: 'זוויתני ווב כפולים', A5: 'תושבת מושב' };
export const SEAT_HE: Record<TransferDef['seat'], string> = { B1: 'כיסא משופע + 2 פלטות', B2: 'טריז ישירות לאגף', B3: 'עמוד קצר', B4: 'חיבור צד לווב' };

export interface TbPlan {
  def: TransferDef; line: NLine; frames: FrameDef[]; supported: FrameDef[];
  zTop: number; seat: TransferDef['seat']; side: boolean;
  colFrom: string; colTo: string;
}

/** מרווח מציר העמוד לקצה הקורה/המסבך הנושא בתמיכה בצד העמוד (cb = רוחב אגף העמוד) */
export function tbEndGap(support: TransferDef['support'], cb: number): number {
  return support === 'A2' ? cb / 2 + 15 + 15 : support === 'A3' ? cb / 2 + 15 : support === 'A4' ? cb / 2 + 15 + 15 : cb / 2 + 15 + 12;
}

const sortFrames = (b: BuildingParams) => [...b.frames].sort((a, c) => a.y - c.y);
const colId = (frameId: string, lineId: string) => `${frameId}.COL.${lineId}`;

/** רפרפים של מסגרת שחולפים מעל x; גובה תחתית הקורה ב-x (בניצב למישור, מומר לאנכי) */
function raftersAt(members: Member[], frameId: string, x: number) {
  return members.filter((m) => m.kind === 'rafter' && m.frameId === frameId && Math.min(m.start.x, m.end.x) - 1 <= x && Math.max(m.start.x, m.end.x) + 1 >= x);
}
function rafterGeom(r: Member) {
  const h = tryProfile(r.profile)?.props.h ?? 300;
  const dx = r.end.x - r.start.x, dz = r.end.z - r.start.z;
  const cos = Math.abs(dx) / Math.hypot(dx, dz) || 1;
  const off = (r.anchor === 'top' ? h : h / 2) / cos;
  const zLine = (x: number) => r.start.z + (dz * (x - r.start.x)) / (dx || 1);
  const under = (x: number) => zLine(x) - off;
  const top = (x: number) => zLine(x) + (r.anchor === 'top' ? 0 : h / 2 / cos);
  // מישור התחתית: נורמל כלפי מעלה בניצב לציר הקורה
  let n = norm(v3(-dz, 0, dx)); if (n.z < 0) n = scale(n, -1);
  const plane = (x: number, y: number): Plane => ({ point: v3(x, y, under(x)), normal: n });
  return { h, b: tryProfile(r.profile)?.props.b ?? 150, under, top, plane, cos, slope: dz / (dx || 1) };
}

const isBox = (p: { family: string } | null | undefined) => !!p && (p.family === 'RHS' || p.family === 'SHS');

/** תכנון: אימות, עמודים מוסרים (נכנסים ל-deleted), מפלס ה-TB וקיצור עמודים ב-A1 */
export function prepareTransfers(project: Project, b: BuildingParams, sec: NSection, members: Member[], deleted: Set<string>, issues: ValidationIssue[]): TbPlan[] {
  const out: TbPlan[] = [];
  const fr = sortFrames(b);
  for (let def of b.transfers ?? []) {
    const line = sec.lines.find((l) => l.id === def.lineId);
    const i0 = fr.findIndex((f) => f.id === def.from), i1 = fr.findIndex((f) => f.id === def.to);
    if (!line || i0 < 0 || i1 < 0 || i1 - i0 < 2) { issues.push({ code: 'TB_INVALID', severity: 'error', message: `קורה נושאת ${def.id}: שורה או מסגרות תמיכה לא קיימות` }); continue; }
    const frames = fr.slice(i0, i1 + 1);
    const removed = frames.slice(1, -1).filter((f) => def.removed.includes(f.id));
    if (!removed.length) continue;
    const isTruss = def.kind === 'truss' && !!def.truss;
    const between = isTruss && def.trussFit === 'between';
    if (isTruss && !between && def.support !== 'A1') issues.push({ code: 'TB_TRUSS', severity: 'info', message: `מסבך נושא ${def.id}: נתמך על ראש העמוד (A1) — הגדרת התמיכה בצד הוחלפה` });
    if (isTruss) {
      const hollowTop = isBox(tryProfile(def.truss!.profiles.top));
      // חגורה עליונה חלולה: אין גישה לאום בתוך הצינור — מושב B2 (ברגים דרך האגף) מוחלף ב-B1 (פלטה מרותכת)
      if (hollowTop && def.seat === 'B2') issues.push({ code: 'TB_SEAT', severity: 'info', message: `מסבך נושא ${def.id}: חגורה עליונה חלולה — "${SEAT_HE.B2}" הוחלף ב"${SEAT_HE.B1}" (פלטה מרותכת על הצינור)` });
      // בין העמודים: העמודים ממשיכים עד קורת הגג, החגורות מחוברות לצד העמוד (פלטת קצה גבוהה לפלטת סגירה — כמו A2)
      def = { ...def, support: between ? 'A2' : 'A1', seat: def.seat === 'B4' || (hollowTop && def.seat === 'B2') ? 'B1' : def.seat, profile: def.truss!.profiles.top };
    }
    const prof = tryProfile(def.profile);
    if (!prof) { issues.push({ code: 'PROFILE', severity: 'error', message: `קורה נושאת ${def.id}: חתך לא מוכר ${def.profile}` }); continue; }
    const pBot = isTruss ? tryProfile(def.truss!.profiles.bottom) : null;
    if (isTruss && !pBot) { issues.push({ code: 'PROFILE', severity: 'error', message: `מסבך נושא ${def.id}: חתך חגורה תחתונה לא מוכר` }); continue; }
    // גובה כולל מתחת לפני העליון: קורה — h; מסבך — חצי חגורה עליונה + גובה צירים + חצי חגורה תחתונה
    // חגורה תחתונה חלולה: + פלטת תמיכה מרותכת מתחתיה (20)
    const hTot = isTruss ? prof.props.h / 2 + def.truss!.depth + pBot!.props.h / 2 + (isBox(pBot) ? 20 : 0) : prof.props.h;
    for (const f of removed) deleted.add(colId(f.id, line.id));
    const side = def.support !== 'A1';
    let seat = def.seat;
    const supported = side ? removed : frames;
    // B3/B4 דורשים קורת גג יחידה שמסתיימת בשורה (לא רכס/רציפה) — אחרת B1
    const ends = supported.every((f) => { const rs = raftersAt(members, f.id, line.x); return rs.length === 1 && Math.min(Math.abs(rs[0].start.x - line.x), Math.abs(rs[0].end.x - line.x)) < 900; });
    if ((seat === 'B4' || seat === 'B3') && !ends) { issues.push({ code: 'TB_SEAT', severity: 'warning', message: `קורה נושאת ${def.id}: ${SEAT_HE[seat]} מתאים רק לקצה קורת גג — הוחלף ב"${SEAT_HE.B1}"` }); seat = 'B1'; }
    if (seat === 'B4' && side) { issues.push({ code: 'TB_SEAT', severity: 'warning', message: `קורה נושאת ${def.id}: חיבור צד (B4) אפשרי רק עם תמיכה על ראש העמוד (A1) — הוחלף ב"${SEAT_HE.B1}"` }); seat = 'B1'; }
    // מפלס פני עליון של ה-TB
    let zTop = Infinity;
    for (const f of supported) for (const r of raftersAt(members, f.id, line.x)) {
      const g = rafterGeom(r);
      const half = seat === 'B1' ? 160 : seat === 'B2' ? (prof.props.b / 2) : 110;
      const minUnder = Math.min(g.under(line.x - half), g.under(line.x + half), g.under(line.x));
      const z = seat === 'B1' ? minUnder - 55 : seat === 'B2' ? minUnder - 35 : seat === 'B3' ? minUnder - 150 : g.top(line.x) + (prof.dims.tf ?? 12) + (prof.dims.r ?? 15) + 15;
      zTop = seat === 'B4' ? (zTop === Infinity ? z : Math.max(zTop, z)) : Math.min(zTop, z);
    }
    if (side) {
      // מתחת לפלטות ראש העמודים התומכים
      for (const fid of [def.from, def.to]) {
        const c = members.find((m) => m.id === colId(fid, line.id));
        if (c) zTop = Math.min(zTop, Math.max(c.start.z, c.end.z) - 2 * (project.connectionDefaults.eave.t ?? 12) - 50);
      }
    }
    if (!Number.isFinite(zTop)) continue;
    if (seat === 'B4') {
      const clear = prof.props.h - 2 * ((prof.dims.tf ?? 12) + (prof.dims.r ?? 15));
      const need = Math.max(...supported.flatMap((f) => raftersAt(members, f.id, line.x).map((r) => { const g = rafterGeom(r); return g.top(line.x) - g.under(line.x) + 30; })));
      if (need > clear) issues.push({ code: 'TB_B4', severity: 'error', message: `קורה נושאת ${def.id}: בחיבור צד (B4) קורת הגג (${Math.round(need)} מ"מ עם הפלטה) לא נכנסת בין אגפי ה-TB (${Math.round(clear)} מ"מ) — הגדל את ה-TB או בחר חיבור אחר` });
    }
    // A1: העמודים התומכים מתקצרים — ראש שטוח מתחת לתחתית ה-TB ולפלטת הראש
    if (!side) for (const fid of [def.from, def.to]) {
      const c = members.find((m) => m.id === colId(fid, line.id));
      if (!c) continue;
      const zc = zTop - hTot - 20;
      c.end = v3(c.end.x, c.end.y, zc); c.endCut = undefined;
      c.label = `${c.label} (מקוצר — קורה נושאת)`;
    }
    out.push({ def, line, frames, supported, zTop, seat, side, colFrom: colId(def.from, line.id), colTo: colId(def.to, line.id) });
  }
  return out;
}

/** בניית ה-TB, חיבורי התמיכה והמושבים; ניקוי אלמנטים שתלויים בעמודים שהוסרו/קוצרו */
export function buildTransfers(project: Project, plans: TbPlan[], members: Member[]): { members: Member[]; connections: Connection[]; issues: ValidationIssue[]; drop: Set<string>; shortCols: Set<string>; trussSplices: Record<string, number[]> } {
  const res = { members: [] as Member[], connections: [] as Connection[], issues: [] as ValidationIssue[], drop: new Set<string>(), shortCols: new Set<string>(), trussSplices: {} as Record<string, number[]> };
  const mat = project.building.material;
  const byId = new Map(members.map((m) => [m.id, m]));
  const plate = (id: string, desc: string, start: Vec3, end: Vec3, w: number, t: number, refUp: Vec3, anchor: Member['anchor'], connId: string, endCut?: Plane): Member => ({
    id, kind: 'plate', label: desc, start, end, profile: `PL${Math.round(w)}x${Math.round(t)}`, material: mat, rollDeg: 0, mirror: false, anchor, refUp,
    source: 'generated', manualPlacement: false, connId, partDesc: desc, endCut,
  });
  const weld = (connId: string, k: number, a: string, bb: string, len: number, p: Vec3): WeldInfo => ({ id: `${connId}.W${k}`, connId, type: 'fillet', a: 6, length: Math.round(len), location: 'shop', between: [a, bb], from: p, to: p });
  for (const pl of plans) {
    const { def, line, frames, zTop, side } = pl;
    const tbp = getProfile(def.profile);
    const h = tbp.props.h, tb = tbp.props.b, tw = tbp.dims.tw ?? 8, tf = tbp.dims.tf ?? 12;
    const x = line.x;
    const cFrom = byId.get(pl.colFrom), cTo = byId.get(pl.colTo);
    const cp = tryProfile(cFrom?.profile ?? project.building.columnProfile)!;
    const ctw = cp.dims.tw ?? 8, cb = cp.props.b;
    const y0 = frames[0].y, y1 = frames[frames.length - 1].y;
    // קצות ה-TB: A1 — עד פני העמוד הרחוקים; צד — מול ווב העמוד + פלטה/מרווח
    // צד: הקורה נעצרת מחוץ לקצות אגפי העמוד (cb/2) — פלטת סגירה (A2/A4/A5) או סנפיר (A3)
    const endGap = tbEndGap(def.support, cb);
    const ys = side ? y0 + endGap : y0 - cb / 2;
    const ye = side ? y1 - endGap : y1 + cb / 2;
    const tbId = `TB.${def.id}`;
    const TB: Member = {
      id: tbId, kind: 'beam', label: `קורה נושאת ציר ${line.label} (${frames.length - 1} מפתחים)`, start: v3(x, ys, zTop), end: v3(x, ye, zTop),
      profile: def.profile, material: mat, rollDeg: 0, mirror: false, anchor: 'top', refUp: Z, source: 'generated', manualPlacement: false, lineId: line.id,
    };
    res.members.push(TB);
    // ---------- מסבך נושא: חגורה תחתונה, אנכיים ואלכסונים (מרותכים), חיבורי המשך באמצע שדות
    const tr = def.kind === 'truss' && def.truss ? def.truss : null;
    const pB = tr ? getProfile(tr.profiles.bottom) : null;
    const bcId = `${tbId}.BC`;
    const zBC = tr ? zTop - h / 2 - tr.depth : 0;
    if (tr) {
      TB.label = `מסבך נושא ציר ${line.label} — חגורה עליונה`;
      const BC: Member = { ...TB, id: bcId, label: `מסבך נושא ציר ${line.label} — חגורה תחתונה`, start: v3(x, ys, zBC), end: v3(x, ye, zBC), profile: tr.profiles.bottom, anchor: 'center' };
      res.members.push(BC);
      const n = Math.max(2, tr.panels);
      // חלוקת השדות לפי צירי העמודים (צמתים על המסגרות); בין העמודים — הצמתים הקיצוניים זזים לפלטות הקצה
      const nodes = trussNodes(tr, y0, y1);
      if (side) { nodes[0] = ys; nodes[nodes.length - 1] = ye; }
      const tp = buildTrussPlane({ idBase: `${tbId}.TR`, connId: `C.TBT.${def.id}`, label: `מסבך נושא ציר ${line.label}`, origin: v3(x, 0, 0), e: Y, nodes,
        top: { z: () => zTop - h / 2, h, memberAt: () => tbId }, bot: { z: () => zBC, h: pB!.props.h, memberAt: () => bcId }, spec: tr, mat });
      res.members.push(...tp.members); res.connections.push(tp.connection); res.issues.push(...tp.issues);
      // מושבים בצמתים: מסגרת שאינה על צומת — אזהרה
      for (const f of pl.supported) if (!nodes.some((sN) => Math.abs(sN - f.y) < 5)) { res.issues.push({ code: 'TB_TRUSS', severity: 'warning', elementId: tbId, message: `מסבך נושא ${def.id}: קורת הגג במסגרת ${f.id} אינה על צומת — התאם את מספר השדות לכפולה של מספר המפתחים` }); break; }
      // חיבורי המשך: באמצע שדה (בחגורה חופשית מצמתים)
      const stock = project.settings.stockLength - 30;
      let panelsCut: number[] = [];
      if (Array.isArray(tr.splice)) panelsCut = tr.splice.filter((i) => i >= 0 && i < n);
      else if (tr.splice === 'auto' && ye - ys > stock) {
        let prev = ys;
        for (let i = 0; i < n; i++) {
          const mid = (nodes[i] + nodes[i + 1]) / 2, nextMid = i + 1 < n ? (nodes[i + 1] + nodes[i + 2]) / 2 : ye;
          if ((i + 1 < n ? nextMid : ye) - prev > stock && mid - prev > 500) { panelsCut.push(i); prev = mid; }
        }
      }
      const ts = panelsCut.map((i) => Math.round((nodes[i] + nodes[i + 1]) / 2 - ys));
      if (ts.length) res.trussSplices[tbId] = ts, res.trussSplices[bcId] = ts;
      const pieces = [0, ...ts, ye - ys].map((t2, i, a2) => (i ? t2 - a2[i - 1] : 0)).slice(1);
      if (pieces.some((L) => L > stock)) res.issues.push({ code: 'TB_SPLICE', severity: 'warning', elementId: tbId, message: `מסבך נושא ${def.id}: קטע חגורה ארוך מחומר הגלם (${(Math.max(...pieces) / 1000).toFixed(2)} מ') — סמן חיבור המשך בשדה` });
    }
    const span = (y1 - y0) / 1000;
    res.issues.push({ code: 'TB_INFO', severity: 'info', elementId: tbId, message: `קורה נושאת ציר ${line.label}: ${def.profile}, מפתח ${span.toFixed(2)} מ' — ${SUPPORT_HE[def.support]} · ${SEAT_HE[pl.seat]}. גיאומטריה בלבד; היציבות לרוחב של המסגרות ללא עמוד — דרך קושרות, באישור מהנדס` });

    // ---------- תמיכה בעמודים
    for (const [fid, c, sgn] of [[def.from, cFrom, 1], [def.to, cTo, -1]] as const) {
      if (!c) continue;
      const fy = frames.find((f) => f.id === fid)!.y;
      const id = `C.TBS.${def.id}.${fid}`;
      const parts: string[] = []; const bolts: BoltInfo[] = []; const welds: WeldInfo[] = [];
      // תמיכה: קורה — ה-TB עצמה; מסבך — החגורה התחתונה יושבת על פלטת הראש
      const sP = tr ? pB! : tbp, sId = tr ? bcId : tbId;
      const sh = sP.props.h, sbw = sP.props.b, stw = sP.dims.tw ?? 8, stf = sP.dims.tf ?? 12;
      const zB = tr ? zBC - sh / 2 : zTop - h;
      if (def.support === 'A1' && isBox(sP)) {
        // חגורה חלולה (RHS/SHS): פלטת תמיכה מרותכת מתחת לחגורה (מסגריה), רחבה מהצינור — 4 ברגים מחוץ לדפנות אל פלטת ראש העמוד
        const capL = cb + 160, eB = 35, capW = Math.max(cp.props.h + 40, sbw + 2 * (eB + 35));
        const sp = plate(`${id}.SP`, `פלטת תמיכה לחגורה PL20×${Math.round(capW)}×${Math.round(capL)}`, v3(x, fy - capL / 2, zB), v3(x, fy + capL / 2, zB), capW, 20, Z, 'top', id);
        const cap = plate(`${id}.CAP`, `פלטת ראש עמוד PL20×${Math.round(capW)}×${Math.round(capL)}`, v3(x, fy - capL / 2, zB - 20), v3(x, fy + capL / 2, zB - 20), capW, 20, Z, 'top', id);
        res.members.push(sp, cap); parts.push(sp.id, cap.id);
        welds.push(weld(id, 1, c.id, cap.id, 2 * (cp.props.h + cb), v3(x, fy, zB - 40)), weld(id, 2, sId, sp.id, 2 * (capL + sbw), v3(x, fy, zB)));
        let k = 0;
        for (const dx of [-(sbw / 2 + eB), sbw / 2 + eB]) for (const dy of [-(cb / 2 + 45), cb / 2 + 45]) {
          bolts.push(makeBolt(`${id}.B${++k}`, id, v3(x + dx, fy + dy, zB - 40), Z, BOLT, 40, 'site', [cap.id, sp.id], X, res.members));
        }
        if (!tr?.verts[0] || !tr?.verts[tr.verts.length - 1]) res.issues.push({ code: 'TB_TRUSS', severity: 'info', elementId: id, message: `מסבך נושא ${def.id}: חגורה חלולה על תמיכה ללא אנך בקצה — בדוק כשל מקומי של דפנות הצינור (מומלץ אנך מעל העמוד)` });
      } else if (def.support === 'A1') {
        const capL = cb + 160, capW = Math.max(cp.props.h, sbw) + 40;
        const cap = plate(`${id}.CAP`, `פלטת ראש עמוד PL20×${Math.round(capW)}×${Math.round(capL)}`, v3(x, fy - capL / 2, zB), v3(x, fy + capL / 2, zB), capW, 20, Z, 'top', id);
        res.members.push(cap); parts.push(cap.id);
        welds.push(weld(id, 1, c.id, cap.id, 2 * (cp.props.h + cb), v3(x, fy, zB - 20)));
        // מקשחי ווב ב-TB מעל העמוד (שני צדי הווב)
        // מקשח צמוד לווב ולשני האגפים (לריתוך מלא), פינות פנימיות קטומות 45° מעבר לרדיוס השורש r
        const rr = sP.dims.r ?? 15, sw = Math.floor((sbw - stw) / 2 - 5), cS = Math.ceil(rr + 5);
        for (const s2 of [1, -1]) {
          const xc2 = x + s2 * (stw / 2 + 0.5 + sw / 2);
          const st: Member = { ...plate(`${id}.ST${s2 > 0 ? 'R' : 'L'}`, `מקשח ווב PL10×${sw}×${Math.round(sh - 2 * stf - 1)}, קיטום ${cS}×45°`, v3(xc2, fy, zB + stf + 0.5), v3(xc2, fy, zB + sh - stf - 0.5), sw, 10, Y, 'center', id), snip: { side: (-s2) as -1 | 1, c: cS } };
          res.members.push(st); parts.push(st.id); welds.push(weld(id, 2 + (s2 > 0 ? 0 : 1), sId, st.id, 2 * (sh - 2 * stf), v3(x, fy, zB + sh / 2)));
        }
        let k = 0;
        for (const dx of [-(sbw / 2 - 30), sbw / 2 - 30]) for (const dy of [-(cb / 2 + 45), cb / 2 + 45]) {
          bolts.push(makeBolt(`${id}.B${++k}`, id, v3(x + dx, fy + dy, zB - 20), Z, BOLT, 20 + stf, 'site', [cap.id, sId], X, res.members));
        }
      } else {
        /* צד */
      }
      // פלטת סגירה בין קצות אגפי העמוד (מסגריה) — משטח לחיבור הקורה ב-A2/A4/A5
      let close: Member | null = null;
      if (def.support === 'A2' || def.support === 'A4' || def.support === 'A5') {
        const yC = fy + sgn * (cb / 2 + 7.5), ch2 = cp.props.h;
        const zc0 = (def.support === 'A5' ? zB - 200 : zB - 40), zc1 = Math.min(zTop + 40, Math.max(c.start.z, c.end.z) - 60);
        close = plate(`${id}.CL`, `פלטת סגירה בין אגפי העמוד PL15×${Math.round(ch2)}×${Math.round(zc1 - zc0)}`, v3(x, yC, zc0), v3(x, yC, zc1), ch2, 15, Y, 'center', id);
        res.members.push(close); parts.push(close.id); welds.push(weld(id, 9, c.id, close.id, 2 * (zc1 - zc0), v3(x, yC, (zc0 + zc1) / 2)));
      }
      const yFace = fy + sgn * (cb / 2 + 15);
      if (def.support === 'A1') { /* נבנה למעלה */ }
      else if (def.support === 'A2' && tr) {
        // מסבך בין העמודים: פלטת קצה גבוהה אחת מרותכת לשתי החגורות (מסגריה), מוברגת לפלטת הסגירה — קבוצת ברגים בכל חגורה
        const yEP = yFace + sgn * 7.5, wEP = Math.max(tb, sbw, 120), hEP = zTop - zB;
        const ep = plate(`${id}.EP`, `פלטת קצה למסבך PL15×${Math.round(wEP)}×${Math.round(hEP)}`, v3(x, yEP, zB), v3(x, yEP, zTop), wEP, 15, Y, 'center', id);
        res.members.push(ep); parts.push(ep.id);
        welds.push(weld(id, 1, tbId, ep.id, 2 * tb + 2 * h, v3(x, yEP, zTop - h / 2)), weld(id, 2, bcId, ep.id, 2 * sbw + 2 * sh, v3(x, yEP, zBC)));
        let k = 0;
        for (const [zc, hh] of [[zTop - h / 2, h], [zBC, sh]] as const) {
          const zs = hh >= 140 ? [zc - hh / 2 + 40, zc + hh / 2 - 40] : [zc];
          for (const dx of [-(wEP / 2 - 30), wEP / 2 - 30]) for (const z of zs) bolts.push(makeBolt(`${id}.B${++k}`, id, v3(x + dx, yFace - sgn * 15, z), scale(Y, sgn), BOLT, 30, 'site', [close!.id, ep.id], Z, res.members));
        }
      } else if (def.support === 'A2') {
        const yEP = yFace + sgn * 7.5;
        const ep = plate(`${id}.EP`, `פלטת קצה PL15×${Math.round(tb)}×${Math.round(h)}`, v3(x, yEP, zB), v3(x, yEP, zTop), tb, 15, Y, 'center', id);
        res.members.push(ep); parts.push(ep.id); welds.push(weld(id, 1, tbId, ep.id, 2 * tb + 2 * h, v3(x, yEP, zB + h / 2)));
        const rows = h >= 300 ? 3 : 2; let k = 0;
        for (const dx of [-(tb / 2 - 30), tb / 2 - 30]) for (let r = 0; r < rows; r++) {
          const z = zB + 60 + (r * (h - 120)) / Math.max(1, rows - 1);
          bolts.push(makeBolt(`${id}.B${++k}`, id, v3(x + dx, yFace - sgn * 15, z), scale(Y, sgn), BOLT, 30, 'site', [close!.id, ep.id], Z, res.members));
        }
      } else if (def.support === 'A3') {
        const xf = x + tw / 2 + 6;
        const yA = fy + sgn * (ctw / 2 + 0.6), yB = fy + sgn * (cb / 2 + 15 + 90), finL = Math.abs(yB - yA);
        const rr3 = tbp.dims.r ?? 15;
        const fin = plate(`${id}.FIN`, `פלטת סנפיר PL10×${Math.round(finL)}×${Math.round(h - 2 * (tf + rr3 + 5))}`, v3(xf, (yA + yB) / 2, zB + tf + rr3 + 5), v3(xf, (yA + yB) / 2, zTop - tf - rr3 - 5), finL - 1, 10, X, 'center', id);
        res.members.push(fin); parts.push(fin.id); welds.push(weld(id, 1, c.id, fin.id, 2 * (h - 2 * tf - 30), v3(xf, yA, zB + h / 2)));
        const rows = Math.max(2, Math.min(4, Math.floor((h - 2 * tf - 30) / 70))); let k = 0;
        for (let r = 0; r < rows; r++) {
          const z = zB + tf + 15 + 40 + (r * (h - 2 * tf - 110)) / Math.max(1, rows - 1);
          bolts.push(makeBolt(`${id}.B${++k}`, id, v3(xf + 5, yB - sgn * 45, z), scale(X, -1), BOLT, 10 + tw, 'site', [fin.id, tbId], Z, res.members));
        }
      } else if (def.support === 'A4') {
        // שני זוויתנים (כל זוויתן כשתי רגליים): רגל לפלטת הסגירה ורגל לווב ה-TB
        let k = 0;
        for (const s2 of [1, -1]) {
          const legC = plate(`${id}.LC${s2 > 0 ? 'R' : 'L'}`, `זוויתן ווב L100×10 — רגל לעמוד`, v3(x + s2 * (tw / 2 + 50), yFace + sgn * 5, zB + tf + 20), v3(x + s2 * (tw / 2 + 50), yFace + sgn * 5, zTop - tf - 20), 100, 10, Y, 'center', id);
          const legB = plate(`${id}.LB${s2 > 0 ? 'R' : 'L'}`, `זוויתן ווב L100×10 — רגל ל-TB`, v3(x + s2 * (tw / 2 + 5.6), yFace + sgn * 60, zB + tf + (tbp.dims.r ?? 15) + 5), v3(x + s2 * (tw / 2 + 5.6), yFace + sgn * 60, zTop - tf - (tbp.dims.r ?? 15) - 5), 100, 10, X, 'center', id);
          res.members.push(legC, legB); parts.push(legC.id, legB.id);
          welds.push(weld(id, 1 + (s2 > 0 ? 0 : 1), legC.id, legB.id, h - 2 * tf - 40, v3(x, fy, zB + h / 2)));
          for (const z of [zB + h * 0.35, zB + h * 0.65]) bolts.push(makeBolt(`${id}.B${++k}`, id, v3(x + s2 * (tw / 2 + 60), yFace - sgn * 15, z), scale(Y, sgn), BOLT, 25, 'site', [close!.id, legC.id], Z, res.members));
        }
        for (const z of [zB + h * 0.35, zB + h * 0.65]) bolts.push(makeBolt(`${id}.B${++k}`, id, v3(x + tw / 2 + 10.5, yFace + sgn * 70, z), scale(X, -1), BOLT, tw + 21, 'site', [`${id}.LBR`, tbId, `${id}.LBL`], Z, res.members));
      } else {
        // A5 תושבת: פלטה אופקית + מקשח משולש, מרותכים לעמוד; 2 ברגים דרך אגף התחתון
        const L = 150, yA = yFace, seatW = Math.max(tb, 200);
        const sp = plate(`${id}.SEAT`, `תושבת PL20×${Math.round(seatW)}×${L}`, v3(x, yA, zB), v3(x, yA + sgn * L, zB), seatW, 20, Z, 'top', id);
        const stf: Member = { ...plate(`${id}.STF`, `מקשח תושבת משולש PL15×${L}×${L}`, v3(x, yA + sgn * L / 2, zB - 20 - L), v3(x, yA + sgn * L / 2, zB - 20.5), L - 1, 15, X, 'center', id),
          startCut: { point: v3(x, yA, zB - 20 - L), normal: norm(v3(0, sgn, -1)) } };
        res.members.push(sp, stf); parts.push(sp.id, stf.id);
        welds.push(weld(id, 1, close!.id, sp.id, 2 * seatW, v3(x, yA, zB - 10)), weld(id, 2, close!.id, stf.id, 2 * L, v3(x, yA, zB - L / 2)), weld(id, 3, sp.id, stf.id, 2 * L, v3(x, yA + sgn * L / 2, zB - 20)));
        let k = 0;
        for (const dx of [-(tb / 2 - 30), tb / 2 - 30]) bolts.push(makeBolt(`${id}.B${++k}`, id, v3(x + dx, yA + sgn * 100, zB - 20), Z, BOLT, 20 + tf, 'site', [sp.id, tbId], X, res.members));
      }
      res.connections.push({ id, type: 'tb-support', label: `קורה נושאת ↔ עמוד ${c.label.replace(/ \(.*\)$/, '')} — ${SUPPORT_HE[def.support]}`, members: [tbId, c.id], parts: [...parts, ...bolts.map((q) => q.id)], bolts, welds, status: 'not-verified', fixity: 'pinned', overridden: false });
    }

    // ---------- קורות הגג על ה-TB
    for (const f of pl.supported) {
      const id = `C.TBR.${def.id}.${f.id}`;
      const rs = members.filter((m) => m.kind === 'rafter' && m.frameId === f.id && Math.min(m.start.x, m.end.x) - 1 <= x && Math.max(m.start.x, m.end.x) + 1 >= x);
      if (!rs.length) continue;
      const parts: string[] = []; const bolts: BoltInfo[] = []; const welds: WeldInfo[] = [];
      const y = f.y;
      const rb = Math.max(...rs.map((r) => rafterGeom(r).b));
      let k = 0;
      if (pl.seat === 'B1' || pl.seat === 'B2') {
        const b1 = pl.seat === 'B1';
        const lenY = rb + 120, lenX = b1 ? 300 : Math.max(160, tb);
        const zP = b1 ? zTop + 40 : zTop + 20;
        if (b1) { const pA = plate(`${id}.PA`, `פלטה א PL20×${lenX}×${lenY}`, v3(x - lenX / 2, y, zTop + 20), v3(x + lenX / 2, y, zTop + 20), lenY, 20, Z, 'top', id); res.members.push(pA); parts.push(pA.id); welds.push(weld(id, 1, tbId, pA.id, 2 * lenX, v3(x, y, zTop))); }
        const pB = plate(`${id}.PB`, `פלטה ${b1 ? 'ב' : 'תחתונה'} PL20×${lenX}×${lenY}`, v3(x - lenX / 2, y, zP), v3(x + lenX / 2, y, zP), lenY, 20, Z, 'top', id);
        res.members.push(pB); parts.push(pB.id);
        // לוחות צד משופעים מתחת לכל קורת גג — מהפלטה עד תחתית הקורה
        for (const r of rs) {
          const g = rafterGeom(r);
          const xa = Math.max(Math.min(r.start.x, r.end.x), x - lenX / 2 + 10), xb2 = Math.min(Math.max(r.start.x, r.end.x), x + lenX / 2 - 10);
          if (xb2 - xa < 20) continue;
          const xm = (xa + xb2) / 2;
          for (const s2 of [1, -1]) {
            const yy = y + s2 * (g.b / 2 - 15);
            const top = Math.max(g.under(xa), g.under(xb2)) + 5;
            const sp = plate(`${id}.W${r.id.split('.').pop()}${s2 > 0 ? 'R' : 'L'}`, `לוח כיסא PL10 (משופע)`, v3(xm, yy, zP), v3(xm, yy, top), xb2 - xa, 10, Y, 'center', id, g.plane(xm, yy));
            res.members.push(sp); parts.push(sp.id);
            welds.push(weld(id, 10 + (++k), r.id, sp.id, 2 * (xb2 - xa), v3(xm, yy, top)), weld(id, 30 + k, pB.id, sp.id, 2 * (xb2 - xa), v3(xm, yy, zP)));
          }
        }
        const bx = b1 ? tb / 2 + 30 : tb / 2 - 30;
        let n = 0;
        for (const dx of [-bx, bx]) for (const dy of [-(rb / 2 + 30), rb / 2 + 30]) {
          const head = b1 ? v3(x + dx, y + dy, zTop) : v3(x + dx, y + dy, zTop - tf);
          bolts.push(makeBolt(`${id}.B${++n}`, id, head, Z, BOLT, b1 ? 40 : 20 + tf, 'site', b1 ? [`${id}.PA`, pB.id] : [tbId, pB.id], X, res.members));
        }
      } else if (pl.seat === 'B3') {
        const r = rs[0], g = rafterGeom(r);
        const stub = 'HEA140', sp = getProfile(stub);
        const topZ = g.under(x) - 20;
        const st: Member = { id: `${id}.STUB`, kind: 'plate', label: `עמוד קצר ${stub}`, start: v3(x, y, zTop), end: v3(x, y, topZ + 5), profile: stub, material: mat, rollDeg: 0, mirror: false, anchor: 'center', refUp: X, source: 'generated', manualPlacement: false, connId: id, partDesc: `עמוד קצר ${stub}`, endCut: { point: v3(x, y, topZ), normal: g.plane(x, y).normal } };
        res.members.push(st); parts.push(st.id);
        const dirR = norm(sub(r.end, r.start));
        const cap = plate(`${id}.CAP`, `פלטת ראש משופעת PL20×${Math.round(sp.props.b + 40)}×${Math.round(sp.props.h + 120)}`, sub(v3(x, y, topZ + 20), scale(dirR, (sp.props.h + 120) / 2)), add(v3(x, y, topZ + 20), scale(dirR, (sp.props.h + 120) / 2)), Math.max(sp.props.b + 40, g.b), 20, g.plane(x, y).normal, 'top', id);
        res.members.push(cap); parts.push(cap.id);
        welds.push(weld(id, 1, tbId, st.id, 2 * (sp.props.h + sp.props.b), v3(x, y, zTop)), weld(id, 2, st.id, cap.id, 2 * (sp.props.h + sp.props.b), v3(x, y, topZ)));
        const nrm = g.plane(x, y).normal;
        for (const dl of [-(sp.props.h / 2 + 30), sp.props.h / 2 + 30]) for (const dy of [-(g.b / 2 - 30), g.b / 2 - 30]) {
          const p0 = add(add(v3(x, y + dy, topZ), scale(dirR, dl)), scale(nrm, 0));
          bolts.push(makeBolt(`${id}.B${++k}`, id, p0, nrm, BOLT, 20 + (getProfile(r.profile).dims.tf ?? 10), 'site', [cap.id, r.id], X, res.members));
        }
      } else {
        // B4: קורת הגג נחתכת מול ווב ה-TB, פלטת קצה מרותכת לקורה, מוברגת לווב
        const r = rs[0], g = rafterGeom(r);
        const far = Math.abs(r.start.x - x) > Math.abs(r.end.x - x) ? r.start : r.end;
        const sgnX = Math.sign(far.x - x) || 1;
        const xc = x + sgnX * (tw / 2 + 15.3);
        const cutPl: Plane = { point: v3(xc, y, 0), normal: v3(-sgnX, 0, 0) };
        if (far === r.start) r.endCut = cutPl; else r.startCut = cutPl;
        const zt = g.top(xc), zu = g.under(xc);
        const ep = plate(`${id}.EP`, `פלטת קצה PL15×${Math.round(g.b + 20)}×${Math.round(zt - zu + 20)}`, v3(x + sgnX * (tw / 2 + 7.6), y, zu - 10), v3(x + sgnX * (tw / 2 + 7.6), y, zt + 10), g.b + 20, 15, X, 'center', id);
        res.members.push(ep); parts.push(ep.id); welds.push(weld(id, 1, r.id, ep.id, 2 * (g.b + (zt - zu)), v3(xc, y, (zt + zu) / 2)));
        const rows = zt - zu > 280 ? 3 : 2;
        for (let i = 0; i < rows; i++) for (const dy of [-(g.b / 2 - 25), g.b / 2 - 25]) {
          const z = zu + 50 + (i * (zt - zu - 100)) / Math.max(1, rows - 1);
          bolts.push(makeBolt(`${id}.B${++k}`, id, v3(x - sgnX * tw / 2, y + dy, z), scale(X, sgnX), BOLT, tw + 15, 'site', [tbId, ep.id], Z, res.members));
        }
        if (zTop < zt + 1) res.issues.push({ code: 'TB_B4', severity: 'info', elementId: id, message: `חיבור צד (B4) מסגרת ${f.id}: יש לבדוק את מיקום הפטה הקיצונית מעל ה-TB` });
      }
      res.connections.push({ id, type: 'tb-seat', label: `קורת גג מסגרת ${frames.indexOf(f) >= 0 ? f.id : ''} על קורה נושאת ציר ${line.label} — ${SEAT_HE[pl.seat]}`, members: [tbId, ...rs.map((r) => r.id)], parts: [...parts, ...bolts.map((q) => q.id)], bolts, welds, status: 'not-verified', fixity: 'pinned', overridden: false });
    }
    if (!side) { res.shortCols.add(pl.colFrom); res.shortCols.add(pl.colTo); }
    // קורות גג שנחתכו בצד עמוד (רכס/עמוד עובר) — במסגרות ללא עמוד אין ביניהן חיבור
    const cutAtLine = pl.supported.some((f) => members.filter((m) => m.kind === 'rafter' && m.frameId === f.id && Math.min(Math.abs(m.start.x - x), Math.abs(m.end.x - x)) < cb).length >= 2);
    if (cutAtLine) res.issues.push({ code: 'TB_SPLIT', severity: 'warning', elementId: tbId, message: `קורה נושאת ציר ${line.label}: קורות הגג מתחברות כאן לצד העמוד — במסגרות ללא עמוד שתי הקורות נשענות על אותו כיסא ללא חיבור ביניהן; מומלץ פלטת המשך/רכס — לבדיקת המתכנן` });
    // ניקוי: אלכסוני עמוד-קורה ואלמנטים שנשענים על עמודים מוסרים / מקוצרים
    const removedPts = pl.def.removed.map((fid) => ({ x, y: frames.find((q) => q.id === fid)?.y ?? NaN }));
    for (const m of members) {
      if (m.kind === 'column' || m.kind === 'rafter' || m.purlin) continue;
      const nearRemoved = (p: Vec3) => removedPts.some((q) => Math.abs(p.x - q.x) < 400 && Math.abs(p.y - q.y) < 400 && p.z > project.building.baseElevation - 50);
      // מזהה אלכסון: KB.{מסגרת}.{ציר}.{מישור}.{צד} — רק אלכסונים בעמודים שבוטלו (לא בציר אחר / בעמוד מקוצר)
      if (pl.def.removed.some((fid) => m.id.startsWith(`KB.${fid}.${line.id}.`)) ||
          ((m.id.startsWith('BR.W') || m.id.startsWith('BB.')) && (nearRemoved(m.start) || nearRemoved(m.end)))) res.drop.add(m.id);
    }
  }
  return res;
}

/** מסגרות שבהן קורות הגג נשענות על קורה נושאת בשורה (להערכת גדלים) */
export function transferSupports(b: BuildingParams, sec: NSection | undefined): { x: number; frameId: string }[] {
  const out: { x: number; frameId: string }[] = [];
  for (const t of b.transfers ?? []) {
    const ln = sec?.lines.find((l) => l.id === t.lineId); if (!ln) continue;
    for (const fid of t.removed) out.push({ x: ln.x, frameId: fid });
  }
  return out;
}
