/**
 * ביקורת קריאות גיליון (1.68) — על מודל הגיליון (לפני SVG/PDF), במ"מ נייר:
 *  1. טקסט על טקסט (חפיפת תיבות > 0.3 מ"מ בשני הכיוונים);
 *  2. טקסט מחוץ למסגרת הגיליון;
 *  3. ערך מידה שחוצה קו גיאומטריה (קו מתאר / חור / חתך).
 * רוחב הטקסט נמדד בפונקציה חיצונית (בבדיקות — מדדי הגופן האמיתי של PDF/SVG דרך fontkit); ברירת מחדל — הערכה.
 * רעיון: layout-audit מחבילת 1.70 (שם — בדפדפן על SVG); כאן על המודל, כך שרץ בבדיקות בלי דפדפן.
 */
import type { Ent, P, Sheet } from './sheet';

export type Measure = (s: string, h: number, bold?: boolean) => number;
/** הערכת רוחב (KSPSans): עברית ~0.62h, ספרות/לטינית ~0.58h, רווח ונקודה ~0.3h; מודגש +6% */
export const approxMeasure: Measure = (s, h, bold) => [...s].reduce((a, c) => a + (/[\s.,:;'|()\-]/.test(c) ? 0.32 : /[\u0590-\u05ff]/.test(c) ? 0.62 : 0.6), 0) * h * (bold ? 1.06 : 1);

export interface Box { x: number; y: number; r: number; t: number }
export interface TextBox extends Box { s: string; layer: string; i: number }
export interface AuditIssue { kind: 'text-overlap' | 'text-outside' | 'dim-over-line'; a: string; b?: string; at: P; depth: number }

type TextEnt = Extract<Ent, { k: 'text' }>;
export function textBox(e: TextEnt, measure: Measure, i = 0): TextBox {
  const w = measure(e.s, e.h, e.bold);
  const x0 = e.align === 'left' ? 0 : e.align === 'right' ? -w : -w / 2;
  // מעל קו הבסיס ~0.78h (אותיות עבריות וספרות), מתחת ~0.18h
  const corners: P[] = [[x0, -0.18 * e.h], [x0 + w, -0.18 * e.h], [x0 + w, 0.78 * e.h], [x0, 0.78 * e.h]].map(([u, v]) => {
    const a = ((e.rot ?? 0) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    return { x: e.p.x + u! * c - v! * s, y: e.p.y + u! * s + v! * c };
  });
  return { x: Math.min(...corners.map((q) => q.x)), r: Math.max(...corners.map((q) => q.x)), y: Math.min(...corners.map((q) => q.y)), t: Math.max(...corners.map((q) => q.y)), s: e.s, layer: e.layer, i };
}

const ov = (a: Box, b: Box) => Math.min(Math.min(a.r, b.r) - Math.max(a.x, b.x), Math.min(a.t, b.t) - Math.max(a.y, b.y));

/** קטע חוצה תיבה (Liang–Barsky), בשוליים פנימיים של 0.25 מ"מ */
function segHitsBox(a: P, b: P, r: Box): boolean {
  let lo = 0, hi = 1;
  const d = [b.x - a.x, b.y - a.y], p0 = [a.x, a.y], mn = [r.x + 0.25, r.y + 0.25], mx = [r.r - 0.25, r.t - 0.25];
  for (let i = 0; i < 2; i++) {
    if (mx[i]! <= mn[i]!) return false;
    if (Math.abs(d[i]!) < 1e-10) { if (p0[i]! < mn[i]! || p0[i]! > mx[i]!) return false; continue; }
    const t1 = (mn[i]! - p0[i]!) / d[i]!, t2 = (mx[i]! - p0[i]!) / d[i]!;
    lo = Math.max(lo, Math.min(t1, t2)); hi = Math.min(hi, Math.max(t1, t2));
    if (lo > hi) return false;
  }
  return hi - lo > 1e-7;
}

export function auditSheet(sh: Sheet, measure: Measure = approxMeasure): AuditIssue[] {
  const out: AuditIssue[] = [];
  const texts = sh.ents.map((e, i) => (e.k === 'text' && e.s.trim() ? textBox(e, measure, i) : null)).filter((x): x is TextBox => !!x);
  // 1. טקסט על טקסט
  for (let i = 0; i < texts.length; i++) for (let j = 0; j < i; j++) {
    const d = ov(texts[i]!, texts[j]!);
    if (d > 0.3) out.push({ kind: 'text-overlap', a: texts[j]!.s, b: texts[i]!.s, at: { x: texts[i]!.x, y: texts[i]!.y }, depth: d });
  }
  // 2. מחוץ לגיליון (שוליים 3 מ"מ)
  for (const t of texts) {
    const d = Math.max(3 - t.x, t.r - (sh.w - 3), 3 - t.y, t.t - (sh.h - 3));
    if (d > 0) out.push({ kind: 'text-outside', a: t.s, at: { x: t.x, y: t.y }, depth: d });
  }
  // 3. ערך מידה על קו גיאומטריה
  const segs: [P, P][] = [];
  for (const e of sh.ents) {
    if (e.k === 'line' && (e.layer === 'OUTLINE' || e.layer === 'HOLE' || e.layer === 'CUT')) segs.push([e.a, e.b]);
    else if (e.k === 'poly' && e.shade === undefined && (e.layer === 'OUTLINE' || e.layer === 'HOLE' || e.layer === 'CUT')) {
      const ps = e.closed ? [...e.pts, e.pts[0]!] : e.pts;
      for (let i = 1; i < ps.length; i++) segs.push([ps[i - 1]!, ps[i]!]);
    } else if (e.k === 'circle' && e.layer === 'HOLE') {
      const n = 16;
      for (let i = 0; i < n; i++) { const a = (2 * Math.PI * i) / n, b = (2 * Math.PI * (i + 1)) / n; segs.push([{ x: e.c.x + e.r * Math.cos(a), y: e.c.y + e.r * Math.sin(a) }, { x: e.c.x + e.r * Math.cos(b), y: e.c.y + e.r * Math.sin(b) }]); }
    }
  }
  for (const t of texts.filter((x) => x.layer === 'DIM')) {
    const hit = segs.find(([a, b]) => Math.max(a.x, b.x) >= t.x && Math.min(a.x, b.x) <= t.r && Math.max(a.y, b.y) >= t.y && Math.min(a.y, b.y) <= t.t && segHitsBox(a, b, t));
    if (hit) out.push({ kind: 'dim-over-line', a: t.s, at: { x: t.x, y: t.y }, depth: 1 });
  }
  return out;
}

/** תיבה פנויה: לא חופפת טקסט קיים (מרווח gap) ולא חוצה קו גיאומטריה (מתאר / חור / חתך) */
export function boxIsFree(ents: Ent[], b: Box, gap = 0.6, measure: Measure = approxMeasure): boolean {
  for (const e of ents) {
    if (e.k === 'text') { const t = textBox(e, measure); if (t.x < b.r + gap && t.r + gap > b.x && t.y < b.t + gap && t.t + gap > b.y) return false; }
    else if (e.k === 'line' && (e.layer === 'OUTLINE' || e.layer === 'HOLE' || e.layer === 'CUT')) { if (segHitsBox(e.a, e.b, b)) return false; }
    else if (e.k === 'circle' && e.layer === 'HOLE') { const cx = Math.max(b.x, Math.min(e.c.x, b.r)), cy = Math.max(b.y, Math.min(e.c.y, b.t)); if (Math.hypot(cx - e.c.x, cy - e.c.y) < e.r + 0.2) return false; }
    else if (e.k === 'poly' && e.shade === undefined && (e.layer === 'OUTLINE' || e.layer === 'HOLE' || e.layer === 'CUT')) {
      const ps = e.closed ? [...e.pts, e.pts[0]!] : e.pts;
      for (let i = 1; i < ps.length; i++) if (segHitsBox(ps[i - 1]!, ps[i]!, b)) return false;
    }
  }
  return true;
}
