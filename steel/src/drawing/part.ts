import { dot, sub, type Vec3 } from '../core/vec';
import { localFrame } from '../geometry/frame';
import type { Fabrication, MarkedPart } from '../fab/marks';
import type { DerivedModel } from '../model/types';
import { getProfile } from '../profiles/library';
import { cachedSolidPure } from './solidCache';
import { drawArea, fitScale, type P, type Sheet } from './sheet';

/**
 * שרטוט חלק (בקשת משתמש 15.11.2026):
 *  · פלטה: מבט על פני הפלטה בקנה מידה אחיד — מידות כוללות, שרשרת מרכזי חורים בשני הכיוונים מהשפות, קוטר חורים; מבט קצה עם עובי
 *  · פרופיל: מבט חזית ועליון, חורים ומידותיהם, וקצה בשיפוע — אורך בצד הארוך ובצד הקצר וזווית החיתוך
 *  · כל השרטוט בתוך שטח הגיליון, מעל גוש הכותרת
 */
export function partSheet(sh: Sheet, fab: Fabrication, d: DerivedModel, mark: string): string {
  const part = fab.parts.find((x) => x.mark === mark);
  if (!part) return '—';
  const m = d.byId.get(part.memberId)!;
  const f = localFrame(m);
  const loc = (q: Vec3) => { const r = sub(q, m.start); return { t: dot(r, f.ex) - part.t0, u: dot(r, f.u), v: dot(r, f.v) }; };
  const L = part.length;
  const s = cachedSolidPure(m);
  const ring = [...s.startRing, ...s.endRing].map(loc);
  const umin = Math.min(...ring.map((q) => q.u)), umax = Math.max(...ring.map((q) => q.u));
  const vmin = Math.min(...ring.map((q) => q.v)), vmax = Math.max(...ring.map((q) => q.v));
  const area = drawArea(sh);
  const R = { x0: area.x0 + 8, x1: area.x1 - 118, y0: area.y0 + 4, y1: area.y1 - 4 };
  const E = sh.ents;
  const line = (a: P, b: P, layer: 'OUTLINE' | 'THIN' | 'DIM' | 'HIDDEN' | 'AXIS' | 'HOLE' = 'OUTLINE') => E.push({ k: 'line', a, b, layer });
  const text = (p: P, str: string, h = 2.5, align: 'left' | 'center' | 'right' = 'center', layer: 'TEXT' | 'DIM' | 'MARK' = 'TEXT', bold = false, rot = 0) => E.push({ k: 'text', p, s: str, h, align, layer, bold, rot });
  const dimH = (xa: number, xb: number, y: number, label: string) => {
    if (Math.abs(xb - xa) < 0.01) return;
    line({ x: xa, y }, { x: xb, y }, 'DIM');
    for (const x of [xa, xb]) line({ x: x - 0.8, y: y - 1.1 }, { x: x + 0.8, y: y + 1.1 }, 'DIM');
    // מידה קצרה מדי לטקסט — הטקסט מעל, מוסט
    const narrow = Math.abs(xb - xa) < 2 * label.length;
    text({ x: (xa + xb) / 2, y: y + (narrow ? 3.4 : 1) }, label, 2, 'center', 'DIM');
  };
  const dimV = (x: number, ya: number, yb: number, label: string) => {
    if (Math.abs(yb - ya) < 0.3) return;
    line({ x, y: ya }, { x, y: yb }, 'DIM');
    for (const y of [ya, yb]) line({ x: x - 1.1, y: y - 0.8 }, { x: x + 1.1, y: y + 0.8 }, 'DIM');
    text({ x: x - 1.2, y: (ya + yb) / 2 }, label, 2, 'center', 'DIM', false, 90);
  };
  /** קווי האלמנט בהיטל (t, w) — w = u או v; קיטום לתחום החלק */
  const drawEdges = (proj: (t: number, w: number) => P, axis: 'u' | 'v') => {
    for (let i = 0; i < s.edges.length; i += 6) {
      let a = loc({ x: s.edges[i], y: s.edges[i + 1], z: s.edges[i + 2] }), b = loc({ x: s.edges[i + 3], y: s.edges[i + 4], z: s.edges[i + 5] });
      if (Math.abs(a.t - b.t) > 1e-6) {
        if (a.t > b.t) [a, b] = [b, a];
        if (b.t < -0.5 || a.t > L + 0.5) continue;
        const at = (q: typeof a, w: typeof a, t: number) => { const k = (t - q.t) / (w.t - q.t); return { t, u: q.u + (w.u - q.u) * k, v: q.v + (w.v - q.v) * k }; };
        if (a.t < 0) a = at(a, b, 0);
        if (b.t > L) b = at(a, b, L);
      } else if (a.t < -0.5 || a.t > L + 0.5) continue;
      const pa = proj(a.t, a[axis]), pb = proj(b.t, b[axis]);
      if (Math.hypot(pa.x - pb.x, pa.y - pb.y) > 0.15) line(pa, pb);
    }
    // צללית לחתכים מעוגלים (RHS/CHS): קווי קצה לאורך האלמנט בנקודות הקיצון של החתך
    const r0 = s.startRing.map(loc), r1 = s.endRing.map(loc);
    if (r0.length && r0.length === r1.length) {
      const ws = r0.map((q) => q[axis]);
      for (const i of [ws.indexOf(Math.min(...ws)), ws.indexOf(Math.max(...ws))]) {
        const a = r0[i], b = r1[i];
        const t0 = Math.max(0, Math.min(a.t, b.t)), t1 = Math.min(L, Math.max(a.t, b.t));
        line(proj(t0, a[axis]), proj(t1, b[axis]));
      }
    }
  };
  const holeCircle = (c: P, dmm: number, sc: number) => {
    E.push({ k: 'circle', c, r: Math.max(dmm / 2 / sc, 0.6), layer: 'HOLE' });
    const r = Math.max(dmm / 2 / sc, 0.6) + 1.2;
    line({ x: c.x - r, y: c.y }, { x: c.x + r, y: c.y }, 'AXIS'); line({ x: c.x, y: c.y - r }, { x: c.x, y: c.y + r }, 'AXIS');
  };
  const chain = (vals: number[]) => [...new Set(vals.map((x) => Math.round(x * 10) / 10))].sort((a, b) => a - b);
  const holeNote = (hs: { d: number }[]) => { const g = new Map<number, number>(); for (const h of hs) g.set(h.d, (g.get(h.d) ?? 0) + 1); return [...g].map(([dd, q]) => `${q}×Ø${dd}`).join(', '); };
  const rows: string[] = [];
  const qty = fab.parts.filter((x) => x.mark === part.mark).length;
  let scaleLabel: string;

  if (m.kind === 'plate') {
    // ---- פלטה: מבט על הפנים + מבט קצה (עובי); צירי הפנים = שני המימדים הגדולים, ללא תלות באופן הגדרת האלמנט
    const g = plateGeom(part, d);
    const W = g.y1 - g.y0, Lp = g.x1 - g.x0, T = g.T;
    const sc = fitScale(Lp * 1.25, W * 1.25 + T + 40, R.x1 - R.x0 - 30, R.y1 - R.y0 - 60);
    scaleLabel = `1:${sc}`;
    sh.scale = sc;
    const cx = (R.x0 + R.x1) / 2, top = R.y1 - 18;
    const PF = (x: number, y: number): P => ({ x: cx + (x - (g.x0 + g.x1) / 2) / sc, y: top - (g.y1 - y) / sc });
    text({ x: R.x0, y: R.y1 - 4 }, `מבט על פני הפלטה 1:${sc}`, 2.6, 'left', 'TEXT', true);
    for (const [a, b] of g.face) line(PF(a.x, a.y), PF(b.x, b.y));
    for (const h of g.holes) holeCircle(PF(h.x, h.y), h.d, sc);
    const yTop = PF(0, g.y1).y + 6;
    const xs = chain([g.x0, ...g.holes.map((h) => h.x), g.x1]);
    for (let k = 1; k < xs.length; k++) dimH(PF(xs[k - 1], 0).x, PF(xs[k], 0).x, yTop, String(Math.round(xs[k] - xs[k - 1])));
    dimH(PF(g.x0, 0).x, PF(g.x1, 0).x, PF(0, g.y0).y - 8, `${Math.round(Lp)}`);
    { const xb = g.face.flatMap(([a, b]) => [a, b]).filter((q) => Math.abs(q.y - g.y0) < 0.5).map((q) => q.x);
      if (xb.length && (Math.min(...xb) > g.x0 + 0.5 || Math.max(...xb) < g.x1 - 0.5)) dimH(PF(Math.min(...xb), 0).x, PF(Math.max(...xb), 0).x, PF(0, g.y0).y - 14, `${Math.round(Math.max(...xb) - Math.min(...xb))} (שפה תחתונה)`); }
    const xR = PF(g.x1, 0).x + 7;
    const ys = chain([g.y0, ...g.holes.map((h) => h.y), g.y1]);
    for (let k = 1; k < ys.length; k++) dimV(xR, PF(0, ys[k - 1]).y, PF(0, ys[k]).y, String(Math.round(ys[k] - ys[k - 1])));
    dimV(xR + 7, PF(0, g.y0).y, PF(0, g.y1).y, `${Math.round(W)}`);
    if (g.holes.length) {
      const c0 = PF(g.holes[0].x, g.holes[0].y);
      const lp = { x: PF(g.x0, 0).x - 6, y: PF(0, g.y0).y - 3 };
      line(c0, lp, 'DIM');
      text({ x: lp.x - 1, y: lp.y - 1 }, `${holeNote(g.holes)} — חור עובר`, 2.5, 'right', 'DIM');
    }
    const yE = PF(0, g.y0).y - 22;
    const PE = (x: number, z: number): P => ({ x: cx + (x - (g.x0 + g.x1) / 2) / sc, y: yE - z / sc });
    for (const [a, b] of g.edge) line(PE(a.x, a.y), PE(b.x, b.y));
    dimV(PE(g.x1, 0).x + 7, PE(0, 0).y, PE(0, T).y, `${Math.round(T)}`);
    text({ x: R.x0, y: yE + 4 }, 'מבט קצה (עובי)', 2.5, 'left');
    rows.push(`פלטה ${Math.round(T)}×${Math.round(W)}×${Math.round(Lp)} מ"מ`);
  } else {
    // ---- פרופיל: מבט חזית (t, v) ומבט עליון (t, u)
    const hv = vmax - vmin, hu = umax - umin;
    const avH = R.y1 - R.y0 - 70;
    const sx = fitScale(L * 1.06, 1, R.x1 - R.x0 - 16, 1e9);
    let sy = sx;
    if ((hv + hu) / sx < 30) sy = fitScale(1, hv + hu, 1e9, Math.min(70, avH));
    if ((hv + hu) / sy > avH) sy = fitScale(1, hv + hu, 1e9, avH);
    scaleLabel = sx === sy ? `1:${sx}` : `1:${sx} / 1:${sy}*`;
    sh.scale = sx;
    if (sx !== sy) text({ x: R.x0, y: R.y0 + 2 }, `* קנ"מ אורכי 1:${sx}, קנ"מ רוחבי 1:${sy} — לייצור לפי המידות בלבד`, 2.5, 'left');
    const ox = R.x0 + 8;
    const yF0 = R.y1 - 22; // ראש מבט החזית (v = vmax)
    const PF = (t: number, v: number): P => ({ x: ox + t / sx, y: yF0 - (vmax - v) / sy });
    const yT0 = PF(0, vmin).y - 30; // ראש מבט עליון (u = umax)
    const PT = (t: number, u: number): P => ({ x: ox + t / sx, y: yT0 - (umax - u) / sy });
    text({ x: R.x0, y: R.y1 - 4 }, 'מבט חזית', 2.6, 'left', 'TEXT', true);
    text({ x: R.x0, y: yT0 + 9 }, 'מבט עליון', 2.6, 'left', 'TEXT', true);
    drawEdges(PF, 'v');
    drawEdges(PT, 'u');
    line(PF(-5, (vmin + vmax) / 2), PF(L + 5, (vmin + vmax) / 2), 'AXIS');
    for (const h of part.holes) {
      if (h.face === 'web') holeCircle(PF(h.t, h.c), h.d, sy);
      if (h.face === 'flange') holeCircle(PT(h.t, h.c), h.d, sy);
    }
    // קצה בשיפוע: אורך לאורך הפאה העליונה והתחתונה של מבט החזית + זווית
    const edgeT = (ring: { t: number; v: number }[], vv: number) => { const pts = ring.filter((q) => Math.abs(q.v - vv) < 0.5); return pts.length ? pts.reduce((a, q) => a + q.t, 0) / pts.length : null; };
    const ring0 = s.startRing.map(loc), ring1 = s.endRing.map(loc);
    const sTop = edgeT(ring0, vmax) ?? 0, sBot = edgeT(ring0, vmin) ?? 0, eTop = edgeT(ring1, vmax) ?? L, eBot = edgeT(ring1, vmin) ?? L;
    const sloped = Math.abs(sTop - sBot) > 0.5 || Math.abs(eTop - eBot) > 0.5;
    if (sloped) {
      dimH(PF(Math.max(0, sTop), 0).x, PF(Math.min(L, eTop), 0).x, PF(0, vmax).y + 7, `${Math.round(Math.min(L, eTop) - Math.max(0, sTop))} (צד עליון)`);
      dimH(PF(Math.max(0, sBot), 0).x, PF(Math.min(L, eBot), 0).x, PF(0, vmin).y - 7, `${Math.round(Math.min(L, eBot) - Math.max(0, sBot))} (צד תחתון)`);
      const aS = Math.max(0, (sTop + sBot) / 2), aE = Math.min(L, (eTop + eBot) / 2);
      dimH(PF(aS, 0).x, PF(aE, 0).x, PF(0, vmax).y + 14, `${Math.round(aE - aS)} (בציר)`);
      rows.push(`חיתוך בשיפוע: גובה החתך ${Math.round(hv)} — הפרש ${Math.round(Math.abs(eTop - eBot) + Math.abs(sTop - sBot))} מ"מ בין הצדדים; באמצע — אורך בציר`);
      if (m.kind === 'column') rows.push('גובה עמוד בציר = גובה פני עליון קורת הגג (TOS) בציר − עומק הקורה האנכי − שתי פלטות ראש העמוד');
    } else dimH(PF(0, 0).x, PF(L, 0).x, PF(0, vmax).y + 7, `${Math.round(L)}`);
    // חורים: שרשרת לאורך t מתחת למבט החזית, ומיקום רוחבי
    const webH = part.holes.filter((h) => h.face === 'web'), flH = part.holes.filter((h) => h.face === 'flange');
    if (webH.length) {
      const ts = chain([0, ...webH.map((h) => h.t), L]);
      for (let i = 1; i < ts.length; i++) dimH(PF(ts[i - 1], 0).x, PF(ts[i], 0).x, PF(0, vmin).y - (sloped ? 14 : 7), String(Math.round(ts[i] - ts[i - 1])));
      const vs = chain([vmin, ...webH.map((h) => h.c), vmax]);
      for (let i = 1; i < vs.length; i++) dimV(PF(L, 0).x + 7, PF(0, vs[i - 1]).y, PF(0, vs[i]).y, String(Math.round(vs[i] - vs[i - 1])));
    }
    if (flH.length) {
      const ts = chain([0, ...flH.map((h) => h.t), L]);
      for (let i = 1; i < ts.length; i++) dimH(PT(ts[i - 1], 0).x, PT(ts[i], 0).x, PT(0, umin).y - 7, String(Math.round(ts[i] - ts[i - 1])));
      const us = chain([umin, ...flH.map((h) => h.c), umax]);
      for (let i = 1; i < us.length; i++) dimV(PT(L, 0).x + 7, PT(0, us[i - 1]).y, PT(0, us[i]).y, String(Math.round(us[i] - us[i - 1])));
    }
    if (!flH.length && !webH.length) dimH(PT(0, 0).x, PT(L, 0).x, PT(0, umin).y - 7, `${Math.round(L)}`);
    // חתך
    const pr0 = getProfile(m.profile);
    const ssc = fitScale(Math.max(hu, 1), Math.max(hv, 1), 70, 55);
    const sxC = area.x1 - 58, syC = area.y1 - 45;
    const PC = (uu: number, vv: number): P => ({ x: sxC + (uu - (umin + umax) / 2) / ssc, y: syC + (vv - (vmin + vmax) / 2) / ssc });
    E.push({ k: 'poly', pts: ring0.map((q) => PC(q.u, q.v)), closed: true, layer: 'CUT', fill: true });
    for (const h of part.holes.filter((x) => x.face === 'section')) E.push({ k: 'circle', c: PC(h.c, h.c2 ?? 0), r: h.d / 2 / ssc, layer: 'HOLE' });
    text({ x: sxC, y: syC - hv / 2 / ssc - 6 }, `חתך ${pr0.name} 1:${ssc}`, 2.5, 'center');
  }
  rows.unshift(`סימון: ${part.mark}   כמות: ${qty}`, `תיאור: ${part.desc}`, `חתך: ${part.profile}   חומר: ${part.material}`,
    m.kind === 'plate' ? `משקל יח': ${part.weight.toFixed(2)} ק"ג   סה"כ: ${(part.weight * qty).toFixed(1)} ק"ג` : `אורך: ${Math.round(part.length)} מ"מ   משקל יח': ${part.weight.toFixed(2)} ק"ג   סה"כ: ${(part.weight * qty).toFixed(1)} ק"ג`);
  if (part.cutStart || part.cutEnd) rows.push(`חיתוך קצה: התחלה ${part.cutStart}° · סוף ${part.cutEnd}° (מהניצב)`);
  { const bh = part.holes.filter((h) => !h.boltId.startsWith('VENT')), vh = part.holes.filter((h) => h.boltId.startsWith('VENT'));
    rows.push(`חורים: ${holeNote(bh) || 'אין'}`);
    if (vh.length) rows.push(`חורי אוורור/ניקוז לגלוון: ${holeNote(vh)} — בפינות נגדיות`); }
  if (part.provisional) rows.push('⚠ סימון זמני — יש להריץ "מספור" לפני הפצה');
  let y = m.kind === 'plate' ? area.y1 - 10 : area.y1 - 110;
  for (const r of rows) { text({ x: area.x1 - 4, y }, r, 2.5, 'right'); y -= 4.4; }
  return scaleLabel;
}

