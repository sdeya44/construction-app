/**
 * ניסטינג ללייזר — פלטות בלבד (שלב 1.100). אלגוריתם עצמאי (בלי ספרייה חיצונית):
 *  1. קונטור אמיתי לכל סימון פלטה (`Member.contour` לפלטה בצורה/קיטומים, אחרת מלבן המוצק) + חורים.
 *  2. אריזה על רסטר (מטריצת תאים) בשיטת "ראשון שנכנס": חלקים בסדר שטח יורד, מיקום שמאלי-תחתון,
 *     סיבוב 0/90/180/270 (אופציונלי). הרסטר שמרני: תא נחשב תפוס אם הקונטור נוגע בו — חלקים אינם נחתכים זה בזה;
 *     המחיר הוא פחות הדוק עד גודל תא אחד (ברירת מחדל 5 מ"מ).
 *  3. DXF לכל לוח + טבלאות דוח (לוחות, ניצולת, פסולת, חלקים).
 * הגבלות (מוצהרות גם בדוח): אינו מאומת מול מכונה; חורים נחתכים אך אינם משמשים לאריזה פנימית;
 * קצה פלטה חתוך בזווית (cutStart/cutEnd) מטופל כמלבן תוחם; אין חיתוך משותף, כניסות לקו או סדר חיתוך.
 */
import { zipSync, strToU8 } from 'fflate';
import { dot, sub } from '../core/vec';
import { localFrame } from '../geometry/frame';
import { cachedSolidPure } from '../drawing/solidCache';
import { sheetToDxf } from '../drawing/dxf';
import type { Ent, Sheet } from '../drawing/sheet';
import { getProfile } from '../profiles/library';
import { getMaterial } from '../profiles/materials';
import type { DerivedModel } from '../model/types';
import type { Table } from './export';
import type { Fabrication } from './marks';

export interface Pt { x: number; y: number }
export interface NestHole { x: number; y: number; d: number }
export interface NestPart { mark: string; desc: string; qty: number; material: string; t: number; poly: Pt[]; holes: NestHole[]; area: number }
export interface NestOptions {
  /** גודל לוח (מ"מ) */ sheetW: number; sheetH: number;
  /** מרווח בין חלקים (קרף) */ kerf: number;
  /** שוליים בלוח */ margin: number;
  /** סיבוב ב-90° מותר */ rotate: boolean;
  /** גודל תא הרסטר (מ"מ) — קטן ⇒ הדוק יותר, איטי יותר */ cell: number;
}
export const DEFAULT_NEST: NestOptions = { sheetW: 3000, sheetH: 1500, kerf: 0, margin: 10, rotate: true, cell: 5 };

export interface NestItem { mark: string; copy: number; x: number; y: number; rot: 0 | 90 | 180 | 270; poly: Pt[]; holes: NestHole[]; area: number }
export interface NestSheet { id: number; material: string; t: number; w: number; h: number; items: NestItem[]; usedArea: number; util: number }
export interface NestResult { sheets: NestSheet[]; unplaced: { mark: string; qty: number; reason: string }[]; opts: NestOptions }

const area = (poly: Pt[]) => { let a = 0; for (let i = 0; i < poly.length; i++) { const p = poly[i]!, q = poly[(i + 1) % poly.length]!; a += p.x * q.y - q.x * p.y; } return Math.abs(a) / 2; };

