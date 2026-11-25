import { add, norm, scale, v3, type Vec3 } from '../core/vec';
import { uniformFrames } from '../model/defaults';
import { normalizeSection } from '../model/section';
import { derivedRoof, hasErrors } from '../model/validate';
import type { BoltInfo, BuildingParams, Connection, DerivedModel, Member, Project, ValidationIssue, WeldInfo, WingDef } from '../model/types';
import { tryProfile } from '../profiles/library';
import { resolveBays, wallBays } from './bracing';
import { aabb, aabbOverlap, clash } from './clash';
import { makeBolt } from './connections';
import { buildParts } from './parts';

/**
 * סככת L: כנף ניצבת לסככה הראשית. הכנף היא סככה רגילה (דו/חד-שיפועית) שנבנית בנפרד ומסובבת 90°:
 * המסגרת הראשונה שלה צמודה לקיר הצד של הראשית — בלי עמודים: קורות המסגרת הזו יושבות על כיסאות מרותכים לעמודי הראשית
 * (פלטה + צלע, 2×M16). בצד הזה של הראשית מוסרים חיפוי הקיר והקושרות במפתחי הכנף.
 * מזהי הכנף מתחילים ב-"W." (גם בהתאמות ידניות: W.F2.RAF.L וכו').
 */
export const WING = 'W.';
const Z = v3(0, 0, 1);

export function defaultWing(b: BuildingParams, roofType: 'gable' | 'mono'): WingDef {
  const fr = [...b.frames].sort((a, c) => a.y - c.y);
  const bays = Math.min(2, Math.max(1, fr.length - 1));
  // גג הכנף מתחת לתחתית קורת הראשית (עם פטה ומרווח); חד-שיפועי — הצד הגבוה בקיר הראשי
  const rh = tryProfile(b.rafterProfile)?.props.h ?? 300, pu = tryProfile(b.purlins.left.profile)?.props.h ?? 200;
  const top = Math.min(b.eaveLeft, b.eaveRight) - rh - pu - 250;
  if (roofType === 'mono') {
    const length = 9000, slopePct = 5;
    return { enabled: true, side: 'R', fromFrame: fr[0]!.id, bays, length, frames: 3, roofType, eave: Math.max(3000, Math.round((top - (slopePct / 100) * length) / 50) * 50), slopePct, monoHigh: 'start' };
  }
  const ww = fr[bays]!.y - fr[0]!.y, slopePct = 10;
  return { enabled: true, side: 'R', fromFrame: fr[0]!.id, bays, length: 12000, frames: 3, roofType, eave: Math.max(3000, Math.round((top - (slopePct / 100) * (ww / 2)) / 50) * 50), slopePct, monoHigh: 'start' };
}

/** perp: כנף מסובבת (רכס ניצב לראשית, דו-שיפועי); lean: קורות מקבילות למסגרות הראשיות, נשענות על עמודי הראשית (חד-שיפועי, יורד החוצה) */
type Mode = 'perp' | 'lean';
interface Geo { w: WingDef; mode: Mode; lineId: string; xLine: number; dir: 1 | -1; y0: number; y1: number; ww: number; off: number; face: number; frames: { id: string; y: number }[] }

