/**
 * מודל שרטוט וקטורי, בלתי תלוי בפלט (SVG / PDF / DXF).
 * יחידות: מ"מ על הנייר, ראשית בפינה השמאלית התחתונה, y כלפי מעלה.
 * מידות נגזרות מקואורדינטות המודל (לא מפיקסלים): הטקסט של מידה הוא המרחק במודל.
 */
import { placeLabels } from './labels';
import { approxMeasure } from './layoutAudit';

export interface P { x: number; y: number }
export type Layer = 'FRAME' | 'TITLE' | 'OUTLINE' | 'THIN' | 'HIDDEN' | 'AXIS' | 'DIM' | 'TEXT' | 'HOLE' | 'MARK' | 'CUT';

export type Ent =
  | { k: 'line'; a: P; b: P; layer: Layer }
  | { k: 'poly'; pts: P[]; closed: boolean; layer: Layer; fill?: boolean; shade?: number }
  | { k: 'circle'; c: P; r: number; layer: Layer }
  | { k: 'text'; p: P; s: string; h: number; align: 'left' | 'center' | 'right'; layer: Layer; rot?: number; bold?: boolean };

export const SHEETS = { A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594], A0: [1189, 841] } as const;
export type SheetSize = keyof typeof SHEETS;

export interface TitleInfo {
  company: string; project: string; projectNo: string; client: string; title: string; number: string;
  rev: string; scale: string; date: string; status: string; drawnBy: string; checkedBy: string; approvedBy: string; note: string;
  /** יומן מהדורות (האחרונות), לטבלת המהדורות בגיליון */
  revisions?: { rev: string; date: string; note: string }[];
  /** שדות ISO 7200: חומר, גימור, דרגת ביצוע, משקל, גיליון X/Y */
  material?: string; finish?: string; exec?: string; weight?: string; sheetNo?: string;
}

export interface Sheet { size: SheetSize; w: number; h: number; ents: Ent[]; title: TitleInfo; scale: number; /** הדפסה בשחור-לבן (ברירת מחדל) */ mono?: boolean }

/** עט לכל שכבה: [r,g,b] 0..1, עובי מ"מ (ISO 128), מקף. מצב שחור-לבן: הבחנה בעובי וסוג קו בלבד. */
export function penOf(layer: Layer, mono: boolean): [[number, number, number], number, number[]?] {
  const K: [number, number, number] = [0, 0, 0];
  const T: Record<Layer, [[number, number, number], number, number[]?]> = {
    FRAME: [K, 0.7], TITLE: [K, 0.35], OUTLINE: [mono ? K : [0.07, 0.09, 0.13], 0.5], THIN: [mono ? K : [0.3, 0.36, 0.41], 0.25],
    HIDDEN: [mono ? K : [0.3, 0.36, 0.41], 0.25, [3, 1.5]], AXIS: [mono ? K : [0.64, 0.2, 0.2], 0.18, [8, 1.5, 1.5, 1.5]],
    DIM: [mono ? K : [0.12, 0.37, 0.66], 0.18], TEXT: [K, 0.25], HOLE: [mono ? K : [0.69, 0, 0.13], 0.35],
    MARK: [mono ? K : [0.54, 0.25, 0], 0.25], CUT: [mono ? K : [0.07, 0.09, 0.13], 0.5],
  };
  return T[layer];
}
/** מילוי לחתך ומבט מוצלל */
export function fillOf(mono: boolean): [number, number, number] { return mono ? [0.86, 0.86, 0.86] : [0.81, 0.84, 0.87]; }

export const STD_SCALES = [1, 2, 5, 10, 15, 20, 25, 50, 75, 100, 150, 200, 250, 500, 1000];

/** קנה מידה תקני מינימלי שבו תיבה (מ"מ במודל) נכנסת לאזור (מ"מ נייר). */
export function fitScale(wModel: number, hModel: number, wPaper: number, hPaper: number): number {
  const need = Math.max(wModel / wPaper, hModel / hPaper);
  return STD_SCALES.find((s) => s >= need) ?? Math.ceil(need / 100) * 100;
}