/** קונטורים + חורים לכל סימון פלטה (קבוצה לפי סימון; כמות = מספר החלקים בסימון) */
export function nestParts(d: DerivedModel, fab: Fabrication): NestPart[] {
  const byMark = new Map<string, typeof fab.parts>();
  for (const p of fab.parts) byMark.set(p.mark, [...(byMark.get(p.mark) ?? []), p]);
  const bolts = new Map<string, { p: { x: number; y: number; z: number } }>([...d.connections.flatMap((c) => c.bolts), ...d.connections.flatMap((c) => c.holes ?? [])].map((b) => [b.id, b] as const));
  const out: NestPart[] = [];
  for (const [mark, ps] of byMark) {
    const part = ps[0]!;
    if (part.kind !== 'plate') continue;
    const prof = getProfile(part.profile);
    if (prof.family !== 'PL') continue;
    const m = d.byId.get(part.memberId);
    if (!m) continue;
    const f = localFrame(m);
    const loc = (q: { x: number; y: number; z: number }): Pt => { const r = sub(q, m.start); return { x: dot(r, f.ex), y: dot(r, f.u) }; };
    let poly: Pt[];
    if (m.contour && m.contour.length >= 3) poly = m.contour.map((c) => ({ x: c.s, y: c.u }));
    else {
      const s = cachedSolidPure(m);
      const pts = [...s.startRing, ...s.endRing].map(loc);
      const x0 = Math.min(...pts.map((q) => q.x)), x1 = Math.max(...pts.map((q) => q.x)), y0 = Math.min(...pts.map((q) => q.y)), y1 = Math.max(...pts.map((q) => q.y));
      poly = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
    }
    const hs: NestHole[] = [];
    for (const h of part.holes) {
      if (h.face === 'section') continue;
      const b = bolts.get(h.boltId); if (!b) continue;
      const q = loc(b.p); hs.push({ x: q.x, y: q.y, d: h.d });
    }
    const mnx = Math.min(...poly.map((q) => q.x)), mny = Math.min(...poly.map((q) => q.y));
    out.push({
      mark, desc: part.desc, qty: ps.length, material: part.material, t: prof.dims.t ?? 0,
      poly: poly.map((q) => ({ x: q.x - mnx, y: q.y - mny })), holes: hs.map((h) => ({ x: h.x - mnx, y: h.y - mny, d: h.d })), area: area(poly),
    });
  }
  return out.sort((a, b) => a.mark.localeCompare(b.mark, 'en', { numeric: true }));
}

const rotPt = (p: Pt, rot: number): Pt => (rot === 0 ? p : rot === 90 ? { x: -p.y, y: p.x } : rot === 180 ? { x: -p.x, y: -p.y } : { x: p.y, y: -p.x });
/** סיבוב + נרמול לפינה (0,0) */
function rotated(part: NestPart, rot: 0 | 90 | 180 | 270): { poly: Pt[]; holes: NestHole[]; w: number; h: number } {
  const poly = part.poly.map((q) => rotPt(q, rot));
  const holes = part.holes.map((q) => ({ ...rotPt(q, rot), d: q.d }));
  const mnx = Math.min(...poly.map((q) => q.x)), mny = Math.min(...poly.map((q) => q.y));
  return { poly: poly.map((q) => ({ x: q.x - mnx, y: q.y - mny })), holes: holes.map((q) => ({ x: q.x - mnx, y: q.y - mny, d: q.d })), w: Math.max(...poly.map((q) => q.x)) - mnx, h: Math.max(...poly.map((q) => q.y)) - mny };
}

