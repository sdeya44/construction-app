/**
 * גיליון "תוכנית מסבך": מבט במישור המסבך עם חתכי החגורות והאלכסונים, מידות בין הצמתים (c/c) וגובה המסבך,
 * פיתוח חיתוך לכל סוג אלכסון (אורך צלע ארוכה/קצרה, זוויות קצה, רוחב), פרטי החיבור לעמודים (פלטות, ברגים, ריתוכים),
 * טבלת חלקים עם אורכים וזוויות חיתוך, וטבלת פרופילים (מידות חתך). גיאומטריה בלבד — אין בדיקת חוזק.
 * מסבכי גג (`C.TR.*`) ומסבכים נושאים (`C.TBT.*`). קריאה בלבד מהמודל; אין שינוי במנוע.
 */
import type { Fabrication, MarkedPart } from '../fab/marks';
import type { Connection, DerivedModel, Member, Project } from '../model/types';
import { tryProfile } from '../profiles/library';
import { fitScale, View, type P, type Sheet } from './sheet';
import { cachedSolidPure, silhouetteEdges } from './solidCache';
import { plateFaceInBox } from './part';
import { approxMeasure } from './layoutAudit';
import { placeLabels } from './labels';

type V3 = { x: number; y: number; z: number };
type Box = { x0: number; x1: number; y0: number; y1: number };
export interface TrussUnit {
  id: string; title: string; ax: 'x' | 'y'; conn: Connection;
  chords: Member[]; webs: Member[]; /** לחיות צומת (פלטות) — אם הופעלו */ cheeks: Member[]; ends: Connection[]; splices: Connection[]; hosts: string[]; refs: string[];
}

const sigOf = (ms: Member[]) => ms.map((m) => `${m.profile}:${Math.round(Math.hypot(m.end.x - m.start.x, m.end.y - m.start.y, m.end.z - m.start.z))}`).sort().join('|');

/** מסבכי הפרויקט (גג ונושא), מקובצים לזהות (אותם חתכים ואורכים) — גיליון אחד לכל קבוצה */
export function trussUnits(_p: Project, d: DerivedModel): TrussUnit[] {
  const raw: (TrussUnit & { sig: string })[] = [];
  for (const c of d.connections) {
    const roof = c.id.startsWith('C.TR.'), carry = c.id.startsWith('C.TBT.');
    if (c.type !== 'truss' || !(roof || carry)) continue;
    const key = c.id.slice(roof ? 5 : 6);
    const pm = c.parts.map((id) => d.byId.get(id)).filter((m): m is Member => !!m);
    const webs = pm.filter((m) => m.kind !== 'plate'), cheeks = pm.filter((m) => m.kind === 'plate');
    const chords = [...new Set(c.members)].map((id) => d.byId.get(id)).filter((m): m is Member => !!m);
    const all = [...webs, ...chords, ...cheeks];
    if (!webs.length || !chords.length) continue;
    const ends = d.connections.filter((x) => (roof ? x.id.startsWith(`C.TRE.${key}.`) : x.id.startsWith(`C.TBS.${key}.`)));
    const splices = roof ? d.connections.filter((x) => x.id.startsWith(`C.TRS.${key}.`)) : [];
    const hosts = [...new Set(ends.flatMap((x) => x.members))].filter((id) => d.byId.get(id)?.kind === 'column');
    const spread = (k: 'x' | 'y') => { const v = all.flatMap((m) => [m.start[k], m.end[k]]); return Math.max(...v) - Math.min(...v); };
    raw.push({ id: c.id, title: c.label, ax: spread('x') >= spread('y') ? 'x' : 'y', conn: c, chords, webs, cheeks, ends, splices, hosts, refs: [c.label], sig: `${roof ? 'R' : 'T'}|${sigOf(all)}|${ends.map((e) => e.bolts.length).join(',')}` });
  }
  const out = new Map<string, TrussUnit>();
  for (const u of raw) { const e = out.get(u.sig); if (e) e.refs.push(...u.refs); else out.set(u.sig, u); }
  return [...out.values()];
}

