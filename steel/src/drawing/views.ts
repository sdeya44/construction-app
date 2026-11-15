import { dot, sub, type Vec3 } from '../core/vec';
import { localFrame } from '../geometry/frame';
import { cachedSolidPure, silhouetteEdges } from './solidCache';
import { partSheet, plateFaceInBox } from './part';
import { assemblySheet, renderIso } from './assembly';
import { purlinParams } from '../geometry/purlins';
import { getProfile, tryProfile } from '../profiles/library';
import type { Bom } from '../fab/bom';
import type { Fabrication } from '../fab/marks';
import type { Connection, DerivedModel, DrawingRecord, DrawingType, Member, Project } from '../model/types';
import { drawArea, fitScale, frameAndTitle, newSheet, today, View, type P, type Sheet, type SheetSize, type TitleInfo } from './sheet';

export interface DrawingDef { id: string; type: DrawingType; number: string; title: string; ref?: string }

const num = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });

/** קטלוג השרטוטים הנגזר מהמודל. המזהים יציבים; מספרי השרטוטים נגזרים מהמזהה. */
export function drawingCatalog(p: Project, d: DerivedModel, fab: Fabrication): DrawingDef[] {
  const out: DrawingDef[] = [];
  out.push({ id: 'D-GA', type: 'ga', number: 'G-01', title: 'שרטוט כללי והרכבה – איזומטריה' });
  out.push({ id: 'D-ROOF', type: 'roof-plan', number: 'R-01', title: 'תוכנית גג ופריסת פטות' });
  if (d.connections.some((c) => c.type === 'base')) out.push({ id: 'D-ANCHOR', type: 'anchor-plan', number: 'B-01', title: 'תוכנית ברגי עיגון ופלטות בסיס' });
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
    vals.forEach((t, i) => { sh.ents.push({ k: 'text', p: { x: x - cw[i] / 2, y: y - rh + 1.3 }, s: t, h: 2.2, align: 'center', layer: 'TEXT', bold }); x -= cw[i]; });
    y -= rh; line({ x: x0, y }, { x: x1, y });
  };
  cell(head, true);
  for (const r of rows) cell(r);
  if (footer) cell(footer, true);
  sh.ents.push({ k: 'poly', pts: [{ x: x0, y: yTop }, { x: x1, y: yTop }, { x: x1, y }, { x: x0, y }], closed: true, layer: 'TITLE' });
  let x = x1; for (const w of cw.slice(0, -1)) { x -= w; line({ x, y: yHead }, { x, y }); }
  return y;
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
      const v = placeView(sh, bx, area, undefined, 14, true); setScale(v);
      // צירים
      for (const g of d.grid) {
        if (g.dir === 'X') { v.line({ x: g.pos, y: bx.y0 + 800 }, { x: g.pos, y: bx.y1 - 800 }, 'AXIS'); v.bubble({ x: g.pos, y: bx.y1 - 300 }, g.label); }
        else { v.line({ x: bx.x0 + 800, y: g.pos }, { x: bx.x1 - 800, y: g.pos }, 'AXIS'); v.bubble({ x: bx.x0 + 300, y: g.pos }, g.label); }
      }
      for (const rx of ridgeXs(d)) v.line({ x: rx, y: bx.y0 + 1500 }, { x: rx, y: bx.y1 - 1500 }, 'AXIS');
      // סימוני חתך: כל קו מסגרת מפנה לגיליון חתך המסגרת (F-xx), חץ לכיוון המבט
      b.frames.forEach((f, i) => {
        const at = { x: bx.x1 - 1400, y: f.y };
        const q = v.p(at.x, at.y), dirP = v.pd({ x: 0, y: 1 });
        sh.ents.push({ k: 'line', a: q, b: { x: q.x + dirP.x * 4, y: q.y + dirP.y * 4 }, layer: 'MARK' });
        sh.ents.push({ k: 'poly', pts: [{ x: q.x + dirP.x * 4 + dirP.y * 1.2, y: q.y + dirP.y * 4 - dirP.x * 1.2 }, { x: q.x + dirP.x * 6, y: q.y + dirP.y * 6 }, { x: q.x + dirP.x * 4 - dirP.y * 1.2, y: q.y + dirP.y * 4 + dirP.x * 1.2 }], closed: true, layer: 'MARK', fill: true });
        sh.ents.push({ k: 'text', p: { x: q.x + 1.5, y: q.y + 1.5 }, s: `F-${String(i + 1).padStart(2, '0')}`, h: 2.2, align: 'left', layer: 'MARK', bold: true });
      });
      const raf = getProfile(b.rafterProfile);
      for (const m of d.members.filter((x) => x.kind === 'rafter')) {
        const hb = raf.props.b / 2;
        const xs = [m.start.x, m.end.x];
        v.poly([{ x: xs[0], y: m.start.y - hb }, { x: xs[1], y: m.start.y - hb }, { x: xs[1], y: m.start.y + hb }, { x: xs[0], y: m.start.y + hb }], true, 'OUTLINE');
        // סימון הרכבה על כל קורה
        const mk = asmOf(m.id);
        if (mk) v.text({ x: xs[0] + (xs[1] - xs[0]) * 0.3, y: m.start.y + hb + 220 }, mk, 2.2, 'center', 'MARK', 0, true);
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
        // באמצע מפתח (לא על קו מסגרת), מוסט מקו הקורה
        const fr = [...b.frames].sort((a1, a2) => a1.y - a2.y); const kk = Math.max(0, Math.floor(fr.length / 2) - 1);
        const ym = fr.length > 1 ? (fr[kk].y + fr[kk + 1].y) / 2 : fr[0].y + 1000;
        void ys0;
        // בין שתי פטות (לא על קו פטה)
        const xsS = ls.map((m) => m.start.x).sort((a1, a2) => a1 - a2);
        const near = xsS.reduce((bst, x) => (Math.abs(x - xm) < Math.abs(bst - xm) ? x : bst), xsS[0]);
        const nxt = xsS.find((x) => x > near + 1) ?? xsS.slice().reverse().find((x) => x < near - 1) ?? near + 600;
        v.text({ x: (near + nxt) / 2, y: ym }, `פטות ${ls[0].profile} (${marks.join(', ')})`, 2.4, 'center', 'MARK');
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
      { // הערה מתחת לתצוגה, בקואורדינטות דף (לא מסתובבת עם התצוגה)
        const cs = [v.p(bx.x0, bx.y0), v.p(bx.x1, bx.y1), v.p(bx.x0, bx.y1), v.p(bx.x1, bx.y0)];
        const px = (Math.min(...cs.map((c) => c.x)) + Math.max(...cs.map((c) => c.x))) / 2, py = Math.min(...cs.map((c) => c.y)) - 14;
        sh.ents.push({ k: 'text', p: { x: px, y: py }, s: 'מידות פטות לאורך השיפוע (מ"מ); * מרווח שאריתי; × חיבור המשך – דורש תכנון', h: 2.4, align: 'center', layer: 'TEXT' });
      }
      if (0) v.text({ x: (bx.x0 + bx.x1) / 2, y: ytop + 1500 }, 'מידות פטות לאורך השיפוע (מ"מ); * מרווח שאריתי; × חיבור המשך – דורש תכנון', 2.4, 'center', 'TEXT');
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
      for (const m of own.filter((x) => x.kind === 'rafter')) lbl(m);
      // עמודים: תווית אנכית לצד העמוד (לא על הקו)
      for (const m of colsF) v.text({ x: m.start.x + (m.start.x < b.width / 2 ? 450 : -450), y: (m.start.z + m.end.z) / 2 }, `${asmOf(m.id)} ${m.profile}`, 2.4, 'center', 'MARK', 90);
      const slopesTxt = (d.section?.planes ?? []).map((q) => `${Math.abs(((q.b.z - q.a.z) / (q.b.x - q.a.x)) * 100).toFixed(1)}%`).join(' / ');
      v.text({ x: (bx.x0 + bx.x1) / 2, y: bx.y1 - 300 }, `שיפוע ${slopesTxt}  ·  מבט לאורך Y, מסגרת ${fi}`, 2.4, 'center', 'TEXT');
      // מפלסים
      const xL = (xsF[0] ?? 0) - 1400;
      v.level({ x: xL, y: b.baseElevation }, 0, -1);
      for (const c of colsF.slice(0, 1)) v.level({ x: xL, y: c.end.z }, c.end.z - b.baseElevation, -1);
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
      v.text({ x: (ys[0] + ys[ys.length - 1]) / 2, y: eave + 900 }, `חזית ציר ${lineS?.label ?? (side === 'L' ? 'א' : 'ב')} (x=${x0})`, 2.6, 'center', 'TEXT');
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
        sh.ents.push({ k: 'text', p: { x: (det.x0 + det.x1) / 2, y: det.y0 + 3 }, s: `${an.length} × ${c0.bolts.length ? 'M' : 'Φ'}${dia} — ${pm.partDesc ?? pm.profile}`, h: 2.3, align: 'center', layer: 'TEXT' });
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
      const notes = ['הערות:', '1. מפלס פני פלטה ±0.00 = מפלס בסיס העמודים.', '2. מידות לצירים במ"מ; סימון ופילוס לפני יציקה.', '3. סטיית מיקום עוגן מותרת ±3 מ"מ (EN 1090-2).', '4. מילוי גראוט לא מתכווץ מתחת לפלטה, לפי המתכנן.'];
      notes.forEach((t, i) => sh.ents.push({ k: 'text', p: { x: area.x1 - 2, y: yEnd - 6 - i * 4.2 }, s: t, h: 2.3, align: 'right', layer: 'TEXT', bold: i === 0 }));
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
          vals.forEach((t, i) => { sh.ents.push({ k: 'text', p: { x: x - cw[i] / 2, y: y - rh + 1.3 }, s: t, h: 2.2, align: 'center', layer: 'TEXT', bold }); x -= cw[i]; });
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
      v.text({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, `${Math.round(Math.min(ang, 180 - ang))}°`, 2.4, 'center', 'DIM');
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
