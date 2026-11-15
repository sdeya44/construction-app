import { dot, sub, type Vec3 } from '../core/vec';
import { localFrame } from '../geometry/frame';
import { cachedSolidPure } from './solidCache';
import { assemblySheet } from './assembly';
import { getProfile } from '../profiles/library';
import type { Bom } from '../fab/bom';
import type { Fabrication, MarkedPart } from '../fab/marks';
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
  const types: [string, string][] = [['eave', 'פרט חיבור קורה-עמוד'], ['ridge', 'פרט חיבור רכס'], ['base', 'פרט פלטת בסיס'], ['purlin-cleat', 'פרט תומך פטה'], ['purlin-splice', 'פרט חיבור המשך פטה'], ['brace-end', 'פרט פח חיבור קושרת'], ['brace-cross', 'פרט הצטלבות קושרות']];
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
  for (let i = 0; i < s.edges.length; i += 6) {
    let a: Vec3 = { x: s.edges[i], y: s.edges[i + 1], z: s.edges[i + 2] }, b: Vec3 = { x: s.edges[i + 3], y: s.edges[i + 4], z: s.edges[i + 5] };
    if (clip) { const c = clip(a, b); if (!c) continue; [a, b] = c; }
    const pa = pr(a), pb = pr(b);
    if (Math.hypot(pa.x - pb.x, pa.y - pb.y) < 0.5) continue;
    v.line(pa, pb, layer);
  }
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
      if (b.roofType === 'gable') v.line({ x: b.ridgeX, y: bx.y0 + 1500 }, { x: b.ridgeX, y: bx.y1 - 1500 }, 'AXIS');
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
      for (const m of d.members.filter((x) => x.kind === 'brace' && (x.id.startsWith('BR.R') || x.id.startsWith('BR.T')))) {
        v.line({ x: m.start.x, y: m.start.y }, { x: m.end.x, y: m.end.y }, m.id.startsWith('BR.T') ? 'HIDDEN' : 'THIN');
      }
      // מידות: מרווחי מסגרות וסה"כ
      const ys = d.grid.filter((g) => g.dir === 'Y').map((g) => g.pos);
      const xr = bx.x1 - 1800;
      for (let i = 1; i < ys.length; i++) v.dim({ x: xr, y: ys[i - 1] }, { x: xr, y: ys[i] }, { x: 0, y: 1 }, 0);
      v.dim({ x: xr, y: ys[0] }, { x: xr, y: ys[ys.length - 1] }, { x: 0, y: 1 }, 8);
      v.dim({ x: 0, y: bx.y0 + 1200 }, { x: b.width, y: bx.y0 + 1200 }, { x: 1, y: 0 }, -6);
      // פריסת פטות: שרשרת מידות מעל, הטקסט = מרחק לאורך השיפוע (או אופקי, מסומן)
      const ytop = Math.max(...ys) + b.purlinOverhangEnd + 900;
      for (const side of ['L', 'R', 'M'] as const) {
        const ls = purl.filter((m) => m.purlin!.side === side).sort((a1, a2) => a1.purlin!.index - a2.purlin!.index);
        let prevX = side === 'M' ? null : b.ridgeX;
        let prevS = 0;
        ls.forEach((m) => {
          const pi = m.purlin!;
          if (prevX !== null) {
            const span = pi.sSlope - prevS;
            const rem = pi.isLast && pi.index > 1 && Math.abs(span - (side === 'R' ? b.purlins.right.spacing : b.purlins.left.spacing)) > 0.5;
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
      v.dim({ x: 0, y: b.baseElevation }, { x: b.width, y: b.baseElevation }, { x: 1, y: 0 }, -14);
      v.dim({ x: 0, y: b.baseElevation }, { x: 0, y: b.eaveLeft }, { x: 0, y: 1 }, 14);
      v.dim({ x: b.width, y: b.baseElevation }, { x: b.width, y: b.eaveRight }, { x: 0, y: 1 }, -14);
      if (d.roof.ridgeZ !== undefined) v.dim({ x: b.ridgeX, y: b.baseElevation }, { x: b.ridgeX, y: d.roof.ridgeZ }, { x: 0, y: 1 }, 0);
      const lbl = (m?: Member) => m && v.text({ x: (m.start.x + m.end.x) / 2, y: (m.start.z + m.end.z) / 2 + 250 }, `${asmOf(m.id)} ${m.profile}`, 2.4, 'center', 'MARK');
      for (const m of own.filter((x) => x.kind === 'column' || x.kind === 'rafter')) lbl(m);
      v.text({ x: b.ridgeX ?? b.width / 2, y: bx.y1 - 300 }, `שיפוע ${(d.roof.slopeLeft * 100).toFixed(1)}%${b.roofType === 'gable' ? ` / ${(d.roof.slopeRight * 100).toFixed(1)}%` : ''}  ·  מבט לאורך Y, מסגרת ${fi}`, 2.4, 'center', 'TEXT');
      v.text({ x: 0, y: b.baseElevation - 1400 }, `±${(b.baseElevation / 1000).toFixed(2)}`, 2.2, 'center', 'TEXT');
      break;
    }
    case 'side': {
      const side = def.ref as 'L' | 'R';
      const x0 = side === 'L' ? 0 : b.width;
      const pr: Proj = (q) => ({ x: q.y, y: q.z });
      const ms = d.members.filter((m) => (m.kind === 'column' && m.side === side) || (m.id.startsWith('BR.W') && m.id.includes(`.${side}.`)));
      const bx = boxOf(solidPts(ms, pr));
      bx.x0 -= 2500; bx.x1 += 2500; bx.y0 -= 1500; bx.y1 += 1500;
      const v = placeView(sh, bx, area); setScale(v);
      for (const m of ms) edges(m, pr, v);
      const ys = b.frames.map((f) => f.y);
      const eave = side === 'L' ? b.eaveLeft : b.eaveRight;
      v.line({ x: Math.min(...ys) - b.purlinOverhangStart, y: eave }, { x: Math.max(...ys) + b.purlinOverhangEnd, y: eave }, 'THIN');
      d.grid.filter((g) => g.dir === 'Y').forEach((g) => { v.line({ x: g.pos, y: b.baseElevation - 600 }, { x: g.pos, y: eave + 600 }, 'AXIS'); v.bubble({ x: g.pos, y: b.baseElevation - 900 }, g.label); });
      for (let i = 1; i < ys.length; i++) v.dim({ x: ys[i - 1], y: b.baseElevation }, { x: ys[i], y: b.baseElevation }, { x: 1, y: 0 }, -12);
      v.dim({ x: ys[0], y: b.baseElevation }, { x: ys[ys.length - 1], y: b.baseElevation }, { x: 1, y: 0 }, -20);
      v.dim({ x: ys[0], y: b.baseElevation }, { x: ys[0], y: eave }, { x: 0, y: 1 }, 12);
      v.text({ x: (ys[0] + ys[ys.length - 1]) / 2, y: eave + 900 }, `חזית ציר ${side === 'L' ? 'א' : 'ב'} (x=${x0})`, 2.6, 'center', 'TEXT');
      break;
    }
    case 'ga': {
      const c30 = Math.cos(Math.PI / 6), s30 = 0.5;
      const pr: Proj = (q) => ({ x: (q.x - q.y) * c30, y: (q.x + q.y) * s30 + q.z });
      const ms = d.members.filter((m) => ['column', 'rafter', 'purlin', 'brace'].includes(m.kind));
      const pts = ms.flatMap((m) => [pr(m.start), pr(m.end)]);
      const bx = boxOf(pts);
      bx.x0 -= 2000; bx.x1 += 2000; bx.y0 -= 2000; bx.y1 += 2000;
      const v = placeView(sh, bx, area); setScale(v);
      for (const m of ms) v.line(pr(m.start), pr(m.end), m.kind === 'purlin' || m.kind === 'brace' ? 'THIN' : 'OUTLINE');
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
      const v = placeView(sh, box, { ...area, x1: area.x1 - 120 }); setScale(v);
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
      T(planar ? 'מבט: בניצב למישור הפלטה.' : 'מבט: חתך במישור המסגרת (לאורך Y). חלקים חתוכים – ממולאים.');
      T('גיאומטריה בלבד — אין בדיקת חוזק לברגים, ריתוכים ופלטות.');
      break;
    }
    case 'assembly': {
      scaleLabel = assemblySheet(sh, fab, d, def.ref!);
      break;
    }
    case 'part': {
      const isAsm = false as boolean;
      const part: MarkedPart | undefined = isAsm
        ? (() => { const a = fab.assemblies.find((x) => x.mark === def.ref)!; return fab.byPart.get(a.main); })()
        : fab.parts.find((x) => x.mark === def.ref);
      if (!part) break;
      const m = d.byId.get(part.memberId)!;
      const f = localFrame(m);
      const loc = (q: Vec3) => { const r = sub(q, m.start); return { t: dot(r, f.ex) - part.t0, u: dot(r, f.u), v: dot(r, f.v) }; };
      const L = part.length;
      const s = cachedSolidPure(m);
      const all = [...s.startRing, ...s.endRing].map(loc);
      const umin = Math.min(...all.map((q) => q.u)), umax = Math.max(...all.map((q) => q.u)), vmin = Math.min(...all.map((q) => q.v)), vmax = Math.max(...all.map((q) => q.v));
      const isPlate = m.kind === 'plate';
      // מבט חזית (t,v) ומבט עליון (t,u). קנה מידה אורכי מותאם לאורך; רוחבי — מוגדל אם צריך (ללא קנ"מ)
      const aw = area.x1 - area.x0 - 110;
      const sx = fitScale(L * 1.08, 1, aw, 1e9);
      const depthPaper = (vmax - vmin) / sx;
      const sy = depthPaper < 14 ? fitScale(1, (vmax - vmin) * 1.0, 1e9, 22) : sx;
      scaleLabel = sx === sy ? `1:${sx}` : `1:${sx} / 1:${sy}*`;
      if (sx !== sy) sh.ents.push({ k: 'text', p: { x: area.x0 + 16, y: area.y1 - 6 }, s: `* קנ"מ אורכי 1:${sx}, קנ"מ רוחבי 1:${sy} — לייצור לפי המידות בלבד`, h: 2.2, align: 'left', layer: 'TEXT' });
      sh.scale = sx;
      const ox = area.x0 + 16, oyF = area.y1 - 40, oyT = oyF - (vmax - vmin) / sy - 30 - (umax - umin) / sy;
      const PF = (t: number, vv: number): P => ({ x: ox + t / sx, y: oyF - (vmax - vv) / sy });
      const PT = (t: number, uu: number): P => ({ x: ox + t / sx, y: oyT + (uu - umin) / sy });
      const ent = (a: P, b2: P, layer: 'OUTLINE' | 'THIN' | 'HIDDEN' = 'OUTLINE') => sh.ents.push({ k: 'line', a, b: b2, layer });
      const drawMember = (mm: Member, layer: 'OUTLINE' | 'THIN') => {
        const ss = cachedSolidPure(mm);
        for (let i = 0; i < ss.edges.length; i += 6) {
          const a = loc({ x: ss.edges[i], y: ss.edges[i + 1], z: ss.edges[i + 2] }), b2 = loc({ x: ss.edges[i + 3], y: ss.edges[i + 4], z: ss.edges[i + 5] });
          // קיטום לתחום החלק
          const t0 = Math.max(Math.min(a.t, b2.t), -1), t1 = Math.min(Math.max(a.t, b2.t), L + 1);
          if (t1 < t0 - 0.01) continue;
          const lerp = (q: typeof a, w: typeof a, t: number) => { const k = w.t === q.t ? 0 : (t - q.t) / (w.t - q.t); return { t, u: q.u + (w.u - q.u) * k, v: q.v + (w.v - q.v) * k }; };
          const A = a.t === b2.t ? a : lerp(a, b2, Math.max(Math.min(a.t, b2.t), 0)), B = a.t === b2.t ? b2 : lerp(a, b2, Math.min(Math.max(a.t, b2.t), L));
          const f1 = PF(A.t, A.v), f2 = PF(B.t, B.v);
          if (Math.hypot(f1.x - f2.x, f1.y - f2.y) > 0.2) ent(f1, f2, layer);
          const t1p = PT(A.t, A.u), t2p = PT(B.t, B.u);
          if (Math.hypot(t1p.x - t2p.x, t1p.y - t2p.y) > 0.2) ent(t1p, t2p, layer);
        }
      };
      drawMember(m, 'OUTLINE');
      // חורים
      for (const h of part.holes) {
        if (h.face === 'web') sh.ents.push({ k: 'circle', c: PF(h.t, h.c), r: Math.max(h.d / 2 / sy, 0.9), layer: 'HOLE' });
        if (h.face === 'flange') sh.ents.push({ k: 'circle', c: PT(h.t, h.c), r: Math.max(h.d / 2 / sy, 0.9), layer: 'HOLE' });
      }
      // מידות רוחביות של החורים (מציר החלק): בצד שמאל של כל מבט
      const dimV = (x: number, y0: number, y1: number, label: string) => {
        sh.ents.push({ k: 'line', a: { x, y: y0 }, b: { x, y: y1 }, layer: 'DIM' });
        for (const yy of [y0, y1]) sh.ents.push({ k: 'line', a: { x: x - 1.2, y: yy }, b: { x: x + 1.2, y: yy }, layer: 'DIM' });
        sh.ents.push({ k: 'text', p: { x: x - 1.5, y: (y0 + y1) / 2 }, s: label, h: 2, align: 'center', layer: 'DIM', rot: 90 });
      };
      const webC = [...new Set(part.holes.filter((h) => h.face === 'web').map((h) => Math.round(h.c * 10) / 10))].sort((a, b2) => a - b2);
      if (webC.length) dimV(ox - 6, PF(0, vmin).y, PF(0, webC[0]).y, String(Math.round(webC[0] - vmin)));
      const flC = [...new Set(part.holes.filter((h) => h.face === 'flange').map((h) => Math.round(h.c * 10) / 10))].sort((a, b2) => a - b2);
      if (flC.length > 1) dimV(ox - 6, PT(0, flC[0]).y, PT(0, flC[flC.length - 1]).y, String(Math.round(flC[flC.length - 1] - flC[0])));
      if (false) {
      }
      // מידות: אורך כולל, שרשרת חורים
      const dimH = (t0: number, t1: number, y: number, label?: string) => {
        const a = { x: ox + t0 / sx, y }, b2 = { x: ox + t1 / sx, y };
        sh.ents.push({ k: 'line', a, b: b2, layer: 'DIM' });
        for (const q of [a, b2]) sh.ents.push({ k: 'line', a: { x: q.x, y: q.y - 1.5 }, b: { x: q.x, y: q.y + 1.5 }, layer: 'DIM' });
        sh.ents.push({ k: 'text', p: { x: (a.x + b2.x) / 2, y: y + 1.2 }, s: label ?? String(Math.round(t1 - t0)), h: 2, align: 'center', layer: 'DIM' });
      };
      const yLen = oyT - 8;
      dimH(0, L, yLen, `${Math.round(L)}`);
      const webT = [...new Set(part.holes.filter((h) => h.face !== 'section').map((h) => Math.round(h.t * 10) / 10))].sort((a, b2) => a - b2);
      if (webT.length) {
        const chain = [0, ...webT, L];
        const yc = oyF + 8;
        for (let i = 1; i < chain.length; i++) if (chain[i] - chain[i - 1] > 0.5) dimH(chain[i - 1], chain[i], yc);
      }
      // חתך (u, v) מימין, וחורים במישור החתך
      const pr0 = getProfile(m.profile);
      const ssc = fitScale(Math.max(umax - umin, 1), Math.max(vmax - vmin, 1), 70, 60);
      const sxC = area.x1 - 60, syC = oyF - 30;
      const PC = (uu: number, vv: number): P => ({ x: sxC + (uu - (umin + umax) / 2) / ssc, y: syC + (vv - (vmin + vmax) / 2) / ssc });
      const ring = s.startRing.map(loc);
      sh.ents.push({ k: 'poly', pts: ring.map((q) => PC(q.u, q.v)), closed: true, layer: 'CUT', fill: true });
      for (const h of part.holes.filter((x) => x.face === 'section')) sh.ents.push({ k: 'circle', c: PC(h.c, h.c2 ?? 0), r: h.d / 2 / ssc, layer: 'HOLE' });
      sh.ents.push({ k: 'text', p: { x: sxC, y: syC - (vmax - vmin) / 2 / ssc - 6 }, s: `חתך ${pr0.name} 1:${ssc}`, h: 2.2, align: 'center', layer: 'TEXT' });
      // מכלול: חלקים משניים
      const rows: string[] = [];
      if (isAsm) {
        const a = fab.assemblies.find((x) => x.mark === def.ref)!;
        for (const pid of a.parts.filter((x) => x !== a.main)) {
          const sp = fab.byPart.get(pid)!;
          const mm = d.byId.get(sp.memberId)!;
          drawMember(mm, 'THIN');
          const c0 = cachedSolidPure(mm).startRing.map(loc);
          const tc = c0.reduce((s1, q) => s1 + q.t, 0) / c0.length, vc = Math.max(...c0.map((q) => q.v));
          sh.ents.push({ k: 'text', p: PF(tc, vc + 30 * sy), s: sp.mark, h: 2, align: 'center', layer: 'MARK' });
        }
        const cnt = new Map<string, { q: number; p: MarkedPart }>();
        for (const pid of a.parts) { const sp = fab.byPart.get(pid)!; const e = cnt.get(sp.mark) ?? { q: 0, p: sp }; e.q++; cnt.set(sp.mark, e); }
        rows.push(`מכלול ${a.mark} · משקל ${a.weight.toFixed(1)} ק"ג · כמות בפרויקט ${fab.assemblies.filter((x) => x.mark === a.mark).length}`);
        for (const [mk, e] of [...cnt.entries()].sort((x, y) => num(x[0], y[0]))) rows.push(`${mk}  ×${e.q}   ${e.p.desc}   ${e.p.profile}   L=${Math.round(e.p.length)}   ${e.p.weight.toFixed(1)} ק"ג`);
      } else {
        const qty = fab.parts.filter((x) => x.mark === part.mark).length;
        rows.push(`סימון: ${part.mark}   כמות: ${qty}`);
        rows.push(`תיאור: ${part.desc}`);
        rows.push(`חתך: ${part.profile}   חומר: ${part.material}`);
        rows.push(`אורך: ${Math.round(part.length)} מ"מ   משקל יח': ${part.weight.toFixed(2)} ק"ג   סה"כ: ${(part.weight * qty).toFixed(1)} ק"ג`);
        rows.push(`חיתוך קצה: התחלה ${part.cutStart}° · סוף ${part.cutEnd}° (מהניצב)`);
        const hs = new Map<number, number>();
        for (const h of part.holes) hs.set(h.d, (hs.get(h.d) ?? 0) + 1);
        rows.push(`חורים: ${[...hs.entries()].map(([dd, q]) => `${q}×Ø${dd}`).join(', ') || 'אין'}`);
        if (isPlate) rows.push('פלטה: מבט עליון = פני הפלטה עם החורים');
        if (part.provisional) rows.push('⚠ סימון זמני — יש להריץ "מספור" לפני הפצה');
      }
      let y = syC - 45;
      for (const r of rows) { sh.ents.push({ k: 'text', p: { x: area.x1 - 4, y }, s: r, h: 2.4, align: 'right', layer: 'TEXT' }); y -= 4.4; }
      sh.ents.push({ k: 'text', p: { x: ox, y: oyF + 16 }, s: 'מבט חזית', h: 2.4, align: 'left', layer: 'TEXT' });
      sh.ents.push({ k: 'text', p: { x: ox, y: oyT - 16 }, s: 'מבט עליון', h: 2.4, align: 'left', layer: 'TEXT' });
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