const dot2 = (a: P, b: P) => a.x * b.x + a.y * b.y;

/** צורת חיתוך של מוט במישור המסבך: ארבע פינות (לאורך הציר t, ברוחב w), אורך צלע ארוכה/קצרה וזוויות קצה מהניצב (מעלות) */
export interface CutShape { pts: P[]; long: number; short: number; angS: number; angE: number; w: number; axisLen: number }
export function cutShape(m: Member, pr: (q: V3) => P, w: number): CutShape {
  const a = pr(m.start), b = pr(m.end);
  const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const da = { x: (b.x - a.x) / L, y: (b.y - a.y) / L }, np = { x: -da.y, y: da.x };
  const planeN = (pl: { point: V3; normal: V3 } | undefined, at: P): { q: P; n: P } => {
    if (!pl) return { q: at, n: da };
    const q = pr(pl.point);
    const n0 = pr({ x: pl.normal.x, y: pl.normal.y, z: pl.normal.z });
    const k = Math.hypot(n0.x, n0.y) || 1;
    return { q, n: { x: n0.x / k, y: n0.y / k } };
  };
  const S = planeN(m.startCut, a), E = planeN(m.endCut, b);
  // המשטח הבוקע: נקודה על צלע (a ± w/2·np) בחיתוך עם מישור הקצה — פרמטר t לאורך הציר
  const tAt = (pl: { q: P; n: P }, side: number) => {
    const e0 = { x: a.x + np.x * side * w / 2, y: a.y + np.y * side * w / 2 };
    const den = dot2(pl.n, da);
    return Math.abs(den) < 1e-6 ? 0 : dot2(pl.n, { x: pl.q.x - e0.x, y: pl.q.y - e0.y }) / den;
  };
  const s1 = tAt(S, 1), s2 = tAt(S, -1), e1 = tAt(E, 1), e2 = tAt(E, -1);
  const ang = (pl: { n: P }) => (Math.acos(Math.min(1, Math.abs(dot2(pl.n, da)))) * 180) / Math.PI;
  const lens = [e1 - s1, e2 - s2];
  return { pts: [{ x: s1, y: w / 2 }, { x: e1, y: w / 2 }, { x: e2, y: -w / 2 }, { x: s2, y: -w / 2 }], long: Math.max(...lens), short: Math.min(...lens), angS: ang(S), angE: ang(E), w, axisLen: L };
}

const clip = (a: P, b: P, bx: Box): [P, P] | null => {
  let t0 = 0, t1 = 1; const dx = b.x - a.x, dy = b.y - a.y;
  for (const [pp, q] of [[-dx, a.x - bx.x0], [dx, bx.x1 - a.x], [-dy, a.y - bx.y0], [dy, bx.y1 - a.y]] as const) {
    if (pp === 0) { if (q < 0) return null; continue; }
    const r = q / pp;
    if (pp < 0) { if (r > t1) return null; t0 = Math.max(t0, r); } else { if (r < t0) return null; t1 = Math.min(t1, r); }
  }
  return [{ x: a.x + dx * t0, y: a.y + dy * t0 }, { x: a.x + dx * t1, y: a.y + dy * t1 }];
};