export type { MarkedPart };

/** גיאומטריית פלטה במערכת הפנים שלה: x = המימד הארוך, y = המימד השני, עובי = הקצר. חורים מנקודות הברגים. */
export function plateGeom(part: MarkedPart, d: DerivedModel) {
  const m = d.byId.get(part.memberId)!;
  const f = localFrame(m);
  const s = cachedSolidPure(m);
  const pts = [...s.startRing, ...s.endRing];
  const axes = [f.ex, f.u, f.v];
  const ext = axes.map((a) => { const w = pts.map((q) => dot(q, a)); return Math.max(...w) - Math.min(...w); });
  const order = [0, 1, 2].sort((a, b) => ext[b] - ext[a]);
  const AX = axes[order[0]], AY = axes[order[1]], AZ = axes[order[2]];
  const o = pts.reduce((acc, q) => ({ x: Math.min(acc.x, dot(q, AX)), y: Math.min(acc.y, dot(q, AY)), z: Math.min(acc.z, dot(q, AZ)) }), { x: 1e18, y: 1e18, z: 1e18 });
  const P2 = (q: Vec3) => ({ x: dot(q, AX) - o.x, y: dot(q, AY) - o.y, z: dot(q, AZ) - o.z });
  const face: [{ x: number; y: number }, { x: number; y: number }][] = [], edge: typeof face = [];
  for (let i = 0; i < s.edges.length; i += 6) {
    const a = P2({ x: s.edges[i], y: s.edges[i + 1], z: s.edges[i + 2] }), b = P2({ x: s.edges[i + 3], y: s.edges[i + 4], z: s.edges[i + 5] });
    if (Math.hypot(a.x - b.x, a.y - b.y) > 0.05) face.push([{ x: a.x, y: a.y }, { x: b.x, y: b.y }]);
    if (Math.hypot(a.x - b.x, a.z - b.z) > 0.05) edge.push([{ x: a.x, y: a.z }, { x: b.x, y: b.z }]);
  }
  const bolts = new Map(d.connections.flatMap((c) => c.bolts).map((b) => [b.id, b]));
  const holes = part.holes.map((h) => { const b = bolts.get(h.boltId); if (!b) return null; const q = P2(b.p); return { x: q.x, y: q.y, d: h.d }; }).filter((h): h is { x: number; y: number; d: number } => !!h);
  // מוטות עיגון מרותכים לפלטה (פלטה מבוטנת) — מיקומי ריתוך, לא חורים
  const studs = d.members.filter((a) => a.kind === 'anchor' && a.connId && a.connId === m.connId).map((a) => { const q = P2(a.start); return { x: q.x, y: q.y, d: Number(a.profile.replace(/\D/g, '')) || 16 }; });
  const xs = face.flatMap(([a, b]) => [a.x, b.x]), ys = face.flatMap(([a, b]) => [a.y, b.y]);
  return { face, edge, holes, studs, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), T: ext[order[2]] };
}