/** מבט: ממיר קואורדינטות דו־ממדיות של המודל (מ"מ) למיקום על הנייר בקנה מידה. */
export class View {
  /** rot90: סיבוב המבט ב-90° (x המודל ← למטה, y המודל ← ימינה) — כדי שמבנה ארוך ינצל את רוחב הגיליון */
  constructor(public sheet: Sheet, public scale: number, public origin: P, public modelOrigin: P = { x: 0, y: 0 }, public rot90 = false) {}
  p(x: number, y: number): P {
    const dx = (x - this.modelOrigin.x) / this.scale, dy = (y - this.modelOrigin.y) / this.scale;
    return this.rot90 ? { x: this.origin.x + dy, y: this.origin.y - dx } : { x: this.origin.x + dx, y: this.origin.y + dy };
  }
  /** כיוון מודל ← כיוון נייר */
  pd(d: P): P { return this.rot90 ? { x: d.y, y: -d.x } : d; }
  line(a: P, b: P, layer: Layer = 'OUTLINE') { this.sheet.ents.push({ k: 'line', a: this.p(a.x, a.y), b: this.p(b.x, b.y), layer }); }
  poly(pts: P[], closed: boolean, layer: Layer = 'OUTLINE', fill = false) { this.sheet.ents.push({ k: 'poly', pts: pts.map((q) => this.p(q.x, q.y)), closed, layer, fill }); }
  circle(c: P, rModel: number, layer: Layer = 'HOLE') { this.sheet.ents.push({ k: 'circle', c: this.p(c.x, c.y), r: rModel / this.scale, layer }); }
  /** טקסט בגובה נייר קבוע (מ"מ) */
  text(at: P, s: string, h = 2.5, align: 'left' | 'center' | 'right' = 'center', layer: Layer = 'TEXT', rot = 0, bold = false) {
    this.sheet.ents.push({ k: 'text', p: this.p(at.x, at.y), s, h, align, layer, rot, bold });
  }
  /**
   * מידה לינארית בין שתי נקודות מודל, בכיוון dir (וקטור יחידה במישור המבט), במרחק off מ"מ נייר.
   * הטקסט = המרחק במודל לאורך dir (מעוגל ל-1 מ"מ), או label אם ניתן.
   */
  dim(a: P, b: P, dirM: P, offPaper: number, label?: string, layer: Layer = 'DIM') {
    const val = Math.abs((b.x - a.x) * dirM.x + (b.y - a.y) * dirM.y);
    const dir = this.pd(dirM);
    const n = { x: -dir.y, y: dir.x };
    const pa = this.p(a.x, a.y), pb = this.p(b.x, b.y);
    // נקודות קו המידה: היטל על קו המקביל ל-dir
    const base = pa;
    const proj = (q: P) => ({ x: base.x + dir.x * ((q.x - base.x) * dir.x + (q.y - base.y) * dir.y), y: base.y + dir.y * ((q.x - base.x) * dir.x + (q.y - base.y) * dir.y) });
    const da = proj(pa), db = proj(pb);
    const sa = { x: da.x + n.x * offPaper, y: da.y + n.y * offPaper }, sb = { x: db.x + n.x * offPaper, y: db.y + n.y * offPaper };
    const ext = Math.sign(offPaper) * 1.5;
    this.sheet.ents.push({ k: 'line', a: pa, b: { x: sa.x + n.x * ext, y: sa.y + n.y * ext }, layer: 'THIN' });
    this.sheet.ents.push({ k: 'line', a: pb, b: { x: sb.x + n.x * ext, y: sb.y + n.y * ext }, layer: 'THIN' });
    this.sheet.ents.push({ k: 'line', a: sa, b: sb, layer });
    for (const q of [sa, sb]) {
      const t = 1.2;
      this.sheet.ents.push({ k: 'line', a: { x: q.x - (dir.x + n.x) * t, y: q.y - (dir.y + n.y) * t }, b: { x: q.x + (dir.x + n.x) * t, y: q.y + (dir.y + n.y) * t }, layer });
    }
    const mid = { x: (sa.x + sb.x) / 2 + n.x * 1.4, y: (sa.y + sb.y) / 2 + n.y * 1.4 };
    let rot = (Math.atan2(dir.y, dir.x) * 180) / Math.PI;
    if (rot > 90.1) rot -= 180; if (rot < -89.9) rot += 180;
    this.sheet.ents.push({ k: 'text', p: mid, s: label ?? String(Math.round(val)), h: 2.5, align: 'center', layer: 'DIM', rot });
    return val;
  }
  /** סימון מפלס (משולש על קו ההתייחסות + ערך במטרים), lenPaper = אורך קו ההובלה */
  level(at: P, valueMm: number, side: 1 | -1 = 1, lenPaper = 14) {
    const c = this.p(at.x, at.y);
    const e = { x: c.x + side * lenPaper, y: c.y };
    const v = valueMm / 1000;
    const s = Math.abs(v) < 0.0005 ? '±0.00' : `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`;
    this.sheet.ents.push({ k: 'line', a: c, b: e, layer: 'DIM' });
    const tx = c.x + side * (lenPaper - 3);
    this.sheet.ents.push({ k: 'poly', pts: [{ x: tx - 1.3, y: c.y + 2 }, { x: tx + 1.3, y: c.y + 2 }, { x: tx, y: c.y }], closed: true, layer: 'DIM', fill: true });
    this.sheet.ents.push({ k: 'text', p: { x: tx + side * 2, y: c.y + 0.8 }, s, h: 2.5, align: side > 0 ? 'left' : 'right', layer: 'DIM', bold: true });
  }
  /** בועת ציר */
  bubble(at: P, label: string) {
    const c = this.p(at.x, at.y);
    this.sheet.ents.push({ k: 'circle', c, r: 3.2, layer: 'AXIS' });
    this.sheet.ents.push({ k: 'text', p: { x: c.x, y: c.y - 1.1 }, s: label, h: 3, align: 'center', layer: 'AXIS', bold: true });
  }
}