function wingGeo(project: Project, main: DerivedModel): Geo | ValidationIssue {
  const b = project.building, w = b.wing!;
  const sec = main.section ?? (hasErrors(main.issues) ? null : normalizeSection(b, derivedRoof(b)));
  if (!sec) return { code: 'WING', severity: 'error', message: 'כנף: אין חתך תקין לסככה הראשית' };
  const lines = [...sec.lines].sort((a, c) => a.x - c.x);
  const line = w.side === 'L' ? lines[0]! : lines[lines.length - 1]!;
  const fr = [...b.frames].sort((a, c) => a.y - c.y);
  const i0 = fr.findIndex((f) => f.id === w.fromFrame);
  if (i0 < 0) return { code: 'WING', severity: 'error', message: 'כנף: מסגרת ההתחלה לא קיימת' };
  if (w.bays < 1 || i0 + w.bays > fr.length - 1) return { code: 'WING', severity: 'error', message: `כנף: ${w.bays} מפתחים מהמסגרת ${i0 + 1} חורגים מאורך הסככה הראשית` };
  if (w.frames < 2 || w.length < 2000) return { code: 'WING', severity: 'error', message: 'כנף: לפחות 2 מסגרות ואורך 2 מ\' לפחות' };
  const frames = fr.slice(i0, i0 + w.bays + 1);
  const colH = tryProfile(b.columnProfile)?.props.h ?? 200;
  const rafB = tryProfile(w.rafterProfile ?? b.rafterProfile)?.props.b ?? 150;
  // פלטות קצה ברכס/בחיבורי המשך רחבות מהקורה — המרחק מאגף העמוד לפי הרחב מביניהם
  const wide = Math.max(rafB, project.connectionDefaults.ridge?.w ?? 0, 2 * (tryProfile(w.rafterProfile ?? b.rafterProfile)?.props.b ?? 150) / 2);
  const mode: Mode = w.roofType === 'mono' ? 'lean' : 'perp';
  // פטות הקיר של הראשית (במפתחים הסמוכים) עוברות לפני האגף — המסגרת הנשענת מחוץ להן
  const cl = b.cladding;
  const girtH = cl?.walls.enabled && cl.girts.enabled && cl.walls.sides[w.side] ? tryProfile(cl.girts.profile)?.props.h ?? 150 : 0;
  return { w, mode, lineId: line.id, xLine: line.x, dir: w.side === 'L' ? -1 : 1, y0: frames[0]!.y, y1: frames[frames.length - 1]!.y, ww: frames[frames.length - 1]!.y - frames[0]!.y, off: colH / 2 + girtH + wide / 2 + 60, face: colH / 2 + 12, frames };
}

/** הסככה הראשית בלי חיפוי הקיר והקושרות במפתחי הכנף */
function mainProject(project: Project, g: Geo): Project {
  const p = structuredClone(project);
  const b = p.building;
  delete b.wing;
  const fr = [...b.frames].sort((a, c) => a.y - c.y);
  const nb = fr.length - 1;
  const i0 = fr.findIndex((f) => f.id === g.w.fromFrame);
  const wingBays = new Set(Array.from({ length: g.w.bays }, (_, k) => i0 + k));
  if (b.cladding) {
    const per = { ...(b.cladding.walls.per ?? {}) };
    const cur = per[g.w.side] ?? {};
    const bays = Array.from({ length: nb }, (_, i) => (wingBays.has(i) ? false : (cur.bays?.[i] ?? true)));
    per[g.w.side] = { ...cur, bays };
    b.cladding.walls.per = per;
  }
  const sec = normalizeSection(b, derivedRoof(b));
  const ids = [...sec.lines].sort((a, c) => a.x - c.x).map((l) => l.id);
  const cur = wallBays(b.bracing, ids);
  const byLine: Record<string, number[]> = {};
  for (const [lid, bays] of cur) byLine[lid] = lid === g.lineId ? resolveBays(bays, nb).filter((i) => !wingBays.has(i)) : resolveBays(bays, nb);
  b.bracing = { ...b.bracing, walls: { ...b.bracing.walls, byLine } };
  return p;
}

