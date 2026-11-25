import { dot, sub, type Vec3 } from '../core/vec';
import { placeLabels, type LabelReq } from './labels';
import { approxMeasure, boxIsFree } from './layoutAudit';
import { localFrame } from '../geometry/frame';
import { getProfile } from '../profiles/library';
import type { Fabrication, MarkedPart } from '../fab/marks';
import { ventHoles } from '../fab/marks';
import type { DerivedModel, Member } from '../model/types';
import { cachedSolidPure, silhouetteEdges } from './solidCache';
import { drawArea, fitScale, revBandH, type P, type Sheet } from './sheet';

/**
 * שרטוט מכלול (החלטת משתמש 15.11.2026: "לא ברור — לצרף תלת־ממד"):
 *  · מבט חזית ומבט עליון בקנה מידה אחיד, בועות סימון עם קו מוביל, שרשרת מידות למיקומי החלקים המרותכים
 *  · פרטים מוגדלים לשני הקצוות (1:10 בערך) עם החורים ומידותיהם
 *  · מבט איזומטרי מוצלל (צביעה לפי עומק) — להבנה מהירה של המכלול
 *  · טבלת חלקים והערות ייצור
 * כל המידות נגזרות מהמודל.
 */
export function assemblySheet(sh: Sheet, fab: Fabrication, d: DerivedModel, mark: string, mode: 'full' | 'main' = 'full'): string {
  const asm = fab.assemblies.find((x) => x.mark === mark);
  if (!asm) return '—';
  const mainPart = fab.byPart.get(asm.main)!;
  const main = d.byId.get(mainPart.memberId)!;
  const f = localFrame(main);
  const loc = (q: Vec3) => { const r = sub(q, main.start); return { t: dot(r, f.ex) - mainPart.t0, u: dot(r, f.u), v: dot(r, f.v) }; };
  const parts = asm.parts.map((pid) => fab.byPart.get(pid)!).filter(Boolean);
  const subs = parts.filter((x) => x.id !== mainPart.id);
  const memOf = (pt: MarkedPart) => d.byId.get(pt.memberId)!;
  const L = mainPart.length;
  const E: Sheet['ents'] = sh.ents;
  const line = (a: P, b: P, layer: 'OUTLINE' | 'THIN' | 'DIM' | 'MARK' | 'AXIS' | 'HIDDEN' = 'OUTLINE') => E.push({ k: 'line', a, b, layer });
  const text = (p: P, s: string, h = 2.5, align: 'left' | 'center' | 'right' = 'center', layer: 'TEXT' | 'DIM' | 'MARK' = 'TEXT', bold = false, rot = 0) =>
    E.push({ k: 'text', p, s, h, align, layer, bold, rot });
  // 1.68: תוויות שמוצבות בסוף, במקום פנוי (קצוות א/ב, כותרות חתכים) — לא על סימוני החלקים
  const late: LabelReq[] = [];
  const lateText = (p: P, s: string, h: number, align: 'left' | 'center' | 'right', layer: 'TEXT' | 'MARK', bold: boolean) => {
    const w = approxMeasure(s, h, bold), dx = align === 'left' ? w / 2 : align === 'right' ? -w / 2 : 0;
    late.push({ p: { x: p.x + dx, y: p.y }, s, h, bold, layer });
  };
  const flushLate = () => placeLabels(sh, late.splice(0), { x0: 6, x1: sh.w - 6, y0: 6, y1: sh.h - 6 });

  // ---- תחום המכלול בקואורדינטות המקומיות
  const allLoc = parts.flatMap((pt) => { const s = cachedSolidPure(memOf(pt)); return [...s.startRing, ...s.endRing].map(loc); });
  const tMin = Math.min(...allLoc.map((q) => q.t)), tMax = Math.max(...allLoc.map((q) => q.t));
  const uMin = Math.min(...allLoc.map((q) => q.u)), uMax = Math.max(...allLoc.map((q) => q.u));
  const vMin = Math.min(...allLoc.map((q) => q.v)), vMax = Math.max(...allLoc.map((q) => q.v));
  const mainLoc = [...cachedSolidPure(main).startRing, ...cachedSolidPure(main).endRing].map(loc);
  const vMinMain = Math.min(...mainLoc.map((q) => q.v)), vMaxMain = Math.max(...mainLoc.map((q) => q.v));
  const uMinMain = Math.min(...mainLoc.map((q) => q.u)), uMaxMain = Math.max(...mainLoc.map((q) => q.u));

  // ---- חורים: לכל חור — מיקום בעולם וכיוון הבורג (עיגול רק כשהבורג בכיוון המבט; אחרת קו מרכז דרך העובי)
  const boltById = new Map(d.connections.flatMap((c) => c.bolts).map((b) => [b.id, b]));
  const holesW: { p: Vec3; axis: Vec3; d: number; grip: number }[] = [];
  for (const pt of parts) for (const h of pt.holes) {
    const b = boltById.get(h.boltId);
    if (b && !holesW.some((x) => x.p === b.p)) holesW.push({ p: b.p, axis: b.axis, d: h.d, grip: b.grip });
  }
  // חורי אוורור/ניקוז לגלוון (פרופיל סגור עם קצה אטום)
  const vents = parts.flatMap((pt) => { const mm = d.byId.get(pt.memberId); return mm ? ventHoles(mm, d) : []; });
  for (const v of vents) holesW.push({ p: v.p, axis: v.axis, d: v.d, grip: 8 });

  // ---- פריסת הגיליון (A3): מבטים ראשיים למעלה משמאל, תלת־ממד מימין, פרטים באמצע, טבלה בתחתית מימין
  const A = { x0: 30, x1: 292, yTop: sh.h - 22 };
  // עמודת חתכי קצה (A-A, B-B) מימין למבטים הראשיים — נוהג Tekla/ISO
  const endWin: [number, number][] = [[tMin - 1, tMin + 400], [tMax - 400, tMax + 1]];
  const winLoc = endWin.map(([a, b]) => parts.flatMap((pt) => { const s2 = cachedSolidPure(memOf(pt)); return [...s2.startRing, ...s2.endRing].map(loc); }).filter((q) => q.t >= a - 300 && q.t <= b + 300));
  const secBox = winLoc.map((qs) => qs.length ? { u0: Math.min(...qs.map((q) => q.u)), u1: Math.max(...qs.map((q) => q.u)), v0: Math.min(...qs.map((q) => q.v)), v1: Math.max(...qs.map((q) => q.v)) } : { u0: uMinMain, u1: uMaxMain, v0: vMinMain, v1: vMaxMain });
  const ssc = fitScale(Math.max(...secBox.map((b) => b.u1 - b.u0)), Math.max(...secBox.map((b) => b.v1 - b.v0)), 40, 52) < 2 ? 2 : fitScale(Math.max(...secBox.map((b) => b.u1 - b.u0)), Math.max(...secBox.map((b) => b.v1 - b.v0)), 40, 52);
  const secW = Math.max(...secBox.map((b) => b.u1 - b.u0)) / ssc + 22;
  const AX1 = A.x1 - secW;
  // מבט "שבור": אזורי עניין (קצוות + סביב כל חלק מרותך) בקנ"מ אמיתי, קטעים אחידים ביניהם מקוצרים עם סימן שבירה
  const GAP = 9;
  const ext = (pt: MarkedPart) => { const q = [...cachedSolidPure(memOf(pt)).startRing, ...cachedSolidPure(memOf(pt)).endRing].map(loc); return [Math.min(...q.map((x) => x.t)), Math.max(...q.map((x) => x.t))]; };
  let segs: [number, number][] = [[tMin, Math.min(tMax, tMin + 300)], [Math.max(tMin, tMax - 300), tMax], ...subs.map((pt) => { const [a, b] = ext(pt); return [Math.max(tMin, a - 150), Math.min(tMax, b + 150)] as [number, number]; })];
  segs.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const sg of segs) { const l = merged[merged.length - 1]; if (l && sg[0] <= l[1] + 600) l[1] = Math.max(l[1], sg[1]); else merged.push([...sg]); }
  const depthAll = (vMax - vMin) + (uMax - uMin);
  let sc = fitScale((tMax - tMin) * 1.04, depthAll, AX1 - A.x0, 48);
  const inner = merged.reduce((a, x) => a + (x[1] - x[0]), 0);
  if (merged.length > 1) {
    const scB = fitScale(inner * 1.04, depthAll, AX1 - A.x0 - (merged.length - 1) * GAP, 48);
    if (scB < sc) sc = scB; else segs = [[tMin, tMax]];
  }
  const useSegs: [number, number][] = sc < fitScale((tMax - tMin) * 1.04, depthAll, AX1 - A.x0, 48) ? merged : [[tMin, tMax]];
  const segX: number[] = [];
  { let x = 0; for (const [a, b] of useSegs) { segX.push(x); x += (b - a) / sc + GAP; } }
  const totalW = useSegs.reduce((a, [x0, x1]) => a + (x1 - x0) / sc, 0) + (useSegs.length - 1) * GAP;
  const ox = A.x0 + ((AX1 - A.x0) - totalW) / 2;
  const X = (t: number) => {
    for (let i = 0; i < useSegs.length; i++) {
      const [a, b] = useSegs[i];
      if (t <= b + 1e-6 || i === useSegs.length - 1) {
        if (t >= a - 1e-6 || i === 0) return ox + segX[i] + (t - a) / sc;
        const pb = useSegs[i - 1][1], xb = ox + segX[i - 1] + (pb - useSegs[i - 1][0]) / sc; // בתוך השבירה — אינטרפולציה
        return xb + ((t - pb) / (a - pb)) * GAP;
      }
    }
    return ox;
  };
  const yF = A.yTop - 38 - (vMax - vMin) / sc; // תחתית מבט החזית (v = vMin) — מעליו: בועות, מידות שיפוע ומידות בקרה
  const yT = yF - 52 - (uMax - uMin) / sc;     // תחתית מבט עליון (u = uMin) — מקום לשלוש שרשראות מידה בין המבטים
  const PF = (t: number, v: number): P => ({ x: X(t), y: yF + (v - vMin) / sc });
  const PT = (t: number, u: number): P => ({ x: X(t), y: yT + (u - uMin) / sc });
  const inSeg = (t: number) => useSegs.some(([a, b]) => t >= a - 1e-6 && t <= b + 1e-6);

  /** קווי מתאר של אלמנט בהיטל נתון — רק בתוך אזורי המבט (קטעים מקוצרים נחתכים) ובתחום t אופציונלי. */
  const drawEdges = (m: Member, proj: (q: { t: number; u: number; v: number }) => P, layer: 'OUTLINE' | 'THIN', tr?: [number, number]) => {
    const s = cachedSolidPure(m);
    const ranges = tr ? [tr] : useSegs;
    const cut = (q: { t: number; u: number; v: number }, w: typeof q, t: number) => { const k = (t - q.t) / (w.t - q.t); return { t, u: q.u + (w.u - q.u) * k, v: q.v + (w.v - q.v) * k }; };
    const seg = (a0: { t: number; u: number; v: number }, b0: typeof a0) => {
      for (const [r0, r1] of ranges) {
        let a = a0, b = b0;
        if (Math.abs(b.t - a.t) > 1e-6) {
          if (a.t > b.t) [a, b] = [b, a];
          if (b.t < r0 || a.t > r1) continue;
          if (a.t < r0) a = cut(a, b, r0);
          if (b.t > r1) b = cut(a, b, r1);
        } else if (a.t < r0 - 1e-6 || a.t > r1 + 1e-6) continue;
        const pa = proj(a), pb = proj(b);
        if (Math.hypot(pa.x - pb.x, pa.y - pb.y) > 0.15) line(pa, pb, layer);
      }
    };
    for (let i = 0; i < s.edges.length; i += 6) seg(loc({ x: s.edges[i], y: s.edges[i + 1], z: s.edges[i + 2] }), loc({ x: s.edges[i + 3], y: s.edges[i + 4], z: s.edges[i + 5] }));
    const p2 = (q: Vec3) => proj(loc(q));
    for (const [i, j] of silhouetteEdges(m, p2)) seg(loc(s.startRing[i]), loc(s.endRing[j]));
  };
  const dimH = (xa: number, xb: number, y: number, label: string, tick = 1.2) => {
    line({ x: xa, y }, { x: xb, y }, 'DIM');
    for (const x of [xa, xb]) line({ x: x - tick * 0.7, y: y - tick }, { x: x + tick * 0.7, y: y + tick }, 'DIM');
    const narrow = Math.abs(xb - xa) < 2 * label.length;
    // 1.68: ערך שנופל על טקסט קיים (מידות קצרות צפופות) — מורם שלב נוסף מעל הקו
    const cx = (xa + xb) / 2, w = approxMeasure(label, 2);
    const free = (yy: number) => boxIsFree(E, { x: cx - w / 2, r: cx + w / 2, y: yy - 0.36, t: yy + 1.56 });
    const yt = [y + (narrow ? 3.2 : 1.1), y + 5.4, y + 7.6, y + 9.8, y + 12].find(free) ?? y + (narrow ? 3.2 : 1.1);
    if (yt > y + 4) line({ x: cx, y: y + 0.3 }, { x: cx, y: yt - 0.5 }, 'DIM');
    text({ x: cx, y: yt }, label, 2, 'center', 'DIM');
  };
  const dimV = (x: number, ya: number, yb: number, label: string) => {
    line({ x, y: ya }, { x, y: yb }, 'DIM');
    for (const y of [ya, yb]) line({ x: x - 0.9, y: y - 1.2 }, { x: x + 0.9, y: y + 1.2 }, 'DIM');
    text({ x: x - 1.2, y: (ya + yb) / 2 }, label, 2, 'center', 'DIM', false, 90);
  };
  const bubble = (c: P, s: string, r = 3.4) => {
    E.push({ k: 'circle', c, r, layer: 'MARK' });
    text({ x: c.x, y: c.y - 1 }, s, s.length > 3 ? 2 : 2.5, 'center', 'MARK', true);
  };
  const shopWelds = d.connections.flatMap((c) => c.welds).filter((w) => w.location === 'shop' && w.between.includes(main.id));
  const mainPerim = 2 * (getProfile(main.profile).props.h + getProfile(main.profile).props.b);
  /** סמל ריתוך ISO 2553: חץ מהמפרק, קו ייחוס מלא עם קו זיהוי מקווקו, משולש ריתוך פינתי בצד החץ, a, עיגול היקפי */
  const weldSymbol = (at: P, bend: P, a: number, allAround: boolean, mk: string) => {
    line(at, bend, 'MARK');
    const ang = Math.atan2(at.y - bend.y, at.x - bend.x);
    for (const da of [0.4, -0.4]) line(at, { x: at.x - 2 * Math.cos(ang + da), y: at.y - 2 * Math.sin(ang + da) }, 'MARK');
    const L2 = 15;
    line(bend, { x: bend.x + L2, y: bend.y }, 'MARK');
    E.push({ k: 'line', a: { x: bend.x, y: bend.y + 1.1 }, b: { x: bend.x + L2, y: bend.y + 1.1 }, layer: 'HIDDEN' });
    const tx = bend.x + 6;
    E.push({ k: 'poly', pts: [{ x: tx, y: bend.y }, { x: tx, y: bend.y - 2.4 }, { x: tx + 2.4, y: bend.y }], closed: true, layer: 'MARK' });
    text({ x: tx - 0.8, y: bend.y - 2.2 }, `a${a}`, 1.9, 'right', 'MARK');
    if (allAround) E.push({ k: 'circle', c: bend, r: 1.1, layer: 'MARK' });
    text({ x: bend.x + L2 + 1, y: bend.y - 0.6 }, mk, 1.7, 'left', 'MARK');
  };
  /** חור במבט שכיוון ההסתכלות שלו `view` (וקטור מקומי): עיגול אם הבורג לאורך הכיוון, אחרת קו מרכז דרך העובי */
  const drawHole = (h: (typeof holesW)[number], proj: (q: { t: number; u: number; v: number }) => P, view: 'u' | 'v' | 't', r: number) => {
    const q = loc(h.p);
    const ax = { t: dot(h.axis, f.ex), u: dot(h.axis, f.u), v: dot(h.axis, f.v) };
    if (Math.abs(ax[view]) > 0.9) { E.push({ k: 'circle', c: proj(q), r: Math.max(r, 0.7), layer: 'HOLE' }); return; }
    const q2 = { t: q.t + ax.t * h.grip, u: q.u + ax.u * h.grip, v: q.v + ax.v * h.grip };
    const a = proj(q), b = proj(q2);
    if (Math.hypot(a.x - b.x, a.y - b.y) > 0.3) line(a, b, 'AXIS');
  };

  // ---- מבט חזית ועליון
  const endA = main.kind === 'column' ? (f.ex.z > 0 ? 'תחתית' : 'ראש') : 'קצה א', endB = main.kind === 'column' ? (f.ex.z > 0 ? 'ראש' : 'תחתית') : 'קצה ב';
  text({ x: A.x0, y: A.yTop }, `מבט חזית 1:${sc}${useSegs.length > 1 ? ' (מבט מקוצר — מידות אמיתיות)' : ''}`, 2.6, 'left', 'TEXT', true);
  for (const pt of parts) {
    const m = memOf(pt);
    drawEdges(m, (q) => PF(q.t, q.v), pt === mainPart ? 'OUTLINE' : 'THIN');
    drawEdges(m, (q) => PT(q.t, q.u), pt === mainPart ? 'OUTLINE' : 'THIN');
  }
  for (const h of holesW) { if (inSeg(loc(h.p).t)) { drawHole(h, (q) => PF(q.t, q.v), 'u', h.d / 2 / sc); drawHole(h, (q) => PT(q.t, q.u), 'v', h.d / 2 / sc); } }
  // סימני שבירה בין קטעים
  for (let i = 1; i < useSegs.length; i++) {
    const xa = X(useSegs[i - 1][1]) + GAP / 2;
    for (const [ya, yb] of [[PF(0, vMinMain).y - 2, PF(0, vMaxMain).y + 2], [PT(0, uMinMain).y - 2, PT(0, uMaxMain).y + 2]]) {
      const ym = (ya + yb) / 2;
      E.push({ k: 'poly', pts: [{ x: xa - 1.2, y: ya }, { x: xa - 1.2, y: ym - 1.5 }, { x: xa + 1.2, y: ym - 0.5 }, { x: xa - 1.2, y: ym + 0.5 }, { x: xa + 1.2, y: ym + 1.5 }, { x: xa + 1.2, y: yb }], closed: false, layer: 'THIN' });
    }
  }
  text({ x: A.x0, y: yT - 12 }, `מבט עליון 1:${sc}`, 2.6, 'left', 'TEXT', true);
  line(PF(tMin, 0), PF(tMax, 0), 'AXIS');
  lateText({ x: PF(tMin, 0).x - 2, y: PF(0, (vMin + vMax) / 2).y }, endA, 2.5, 'right', 'MARK', true);
  lateText({ x: PF(tMax, 0).x + 2, y: PF(0, (vMin + vMax) / 2).y }, endB, 2.5, 'left', 'MARK', true);

  // מרכזי החלקים המשניים, בועות
  const cen = (pt: MarkedPart) => {
    const s = cachedSolidPure(memOf(pt));
    const q = [...s.startRing, ...s.endRing].map(loc);
    return { t: q.reduce((a, b) => a + b.t, 0) / q.length, u: q.reduce((a, b) => a + b.u, 0) / q.length, v: q.reduce((a, b) => a + b.v, 0) / q.length, vmax: Math.max(...q.map((x) => x.v)) };
  };
  const byMark = new Map<string, MarkedPart[]>();
  for (const pt of subs) byMark.set(pt.mark, [...(byMark.get(pt.mark) ?? []), pt]);
  const yBub = PF(0, vMax).y + 13;
  const used: number[] = [];
  bubble({ x: (PF(tMin, 0).x + PF(tMax, 0).x) / 2, y: PF(0, vMin).y - 6 }, mainPart.mark);
  for (const [mk, list] of byMark) {
    const c0 = cen(list[0]);
    let x = PF(c0.t, 0).x;
    while (used.some((u) => Math.abs(u - x) < 8)) x += 8;
    used.push(x);
    for (const pt of list) { const c = cen(pt); line(PF(c.t, c.vmax), { x, y: yBub - 3.4 }, 'MARK'); }
    bubble({ x, y: yBub }, mk);
    if (list.length > 1) text({ x: x + 4.5, y: yBub + 2.6 }, `×${list.length}`, 2, 'left', 'MARK');
  }
  // מידות מיקום לשפת החלק (בקשת משתמש): חלק בחצי הראשון — מקצה א אל השפה הקרובה אליו; בחצי השני — מקצה ב.
  // קו עזר מקווקו מהשפה הנמדדת אל קו המידה — כדי שיהיה ברור לאיזו שפה המידה.
  const yChain = PF(0, vMin).y - 10;
  const items = [...new Map(subs.map((pt) => { const [a, b] = ext(pt); const c = cen(pt); return [`${Math.round(a)}|${Math.round(b)}`, { a, b, mid: (a + b) / 2, vlo: Math.min(...[...cachedSolidPure(memOf(pt)).startRing, ...cachedSolidPure(memOf(pt)).endRing].map((q) => loc(q).v)), c }]; })).values()];
  const firstH = items.filter((x) => x.mid < L / 2).sort((p1, p2) => p1.a - p2.a);
  const secondH = items.filter((x) => x.mid >= L / 2).sort((p1, p2) => p2.b - p1.b);
  const ext2 = (t: number, vFrom: number) => { const a = PF(t, vFrom), b = { x: a.x, y: yChain - 1.5 }; if (inSeg(t)) E.push({ k: 'line', a, b, layer: 'HIDDEN' }); };
  { let prev = 0; for (const it of firstH) { const t = Math.max(0, it.a); if (t - prev > 0.5) { dimH(PF(prev, 0).x, PF(t, 0).x, yChain, String(Math.round(t - prev))); ext2(t, it.vlo); prev = t; } } }
  { let prev = L; for (const it of secondH) { const t = Math.min(L, it.b); if (prev - t > 0.5) { dimH(PF(t, 0).x, PF(prev, 0).x, yChain, String(Math.round(prev - t))); ext2(t, it.vlo); prev = t; } } }
  lateText({ x: PF(0, 0).x - 2, y: yChain - 4.5 }, `מידות מ${endA} / מ${endB} אל שפת החלק הקרובה (קו מקווקו)`, 1.9, 'left', 'TEXT', false);
  // כיוון המבט
  { const u = f.u; const dirTxt = Math.abs(u.y) > 0.7 ? 'לאורך המבנה (Y) — מבט על מישור המסגרת' : Math.abs(u.x) > 0.7 ? 'מהצד (X) — מבט על מישור הקיר' : 'מלמעלה';
    const xa = A.x0 + 1.5, ya = A.yTop - 5;
    E.push({ k: 'line', a: { x: xa, y: ya + 2.2 }, b: { x: xa, y: ya - 2.2 }, layer: 'MARK' }, { k: 'line', a: { x: xa - 1.2, y: ya - 0.8 }, b: { x: xa, y: ya - 2.2 }, layer: 'MARK' }, { k: 'line', a: { x: xa + 1.2, y: ya - 0.8 }, b: { x: xa, y: ya - 2.2 }, layer: 'MARK' });
    text({ x: xa + 2.5, y: ya - 0.8 }, `כיוון מבט: ${dirTxt}`, 2.5, 'left', 'MARK'); }
  // אורך כולל; קצה בשיפוע — אורך בשני הצדדים
  const s0 = cachedSolidPure(main);
  const r0 = s0.startRing.map(loc), r1 = s0.endRing.map(loc);
  const edgeT = (ring: { t: number; v: number }[], vv: number) => { const q = ring.filter((x) => Math.abs(x.v - vv) < 0.5); return q.length ? q.reduce((a, x) => a + x.t, 0) / q.length : null; };
  const sTop = edgeT(r0, vMaxMain) ?? 0, sBot = edgeT(r0, vMinMain) ?? 0, eTop = edgeT(r1, vMaxMain) ?? L, eBot = edgeT(r1, vMinMain) ?? L;
  const twoSideDims = Math.abs(sTop - sBot) > 0.5 || Math.abs(eTop - eBot) > 0.5;
  if (twoSideDims) {
    dimH(PF(sTop, 0).x, PF(eTop, 0).x, PF(0, vMax).y + 22, `${Math.round(eTop - sTop)} (צד ${main.kind === 'column' ? 'ימין/עליון' : 'עליון'} במבט)`);
    dimH(PF(sBot, 0).x, PF(eBot, 0).x, yChain - 20, `${Math.round(eBot - sBot)} (צד ${main.kind === 'column' ? 'שמאל/תחתון' : 'תחתון'} במבט)`);
  }
  // שרשרת חורים לאורך כל החלק (גם בקטעים המקוצרים): חורים שנראים כעיגול במבט חזית — מתחת לחזית; במבט עליון — מתחת לעליון
  const holeChain = (view: 'u' | 'v', y: number, label: string) => {
    const ts0 = holesW.filter((h) => Math.abs(view === 'u' ? dot(h.axis, f.u) : dot(h.axis, f.v)) > 0.9).map((h) => loc(h.p).t).filter((t) => t > -1 && t < L + 1);
    if (!ts0.length) return;
    const ts = [...new Set(ts0.map((t) => Math.round(t)))].sort((a, b) => a - b);
    const pts = [0, ...ts.filter((t) => t > 0 && t < Math.round(L)), Math.round(L)];
    // שרשרת רציפה: כל קטע עם ערך; קטע צר — הערך מעל הקו, מדורג לסירוגין, עם קו מוביל לאמצע הקטע
    let stag = 0;
    line({ x: PF(pts[0], 0).x, y }, { x: PF(pts[pts.length - 1], 0).x, y }, 'DIM');
    for (let i = 0; i < pts.length; i++) { const x = PF(pts[i], 0).x; line({ x: x - 0.8, y: y - 1.2 }, { x: x + 0.8, y: y + 1.2 }, 'DIM'); }
    // קטעים שווים רצופים (≥3, או 2 צרים): תווית אחת n×פסיעה=סה"כ על פני כל הרצף (מונע ערימת מספרים זהים באזור השבירה)
    const segs: [number, number, string][] = [];
    for (let i = 1; i < pts.length;) {
      const len = pts[i] - pts[i - 1];
      let j = i;
      while (j + 1 < pts.length && Math.abs(pts[j + 1] - pts[j] - len) <= 1) j++;
      const n = j - i + 1, narrow = PF(pts[i], 0).x - PF(pts[i - 1], 0).x < 2 * String(len).length + 1;
      if (n >= 3 || (n === 2 && narrow)) { segs.push([pts[i - 1], pts[j], `${n}×${len}=${pts[j] - pts[i - 1]}`]); i = j + 1; }
      else { segs.push([pts[i - 1], pts[i], String(len)]); i++; }
    }
    for (const [ta, tb, lab] of segs) {
      const xa = PF(ta, 0).x, xb = PF(tb, 0).x;
      const xm = (xa + xb) / 2, lw = approxMeasure(lab, 2);
      const fr = (yy: number) => boxIsFree(E, { x: xm - lw / 2, r: xm + lw / 2, y: yy - 0.36, t: yy + 1.56 });
      if (xb - xa >= lw + 1.5 && fr(y + 1.1)) { text({ x: xm, y: y + 1.1 }, lab, 2, 'center', 'DIM'); stag = 0; continue; }
      // 1.68: קטע צר — התווית בשלב הפנוי הראשון מעל הקו (קודם: שני שלבים קבועים, תוויות צמודות חפפו)
      const yl = [3.6, 6.4, 9.2, 12, 14.8].map((k) => y + k).find(fr) ?? y + 3.6 + (stag++ % 2) * 2.8;
      line({ x: xm, y: y + 0.3 }, { x: xm, y: yl - 0.4 }, 'DIM');
      text({ x: xm, y: yl }, lab, 2, 'center', 'DIM');
    }
    text({ x: PF(0, 0).x - 2, y: y + 0.5 }, label, 1.9, 'right', 'DIM');
  };
  holeChain('u', yChain - 10, 'חורים');
  holeChain('v', PT(0, uMin).y - 7, 'חורים');
  // מידות בקרה להרכבה: קצה הפרופיל הראשי → מרכז החור הקרוב, ומרכז חור לחור בין שני הקצוות
  {
    const hT = holesW.filter((h) => Math.abs(dot(h.axis, f.ex)) < 0.3).map((h) => loc(h.p).t).filter((t) => t > tMin - 1 && t < tMax + 1);
    const [m0, m1] = ext(mainPart);
    if (hT.length >= 2) {
      const t0 = Math.min(...hT), t1 = Math.max(...hT);
      if (t1 - t0 > 100 && t0 < (m0 + m1) / 2 && t1 > (m0 + m1) / 2) {
        const yc = PF(0, vMax).y + (Math.abs(sTop - sBot) > 0.5 || Math.abs(eTop - eBot) > 0.5 ? 30 : 22);
        const r = (x: number) => Math.round(Math.abs(x));
        const segsC: [number, number, string][] = [[Math.min(m0, t0), Math.max(m0, t0), `${r(t0 - m0)}`], [t0, t1, `${r(t1 - t0)} c-c`], [Math.min(t1, m1), Math.max(t1, m1), `${r(m1 - t1)}`]];
        for (const [a, b, lab] of segsC) if (b - a > 0.5) dimH(PF(a, 0).x, PF(b, 0).x, yc, lab, 1.4);
        for (const t of [t0, t1]) if (inSeg(t)) E.push({ k: 'line', a: { x: PF(t, 0).x, y: PF(0, vMax).y + 1 }, b: { x: PF(t, 0).x, y: yc + 1.5 }, layer: 'HIDDEN' });
        text({ x: PF(tMax, 0).x + 2, y: yc + 0.5 }, 'בקרה להרכבה', 2, 'left', 'DIM', true);
      }
    }
  }
  dimH(PF(0, 0).x, PF(L, 0).x, PT(0, uMin).y - 15, `${Math.round(L)}`);
  // חתכי קצה A-A (ליד מבט החזית) ו-B-B (ליד מבט העליון), עם סימוני חתך במבט החזית
  ['A', 'B'].forEach((nm, k) => {
    const bx = secBox[k], [w0, w1] = endWin[k];
    const cx = A.x1 - secW / 2 + 4, cy = k === 0 ? PF(0, (vMin + vMax) / 2).y : PT(0, (uMin + uMax) / 2).y - 4;
    const uc = (bx.u0 + bx.u1) / 2, vc = (bx.v0 + bx.v1) / 2;
    const PS = (q: { t: number; u: number; v: number }): P => ({ x: cx + (q.u - uc) / ssc, y: cy + (q.v - vc) / ssc });
    for (const pt of parts) drawEdges(memOf(pt), PS, pt === mainPart ? 'OUTLINE' : 'THIN', [w0, w1]);
    const eh: number[] = [];
    for (const h of holesW) { const q = loc(h.p); if (q.t < w0 || q.t > w1) continue; drawHole(h, PS, 't', h.d / 2 / ssc); if (Math.abs(dot(h.axis, f.ex)) > 0.9) eh.push(Math.round(q.u)); }
    line(PS({ t: 0, u: (uMinMain + uMaxMain) / 2, v: bx.v0 - 25 }), PS({ t: 0, u: (uMinMain + uMaxMain) / 2, v: bx.v1 + 25 }), 'AXIS');
    const yb = PS({ t: 0, u: 0, v: bx.v0 }).y - 4;
    const us = [...new Set([Math.round(bx.u0), ...eh, Math.round(bx.u1)])].sort((a2, b2) => a2 - b2);
    for (let i = 1; i < us.length; i++) dimH(PS({ t: 0, u: us[i - 1], v: 0 }).x, PS({ t: 0, u: us[i], v: 0 }).x, yb, String(us[i] - us[i - 1]));
    if (us.length > 2) dimH(PS({ t: 0, u: bx.u0, v: 0 }).x, PS({ t: 0, u: bx.u1, v: 0 }).x, yb - 6, String(Math.round(bx.u1 - bx.u0)));
    const xr = PS({ t: 0, u: bx.u1, v: 0 }).x + 3;
    dimV(xr, PS({ t: 0, u: 0, v: bx.v0 }).y, PS({ t: 0, u: 0, v: bx.v1 }).y, String(Math.round(bx.v1 - bx.v0)));
    lateText({ x: cx, y: PS({ t: 0, u: 0, v: bx.v1 }).y + 3 }, `חתך ${nm}-${nm}  1:${ssc}`, 2.5, 'center', 'TEXT', true);
    // סימון קו החתך במבט החזית: קווים עבים קצרים מעל ומתחת + אות
    const tcOf = (kk: number) => (kk === 0 ? Math.min(tMin + 200, (tMin + tMax) / 2) : Math.max(tMax - 200, (tMin + tMax) / 2));
    const tc = tcOf(k);
    // 1.68: מכלול קצר — שני החתכים באותו מקום: סימון אחד "A·B" (קודם שתי אותיות זו על זו ועל סימוני החלקים)
    const same = Math.abs(PF(tcOf(0), 0).x - PF(tcOf(1), 0).x) < 8;
    if (inSeg(tc) && !(same && k === 1)) for (const [vv, dy] of [[vMax, 1], [vMin, -1]] as const) {
      const q = PF(tc, vv);
      E.push({ k: 'line', a: { x: q.x, y: q.y + dy * 1.5 }, b: { x: q.x, y: q.y + dy * 5 }, layer: 'FRAME' });
      const lab = same ? 'A·B' : nm;
      lateText({ x: q.x + (k ? 2.2 : -2.2) - (same ? approxMeasure(lab, 2.8, true) / 2 : 0), y: q.y + dy * 4 - 1 }, lab, 2.8, 'center', 'MARK', true);
    }
  });
  // מידות מצטברות (מנקודת אפס בקצה א): שפות החלקים המרותכים וכל החורים — לסימון במסגריה ממטר אחד
  {
    const yO = yF - 37;
    const ts = new Set<number>([0, Math.round(L)]);
    for (const it of items) { if (it.a > 0.5 && it.a < L - 0.5) ts.add(Math.round(it.a)); if (it.b > 0.5 && it.b < L - 0.5) ts.add(Math.round(it.b)); }
    for (const h of holesW) { const t = Math.round(loc(h.p).t); if (t > 0 && t < L) ts.add(t); }
    const all = [...ts].sort((a, b) => a - b);
    line({ x: PF(0, 0).x, y: yO }, { x: PF(L, 0).x, y: yO }, 'DIM');
    E.push({ k: 'circle', c: { x: PF(0, 0).x, y: yO }, r: 0.9, layer: 'DIM' });
    // תוויות: כל ערך מוצג; תוויות צפופות נפרשות לצדדים (מרווח מזערי) עם קו מוביל שבור אל הסימון
    const GAP = 3.9;
    const lab = all.map((t) => ({ t, x: PF(t, 0).x, xl: PF(t, 0).x }));
    for (const { t, x } of lab) if (t > 0) line({ x: x - 0.8, y: yO - 1.1 }, { x: x + 0.8, y: yO + 1.1 }, 'DIM');
    // פריסה: מעבר קדימה (דחיפה ימינה), מעבר אחורה מהקצה, ואיזון למרכז כל אשכול
    for (let i = 1; i < lab.length; i++) lab[i].xl = Math.max(lab[i].xl, lab[i - 1].xl + GAP);
    const xEnd = lab.length ? lab[lab.length - 1].x : 0;
    if (lab.length && lab[lab.length - 1].xl > xEnd + GAP * 2) { lab[lab.length - 1].xl = Math.max(xEnd, lab[lab.length - 1].xl - GAP); for (let i = lab.length - 2; i >= 0; i--) lab[i].xl = Math.min(lab[i].xl, lab[i + 1].xl - GAP); }
    for (let i = 0; i < lab.length;) {
      let j = i; while (j + 1 < lab.length && lab[j + 1].xl - lab[j].xl <= GAP + 0.01) j++;
      if (j > i) { const sh0 = (lab.slice(i, j + 1).reduce((t, q) => t + q.x - q.xl, 0)) / (j - i + 1); const lo = i > 0 ? lab[i - 1].xl + GAP : -Infinity, hi = j + 1 < lab.length ? lab[j + 1].xl - GAP : Infinity;
        const sh1 = Math.max(lo - lab[i].xl, Math.min(hi - lab[j].xl, sh0)); for (let k = i; k <= j; k++) lab[k].xl += sh1; }
      i = j + 1;
    }
    const spread = lab.some((q) => Math.abs(q.xl - q.x) > 0.3);
    // מידה כוללת של הצד התחתון (קצה בשיפוע) יושבת מעל השורה — אז התוויות מתחת לקו
    const dn = twoSideDims ? -1 : 1;
    const yb = yO + dn * (spread ? 3.4 : 1.2);
    for (const { t, x, xl } of lab) {
      if (spread) { line({ x, y: yO + dn * 1.1 }, { x, y: yO + dn * 1.9 }, 'DIM'); line({ x, y: yO + dn * 1.9 }, { x: xl, y: yb - dn * 0.4 }, 'DIM'); }
      text({ x: xl + 0.9, y: yb + dn * (String(t).length * 1.45) / 2 }, String(t), 2.5, 'center', 'DIM', false, 90);
    }
    text({ x: PF(0, 0).x - 2, y: yO + 0.5 }, 'מצטבר', 2, 'right', 'DIM');
  }

  // ---- פרטים מוגדלים לקצוות
  const detTop = yT - 20, detH = Math.max(40, Math.min(80, detTop - 78)), detW = (A.x1 - A.x0 - 12) / 2;
  const span = 600;
  const regions: [string, number, number][] = [['א', tMin - 40, tMin - 40 + span], ['ב', tMax + 40 - span, tMax + 40]];
  const endW = uMax - uMin;
  // טווח v בכל חלון פרט (רק החלקים שבחלון) — קנ"מ גדול יותר מאשר לפי כל המכלול
  const vWin = regions.map(([, t0, t1]) => {
    const vs = parts.filter((pt) => { const [a, b] = ext(pt); return b >= t0 && a <= t1; })
      .flatMap((pt) => { const s2 = cachedSolidPure(memOf(pt)); return [...s2.startRing, ...s2.endRing].map(loc).filter((q) => q.t >= t0 - 200 && q.t <= t1 + 200).map((q) => q.v); });
    return vs.length ? [Math.min(...vs), Math.max(...vs)] as [number, number] : [vMinMain, vMaxMain] as [number, number];
  });
  const vSpan = Math.max(...vWin.map(([a, b]) => b - a));
  const dsc = fitScale(span + 80, vSpan * 1.12, detW - 14, detH - 18); void endW;
  regions.forEach(([name, t0, t1], k) => {
    const [rvMin, rvMax] = vWin[k];
    const x0 = A.x0 + k * (detW + 12);
    const P2 = (t: number, v: number): P => ({ x: x0 + 8 + (t - t0) / dsc, y: detTop - detH + 10 + (v - rvMin) / dsc });
    text({ x: x0, y: detTop }, `פרט ${name} — ${k ? 'קצה סוף' : 'קצה התחלה'} 1:${dsc}`, 2.5, 'left', 'TEXT', true);
    // סימון אזור הפרט במבט החזית
    const a = PF(Math.max(t0, tMin), rvMin), b = PF(Math.min(t1, tMax), rvMax);
    E.push({ k: 'poly', pts: [{ x: a.x - 1, y: a.y - 1 }, { x: b.x + 1, y: a.y - 1 }, { x: b.x + 1, y: b.y + 1 }, { x: a.x - 1, y: b.y + 1 }], closed: true, layer: 'HIDDEN' });
    text({ x: k ? b.x + 2 : a.x - 2, y: b.y + 2 }, name, 2.6, k ? 'left' : 'right', 'MARK', true);
    for (const pt of parts) drawEdges(memOf(pt), (q) => P2(q.t, q.v), pt === mainPart ? 'OUTLINE' : 'THIN', [t0, t1]);
    // סמלי ריתוך לפי ISO 2553 (שיטה A): קו חץ, קו ייחוס מלא + קו זיהוי מקווקו, משולש פינתי, a, ועיגול "מסביב" כשהריתוך היקפי
    { const usedMk = new Set<string>(); let k2 = 0;
      for (const pt of subs) {
        if (usedMk.has(pt.mark)) continue;
        const c = cen(pt);
        if (c.t < t0 || c.t > t1) continue;
        const w = shopWelds.find((x) => x.between.includes(memOf(pt).id));
        if (!w) continue;
        usedMk.add(pt.mark);
        const anchor = P2(c.t, c.vmax);
        const bend = { x: anchor.x + 5 + k2 * 2, y: anchor.y + 8 + k2 * 6 }; k2++;
        weldSymbol(anchor, bend, w.a, w.length >= 0.8 * mainPerim, pt.mark);
      }
    }
    // חורים בווב/חתך של כל החלקים שבאזור, מידות מהקצה
    const holes: { t: number; v: number; d: number }[] = [];
    for (const h of holesW) {
      const q = loc(h.p);
      if (q.t < t0 || q.t > t1) continue;
      drawHole(h, (w) => P2(w.t, w.v), 'u', h.d / 2 / dsc);
      // מידות רק לחורים שנראים כעיגול במבט זה
      if (Math.abs(dot(h.axis, f.u)) > 0.9) holes.push({ t: q.t, v: q.v, d: h.d });
    }
    const end = k ? tMax : 0;
    const hts = [...new Set(holes.map((h) => Math.round(h.t)))].sort((a2, b2) => (k ? b2 - a2 : a2 - b2)).slice(0, 4);
    let prev = end, yy = P2(0, rvMax).y + 5;
    for (const t of hts) {
      if (Math.abs(t - prev) < 1) continue;
      dimH(Math.min(P2(prev, 0).x, P2(t, 0).x), Math.max(P2(prev, 0).x, P2(t, 0).x), yy, String(Math.abs(Math.round(t - prev))));
      prev = t;
    }
    const hvs = [...new Set(holes.map((h) => Math.round(h.v)))].sort((a2, b2) => a2 - b2);
    if (hvs.length) {
      const xd = k ? P2(t1, 0).x + 3 : P2(t0, 0).x - 3;
      dimV(xd, P2(0, rvMin).y, P2(0, hvs[0]).y, String(Math.round(hvs[0] - rvMin)));
      if (hvs.length > 1) dimV(xd + (k ? 5 : -5), P2(0, hvs[0]).y, P2(0, hvs[hvs.length - 1]).y, String(hvs[hvs.length - 1] - hvs[0]));
    }
    const ds = [...new Set(holes.map((h) => h.d))];
    if (ds.length) text({ x: x0 + detW / 2, y: detTop - detH + 3 }, `חורים: ${ds.map((x) => `Ø${x}`).join(', ')}`, 2, 'center');
  });

  // ---- מבטים איזומטריים מוצללים (עולם: Z למעלה): מכלול שלם + הגדלה לכל קצה
  const nRows = new Set(parts.map((x) => x.mark)).size;
  const rb = revBandH(sh.title);
  const isoY0 = Math.min(128, 12 + rb + 4.6 * (nRows + 2) + 2 + 18);
  const ms = parts.map(memOf);
  keyPlan(sh, d, fab, mark, { x0: sh.w - 14 - 62, x1: sh.w - 14, y0: sh.h - 18 - 44, y1: sh.h - 18 });
  renderIso(sh, ms, parts.map((x) => x.mark), { x0: 302, x1: sh.w - 14 - 66, y0: 158, y1: sh.h - 18 }, null, loc, 'מבט תלת־ממדי — המכלול (ללא קנ"מ)', holesW.map((h) => ({ p: h.p, axis: h.axis, r: h.d / 2, len: h.grip })));
  regions.forEach(([name, t0, t1], k) => {
    // תלת־ממד של הפרטים — בעמודה הימנית, מתחת למבט הכללי ומעל טבלת החלקים
    const w = (sh.w - 14 - 302 - 6) / 2, x0 = 302 + k * (w + 6);
    renderIso(sh, ms, parts.map((x) => x.mark), { x0, x1: x0 + w, y0: isoY0, y1: 150 }, [t0, t1], loc, `תלת־ממד — פרט ${name}`, holesW.map((h) => ({ p: h.p, axis: h.axis, r: h.d / 2, len: h.grip })));
  });

  // ---- טבלת חלקים (מכלול גדול — בגיליון נפרד)
  if (mode === 'main') {
    const tx1m = sh.w - 12;
    text({ x: tx1m, y: 12 + 30 }, `מכלול ${asm.mark} · ${asm.weight.toFixed(1)} ק"ג · כמות בפרויקט ${fab.assemblies.filter((x) => x.mark === asm.mark).length} · ${parts.length} חלקים — רשימת החלקים בגיליון A-${asm.mark}.2`, 2.8, 'right', 'TEXT', true);
    flushLate();
    return `1:${sc}`;
  }
  const tx1 = sh.w - 12, tx0 = 210, rowH = 4.6;
  const cols: [string, number][] = [['סימון', 16], ['כמות', 11], ['תיאור', 70], ['חתך', 34], ['אורך', 17], ['ק"ג/יח\'', 15], ['ק"ג', 17]];
  const scaleW = (tx1 - tx0) / cols.reduce((a, c) => a + c[1], 0);
  const cnt = new Map<string, { q: number; p: MarkedPart }>();
  for (const pt of parts) { const e = cnt.get(pt.mark) ?? { q: 0, p: pt }; e.q++; cnt.set(pt.mark, e); }
  const rows = [...cnt.values()].sort((a, b) => (a.p === mainPart ? -1 : b.p === mainPart ? 1 : a.p.mark.localeCompare(b.p.mark, 'en', { numeric: true })));
  // +3: מרווח להערת הסטטוס שמעל אבן הכותרת (1.68 — כותרת העמודה חפפה להערה)
  const tableTop = 12 + rb + 3 + rowH * (rows.length + 2) + 2;
  let yy = tableTop;
  const hline = (y: number) => line({ x: tx0, y }, { x: tx1, y }, 'THIN');
  text({ x: tx1, y: yy + 2 }, `מכלול ${asm.mark} · ${asm.weight.toFixed(1)} ק"ג · כמות בפרויקט ${fab.assemblies.filter((x) => x.mark === asm.mark).length}`, 2.6, 'right', 'TEXT', true);
  { // מיקומים: לאילו אלמנטים במבנה משמש שרטוט זה
    const labs = new Map<string, number>();
    for (const a of fab.assemblies.filter((x) => x.mark === asm.mark)) { const mid = fab.parts.find((x) => x.id === a.main)?.memberId ?? a.main; const l = d.byId.get(mid)?.label ?? mid; labs.set(l, (labs.get(l) ?? 0) + 1); }
    let s0 = `עבור: ${[...labs].map(([l, q]) => (q > 1 ? `${l} ×${q}` : l)).join(' · ')}`;
    if (s0.length > 125) s0 = s0.slice(0, 122) + '…';
    text({ x: tx1, y: yy + 6.6 }, s0, 2.3, 'right', 'TEXT');
  }
  hline(yy);
  const drawRow = (vals: string[], bold = false) => {
    let x = tx1;
    vals.forEach((v, i) => {
      const w = cols[i][1] * scaleW;
      // 1.68: טקסט ארוך מרוחב העמודה — מקוצר (התיאור המלא ברשימת החלקים) במקום לגלוש לעמודה הבאה
      const maxC = Math.max(3, Math.floor((w - 2) / (2.5 * 0.56)));
      text({ x: x - 1, y: yy - rowH + 1.4 }, v.length > maxC ? `${v.slice(0, maxC - 1)}…` : v, 2.5, 'right', 'TEXT', bold);
      x -= w;
    });
    yy -= rowH; hline(yy);
  };
  drawRow(cols.map((c) => c[0]), true);
  for (const r of rows) drawRow([r.p.mark, String(r.q), r.p.desc, r.p.profile, String(Math.round(r.p.length)), r.p.weight.toFixed(1), (r.p.weight * r.q).toFixed(1)]);
  { let x = tx1; for (let i = 0; i <= cols.length; i++) { line({ x, y: tableTop }, { x, y: yy }, 'THIN'); if (i < cols.length) x -= cols[i][1] * scaleW; } }
  // הערות ייצור
  const weld = d.connections.flatMap((c) => c.welds).filter((w) => w.location === 'shop' && ms.some((m) => m.id === w.between[0]) && ms.some((m) => m.id === w.between[1]));
  const aSizes = [...new Set(weld.map((w) => w.a))].sort((a, b) => a - b);
  const notes = [
    aSizes.length ? `ריתוך פינתי במסגריה a=${aSizes.join('/')} מ"מ, היקפי, לפני גלוון` : 'ללא ריתוך במכלול',
    'גלוון חם לאחר ייצור; הרכבה בשטח בברגים בלבד',
    ...(vents.length ? [`חורי אוורור/ניקוז לגלוון ${vents.length}×Ø${[...new Set(vents.map((v) => v.d))].join('/')} בפינות נגדיות — לאישור המגלוון`] : []),
    'מידות במ"מ; סמלי ריתוך לפי ISO 2553 (שיטה A) — ○ = ריתוך היקפי',
  ];
  notes.forEach((n2, i) => text({ x: tx1, y: tableTop + 10 + (notes.length - 1 - i) * 3.6 }, `${i + 1}. ${n2}`, 2.5, 'right'));
  flushLate();
  return `1:${sc}`;
}