export function newSheet(size: SheetSize, title: TitleInfo, scale: number): Sheet {
  const [w, h] = SHEETS[size];
  return { size, w, h, ents: [], title, scale };
}

/** אזור השרטוט הזמין (מעל/מימין לבלוק הכותרת), מ"מ נייר. */
export function drawArea(s: Sheet) {
  return { x0: 20, y0: 10 + (isCompact(s) ? TB_COMPACT_H + 3 : TB_H + 4), x1: s.w - 10, y1: s.h - 10 };
}
/** גיליון A4: פס כותרת מצומצם לכל הרוחב (בלי חתימות וטבלת מהדורות) */
export const isCompact = (s: Sheet) => s.size === 'A4';
export const TB_COMPACT_H = 16;
export const TB_W = 185, TB_H = 67;
/** גובה טבלת המהדורות (פינה ימנית תחתונה) — גיליונות עם טבלאות בפינה זו מתחילים מעליה */
export const revBandH = (t: TitleInfo) => 4.6 * (Math.min(5, Math.max(1, t.revisions?.length ?? 0)) + 1) + 2;

/** מסגרת וגוש כותרת בעברית בפינה השמאלית התחתונה. */
/** מסגרת וגוש כותרת — נקרא בסוף בניית הגיליון, כשקנה המידה ידוע. */
export function frameAndTitle(s: Sheet) {
  const L = (a: P, b: P, layer: Layer = 'FRAME') => s.ents.push({ k: 'line', a, b, layer });
  const T = (x: number, y: number, str: string, h: number, align: 'left' | 'center' | 'right' = 'right', bold = false) =>
    s.ents.push({ k: 'text', p: { x, y }, s: str, h, align, layer: 'TITLE', bold });
  const x0 = 20, y0 = 10, x1 = s.w - 10, y1 = s.h - 10;
  s.ents.push({ k: 'poly', pts: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], closed: true, layer: 'FRAME' });
  if (isCompact(s)) { compactTitle(s, x0, y0, x1); return; }
  const bx = x0, by = y0, bw = TB_W, bh = TB_H;
  s.ents.push({ k: 'poly', pts: [{ x: bx, y: by }, { x: bx + bw, y: by }, { x: bx + bw, y: by + bh }, { x: bx, y: by + bh }], closed: true, layer: 'FRAME' });
  const t = s.title;
  // שורות (מלמעלה): חברה · פרויקט · לקוח · כותרת · נתוני ייצור · מספר/מהדורה · חתימות
  const R = 9;
  for (let k = 1; k <= 6; k++) L({ x: bx, y: by + bh - k * R }, { x: bx + bw, y: by + bh - k * R }, k === 4 || k === 6 ? 'FRAME' : 'TITLE');
  const cx = bx + bw;
  const rowY = (k: number) => by + bh - k * R + 2.6; // קו בסיס טקסט בשורה k (1..)
  T(cx - 2, rowY(1), t.company, 4.2, 'right', true);
  T(bx + 2, rowY(1), 'KAYAN STEEL PRO', 2.6, 'left');
  // סמל שיטת ההיטל — זווית ראשונה (ISO 5456-2, שיטה E): חרוט קטום משמאל, מבט קצה מימין
  {
    const px = bx + 52, py = by + bh - R / 2;
    s.ents.push({ k: 'poly', pts: [{ x: px - 6, y: py - 1.4 }, { x: px - 1, y: py - 2.8 }, { x: px - 1, y: py + 2.8 }, { x: px - 6, y: py + 1.4 }], closed: true, layer: 'TITLE' });
    s.ents.push({ k: 'circle', c: { x: px + 4, y: py }, r: 2.8, layer: 'TITLE' }, { k: 'circle', c: { x: px + 4, y: py }, r: 1.4, layer: 'TITLE' });
    L({ x: px - 7, y: py }, { x: px + 7.6, y: py }, 'AXIS');
  }
  T(cx - 2, rowY(2), `פרויקט: ${t.project}`, 3, 'right', true);
  T(bx + 2, rowY(2), `מס' פרויקט: ${t.projectNo || '—'}`, 2.5, 'left');
  T(cx - 2, rowY(3), `לקוח: ${t.client || '—'}`, 2.6);
  T(bx + 2, rowY(3), `תאריך: ${t.date}`, 2.5, 'left');
  T(cx - 2, rowY(4) + 0.4, t.title, 3.6, 'right', true);
  const cellRow = (k: number, cells: [string, string][], wts: number[], big: number) => {
    const sum = wts.reduce((a, x) => a + x, 0);
    let x = cx;
    cells.forEach(([lab, v], i) => {
      const w = (bw * wts[i]) / sum;
      if (i) L({ x, y: by + bh - k * R }, { x, y: by + bh - (k - 1) * R }, 'TITLE');
      T(x - 1.2, by + bh - (k - 1) * R - 2.6, lab, 1.8);
      T(x - w / 2, by + bh - k * R + 1.6, v || '—', big, 'center', true);
      x -= w;
    });
  };
  cellRow(5, [['חומר', t.material ?? 'S235JR'], ['גימור', t.finish ?? 'גלוון חם ISO 1461'], ['דרגת ביצוע', t.exec ?? 'EXC2'], ['משקל', t.weight ?? ''], ['יחידות', 'מ"מ']], [16, 26, 13, 15, 10], 2.4);
  cellRow(6, [['מס\' שרטוט', t.number], ['מהדורה', t.rev], ['קנ"מ', t.scale], ['גיליון', t.sheetNo ?? ''], ['סטטוס', t.status]], [20, 10, 16, 12, 18], 2.8);
  // חתימות
  const sig = [['שרטט', t.drawnBy], ['בדק', t.checkedBy], ['אישר', t.approvedBy]];
  const sw = bw / 3;
  sig.forEach(([k, v], i) => {
    const x = cx - i * sw;
    if (i) L({ x, y: by }, { x, y: by + bh - 6 * R }, 'TITLE');
    T(x - 1.2, by + bh - 6 * R - 2.6, k, 1.8);
    T(x - sw / 2, by + 3, v || '—', 2.6, 'center');
  });
  // טבלת מהדורות: מימין לבלוק הכותרת, צמודה לתחתית המסגרת
  {
    const revs = (t.revisions?.length ? t.revisions : [{ rev: t.rev, date: t.date, note: 'הוצאה ראשונה' }]).slice(-5);
    const cw = [14, 22, 84], W = cw.reduce((a, x) => a + x, 0), rh = 4.6;
    const rx1 = x1, rx0 = rx1 - W;
    let y = y0 + rh * (revs.length + 1);
    const top = y;
    s.ents.push({ k: 'poly', pts: [{ x: rx0, y: y0 }, { x: rx1, y: y0 }, { x: rx1, y: top }, { x: rx0, y: top }], closed: true, layer: 'TITLE' });
    const row = (vals: string[], bold = false) => {
      let x = rx1;
      vals.forEach((v, i) => { s.ents.push({ k: 'text', p: { x: i === 2 ? x - 1.5 : x - cw[i] / 2, y: y - rh + 1.4 }, s: v, h: 2.3, align: i === 2 ? 'right' : 'center', layer: 'TITLE', bold }); x -= cw[i]; });
      y -= rh; if (y > y0 + 0.1) L({ x: rx0, y }, { x: rx1, y }, 'TITLE');
    };
    row(['מהדורה', 'תאריך', 'תיאור השינוי'], true);
    for (const r of [...revs].reverse()) row([r.rev, r.date, r.note.length > 48 ? r.note.slice(0, 47) + '…' : r.note]);
    let x = rx1; for (const w of cw.slice(0, -1)) { x -= w; L({ x, y: y0 }, { x, y: top }, 'TITLE'); }
  }
  // 1.68: הערת הסטטוס ליד אבן הכותרת — במקום הקרוב שלא עולה על מידות/סימונים של השרטוט
  if (t.note) placeLabels(s, [{ p: { x: bx + bw + 3 + approxMeasure(t.note, 2.2) / 2, y: by + bh - 4 }, s: t.note, h: 2.2, layer: 'TITLE' }], { x0: x0 + 1, x1: x1 - 1, y0: y0 + 1, y1: y1 - 1 }, approxMeasure, false);
}