export function trussUnitSheet(sh: Sheet, def: { ref?: string }, d: DerivedModel, fab: Fabrication, units: TrussUnit[], area: { x0: number; y0: number; x1: number; y1: number }): string {
  const u = units.find((x) => x.id === def.ref);
  if (!u) return '—';
  const E = sh.ents;
  const pr = (q: V3): P => (u.ax === 'x' ? { x: q.x, y: q.z } : { x: q.y, y: q.z });
  const markOf = (id: string) => fab.parts.find((x) => x.memberId === id)?.mark ?? '';
  const isBottom = (m: Member) => /\.BC(\.|$)/.test(m.id);
  const topCh = u.chords.filter((m) => !isBottom(m)), botCh = u.chords.filter(isBottom);
  const inW = (m: Member, web: boolean) => { const pf = tryProfile(m.profile); return pf ? (web ? pf.props.b : pf.props.h) : 80; };
  const tblW = 128, H = area.y1 - area.y0;
  const RX0 = area.x0 + tblW + 6, RX1 = area.x1 - 4;
  const elev = { x0: RX0, x1: RX1, y0: area.y1 - H * 0.36, y1: area.y1 - 4 };
  const strip = { x0: RX0, x1: RX1, y0: elev.y0 - 4 - H * 0.17, y1: elev.y0 - 4 };
  const det = { x0: RX0, x1: RX1, y0: area.y0 + 2, y1: strip.y0 - 5 };

  // ---------- צמתים: אשכול קצוות האלכסונים לפי s; אנך קובע את הצומת, אחרת ממוצע האשכול
  const sOf = (q: V3) => pr(q).x;
  const ends: { s: number; vert: boolean }[] = u.webs.flatMap((m) => { const v = Math.abs(sOf(m.start) - sOf(m.end)) < 1; return [{ s: sOf(m.start), vert: v }, { s: sOf(m.end), vert: v }]; }).sort((a, b) => a.s - b.s);
  const clusters: { s: number; vert: boolean }[][] = [];
  for (const e of ends) { const c = clusters[clusters.length - 1]; if (c && e.s - c[c.length - 1]!.s < 260) c.push(e); else clusters.push([e]); }
  const nodes = clusters.map((c) => { const v = c.find((x) => x.vert); return v ? v.s : c.reduce((a, b) => a + b.s, 0) / c.length; });
  const zAt = (chs: Member[], s: number): number => {
    const segs = chs.map((m) => { const a = pr(m.start), b = pr(m.end); return a.x <= b.x ? [a, b] : [b, a]; }).sort((p, q) => p[0]!.x - q[0]!.x);
    for (const [a, b] of segs) if (s >= a!.x - 1 && s <= b!.x + 1) return b!.x === a!.x ? a!.y : a!.y + ((b!.y - a!.y) * (s - a!.x)) / (b!.x - a!.x);
    const first = segs[0]!, last = segs[segs.length - 1]!;
    return s < first[0]!.x ? first[0]!.y : last[1]!.y;
  };

  // ---------- מבט במישור המסבך
  const all3 = [...u.chords, ...u.webs, ...u.cheeks];
  const pts = all3.flatMap((m) => { const s = cachedSolidPure(m); return [...s.startRing, ...s.endRing].map(pr); });
  const bx: Box = { x0: Math.min(...pts.map((q) => q.x)) - 120, x1: Math.max(...pts.map((q) => q.x)) + 120, y0: Math.min(...pts.map((q) => q.y)) - 80, y1: Math.max(...pts.map((q) => q.y)) + 80 };
  const view = (box: Box, va: Box, reserve: { l: number; r: number; t: number; b: number }) => {
    const sc = fitScale(box.x1 - box.x0, box.y1 - box.y0, va.x1 - va.x0 - reserve.l - reserve.r, va.y1 - va.y0 - reserve.t - reserve.b);
    return new View(sh, sc, { x: (va.x0 + va.x1) / 2 + (reserve.l - reserve.r) / 2, y: (va.y0 + va.y1) / 2 + (reserve.b - reserve.t) / 2 }, { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 });
  };
  const pr2 = (q: V3): P => (u.ax === 'x' ? { x: q.y, y: q.z } : { x: q.x, y: q.z }); // מבט חזית: לאורך ציר המסבך
  const drawM = (v: View, box: Box, m: Member, layer: 'OUTLINE' | 'THIN', proj: (q: V3) => P = pr) => {
    const s = cachedSolidPure(m);
    const seg = (a: V3, b: V3) => { const c = clip(proj(a), proj(b), box); if (c && Math.hypot(c[0].x - c[1].x, c[0].y - c[1].y) > 0.3 * v.scale) v.line(c[0], c[1], layer); };
    for (let i = 0; i < s.edges.length; i += 6) seg({ x: s.edges[i]!, y: s.edges[i + 1]!, z: s.edges[i + 2]! }, { x: s.edges[i + 3]!, y: s.edges[i + 4]!, z: s.edges[i + 5]! });
    for (const [i, j] of silhouetteEdges(m, proj)) seg(s.startRing[i]!, s.endRing[j]!);
  };
  const cap = (va: Box, s: string, sc: number) => E.push({ k: 'text', p: { x: va.x1, y: va.y1 - 3 }, s: `${s}  1:${sc}`, h: 2.8, align: 'right', layer: 'TEXT', bold: true });

  const vE = view(bx, elev, { l: 6, r: 6, t: 8, b: 26 });
  cap(elev, `מבט במישור המסבך — ${u.title}`, vE.scale);
  for (const m of u.webs) drawM(vE, bx, m, 'OUTLINE');
  for (const m of u.cheeks) drawM(vE, bx, m, 'OUTLINE');
  for (const m of u.chords) drawM(vE, bx, m, 'OUTLINE');
  for (const id of u.hosts) drawM(vE, bx, d.byId.get(id)!, 'THIN');
  // מידות: שרשרת צמתים תחתונה (c/c) + כללית; שרשרת עליונה; גובה בקצוות ובאמצע
  const yB = Math.min(...botCh.flatMap((m) => [pr(m.start).y, pr(m.end).y]), ...pts.map((q) => q.y).slice(0, 0), Infinity);
  const yBot = Number.isFinite(yB) ? yB : bx.y0 + 80;
  const yTop = Math.max(...topCh.flatMap((m) => [pr(m.start).y, pr(m.end).y]));
  for (let i = 0; i + 1 < nodes.length; i++) vE.dim({ x: nodes[i]!, y: yBot }, { x: nodes[i + 1]!, y: yBot }, { x: 1, y: 0 }, -7);
  vE.dim({ x: nodes[0]!, y: yBot }, { x: nodes[nodes.length - 1]!, y: yBot }, { x: 1, y: 0 }, -15, `${Math.round(nodes[nodes.length - 1]! - nodes[0]!)} (צירי צמתים)`);
  for (let i = 0; i + 1 < nodes.length; i++) { const a = zAt(topCh, nodes[i]!), b = zAt(topCh, nodes[i + 1]!); if (Math.abs(b - a) > 1) { vE.dim({ x: nodes[i]!, y: yTop }, { x: nodes[i + 1]!, y: yTop }, { x: 1, y: 0 }, 7); } }
  const depthAt = (s: number, off: number) => vE.dim({ x: s, y: zAt(botCh, s) }, { x: s, y: zAt(topCh, s) }, { x: 0, y: 1 }, off, `${Math.round(zAt(topCh, s) - zAt(botCh, s))}`);
  depthAt(nodes[0]!, 30); depthAt(nodes[nodes.length - 1]!, -30);
  // סימוני חלקים + זווית אלכסון מהחגורה, בלי חפיפה
  const labels: { p: P; s: string; h: number; layer: 'MARK' | 'DIM'; bold?: boolean }[] = [];
  for (const m of u.webs) {
    const a = pr(m.start), b = pr(m.end), mid = vE.p((a.x + b.x) / 2, (a.y + b.y) / 2), mk = markOf(m.id);
    // הסימון מוזז ניצב לאלכסון (לצד העליון/ימני) כדי לא לשבת על קווי המוט
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
    let nx = -dy / L, ny = dx / L; if (ny < -1e-6 || (Math.abs(ny) < 1e-6 && nx < 0)) { nx = -nx; ny = -ny; }
    const off = Math.abs(dx) < 1 ? 3.4 : 3.6;
    if (mk) labels.push({ p: { x: mid.x + nx * off, y: mid.y + ny * off - 0.8 }, s: mk, h: 2.6, layer: 'MARK', bold: true });
  }
  placeLabels(sh, labels, elev, approxMeasure, false);
  for (const m of topCh) { const a = pr(m.start), b = pr(m.end), mk = markOf(m.id); if (mk) { const q = vE.p((a.x + b.x) / 2, (a.y + b.y) / 2); placeLabels(sh, [{ p: { x: q.x, y: q.y + 5 }, s: `${mk} ${m.profile}`, h: 2.4, layer: 'MARK', bold: true }], elev, approxMeasure, false); } }
  for (const m of botCh) { const a = pr(m.start), b = pr(m.end), mk = markOf(m.id); if (mk) { const q = vE.p((a.x + b.x) / 2, (a.y + b.y) / 2); placeLabels(sh, [{ p: { x: q.x, y: q.y - 5 }, s: `${mk} ${m.profile}`, h: 2.4, layer: 'MARK', bold: true }], elev, approxMeasure, false); } }

  // ---------- פיתוח חיתוך לכל סוג מוט (אלכסונים/אנכיים; ולחגורות עם חיתוך משופע)
  type Sp = { shape: CutShape; m: Member; marks: Set<string>; qty: number };
  const kinds = new Map<string, Sp>();
  for (const m of [...u.webs, ...u.chords]) {
    const sh0 = cutShape(m, pr, inW(m, u.webs.includes(m)));
    const key = `${m.profile}|${Math.round(sh0.long)}|${Math.round(sh0.short)}|${Math.round(sh0.angS)}|${Math.round(sh0.angE)}`;
    const e = kinds.get(key) ?? { shape: sh0, m, marks: new Set<string>(), qty: 0 };
    e.qty++; const mk = markOf(m.id); if (mk) e.marks.add(mk); kinds.set(key, e);
  }
  const kList = [...kinds.values()].sort((a, b) => b.shape.long - a.shape.long);
  {
    E.push({ k: 'text', p: { x: strip.x1, y: strip.y1 - 3 }, s: `פיתוח חיתוך המוטות — מידות במ"מ (צלע ארוכה / קצרה, זוויות מהניצב)`, h: 2.8, align: 'right', layer: 'TEXT', bold: true });
    const n = Math.min(kList.length, 6), cw = (strip.x1 - strip.x0) / n;
    kList.slice(0, n).forEach((k, i) => {
      const cx1 = strip.x1 - i * cw, cx0 = cx1 - cw + 2, ymid = strip.y0 + (strip.y1 - 6 - strip.y0) / 2 + 3;
      // שני הקצוות מוגדלים (מקטע ארוך בקנ"מ אחד, עם סימון קטיעה באמצע); האורכים האמיתיים — בקווי המידה
      const sp = k.shape, K = 2.2 * sp.w;
      const ptsL = [sp.pts[0]!, sp.pts[3]!], ptsR = [sp.pts[1]!, sp.pts[2]!];
      const xl = Math.max(ptsL[0]!.x, ptsL[1]!.x) + K, xr = Math.min(ptsR[0]!.x, ptsR[1]!.x) - K;
      const half = (cx1 - cx0) / 2 - 3;
      const scc = fitScale(Math.max(Math.abs(ptsL[0]!.x - ptsL[1]!.x) + K, 1), sp.w * 1.6, half, strip.y1 - 6 - strip.y0 - 22);
      const cL = cx0 + 1, cR = cx1 - 1, yc = ymid + 1;
      const endPoly = (side: 'L' | 'R') => {
        if (side === 'L') { const [t, bt] = ptsL; return [{ x: cL + 0, y: yc + sp.w / 2 / scc * 1 }, { x: cL + (xl - t!.x) / scc, y: yc + sp.w / 2 / scc }, { x: cL + (xl - t!.x) / scc, y: yc - sp.w / 2 / scc }, { x: cL + (bt!.x - t!.x) / scc, y: yc - sp.w / 2 / scc }]; }
        const [t, bt] = ptsR; const tb = Math.max(t!.x, bt!.x);
        return [{ x: cR - (tb - t!.x) / scc - (tb - xr) / scc, y: yc + sp.w / 2 / scc }, { x: cR - (tb - t!.x) / scc, y: yc + sp.w / 2 / scc }, { x: cR - (tb - bt!.x) / scc, y: yc - sp.w / 2 / scc }, { x: cR - (tb - bt!.x) / scc - (tb - xr) / scc, y: yc - sp.w / 2 / scc }];
      };
      const pl = endPoly('L'), pRr = endPoly('R');
      E.push({ k: 'poly', pts: pl, closed: true, layer: 'OUTLINE' }, { k: 'poly', pts: pRr, closed: true, layer: 'OUTLINE' });
      const brk = (x: number) => E.push({ k: 'line', a: { x: x - 0.8, y: yc - sp.w / 2 / scc - 0.6 }, b: { x: x + 0.8, y: yc + sp.w / 2 / scc + 0.6 }, layer: 'THIN' });
      brk(pl[1]!.x + 1.5); brk(pRr[0]!.x - 1.5);
      const dimLine = (xa: number, xb: number, y: number, val: number) => { E.push({ k: 'line', a: { x: xa, y }, b: { x: xb, y }, layer: 'DIM' }, { k: 'line', a: { x: xa, y: y - 1 }, b: { x: xa, y: y + 1 }, layer: 'DIM' }, { k: 'line', a: { x: xb, y: y - 1 }, b: { x: xb, y: y + 1 }, layer: 'DIM' }, { k: 'text', p: { x: (xa + xb) / 2, y: y + 0.8 }, s: String(Math.round(val)), h: 2.3, align: 'center', layer: 'DIM', bold: true }); };
      dimLine(pl[0]!.x, pRr[1]!.x, yc + sp.w / 2 / scc + 4.5, sp.pts[1]!.x - sp.pts[0]!.x);
      dimLine(pl[3]!.x, pRr[2]!.x, yc - sp.w / 2 / scc - 5.5, sp.pts[2]!.x - sp.pts[3]!.x);
      const labelX = (cx0 + cx1) / 2;
      E.push({ k: 'text', p: { x: labelX, y: strip.y0 + 8.2 }, s: `רוחב ${Math.round(sp.w)}`, h: 1.5, align: 'center', layer: 'DIM' });
      E.push({ k: 'text', p: { x: labelX, y: strip.y0 + 5.9 }, s: `זוויות ${Math.round(sp.angS)}°/${Math.round(sp.angE)}°`, h: 1.5, align: 'center', layer: 'DIM' });
      E.push({ k: 'text', p: { x: labelX, y: strip.y0 + 3.6 }, s: `${[...k.marks].join(',') || '—'} · ${k.m.profile} · ${k.qty} יח'`, h: 1.5, align: 'center', layer: 'TEXT', bold: true });
    });
  }

  // ---------- פרטי חיבור לעמודים (קצוות המסבך): מבט מוגדל + פרטי פלטות
  const endGroups: Connection[][] = [];
  { const bySig = new Map<string, Connection[]>(); for (const c of u.ends) { const k = `${c.bolts.length}|${c.parts.map((id) => d.byId.get(id)?.partDesc ?? d.byId.get(id)?.label ?? '').join('|')}`; bySig.set(k, [...(bySig.get(k) ?? []), c]); } endGroups.push(...bySig.values()); }
  const shown = endGroups.slice(0, 2);
  if (shown.length) {
    // לכל קבוצת קצוות: מבט צד (לאורך המסבך) ומבט חזית (לאורך ציר המסבך — הפלטה בפנים) + פרטי הפלטות
    const slots = shown.length * 3, dw = (det.x1 - det.x0) / slots;
    shown.forEach((g, i) => {
      const c = g[0]!;
      const parts = c.parts.map((id) => d.byId.get(id)).filter((m): m is Member => !!m);
      const others = c.members.map((id) => d.byId.get(id)).filter((m): m is Member => !!m && !parts.includes(m));
      if (!parts.length) return;
      const bm = parts.filter((m) => m.kind === 'plate').map((m) => markOf(m.id)).filter(Boolean);
      ([['מבט צד', pr], ['מבט חזית', pr2]] as const).forEach(([name, proj], k) => {
        const slot = i * 3 + k;
        const va: Box = { x0: det.x1 - (slot + 1) * dw + 2, x1: det.x1 - slot * dw, y0: det.y0 + 2, y1: det.y1 };
        const q = parts.flatMap((m) => { const s0 = cachedSolidPure(m); return [...s0.startRing, ...s0.endRing].map(proj); });
        const bb: Box = { x0: Math.min(...q.map((a) => a.x)) - 130, x1: Math.max(...q.map((a) => a.x)) + 130, y0: Math.min(...q.map((a) => a.y)) - 100, y1: Math.max(...q.map((a) => a.y)) + 100 };
        const v = view(bb, va, { l: 4, r: 4, t: 8, b: 4 });
        for (const m of others) drawM(v, bb, m, 'THIN', proj);
        for (const m of parts) drawM(v, bb, m, 'OUTLINE', proj);
        for (const b of c.bolts) for (const suf of ['.H', '.S', '.N', '.W']) { const m = d.byId.get(`${b.id}${suf}`); if (m) drawM(v, bb, m, 'THIN', proj); }
        cap(va, `${name}${k === 0 && g.length > 1 ? ` (${g.length} קצוות זהים)` : ''}`, v.scale);
        if (k === 0 && bm.length) E.push({ k: 'text', p: { x: va.x1, y: va.y1 - 8 }, s: `פלטות: ${bm.join(', ')} · חיבור לעמוד`, h: 2.3, align: 'right', layer: 'TEXT' });
      });
      // פלטת החיבור בפנים (מידות וחורים) — בעמודה השלישית
      const plates = [...new Map(parts.map((m) => fab.parts.find((x) => x.memberId === m.id)).filter((x): x is MarkedPart => !!x && d.byId.get(x.memberId)?.kind === 'plate').map((x) => [x.mark, x])).values()];
      plates.slice(0, 1).forEach((pm) => plateFaceInBox(sh, pm, d, { x0: det.x1 - (i * 3 + 3) * dw + 2, x1: det.x1 - (i * 3 + 2) * dw, y0: det.y0 + 2, y1: det.y1 - 6 }));
    });
  }

  // ---------- טבלאות: חלקים, פרופילים, ברגים וריתוכים, הערות
  const x1 = area.x0 + tblW, cw = [14, 9, 30, 20, 25, 28];
  let y = area.y1 - 4;
  const T = (s: string, xR: number, h = 2.3, bold = false) => E.push({ k: 'text', p: { x: xR, y }, s, h, align: 'right', layer: 'TEXT', bold });
  T(`רשימת חלקים — מסבך אחד`, x1, 2.8, true); y -= 6;
  const row = (vals: string[], bold = false) => { let xr = x1; vals.forEach((t, i) => { const mx = Math.floor((cw[i]! - 1.2) / (2.3 * 0.58)); T(t.length > mx ? `${t.slice(0, mx - 1)}…` : t, xr - 1, 2.3, bold); xr -= cw[i]!; }); y -= 4; };
  row(['סימון', 'כמות', 'חתך', 'אורך ארוך', 'אורך קצר', 'זווית קצוות'], true);
  const byMark = new Map<string, { m: Member; q: number }>();
  for (const m of [...u.chords, ...u.webs, ...u.cheeks]) { const mk = markOf(m.id) || `~${m.id}`; const e = byMark.get(mk) ?? { m, q: 0 }; e.q++; byMark.set(mk, e); }
  for (const [mk, { m, q }] of [...byMark].sort((a, b) => a[0].localeCompare(b[0], 'en', { numeric: true }))) {
    const s = cutShape(m, pr, inW(m, u.webs.includes(m)));
    row([mk.startsWith('~') ? '—' : mk, String(q), m.profile, `${Math.round(s.long)}`, `${Math.round(s.short)}`, `${Math.round(s.angS)}°/${Math.round(s.angE)}°`]);
  }
  y -= 3;
  T('פרופילים (מידות חתך במ"מ)', x1, 2.6, true); y -= 5;
  const profs = [...new Set(all3.map((m) => m.profile))];
  for (const pn of profs) {
    const pf = tryProfile(pn); if (!pf) { T(pn, x1); y -= 4; continue; }
    const dm = pf.dims, t = dm.t ?? dm.tw ?? 0, tf = dm.tf;
    T(`${pn}: ${Math.round(pf.props.h)}×${Math.round(pf.props.b)}${t ? ` · t=${t}` : ''}${tf && tf !== t ? ` · tf=${tf}` : ''}${pf.catalogMass ? ` · ${pf.catalogMass.toFixed(1)} ק"ג/מ'` : ''}`, x1); y -= 4;
  }
  y -= 3;
  const gaps: string[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const near = u.webs.filter((m) => m.start.z !== m.end.z && [pr(m.start).x, pr(m.end).x].some((s) => Math.abs(s - nodes[i]!) < 260));
    const bottomFeet = near.map((m) => [pr(m.start), pr(m.end)].sort((a, b) => a.y - b.y)[0]!).filter((q) => Math.abs(q.x - nodes[i]!) < 260).map((q) => q.x).sort((a, b) => a - b);
    if (bottomFeet.length === 2) gaps.push(`צומת ${i + 1} תחתון: ${Math.round(bottomFeet[1]! - bottomFeet[0]!)} בין עקבות האלכסונים`);
  }
  if (gaps.length) { T('מרחקי עקבות באותו צומת (על פני החגורה)', x1, 2.6, true); y -= 5; for (const g of gaps.slice(0, 6)) { T(g, x1); y -= 3.8; } y -= 3; }
  const bolts = new Map<string, number>();
  for (const c of [...u.ends, ...u.splices]) for (const b of c.bolts) { const k = `M${b.d}×${Math.round(b.length)} ${b.grade}${b.location === 'site' ? ' (שטח)' : ''}`; bolts.set(k, (bolts.get(k) ?? 0) + 1); }
  for (const [k, q] of bolts) { T(`${q}× ${k}`, x1); y -= 4; }
  const welds = [...u.conn.welds, ...u.ends.flatMap((c) => c.welds)].filter((w) => w.location === 'shop');
  const aS = [...new Set(welds.map((w) => w.a))].sort((a, b) => a - b);
  y -= 2;
  for (const s of [
    `ריתוך פינתי במסגריה a=${aS.join('/') || '—'} מ"מ בכל הצמתים (${welds.length} ריתוכים); האלכסונים נחתכים לפי פיתוח החיתוך ומורתכים לחגורות במרווח 1 מ"מ.`,
    `${u.splices.length ? `חיבורי המשך בחגורה: ${u.splices.length} (פלטות מוברגות בשטח). ` : ''}חיבורי שטח מוברגים בלבד; גלוון חם לאחר ריתוך.`,
    'גיאומטריה בלבד — אין בדיקת חוזק לאלכסונים, חגורות, ברגים וריתוכים.',
    `זהה ל: ${u.refs.slice(0, 5).join(' · ')}${u.refs.length > 5 ? ` ועוד ${u.refs.length - 5}` : ''}`,
  ]) {
    let cur = '';
    for (const wd of s.split(' ')) { if (approxMeasure(`${cur} ${wd}`, 2.3) > tblW - 4) { T(cur.trim(), x1, 2.3); y -= 3.8; cur = wd; } else cur += ` ${wd}`; }
    if (cur.trim()) { T(cur.trim(), x1, 2.3); y -= 3.8; }
    y -= 1.2;
  }
  sh.scale = vE.scale;
  return `1:${vE.scale}`;
}