/** תוכנית מפתח: היטל עליון זעיר של המבנה, המכלולים בעלי הסימון מודגשים (מיקומם במבנה). */
export function keyPlan(sh: Sheet, d: DerivedModel, fab: Fabrication, mark: string, box: { x0: number; x1: number; y0: number; y1: number }) {
  const E = sh.ents;
  const ms = d.members.filter((m) => ['column', 'rafter', 'beam'].includes(m.kind) || (m.kind === 'brace' && !m.id.startsWith('KB')));
  if (!ms.length) return;
  const xs = ms.flatMap((m) => [m.start.x, m.end.x]), ys = ms.flatMap((m) => [m.start.y, m.end.y]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const rot = (y1 - y0) >= (x1 - x0); // הצד הארוך לרוחב
  const W = box.x1 - box.x0 - 6, H = box.y1 - box.y0 - 12;
  const mw = rot ? y1 - y0 : x1 - x0, mh = rot ? x1 - x0 : y1 - y0;
  const k = Math.min(W / Math.max(mw, 1), H / Math.max(mh, 1));
  const cx = (box.x0 + box.x1) / 2, cy = box.y0 + 3 + H / 2;
  const P = (x: number, y: number): P => rot ? { x: cx + (y - (y0 + y1) / 2) * k, y: cy + (x - (x0 + x1) / 2) * k } : { x: cx + (x - (x0 + x1) / 2) * k, y: cy + (y - (y0 + y1) / 2) * k };
  E.push({ k: 'poly', pts: [{ x: box.x0, y: box.y0 }, { x: box.x1, y: box.y0 }, { x: box.x1, y: box.y1 }, { x: box.x0, y: box.y1 }], closed: true, layer: 'THIN' });
  E.push({ k: 'text', p: { x: box.x1 - 1.5, y: box.y1 - 4 }, s: 'תוכנית מפתח', h: 2.5, align: 'right', layer: 'TEXT', bold: true });
  const hi = new Set(fab.assemblies.filter((a) => a.mark === mark).flatMap((a) => a.parts.map((pid) => fab.byPart.get(pid)?.memberId)).filter((x): x is string => !!x));
  for (const m of ms) {
    const a = P(m.start.x, m.start.y), b = P(m.end.x, m.end.y);
    const on = hi.has(m.id);
    if (m.kind === 'column') {
      const r = on ? 1.3 : 0.6;
      E.push({ k: 'poly', pts: [{ x: a.x - r, y: a.y - r }, { x: a.x + r, y: a.y - r }, { x: a.x + r, y: a.y + r }, { x: a.x - r, y: a.y + r }], closed: true, layer: on ? 'OUTLINE' : 'THIN', fill: on });
    } else if (Math.hypot(a.x - b.x, a.y - b.y) > 0.2) {
      E.push({ k: 'line', a, b, layer: on ? 'FRAME' : m.kind === 'brace' ? 'HIDDEN' : 'THIN' });
    }
  }
  // צירים קיצוניים
  for (const g of d.grid) {
    const gs = d.grid.filter((q) => q.dir === g.dir).map((q) => q.pos);
    if (g.pos !== Math.min(...gs) && g.pos !== Math.max(...gs)) continue;
    const q = g.dir === 'X' ? P(g.pos, y0) : P(x0, g.pos);
    const off = g.dir === 'X' ? (rot ? { x: -3, y: 0 } : { x: 0, y: -3 }) : (rot ? { x: 0, y: -3 } : { x: -3, y: 0 });
    E.push({ k: 'text', p: { x: q.x + off.x, y: q.y + off.y - 0.8 }, s: g.label, h: 2, align: 'center', layer: 'AXIS', bold: true });
  }
}

function cross3(a: Vec3, b: Vec3): Vec3 { return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }; }
function norm3(a: Vec3): Vec3 { const l = Math.hypot(a.x, a.y, a.z) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; }