// -------------- סדר תצוגה דו־כיווני (לפלט שאינו תומך RTL: PDF/DXF) --------------
const HEB = /[֐-׿]/;
const MIRROR: Record<string, string> = { '(': ')', ')': '(', '[': ']', ']': '[', '<': '>', '>': '<', '{': '}', '}': '{' };

/**
 * המרת מחרוזת לסדר חזותי משמאל לימין (אלגוריתם דו־כיווני מפושט): אם יש בה עברית — כיוון בסיס ימין לשמאל,
 * רצפי עברית ותווים ניטרליים הפוכים, רצפי ספרות/לטינית נשמרים בסדרם.
 */
/** פיצול לרצפים בסדר חזותי משמאל לימין; רצף עברי מוחזר בסדר לוגי (rtl=true). */
export function visualRuns(s: string): { t: string; rtl: boolean }[] {
  if (!HEB.test(s)) return [{ t: s, rtl: false }];
  const runs: { ltr: boolean; t: string }[] = [];
  const re = /[A-Za-z0-9ØΦ±][A-Za-z0-9.,:×x/\-+=%°'"_ ØΦ±*]*[A-Za-z0-9%°"'*]|[A-Za-z0-9]/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) runs.push({ ltr: false, t: s.slice(last, m.index) });
    runs.push({ ltr: true, t: m[0] });
    last = m.index + m[0].length;
  }
  if (last < s.length) runs.push({ ltr: false, t: s.slice(last) });
  return runs.reverse().map((r) => ({ t: r.t, rtl: !r.ltr }));
}