interface Mask { w: number; h: number; r: number; shifted: Uint32Array[][]; nw: number; cells: number }
/** מסכת רסטר שמרנית של קונטור, מורחבת ב-r תאים (חצי הקרף) לכל כיוון */
function buildMask(poly: Pt[], c: number, r: number): Mask {
  const mx = Math.max(...poly.map((q) => q.x)), my = Math.max(...poly.map((q) => q.y));
  const w = Math.ceil(mx / c) + 1 + 2 * r, h = Math.ceil(my / c) + 1 + 2 * r;
  const g = new Uint8Array(w * h);
  // ε: נקודה על גבול תא (קצה עליון/ימני של מלבן) שייכת לתא הקודם — חלקים צמודים בקרף 0 לא נחסמים
  const mark = (x: number, y: number) => { const i = Math.floor(x / c - 1e-7) + r, j = Math.floor(y / c - 1e-7) + r; if (i >= 0 && i < w && j >= 0 && j < h) g[j * w + i] = 1; };
  // שפה: צעדים של c/8 לאורך כל צלע
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (c / 8)));
    for (let k = 0; k <= n; k++) mark(a.x + ((b.x - a.x) * k) / n, a.y + ((b.y - a.y) * k) / n);
  }
  // פנים: קו אמצע של כל שורת תאים (זוגיות חיתוכים)
  for (let j = 0; j < h; j++) {
    const y = (j - r + 0.5) * c, xs: number[] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
      if ((a.y <= y) !== (b.y <= y)) xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) { const i0 = Math.max(0, Math.floor(xs[k]! / c - 1e-7) + r), i1 = Math.min(w - 1, Math.floor(xs[k + 1]! / c - 1e-7) + r); for (let i = i0; i <= i1; i++) g[j * w + i] = 1; }
  }
  // הרחבה ב-r תאים (ריבוע) — הפרדה בין חלקים
  let G = g;
  if (r > 0) {
    const t1 = new Uint8Array(w * h), t2 = new Uint8Array(w * h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (G[j * w + i]) for (let di = -r; di <= r; di++) { const ii = i + di; if (ii >= 0 && ii < w) t1[j * w + ii] = 1; }
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (t1[j * w + i]) for (let dj = -r; dj <= r; dj++) { const jj = j + dj; if (jj >= 0 && jj < h) t2[jj * w + i] = 1; }
    G = t2;
  }
  const nw = Math.ceil(w / 32);
  const base: Uint32Array[] = [];
  let cells = 0;
  for (let j = 0; j < h; j++) { const row = new Uint32Array(nw); for (let i = 0; i < w; i++) if (G[j * w + i]) { row[i >> 5]! |= 1 << (i & 31); cells++; } base.push(row); }
  const shifted: Uint32Array[][] = [];
  for (let s = 0; s < 32; s++) {
    shifted.push(base.map((row) => { const o = new Uint32Array(nw + 1); for (let k = 0; k < nw; k++) { const v = row[k]!; o[k]! |= (v << s) >>> 0; if (s) o[k + 1]! |= v >>> (32 - s); } return o; }));
  }
  return { w, h, r, shifted, nw, cells };
}

interface Occ { rows: Uint32Array[]; W: number; H: number; free: number }
const newOcc = (W: number, H: number): Occ => ({ rows: Array.from({ length: H }, () => new Uint32Array(Math.ceil(W / 32) + 2)), W, H, free: W * H });
function fits(o: Occ, m: Mask, gx: number, gy: number): boolean {
  const q = gx >> 5, sh = m.shifted[gx & 31]!;
  for (let j = 0; j < m.h; j++) { const row = o.rows[gy + j]!, s = sh[j]!; for (let k = 0; k <= m.nw; k++) if ((s[k]! & row[q + k]!) !== 0) return false; }
  return true;
}
function put(o: Occ, m: Mask, gx: number, gy: number) {
  const q = gx >> 5, sh = m.shifted[gx & 31]!;
  for (let j = 0; j < m.h; j++) { const row = o.rows[gy + j]!, s = sh[j]!; for (let k = 0; k <= m.nw; k++) row[q + k]! |= s[k]!; }
  o.free -= m.cells;
}