/**
 * מבט איזומטרי מוצלל בשיטת הצייר: פאות מחולקות לקטעים קצרים לאורך האלמנט כדי שמיון העומק יהיה נכון,
 * ותאורה לפי נורמל הפאה. clip: תחום t (במערכת החלק הראשי) — מציג רק את הקטעים שבתחום, עם פאת חתך בגבול.
 */
export function renderIso(sh: Sheet, ms: Member[], marks: string[], box: { x0: number; x1: number; y0: number; y1: number }, clip: [number, number] | null,
  loc: (q: Vec3) => { t: number; u: number; v: number }, title: string, holes: { p: Vec3; axis: Vec3; r: number; len: number }[] = [], rot = 0, fineMode = false) {
  const E = sh.ents;
  const C30 = Math.cos(Math.PI / 6), S30 = 0.5;
  // rot: סיבוב המבט ב-90°·rot סביב Z (לבחירת צד הצפייה — כך הפלטות לא מוסתרות ע"י האלמנט הראשי)
  const ca = Math.round(Math.cos((rot * Math.PI) / 2)), sa = Math.round(Math.sin((rot * Math.PI) / 2));
  const R = (q: Vec3): Vec3 => ({ x: q.x * ca - q.y * sa, y: q.x * sa + q.y * ca, z: q.z });
  const isoXY = (q0: Vec3) => { const q = R(q0); return { x: (q.x - q.y) * C30, y: q.z + (q.x + q.y) * S30 }; };
  const depth = (q0: Vec3) => { const q = R(q0); return q.x + q.y - q.z; }; // גדול = רחוק מהצופה
  const Ldir = norm3({ x: -0.35, y: -0.6, z: 1 });
  const lerp = (a: Vec3, b: Vec3, k: number): Vec3 => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k });
  const inClip = (q: Vec3) => !clip || (loc(q).t >= clip[0] - 0.5 && loc(q).t <= clip[1] + 0.5);
  type Face = { poly: Vec3[]; edges: [Vec3, Vec3][]; z: number; tone: number };
  const faces: Face[] = [];
  const shown: Vec3[] = [];
  const shownByMark = new Map<string, Vec3[]>();
  ms.forEach((m, mi) => {
    const s = cachedSolidPure(m);
    const n = s.startRing.length;
    const tA = loc(s.startRing[0]).t, tB = loc(s.endRing[0]).t;
    // תחום k (0..1) של האלמנט שבתוך החיתוך
    let k0 = 0, k1 = 1;
    if (clip && Math.abs(tB - tA) > 1e-6) {
      const ka = (clip[0] - tA) / (tB - tA), kb = (clip[1] - tA) / (tB - tA);
      k0 = Math.max(0, Math.min(ka, kb)); k1 = Math.min(1, Math.max(ka, kb));
      if (k1 <= k0) return;
    } else if (clip && !inClip(s.startRing[0])) return;
    const len = Math.hypot(s.endRing[0].x - s.startRing[0].x, s.endRing[0].y - s.startRing[0].y, s.endRing[0].z - s.startRing[0].z) * (k1 - k0);
    const fine = rot >= 0 && fineMode;
    const segs = Math.max(1, Math.min(fine ? 160 : 90, Math.ceil(len / (clip || fine ? (fine ? 30 : 40) : 150))));
    const base = mi === 0 ? 0.6 : 0.8;
    // מבט מפורט: פלטות/ברגים צמודים לפאת אלמנט — עדיפות קלה לכיוון הצופה (מיון צייר לפי מרכז פאה)
    const bias = !fine ? 0 : m.kind === 'bolt' ? -45 : m.kind === 'plate' || m.kind === 'cleat' ? -20 : 0;
    const ringAt = (k: number) => s.startRing.map((q, i) => lerp(q, s.endRing[i], k));
    // כיוון הטבעת (עם/נגד ציר האלמנט) — לנורמל חיצוני עקבי ולסינון פאות אחוריות במבט המפורט
    const axisV = sub(s.endRing[0], s.startRing[0]);
    let ringN = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < n; i++) ringN = { x: ringN.x + cross3(s.startRing[i], s.startRing[(i + 1) % n]).x, y: ringN.y + cross3(s.startRing[i], s.startRing[(i + 1) % n]).y, z: ringN.z + cross3(s.startRing[i], s.startRing[(i + 1) % n]).z };
    const orient = dot(ringN, axisV) >= 0 ? 1 : -1;
    const back = (nOut: Vec3) => fine && R(nOut).x + R(nOut).y - R(nOut).z > 1e-6;
    for (let i = 0; i < n; i++) {
      const a0 = s.startRing[i], b0 = s.startRing[(i + 1) % n], a1 = s.endRing[i], b1 = s.endRing[(i + 1) % n];
      const nW = norm3(cross3(sub(b0, a0), sub(a1, a0)));
      if (back({ x: nW.x * orient, y: nW.y * orient, z: nW.z * orient })) continue;
      const nn = R(nW);
      const tone = base + 0.35 * Math.abs(dot(nn, Ldir)) - 0.2;
      // מבט מפורט: פאות רחבות מחולקות גם לרוחב — מיון עומק נכון לברגים ופלטות קטנים
      const wid = Math.hypot(b0.x - a0.x, b0.y - a0.y, b0.z - a0.z);
      const J = 1; void wid;
      for (let k = 0; k < segs; k++) {
        const ka = k0 + ((k1 - k0) * k) / segs, kb = k0 + ((k1 - k0) * (k + 1)) / segs;
        const P0 = lerp(a0, a1, ka), P1 = lerp(a0, a1, kb), Q0 = lerp(b0, b1, ka), Q1 = lerp(b0, b1, kb);
        for (let j = 0; j < J; j++) {
          const p0 = lerp(P0, Q0, j / J), p1 = lerp(P1, Q1, j / J), q0 = lerp(P0, Q0, (j + 1) / J), q1 = lerp(P1, Q1, (j + 1) / J);
          const poly = [p0, q0, q1, p1];
          const ed: [Vec3, Vec3][] = [];
          if (j === 0) ed.push([p0, p1]);
          if (j === J - 1) ed.push([q0, q1]);
          faces.push({ poly, edges: ed, z: poly.reduce((acc, q) => acc + depth(q), 0) / 4 + bias, tone });
        }
      }
    }
    for (const kk of [k0, k1]) {
      const ring = ringAt(kk);
      const nn = R(norm3(cross3(sub(ring[1], ring[0]), sub(ring[2], ring[0]))));
      const cut = kk > 1e-6 && kk < 1 - 1e-6;
      shown.push(...ring);
      if (mi > 0 && marks[mi]) shownByMark.set(marks[mi], [...(shownByMark.get(marks[mi]) ?? []), ...ring]);
      const ax = norm3(axisV);
      if (back(kk < 0.5 ? { x: -ax.x, y: -ax.y, z: -ax.z } : ax)) continue;
      faces.push({ poly: ring, edges: ring.map((q, i) => [q, ring[(i + 1) % n]] as [Vec3, Vec3]), z: ring.reduce((acc, q) => acc + depth(q), 0) / n + bias, tone: cut ? 0.35 : base + 0.35 * Math.abs(dot(nn, Ldir)) - 0.2 });
    }
  });
  if (!shown.length) return;
  // חורים בפלטות: דיסקה כהה בשני פני חבילת הפלטות (מעט לפני הפאה שעליה היא יושבת)
  for (const h of holes) {
    if (clip && (loc(h.p).t < clip[0] - 1 || loc(h.p).t > clip[1] + 1)) continue;
    const a = norm3(h.axis);
    const e1 = norm3(Math.abs(a.z) < 0.9 ? cross3(a, { x: 0, y: 0, z: 1 }) : cross3(a, { x: 1, y: 0, z: 0 })), e2 = cross3(a, e1);
    for (const off of [0, h.len]) {
      const c = { x: h.p.x + a.x * off, y: h.p.y + a.y * off, z: h.p.z + a.z * off };
      const poly = Array.from({ length: 16 }, (_, i) => { const t = (i / 16) * Math.PI * 2; return { x: c.x + (e1.x * Math.cos(t) + e2.x * Math.sin(t)) * h.r, y: c.y + (e1.y * Math.cos(t) + e2.y * Math.sin(t)) * h.r, z: c.z + (e1.z * Math.cos(t) + e2.z * Math.sin(t)) * h.r }; });
      faces.push({ poly, edges: poly.map((q, i) => [q, poly[(i + 1) % 16]] as [Vec3, Vec3]), z: depth(c) - 3, tone: 0.12 });
    }
  }
  const ip = shown.map(isoXY);
  const bx = { x0: Math.min(...ip.map((q) => q.x)), x1: Math.max(...ip.map((q) => q.x)), y0: Math.min(...ip.map((q) => q.y)), y1: Math.max(...ip.map((q) => q.y)) };
  const isc = Math.max((bx.x1 - bx.x0) / (box.x1 - box.x0 - 16), (bx.y1 - bx.y0) / (box.y1 - box.y0 - 22), 1e-6);
  const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2 - 3;
  const IP = (q: Vec3): P => { const r = isoXY(q); return { x: cx + (r.x - (bx.x0 + bx.x1) / 2) / isc, y: cy + (r.y - (bx.y0 + bx.y1) / 2) / isc }; };
  faces.sort((a, b) => b.z - a.z);
  for (const fc of faces) {
    E.push({ k: 'poly', pts: fc.poly.map(IP), closed: true, layer: 'THIN', shade: fc.tone });
    for (const [a, b] of fc.edges) E.push({ k: 'line', a: IP(a), b: IP(b), layer: 'OUTLINE' });
  }
  E.push({ k: 'text', p: { x: box.x1, y: box.y1 + 1 }, s: title, h: 2.5, align: 'right', layer: 'TEXT', bold: true });
  // בועת סימון אחת לכל סימון גלוי, בתוך גבולות המבט
  const used: P[] = [];
  for (const [mk, pts] of shownByMark) {
    const c = pts.reduce((acc, q) => ({ x: acc.x + q.x / pts.length, y: acc.y + q.y / pts.length, z: Math.max(acc.z, q.z) }), { x: 0, y: 0, z: -1e9 });
    const pc = IP(c);
    let b = { x: Math.min(box.x1 - 4, Math.max(box.x0 + 4, pc.x + 8)), y: Math.min(box.y1 - 6, pc.y + 9) };
    for (let g = 0; g < 12 && used.some((u) => Math.hypot(u.x - b.x, u.y - b.y) < 7.5); g++) b = { x: Math.min(box.x1 - 4, b.x + 7), y: Math.max(box.y0 + 4, b.y - 4) };
    used.push(b);
    E.push({ k: 'line', a: pc, b, layer: 'MARK' });
    E.push({ k: 'circle', c: b, r: 3, layer: 'MARK' });
    E.push({ k: 'text', p: { x: b.x, y: b.y - 0.9 }, s: mk, h: mk.length > 3 ? 1.9 : 2.3, align: 'center', layer: 'MARK', bold: true });
  }
}