export function visualOrder(s: string): string {
  if (!HEB.test(s)) return s;
  // פיצול לרצפים: LTR (אותיות לטיניות/ספרות והסימנים ביניהן) מול שאר
  const runs: { ltr: boolean; t: string }[] = [];
  const re = /[A-Za-z0-9ØΦ±][A-Za-z0-9.,:×x/\-+=%°'"_ ØΦ±*]*[A-Za-z0-9%°"'*]|[A-Za-z0-9]/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) runs.push({ ltr: false, t: s.slice(last, m.index) });
    runs.push({ ltr: true, t: m[0] });
    last = m.index + m[0].length;
  }
  if (last < s.length) runs.push({ ltr: false, t: s.slice(last) });
  return runs.reverse().map((r) => (r.ltr ? r.t : [...r.t].reverse().map((c) => MIRROR[c] ?? c).join(''))).join('');
}

export const today = () => new Date().toISOString().slice(0, 10).split('-').reverse().join('.');

/** פס כותרת מצומצם (A4): שתי שורות לכל רוחב הגיליון — רק השדות החיוניים לייצור. */
function compactTitle(s: Sheet, x0: number, y0: number, x1: number) {
  const t = s.title, H = TB_COMPACT_H, R = H / 2;
  const L = (a: P, b: P, layer: Layer = 'TITLE') => s.ents.push({ k: 'line', a, b, layer });
  const T = (x: number, y: number, str: string, h: number, align: 'left' | 'center' | 'right' = 'center', bold = false) =>
    s.ents.push({ k: 'text', p: { x, y }, s: str, h, align, layer: 'TITLE', bold });
  s.ents.push({ k: 'poly', pts: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y0 + H }, { x: x0, y: y0 + H }], closed: true, layer: 'FRAME' });
  L({ x: x0, y: y0 + R }, { x: x1, y: y0 + R });
  const W = x1 - x0;
  const row = (yb: number, cells: [string, string, number, number?][]) => {
    const sum = cells.reduce((a, c) => a + c[2], 0);
    let x = x1;
    cells.forEach(([lab, v, w, big], i) => {
      const cw = (W * w) / sum;
      if (i) L({ x, y: yb }, { x, y: yb + R });
      if (lab) T(x - 0.8, yb + R - 1.9, lab, 1.5, 'right');
      if (lab || v) T(x - cw / 2, yb + 1.3, v || '—', big ?? 2.4, 'center', true);
      x -= cw;
    });
  };
  row(y0 + R, [['כותרת', t.title, 38, 2.8], ['פרויקט', t.project, 22], ['', t.company, 14, 2.6], ['מס\' שרטוט', t.number, 14, 3]]);
  row(y0, [['חומר', t.material ?? 'S235JR', 12], ['משקל', t.weight ?? '', 11], ['קנ"מ', t.scale, 9], ['מהדורה', t.rev, 7], ['תאריך', t.date, 11], ['גיליון', t.sheetNo ?? '', 8],
    ['סטטוס', t.status, 10], ['ביצוע', t.exec ?? 'EXC2', 7], ['', 'מ"מ', 6], ['', '', 10]]);
  // סמל זווית ראשונה בתא האחרון (שמאל)
  const px = x0 + 7, py = y0 + R / 2;
  s.ents.push({ k: 'poly', pts: [{ x: px - 4.5, y: py - 1 }, { x: px - 0.8, y: py - 2 }, { x: px - 0.8, y: py + 2 }, { x: px - 4.5, y: py + 1 }], closed: true, layer: 'TITLE' });
  s.ents.push({ k: 'circle', c: { x: px + 3, y: py }, r: 2, layer: 'TITLE' }, { k: 'circle', c: { x: px + 3, y: py }, r: 1, layer: 'TITLE' });
  T(x0 + 1, y0 + H + 1.2, 'KAYAN STEEL PRO', 1.6, 'left');
  if (t.note) T(x1, y0 + H + 1.2, t.note, 1.8, 'right');
}

