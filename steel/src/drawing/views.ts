import { dot, sub, type Vec3 } from '../core/vec';
import { localFrame } from '../geometry/frame';
import { cachedSolidPure, silhouetteEdges } from './solidCache';
import { partSheet, plateFaceInBox } from './part';
import { assemblySheet, renderIso } from './assembly';
import { purlinParams } from '../geometry/purlins';
import { getProfile } from '../profiles/library';
import type { Bom } from '../fab/bom';
import type { Fabrication } from '../fab/marks';
import type { DerivedModel, DrawingRecord, DrawingType, Member, Project } from '../model/types';
import { drawArea, fitScale, frameAndTitle, newSheet, today, View, type P, type Sheet, type SheetSize, type TitleInfo } from './sheet';

export interface DrawingDef { id: string; type: DrawingType; number: string; title: string; ref?: string }

const num = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });

/** קטלוג השרטוטים הנגזר מהמודל. המזהים יציבים; מספרי השרטוטים נגזרים מהמזהה. */
export function drawingCatalog(p: Project, d: DerivedModel, fab: Fabrication): DrawingDef[] {
  const out: DrawingDef[] = [];
  out.push({ id: 'D-GA', type: 'ga', number: 'G-01', title: 'שרטוט כללי והרכבה – איזומטריה' });
  out.push({ id: 'D-ROOF', type: 'roof-plan', number: 'R-01', title: 'תוכנית גג ופריסת פטות' });
  p.building.frames.forEach((f, i) => out.push({ id: `D-FRAME-${f.id}`, type: 'frame', number: `F-${String(i + 1).padStart(2, '0')}`, title: `חתך מסגרת – ציר ${i + 1}`, ref: f.id }));
  out.push({ id: 'D-SIDE-L', type: 'side', number: 'E-01', title: 'חזית צד – ציר א', ref: 'L' });
  out.push({ id: 'D-SIDE-R', type: 'side', number: 'E-02', title: 'חזית צד – ציר ב', ref: 'R' });
  const types: [string, string][] = [['eave', 'פרט חיבור קורה-עמוד'], ['ridge', 'פרט חיבור רכס'], ['base', 'פרט פלטת בסיס'], ['purlin-cleat', 'פרט תומך פטה'], ['purlin-splice', 'פרט חיבור המשך פטה'], ['brace-end', 'פרט פח חיבור קושרת'], ['brace-cross', 'פרט הצטלבות קושרות'], ['rafter-side', 'פרט חיבור קורה לצד עמוד'], ['knee', 'פרט אלכסון עמוד-קורה'], ['ridge-tie', 'פרט חיזוק רכס אופקי']];
  types.forEach(([t, title], i) => {
    const c = d.connections.find((x) => x.type === t);
    if (c) out.push({ id: `D-CONN-${t}`, type: 'connection', number: `D-${String(i + 1).padStart(2, '0')}`, title, ref: c.id });
  });
  const asm = [...new Set(fab.assemblies.map((a) => a.mark))].sort(num);
  for (const m of asm) out.push({ id: `D-ASM-${m}`, type: 'assembly', number: `A-${m}`, title: `שרטוט מכלול ${m}`, ref: m });
  const parts = [...new Set(fab.parts.map((x) => x.mark))].sort(num);
  for (const m of parts) out.push({ id: `D-PART-${m}`, type: 'part', number: `P-${m}`, title: `שרטוט חלק ${m}`, ref: m });
  return out;
}

const STATUS_HE: Record<string, string> = { draft: 'טיוטה', 'for-review': 'לבדיקה', approved: 'מאושר לייצור' };