/** פרויקט הכנף במערכת מקומית: x' לרוחב הכנף (0..ww), y' מהסככה הראשית החוצה */
function wingProject(project: Project, g: Geo): Project {
  const b = project.building, w = g.w;
  const slope = w.slopePct / 100;
  if (g.mode === 'lean') return leanProject(project, g);
  const wb: BuildingParams = {
    ...structuredClone(b),
    width: g.ww, roofType: w.roofType, section: undefined, wing: undefined, transfers: undefined, roofTruss: undefined, lineBase: undefined,
    eaveLeft: w.eave, eaveRight: w.roofType === 'mono' ? w.eave + slope * g.ww : w.eave,
    ridgeX: g.ww / 2, slopeLeftPct: w.slopePct,
    frames: uniformFrames(w.frames, w.length),
    columnProfile: w.columnProfile ?? b.columnProfile, rafterProfile: w.rafterProfile ?? b.rafterProfile,
    rafterOverhangLeft: 0, rafterOverhangRight: 0, purlinOverhangStart: 0,
  };
  if (w.roofType === 'mono' && w.monoHigh === 'end') { wb.eaveLeft = w.eave + slope * g.ww; wb.eaveRight = w.eave; }
  if (wb.cladding) wb.cladding = { ...wb.cladding, walls: { ...wb.cladding.walls, sides: { ...wb.cladding.walls.sides, F: false } }, openings: [] };
  // המפתח הראשון (מהקיר הראשי למסגרת 2) — בלי קושרות קיר: אין עמודים במסגרת 1
  wb.bracing = { ...wb.bracing, walls: { ...wb.bracing.walls, byLine: undefined, left: resolveBays(wb.bracing.walls.left, w.frames - 1).filter((i) => i > 0), right: resolveBays(wb.bracing.walls.right, w.frames - 1).filter((i) => i > 0) } };
  const strip = <T,>(o: Record<string, T>) => Object.fromEntries(Object.entries(o).filter(([k]) => k.startsWith(WING)).map(([k, v]) => [k.slice(WING.length), v]));
  const f1 = wb.frames[0]!.id;
  return {
    ...project, building: wb,
    memberOverrides: strip(project.memberOverrides), connectionOverrides: strip(project.connectionOverrides), splices: strip(project.splices),
    cleatOverrides: strip(project.cleatOverrides ?? {}), detailAssign: {},
    // המסגרת הנשענת: בלי עמודים (קורות על כיסאות בעמודי הראשית)
    deleted: [...project.deleted.filter((x) => x.startsWith(WING)).map((x) => x.slice(WING.length)), `${f1}.COL.L`, `${f1}.COL.R`],
    manualMembers: [],
  };
}

const stripW = <T,>(o: Record<string, T>) => Object.fromEntries(Object.entries(o).filter(([k]) => k.startsWith(WING)).map(([k, v]) => [k.slice(WING.length), v]));

/** כנף נשענת (חד-שיפועית): ציר L מקומי = קיר הראשית (בלי עמודים), x' החוצה; המסגרות במיקומי המסגרות הראשיות */
function leanProject(project: Project, g: Geo): Project {
  const b = project.building, w = g.w;
  const slope = w.slopePct / 100;
  // קורות הקצה מוזזות פנימה בחצי רוחב קורה — במפתח הסמוך ממשיכות פטות הקיר של הראשית עד העמוד
  const e = (tryProfile(w.rafterProfile ?? b.rafterProfile)?.props.b ?? 150) / 2 + 12;
  const ys = g.frames.map((f, i, a) => f.y - g.y0 + (i === 0 ? e : i === a.length - 1 ? -e : 0));
  const wb: BuildingParams = {
    ...structuredClone(b),
    width: w.length, roofType: 'mono', section: undefined, wing: undefined, transfers: undefined, roofTruss: undefined, lineBase: undefined,
    eaveLeft: w.eave + slope * w.length, eaveRight: w.eave, ridgeX: w.length / 2, slopeLeftPct: w.slopePct,
    frames: ys.map((y, i) => ({ id: `F${i + 1}`, y })),
    columnProfile: w.columnProfile ?? b.columnProfile, rafterProfile: w.rafterProfile ?? b.rafterProfile,
    rafterOverhangLeft: 0, rafterOverhangRight: 0,
  };
  // הפטה הראשונה מתחילה מהקיר הראשי — במרחק שמבטיח מעבר לאגף העמוד (חצי רוחב הפטה + מרווח)
  const puB = tryProfile(wb.purlins.left.profile)?.props.b ?? 80;
  wb.purlins = { ...wb.purlins, monoStart: 'high', left: { ...wb.purlins.left, first: Math.max(wb.purlins.left.first, puB / 2 + (wb.purlins.left.cleat.base ?? 100) + 60) } };
  if (wb.cladding) wb.cladding = { ...wb.cladding, walls: { ...wb.cladding.walls, sides: { ...wb.cladding.walls.sides, L: false } }, openings: [] };
  // קושרות גג בכנף נשענת: X (סבכת RHS צריכה צומת בקצה הגבוה — שם הקיר הראשי)
  wb.bracing = { ...wb.bracing, roof: { ...wb.bracing.roof, type: 'x' }, walls: { ...wb.bracing.walls, byLine: undefined, left: [] } };
  if (wb.kneeBraces) wb.kneeBraces = { ...wb.kneeBraces, exclude: [...(wb.kneeBraces.exclude ?? []), 'L.L.R', 'L.L.L'] };
  return {
    ...project, building: wb,
    memberOverrides: stripW(project.memberOverrides), connectionOverrides: stripW(project.connectionOverrides), splices: stripW(project.splices),
    cleatOverrides: stripW(project.cleatOverrides ?? {}), detailAssign: {},
    deleted: [...project.deleted.filter((x) => x.startsWith(WING)).map((x) => x.slice(WING.length)), ...wb.frames.map((f) => `${f.id}.COL.L`)],
    manualMembers: [],
  };
}