/** גיליון 2 של מכלול גדול: רשימת חלקים מלאה + תלת־ממד גדול + הערות ייצור */
export function assemblyListSheet(sh: Sheet, fab: Fabrication, d: DerivedModel, mark: string): string {
  const asm = fab.assemblies.find((x) => x.mark === mark);
  if (!asm) return '—';
  const E: Sheet['ents'] = sh.ents;
  const text = (p: P, s: string, h = 2.5, align: 'left' | 'center' | 'right' = 'right', bold = false) => E.push({ k: 'text', p, s, h, align, layer: 'TEXT', bold });
  const parts = asm.parts.map((pid) => fab.byPart.get(pid)!).filter(Boolean);
  const mainPart = fab.byPart.get(asm.main)!;
  const cnt = new Map<string, { q: number; p: MarkedPart }>();
  for (const pt of parts) { const e = cnt.get(pt.mark) ?? { q: 0, p: pt }; e.q++; cnt.set(pt.mark, e); }
  const rows = [...cnt.values()].sort((a, b) => (a.p === mainPart ? -1 : b.p === mainPart ? 1 : a.p.mark.localeCompare(b.p.mark, 'en', { numeric: true })));
  const area = drawArea(sh);
  const tx1 = area.x1 - 4, tx0 = area.x1 - 230, rowH = 5;
  const cols: [string, number][] = [['סימון', 16], ['כמות', 11], ['תיאור', 82], ['חתך', 36], ['אורך', 18], ['ק"ג/יח\'', 16], ['ק"ג', 18]];
  const kx = (tx1 - tx0) / cols.reduce((a, c) => a + c[1], 0);
  let y = area.y1 - 8;
  text({ x: tx1, y }, `מכלול ${asm.mark} — רשימת חלקים (${parts.length} חלקים, ${rows.length} סימונים) · ${asm.weight.toFixed(1)} ק"ג · כמות בפרויקט ${fab.assemblies.filter((x) => x.mark === asm.mark).length}`, 3, 'right', true);
  y -= 6;
  const top = y;
  const hl = (yy: number) => E.push({ k: 'line', a: { x: tx0, y: yy }, b: { x: tx1, y: yy }, layer: 'THIN' });
  hl(y);
  const row = (vals: string[], bold = false) => { let x = tx1; vals.forEach((v, i) => { text({ x: x - 1, y: y - rowH + 1.6 }, v, 2.6, 'right', bold); x -= cols[i][1] * kx; }); y -= rowH; hl(y); };
  row(cols.map((c) => c[0]), true);
  for (const r of rows) row([r.p.mark, String(r.q), r.p.desc, r.p.profile, String(Math.round(r.p.length)), r.p.weight.toFixed(1), (r.p.weight * r.q).toFixed(1)]);
  { let x = tx1; for (let i = 0; i <= cols.length; i++) { E.push({ k: 'line', a: { x, y: top }, b: { x, y }, layer: 'THIN' }); if (i < cols.length) x -= cols[i][1] * kx; } }
  // תלת־ממד גדול בצד השמאלי
  const ms = parts.map((pt) => d.byId.get(pt.memberId)!).filter(Boolean);
  const m0 = d.byId.get(mainPart.memberId)!;
  renderIso(sh, ms, parts.map((x) => x.mark), { x0: area.x0 + 4, x1: tx0 - 10, y0: area.y0 + 10, y1: area.y1 - 10 }, null, (q) => ({ t: dot(sub(q, m0.start), localFrame(m0).ex), u: 0, v: 0 }), 'מבט תלת־ממדי — המכלול (ללא קנ"מ)');
  const weld = d.connections.flatMap((c) => c.welds).filter((w) => w.location === 'shop' && ms.some((m) => m.id === w.between[0]) && ms.some((m) => m.id === w.between[1]));
  const aS = [...new Set(weld.map((w) => w.a))].sort((a, b) => a - b);
  const notes = [aS.length ? `ריתוך פינתי במסגריה a=${aS.join('/')} מ"מ, היקפי, לפני גלוון` : 'ללא ריתוך במכלול', 'גלוון חם לאחר ייצור; הרכבה בשטח בברגים בלבד', `מבטים ומידות — בגיליון A-${asm.mark}`];
  y -= 8;
  notes.forEach((n2, i) => text({ x: tx1, y: y - i * 4 }, `${i + 1}. ${n2}`, 2.6));
  return '—';
}
