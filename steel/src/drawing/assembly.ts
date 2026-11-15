import { dot, sub, type Vec3 } from '../core/vec';
import { localFrame } from '../geometry/frame';
import type { Fabrication, MarkedPart } from '../fab/marks';
import type { DerivedModel, Member } from '../model/types';
import { cachedSolidPure } from './solidCache';
import { fitScale, type P, type Sheet } from './sheet';

/**
 * שרטוט מכלול (החלטת משתמש 15.11.2026: "לא ברור — לצרף תלת־ממד"):
 *  · מבט חזית ומבט עליון בקנה מידה אחיד, בועות סימון עם קו מוביל, שרשרת מידות למיקומי החלקים המרותכים
 *  · פרטים מוגדלים לשני הקצוות (1:10 בערך) עם החורים ומידותיהם
 *  · מבט איזומטרי מוצלל (צביעה לפי עומק) — להבנה מהירה של המכלול
 *  · טבלת חלקים והערות ייצור
 * כל המידות נגזרות מהמודל.
 */
export function assemblySheet(sh: Sheet, fab: Fabrication, d: DerivedModel, mark: string): string {
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
  const text = (p: P, s: string, h = 2.2, align: 'left' | 'center' | 'right' = 'center', layer: 'TEXT' | 'DIM' | 'MARK' = 'TEXT', bold = false, rot = 0) =>
    E.push({ k: 'text', p, s, h, align, layer, bold, rot });

  // ---- תחום המכלול בקואורדינטות המקומיות
  const allLoc = parts.flatMap((pt) => { const s = cachedSolidPure(memOf(pt)); return [...s.startRing, ...s.endRing].map(loc); });
  const tMin = Math.min(...allLoc.map((q) => q.t)), tMax = Math.max(...allLoc.map((q) => q.t));
  const uMin = Math.min(...allLoc.map((q) => q.u)), uMax = Math.max(...allLoc.map((q) => q.u));
  const vMin = Math.min(...allLoc.map((q) => q.v)), vMax = Math.max(...allLoc.map((q) => q.v));

  // ---- פריסת הגיליון (A3): מבטים ראשיים למעלה משמאל, תלת־ממד מימין, פרטים באמצע, טבלה בתחתית מימין
  const A = { x0: 30, x1: 292, yTop: sh.h - 22 };
  const sc = fitScale((tMax - tMin) * 1.04, Math.max(vMax - vMin, uMax - uMin) * 3, A.x1 - A.x0, 38);
  const ox = A.x0 + ((A.x1 - A.x0) - (tMax - tMin) / sc) / 2 - tMin / sc;
  const yF = A.yTop - 22 - (vMax - vMin) / sc; // תחתית מבט החזית (v = vMin)
  const yT = yF - 30 - (uMax - uMin) / sc;     // תחתית מבט עליון (u = uMin)
  const PF = (t: number, v: number): P => ({ x: ox + t / sc, y: yF + (v - vMin) / sc });
  const PT = (t: number, u: number): P => ({ x: ox + t / sc, y: yT + (u - uMin) / sc });

  /** קווי מתאר של אלמנט בהיטל נתון, עם קיטום לתחום t אופציונלי. */
  const drawEdges = (m: Member, proj: (q: { t: number; u: number; v: number }) => P, layer: 'OUTLINE' | 'THIN', tr?: [number, number]) => {
    const s = cachedSolidPure(m);
    for (let i = 0; i < s.edges.length; i += 6) {
      let a = loc({ x: s.edges[i], y: s.edges[i + 1], z: s.edges[i + 2] }), b = loc({ x: s.edges[i + 3], y: s.edges[i + 4], z: s.edges[i + 5] });
      if (tr) {
        const lo = Math.min(a.t, b.t), hi = Math.max(a.t, b.t);
        if (hi < tr[0] || lo > tr[1]) continue;
        const cut = (q: typeof a, w: typeof a, t: number) => { const k = (t - q.t) / (w.t - q.t); return { t, u: q.u + (w.u - q.u) * k, v: q.v + (w.v - q.v) * k }; };
        if (Math.abs(b.t - a.t) > 1e-6) {
          if (a.t > b.t) [a, b] = [b, a];
          if (a.t < tr[0]) a = cut(a, b, tr[0]);
          if (b.t > tr[1]) b = cut(a, b, tr[1]);
        }
      }
      const pa = proj(a), pb = proj(b);
      if (Math.hypot(pa.x - pb.x, pa.y - pb.y) > 0.15) line(pa, pb, layer);
    }
  };
  const dimH = (xa: number, xb: number, y: number, label: string, tick = 1.2) => {
    line({ x: xa, y }, { x: xb, y }, 'DIM');
    for (const x of [xa, xb]) line({ x: x - tick * 0.7, y: y - tick }, { x: x + tick * 0.7, y: y + tick }, 'DIM');
    text({ x: (xa + xb) / 2, y: y + 1.1 }, label, 2, 'center', 'DIM');
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

  // ---- מבט חזית ועליון
  text({ x: A.x0, y: A.yTop }, `מבט חזית 1:${sc}`, 2.6, 'left', 'TEXT', true);
  for (const pt of parts) {
    const m = memOf(pt);
    drawEdges(m, (q) => PF(q.t, q.v), pt === mainPart ? 'OUTLINE' : 'THIN');
    drawEdges(m, (q) => PT(q.t, q.u), pt === mainPart ? 'OUTLINE' : 'THIN');
  }
  text({ x: A.x0, y: yT - 10 }, `מבט עליון 1:${sc}`, 2.6, 'left', 'TEXT', true);
  // ציר החלק הראשי
  line(PF(tMin - 150, 0), PF(tMax + 150, 0), 'AXIS');

  // מרכזי החלקים המשניים, בועות ושרשרת מידות
  const cen = (pt: MarkedPart) => {
    const s = cachedSolidPure(memOf(pt));
    const q = [...s.startRing, ...s.endRing].map(loc);
    return { t: q.reduce((a, b) => a + b.t, 0) / q.length, u: q.reduce((a, b) => a + b.u, 0) / q.length, v: q.reduce((a, b) => a + b.v, 0) / q.length, vmax: Math.max(...q.map((x) => x.v)) };
  };
  const byMark = new Map<string, MarkedPart[]>();
  for (const pt of subs) byMark.set(pt.mark, [...(byMark.get(pt.mark) ?? []), pt]);
  const yBub = PF(0, vMax).y + 12;
  const used: number[] = [];
  bubble({ x: PF((tMin + tMax) / 2, 0).x, y: PF(0, vMin).y - 7 }, mainPart.mark);
  for (const [mk, list] of byMark) {
    const c0 = cen(list[0]);
    let x = PF(c0.t, 0).x;
    while (used.some((u) => Math.abs(u - x) < 8)) x += 8;
    used.push(x);
    for (const pt of list) { const c = cen(pt); line(PF(c.t, c.vmax), { x, y: yBub - 3.4 }, 'MARK'); }
    bubble({ x, y: yBub }, mk);
    if (list.length > 1) text({ x: x + 4.5, y: yBub + 2.6 }, `×${list.length}`, 2, 'left', 'MARK');
  }
  // שרשרת מיקומים מתחילת החלק הראשי (מצטבר) מתחת למבט החזית
  const ts = [...new Set(subs.map((pt) => Math.round(cen(pt).t)))].filter((t) => t > 1 && t < L - 1).sort((a, b) => a - b);
  const yChain = PF(0, vMin).y - 13;
  if (ts.length) {
    line({ x: PF(0, 0).x, y: yChain }, { x: PF(L, 0).x, y: yChain }, 'DIM');
    let lastX = -1e9;
    for (const t of [0, ...ts]) {
      const x = PF(t, 0).x;
      line({ x: x - 0.8, y: yChain - 1.1 }, { x: x + 0.8, y: yChain + 1.1 }, 'DIM');
      if (t > 0 && x - lastX > 3) { text({ x, y: yChain - 3.4 }, String(t), 1.9, 'center', 'DIM', false, 90); lastX = x; }
    }
    text({ x: PF(0, 0).x - 2, y: yChain - 0.7 }, '0', 1.9, 'right', 'DIM');
  }
  dimH(PF(0, 0).x, PF(L, 0).x, PT(0, uMin).y - 7, `${Math.round(L)}`);

  // ---- פרטים מוגדלים לקצוות
  const detH = 66, detTop = yT - 18, detW = (A.x1 - A.x0 - 12) / 2;
  const span = 700;
  const regions: [string, number, number][] = [['א', tMin - 40, tMin - 40 + span], ['ב', tMax + 40 - span, tMax + 40]];
  const dsc = fitScale(span, (vMax - vMin) * 1.25, detW - 14, detH - 18);
  regions.forEach(([name, t0, t1], k) => {
    const x0 = A.x0 + k * (detW + 12);
    const P2 = (t: number, v: number): P => ({ x: x0 + 8 + (t - t0) / dsc, y: detTop - detH + 10 + (v - vMin) / dsc });
    text({ x: x0, y: detTop }, `פרט ${name} — ${k ? 'קצה סוף' : 'קצה התחלה'} 1:${dsc}`, 2.4, 'left', 'TEXT', true);
    // סימון אזור הפרט במבט החזית
    const a = PF(Math.max(t0, tMin), vMin), b = PF(Math.min(t1, tMax), vMax);
    E.push({ k: 'poly', pts: [{ x: a.x - 1, y: a.y - 1 }, { x: b.x + 1, y: a.y - 1 }, { x: b.x + 1, y: b.y + 1 }, { x: a.x - 1, y: b.y + 1 }], closed: true, layer: 'HIDDEN' });
    text({ x: k ? b.x + 2 : a.x - 2, y: b.y + 2 }, name, 2.6, k ? 'left' : 'right', 'MARK', true);
    for (const pt of parts) drawEdges(memOf(pt), (q) => P2(q.t, q.v), pt === mainPart ? 'OUTLINE' : 'THIN', [t0, t1]);
    // חורים בווב/חתך של כל החלקים שבאזור, מידות מהקצה
    const holes: { t: number; v: number; d: number }[] = [];
    for (const pt of parts) {
      const m = memOf(pt), lf = localFrame(m);
      for (const h of pt.holes) {
        // מיקום החור בעולם ← מקומי של החלק הראשי
        const w = { x: m.start.x + lf.ex.x * (h.t + pt.t0), y: m.start.y + lf.ex.y * (h.t + pt.t0), z: m.start.z + lf.ex.z * (h.t + pt.t0) };
        // ווב: c לאורך v, c2 לאורך u; אגף/חתך: c לאורך u, c2 לאורך v
        const [a1, a2] = h.face === 'web' ? [lf.v, lf.u] : [lf.u, lf.v];
        const c2 = h.c2 ?? 0;
        const W = { x: w.x + a1.x * h.c + a2.x * c2, y: w.y + a1.y * h.c + a2.y * c2, z: w.z + a1.z * h.c + a2.z * c2 };
        const q = loc(W);
        if (q.t < t0 || q.t > t1) continue;
        holes.push({ t: q.t, v: q.v, d: h.d });
        E.push({ k: 'circle', c: P2(q.t, q.v), r: Math.max(h.d / 2 / dsc, 0.7), layer: 'HOLE' });
      }
    }
    const end = k ? tMax : 0;
    const hts = [...new Set(holes.map((h) => Math.round(h.t)))].sort((a2, b2) => (k ? b2 - a2 : a2 - b2)).slice(0, 4);
    let prev = end, yy = P2(0, vMax).y + 5;
    for (const t of hts) {
      if (Math.abs(t - prev) < 1) continue;
      dimH(Math.min(P2(prev, 0).x, P2(t, 0).x), Math.max(P2(prev, 0).x, P2(t, 0).x), yy, String(Math.abs(Math.round(t - prev))));
      prev = t;
    }
    const hvs = [...new Set(holes.map((h) => Math.round(h.v)))].sort((a2, b2) => a2 - b2);
    if (hvs.length) {
      const xd = k ? P2(t1, 0).x + 3 : P2(t0, 0).x - 3;
      dimV(xd, P2(0, vMin).y, P2(0, hvs[0]).y, String(Math.round(hvs[0] - vMin)));
      if (hvs.length > 1) dimV(xd + (k ? 5 : -5), P2(0, hvs[0]).y, P2(0, hvs[hvs.length - 1]).y, String(hvs[hvs.length - 1] - hvs[0]));
    }
    const ds = [...new Set(holes.map((h) => h.d))];
    if (ds.length) text({ x: x0 + detW / 2, y: detTop - detH + 3 }, `חורים: ${ds.map((x) => `Ø${x}`).join(', ')}`, 2, 'center');
  });

  // ---- מבטים איזומטריים מוצללים (עולם: Z למעלה): מכלול שלם + הגדלה לכל קצה
  const ms = parts.map(memOf);
  renderIso(sh, ms, parts.map((x) => x.mark), { x0: 302, x1: sh.w - 14, y0: 150, y1: sh.h - 18 }, null, loc, 'מבט תלת־ממדי — המכלול (ללא קנ"מ)');
  regions.forEach(([name, t0, t1], k) => {
    const w = (A.x1 - A.x0 - 12) / 2, x0 = A.x0 + k * (w + 12);
    renderIso(sh, ms, parts.map((x) => x.mark), { x0, x1: x0 + w, y0: 74, y1: detTop - detH - 8 }, [t0, t1], loc, `תלת־ממד — פרט ${name}`);
  });

  // ---- טבלת חלקים
  const tx1 = sh.w - 12, tx0 = 210, rowH = 4.6;
  const cols: [string, number][] = [['סימון', 16], ['כמות', 11], ['תיאור', 70], ['חתך', 34], ['אורך', 17], ['ק"ג/יח\'', 15], ['ק"ג', 17]];
  const scaleW = (tx1 - tx0) / cols.reduce((a, c) => a + c[1], 0);
  const cnt = new Map<string, { q: number; p: MarkedPart }>();
  for (const pt of parts) { const e = cnt.get(pt.mark) ?? { q: 0, p: pt }; e.q++; cnt.set(pt.mark, e); }
  const rows = [...cnt.values()].sort((a, b) => (a.p === mainPart ? -1 : b.p === mainPart ? 1 : a.p.mark.localeCompare(b.p.mark, 'en', { numeric: true })));
  const tableTop = 12 + rowH * (rows.length + 2) + 2;
  let yy = tableTop;
  const hline = (y: number) => line({ x: tx0, y }, { x: tx1, y }, 'THIN');
  text({ x: tx1, y: yy + 2 }, `מכלול ${asm.mark} · ${asm.weight.toFixed(1)} ק"ג · כמות בפרויקט ${fab.assemblies.filter((x) => x.mark === asm.mark).length}`, 2.6, 'right', 'TEXT', true);
  hline(yy);
  const drawRow = (vals: string[], bold = false) => {
    let x = tx1;
    vals.forEach((v, i) => {
      const w = cols[i][1] * scaleW;
      text({ x: x - 1, y: yy - rowH + 1.4 }, v, 2.1, 'right', 'TEXT', bold);
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
    'מידות במ"מ; מיקומים מצטברים מתחילת החלק הראשי',
  ];
  notes.forEach((n2, i) => text({ x: tx1, y: tableTop + 10 + (notes.length - 1 - i) * 3.6 }, `${i + 1}. ${n2}`, 2.1, 'right'));
  return `1:${sc}`;
}

function cross3(a: Vec3, b: Vec3): Vec3 { return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }; }
function norm3(a: Vec3): Vec3 { const l = Math.hypot(a.x, a.y, a.z) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; }

/**
 * מבט איזומטרי מוצלל בשיטת הצייר: פאות מחולקות לקטעים קצרים לאורך האלמנט כדי שמיון העומק יהיה נכון,
 * ותאורה לפי נורמל הפאה. clip: תחום t (במערכת החלק הראשי) — מציג רק את הקטעים שבתחום, עם פאת חתך בגבול.
 */
function renderIso(sh: Sheet, ms: Member[], marks: string[], box: { x0: number; x1: number; y0: number; y1: number }, clip: [number, number] | null,
  loc: (q: Vec3) => { t: number; u: number; v: number }, title: string) {
  const E = sh.ents;
  const C30 = Math.cos(Math.PI / 6), S30 = 0.5;
  const isoXY = (q: Vec3) => ({ x: (q.x - q.y) * C30, y: q.z + (q.x + q.y) * S30 });
  const depth = (q: Vec3) => q.x + q.y - q.z; // גדול = רחוק מהצופה
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
    const segs = Math.max(1, Math.min(90, Math.ceil(len / (clip ? 40 : 150))));
    const base = mi === 0 ? 0.6 : 0.8;
    const ringAt = (k: number) => s.startRing.map((q, i) => lerp(q, s.endRing[i], k));
    for (let i = 0; i < n; i++) {
      const a0 = s.startRing[i], b0 = s.startRing[(i + 1) % n], a1 = s.endRing[i], b1 = s.endRing[(i + 1) % n];
      const nn = norm3(cross3(sub(b0, a0), sub(a1, a0)));
      const tone = base + 0.35 * Math.abs(dot(nn, Ldir)) - 0.2;
      for (let k = 0; k < segs; k++) {
        const ka = k0 + ((k1 - k0) * k) / segs, kb = k0 + ((k1 - k0) * (k + 1)) / segs;
        const p0 = lerp(a0, a1, ka), p1 = lerp(a0, a1, kb), q0 = lerp(b0, b1, ka), q1 = lerp(b0, b1, kb);
        const poly = [p0, q0, q1, p1];
        faces.push({ poly, edges: [[p0, p1], [q0, q1]], z: poly.reduce((acc, q) => acc + depth(q), 0) / 4, tone });
      }
    }
    for (const kk of [k0, k1]) {
      const ring = ringAt(kk);
      const nn = norm3(cross3(sub(ring[1], ring[0]), sub(ring[2], ring[0])));
      const cut = kk > 1e-6 && kk < 1 - 1e-6;
      faces.push({ poly: ring, edges: ring.map((q, i) => [q, ring[(i + 1) % n]] as [Vec3, Vec3]), z: ring.reduce((acc, q) => acc + depth(q), 0) / n, tone: cut ? 0.35 : base + 0.35 * Math.abs(dot(nn, Ldir)) - 0.2 });
      shown.push(...ring);
      if (mi > 0) shownByMark.set(marks[mi], [...(shownByMark.get(marks[mi]) ?? []), ...ring]);
    }
  });
  if (!shown.length) return;
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
  E.push({ k: 'text', p: { x: box.x1, y: box.y1 + 1 }, s: title, h: 2.3, align: 'right', layer: 'TEXT', bold: true });
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