/** סיבוב 90° (ידני-ימני) והזזה — ממערכת הכנף לעולם */
function mapper(g: Geo) {
  if (g.mode === 'lean') {
    // צד R: זהות + הזזה; צד L: סיבוב 180° (לא שיקוף)
    const bx = g.xLine + g.dir * g.face;
    const P = (q: Vec3): Vec3 => (g.dir > 0 ? v3(bx + q.x, g.y0 + q.y, q.z) : v3(bx - q.x, g.y1 - q.y, q.z));
    const D = (q: Vec3): Vec3 => (g.dir > 0 ? v3(q.x, q.y, q.z) : v3(-q.x, -q.y, q.z));
    return { P, D };
  }
  const base = g.xLine + g.dir * g.off;
  const P = (q: Vec3): Vec3 => (g.dir > 0 ? v3(base + q.y, g.y0 + g.ww - q.x, q.z) : v3(base - q.y, g.y0 + q.x, q.z));
  const D = (q: Vec3): Vec3 => (g.dir > 0 ? v3(q.y, -q.x, q.z) : v3(-q.y, q.x, q.z));
  return { P, D };
}

const pre = (id: string) => WING + id;
const preOpt = (id?: string) => (id ? pre(id) : id);

function mapWing(wd: DerivedModel, g: Geo): DerivedModel {
  const { P, D } = mapper(g);
  if (g.mode === 'lean') {
    // קורות הכנף נגמרות 2 מ"מ לפני פני העמוד הראשי (בלי ההארכה עד קצה פלטת הכיפה — אין עמוד כנף בצד הזה)
    for (const m of wd.members) {
      if (m.kind !== 'rafter') continue;
      const lo = m.start.x <= m.end.x ? 'start' : 'end';
      const A = m[lo], B = lo === 'start' ? m.end : m.start;
      if (A.x >= 2) continue;
      const t = (2 - A.x) / (B.x - A.x);
      const Q = v3(2, A.y + (B.y - A.y) * t, A.z + (B.z - A.z) * t);
      const ax = Math.sign((lo === 'start' ? B.x - A.x : A.x - B.x)) || 1;
      m[lo] = Q;
      const cut = { point: Q, normal: v3(ax, 0, 0) };
      if (lo === 'start') m.startCut = cut; else m.endCut = cut;
    }
  }
  const members: Member[] = wd.members.map((m) => ({
    ...m, id: pre(m.id), frameId: preOpt(m.frameId), connId: preOpt(m.connId), label: `כנף · ${m.label}`,
    start: P(m.start), end: P(m.end), refUp: D(m.refUp),
    startCut: m.startCut ? { point: P(m.startCut.point), normal: D(m.startCut.normal) } : undefined,
    endCut: m.endCut ? { point: P(m.endCut.point), normal: D(m.endCut.normal) } : undefined,
    purlin: m.purlin ? { ...m.purlin, roofNormal: D(m.purlin.roofNormal) } : undefined,
  }));
  const bolt = (bo: BoltInfo): BoltInfo => ({ ...bo, id: pre(bo.id), connId: pre(bo.connId), p: P(bo.p), axis: D(bo.axis), holesIn: bo.holesIn.map((h) => (h ? pre(h) : h)) });
  const weld = (w: WeldInfo): WeldInfo => ({ ...w, id: pre(w.id), connId: pre(w.connId), between: [pre(w.between[0]), pre(w.between[1])], from: P(w.from), to: P(w.to) });
  const connections: Connection[] = wd.connections.map((c) => ({
    ...c, id: pre(c.id), label: `כנף · ${c.label}`, members: c.members.map(pre), parts: c.parts.map(pre), bolts: c.bolts.map(bolt), welds: c.welds.map(weld),
    vents: c.vents?.map((v) => ({ ...v, memberId: pre(v.memberId), p: P(v.p), axis: D(v.axis) })),
    ...(c.holes ? { holes: c.holes.map((h) => ({ ...h, id: pre(h.id), memberId: pre(h.memberId), p: P(h.p), axis: D(h.axis) })) } : {}),
  }));
  return {
    members, connections,
    nodes: wd.nodes.map((n) => ({ ...n, id: pre(n.id), frameId: pre(n.frameId), p: P(n.p) })),
    grid: [], roof: wd.roof,
    issues: wd.issues.map((i) => ({ ...i, elementId: preOpt(i.elementId), message: `כנף: ${i.message}` })),
    byId: new Map(), connById: new Map(),
    supports: wd.supports.map((s) => ({ ...s, id: pre(s.id), purlinId: pre(s.purlinId), frameId: pre(s.frameId), rafterId: pre(s.rafterId), p: P(s.p) })),
    parts: wd.parts.map((x) => ({ ...x, id: pre(x.id), memberId: pre(x.memberId) })),
    splices: wd.splices.map((s) => ({ ...s, id: pre(s.id), memberId: pre(s.memberId), connId: preOpt(s.connId), p: P(s.p) })),
  };
}