/** מבט פני פלטה מוקטן לתוך מלבן נתון (לגיליון פרט חיבור): מתאר, חורים, מידות כוללות, שרשרת מרכזי חורים וקוטר. */
export function plateFaceInBox(sh: Sheet, part: MarkedPart, d: DerivedModel, box: { x0: number; x1: number; y0: number; y1: number }) {
  if (!d.byId.get(part.memberId)) return;
  const g = plateGeom(part, d);
  const Lp = g.x1 - g.x0, W = g.y1 - g.y0;
  const sc = fitScale(Lp, W, box.x1 - box.x0 - 18, box.y1 - box.y0 - 24);
  const E = sh.ents;
  const top = box.y1 - 14, cx = (box.x0 + box.x1) / 2 - 4;
  const P = (x: number, y: number): P => ({ x: cx + (x - (g.x0 + g.x1) / 2) / sc, y: top - (g.y1 - y) / sc });
  for (const [a, b] of g.face) E.push({ k: 'line', a: P(a.x, a.y), b: P(b.x, b.y), layer: 'OUTLINE' });
  for (const h of g.holes) E.push({ k: 'circle', c: P(h.x, h.y), r: Math.max(h.d / 2 / sc, 0.5), layer: 'HOLE' });
  const dimH = (xa: number, xb: number, y: number, lab: string) => {
    const a = P(xa, 0).x, b = P(xb, 0).x;
    if (Math.abs(b - a) < 0.01) return;
    E.push({ k: 'line', a: { x: a, y }, b: { x: b, y }, layer: 'DIM' });
    for (const x of [a, b]) E.push({ k: 'line', a: { x: x - 0.6, y: y - 0.8 }, b: { x: x + 0.6, y: y + 0.8 }, layer: 'DIM' });
    E.push({ k: 'text', p: { x: (a + b) / 2, y: y + 0.8 }, s: lab, h: 1.7, align: 'center', layer: 'DIM' });
  };
  const dimV = (ya: number, yb: number, x: number, lab: string) => {
    const a = P(0, ya).y, b = P(0, yb).y;
    if (Math.abs(b - a) < 0.01) return;
    E.push({ k: 'line', a: { x, y: a }, b: { x, y: b }, layer: 'DIM' });
    for (const y of [a, b]) E.push({ k: 'line', a: { x: x - 0.8, y: y - 0.6 }, b: { x: x + 0.8, y: y + 0.6 }, layer: 'DIM' });
    E.push({ k: 'text', p: { x: x - 0.9, y: (a + b) / 2 }, s: lab, h: 1.7, align: 'center', layer: 'DIM', rot: 90 });
  };
  const ch = (v: number[]) => [...new Set(v.map((x) => Math.round(x * 10) / 10))].sort((a, b) => a - b);
  const xs = ch([g.x0, ...g.holes.map((h) => h.x), g.x1]);
  for (let i = 1; i < xs.length; i++) dimH(xs[i - 1], xs[i], P(0, g.y1).y + 3.5, String(Math.round(xs[i] - xs[i - 1])));
  if (xs.length > 2) dimH(g.x0, g.x1, P(0, g.y1).y + 7.5, String(Math.round(Lp)));
  // שפה תחתונה קצרה מהעליונה (פלטה עם חיתוך בזווית) — מידה נוספת מתחת
  { const xb = g.face.flatMap(([a, b]) => [a, b]).filter((q) => Math.abs(q.y - g.y0) < 0.5).map((q) => q.x);
    if (xb.length && (Math.min(...xb) > g.x0 + 0.5 || Math.max(...xb) < g.x1 - 0.5)) dimH(Math.min(...xb), Math.max(...xb), P(0, g.y0).y - 3.5, String(Math.round(Math.max(...xb) - Math.min(...xb)))); }
  const ys = ch([g.y0, ...g.holes.map((h) => h.y), g.y1]);
  for (let i = 1; i < ys.length; i++) dimV(ys[i - 1], ys[i], P(g.x1, 0).x + 3.5, String(Math.round(ys[i] - ys[i - 1])));
  if (ys.length > 2) dimV(g.y0, g.y1, P(g.x1, 0).x + 7.5, String(Math.round(W)));
  const gd = new Map<number, number>(); for (const h of g.holes) gd.set(h.d, (gd.get(h.d) ?? 0) + 1);
  E.push({ k: 'text', p: { x: (box.x0 + box.x1) / 2, y: box.y1 - 2 }, s: `${part.mark} · PL${Math.round(g.T)}×${Math.round(W)}×${Math.round(Lp)}${gd.size ? ` · ${[...gd].map(([dd, q]) => `${q}×Ø${dd}`).join(', ')}` : ''} · 1:${sc}`, h: 1.9, align: 'center', layer: 'TEXT', bold: true });
}

