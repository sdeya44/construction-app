/**
 * מודל שרטוט וקטורי, בלתי תלוי בפלט (SVG / PDF / DXF).
 * יחידות: מ"מ על הנייר, ראשית בפינה השמאלית התחתונה, y כלפי מעלה.
 * מידות נגזרות מקואורדינטות המודל (לא מפיקסלים): הטקסט של מידה הוא המרחק במודל.
 */
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
}

export interface Sheet { size: SheetSize; w: number; h: number; ents: Ent[]; title: TitleInfo; scale: number }

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
    this.sheet.ents.push({ k: 'text', p: mid, s: label ?? String(Math.round(val)), h: 2.2, align: 'center', layer: 'DIM', rot });
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
    this.sheet.ents.push({ k: 'text', p: { x: tx + side * 2, y: c.y + 0.8 }, s, h: 2.4, align: side > 0 ? 'left' : 'right', layer: 'DIM', bold: true });
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
  return { x0: 20, y0: 10 + TB_H + 4, x1: s.w - 10, y1: s.h - 10 };
}
export const TB_W = 185, TB_H = 58;
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
  const bx = x0, by = y0, bw = TB_W, bh = TB_H;
  s.ents.push({ k: 'poly', pts: [{ x: bx, y: by }, { x: bx + bw, y: by }, { x: bx + bw, y: by + bh }, { x: bx, y: by + bh }], closed: true, layer: 'FRAME' });
  const t = s.title;
  // שורות: מלמעלה למטה
  const rows = [bh - 9, bh - 18, bh - 27, bh - 36, bh - 45];
  for (const r of rows) L({ x: bx, y: by + r }, { x: bx + bw, y: by + r });
  const cx = bx + bw;
  T(cx - 2, by + bh - 6.5, t.company, 4.2, 'right', true);
  T(bx + 2, by + bh - 6.5, 'KAYAN STEEL PRO', 2.6, 'left');
  T(cx - 2, by + bh - 15.5, `פרויקט: ${t.project}`, 3, 'right', true);
  T(bx + 2, by + bh - 15.5, `מס' פרויקט: ${t.projectNo || '—'}`, 2.5, 'left');
  T(cx - 2, by + bh - 24.5, `לקוח: ${t.client || '—'}`, 2.6);
  T(bx + 2, by + bh - 24.5, `תאריך: ${t.date}`, 2.5, 'left');
  T(cx - 2, by + bh - 33.5, t.title, 3.6, 'right', true);
  // שורת מספר/מהדורה/קנ"מ/סטטוס
  const cells = [['מס\' שרטוט', t.number], ['מהדורה', t.rev], ['קנ"מ', t.scale], ['סטטוס', t.status]];
  const cw = bw / cells.length;
  cells.forEach(([k, v], i) => {
    const x = cx - i * cw;
    if (i) L({ x, y: by + bh - 45 }, { x, y: by + bh - 36 });
    T(x - 1.5, by + bh - 39.3, k, 1.9);
    T(x - cw / 2, by + bh - 43.6, v, 2.8, 'center', true);
  });
  // חתימות
  const sig = [['שרטט', t.drawnBy], ['בדק', t.checkedBy], ['אישר', t.approvedBy]];
  const sw = bw / 3;
  sig.forEach(([k, v], i) => {
    const x = cx - i * sw;
    if (i) L({ x, y: by }, { x, y: by + bh - 45 });
    T(x - 1.5, by + bh - 48.3, k, 1.9);
    T(x - sw / 2, by + 4, v || '—', 2.6, 'center');
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
      vals.forEach((v, i) => { s.ents.push({ k: 'text', p: { x: i === 2 ? x - 1.5 : x - cw[i] / 2, y: y - rh + 1.4 }, s: v, h: 2.1, align: i === 2 ? 'right' : 'center', layer: 'TITLE', bold }); x -= cw[i]; });
      y -= rh; if (y > y0 + 0.1) L({ x: rx0, y }, { x: rx1, y }, 'TITLE');
    };
    row(['מהדורה', 'תאריך', 'תיאור השינוי'], true);
    for (const r of [...revs].reverse()) row([r.rev, r.date, r.note.length > 48 ? r.note.slice(0, 47) + '…' : r.note]);
    let x = rx1; for (const w of cw.slice(0, -1)) { x -= w; L({ x, y: y0 }, { x, y: top }, 'TITLE'); }
  }
  if (t.note) s.ents.push({ k: 'text', p: { x: bx + bw + 3, y: by + bh - 4 }, s: t.note, h: 2.2, align: 'left', layer: 'TITLE' });
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