/** ניסטינג: קבוצה לכל (חומר, עובי); בכל קבוצה חלקים בשטח יורד, ראשון שנכנס */
export function nestPlates(parts: NestPart[], o: NestOptions): NestResult {
  const c = Math.max(1, o.cell), r = Math.ceil(o.kerf / 2 / c);
  const W = Math.ceil(o.sheetW / c) + 2 * r + 4, H = Math.ceil(o.sheetH / c) + 2 * r + 4;
  const gMin = Math.max(0, Math.ceil(o.margin / c) - r);
  const groups = new Map<string, NestPart[]>();
  for (const p of parts) { const k = `${p.material}|${p.t}`; groups.set(k, [...(groups.get(k) ?? []), p]); }
  const sheets: NestSheet[] = [], unplaced: NestResult['unplaced'] = [];
  const rots: (0 | 90 | 180 | 270)[] = o.rotate ? [0, 90, 180, 270] : [0];
  for (const [, gp] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) {
    const open: { sheet: NestSheet; occ: Occ }[] = [];
    const list = gp.flatMap((p) => Array.from({ length: p.qty }, (_, i) => ({ p, copy: i + 1 }))).sort((a, b) => b.p.area - a.p.area || a.p.mark.localeCompare(b.p.mark, 'en', { numeric: true }) || a.copy - b.copy);
    const cache = new Map<string, { rot: 0 | 90 | 180 | 270; rp: ReturnType<typeof rotated>; mask: Mask }[]>();
    const variants = (p: NestPart) => {
      let v = cache.get(p.mark);
      if (!v) { v = rots.map((rot) => { const rp = rotated(p, rot); return { rot, rp, mask: buildMask(rp.poly, c, r) }; }); cache.set(p.mark, v); }
      return v;
    };
    const failed = new Set<string>();
    for (const { p, copy } of list) {
      if (failed.has(p.mark)) { const u = unplaced.find((x) => x.mark === p.mark); if (u) u.qty++; continue; }
      const vs = variants(p);
      const usable = vs.filter((v) => v.rp.w <= o.sheetW - 2 * o.margin && v.rp.h <= o.sheetH - 2 * o.margin);
      let placed = false;
      const tryOn = (s: { sheet: NestSheet; occ: Occ }): boolean => {
        for (const v of usable) {
          if (v.mask.cells > s.occ.free) continue;
          const gyMax = Math.min(s.occ.H - v.mask.h, Math.floor((o.sheetH - o.margin - v.rp.h) / c) - v.mask.r);
          const gxMax = Math.min(s.occ.W - v.mask.w, Math.floor((o.sheetW - o.margin - v.rp.w) / c) - v.mask.r);
          for (let gy = gMin; gy <= gyMax; gy++) {
            for (let gx = gMin; gx <= gxMax; gx++) {
              if (!fits(s.occ, v.mask, gx, gy)) continue;
              put(s.occ, v.mask, gx, gy);
              const ox = (gx + v.mask.r) * c, oy = (gy + v.mask.r) * c;
              s.sheet.items.push({ mark: p.mark, copy, x: ox, y: oy, rot: v.rot, poly: v.rp.poly.map((q) => ({ x: q.x + ox, y: q.y + oy })), holes: v.rp.holes.map((q) => ({ x: q.x + ox, y: q.y + oy, d: q.d })), area: p.area });
              s.sheet.usedArea += p.area;
              return true;
            }
          }
        }
        return false;
      };
      for (const s of open) { if (tryOn(s)) { placed = true; break; } }
      if (!placed && usable.length) {
        const s = { sheet: { id: 0, material: p.material, t: p.t, w: o.sheetW, h: o.sheetH, items: [], usedArea: 0, util: 0 } as NestSheet, occ: newOcc(W, H) };
        if (tryOn(s)) { open.push(s); placed = true; }
      }
      if (!placed) {
        failed.add(p.mark);
        unplaced.push({ mark: p.mark, qty: 1, reason: usable.length ? 'לא נכנס בלוח' : `גדול מהלוח (${o.sheetW}×${o.sheetH}, שוליים ${o.margin})` });
      }
    }
    for (const s of open) sheets.push(s.sheet);
  }
  sheets.forEach((s, i) => { s.id = i + 1; s.util = s.usedArea / (s.w * s.h); });
  return { sheets, unplaced, opts: o };
}

/** DXF של לוח אחד: מסגרת הלוח (FRAME), קונטורים (CUT), חורים (HOLE), סימון (MARK). מ"מ אמיתיים, ציר Y כלפי מעלה */
export function nestSheetDxf(s: NestSheet, margin: number): string {
  const ents: Ent[] = [];
  ents.push({ k: 'poly', pts: [{ x: 0, y: 0 }, { x: s.w, y: 0 }, { x: s.w, y: s.h }, { x: 0, y: s.h }], closed: true, layer: 'FRAME' });
  if (margin > 0) ents.push({ k: 'poly', pts: [{ x: margin, y: margin }, { x: s.w - margin, y: margin }, { x: s.w - margin, y: s.h - margin }, { x: margin, y: s.h - margin }], closed: true, layer: 'THIN' });
  for (const it of s.items) {
    ents.push({ k: 'poly', pts: it.poly, closed: true, layer: 'CUT' });
    for (const h of it.holes) ents.push({ k: 'circle', c: { x: h.x, y: h.y }, r: h.d / 2, layer: 'HOLE' });
    const cx = it.poly.reduce((a, q) => a + q.x, 0) / it.poly.length, cy = it.poly.reduce((a, q) => a + q.y, 0) / it.poly.length;
    ents.push({ k: 'text', p: { x: cx, y: cy }, s: it.mark.replace(/[^\x20-\x7E]/g, '?'), h: 12, align: 'center', layer: 'MARK' });
  }
  // sheetToDxf קורא רק w/h/scale/ents
  return sheetToDxf({ w: s.w, h: s.h, scale: 1, ents } as unknown as Sheet);
}

