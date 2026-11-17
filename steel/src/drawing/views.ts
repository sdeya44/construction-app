import { gutterDev, gutterRuns, gutterSpec, gutterTakeoff } from '../geometry/gutter';
import { dot, sub, type Vec3 } from '../core/vec';
import { localFrame } from '../geometry/frame';
import { cachedSolidPure, silhouetteEdges } from './solidCache';
import { partSheet, plateCell, plateFaceInBox } from './part';
import { claddingTakeoff, WALL_HE } from '../geometry/cladding';
import { assemblyListSheet, assemblySheet, renderIso } from './assembly';
import { purlinParams } from '../geometry/purlins';
import { getProfile, tryProfile } from '../profiles/library';
import type { Bom } from '../fab/bom';
import type { Fabrication } from '../fab/marks';
import type { Connection, DerivedModel, DrawingRecord, DrawingType, Member, Project } from '../model/types';
import { drawArea, fitScale, frameAndTitle, newSheet, today, View, type P, type Sheet, type SheetSize, type TitleInfo } from './sheet';

export interface DrawingDef { id: string; type: DrawingType; number: string; title: string; ref?: string; /** גיליון משולב: מסגרות זהות / סימוני פלטות */ refs?: string[] }

const num = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });

/** קטלוג השרטוטים הנגזר מהמודל. המזהים יציבים; מספרי השרטוטים נגזרים מהמזהה. */
/** מכלול עם הרבה סימוני חלקים שונים (למשל חצי מסבך) */
export function bigAssembly(fab: Fabrication, mark: string): boolean {
  const a = fab.assemblies.find((x) => x.mark === mark);
  return !!a && new Set(a.parts.map((pid) => fab.byPart.get(pid)?.mark)).size > 10;
}

export function drawingCatalog(p: Project, d: DerivedModel, fab: Fabrication): DrawingDef[] {
  const out: DrawingDef[] = [];
  out.push({ id: 'D-COVER', type: 'cover', number: 'G-00', title: 'גיליון שער — רשימת שרטוטים והערות כלליות' });
  out.push({ id: 'D-GA', type: 'ga', number: 'G-01', title: 'שרטוט כללי והרכבה – איזומטריה' });
  out.push({ id: 'D-ROOF', type: 'roof-plan', number: 'R-01', title: 'תוכנית גג ופריסת פטות' });
  if (d.connections.some((c) => c.type === 'base')) out.push({ id: 'D-ANCHOR', type: 'anchor-plan', number: 'B-01', title: 'תוכנית ברגי עיגון ופלטות בסיס' });
  // מסגרות זהות (אותם סימוני מכלול וחיבורים) — גיליון "חתך מסגרת טיפוסי" אחד לכל קבוצה
  for (const [k, g] of frameGroups(p, d, fab).entries()) {
    const ax = g.map((fid) => p.building.frames.findIndex((f) => f.id === fid) + 1);
    out.push({ id: `D-FRAME-${g[0]}`, type: 'frame', number: `F-${String(k + 1).padStart(2, '0')}`, title: g.length > 1 ? `חתך מסגרת טיפוסי – צירים ${ax.join(', ')}` : `חתך מסגרת – ציר ${ax[0]}`, ref: g[0], refs: g });
  }
  out.push({ id: 'D-SIDE', type: 'side', number: 'E-01', title: 'חזיתות צד – צירים א ו-ב', ref: 'LR' });
  if (p.building.cladding?.walls.enabled && (p.building.cladding.walls.sides.F || p.building.cladding.walls.sides.B)) out.push({ id: 'D-ENDWALLS', type: 'side', number: 'E-02', title: 'קירות קצה – עמודי רוח, פטות קיר ופתחים', ref: 'FB' });
  if (p.building.cladding) out.push({ id: 'D-CLAD', type: 'cladding', number: 'K-01', title: 'חיפוי, פחים ומזחלות — כתב כמויות' });
  if (d.section && gutterRuns(p.building, d.section, d.members).length) out.push({ id: 'D-GUTTER', type: 'gutter', number: 'K-02', title: 'פרט מזחלה וירידת מרזב' });
  const types: [string, string][] = [['eave', 'פרט חיבור קורה-עמוד'], ['ridge', 'פרט חיבור רכס'], ['base', 'פרט פלטת בסיס'], ['purlin-cleat', 'פרט תומך פטה'], ['purlin-splice', 'פרט חיבור המשך פטה'], ['brace-end', 'פרט פח חיבור קושרת'], ['brace-cross', 'פרט הצטלבות קושרות'], ['rafter-side', 'פרט חיבור קורה לצד עמוד'], ['knee', 'פרט אלכסון עמוד-קורה'], ['ridge-tie', 'פרט חיזוק רכס אופקי'], ['tb-support', 'פרט קורה נושאת ↔ עמוד'], ['tb-seat', 'פרט קורת גג על קורה נושאת'], ['truss', 'פרט צמתי מסבך'], ['truss-splice', 'פרט חיבור המשך חגורת מסבך'], ['truss-end', 'פרט חגורה תחתונה ↔ עמוד']];
  types.forEach(([t, title], i) => {
    const c = d.connections.find((x) => x.type === t);
    if (c) out.push({ id: `D-CONN-${t}`, type: 'connection', number: `D-${String(i + 1).padStart(2, '0')}`, title, ref: c.id });
  });
  // פרטים מותאמים מהספרייה — גיליון פרט לכל פרט בשימוש
  const used = [...new Map(d.connections.filter((c) => c.custom).map((c) => [c.custom!.detailId, c])).values()];
  used.forEach((c, k) => {
    const nm = p.customDetails?.find((x) => x.id === c.custom!.detailId)?.name ?? 'פרט מותאם';
    out.push({ id: `D-CONN-cd-${c.custom!.detailId}`, type: 'connection', number: `D-${String(types.length + k + 1).padStart(2, '0')}`, title: `פרט ${nm}`, ref: c.id });
  });
  const asm = [...new Set(fab.assemblies.map((a) => a.mark))].sort(num);
  for (const m of asm) {
    out.push({ id: `D-ASM-${m}`, type: 'assembly', number: `A-${m}`, title: `שרטוט מכלול ${m}`, ref: m });
    // מכלול גדול (מסבך): רשימת החלקים בגיליון שני — הגיליון הראשון נשאר קריא
    if (bigAssembly(fab, m)) out.push({ id: `D-ASM-${m}-L`, type: 'assembly', number: `A-${m}.2`, title: `שרטוט מכלול ${m} — רשימת חלקים`, ref: `${m}|list` });
  }
  // חלקי פרופיל — גיליון לכל חלק; פלטות — כמה פלטות בגיליון (A4: 6, A3: 8), ממוינות לפי גודל
  const isPlate = (mk: string) => d.byId.get(fab.parts.find((x) => x.mark === mk)?.memberId ?? '')?.kind === 'plate';
  const parts = [...new Set(fab.parts.map((x) => x.mark))].sort(num);
  // מוטות עיגון — ללא גיליון חלק (מופיעים ברשימת החומרים ובתוכנית ברגי העיגון)
  const isAnchor = (mk: string) => d.byId.get(fab.parts.find((x) => x.mark === mk)?.memberId ?? '')?.kind === 'anchor';
  for (const m of parts.filter((x) => !isPlate(x) && !isAnchor(x))) out.push({ id: `D-PART-${m}`, type: 'part', number: `P-${m}`, title: `שרטוט חלק ${m}`, ref: m });
  const plates = parts.filter(isPlate);
  const per = (p.settings.paper ?? 'A4') === 'A4' ? 6 : 8;
  for (let i = 0; i * per < plates.length; i++) {
    const g = plates.slice(i * per, (i + 1) * per);
    out.push({ id: `D-PLATES-${i + 1}`, type: 'plates', number: `PL-${String(i + 1).padStart(2, '0')}`, title: `פלטות ${g[0]}–${g[g.length - 1]}`, ref: g.join(','), refs: g });
  }
  return out;
}

/** קבוצות מסגרות זהות: חתימה = סימוני המכלולים של העמודים/קורות + סוגי החיבורים במסגרת */
export function frameGroups(p: Project, d: DerivedModel, fab: Fabrication): string[][] {
  const asmOfM = new Map<string, string>();
  for (const pt of fab.parts) { const a = fab.assemblies.find((x) => x.id === pt.assembly); if (a) asmOfM.set(pt.memberId, a.mark); }
  const sig = (fid: string) => {
    const ms = d.members.filter((m) => m.frameId === fid && (m.kind === 'column' || m.kind === 'rafter' || m.kind === 'brace')).map((m) => `${m.kind}:${asmOfM.get(m.id) ?? m.profile}:${Math.round(m.start.x)}`).sort();
    const cs = d.connections.filter((c) => c.id.split('.').includes(fid)).map((c) => c.type).sort();
    return [...ms, '|', ...cs].join(';');
  };
  const groups = new Map<string, string[]>();
  for (const f of p.building.frames) { const k = sig(f.id); groups.set(k, [...(groups.get(k) ?? []), f.id]); }
  return [...groups.values()];
}

const STATUS_HE: Record<string, string> = { draft: 'טיוטה', 'for-review': 'לבדיקה', approved: 'מאושר לייצור' };

function titleOf(p: Project, def: DrawingDef, rec: DrawingRecord | undefined, scaleLabel: string): TitleInfo {
  const status = rec?.status ?? 'draft';
  return {
    company: 'כיאן הנדסה', project: p.meta.name, projectNo: p.meta.number, client: p.meta.client, title: def.title,
    number: def.number, rev: rec?.rev ?? p.revision.current, scale: scaleLabel, date: today(), status: STATUS_HE[status],
    drawnBy: p.meta.designer, checkedBy: p.settings.checkedBy, approvedBy: status === 'approved' ? p.settings.approvedBy : '',
    revisions: p.revision.log.map((r) => ({ rev: r.rev, date: r.date, note: r.note || (r.status === 'approved' ? 'אושר לייצור' : 'טיוטה') })),
    note: status === 'approved' ? 'מאושר לייצור ע"י המשתמש — חתכים וחיבורים לפי אחריות המתכנן' : 'טיוטה — אינו תכן מאושר; נתוני חתכים לא מאומתים; אין בדיקת חוזק',
  };
}

type Proj = (q: Vec3) => P;

/** קווי מתאר של מוצק בהיטל, בלי צלעות שמתנוונות לנקודה. */
function edges(m: Member, pr: Proj, v: View, layer: 'OUTLINE' | 'THIN' = 'OUTLINE', clip?: (a: Vec3, b: Vec3) => [Vec3, Vec3] | null) {
  const s = cachedSolidPure(m);
  const seg = (a0: Vec3, b0: Vec3) => {
    let a = a0, b = b0;
    if (clip) { const c = clip(a, b); if (!c) return; [a, b] = c; }
    const pa = pr(a), pb = pr(b);
    if (Math.hypot(pa.x - pb.x, pa.y - pb.y) < 0.5) return;
    v.line(pa, pb, layer);
  };
  for (let i = 0; i < s.edges.length; i += 6) seg({ x: s.edges[i], y: s.edges[i + 1], z: s.edges[i + 2] }, { x: s.edges[i + 3], y: s.edges[i + 4], z: s.edges[i + 5] });
  // צללית לחתכים מעוגלים (RHS/CHS)
  for (const [i, j] of silhouetteEdges(m, pr)) seg(s.startRing[i], s.endRing[j]);
}

/** חתך אמיתי של מוצק במישור y = y0 (לאלמנטים לאורך Y), מוחזר כפוליגון במבט (x, z). */
function cutAtY(m: Member, y0: number): P[] | null {
  const s = cachedSolidPure(m);
  const ys = [...s.startRing, ...s.endRing].map((q) => q.y);
  if (!(Math.min(...ys) < y0 - 1e-6 && Math.max(...ys) > y0 + 1e-6)) return null;
  if (Math.abs(s.startRing[0].y - s.endRing[0].y) < 1) return null;
  return s.startRing.map((a, i) => {
    const b = s.endRing[i];
    const t = (y0 - a.y) / (b.y - a.y);
    return { x: a.x + (b.x - a.x) * t, y: a.z + (b.z - a.z) * t };
  });
}

function boxOf(pts: P[]) {
  return { x0: Math.min(...pts.map((q) => q.x)), x1: Math.max(...pts.map((q) => q.x)), y0: Math.min(...pts.map((q) => q.y)), y1: Math.max(...pts.map((q) => q.y)) };
}
function solidPts(ms: Member[], pr: Proj): P[] {
  const out: P[] = [];
  for (const m of ms) { const s = cachedSolidPure(m); for (const q of [...s.startRing, ...s.endRing]) out.push(pr(q)); }
  return out;
}

/** מבט ממורכז באזור נתון של הגיליון, עם קנה מידה תקני. */
function placeView(sh: Sheet, box: { x0: number; x1: number; y0: number; y1: number }, area: { x0: number; y0: number; x1: number; y1: number }, scale?: number, margin = 18, allowRot = false): View {
  const W = area.x1 - area.x0 - 2 * margin, H = area.y1 - area.y0 - 2 * margin;
  const sc0 = scale ?? fitScale(box.x1 - box.x0, box.y1 - box.y0, W, H);
  // תוכנית: אם סיבוב 90° נותן קנה מידה גדול יותר — מסובבים (מבנה ארוך לרוחב הגיליון)
  const scR = allowRot && !scale ? fitScale(box.y1 - box.y0, box.x1 - box.x0, W, H) : Infinity;
  const rot = scR < sc0;
  const cx = (area.x0 + area.x1) / 2, cy = (area.y0 + area.y1) / 2;
  return new View(sh, rot ? scR : sc0, { x: cx, y: cy }, { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 }, rot);
}