/** כיסאות: פלטה מרותכת לאגף החיצוני של עמוד הראשית + צלע, קורת הכנף מוברגת אליה (2×M16) */
function seats(project: Project, g: Geo, main: DerivedModel, wing: DerivedModel): { members: Member[]; connections: Connection[]; issues: ValidationIssue[] } {
  const out = { members: [] as Member[], connections: [] as Connection[], issues: [] as ValidationIssue[] };
  const f1 = `${WING}F1.RAF`;
  const rafters = wing.members.filter((m) => m.kind === 'rafter' && (g.mode === 'lean' || m.id.startsWith(f1)));
  const bolt = { d: 16, grade: '8.8', standard: 'ISO 4017', clearance: 2 };
  const T = 15, mat = project.building.material;
  for (const f of g.frames) {
    const col = main.byId.get(`${f.id}.COL.${g.lineId}`);
    if (!col) { out.issues.push({ code: 'WING_SEAT', severity: 'error', message: `כנף: אין עמוד בציר ${g.lineId} במסגרת ${f.id} לתמיכת קורת הכנף` }); continue; }
    const cp = tryProfile(col.profile)!;
    const r = g.mode === 'lean'
      ? rafters.find((m) => Math.abs(m.start.y - f.y) < 200 && Math.abs(m.end.y - m.start.y) < 1)
      : rafters.find((m) => Math.min(m.start.y, m.end.y) - 1 <= f.y && Math.max(m.start.y, m.end.y) + 1 >= f.y);
    if (!r) { out.issues.push({ code: 'WING_SEAT', severity: 'error', message: `כנף: אין קורה של המסגרת הנשענת מעל העמוד ${col.id}` }); continue; }
    const rp = tryProfile(r.profile)!;
    const xs = g.mode === 'lean' ? g.xLine + g.dir * (g.face + 90) : g.xLine + g.dir * g.off;
    const t = g.mode === 'lean' ? (xs - r.start.x) / (r.end.x - r.start.x || 1) : (f.y - r.start.y) / (r.end.y - r.start.y || 1);
    const zTop = r.start.z + (r.end.z - r.start.z) * Math.min(1, Math.max(0, t));
    const slope = Math.abs(r.end.z - r.start.z) / (Math.hypot(r.end.x - r.start.x, r.end.y - r.start.y) || 1);
    const zu = (r.anchor === 'top' ? zTop : zTop + rp.props.h / 2) - rp.props.h * Math.sqrt(1 + slope * slope);
    if (zu > Math.max(col.start.z, col.end.z) - 150) { out.issues.push({ code: 'WING_HIGH', severity: 'error', message: `כנף: קורת המסגרת הנשענת גבוהה מראש העמוד ${col.id} — הנמך את מרזב הכנף` }); continue; }
    const id = `C.WS.${f.id}`;
    const fy = g.mode === 'lean' ? r.start.y : f.y; // מיקום הכיסא — מתחת לקורה
    const sw = g.mode === 'lean' && Math.abs(fy - f.y) > 1 ? 120 : 150;
    const xFace = g.xLine + g.dir * (cp.props.h / 2);
    const xFar = g.mode === 'lean' ? g.xLine + g.dir * (g.face + 190) : g.xLine + g.dir * (g.off + rp.props.b / 2 + 30);
    const sid = `${id}.PL`, rid = `${id}.ST`;
    const stH = 140;
    // בעמודי הקצה הצלע מוזזת לצד הכנף — בצד השני ממשיכות פטות הקיר של הראשית
    const ys = g.mode === 'lean' ? fy : f === g.frames[0] ? f.y + 45 : f === g.frames[g.frames.length - 1] ? f.y - 45 : f.y;
    const xr = g.xLine + g.dir * g.off;
    const tf = rp.dims.tf ?? 10;
    // perp: הקורות שמעל הכיסא (שתיים = קודקוד הכנף מעל העמוד)
    const over = g.mode === 'lean' ? [r] : rafters.filter((m) => Math.min(m.start.y, m.end.y) - 1 <= f.y && Math.max(m.start.y, m.end.y) + 1 >= f.y);
    const ridge = over.length >= 2;
    const lean = g.mode === 'lean';
    // שיפוע תחתית הקורה מעל הכיסא: perp — לאורך y, lean — לאורך x (כיוון הקורה)
    const k = lean ? (r.end.z - r.start.z) / (r.end.x - r.start.x || 1) : (r.end.z - r.start.z) / (r.end.y - r.start.y || 1);
    const crd = (x: number, y: number) => (lean ? x - xs : y - fy);
    // ברכס (perp, שתי קורות) — פלטה אופקית בתחתית הנמוכה ביותר (שפות הפלטה); אחרת פלטה בשיפוע הקורה, מגע מלא
    const tilt = !ridge && Math.abs(k) > 1e-6;
    const n = tilt ? norm(lean ? v3(-k, 0, 1) : v3(0, -k, 1)) : Z;
    const zuP = ridge ? zu - Math.abs(k) * sw / 2 : zu;
    const bottom = (x: number, y: number) => zuP + (tilt ? k * crd(x, y) : 0);
    const pc = (x: number) => add(v3(x, fy, bottom(x, fy)), scale(n, -(T / 2 + 0.5)));
    // ב-lean הפלטה והצלע נוטות לאורך x — קצה אנכי צמוד לאגף העמוד
    const faceCut = lean && tilt ? (p: Vec3) => ({ startCut: { point: p, normal: v3(g.dir, 0, 0) } }) : () => ({});
    out.members.push({ id: sid, kind: 'plate', label: `כיסא כנף PL${T}×${sw}`, start: pc(xFace), end: pc(xFar), ...faceCut(v3(xFace, fy, 0)), profile: `PL${sw}x${T}`, material: mat, rollDeg: 0, mirror: false, anchor: 'center', refUp: n, source: 'generated', manualPlacement: false, connId: id, partDesc: `כיסא כנף PL${T}×${sw}×${Math.round(Math.abs(xFar - xFace))}${tilt ? ' (בשיפוע הקורה)' : ''}` });
    // פני התחתון של הפלטה; ראש הצלע מתחתיה לכל עובי הצלע (10) — ב-lean הצלע נוטה עם הפלטה
    const plateBot = (x: number, y: number) => bottom(x, y) - (T + 0.5) / n.z;
    const ribTop = (x: number) => Math.min(plateBot(x, ys - 5), plateBot(x, ys + 5)) - 1;
    const xRib = xFar - g.dir * 20;
    out.members.push({ id: rid, kind: 'plate', label: 'צלע כיסא PL10', start: v3(xFace, ys, ribTop(xFace) - stH / 2), end: v3(xRib, ys, ribTop(xRib) - stH / 2), ...faceCut(v3(xFace, ys, ribTop(xFace) - stH / 2)), profile: `PL${stH}x10`, material: mat, rollDeg: 0, mirror: false, anchor: 'center', refUp: v3(0, 1, 0), source: 'generated', manualPlacement: false, connId: id, partDesc: `צלע כיסא PL10×${stH}×${Math.round(Math.abs(xFar - xFace) - 20)}` });
    const bolts: BoltInfo[] = [];
    const head = (x: number, y: number) => add(v3(x, y, bottom(x, y)), scale(n, -(T + 1)));
    if (lean) {
      for (const [kk, dx] of [[1, -(rp.props.b / 2 - 30)], [2, rp.props.b / 2 - 30]] as const) bolts.push(makeBolt(`${id}.B${kk}`, id, head(xs, fy + dx * 0.8), n, bolt, T + tf, 'site', [sid, r.id], v3(1, 0, 0), out.members));
    } else {
      // בכל קורה שמעל הכיסא: 2 ברגים ברוחב האגף; ברכס — 45 מ"מ מהקודקוד לתוך כל קורה (לא בתפר)
      for (const rr of over) {
        const far = Math.abs(rr.start.y - f.y) > Math.abs(rr.end.y - f.y) ? rr.start.y : rr.end.y;
        const y = ridge ? f.y + Math.sign(far - f.y) * 45 : f.y;
        for (const dx of [-(rp.props.b / 2 - 30), rp.props.b / 2 - 30]) bolts.push(makeBolt(`${id}.B${bolts.length + 1}`, id, head(xr + dx, y), n, bolt, T + tf, 'site', [sid, rr.id], v3(1, 0, 0), out.members));
      }
      if (ridge) out.issues.push({ code: 'WING_RIDGE_SEAT', severity: 'info', elementId: id, message: `כיסא כנף ${f.id} מתחת לקודקוד הכנף: הקורות נשענות על שפות הפלטה — מרווח ${(Math.abs(k) * 30).toFixed(1)} מ"מ מתחת לברגים, נדרשת דסקית משופעת או מילוי` });
    }
    const zc = (zuP - T / 2 - 0.5);
    const wc = v3(xFace, fy, zc);
    const welds: WeldInfo[] = [
      { id: `${id}.W1`, connId: id, type: 'fillet', a: 6, length: 300, location: 'shop', between: [col.id, sid], from: wc, to: add(wc, v3(0, 1, 0)) },
      { id: `${id}.W2`, connId: id, type: 'fillet', a: 5, length: 2 * stH, location: 'shop', between: [col.id, rid], from: wc, to: wc },
      { id: `${id}.W3`, connId: id, type: 'fillet', a: 5, length: 2 * Math.abs(xFar - xFace), location: 'shop', between: [sid, rid], from: wc, to: wc },
    ];
    out.connections.push({ id, type: 'rafter-side', label: `כנף ↔ עמוד ${col.id} (כיסא)`, members: [col.id, r.id], parts: [sid, rid, ...bolts.map((x) => x.id)], bolts, welds, status: 'not-verified', fixity: 'pinned', overridden: false });
  }
  return out;
}

