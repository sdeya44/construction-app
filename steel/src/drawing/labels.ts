/**
 * הצבת תוויות בלי חפיפה (1.68) — בגישת placeLabels מחבילת 1.70: לכל תווית מחפשים מקום פנוי
 * בטבעות סביב נקודת העיגון (0, 2, 4 … 24 מ"מ נייר, 8 כיוונים). תווית שזזה יותר מ-2.5 מ"מ מקבלת קו מוביל דק.
 * מכשולים: כל הטקסטים שכבר בגיליון + התוויות שהוצבו. התוצאה דטרמיניסטית (אותו קלט ⇒ אותו גיליון).
 */
import { approxMeasure, textBox, type Box, type Measure } from './layoutAudit';
import type { Layer, P, Sheet } from './sheet';

export interface LabelReq { p: P; s: string; h: number; rot?: number; bold?: boolean; layer: Layer }
const GAP = 1.0;
const hit = (a: Box, b: Box) => a.x < b.r + GAP && a.r + GAP > b.x && a.y < b.t + GAP && a.t + GAP > b.y;

export function placeLabels(sh: Sheet, reqs: LabelReq[], region: { x0: number; x1: number; y0: number; y1: number }, measure: Measure = approxMeasure, leader = true) {
  const used: Box[] = sh.ents.filter((e) => e.k === 'text').map((e) => textBox(e as Extract<typeof e, { k: 'text' }>, measure));
  for (const r of reqs) {
    const ent = { k: 'text' as const, p: r.p, s: r.s, h: r.h, align: 'center' as const, layer: r.layer, rot: r.rot ?? 0, bold: r.bold };
    let best: P | null = null;
    outer: for (const rad of [0, 2, 3.5, 5, 7, 9, 12, 16, 20, 24]) for (const [dx, dy] of rad ? [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]] : [[0, 0]]) {
      const q = { x: r.p.x + dx! * rad, y: r.p.y + dy! * rad };
      const b = textBox({ ...ent, p: q }, measure);
      if (b.x < region.x0 || b.r > region.x1 || b.y < region.y0 || b.t > region.y1) continue;
      if (used.some((u) => hit(b, u))) continue;
      best = q; break outer;
    }
    const q = best ?? r.p;
    sh.ents.push({ ...ent, p: q });
    used.push(textBox({ ...ent, p: q }, measure));
    if (leader && best && Math.hypot(q.x - r.p.x, q.y - r.p.y) > 2.5) sh.ents.push({ k: 'line', a: r.p, b: { x: q.x, y: q.y + (q.y < r.p.y ? r.h * 0.8 : -0.4) }, layer: 'THIN' });
  }
}

/** טקסט זהה באותו מקום בדיוק (מידה שנוצרה פעמיים) — נשאר עותק אחד */
export function dedupeTexts(sh: Sheet) {
  // אותו טקסט, גובה וסיבוב במרחק < 2 מ"מ — אותה מידה שנוצרה פעמיים (שתי שרשראות מידות על אותו קטע)
  const kept: Extract<Sheet['ents'][number], { k: 'text' }>[] = [];
  sh.ents = sh.ents.filter((e) => {
    if (e.k !== 'text') return true;
    if (kept.some((q) => q.s === e.s && q.h === e.h && (q.rot ?? 0) === (e.rot ?? 0) && Math.hypot(q.p.x - e.p.x, q.p.y - e.p.y) < 2)) return false;
    kept.push(e); return true;
  });
}