/** טבלה ממוסגרת בקואורדינטות דף; מימין לשמאל: העמודה הראשונה בצד ימין. מחזירה את קצה הטבלה התחתון. */
function table(sh: Sheet, x1: number, yTop: number, cw: number[], title: string, head: string[], rows: string[][], footer?: string[]): number {
  const W = cw.reduce((a, x) => a + x, 0), rh = 4.4, x0 = x1 - W;
  let y = yTop;
  const line = (a: P, b: P, layer: 'THIN' | 'TITLE' = 'THIN') => sh.ents.push({ k: 'line', a, b, layer });
  sh.ents.push({ k: 'text', p: { x: (x0 + x1) / 2, y: y - 4.2 }, s: title, h: 2.8, align: 'center', layer: 'TEXT', bold: true });
  y -= 6; line({ x: x0, y }, { x: x1, y }, 'TITLE');
  const yHead = y;
  const cell = (vals: string[], bold = false) => {
    let x = x1;
    vals.forEach((t, i) => { sh.ents.push({ k: 'text', p: { x: x - cw[i] / 2, y: y - rh + 1.3 }, s: t, h: 2.5, align: 'center', layer: 'TEXT', bold }); x -= cw[i]; });
    y -= rh; line({ x: x0, y }, { x: x1, y });
  };
  cell(head, true);
  for (const r of rows) cell(r);
  if (footer) cell(footer, true);
  sh.ents.push({ k: 'poly', pts: [{ x: x0, y: yTop }, { x: x1, y: yTop }, { x: x1, y }, { x: x0, y }], closed: true, layer: 'TITLE' });
  let x = x1; for (const w of cw.slice(0, -1)) { x -= w; line({ x, y: yHead }, { x, y }); }
  return y;
}

/** קנ"מ מרבי סביר לכל סוג גיליון ב-A4 — מעבר לו הגיליון עולה ל-A3 */
const A4_MAX_SCALE: Partial<Record<DrawingType, number>> = { 'roof-plan': 200, 'anchor-plan': 200, frame: 100, side: 150, ga: 250, connection: 10, part: 10 };

/** האם כל התוכן בתוך המסגרת ומעל פס הכותרת */
function fitsSheet(sh: Sheet): boolean {
  const a = drawArea(sh), tol = 0.6;
  const inside = (q: P) => q.x >= a.x0 - tol && q.x <= a.x1 + tol && q.y >= a.y0 - 2.5 && q.y <= a.y1 + tol;
  for (const e of sh.ents) {
    if (e.layer === 'FRAME' || e.layer === 'TITLE') continue;
    if (e.k === 'line') { if (!inside(e.a) || !inside(e.b)) return false; }
    else if (e.k === 'text') { if (!inside(e.p)) return false; }
    else if (e.k === 'circle') { if (!inside(e.c)) return false; }
    else if (!e.pts.every(inside)) return false;
  }
  return true;
}

/**
 * גיליון: גודל קבוע אם נקבע ברשומת השרטוט; אחרת לפי העדפת הנייר — A4 קודם (קנ"מ סביר וכל התוכן בפנים),
 * ואם לא — A3. מכלולים תמיד A3 (מבט חזית + עליון + חתכים + פרטים).
 */
export function buildSheet(def: DrawingDef, p: Project, d: DerivedModel, fab: Fabrication, bom: Bom, rec?: DrawingRecord): Sheet {
  if (rec?.sheet) return buildSheetOn(def, p, d, fab, bom, rec, rec.sheet);
  if (def.type === 'plates') return buildSheetOn(def, p, d, fab, bom, rec, p.settings.paper ?? 'A4');
  if ((p.settings.paper ?? 'A4') === 'A4' && def.type !== 'assembly') {
    const sh = buildSheetOn(def, p, d, fab, bom, rec, 'A4');
    const partKind = def.type === 'part' ? d.byId.get(fab.parts.find((x) => x.mark === def.ref)?.memberId ?? '')?.kind : undefined;
    const max = def.type === 'part' && partKind !== 'plate' ? 50 : A4_MAX_SCALE[def.type];
    if ((max === undefined || sh.scale <= max) && fitsSheet(sh)) return sh;
  }
  return buildSheetOn(def, p, d, fab, bom, rec, 'A3');
}