/**
 * תא פלטה בגיליון פלטות משולב: מבט פנים בקנ"מ תקני הגדול ביותר שנכנס, שרשראות מידה לחורים,
 * כותרת עם סימון, כמות, עובי, חומר, משקל וקנ"מ. טקסט 2.5 מ"מ.
 */
export function plateCell(sh: Sheet, part: MarkedPart, qty: number, d: DerivedModel, box: { x0: number; x1: number; y0: number; y1: number }) {
  if (!d.byId.get(part.memberId)) return;
  const g = plateGeom(part, d);
  const Lp = g.x1 - g.x0, W = g.y1 - g.y0;
  const E = sh.ents;
  const head = 15, foot = 6;
  const sc = fitScale(Lp, W, box.x1 - box.x0 - 26, box.y1 - box.y0 - head - foot - 18);
  const cx = (box.x0 + box.x1) / 2 - 5, cy = box.y0 + foot + 9 + (box.y1 - head - (box.y0 + foot + 9)) / 2 - 4;
  const P = (x: number, y: number): P => ({ x: cx + (x - (g.x0 + g.x1) / 2) / sc, y: cy + (y - (g.y0 + g.y1) / 2) / sc });
  for (const [a, b] of g.face) E.push({ k: 'line', a: P(a.x, a.y), b: P(b.x, b.y), layer: 'OUTLINE' });
  for (const h of g.holes) {
    const c = P(h.x, h.y), r = Math.max(h.d / 2 / sc, 0.6);
    E.push({ k: 'circle', c, r, layer: 'HOLE' });
    E.push({ k: 'line', a: { x: c.x - r - 1, y: c.y }, b: { x: c.x + r + 1, y: c.y }, layer: 'AXIS' }, { k: 'line', a: { x: c.x, y: c.y - r - 1 }, b: { x: c.x, y: c.y + r + 1 }, layer: 'AXIS' });
  }
  const dimH = (xa: number, xb: number, y: number, lab: string) => {
    const a = P(xa, 0).x, b = P(xb, 0).x;
    if (Math.abs(b - a) < 0.01) return;
    E.push({ k: 'line', a: { x: a, y }, b: { x: b, y }, layer: 'DIM' });
    for (const x of [a, b]) E.push({ k: 'line', a: { x: x - 0.7, y: y - 1 }, b: { x: x + 0.7, y: y + 1 }, layer: 'DIM' });
    E.push({ k: 'text', p: { x: (a + b) / 2, y: y + (Math.abs(b - a) < 7 ? 2.6 : 0.9) }, s: lab, h: 2.5, align: 'center', layer: 'DIM' });
  };
  const dimV = (ya: number, yb: number, x: number, lab: string) => {
    const a = P(0, ya).y, b = P(0, yb).y;
    if (Math.abs(b - a) < 0.01) return;
    E.push({ k: 'line', a: { x, y: a }, b: { x, y: b }, layer: 'DIM' });
    for (const y of [a, b]) E.push({ k: 'line', a: { x: x - 1, y: y - 0.7 }, b: { x: x + 1, y: y + 0.7 }, layer: 'DIM' });
    E.push({ k: 'text', p: { x: x - 1, y: (a + b) / 2 }, s: lab, h: 2.5, align: 'center', layer: 'DIM', rot: 90 });
  };
  // מוטות עיגון מרותכים (מתחת לפלטה): עיגול מקווקו + צלב
  for (const st of g.studs) {
    const c = P(st.x, st.y), r = Math.max(st.d / 2 / sc, 0.6);
    E.push({ k: 'circle', c, r, layer: 'HIDDEN' });
    E.push({ k: 'line', a: { x: c.x - r, y: c.y - r }, b: { x: c.x + r, y: c.y + r }, layer: 'THIN' }, { k: 'line', a: { x: c.x - r, y: c.y + r }, b: { x: c.x + r, y: c.y - r }, layer: 'THIN' });
  }
  const pts = [...g.holes, ...g.studs];
  const ch = (v: number[]) => [...new Set(v.map((x) => Math.round(x * 10) / 10))].sort((a, b) => a - b);
  const xs = ch([g.x0, ...pts.map((h) => h.x), g.x1]);
  const yTop = P(0, g.y1).y;
  for (let i = 1; i < xs.length; i++) dimH(xs[i - 1], xs[i], yTop + 4, String(Math.round(xs[i] - xs[i - 1])));
  if (xs.length > 2) dimH(g.x0, g.x1, yTop + 9, String(Math.round(Lp)));
  else dimH(g.x0, g.x1, yTop + 4, String(Math.round(Lp)));
  { const xb = g.face.flatMap(([a, b]) => [a, b]).filter((q) => Math.abs(q.y - g.y0) < 0.5).map((q) => q.x);
    if (xb.length && Math.max(...xb) - Math.min(...xb) > 5 && (Math.min(...xb) > g.x0 + 0.5 || Math.max(...xb) < g.x1 - 0.5)) dimH(Math.min(...xb), Math.max(...xb), P(0, g.y0).y - 4, String(Math.round(Math.max(...xb) - Math.min(...xb)))); }
  const ys = ch([g.y0, ...pts.map((h) => h.y), g.y1]);
  const xR = P(g.x1, 0).x;
  for (let i = 1; i < ys.length; i++) dimV(ys[i - 1], ys[i], xR + 4, String(Math.round(ys[i] - ys[i - 1])));
  if (ys.length > 2) dimV(g.y0, g.y1, xR + 9, String(Math.round(W)));
  else dimV(g.y0, g.y1, xR + 4, String(Math.round(W)));
  // כותרת התא: בועת סימון + נתונים
  const bx = box.x1 - 7, by = box.y1 - 6;
  E.push({ k: 'circle', c: { x: bx, y: by }, r: 4.2, layer: 'MARK' });
  E.push({ k: 'text', p: { x: bx, y: by - 1.1 }, s: part.mark, h: part.mark.length > 3 ? 2.5 : 3, align: 'center', layer: 'MARK', bold: true });
  E.push({ k: 'text', p: { x: bx - 6, y: by + 0.4 }, s: `PL${Math.round(g.T)}×${Math.round(W)}×${Math.round(Lp)}   כמות ${qty}`, h: 2.8, align: 'right', layer: 'TEXT', bold: true });
  const gd = new Map<number, number>(); for (const h of g.holes) gd.set(h.d, (gd.get(h.d) ?? 0) + 1);
  E.push({ k: 'text', p: { x: bx - 6, y: by - 4.4 }, s: `${part.material} · ${part.weight.toFixed(2)} ק"ג/יח'${gd.size ? ` · חורים ${[...gd].map(([dd, q]) => `${q}×Ø${dd}`).join(', ')}` : ''}`, h: 2.5, align: 'right', layer: 'TEXT' });
  if (g.studs.length) E.push({ k: 'text', p: { x: (box.x0 + box.x1) / 2, y: box.y0 + 6.5 }, s: `${g.studs.length} מוטות עיגון Φ${g.studs[0].d} מרותכים מתחת לפלטה (⊠)`, h: 2.5, align: 'center', layer: 'TEXT' });
  E.push({ k: 'text', p: { x: (box.x0 + box.x1) / 2, y: box.y0 + 2 }, s: `${part.desc}  ·  1:${sc}`, h: 2.5, align: 'center', layer: 'TEXT' });
}