export function generateWithWing(project: Project, base: (p: Project) => DerivedModel): DerivedModel {
  const plain = base({ ...project, building: { ...project.building, wing: undefined } });
  const g = wingGeo(project, plain);
  if ('code' in g) return { ...plain, issues: [...plain.issues, g] };
  const mainP = mainProject(project, g);
  const main = base(mainP);
  if (hasErrors(main.issues) && !main.members.length) return main;
  const wp = wingProject(project, g);
  const wd = base(wp);
  const wdLocal = wd; // מודל הכנף המקומי (משותף — מיפוי הכנף לעולם יוצר עותקים)
  const wing = mapWing(wd, g);
  const issues: ValidationIssue[] = [...main.issues, ...wing.issues];
  // גובה: גג הכנף (כולל פטות) מתחת לתחתית קורת הגג של הראשית בצד החיבור
  const pu = tryProfile(project.building.purlins.left.profile)?.props.h ?? 200;
  const wingTop = Math.max(...wing.members.filter((m) => m.kind === 'rafter' && m.frameId === `${WING}F1`).flatMap((m) => [m.start.z, m.end.z])) + pu;
  const mainRaf = main.members.filter((m) => m.kind === 'rafter' && [m.start, m.end].some((q) => Math.abs(q.x - g.xLine) < 1500));
  const mainLow = mainRaf.length ? Math.min(...mainRaf.flatMap((m) => [m.start, m.end].filter((q) => Math.abs(q.x - g.xLine) < 1500).map((q) => q.z - (tryProfile(m.profile)?.props.h ?? 300)))) : Infinity;
  if (wingTop > mainLow - 80) issues.push({ code: 'WING_HIGH', severity: 'error', message: `כנף: גג הכנף בחיבור (${(wingTop / 1000).toFixed(2)}) גבוה מתחתית קורת הגג של הסככה הראשית (${(mainLow / 1000).toFixed(2)}) — הנמך את מרזב הכנף או את השיפוע` });
  const st = seats(project, g, main, wing);
  issues.push(...st.issues);
  const members = [...main.members, ...wing.members, ...st.members];
  const connections = [...main.connections, ...wing.connections, ...st.connections];
  const byId = new Map(members.map((m) => [m.id, m]));
  // התנגשויות בחיבור: חלקי הכנף ליד הקיר מול חלקי הראשית ליד הקיר
  const near = (m: Member) => [m.start, m.end].some((q) => Math.abs(q.x - g.xLine) < 1500) && Math.max(m.start.y, m.end.y) > g.y0 - 800 && Math.min(m.start.y, m.end.y) < g.y1 + 800;
  const wA = [...wing.members, ...st.members].filter((m) => m.kind !== 'bolt' && near(m));
  const mA = main.members.filter((m) => m.kind !== 'bolt' && near(m));
  const seatOf = new Map(st.connections.flatMap((c) => c.parts.map((pid) => [pid, c] as const)));
  for (const a of wA) for (const bm of mA) {
    const c = seatOf.get(a.id);
    if (c && c.members.includes(bm.id)) continue; // כיסא ↔ העמוד שלו (מרותך)
    if (!aabbOverlap(aabb(a), aabb(bm))) continue;
    const k = clash(a, bm);
    if (k) issues.push({ code: 'CLASH', severity: 'error', elementId: a.id, message: `התנגשות ${a.id} ↔ ${bm.id}: חדירה ${k.depth.toFixed(1)} מ"מ (חיבור הכנף)` });
  }
  issues.push({ code: 'WING_INFO', severity: 'info', message: `כנף (L): ${g.w.roofType === 'gable' ? 'דו-שיפועית' : 'חד-שיפועית'} ${(g.ww / 1000).toFixed(2)}×${(g.w.length / 1000).toFixed(2)} מ' — מסגרת 1 נשענת על ${g.frames.length} עמודי הראשית; חיפוי וקושרות הקיר הוסרו מהמפתחים האלה. נדרש פח חיבור (flashing) בין גג הכנף לקיר הראשי.` });
  return {
    ...main, members, connections, issues, byId, connById: new Map(connections.map((c) => [c.id, c])),
    nodes: [...main.nodes, ...wing.nodes], supports: [...main.supports, ...wing.supports],
    parts: [...main.parts, ...wing.parts, ...buildParts(st.members.filter((m) => m.kind !== 'bolt' && tryProfile(m.profile)), project, new Map(st.connections.map((c) => [c.id, c]))).parts],
    splices: [...main.splices, ...wing.splices],
    wing: { side: g.w.side, xLine: g.xLine, y0: g.y0, y1: g.y1, off: g.off, dir: g.dir, local: { project: wp, derived: wdLocal, mainProject: mainP, P: mapper(g).P } },
  };
}