/** ZIP: DXF לכל לוח + דוח CSV של הלוחות */
export function nestZip(r: NestResult): { zip: Uint8Array; count: number } {
  const files: Record<string, Uint8Array> = {};
  for (const s of r.sheets) files[`lauch-${String(s.id).padStart(2, '0')}_${s.material}_t${s.t}.dxf`] = strToU8(nestSheetDxf(s, r.opts.margin));
  return { zip: zipSync(files, { level: 6 }), count: r.sheets.length };
}

/** טבלאות דוח: לוחות + חלקים + הערות */
export function nestTables(parts: NestPart[], r: NestResult): Table[] {
  const dens = (m: string) => getMaterial(m).density;
  const kg = (a: number, t: number, m: string) => (a * t * 1e-9 * dens(m));
  const sheetRows = r.sheets.map((s) => [s.id, s.material, s.t, `${s.w}×${s.h}`, s.items.length, Math.round((s.usedArea / 1e6) * 1000) / 1000, Math.round(s.util * 1000) / 10, Math.round((1 - s.util) * 1000) / 10, Math.round(kg(s.w * s.h - s.usedArea, s.t, s.material) * 10) / 10] as (string | number)[]);
  const totArea = r.sheets.reduce((a, s) => a + s.w * s.h, 0), totUsed = r.sheets.reduce((a, s) => a + s.usedArea, 0);
  const scrap = r.sheets.reduce((a, s) => a + kg(s.w * s.h - s.usedArea, s.t, s.material), 0);
  sheetRows.push(['סה"כ', '', '', '', r.sheets.reduce((a, s) => a + s.items.length, 0), Math.round((totUsed / 1e6) * 1000) / 1000, totArea ? Math.round((totUsed / totArea) * 1000) / 10 : 0, totArea ? Math.round((1 - totUsed / totArea) * 1000) / 10 : 0, Math.round(scrap * 10) / 10]);
  const placed = new Map<string, number[]>();
  for (const s of r.sheets) for (const it of s.items) placed.set(it.mark, [...(placed.get(it.mark) ?? []), s.id]);
  const partRows = parts.map((p) => { const ids = placed.get(p.mark) ?? []; return [p.mark, p.desc, p.material, p.t, p.qty, ids.length, [...new Set(ids)].join(', '), Math.round(p.area) / 100] as (string | number)[]; });
  const notes: (string | number)[][] = [
    ['אינו מאומת מול מכונה; פלטות בלבד; קונטור חיצוני — חורים נחתכים אך אינם משמשים לאריזה פנימית'],
    ['קצה פלטה חתוך בזווית מטופל כמלבן תוחם; אין חיתוך משותף, כניסות לקו או סדר חיתוך'],
    [`לוח ${r.opts.sheetW}×${r.opts.sheetH} · קרף ${r.opts.kerf} · שוליים ${r.opts.margin} · סיבוב ${r.opts.rotate ? 'מותר' : 'כבוי'} · תא רסטר ${r.opts.cell} מ"מ`],
    ...r.unplaced.map((u) => [`לא הונח: ${u.mark} × ${u.qty} — ${u.reason}`]),
  ];
  return [
    { name: 'ניסטינג — לוחות', headers: ['לוח', 'חומר', 'עובי', 'גודל', 'חלקים', 'שטח חלקים (מ"ר)', 'ניצולת %', 'פסולת %', 'משקל פסולת (ק"ג)'], rows: sheetRows },
    { name: 'ניסטינג — חלקים', headers: ['סימון', 'תיאור', 'חומר', 'עובי', 'כמות', 'הונח', 'לוחות', 'שטח (ס"מ²)'], rows: partRows },
    { name: 'ניסטינג — הערות', headers: ['הערה'], rows: notes },
  ];
}