function buildSheetOn(def: DrawingDef, p: Project, d: DerivedModel, fab: Fabrication, bom: Bom, rec: DrawingRecord | undefined, size: SheetSize): Sheet {
  const sh = newSheet(size, titleOf(p, def, rec, ''), 1);
  sh.mono = !p.settings.drawingColor;
  {
    const cat = drawingCatalog(p, d, fab);
    const i = cat.findIndex((x) => x.id === def.id);
    sh.title.sheetNo = i >= 0 ? `${i + 1}/${cat.length}` : '';
    sh.title.exec = p.settings.execClass ?? 'EXC2';
    const mats = [...new Set(d.members.filter((m) => m.kind !== 'bolt' && m.kind !== 'anchor').map((m) => m.material))];
    sh.title.material = mats.length === 1 ? mats[0] : mats.slice(0, 2).join(' / ');
    if (def.type === 'assembly') {
      const a = fab.assemblies.find((x) => x.mark === def.ref);
      if (a) sh.title.weight = `${a.weight.toFixed(1)} ק"ג`;
    } else if (def.type === 'part') {
      const pt = fab.parts.find((x) => x.mark === def.ref);
      if (pt) { sh.title.weight = `${pt.weight.toFixed(2)} ק"ג`; sh.title.material = pt.material; }
    } else if (def.type === 'plates') {
      const w = (def.refs ?? []).reduce((a1, mk) => a1 + fab.parts.filter((x) => x.mark === mk).reduce((a2, x) => a2 + x.weight, 0), 0);
      sh.title.weight = `${w.toFixed(1)} ק"ג`;
    } else sh.title.weight = `${(bom.assemblies.reduce((a1, r) => a1 + r.unitWeight * r.qty, 0) / 1000).toFixed(2)} טון`;
  }
  const area = drawArea(sh);
  let scaleLabel = '';
  const setScale = (v: View) => { scaleLabel = `1:${v.scale}`; sh.scale = v.scale; };
  const b = p.building;
  const asmOf = (memberId: string) => {
    const part = fab.parts.find((x) => x.memberId === memberId);
    return part ? fab.assemblies.find((a) => a.id === part.assembly)?.mark ?? '' : '';
  };

  /** פתחים בחזית: מלבן מקווקו עם אלכסונים, מידות רוחב/גובה ומיקום */
  const openingsOn = (v: View, w: 'L' | 'R' | 'F' | 'B', toH: (t: number) => number) => {
    for (const o of b.cladding?.openings.filter((x) => x.wall === w) ?? []) {
      const x0 = toH(o.pos), x1 = toH(o.pos + o.width), z0 = b.baseElevation + o.sill, z1 = z0 + o.height;
      v.poly([{ x: x0, y: z0 }, { x: x1, y: z0 }, { x: x1, y: z1 }, { x: x0, y: z1 }], true, 'HIDDEN');
      v.line({ x: x0, y: z0 }, { x: x1, y: z1 }, 'THIN'); v.line({ x: x0, y: z1 }, { x: x1, y: z0 }, 'THIN');
      v.dim({ x: x0, y: z1 }, { x: x1, y: z1 }, { x: 1, y: 0 }, 4, `${Math.round(o.width)}`);
      v.dim({ x: x1, y: z0 }, { x: x1, y: z1 }, { x: 0, y: 1 }, -4, `${Math.round(o.height)}`);
      v.text({ x: (x0 + x1) / 2, y: (z0 + z1) / 2 + 200 }, o.label ?? o.id, 2.5, 'center', 'MARK', 0, true);
    }
  };
  /** חזית קיר קצה: עמודי המסגרת, קורות הגג, עמודי רוח, פטות קיר ופתחים, מידות ומפלסים */
  const drawEndWall = (w: 'F' | 'B', ar: { x0: number; x1: number; y0: number; y1: number }) => {
    const fr = [...b.frames].sort((a1, a2) => a1.y - a2.y), f = w === 'F' ? fr[0] : fr[fr.length - 1];
    const pr: Proj = (q) => ({ x: w === 'F' ? q.x : -q.x, y: q.z });
    const ms = d.members.filter((m) => (m.frameId === f.id && (m.kind === 'column' || m.kind === 'rafter')) || m.wall?.id === w);
    const bx = boxOf(solidPts(ms, pr)); bx.x0 -= 1800; bx.x1 += 1800; bx.y0 -= 1600; bx.y1 += 900;
    const v = placeView(sh, bx, ar, undefined, 12); setScale(v);
    for (const m of ms) edges(m, pr, v, m.wall?.role === 'girt' ? 'THIN' : 'OUTLINE');
    const xs = [...new Set(d.members.filter((m) => m.frameId === f.id && (m.kind === 'column' || m.wall?.role === 'post')).map((m) => Math.round(m.start.x)))].sort((a1, a2) => a1 - a2);
    const X = (x: number) => (w === 'F' ? x : -x);
    for (let i = 1; i < xs.length; i++) v.dim({ x: X(xs[i - 1]), y: b.baseElevation }, { x: X(xs[i]), y: b.baseElevation }, { x: 1, y: 0 }, -10);
    if (xs.length > 2) v.dim({ x: X(xs[0]), y: b.baseElevation }, { x: X(xs[xs.length - 1]), y: b.baseElevation }, { x: 1, y: 0 }, -17);
    const xL = Math.min(...(d.section?.lines ?? []).map((l) => l.x));
    openingsOn(v, w, (t) => X(xL + t));
    // מפלסי פטות הקיר
    const gz = [...new Set(ms.filter((m) => m.wall?.role === 'girt').map((m) => Math.round(m.start.z)))].sort((a1, a2) => a1 - a2);
    const xD = Math.min(X(xs[0]), X(xs[xs.length - 1])) - 900;
    let prev = b.baseElevation; for (const z of gz) { v.dim({ x: xD, y: prev }, { x: xD, y: z }, { x: 0, y: 1 }, 0); prev = z; }
    v.level({ x: Math.max(X(xs[0]), X(xs[xs.length - 1])) + 600, y: b.baseElevation }, 0);
    for (const m of ms.filter((x) => x.wall?.role === 'post')) { const mk = asmOf(m.id); if (mk) v.text({ x: X(m.start.x) + 300, y: (m.start.z + m.end.z) / 2 }, `${mk} ${m.profile}`, 2.5, 'center', 'MARK', 90); }
    v.text({ x: (bx.x0 + bx.x1) / 2, y: bx.y1 - 300 }, `${w === 'F' ? 'קיר קצה קדמי (ציר 1)' : `קיר קצה אחורי (ציר ${fr.length})`}  1:${v.scale}`, 3, 'center', 'TEXT', 0, true);
  };

  switch (def.type) {
    case 'roof-plan': {
      const ys0 = () => d.grid.filter((g) => g.dir === 'Y').map((g) => g.pos);
      const pr: Proj = (q) => ({ x: q.x, y: q.y });
      const main = d.members.filter((m) => ['rafter', 'purlin', 'column'].includes(m.kind));
      const bx = boxOf(solidPts(main, pr));
      bx.x0 -= 3000; bx.x1 += 3000; bx.y0 -= 2500; bx.y1 += 2500;
      const v = placeView(sh, bx, area, undefined, 14, true); setScale(v);
      // צירים
      for (const g of d.grid) {
        if (g.dir === 'X') { v.line({ x: g.pos, y: bx.y0 + 800 }, { x: g.pos, y: bx.y1 - 800 }, 'AXIS'); v.bubble({ x: g.pos, y: bx.y1 - 300 }, g.label); }
        else { v.line({ x: bx.x0 + 800, y: g.pos }, { x: bx.x1 - 800, y: g.pos }, 'AXIS'); v.bubble({ x: bx.x0 + 300, y: g.pos }, g.label); }
      }
      for (const rx of ridgeXs(d)) v.line({ x: rx, y: bx.y0 + 1500 }, { x: rx, y: bx.y1 - 1500 }, 'AXIS');
      // סימוני חתך: כל קו מסגרת מפנה לגיליון חתך המסגרת (F-xx), חץ לכיוון המבט
      const fCat = drawingCatalog(p, d, fab).filter((x) => x.type === 'frame');
      b.frames.forEach((f, i) => {
        const fNum = fCat.find((x) => x.refs?.includes(f.id))?.number ?? `F-${String(i + 1).padStart(2, '0')}`;
        const at = { x: bx.x1 - 1400, y: f.y };
        const q = v.p(at.x, at.y), dirP = v.pd({ x: 0, y: 1 });
        sh.ents.push({ k: 'line', a: q, b: { x: q.x + dirP.x * 4, y: q.y + dirP.y * 4 }, layer: 'MARK' });
        sh.ents.push({ k: 'poly', pts: [{ x: q.x + dirP.x * 4 + dirP.y * 1.2, y: q.y + dirP.y * 4 - dirP.x * 1.2 }, { x: q.x + dirP.x * 6, y: q.y + dirP.y * 6 }, { x: q.x + dirP.x * 4 - dirP.y * 1.2, y: q.y + dirP.y * 4 + dirP.x * 1.2 }], closed: true, layer: 'MARK', fill: true });
        sh.ents.push({ k: 'text', p: { x: q.x + 1.5, y: q.y + 1.5 }, s: fNum, h: 2.5, align: 'left', layer: 'MARK', bold: true });
      });
      const raf = getProfile(b.rafterProfile);
      for (const m of d.members.filter((x) => x.kind === 'rafter')) {
        const hb = (tryProfile(m.profile)?.props.b ?? raf.props.b) / 2;
        const xs = [m.start.x, m.end.x];
        // קורה בכיוון כלשהו בתוכנית (גם קורות הכנף, שמסובבות 90°)
        const L2 = Math.hypot(m.end.x - m.start.x, m.end.y - m.start.y) || 1;
        const nx = -(m.end.y - m.start.y) / L2 * hb, ny = (m.end.x - m.start.x) / L2 * hb;
        v.poly([{ x: m.start.x + nx, y: m.start.y + ny }, { x: m.end.x + nx, y: m.end.y + ny }, { x: m.end.x - nx, y: m.end.y - ny }, { x: m.start.x - nx, y: m.start.y - ny }], true, 'OUTLINE');
        if (m.id.startsWith('W.')) continue;
        // סימון הרכבה על כל קורה
        const mk = asmOf(m.id);
        if (mk) v.text({ x: xs[0] + (xs[1] - xs[0]) * 0.22, y: m.start.y + hb + 2.2 * v.scale }, mk, 2.5, 'center', 'MARK', 0, true);
      }
      for (const m of d.members.filter((x) => x.kind === 'column')) {
        const c0 = getProfile(m.profile);
        // עמוד מסובב (כנף): הגובה לאורך Y
        const c = Math.abs(m.refUp.y) > Math.abs(m.refUp.x) ? { props: { h: c0.props.b, b: c0.props.h } } : c0;
        v.poly([{ x: m.start.x - c.props.h / 2, y: m.start.y - c.props.b / 2 }, { x: m.start.x + c.props.h / 2, y: m.start.y - c.props.b / 2 }, { x: m.start.x + c.props.h / 2, y: m.start.y + c.props.b / 2 }, { x: m.start.x - c.props.h / 2, y: m.start.y + c.props.b / 2 }], true, 'OUTLINE', true);
      }
      // פטות הכנף: קווים בלבד (המידות והתוויות — לסככה הראשית)
      for (const m of d.members.filter((x) => x.purlin && x.id.startsWith('W.'))) v.line({ x: m.start.x, y: m.start.y }, { x: m.end.x, y: m.end.y }, 'OUTLINE');
      if (d.wing) { const wm = d.members.filter((x) => x.id.startsWith('W.') && x.kind === 'rafter'); if (wm.length) { const cx = wm.reduce((a1, m) => a1 + m.start.x + m.end.x, 0) / (2 * wm.length), cy = wm.reduce((a1, m) => a1 + m.start.y + m.end.y, 0) / (2 * wm.length); v.text({ x: cx, y: cy }, `כנף (L) · פטות ${wm[0] && d.members.find((x) => x.purlin && x.id.startsWith('W.'))?.profile}`, 2.5, 'center', 'MARK', 0, true); } }
      const purl = d.members.filter((m) => m.purlin && !m.id.startsWith('W.'));
      for (const m of purl) v.line({ x: m.start.x, y: m.start.y }, { x: m.end.x, y: m.end.y }, 'OUTLINE');
      // תווית אחת לכל שיפוע: חתך וסימוני החלקים
      for (const side of ['L', 'R', 'M'] as const) {
        const ls = purl.filter((m) => m.purlin!.side === side);
        if (!ls.length) continue;
        const marks = [...new Set(fab.parts.filter((x) => ls.some((m) => m.id === x.memberId)).map((x) => x.mark))].sort(num);
        const xm = ls.reduce((acc, m) => acc + m.start.x, 0) / ls.length;
        // באמצע מפתח (לא על קו מסגרת), מוסט מקו הקורה
        const fr = [...b.frames].sort((a1, a2) => a1.y - a2.y); const kk = Math.max(0, Math.floor(fr.length / 2) - 1);
        const ym = fr.length > 1 ? (fr[kk].y + fr[kk + 1].y) / 2 : fr[0].y + 1000;
        void ys0;
        // בין שתי פטות (לא על קו פטה)
        const xsS = ls.map((m) => m.start.x).sort((a1, a2) => a1 - a2);
        const near = xsS.reduce((bst, x) => (Math.abs(x - xm) < Math.abs(bst - xm) ? x : bst), xsS[0]);
        const nxt = xsS.find((x) => x > near + 1) ?? xsS.slice().reverse().find((x) => x < near - 1) ?? near + 600;
        v.text({ x: (near + nxt) / 2, y: ym }, `פטות ${ls[0].profile} (${marks.join(', ')})`, 2.5, 'center', 'MARK');
      }
      for (const sp of d.splices.filter((x) => x.memberId.startsWith('PL.'))) {
        const q = v.p(sp.p.x, sp.p.y);
        sh.ents.push({ k: 'line', a: { x: q.x - 1.2, y: q.y - 1.2 }, b: { x: q.x + 1.2, y: q.y + 1.2 }, layer: 'MARK' }, { k: 'line', a: { x: q.x - 1.2, y: q.y + 1.2 }, b: { x: q.x + 1.2, y: q.y - 1.2 }, layer: 'MARK' });
      }
      for (const m of d.members.filter((x) => x.kind === 'brace' && (x.id.startsWith('BR.R') || x.id.startsWith('BR.T') || x.id.startsWith('HB.')))) {
        v.line({ x: m.start.x, y: m.start.y }, { x: m.end.x, y: m.end.y }, m.id.startsWith('BR.T') ? 'HIDDEN' : 'THIN');
      }
      // תומכי פטות, פחי קושרות/סבכה וחיזוקי רכס — בהיטל עליון
      const prXY: Proj = (q) => ({ x: q.x, y: q.y });
      for (const m of d.members.filter((x) => x.kind === 'cleat' || x.kind === 'beam' || (x.kind === 'plate' && /^C\.(BR\.R|HB\.|PS\.|RT\.)/.test(x.connId ?? '')))) edges(m, prXY, v, 'THIN');
      // מידות: מרווחי מסגרות וסה"כ
      const ys = d.grid.filter((g) => g.dir === 'Y').map((g) => g.pos);
      const xr = bx.x1 - 1800;
      for (let i = 1; i < ys.length; i++) v.dim({ x: xr, y: ys[i - 1] }, { x: xr, y: ys[i] }, { x: 0, y: 1 }, 0);
      v.dim({ x: xr, y: ys[0] }, { x: xr, y: ys[ys.length - 1] }, { x: 0, y: 1 }, -9);
      { const [lx0, lx1] = lineSpan(d); v.dim({ x: lx0, y: bx.y0 + 1200 }, { x: lx1, y: bx.y0 + 1200 }, { x: 1, y: 0 }, -14); }
      // פריסת פטות: שרשרת מידות מעל, הטקסט = מרחק לאורך השיפוע (או אופקי, מסומן)
      const ytop = Math.max(...ys) + b.purlinOverhangEnd + 900;
      for (const side of [...new Set(purl.map((m) => m.purlin!.side))]) {
        const ls = purl.filter((m) => m.purlin!.side === side).sort((a1, a2) => a1.purlin!.index - a2.purlin!.index);
        const plS = d.section?.planes.find((q) => q.id === side);
        const free = ls[0]?.purlin!.startFree ?? side === 'M';
        let prevX: number | null = free ? null : plS ? (plS.startAt === 'b' ? plS.b.x : plS.a.x) : b.ridgeX;
        let prevS = 0;
        const segs: { x0: number; x1: number; t: string }[] = [];
        ls.forEach((m) => {
          const pi = m.purlin!;
          if (prevX !== null) {
            const span = pi.sSlope - prevS;
            const rem = pi.isLast && pi.index > 1 && Math.abs(span - purlinParams(b.purlins, pi.paramKey ?? (side === 'R' ? 'right' : 'left')).spacing) > 0.5;
            segs.push({ x0: prevX, x1: m.start.x, t: `${Math.round(span)}${rem ? '*' : ''}` });
          }
          prevX = m.start.x; prevS = pi.sSlope;
        });
        // מרווחים צפופים בדף (הטקסט רחב מהמרווח): רצף מרווחים זהים — מידה אחת "n×מרווח"
        const paperLen = (q: { x0: number; x1: number }) => Math.hypot(v.p(q.x1, ytop).x - v.p(q.x0, ytop).x, v.p(q.x1, ytop).y - v.p(q.x0, ytop).y);
        const tight = segs.some((q) => paperLen(q) < q.t.length * 2.5 * 0.62 + 1.5);
        for (let i = 0; i < segs.length;) {
          let j = i;
          if (tight) while (j + 1 < segs.length && segs[j + 1]!.t === segs[i]!.t) j++;
          const n = j - i + 1;
          v.dim({ x: segs[i]!.x0, y: ytop }, { x: segs[j]!.x1, y: ytop }, { x: 1, y: 0 }, 4, n > 1 ? `${n}×${segs[i]!.t}` : segs[i]!.t);
          i = j + 1;
        }
      }
      { // הערה מתחת לתצוגה, בקואורדינטות דף (לא מסתובבת עם התצוגה)
        const cs = [v.p(bx.x0, bx.y0), v.p(bx.x1, bx.y1), v.p(bx.x0, bx.y1), v.p(bx.x1, bx.y0)];
        const px = (Math.min(...cs.map((c) => c.x)) + Math.max(...cs.map((c) => c.x))) / 2, py = Math.min(...cs.map((c) => c.y)) - 14;
        sh.ents.push({ k: 'text', p: { x: px, y: py }, s: 'מידות פטות לאורך השיפוע (מ"מ); * מרווח שאריתי; × חיבור המשך – דורש תכנון', h: 2.5, align: 'center', layer: 'TEXT' });
      }
      if (0) v.text({ x: (bx.x0 + bx.x1) / 2, y: ytop + 1500 }, 'מידות פטות לאורך השיפוע (מ"מ); * מרווח שאריתי; × חיבור המשך – דורש תכנון', 2.5, 'center', 'TEXT');
      break;
    }
    case 'frame': {
      const f = b.frames.find((x) => x.id === def.ref)!;
      const fi = b.frames.indexOf(f) + 1;
      const pr: Proj = (q) => ({ x: q.x, y: q.z });
      const own = d.members.filter((m) => m.frameId === f.id || (m.connId && m.connId.split('.').includes(f.id) && m.kind !== 'cleat' && !m.connId.startsWith('C.PC')));
      const bx = boxOf(solidPts(own.filter((m) => m.kind !== 'anchor'), pr));
      bx.x0 -= 1800; bx.x1 += 1800; bx.y0 -= 1500; bx.y1 += 1200;
      const v = placeView(sh, bx, area); setScale(v);
      for (const m of own) edges(m, pr, v, m.kind === 'bolt' || m.kind === 'anchor' ? 'THIN' : 'OUTLINE');
      for (const m of d.members.filter((x) => x.purlin || (x.kind === 'cleat' && x.connId?.endsWith(`.${f.id}`)))) {
        const poly = cutAtY(m, f.y);
        if (poly) v.poly(poly, true, 'CUT', true);
      }
      for (const g of d.grid.filter((x) => x.dir === 'X')) { v.line({ x: g.pos, y: b.baseElevation - 800 }, { x: g.pos, y: bx.y1 - 400 }, 'AXIS'); v.bubble({ x: g.pos, y: b.baseElevation - 1100 }, g.label); }
      const colsF = own.filter((x) => x.kind === 'column').sort((a1, a2) => a1.start.x - a2.start.x);
      const xsF = colsF.map((c) => c.start.x);
      if (xsF.length > 1) {
        v.dim({ x: xsF[0], y: b.baseElevation }, { x: xsF[xsF.length - 1], y: b.baseElevation }, { x: 1, y: 0 }, -20);
        for (let i = 1; i < xsF.length && xsF.length > 2; i++) v.dim({ x: xsF[i - 1], y: b.baseElevation }, { x: xsF[i], y: b.baseElevation }, { x: 1, y: 0 }, -13);
      }
      // גובה פני עליון קורת הגג בכל ציר עמודים (מקור: קו הייחוס של העמוד)
      colsF.forEach((c, i) => v.dim({ x: c.start.x, y: c.start.z }, { x: c.start.x, y: c.end.z }, { x: 0, y: 1 }, i === 0 ? 14 : i === colsF.length - 1 ? -14 : 8));
      for (const nd of d.nodes.filter((x) => x.frameId === f.id && x.role === 'רכס')) v.dim({ x: nd.p.x, y: b.baseElevation }, { x: nd.p.x, y: nd.p.z }, { x: 0, y: 1 }, 0);
      const lbl = (m?: Member) => m && v.text({ x: (m.start.x + m.end.x) / 2, y: (m.start.z + m.end.z) / 2 + 250 }, `${asmOf(m.id)} ${m.profile}`, 2.5, 'center', 'MARK');
      for (const m of own.filter((x) => x.kind === 'rafter')) lbl(m);
      // עמודים: תווית אנכית לצד העמוד (לא על הקו)
      for (const m of colsF) v.text({ x: m.start.x + (m.start.x < b.width / 2 ? 450 : -450), y: (m.start.z + m.end.z) / 2 }, `${asmOf(m.id)} ${m.profile}`, 2.5, 'center', 'MARK', 90);
      const slopesTxt = (d.section?.planes ?? []).map((q) => `${Math.abs(((q.b.z - q.a.z) / (q.b.x - q.a.x)) * 100).toFixed(1)}%`).join(' / ');
      v.text({ x: (bx.x0 + bx.x1) / 2, y: bx.y1 - 300 }, `שיפוע ${slopesTxt}  ·  מבט לאורך Y, ${def.refs && def.refs.length > 1 ? `מסגרת טיפוסית – צירים ${def.refs.map((id) => b.frames.findIndex((q) => q.id === id) + 1).join(', ')}` : `מסגרת ${fi}`}`, 2.5, 'center', 'TEXT');
      // מפלסים
      const xL = (xsF[0] ?? 0) - 1400;
      v.level({ x: xL, y: b.baseElevation }, 0, -1);
      for (const c of colsF.slice(0, 1)) v.level({ x: xL, y: c.end.z }, c.end.z - b.baseElevation, -1);
      // ציר שתחתית העמוד בו במפלס אחר (חגורה/יסוד מוגבה) — מפלס ליד תחתית העמוד
      for (const c of colsF) if (Math.abs(c.start.z - b.baseElevation) > 1) v.level({ x: c.start.x + (c.start.x < b.width / 2 ? -700 : 700), y: c.start.z }, c.start.z - b.baseElevation, c.start.x < b.width / 2 ? -1 : 1);
      // הפניות לפרטי חיבור (עיגול מקווקו + תג מספר הגיליון)
      const cat = drawingCatalog(p, d, fab);
      const seen = new Set<string>();
      for (const c of d.connections.filter((x) => (x.type === 'eave' || x.type === 'ridge' || x.type === 'base') && x.id.split('.').includes(f.id))) {
        const ref = cat.find((x) => x.id === `D-CONN-${c.type}`); if (!ref) continue;
        const pm = c.parts.map((id) => d.byId.get(id)).find((m): m is Member => !!m && m.kind === 'plate'); if (!pm) continue;
        const q = v.p((pm.start.x + pm.end.x) / 2, (pm.start.z + pm.end.z) / 2);
        const key = `${c.type}:${Math.round(q.x)}`; if (seen.has(key)) continue; seen.add(key);
        const R = 7, n = 24, pts: P[] = [];
        for (let i = 0; i <= n; i++) pts.push({ x: q.x + R * Math.cos((2 * Math.PI * i) / n), y: q.y + R * Math.sin((2 * Math.PI * i) / n) });
        for (let i = 0; i < n; i += 2) sh.ents.push({ k: 'line', a: pts[i], b: pts[i + 1], layer: 'MARK' });
        const sx = q.x < (v.p(0, 0).x + v.p(b.width, 0).x) / 2 ? -1 : 1;
        const ridge = c.type === 'ridge';
        const tg = ridge ? { x: q.x + R + 8, y: q.y - R - 6 } : { x: q.x + sx * (R + 7), y: q.y + R + 5 };
        sh.ents.push({ k: 'line', a: ridge ? { x: q.x + R * 0.7, y: q.y - R * 0.7 } : { x: q.x + sx * R * 0.7, y: q.y + R * 0.7 }, b: tg, layer: 'MARK' });
        sh.ents.push({ k: 'circle', c: tg, r: 4, layer: 'MARK' });
        sh.ents.push({ k: 'line', a: { x: tg.x - 4, y: tg.y }, b: { x: tg.x + 4, y: tg.y }, layer: 'MARK' });
        sh.ents.push({ k: 'text', p: { x: tg.x, y: tg.y + 0.8 }, s: ref.number, h: 2, align: 'center', layer: 'MARK', bold: true });
        sh.ents.push({ k: 'text', p: { x: tg.x, y: tg.y - 3 }, s: 'פרט', h: 1.6, align: 'center', layer: 'MARK' });
      }
      break;
    }
    case 'side': {
      if (def.ref === 'FB') {
        const ends = (['F', 'B'] as const).filter((w) => b.cladding?.walls.sides[w]);
        const ww = (area.x1 - area.x0) / Math.max(1, ends.length);
        ends.forEach((w, i) => drawEndWall(w, { ...area, x1: area.x1 - i * ww, x0: area.x1 - (i + 1) * ww }));
        break;
      }
      const sideList = (def.ref === 'LR' ? ['L', 'R'] : [def.ref]) as ('L' | 'R')[];
      const hh = (area.y1 - area.y0) / sideList.length;
      const drawSide = (side: 'L' | 'R', area: { x0: number; x1: number; y0: number; y1: number }) => {
      const lnS = [...(d.section?.lines ?? [])].sort((a1, a2) => a1.x - a2.x);
      const lineS = side === 'L' ? lnS[0] : lnS[lnS.length - 1];
      const x0 = lineS?.x ?? (side === 'L' ? 0 : b.width);
      const pr: Proj = (q) => ({ x: q.y, y: q.z });
      const ms = d.members.filter((m) => (m.kind === 'column' && (m.lineId === lineS?.id || m.side === side)) || (m.id.startsWith('BR.W') && (m.id.includes(`.${side}.`) || (lineS && m.id.includes(`.${lineS.id}.`)))) || m.wall?.id === side);
      const bx = boxOf(solidPts(ms, pr));
      bx.x0 -= 2500; bx.x1 += 2500; bx.y0 -= 1500; bx.y1 += 1500;
      const v = placeView(sh, bx, area); setScale(v);
      for (const m of ms) edges(m, pr, v, m.kind === 'girt' && m.wall?.role === 'girt' ? 'THIN' : 'OUTLINE');
      openingsOn(v, side, (t) => b.frames.reduce((mn, f) => Math.min(mn, f.y), Infinity) + t);
      // פלטות בסיס וראש עמוד, וחתכי הקורות/קורות אגד שנשענות על קו העמודים
      const colIds = new Set(ms.filter((m) => m.kind === 'column').map((m) => m.id));
      for (const c of d.connections.filter((c) => (c.type === 'base' || c.type === 'eave') && c.members.some((id) => colIds.has(id)))) {
        for (const pid of c.parts) { const pm = d.byId.get(pid); if (pm && pm.kind === 'plate') edges(pm, pr, v, 'THIN'); }
      }
      for (const m of d.members.filter((x) => x.kind === 'beam' && Math.abs(x.start.x - x0) < 400 && Math.abs(x.end.x - x0) < 400)) edges(m, pr, v);
      for (const m of d.members.filter((x) => x.kind === 'rafter')) {
        // קטע הקורה ברוחב החתך סביב קו העמודים — מראה את הקורה הנחתכת מעל העמוד
        const dx = m.end.x - m.start.x; if (Math.abs(dx) < 1) continue;
        const t = (x0 - m.start.x) / dx; if (t < -0.02 || t > 1.02) continue;
        const rp = tryProfile(m.profile); if (!rp) continue;
        const zc = m.start.z + (m.end.z - m.start.z) * Math.min(1, Math.max(0, t));
        const yc = m.start.y, hb = rp.props.b / 2, hh = rp.props.h;
        const zb = m.anchor === 'top' ? zc - hh : zc - hh / 2, zt = zb + hh;
        v.poly([{ x: yc - hb, y: zb }, { x: yc + hb, y: zb }, { x: yc + hb, y: zt }, { x: yc - hb, y: zt }], true, 'CUT');
        const mk = asmOf(m.id); if (mk) v.text({ x: yc, y: zt + 250 }, mk, 2, 'center', 'MARK', 0, true);
      }
      for (const m of ms.filter((x) => x.kind === 'column')) { const mk = asmOf(m.id); if (mk) v.text({ x: m.start.y + 350, y: (m.start.z + m.end.z) / 2 }, mk, 2, 'left', 'MARK', 90, true); }
      const ys = b.frames.map((f) => f.y);
      const eave = Math.max(...ms.filter((m) => m.kind === 'column').map((m) => m.end.z), b.baseElevation + 1000);
      v.line({ x: Math.min(...ys) - b.purlinOverhangStart, y: eave }, { x: Math.max(...ys) + b.purlinOverhangEnd, y: eave }, 'THIN');
      d.grid.filter((g) => g.dir === 'Y').forEach((g) => { v.line({ x: g.pos, y: b.baseElevation - 600 }, { x: g.pos, y: eave + 600 }, 'AXIS'); v.bubble({ x: g.pos, y: b.baseElevation - 900 }, g.label); });
      for (let i = 1; i < ys.length; i++) v.dim({ x: ys[i - 1], y: b.baseElevation }, { x: ys[i], y: b.baseElevation }, { x: 1, y: 0 }, -17);
      v.dim({ x: ys[0], y: b.baseElevation }, { x: ys[ys.length - 1], y: b.baseElevation }, { x: 1, y: 0 }, -25);
      v.dim({ x: ys[0], y: b.baseElevation }, { x: ys[0], y: eave }, { x: 0, y: 1 }, 12);
      // מפלסים: ±0.00 בבסיס, ראש עמוד
      const yR = Math.max(...ys) + b.purlinOverhangEnd + 300;
      v.line({ x: Math.min(...ys) - 1200, y: b.baseElevation }, { x: yR + 600, y: b.baseElevation }, 'THIN');
      v.level({ x: yR, y: b.baseElevation }, 0);
      v.level({ x: yR, y: eave }, eave - b.baseElevation);
      v.text({ x: (ys[0] + ys[ys.length - 1]) / 2, y: eave + 900 }, `חזית ציר ${lineS?.label ?? (side === 'L' ? 'א' : 'ב')}  1:${v.scale}`, 3, 'center', 'TEXT', 0, true);
      };
      sideList.forEach((sd, i) => drawSide(sd, { ...area, y1: area.y1 - i * hh, y0: area.y1 - (i + 1) * hh }));
      break;
    }
    case 'gutter': {
      const runs = d.section ? gutterRuns(b, d.section, d.members) : [];
      const r = runs.find((x) => x.kind === 'eave') ?? runs[0];
      if (!r) break;
      const gs = gutterSpec(b.cladding?.gutter);
      const dir = r.dir;
      const e0 = r.ends[0];
      const raf = e0 ? d.byId.get(e0.rafterId) : undefined;
      const rp = raf ? tryProfile(raf.profile) : undefined;
      const pu = tryProfile(b.purlins.left.profile)?.props.h ?? 200;
      const half = (area.x1 - area.x0) / 2;
      // ---- חתך: קצה הקורה, פטה אחרונה, פח גג, המזחלה ותומך — במערכת מקומית (x החוצה מקצה הקורה, z)
      const X0 = e0 ? e0.faceX : r.x - dir * 20;
      const L = (x: number) => dir * (x - X0); // מרחק מקצה הקורה החוצה
      const tos = r.zInnerTop - pu + 10;
      const hR = rp?.props.h ?? 300;
      const gx0 = L(r.x), gx1 = gx0 + gs.bottom;
      const bx = { x0: -900, x1: gx1 + 80, y0: r.zBottom - 160, y1: Math.max(r.zBottom + gs.outer, tos + pu) + 120 };
      const v = placeView(sh, bx, { x0: area.x0 + half, y0: area.y0, x1: area.x1, y1: area.y1 - 6 }, undefined, 14);
      setScale(v);
      // קורה (מבט צד, חתוכה), פטה ופח גג
      v.poly([{ x: -900, y: tos }, { x: 0, y: tos }, { x: 0, y: tos - hR }, { x: -900, y: tos - hR }], false, 'OUTLINE');
      v.line({ x: -900, y: tos - (rp?.dims.tf ?? 10) }, { x: 0, y: tos - (rp?.dims.tf ?? 10) }, 'HIDDEN');
      v.line({ x: -900, y: tos - hR + (rp?.dims.tf ?? 10) }, { x: 0, y: tos - hR + (rp?.dims.tf ?? 10) }, 'HIDDEN');
      v.poly([{ x: -330, y: tos }, { x: -330, y: tos + pu }, { x: -270, y: tos + pu }, { x: -270, y: tos + pu - 18 }], false, 'OUTLINE');
      v.poly([{ x: -330, y: tos }, { x: -270, y: tos }, { x: -270, y: tos + 18 }], false, 'OUTLINE');
      v.line({ x: -900, y: tos + pu + 2 }, { x: gx0 + gs.bottom * 0.35, y: tos + pu + 2 - gs.bottom * 0.03 }, 'THIN');
      v.text({ x: -600, y: tos + pu + 40 }, 'פח גג', 2.5, 'center', 'TEXT');
      v.text({ x: -500, y: tos - hR / 2 }, raf?.profile ?? '', 2.5, 'center', 'TEXT');
      v.text({ x: -300, y: tos + pu + 60 }, b.purlins.left.profile, 2.2, 'center', 'TEXT');
      // מזחלה
      const g = [{ x: gx0, y: r.zInnerTop }, { x: gx0, y: r.zBottom }, { x: gx1, y: r.zBottom }, { x: gx1, y: r.zBottom + gs.outer }, { x: gx1 - gs.lip, y: r.zBottom + gs.outer }];
      v.poly(g, false, 'CUT');
      v.line({ x: gx0, y: r.zInnerTop }, { x: gx0 - gs.lip, y: r.zInnerTop }, 'CUT');
      // תומך L50/50/5
      const lh = tryProfile(gs.bracket)?.props.h ?? 50;
      v.poly([{ x: 0, y: r.zBottom }, { x: gx1 + 20, y: r.zBottom }, { x: gx1 + 20, y: r.zBottom - 5 }, { x: 5, y: r.zBottom - 5 }, { x: 5, y: r.zBottom - lh }, { x: 0, y: r.zBottom - lh }], true, 'OUTLINE');
      // מידות
      v.dim({ x: gx0, y: r.zBottom }, { x: gx1, y: r.zBottom }, { x: 1, y: 0 }, -10);
      v.dim({ x: gx0, y: r.zBottom }, { x: gx0, y: r.zInnerTop }, { x: 0, y: 1 }, 8);
      v.dim({ x: gx1, y: r.zBottom }, { x: gx1, y: r.zBottom + gs.outer }, { x: 0, y: 1 }, -8);
      v.dim({ x: 0, y: r.zBottom - lh }, { x: gx1 + 20, y: r.zBottom - lh }, { x: 1, y: 0 }, -18, `${Math.round(gx1 + 20)}`);
      v.level({ x: gx1, y: r.zBottom }, r.zBottom, 1, 12);
      v.level({ x: -900, y: tos }, tos, -1, 12);
      v.text({ x: (gx0 + gx1) / 2, y: r.zBottom + gs.outer + 70 }, `מזחלה — פח מגולוון t=${gs.t} · פריסה ${gutterDev(gs)} מ"מ`, 2.5, 'center', 'TEXT', 0, true);
      v.text({ x: (gx0 + gx1) / 2, y: r.zBottom - lh - 330 }, `2×${gs.bracket.replace('x', '/')} מרותכים לקצה הקורה בכל מסגרת (מסגריה)`, 2.4, 'center', 'TEXT');
      sh.ents.push({ k: 'text', p: { x: area.x1 - 2, y: area.y1 - 3 }, s: `פרט מזחלה — חתך בקצה הקורה  1:${v.scale}`, h: 3, align: 'right', layer: 'TEXT', bold: true });
      // ---- ירידת מרזב: מבט חזית, לאורך עמוד
      const dp = r.downpipes[0];
      if (dp) {
        const H = dp.zTop - dp.zBottom;
        const by = { x0: -900, x1: 2600, y0: dp.zBottom - 650, y1: r.zBottom + gs.outer + 300 };
        const w = placeView(sh, by, { x0: area.x0, y0: area.y0, x1: area.x0 + half - 4, y1: area.y1 - 6 }, undefined, 14);
        const z0 = b.lineBase?.[''] ?? b.baseElevation;
        w.line({ x: -900, y: z0 }, { x: 900, y: z0 }, 'OUTLINE');
        w.poly([{ x: -110, y: z0 }, { x: -110, y: r.zBottom - 200 }, { x: 110, y: r.zBottom - 200 }, { x: 110, y: z0 }], false, 'HIDDEN');
        w.text({ x: -170, y: (z0 + r.zBottom) / 2 }, 'עמוד', 2.4, 'right', 'TEXT');
        w.poly([{ x: -700, y: r.zBottom }, { x: 700, y: r.zBottom }, { x: 700, y: r.zBottom + gs.outer }, { x: -700, y: r.zBottom + gs.outer }], true, 'OUTLINE');
        const R = gs.pipeD / 2;
        const px = 300;
        // צינור אנכי וקשת 90° ליציאה אופקית לניקוז
        w.poly([{ x: px - R, y: dp.zTop }, { x: px - R, y: dp.zBottom + 2 * R }, { x: px - 600, y: dp.zBottom + 2 * R }], false, 'OUTLINE');
        w.poly([{ x: px + R, y: dp.zTop }, { x: px + R, y: dp.zBottom }, { x: px - 600, y: dp.zBottom }], false, 'OUTLINE');
        const nc = Math.max(2, Math.ceil(H / gs.clampSpacing) + 1);
        const zs = Array.from({ length: nc }, (_, i) => dp.zBottom + 2 * R + 150 + ((H - 2 * R - 400) * i) / (nc - 1));
        for (const z of zs) { w.line({ x: px - R - 40, y: z }, { x: px + R + 40, y: z }, 'OUTLINE'); w.line({ x: px - R - 40, y: z }, { x: -110, y: z }, 'THIN'); }
        for (let i = 1; i < zs.length; i++) w.dim({ x: px + R, y: zs[i - 1]! }, { x: px + R, y: zs[i]! }, { x: 0, y: 1 }, -10);
        w.dim({ x: px, y: z0 }, { x: px, y: r.zBottom }, { x: 0, y: 1 }, -26);
        w.level({ x: 700, y: r.zBottom }, r.zBottom, 1, 10);
        w.level({ x: 900, y: z0 }, z0, 1, 10);
        w.text({ x: px + R + 1000, y: r.zBottom - 300 }, `שקע Ø${gs.pipeD} בתחתית המזחלה`, 2.4, 'left', 'TEXT');
        w.text({ x: px + R + 1700, y: (dp.zTop + dp.zBottom) / 2 }, `ירידת מרזב Ø${gs.pipeD}`, 2.5, 'left', 'TEXT', 0, true);
        w.text({ x: px + R + 1700, y: (dp.zTop + dp.zBottom) / 2 - 330 }, `שלות כל ${(gs.clampSpacing / 1000).toFixed(1)} מ' לעמוד`, 2.4, 'left', 'TEXT');
        w.text({ x: px - 300, y: dp.zBottom - 480 }, 'קשת 90° לניקוז', 2.4, 'center', 'TEXT');
        sh.ents.push({ k: 'text', p: { x: area.x0 + half - 6, y: area.y1 - 3 }, s: `פרט ירידת מרזב — חזית  1:${w.scale}`, h: 3, align: 'right', layer: 'TEXT', bold: true });
      }
      const tk = gutterTakeoff(b, runs);
      sh.ents.push({ k: 'text', p: { x: area.x1 - 2, y: area.y0 + 4 }, s: `ירידות: ${tk.reduce((a1, x) => a1 + x.downpipes, 0)} · מרווח מרבי ${(b.cladding!.gutter.downpipeSpacing / 1000).toFixed(1)} מ' · מתלי פח בין המסגרות כל ${(gs.hangerSpacing / 1000).toFixed(1)} מ' (פחחות) · שיפוע אורכי במזחלה לפי הפחח`, h: 2.4, align: 'right', layer: 'TEXT' });
      break;
    }
    case 'cladding': {
      scaleLabel = 'ללא';
      const t = claddingTakeoff(p, d);
      if (!t) break;
      const mm = (x: number) => (x / 1000).toFixed(2);
      const half = (area.x1 - area.x0) / 2 - 6;
      let yR = table(sh, area.x1 - 2, area.y1 - 2, [half * 0.55, half * 0.2, half * 0.25], 'פנלים — כמות ואורכים', ['מיקום ופנל', 'כמות', 'אורך פנל (מ\')'],
        [...t.roofSheets, ...t.wallSheets].map((r) => [`${r.where} · ${r.panel}`, String(r.count), mm(r.length)]));
      yR = table(sh, area.x1 - 2, yR - 6, [half * 0.55, half * 0.2, half * 0.25], 'סיכום שטחים', ['פריט', '', 'כמות'],
        [['חיפוי גג', '', `${t.roofArea.toFixed(1)} מ"ר`], ['חיפוי קירות (נטו)', '', `${t.wallArea.toFixed(1)} מ"ר`], ['פתחים', '', `${t.openingArea.toFixed(1)} מ"ר`], ['ברגי חיפוי', '', String(t.screws)]]);
      const xL2 = area.x1 - half - 8;
      let yL = table(sh, xL2, area.y1 - 2, [half * 0.62, half * 0.18, half * 0.2], 'פחים', ['פריט', '', 'אורך (מ\')'], t.flashings.map((f) => [f.name, '', mm(f.length)]));
      if (t.gutters.length) yL = table(sh, xL2, yL - 6, [half * 0.4, half * 0.15, half * 0.15, half * 0.3], 'מזחלות וירידות מרזב (פרט K-02)', ['מזחלה', 'פריסה', 'אורך (מ\')', 'ירידות'], t.gutters.map((g) => [g.name, g.dev ? `${g.dev}×${g.sheetT}` : '', mm(g.length), `${g.downpipes}×Ø${g.pipeD ?? ''} · ${mm(g.pipeLen ?? 0)} מ' · ${g.clamps ?? 0} שלות`]));
      const ops = b.cladding?.openings ?? [];
      if (ops.length) table(sh, xL2, yL - 6, [half * 0.3, half * 0.3, half * 0.2, half * 0.2], 'פתחים', ['פתח', 'קיר', 'רוחב×גובה', 'אדן'], ops.map((o) => [o.label ?? o.id, WALL_HE[o.wall], `${mm(o.width)}×${mm(o.height)}`, mm(o.sill)]));
      sh.ents.push({ k: 'text', p: { x: area.x1 - 2, y: Math.min(yR, yL) - 8 }, s: 'כמויות נטו לפי הגיאומטריה — יש להוסיף פחת חיתוך וחפיפות לפי יצרן הפנלים. אורכי פנלים בקירות הקצה: עד קו הגג (הגבוה ברוחב הפנל).', h: 2.5, align: 'right', layer: 'TEXT' });
      break;
    }
    case 'plates': {
      const marks = def.refs ?? (def.ref ?? '').split(',');
      const nC = sh.size === 'A4' ? 3 : 4, nR = 2;
      const cw = (area.x1 - area.x0) / nC, chh = (area.y1 - area.y0) / nR;
      marks.forEach((mk, i) => {
        const pt = fab.parts.find((x) => x.mark === mk); if (!pt) return;
        const r = Math.floor(i / nC), c = i % nC;
        const box = { x1: area.x1 - c * cw, x0: area.x1 - (c + 1) * cw, y1: area.y1 - r * chh, y0: area.y1 - (r + 1) * chh };
        if (c) sh.ents.push({ k: 'line', a: { x: box.x1, y: box.y0 + 3 }, b: { x: box.x1, y: box.y1 - 3 }, layer: 'THIN' });
        if (r) sh.ents.push({ k: 'line', a: { x: box.x0 + 3, y: box.y1 }, b: { x: box.x1 - 3, y: box.y1 }, layer: 'THIN' });
        plateCell(sh, pt, fab.parts.filter((x) => x.mark === mk).length, d, box);
      });
      scaleLabel = 'כמצוין';
      break;
    }
    case 'cover': {
      scaleLabel = 'ללא';
      // ---- רשימת שרטוטים (עמודות לפי הצורך), בצד ימין
      const cat = drawingCatalog(p, d, fab);
      const recs = new Map(p.drawings.map((r) => [r.id, r]));
      const rowsAll = cat.map((c) => [c.number, c.title, recs.get(c.id)?.rev ?? p.revision.current, STATUS_HE[recs.get(c.id)?.status ?? 'draft']]);
      const perCol = Math.floor((area.y1 - area.y0 - 14) / 4.4) - 1;
      const cw = [16, 62, 10, 16], W = cw.reduce((a1, x) => a1 + x, 0);
      const nCol = Math.ceil(rowsAll.length / perCol);
      let xr = area.x1 - 2;
      for (let c = 0; c < nCol; c++) {
        table(sh, xr, area.y1 - 2, cw, c === 0 ? `רשימת שרטוטים (${cat.length} גיליונות)` : 'רשימת שרטוטים — המשך', ['מס\'', 'כותרת', 'מהד\'', 'סטטוס'], rowsAll.slice(c * perCol, (c + 1) * perCol).map((r) => [r[0], r[1].length > 34 ? r[1].slice(0, 33) + '…' : r[1], r[2], r[3]]));
        xr -= W + 4;
      }
      // ---- הערות כלליות (משמאל, מעל בלוק הכותרת)
      const hollow = d.members.some((m) => /^(RHS|SHS|CHS)/.test(m.profile));
      const mats = [...new Set(d.members.filter((m) => m.kind !== 'bolt' && m.kind !== 'anchor').map((m) => m.material))].join(', ');
      const exec = p.settings.execClass ?? 'EXC2';
      const notes = [
        'כל המידות במ"מ ומפלסים במטרים. אין למדוד מהשרטוט — לעבוד לפי המידות הרשומות בלבד.',
        `פלדה: ${mats} לפי EN 10025-2 (פרופילים חמים ופלטות)${hollow ? '; פרופילים סגורים לפי EN 10219' : ''}. תעודות חומר 3.1 לפי EN 10204.`,
        'ברגים: דרגה 8.8 (ISO 4014/4017), אומים דרגה 8 (ISO 4032), דסקיות ISO 7089 — מגולוונים בחם (ISO 10684).',
        `ייצור והרכבה לפי EN 1090-2, דרגת ביצוע ${exec}. סבולות ייצור והרכבה — סבולות חיוניות לפי EN 1090-2.`,
        'ריתוך במסגריה בלבד, לפי EN ISO 3834 ו-EN 1090-2; רמת איכות C לפי EN ISO 5817. ריתוכים פינתיים רציפים ואטומים.',
        'סמלי ריתוך לפי ISO 2553 (שיטה A); גודל a = עובי גרון. ריתוך היקפי מסומן בעיגול.',
        `גלוון חם לפי EN ISO 1461 לאחר השלמת כל הריתוכים${hollow ? '; חורי אוורור וניקוז בפרופילים סגורים לפי EN ISO 14713-2 — לאישור המגלוון' : ''}.`,
        'חורים לברגים: קוטר הבורג + 2 מ"מ, אלא אם צוין אחרת. אין לחרור או לקדוח בשטח.',
        'הרכבה בשטח בברגים בלבד. אין לרתך או לחתוך בשטח ללא אישור בכתב מהמתכנן; תיקון גלוון בשטח בצבע עשיר אבץ.',
        'מוטות עיגון ופלטות בסיס לפי תוכנית B-01; פילוס ומילוי גראוט לא מתכווץ לפי המתכנן.',
        'שרטוטי הייצור מבוססים על נתוני התכן שהוזנו; אין בהם בדיקת חוזק. נדרש אישור מהנדס הקונסטרוקציה לפני ייצור.',
      ];
      const nx1 = xr - 2; // שפה ימנית של אזור ההערות (משמאל לטבלאות)
      const nx0 = area.x0 + 2;
      let ny = area.y1 - 6;
      sh.ents.push({ k: 'text', p: { x: nx1, y: ny }, s: 'הערות כלליות', h: 3.5, align: 'right', layer: 'TEXT', bold: true });
      ny -= 7;
      const maxCh = Math.max(40, Math.floor((nx1 - nx0) / 1.45));
      notes.forEach((t, i) => {
        // שבירת שורות לפי רוחב האזור
        const words = t.split(' '); const lines: string[] = []; let cur = '';
        for (const w of words) { if ((cur + ' ' + w).trim().length > maxCh) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
        if (cur) lines.push(cur);
        lines.forEach((ln, j) => { sh.ents.push({ k: 'text', p: { x: nx1, y: ny }, s: j === 0 ? `${i + 1}. ${ln}` : `    ${ln}`, h: 2.5, align: 'right', layer: 'TEXT' }); ny -= 4.2; });
        ny -= 0.8;
      });
      // ---- רשימת ברגי שטח לפי סוג חיבור
      const TYPE_HE: Record<string, string> = { brace: 'אלכסון / אגד', eave: 'קורה-עמוד', ridge: 'רכס', base: 'פלטת בסיס', 'purlin-cleat': 'תומך פטה', 'purlin-splice': 'המשך פטה', 'brace-end': 'קושרת', 'brace-cross': 'הצטלבות קושרות', 'rafter-side': 'קורה לצד עמוד', knee: 'אלכסון עמוד-קורה', 'ridge-tie': 'חיזוק רכס', 'beam-splice': 'המשך קורה' };
      const grp = new Map<string, { type: string; d: number; len: number; grade: string; std: string; n: number }>();
      for (const c of d.connections) for (const bt of c.bolts) {
        if (bt.location !== 'site') continue;
        const key = `${c.type}|${bt.d}|${Math.round(bt.length)}|${bt.grade}`;
        const g = grp.get(key) ?? { type: TYPE_HE[c.type] ?? c.type, d: bt.d, len: Math.round(bt.length), grade: bt.grade, std: bt.standard, n: 0 };
        g.n++; grp.set(key, g);
      }
      const brows = [...grp.values()].sort((a1, b1) => a1.d - b1.d || a1.len - b1.len).map((g) => [g.type, `M${g.d}×${g.len}`, g.grade, g.std, String(g.n)]);
      const tot = [...grp.values()].reduce((a1, g) => a1 + g.n, 0);
      if (brows.length) {
        const bw = [30, 22, 12, 22, 12];
        const yTop = Math.min(ny - 4, area.y0 + 4.4 * (brows.length + 2) + 10);
        table(sh, nx1, yTop, bw, 'רשימת ברגי שטח (בהזמנה להוסיף 10% רזרבה)', ['חיבור', 'בורג', 'דרגה', 'תקן', 'כמות'], brows, ['סה"כ', '', '', '', String(tot)]);
      }
      break;
    }
    case 'anchor-plan': {
      const pr: Proj = (q) => ({ x: q.x, y: q.y });
      const bases = d.connections.filter((c) => c.type === 'base');
      const plateOf = (c: Connection) => c.parts.map((id) => d.byId.get(id)).find((m): m is Member => !!m && m.kind === 'plate');
      const anchorsOf = (c: Connection): P[] => [
        ...c.parts.map((id) => d.byId.get(id)).filter((m): m is Member => !!m && m.kind === 'anchor').map((m) => ({ x: m.start.x, y: m.start.y })),
        ...c.bolts.map((bt) => ({ x: bt.p.x, y: bt.p.y })),
      ];
      const plates = bases.map(plateOf).filter((m): m is Member => !!m);
      const cols = bases.map((c) => d.byId.get(c.members[0])).filter((m): m is Member => !!m);
      const bx = boxOf(solidPts(plates, pr));
      bx.x0 -= 3000; bx.x1 += 3000; bx.y0 -= 2600; bx.y1 += 2600;
      // תוכנית בשמאל הגיליון; עמודה ימנית לפרט טיפוסי ולטבלה
      const colW = 112;
      const planArea = { ...area, x1: area.x1 - colW };
      const v = placeView(sh, bx, planArea, undefined, 10, true); setScale(v);
      for (const g of d.grid) {
        if (g.dir === 'X') { v.line({ x: g.pos, y: bx.y0 + 900 }, { x: g.pos, y: bx.y1 - 900 }, 'AXIS'); v.bubble({ x: g.pos, y: bx.y1 - 400 }, g.label); }
        else { v.line({ x: bx.x0 + 900, y: g.pos }, { x: bx.x1 - 900, y: g.pos }, 'AXIS'); v.bubble({ x: bx.x0 + 400, y: g.pos }, g.label); }
      }
      for (const m of plates) edges(m, pr, v, 'OUTLINE');
      for (const m of cols) edges(m, pr, v, 'THIN');
      const diaOf = (c: Connection) => c.bolts[0]?.d ?? (Number((d.byId.get(c.parts.find((id) => d.byId.get(id)?.kind === 'anchor') ?? '')?.profile ?? '').replace(/\D/g, '')) || 16);
      for (const c of bases) for (const a of anchorsOf(c)) v.circle(a, Math.max(diaOf(c) / 2 + 1, 0.6 * v.scale));
      for (const [i, m] of plates.entries()) { const mk = asmOf(m.id) || asmOf(cols[i]?.id ?? ''); if (mk) v.text({ x: m.start.x + 450, y: m.start.y + 450 }, mk, 2, 'left', 'MARK', 0, true); }
      // מידות צירים
      const xs = d.grid.filter((g) => g.dir === 'X').map((g) => g.pos).sort((a1, a2) => a1 - a2);
      const ys = d.grid.filter((g) => g.dir === 'Y').map((g) => g.pos).sort((a1, a2) => a1 - a2);
      const yD = bx.y0 + 1400, xD = bx.x1 - 1400;
      for (let i = 1; i < xs.length; i++) v.dim({ x: xs[i - 1], y: yD }, { x: xs[i], y: yD }, { x: 1, y: 0 }, 0);
      if (xs.length > 2) v.dim({ x: xs[0], y: yD }, { x: xs[xs.length - 1], y: yD }, { x: 1, y: 0 }, -8);
      for (let i = 1; i < ys.length; i++) v.dim({ x: xD, y: ys[i - 1] }, { x: xD, y: ys[i] }, { x: 0, y: 1 }, 0);
      if (ys.length > 2) v.dim({ x: xD, y: ys[0] }, { x: xD, y: ys[ys.length - 1] }, { x: 0, y: 1 }, -8);

      // פרט טיפוסי מוגדל
      const c0 = bases[0], pm = plateOf(c0), col0 = d.byId.get(c0.members[0]);
      if (pm && col0) {
        const pb = boxOf(solidPts([pm], pr));
        const cen = { x: col0.start.x, y: col0.start.y };
        const det = { x0: area.x1 - colW + 4, x1: area.x1 - 2, y0: area.y1 - 80, y1: area.y1 - 2 };
        const dbx = { x0: pb.x0 - 140, x1: pb.x1 + 140, y0: pb.y0 - 140, y1: pb.y1 + 140 };
        const sc = fitScale(dbx.x1 - dbx.x0, dbx.y1 - dbx.y0, det.x1 - det.x0 - 30, det.y1 - det.y0 - 26);
        const dv = new View(sh, sc, { x: (det.x0 + det.x1) / 2, y: (det.y0 + det.y1) / 2 - 2 }, { x: (pb.x0 + pb.x1) / 2, y: (pb.y0 + pb.y1) / 2 });
        edges(pm, pr, dv, 'OUTLINE'); edges(col0, pr, dv, 'THIN');
        dv.line({ x: cen.x, y: pb.y0 - 100 }, { x: cen.x, y: pb.y1 + 100 }, 'AXIS');
        dv.line({ x: pb.x0 - 100, y: cen.y }, { x: pb.x1 + 100, y: cen.y }, 'AXIS');
        const an = anchorsOf(c0);
        const dia = diaOf(c0);
        for (const a of an) dv.circle(a, (dia + 2) / 2);
        const ux = [...new Set(an.map((a) => Math.round(a.x)))].sort((a1, a2) => a1 - a2);
        const uy = [...new Set(an.map((a) => Math.round(a.y)))].sort((a1, a2) => a1 - a2);
        const chX = [pb.x0, ...ux, pb.x1], chY = [pb.y0, ...uy, pb.y1];
        for (let i = 1; i < chX.length; i++) dv.dim({ x: chX[i - 1], y: pb.y0 }, { x: chX[i], y: pb.y0 }, { x: 1, y: 0 }, -7);
        dv.dim({ x: pb.x0, y: pb.y0 }, { x: pb.x1, y: pb.y0 }, { x: 1, y: 0 }, -13);
        for (let i = 1; i < chY.length; i++) dv.dim({ x: pb.x1, y: chY[i - 1] }, { x: pb.x1, y: chY[i] }, { x: 0, y: 1 }, -7);
        dv.dim({ x: pb.x1, y: pb.y0 }, { x: pb.x1, y: pb.y1 }, { x: 0, y: 1 }, -13);
        sh.ents.push({ k: 'text', p: { x: (det.x0 + det.x1) / 2, y: det.y1 - 4 }, s: `פרט פלטת בסיס טיפוסי  1:${sc}`, h: 2.8, align: 'center', layer: 'TEXT', bold: true });
        sh.ents.push({ k: 'text', p: { x: (det.x0 + det.x1) / 2, y: det.y0 + 3 }, s: `${an.length} × ${c0.bolts.length ? 'M' : 'Φ'}${dia} — ${pm.partDesc ?? pm.profile}`, h: 2.5, align: 'center', layer: 'TEXT' });
      }
      // טבלת פלטות ועוגנים
      const groups = new Map<string, { mk: string; n: number; plate: string; anchors: number; dia: string; len: string }>();
      for (const c of bases) {
        const pl = plateOf(c); if (!pl) continue;
        const anc = c.parts.map((id) => d.byId.get(id)).filter((m): m is Member => !!m && m.kind === 'anchor');
        const an = anchorsOf(c);
        const dia = c.bolts[0] ? `M${c.bolts[0].d}` : anc[0] ? `Φ${anc[0].profile.replace(/\D/g, '')}` : '—';
        const len = c.bolts[0] ? String(Math.round(c.bolts[0].length)) : anc[0] ? String(Math.round(Math.abs(anc[0].start.z - anc[0].end.z))) : '—';
        const key = `${pl.partDesc ?? pl.profile}|${an.length}|${dia}|${len}`;
        const g = groups.get(key) ?? { mk: asmOf(pl.id) || '—', n: 0, plate: (pl.partDesc ?? pl.profile).replace(/^פלט(ה|ת) (בסיס |מבוטנת )?/, ''), anchors: an.length, dia, len };
        g.n++; groups.set(key, g);
      }
      const rows = [...groups.values()].map((g) => [g.mk, g.plate, String(g.n), String(g.anchors), g.dia, g.len]);
      const yEnd = table(sh, area.x1 - 2, area.y1 - 86, [12, 30, 11, 17, 13, 17], 'פלטות בסיס ועוגנים', ['סימון', 'פלטה', 'כמות', 'עוגנים/פלטה', 'קוטר', 'אורך [מ"מ]'], rows,
        ['סה"כ', '', String(bases.length), String(bases.reduce((a1, c) => a1 + anchorsOf(c).length, 0)), '', '']);
      const lb = Object.entries(b.lineBase ?? {}).filter(([, z]) => Math.abs(z - b.baseElevation) > 1);
      const lineLbl = (id: string) => d.section?.lines.find((l) => l.id === id)?.label ?? id;
      const notes = ['הערות:', lb.length ? `1. מפלס פני פלטה ±0.00 = מפלס בסיס העמודים, למעט: ${lb.map(([id, z]) => `ציר ${lineLbl(id)} ${(z - b.baseElevation) >= 0 ? '+' : ''}${((z - b.baseElevation) / 1000).toFixed(2)}`).join(', ')}.` : '1. מפלס פני פלטה ±0.00 = מפלס בסיס העמודים.', '2. מידות לצירים במ"מ; סימון ופילוס לפני יציקה.', '3. סטיית מיקום עוגן מותרת ±3 מ"מ (EN 1090-2).', '4. מילוי גראוט לא מתכווץ מתחת לפלטה, לפי המתכנן.'];
      notes.forEach((t, i) => sh.ents.push({ k: 'text', p: { x: area.x1 - 2, y: yEnd - 6 - i * 4.2 }, s: t, h: 2.5, align: 'right', layer: 'TEXT', bold: i === 0 }));
      // חתך אנכי טיפוסי בפלטת הבסיס: פלטה, עוגנים, תחתית העמוד, מפלס ±0.00, אורכי עיגון
      {
        const c0b = bases[0], pmb = plateOf(c0b), colb = d.byId.get(c0b.members[0]);
        const yTopS = yEnd - 6 - notes.length * 4.2 - 4;
        const box = { x0: area.x1 - colW + 4, x1: area.x1 - 2, y0: area.y0 + 2, y1: yTopS };
        if (pmb && colb && box.y1 - box.y0 > 40) {
          const anc = c0b.parts.map((id) => d.byId.get(id)).filter((m): m is Member => !!m && (m.kind === 'anchor' || m.kind === 'bolt'));
          const z0 = colb.start.z;
          const ancZ = anc.flatMap((m) => [m.start.z, m.end.z]);
          const zLo = Math.min(z0 - 50, ...ancZ), zHi = z0 + 250;
          const xc = colb.start.x;
          const pbx = boxOf(solidPts([pmb], (q) => ({ x: q.x, y: q.z })));
          const wX = Math.max(pbx.x1 - pbx.x0, 300) + 300;
          const ssc = fitScale(wX, zHi - zLo + 60, box.x1 - box.x0 - 26, box.y1 - box.y0 - 10);
          const sv = new View(sh, ssc, { x: (box.x0 + box.x1) / 2 - 6, y: (box.y0 + box.y1) / 2 - 4 }, { x: xc, y: (zLo + zHi) / 2 });
          const prS: Proj = (q) => ({ x: q.x, y: q.z });
          const clipZ = (a: Vec3, b2: Vec3): [Vec3, Vec3] | null => {
            if (a.z > zHi && b2.z > zHi) return null;
            const cl = (p1: Vec3, p2: Vec3) => p1.z <= zHi ? p1 : { x: p2.x + (p1.x - p2.x) * (zHi - p2.z) / (p1.z - p2.z), y: p2.y + (p1.y - p2.y) * (zHi - p2.z) / (p1.z - p2.z), z: zHi };
            return [cl(a, b2), cl(b2, a)];
          };
          edges(pmb, prS, sv, 'OUTLINE');
          edges(colb, prS, sv, 'THIN', clipZ);
          for (const m of anc) edges(m, prS, sv, 'THIN');
          // פני בטון/יציקה
          const xL = pbx.x0 - 220, xR = pbx.x1 + 220;
          const zC = z0 - (pmb.partDesc?.includes('מבוטנת') ? 0 : 30);
          sv.line({ x: xL, y: zC }, { x: xR, y: zC }, 'OUTLINE');
          for (let x = xL; x < xR - 40; x += 60) sv.line({ x, y: zC }, { x: x + 40, y: zC - 40 }, 'THIN');
          sv.line({ x: xc, y: zLo - 40 }, { x: xc, y: zHi }, 'AXIS');
          sv.level({ x: pbx.x1 + 60, y: z0 }, z0 - b.baseElevation, 1, 10);
          if (anc.length) {
            const a0 = anc[0];
            const zb = Math.min(a0.start.z, a0.end.z), zt = Math.max(a0.start.z, a0.end.z);
            sv.dim({ x: pbx.x0 - 120, y: zb }, { x: pbx.x0 - 120, y: zt }, { x: 0, y: 1 }, 4);
          }
          sh.ents.push({ k: 'text', p: { x: (box.x0 + box.x1) / 2, y: box.y1 - 3 }, s: `חתך טיפוסי בפלטת בסיס  1:${ssc}`, h: 2.8, align: 'center', layer: 'TEXT', bold: true });
        }
      }
      break;
    }
    case 'ga': {
      const c30 = Math.cos(Math.PI / 6), s30 = 0.5;
      const pr: Proj = (q) => ({ x: (q.x - q.y) * c30, y: (q.x + q.y) * s30 + q.z });
      const ms = d.members.filter((m) => ['column', 'rafter', 'purlin', 'brace', 'beam'].includes(m.kind));
      const pts = ms.flatMap((m) => [pr(m.start), pr(m.end)]);
      const bx = boxOf(pts);
      bx.x0 -= 2000; bx.x1 += 2000; bx.y0 -= 2000; bx.y1 += 2000;
      const v = placeView(sh, bx, area); setScale(v);
      for (const m of ms) v.line(pr(m.start), pr(m.end), m.kind === 'purlin' || m.kind === 'brace' ? 'THIN' : 'OUTLINE');
      // חלקי חיבור (תומכים, פלטות, פחים) בקווי מתאר דקים — כדי שהשרטוט הכללי יראה את כל מה שמורכב
      for (const m of d.members.filter((x) => x.kind === 'cleat' || x.kind === 'plate')) edges(m, pr, v, 'THIN');
      for (const m of ms.filter((x) => x.kind === 'column' || x.kind === 'rafter')) {
        const mid = pr({ x: (m.start.x + m.end.x) / 2, y: (m.start.y + m.end.y) / 2, z: (m.start.z + m.end.z) / 2 });
        v.text({ x: mid.x, y: mid.y + 250 }, asmOf(m.id), 2, 'center', 'MARK');
      }
      for (const g of d.grid) {
        const ys = b.frames.map((f) => f.y);
        const a = g.dir === 'X' ? { x: g.pos, y: Math.min(...ys) - 1500, z: b.baseElevation } : { x: -1500, y: g.pos, z: b.baseElevation };
        v.bubble(pr(a), g.label);
      }
      // טבלת מכלולים ממוסגרת: סימון | כמות | משקל יח' | משקל כולל
      {
        const rows = bom.assemblies;
        const cw = [16, 11, 17, 19], W = cw.reduce((a1, x) => a1 + x, 0), rh = 4.4;
        const tx1 = area.x1 - 2, tx0 = tx1 - W;
        let y = area.y1 - 2;
        const line = (a: P, b2: P, layer: 'FRAME' | 'THIN' | 'TITLE' = 'THIN') => sh.ents.push({ k: 'line', a, b: b2, layer });
        const top = y;
        sh.ents.push({ k: 'text', p: { x: (tx0 + tx1) / 2, y: y - 4.2 }, s: 'טבלת מכלולים להרכבה', h: 2.8, align: 'center', layer: 'TEXT', bold: true });
        y -= 6;
        line({ x: tx0, y }, { x: tx1, y }, 'TITLE');
        const cell = (vals: string[], bold = false) => {
          let x = tx1;
          vals.forEach((t, i) => { sh.ents.push({ k: 'text', p: { x: x - cw[i] / 2, y: y - rh + 1.3 }, s: t, h: 2.5, align: 'center', layer: 'TEXT', bold }); x -= cw[i]; });
          y -= rh; line({ x: tx0, y }, { x: tx1, y });
        };
        cell(['סימון', 'כמות', 'יח\' [ק"ג]', 'סה"כ [ק"ג]'], true);
        const maxRows = Math.floor((top - area.y0 - 20) / rh) - 2;
        const shown = rows.slice(0, maxRows);
        let tot = 0;
        for (const r of rows) tot += r.unitWeight * r.qty;
        for (const r of shown) cell([r.mark, String(r.qty), r.unitWeight.toFixed(1), (r.unitWeight * r.qty).toFixed(1)]);
        if (rows.length > shown.length) cell([`+${rows.length - shown.length}`, '', '', '']);
        cell(['סה"כ', String(rows.reduce((a1, r) => a1 + r.qty, 0)), '', tot.toFixed(0)], true);
        sh.ents.push({ k: 'poly', pts: [{ x: tx0, y: top }, { x: tx1, y: top }, { x: tx1, y }, { x: tx0, y }], closed: true, layer: 'TITLE' });
        let x = tx1; for (const w of cw.slice(0, -1)) { x -= w; line({ x, y: top - 6 }, { x, y }); }
      }
      break;
    }
    case 'connection': {
      const c = d.connById.get(def.ref!)!;
      const ids = [...c.members, ...c.parts.flatMap((x) => [x, `${x}.H`, `${x}.S`, `${x}.N`])];
      const ms = ids.map((x) => d.byId.get(x)).filter((m): m is Member => !!m);
      const first = d.byId.get(c.parts[0])!;
      const fs = cachedSolidPure(first);
      const cen = [...fs.startRing, ...fs.endRing].reduce((a, q) => ({ x: a.x + q.x, y: a.y + q.y, z: a.z + q.z }), { x: 0, y: 0, z: 0 });
      const n = fs.startRing.length * 2;
      const C = { x: cen.x / n, y: cen.y / n, z: cen.z / n };
      // חיבורים מישוריים (פלטת המשך, פחי קושרות): מבט בניצב לפלטה; האחרים — חתך במישור המסגרת
      const planar = c.type === 'purlin-splice' || c.type === 'brace-end' || c.type === 'brace-cross';
      const R = c.type === 'purlin-cleat' ? 300 : planar ? 220 : c.type === 'eave' || c.type === 'ridge' || c.type === 'base' || c.type === 'beam-splice' ? 420 : 600;
      let pr: Proj = (q) => ({ x: q.x, y: q.z });
      let Cp = { x: C.x, y: C.z };
      if (planar) {
        const lf = localFrame(first);
        const e1 = lf.ex, e2 = lf.u; // בסיס במישור הפלטה (v = נורמל הפלטה)
        pr = (q) => ({ x: dot(sub(q, C), e1), y: dot(sub(q, C), e2) });
        Cp = { x: 0, y: 0 };
      }
      const box = { x0: Cp.x - R, x1: Cp.x + R, y0: Cp.y - R, y1: Cp.y + R };
      // פלטות החיבור (מבט פנים עם מידות וחורים) ברצועה התחתונה, והמבט הראשי מעליה
      const plateMarks = [...new Map(c.parts.map((x) => fab.parts.find((q) => q.memberId === x)).filter((q): q is NonNullable<typeof q> => !!q && d.byId.get(q.memberId)?.kind === 'plate').map((q) => [q.mark, q])).values()].slice(0, 4);
      const stripY1 = plateMarks.length ? area.y0 + 74 : area.y0;
      const v = placeView(sh, box, { ...area, x1: area.x1 - 120, y0: stripY1 + 4 }); setScale(v);
      if (plateMarks.length) {
        const sx0 = area.x0, sx1 = area.x1 - 124, w = (sx1 - sx0) / plateMarks.length;
        plateMarks.forEach((pm, i) => plateFaceInBox(sh, pm, d, { x0: sx0 + i * w, x1: sx0 + (i + 1) * w - 3, y0: area.y0, y1: stripY1 }));
        sh.ents.push({ k: 'text', p: { x: sx1, y: stripY1 + 2 }, s: 'פלטות החיבור — מידות במ"מ, מרכזי חורים מהשפות', h: 2.5, align: 'right', layer: 'TEXT', bold: true });
      }
      const clipBox = (a: Vec3, bb: Vec3): [Vec3, Vec3] | null => {
        // קיטום לחלון (בקואורדינטות המבט; ההיטל ליניארי)
        let t0 = 0, t1 = 1;
        const pa = pr(a), pb = pr(bb);
        const dx = pb.x - pa.x, dz = pb.y - pa.y;
        for (const [pp, q] of [[-dx, pa.x - box.x0], [dx, box.x1 - pa.x], [-dz, pa.y - box.y0], [dz, box.y1 - pa.y]]) {
          if (pp === 0) { if (q < 0) return null; continue; }
          const r = q / pp;
          if (pp < 0) { if (r > t1) return null; t0 = Math.max(t0, r); } else { if (r < t0) return null; t1 = Math.min(t1, r); }
        }
        const L = (t: number) => ({ x: a.x + (bb.x - a.x) * t, y: a.y + (bb.y - a.y) * t, z: a.z + (bb.z - a.z) * t });
        return [L(t0), L(t1)];
      };
      for (const m of ms) {
        const poly = planar ? null : cutAtY(m, C.y);
        if (poly && (m.kind === 'purlin' || m.kind === 'cleat')) { v.poly(poly, true, 'CUT', true); continue; }
        edges(m, pr, v, m.kind === 'bolt' || m.kind === 'anchor' ? 'THIN' : 'OUTLINE', clipBox);
      }
      connDims(v, c, d, pr, planar, pr(C));
      // טבלת ברגים וריתוכים
      let y = area.y1 - 8;
      const tx = area.x1 - 4;
      const T = (s: string, bold = false) => { sh.ents.push({ k: 'text', p: { x: tx, y }, s, h: 2.5, align: 'right', layer: 'TEXT', bold }); y -= 4.5; };
      T(c.label, true);
      T(`סטטוס: ${c.status === 'approved' ? 'מאושר' : c.status === 'for-review' ? 'לבדיקה' : 'לא מאומת'}`);
      const agg = new Map<string, number>();
      for (const bo of c.bolts) { const k = `M${bo.d}×${bo.length} ${bo.grade}, חור Ø${bo.hole}, ${bo.location === 'site' ? 'שטח' : 'מסגריה'}`; agg.set(k, (agg.get(k) ?? 0) + 1); }
      for (const [k, q] of agg) T(`${q}× ${k}`);
      for (const w of c.welds.slice(0, 6)) T(`ריתוך פינתי a${w.a}, L=${Math.round(w.length)} — ${w.location === 'shop' ? 'מסגריה' : 'שטח (תיקון גלוון)'}`);
      for (const pid of c.parts.filter((x) => d.byId.get(x)?.kind === 'plate' || d.byId.get(x)?.kind === 'cleat')) {
        const pm = fab.parts.find((x) => x.memberId === pid);
        if (pm) T(`${pm.mark}: ${pm.desc}`);
      }
      // תלת־ממד מוצלל של החיבור (חלקי החיבור + קטע מהאלמנטים הראשיים סביבו)
      {
        const near = (m: Member) => { const s0 = cachedSolidPure(m); return [...s0.startRing, ...s0.endRing].some((q) => Math.hypot(q.x - C.x, q.y - C.y, q.z - C.z) < 2500); };
        // האלמנטים הראשיים תמיד (מקוצרים סביב החיבור); ברגים מלאים — ראש, גוף ואום (כך החור "ממולא" ונראה נכון)
        const isoMs = ms.filter((m) => c.members.includes(m.id) || near(m));
        const clipLoc = (q: Vec3) => ({ t: Math.max(Math.abs(q.x - C.x), Math.abs(q.y - C.y), Math.abs(q.z - C.z)), u: 0, v: 0 });
        void clipLoc;
        renderIso(sh, isoMs.map((m) => (c.members.includes(m.id) ? trimNear(m, C, R * 1.6) : m)), isoMs.map((m) => fab.parts.find((x) => x.memberId === m.id)?.mark ?? ''),
          { x0: area.x1 - 125, x1: area.x1 - 4, y0: area.y0 + 4, y1: y - 16 }, null, () => ({ t: 0, u: 0, v: 0 }), 'תלת־ממד (ללא קנ"מ)', [], isoRot(c, d, C), true);
      }
      T(planar ? 'מבט: בניצב למישור הפלטה.' : 'מבט: חתך במישור המסגרת (לאורך Y). חלקים חתוכים – ממולאים.');
      if (c.type === 'purlin-cleat') {
        const st = c.parts.some((x) => x.endsWith('.ST')) ? 'plate' : d.byId.get(c.parts[0])?.partDesc?.includes('עומד') ? 'stand' : 'run';
        T(st === 'run' ? 'כיוון: רגל הזוויתן עם החורים צמודה לווב הפטה; רגל הבסיס מרותכת לקורה, בצד הרחוק מהאגף התחתון של הפטה.'
          : st === 'stand' ? 'כיוון: רגל הזוויתן עם החורים צמודה לווב הפטה (חורים אנכיים); הרגל השנייה ניצבת לווב, בצד הרחוק מהפטה.'
          : 'כיוון: פני הפלטה עם החורים צמודים לווב הפטה; משולש התמיכה מאחורי הפלטה — בצד הרחוק מהפטה, במרכז בין הברגים.');
        if (c.bolts.length === 4 && st === 'plate') T('תושבת בתפר פטה: 2 ברגים לכל פטה — שני קצות הפטות נפגשים מעל התושבת.');
      }
      T('גיאומטריה בלבד — אין בדיקת חוזק לברגים, ריתוכים ופלטות.');
      break;
    }
    case 'assembly': {
      const [mk, sub2] = def.ref!.split('|');
      scaleLabel = sub2 === 'list' ? assemblyListSheet(sh, fab, d, mk) : assemblySheet(sh, fab, d, mk, bigAssembly(fab, mk) ? 'main' : 'full');
      break;
    }
    case 'part': {
      scaleLabel = partSheet(sh, fab, d, def.ref!);
      break;
    }
  }
  sh.title.scale = scaleLabel || '—';
  frameAndTitle(sh);
  return sh;
}

/** חתימת תוכן השרטוט — לזיהוי שינוי מאז האישור (ללא תאריך וסטטוס). */
export function sheetHash(sh: Sheet): string {
  const ents = sh.ents.filter((e) => e.layer !== 'TITLE');
  const str = JSON.stringify(ents, (_k, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v));
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}

/** קיטום אלמנט ראשי לקטע סביב נקודה (לתלת־ממד של פרט חיבור): קו ייחוס חדש בתחום ±r לאורך הציר. */
/** צד צפייה לתלת־ממד של חיבור: הצופה בצד שבו נמצאות הפלטות ביחס לאלמנטים הראשיים */
function isoRot(c: Connection, d: DerivedModel, C: Vec3): number {
  const plates = c.parts.map((x) => d.byId.get(x)).filter((m): m is Member => !!m && (m.kind === 'plate' || m.kind === 'cleat'));
  if (!plates.length) return 0;
  const pc = plates.reduce((a, m) => ({ x: a.x + (m.start.x + m.end.x) / 2 / plates.length, y: a.y + (m.start.y + m.end.y) / 2 / plates.length }), { x: 0, y: 0 });
  // מרכז האלמנטים הראשיים: הנקודה הקרובה ל-C על כל ציר
  const mains = c.members.map((x) => d.byId.get(x)).filter((m): m is Member => !!m);
  const near = mains.map((m) => { const f = localFrame(m); const t = Math.max(0, Math.min(f.length, dot(sub(C, m.start), f.ex))); return { x: m.start.x + f.ex.x * t, y: m.start.y + f.ex.y * t }; });
  const mc = near.length ? near.reduce((a, q) => ({ x: a.x + q.x / near.length, y: a.y + q.y / near.length }), { x: 0, y: 0 }) : { x: C.x, y: C.y };
  const v = { x: pc.x - mc.x, y: pc.y - mc.y };
  if (Math.hypot(v.x, v.y) < 5) return 0;
  // הצופה בברירת המחדל בכיוון (−1,−1); אחרי סיבוב k: R(−k)·(−1,−1)
  let best = 0, bv = -Infinity;
  for (let k = 0; k < 4; k++) {
    const a = (-k * Math.PI) / 2, w = { x: -Math.cos(a) + Math.sin(a), y: -Math.sin(a) - Math.cos(a) };
    const sc = w.x * v.x + w.y * v.y;
    if (sc > bv + 1e-6) { bv = sc; best = k; }
  }
  return best;
}

function trimNear(m: Member, C: Vec3, r: number): Member {
  const f = localFrame(m);
  const t = dot(sub(C, m.start), f.ex);
  const t0 = Math.max(0, t - r), t1 = Math.min(f.length, t + r);
  const at = (k: number) => ({ x: m.start.x + f.ex.x * k, y: m.start.y + f.ex.y * k, z: m.start.z + f.ex.z * k });
  return { ...m, id: `${m.id}#trim`, start: at(t0), end: at(t1), startCut: t0 > 0 ? undefined : m.startCut, endCut: t1 < f.length ? undefined : m.endCut };
}

/** מיקומי רכס (x) מתוך צמתי המודל */
function ridgeXs(d: DerivedModel): number[] { return [...new Set(d.nodes.filter((n) => n.role === 'רכס').map((n) => Math.round(n.p.x)))]; }
/** תחום צירי העמודים */
function lineSpan(d: DerivedModel): [number, number] { const xs = (d.section?.lines ?? []).map((l) => l.x); return xs.length ? [Math.min(...xs), Math.max(...xs)] : [0, 0]; }

/**
 * מידות בפרט חיבור (בקשת משתמש: "ברמת PRO"): לכל פלטה — שרשרת לאורך הכיוון הראשי שלה: שפה → מרכזי ברגים → שפה,
 * ואורך כולל; ולפי סוג החיבור — מידות מיקום: תומך פטה (גובה, רגל, גובה חור מפני הקורה), אלכסון (ירידה, זווית),
 * ראש עמוד (מרחק קצה הפלטה מציר העמוד), בסיס (מידות הפלטה מציר העמוד).
 */
function connDims(v: View, c: Connection, d: DerivedModel, pr: (q: Vec3) => P, planar: boolean, ctr: P) {
  void ctr;
  type Q = { x: number; y: number };
  const norm2 = (a: Q) => { const l = Math.hypot(a.x, a.y) || 1; return { x: a.x / l, y: a.y / l }; };
  const dot2 = (a: Q, b: Q) => a.x * b.x + a.y * b.y;
  const seen = new Set<string>();
  const byIdD = (id: string) => d.byId.get(id);
  let nDone = 0;
  // שרשרות פלטה במבט הראשי — לחיבורים שבהם מיקום הפלטה במבט הוא העיקר; באלכסונים ובפחי קושרות המידות במבטי הפלטות שברצועה
  const chainTypes = new Set(['eave', 'ridge', 'base', 'beam-splice', 'rafter-side', 'purlin-splice', 'ridge-tie']);
  for (const pid of chainTypes.has(c.type) ? c.parts : []) {
    const m = d.byId.get(pid);
    if (!m || (m.kind !== 'plate' && m.kind !== 'cleat') || nDone >= 3) continue;
    const s0 = cachedSolidPure(m);
    const pts = [...s0.startRing, ...s0.endRing].map(pr);
    // כיוון ראשי בהיטל: הציר הארוך מבין אורך האלמנט ופריסת הנקודות
    const cx = pts.reduce((a, q) => a + q.x, 0) / pts.length, cy = pts.reduce((a, q) => a + q.y, 0) / pts.length;
    let sxx = 0, syy = 0, sxy = 0;
    for (const q of pts) { sxx += (q.x - cx) ** 2; syy += (q.y - cy) ** 2; sxy += (q.x - cx) * (q.y - cy); }
    const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const e = norm2({ x: Math.cos(ang), y: Math.sin(ang) }), nrm = { x: -e.y, y: e.x };
    const proj = (q: Q) => dot2({ x: q.x - cx, y: q.y - cy }, e);
    const side = (q: Q) => dot2({ x: q.x - cx, y: q.y - cy }, nrm);
    const sMin = Math.min(...pts.map(proj)), sMax = Math.max(...pts.map(proj));
    if (sMax - sMin < 25) continue; // פלטה בחתך — נראית כקו עובי
    const bolts = c.bolts.filter((b) => b.holesIn.includes(pid)).map((b) => proj(pr(b.p)));
    const bs = [...new Set(bolts.map((x) => Math.round(x * 2) / 2))].sort((a, b) => a - b);
    const key = `${Math.round(sMax - sMin)}|${bs.map((x) => Math.round(x - sMin)).join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // המידות בצד הרחוק ממרכז החיבור (מחוץ לאלמנטים)
    // הצד עם פחות "חומר" של האלמנטים הראשיים (עמוד/קורה) בטווח הפלטה — שם המידות לא נופלות על פרופיל
    const near = c.members.map(byIdD).filter((x): x is Member => !!x).flatMap((mm) => { const ss = cachedSolidPure(mm); const ring = [...ss.startRing, ...ss.endRing]; const out: P[] = []; const nK = Math.min(400, Math.ceil(Math.hypot(ss.endRing[0].x - ss.startRing[0].x, ss.endRing[0].y - ss.startRing[0].y, ss.endRing[0].z - ss.startRing[0].z) / 40)); for (let i = 0; i < ss.startRing.length; i++) for (let k = 0; k <= nK; k++) { const a = ss.startRing[i], b = ss.endRing[i]; out.push(pr({ x: a.x + (b.x - a.x) * k / nK, y: a.y + (b.y - a.y) * k / nK, z: a.z + (b.z - a.z) * k / nK })); } void ring; return out; })
      .filter((q) => { const sv = proj(q); return sv > sMin - 30 && sv < sMax + 30 && Math.abs(side(q)) < 700; });
    // המידות מעבר לכל החומר שבטווח הפלטה, בצד שבו החומר נגמר מוקדם יותר
    const ext0 = (sgn: number) => Math.max(0, ...near.filter((q) => side(q) * sgn > 0).map((q) => Math.abs(side(q))));
    const plateOut = (sgn: number) => Math.max(...pts.map((q) => side(q) * sgn));
    const sg = ext0(1) - plateOut(1) <= ext0(-1) - plateOut(-1) ? 1 : -1;
    const clear = Math.max(0, ext0(sg) - plateOut(sg)) / v.scale;
    const nOut = sg > 0 ? Math.max(...pts.map(side)) : Math.min(...pts.map(side));
    const at = (sv: number): P => ({ x: cx + e.x * sv + nrm.x * nOut, y: cy + e.y * sv + nrm.y * nOut });
    const chain = [sMin, ...bs.filter((x) => x > sMin + 1 && x < sMax - 1), sMax];
    const off = sg * (clear + 7 + nDone * 12);
    if (chain.length > 2) for (let i = 1; i < chain.length; i++) v.dim(at(chain[i - 1]), at(chain[i]), e, off);
    v.dim(at(sMin), at(sMax), e, off + sg * (chain.length > 2 ? 6 : 0));
    nDone++;
  }
  const byId = (id: string) => d.byId.get(id);
  if (c.type === 'purlin-cleat') {
    const cl = c.parts.map(byId).find((m) => m?.kind === 'cleat');
    const pur = c.members.map(byId).find((m) => m?.purlin);
    if (cl && pur && !planar) {
      const n = pur.purlin!.roofNormal; const nn = norm2({ x: n.x, y: n.z }); const t = { x: nn.y, y: -nn.x };
      const pts = [...cachedSolidPure(cl).startRing, ...cachedSolidPure(cl).endRing].map(pr);
      const base = pts.reduce((a, q) => (dot2(q, nn) < dot2(a, nn) ? q : a));
      const topP = pts.reduce((a, q) => (dot2(q, nn) > dot2(a, nn) ? q : a));
      const sideP = pts.reduce((a, q) => (dot2(q, t) > dot2(a, t) ? q : a));
      v.dim(base, topP, nn, -14, undefined);
      const b0 = c.bolts[0];
      if (b0) v.dim(base, pr(b0.p), nn, -24, undefined);
      v.dim(pts.reduce((a, q) => (dot2(q, t) < dot2(a, t) ? q : a)), sideP, t, -10);
    }
  }
  if (c.type === 'knee' && c.id.startsWith('C.KB.')) {
    const col = byId(c.members[0]), raf = byId(c.members[1]), br = c.parts.map(byId).find((m) => m?.kind === 'brace');
    if (col && raf && br && !planar) {
      const a = pr(br.start), b = pr(br.end);
      const ang = Math.abs((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI);
      v.dim(a, { x: a.x, y: b.y }, { x: 0, y: 1 }, a.x < b.x ? -12 : 12, undefined);
      v.dim(a, { x: b.x, y: a.y }, { x: 1, y: 0 }, -10, undefined);
      v.text({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, `${Math.round(Math.min(ang, 180 - ang))}°`, 2.5, 'center', 'DIM');
    }
  }
  if (c.type === 'eave' || c.type === 'base') {
    const col = c.members.map(byId).find((m) => m?.kind === 'column');
    const pl = c.parts.map(byId).find((m) => m?.kind === 'plate');
    if (col && pl && !planar) {
      const ax = pr(c.type === 'eave' ? col.end : col.start);
      const pts = [...cachedSolidPure(pl).startRing, ...cachedSolidPure(pl).endRing].map(pr);
      const lo = pts.reduce((q, w) => (w.x < q.x ? w : q)), hi = pts.reduce((q, w) => (w.x > q.x ? w : q));
      // ראש עמוד: מעל כל החומר (קורה) ומעל שרשרת הפלטה; בסיס: מתחת לפלטה
      const memPts = c.members.map(byId).filter((x): x is Member => !!x).flatMap((mm) => { const ss = cachedSolidPure(mm); return [...ss.startRing, ...ss.endRing].map(pr); });
      const inRange = memPts.filter((q) => q.x > lo.x - 50 && q.x < hi.x + 50);
      const yy = c.type === 'eave' ? Math.max(...pts.map((q) => q.y), ...inRange.filter((q) => q.y > ax.y && q.y < ax.y + 1500).map((q) => q.y)) : Math.min(...pts.map((q) => q.y));
      const off = c.type === 'eave' ? 33 : -16;
      v.dim({ x: lo.x, y: yy }, { x: ax.x, y: yy }, { x: 1, y: 0 }, off);
      v.dim({ x: ax.x, y: yy }, { x: hi.x, y: yy }, { x: 1, y: 0 }, off);
      v.line({ x: ax.x, y: yy - 200 }, { x: ax.x, y: yy + 200 }, 'AXIS');
    }
  }
}