function titleOf(p: Project, def: DrawingDef, rec: DrawingRecord | undefined, scaleLabel: string): TitleInfo {
  const status = rec?.status ?? 'draft';
  return {
    company: 'כיאן הנדסה', project: p.meta.name, projectNo: p.meta.number, client: p.meta.client, title: def.title,
    number: def.number, rev: rec?.rev ?? p.revision.current, scale: scaleLabel, date: today(), status: STATUS_HE[status],
    drawnBy: p.meta.designer, checkedBy: p.settings.checkedBy, approvedBy: status === 'approved' ? p.settings.approvedBy : '',
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
function placeView(sh: Sheet, box: { x0: number; x1: number; y0: number; y1: number }, area: { x0: number; y0: number; x1: number; y1: number }, scale?: number, margin = 18): View {
  const sc = scale ?? fitScale(box.x1 - box.x0, box.y1 - box.y0, area.x1 - area.x0 - 2 * margin, area.y1 - area.y0 - 2 * margin);
  const cx = (area.x0 + area.x1) / 2, cy = (area.y0 + area.y1) / 2;
  return new View(sh, sc, { x: cx, y: cy }, { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 });
}

export function buildSheet(def: DrawingDef, p: Project, d: DerivedModel, fab: Fabrication, bom: Bom, rec?: DrawingRecord): Sheet {
  const size: SheetSize = rec?.sheet ?? 'A3';
  const sh = newSheet(size, titleOf(p, def, rec, ''), 1);
  const area = drawArea(sh);
  let scaleLabel = '';
  const setScale = (v: View) => { scaleLabel = `1:${v.scale}`; sh.scale = v.scale; };
  const b = p.building;
  const asmOf = (memberId: string) => {
    const part = fab.parts.find((x) => x.memberId === memberId);
    return part ? fab.assemblies.find((a) => a.id === part.assembly)?.mark ?? '' : '';
  };

  switch (def.type) {
    case 'roof-plan': {
      const ys0 = () => d.grid.filter((g) => g.dir === 'Y').map((g) => g.pos);
      const pr: Proj = (q) => ({ x: q.x, y: q.y });
      const main = d.members.filter((m) => ['rafter', 'purlin', 'column'].includes(m.kind));
      const bx = boxOf(solidPts(main, pr));
      bx.x0 -= 3000; bx.x1 += 3000; bx.y0 -= 2500; bx.y1 += 2500;
      const v = placeView(sh, bx, area); setScale(v);
      // צירים
      for (const g of d.grid) {
        if (g.dir === 'X') { v.line({ x: g.pos, y: bx.y0 + 800 }, { x: g.pos, y: bx.y1 - 800 }, 'AXIS'); v.bubble({ x: g.pos, y: bx.y1 - 300 }, g.label); }
        else { v.line({ x: bx.x0 + 800, y: g.pos }, { x: bx.x1 - 800, y: g.pos }, 'AXIS'); v.bubble({ x: bx.x0 + 300, y: g.pos }, g.label); }
      }
      for (const rx of ridgeXs(d)) v.line({ x: rx, y: bx.y0 + 1500 }, { x: rx, y: bx.y1 - 1500 }, 'AXIS');
      const raf = getProfile(b.rafterProfile);
      for (const m of d.members.filter((x) => x.kind === 'rafter')) {
        const hb = raf.props.b / 2;
        const xs = [m.start.x, m.end.x];
        v.poly([{ x: xs[0], y: m.start.y - hb }, { x: xs[1], y: m.start.y - hb }, { x: xs[1], y: m.start.y + hb }, { x: xs[0], y: m.start.y + hb }], true, 'OUTLINE');
      }
      for (const m of d.members.filter((x) => x.kind === 'column')) {
        const c = getProfile(m.profile);
        v.poly([{ x: m.start.x - c.props.h / 2, y: m.start.y - c.props.b / 2 }, { x: m.start.x + c.props.h / 2, y: m.start.y - c.props.b / 2 }, { x: m.start.x + c.props.h / 2, y: m.start.y + c.props.b / 2 }, { x: m.start.x - c.props.h / 2, y: m.start.y + c.props.b / 2 }], true, 'OUTLINE', true);
      }
      const purl = d.members.filter((m) => m.purlin);
      for (const m of purl) v.line({ x: m.start.x, y: m.start.y }, { x: m.end.x, y: m.end.y }, 'OUTLINE');
      // תווית אחת לכל שיפוע: חתך וסימוני החלקים
      for (const side of ['L', 'R', 'M'] as const) {
        const ls = purl.filter((m) => m.purlin!.side === side);
        if (!ls.length) continue;
        const marks = [...new Set(fab.parts.filter((x) => ls.some((m) => m.id === x.memberId)).map((x) => x.mark))].sort(num);
        const xm = ls.reduce((acc, m) => acc + m.start.x, 0) / ls.length;
        const ym = (Math.min(...ys0()) + Math.max(...ys0())) / 2 + (b.frames.length > 2 ? (b.frames[1].y - b.frames[0].y) / 2 : 0);
        v.text({ x: xm, y: ym }, `פטות ${ls[0].profile} (${marks.join(', ')})`, 2.4, 'center', 'MARK');
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
      v.dim({ x: xr, y: ys[0] }, { x: xr, y: ys[ys.length - 1] }, { x: 0, y: 1 }, 8);
      { const [lx0, lx1] = lineSpan(d); v.dim({ x: lx0, y: bx.y0 + 1200 }, { x: lx1, y: bx.y0 + 1200 }, { x: 1, y: 0 }, -6); }
      // פריסת פטות: שרשרת מידות מעל, הטקסט = מרחק לאורך השיפוע (או אופקי, מסומן)
      const ytop = Math.max(...ys) + b.purlinOverhangEnd + 900;
      for (const side of [...new Set(purl.map((m) => m.purlin!.side))]) {
        const ls = purl.filter((m) => m.purlin!.side === side).sort((a1, a2) => a1.purlin!.index - a2.purlin!.index);
        const plS = d.section?.planes.find((q) => q.id === side);
        const free = ls[0]?.purlin!.startFree ?? side === 'M';
        let prevX: number | null = free ? null : plS ? (plS.startAt === 'b' ? plS.b.x : plS.a.x) : b.ridgeX;
        let prevS = 0;
        ls.forEach((m) => {
          const pi = m.purlin!;
          if (prevX !== null) {
            const span = pi.sSlope - prevS;
            const rem = pi.isLast && pi.index > 1 && Math.abs(span - purlinParams(b.purlins, pi.paramKey ?? (side === 'R' ? 'right' : 'left')).spacing) > 0.5;
            v.dim({ x: prevX, y: ytop }, { x: m.start.x, y: ytop }, { x: 1, y: 0 }, 4, `${Math.round(span)}${rem ? '*' : ''}`);
          }
          prevX = m.start.x; prevS = pi.sSlope;
        });
      }
      v.text({ x: (bx.x0 + bx.x1) / 2, y: ytop + 1500 }, 'מידות פטות לאורך השיפוע (מ"מ); * מרווח שאריתי; × חיבור המשך – דורש תכנון', 2.4, 'center', 'TEXT');
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
      colsF.forEach((c, i) => v.dim({ x: c.start.x, y: b.baseElevation }, { x: c.start.x, y: c.end.z }, { x: 0, y: 1 }, i === 0 ? 14 : i === colsF.length - 1 ? -14 : 8));
      for (const nd of d.nodes.filter((x) => x.frameId === f.id && x.role === 'רכס')) v.dim({ x: nd.p.x, y: b.baseElevation }, { x: nd.p.x, y: nd.p.z }, { x: 0, y: 1 }, 0);
      const lbl = (m?: Member) => m && v.text({ x: (m.start.x + m.end.x) / 2, y: (m.start.z + m.end.z) / 2 + 250 }, `${asmOf(m.id)} ${m.profile}`, 2.4, 'center', 'MARK');
      for (const m of own.filter((x) => x.kind === 'column' || x.kind === 'rafter')) lbl(m);
      const slopesTxt = (d.section?.planes ?? []).map((q) => `${Math.abs(((q.b.z - q.a.z) / (q.b.x - q.a.x)) * 100).toFixed(1)}%`).join(' / ');
      v.text({ x: (bx.x0 + bx.x1) / 2, y: bx.y1 - 300 }, `שיפוע ${slopesTxt}  ·  מבט לאורך Y, מסגרת ${fi}`, 2.4, 'center', 'TEXT');
      v.text({ x: 0, y: b.baseElevation - 1400 }, `±${(b.baseElevation / 1000).toFixed(2)}`, 2.2, 'center', 'TEXT');
      break;
    }
    case 'side': {
      const side = def.ref as 'L' | 'R';
      const lnS = [...(d.section?.lines ?? [])].sort((a1, a2) => a1.x - a2.x);
      const lineS = side === 'L' ? lnS[0] : lnS[lnS.length - 1];
      const x0 = lineS?.x ?? (side === 'L' ? 0 : b.width);
      const pr: Proj = (q) => ({ x: q.y, y: q.z });
      const ms = d.members.filter((m) => (m.kind === 'column' && (m.lineId === lineS?.id || m.side === side)) || (m.id.startsWith('BR.W') && (m.id.includes(`.${side}.`) || (lineS && m.id.includes(`.${lineS.id}.`)))));
      const bx = boxOf(solidPts(ms, pr));
      bx.x0 -= 2500; bx.x1 += 2500; bx.y0 -= 1500; bx.y1 += 1500;
      const v = placeView(sh, bx, area); setScale(v);
      for (const m of ms) edges(m, pr, v);
      const ys = b.frames.map((f) => f.y);
      const eave = Math.max(...ms.filter((m) => m.kind === 'column').map((m) => m.end.z), b.baseElevation + 1000);
      v.line({ x: Math.min(...ys) - b.purlinOverhangStart, y: eave }, { x: Math.max(...ys) + b.purlinOverhangEnd, y: eave }, 'THIN');
      d.grid.filter((g) => g.dir === 'Y').forEach((g) => { v.line({ x: g.pos, y: b.baseElevation - 600 }, { x: g.pos, y: eave + 600 }, 'AXIS'); v.bubble({ x: g.pos, y: b.baseElevation - 900 }, g.label); });
      for (let i = 1; i < ys.length; i++) v.dim({ x: ys[i - 1], y: b.baseElevation }, { x: ys[i], y: b.baseElevation }, { x: 1, y: 0 }, -12);
      v.dim({ x: ys[0], y: b.baseElevation }, { x: ys[ys.length - 1], y: b.baseElevation }, { x: 1, y: 0 }, -20);
      v.dim({ x: ys[0], y: b.baseElevation }, { x: ys[0], y: eave }, { x: 0, y: 1 }, 12);
      v.text({ x: (ys[0] + ys[ys.length - 1]) / 2, y: eave + 900 }, `חזית ציר ${lineS?.label ?? (side === 'L' ? 'א' : 'ב')} (x=${x0})`, 2.6, 'center', 'TEXT');
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
      // טבלת מכלולים
      let y = area.y1 - 8;
      const tx = area.x1 - 4;
      sh.ents.push({ k: 'text', p: { x: tx, y }, s: 'מכלולים להרכבה', h: 3, align: 'right', layer: 'TEXT', bold: true });
      for (const r of bom.assemblies.slice(0, 30)) { y -= 4.2; sh.ents.push({ k: 'text', p: { x: tx, y }, s: `${r.mark}  ×${r.qty}   ${r.unitWeight.toFixed(1)} ק"ג`, h: 2.4, align: 'right', layer: 'TEXT' }); }
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
      const R = c.type === 'purlin-cleat' ? 300 : planar ? 220 : 600;
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
        sh.ents.push({ k: 'text', p: { x: sx1, y: stripY1 + 2 }, s: 'פלטות החיבור — מידות במ"מ, מרכזי חורים מהשפות', h: 2.2, align: 'right', layer: 'TEXT', bold: true });
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
        const isoMs = ms.filter((m) => m.kind !== 'bolt' || m.id.endsWith('.S')).filter(near);
        const clipLoc = (q: Vec3) => ({ t: Math.max(Math.abs(q.x - C.x), Math.abs(q.y - C.y), Math.abs(q.z - C.z)), u: 0, v: 0 });
        void clipLoc;
        renderIso(sh, isoMs.map((m) => (c.members.includes(m.id) ? trimNear(m, C, R * 1.6) : m)), isoMs.map((m) => fab.parts.find((x) => x.memberId === m.id)?.mark ?? ''),
          { x0: area.x1 - 125, x1: area.x1 - 4, y0: area.y0 + 4, y1: y - 16 }, null, () => ({ t: 0, u: 0, v: 0 }), 'תלת־ממד (ללא קנ"מ)');
      }
      T(planar ? 'מבט: בניצב למישור הפלטה.' : 'מבט: חתך במישור המסגרת (לאורך Y). חלקים חתוכים – ממולאים.');
      T('גיאומטריה בלבד — אין בדיקת חוזק לברגים, ריתוכים ופלטות.');
      break;
    }
    case 'assembly': {
      scaleLabel = assemblySheet(sh, fab, d, def.ref!);
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