/** תיבת טקסט משוערת על הנייר (מ"מ): רוחב לפי מספר התווים, גובה לפי h; תומך בסיבוב 0/±90 */
export function textBox(e: Extract<Ent, { k: 'text' }>): { x0: number; y0: number; x1: number; y1: number } {
  const w = [...e.s].reduce((t, ch) => t + (/[0-9.,\-+×]/.test(ch) ? 0.56 : ch === ' ' ? 0.32 : 0.74), 0) * e.h, a = e.align === 'center' ? -w / 2 : e.align === 'right' ? -w : 0;
  const r = Math.round(((e.rot ?? 0) % 360 + 360) % 360);
  if (r === 90) return { x0: e.p.x - e.h * 0.85, x1: e.p.x + e.h * 0.1, y0: e.p.y + a, y1: e.p.y + a + w };
  if (r === 270) return { x0: e.p.x - e.h * 0.1, x1: e.p.x + e.h * 0.85, y0: e.p.y - a - w, y1: e.p.y - a };
  return { x0: e.p.x + a, x1: e.p.x + a + w, y0: e.p.y - e.h * 0.1, y1: e.p.y + e.h * 0.85 };
}

/**
 * ניקוי מידות חופפות: טקסט מידה (שכבת DIM) שחופף טקסט אחר מוזז בניצב לקו הבסיס שלו למקום הפנוי הקרוב
 * (לסירוגין מעל/מתחת, עד שלוש קומות). טקסטים אחרים (כותרות, סימונים) אינם זזים. מחזיר את מספר ההזזות.
 */
export function declutterDims(sh: Sheet): number {
  const texts = sh.ents.filter((e): e is Extract<Ent, { k: 'text' }> => e.k === 'text' && !!e.s.trim());
  const placed = texts.filter((e) => e.layer !== 'DIM').map(textBox);
  const hit = (b: ReturnType<typeof textBox>) => placed.some((q) => b.x0 < q.x1 + 0.3 && b.x1 > q.x0 - 0.3 && b.y0 < q.y1 + 0.3 && b.y1 > q.y0 - 0.3);
  let moved = 0;
  for (const e of texts.filter((t) => t.layer === 'DIM')) {
    let b = textBox(e);
    if (hit(b)) {
      const r = Math.round(((e.rot ?? 0) % 360 + 360) % 360), vert = r === 90 || r === 270;
      const step = e.h * 1.05;
      // אופקי: מעלה צעד אחד, או מטה אל מתחת לקו המידה (הטקסט יושב ~1 מ"מ מעל הקו)
      for (const k of [1, -1.7, 2, -2.7, 3, -3.7]) {
        const p = vert ? { x: e.p.x - Math.sign(k) * Math.ceil(Math.abs(k)) * step, y: e.p.y } : { x: e.p.x, y: e.p.y + k * step };
        const nb = textBox({ ...e, p });
        if (!hit(nb)) { e.p = p; b = nb; moved++; break; }
      }
    }
    placed.push(b);
  }
  return moved;
}
