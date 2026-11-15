import type { Layer, Sheet } from './sheet';

// עוביי קו לפי ISO 128: קו נראה עבה 0.5, דק 0.25, מידות/צירים 0.18; נסתר מקווקו, ציר נקודה-קו
const STROKE: Record<Layer, [string, number, string?]> = {
  FRAME: ['#111', 0.7], TITLE: ['#111', 0.35], OUTLINE: ['#111820', 0.5], THIN: ['#4d5b69', 0.25], HIDDEN: ['#4d5b69', 0.25, '3 1.5'],
  AXIS: ['#a33', 0.18, '8 1.5 1.5 1.5'], DIM: ['#1f5fa8', 0.18], TEXT: ['#111', 0.2], HOLE: ['#b00020', 0.35], MARK: ['#8a3f00', 0.25], CUT: ['#111820', 0.5],
};
/** גוון מילוי למבט מוצלל: 0 כהה … 1 בהיר, בגוון אפור-ירקרק */
export function shadeRgb(v: number): string {
  const c = (a: number, b: number) => Math.round(a + (b - a) * Math.max(0, Math.min(1, v)));
  return `rgb(${c(70, 236)},${c(80, 238)},${c(76, 232)})`;
}
export function shadeTuple(v: number): [number, number, number] {
  const c = (a: number, b: number) => (a + (b - a) * Math.max(0, Math.min(1, v))) / 255;
  return [c(70, 236), c(80, 238), c(76, 232)];
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** SVG בקואורדינטות נייר (מ"מ). טקסט עברי — direction=rtl של הדפדפן. */
export function sheetToSvg(sh: Sheet): string {
  const H = sh.h;
  const Y = (y: number) => (H - y).toFixed(3);
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${sh.w} ${sh.h}" width="${sh.w}mm" height="${sh.h}mm" font-family="'KSP Sans','Segoe UI',Arial,sans-serif">`);
  out.push(`<rect x="0" y="0" width="${sh.w}" height="${sh.h}" fill="#fff"/>`);
  for (const e of sh.ents) {
    const [c, w, dash] = STROKE[e.layer];
    const st = `stroke="${c}" stroke-width="${w}"${dash ? ` stroke-dasharray="${dash}"` : ''}`;
    if (e.k === 'line') out.push(`<line x1="${e.a.x.toFixed(3)}" y1="${Y(e.a.y)}" x2="${e.b.x.toFixed(3)}" y2="${Y(e.b.y)}" ${st}/>`);
    else if (e.k === 'poly' && e.shade !== undefined) {
      const g = shadeRgb(e.shade);
      out.push(`<polygon points="${e.pts.map((q) => `${q.x.toFixed(2)},${Y(q.y)}`).join(' ')}" fill="${g}" stroke="${g}" stroke-width="0.06"/>`);
    }
    else if (e.k === 'poly') out.push(`<${e.closed ? 'polygon' : 'polyline'} points="${e.pts.map((q) => `${q.x.toFixed(3)},${Y(q.y)}`).join(' ')}" fill="${e.fill ? '#cfd6de' : 'none'}" ${st}/>`);
    else if (e.k === 'circle') out.push(`<circle cx="${e.c.x.toFixed(3)}" cy="${Y(e.c.y)}" r="${e.r.toFixed(3)}" fill="none" ${st}/>`);
    else {
      const anchor = e.align === 'left' ? 'start' : e.align === 'right' ? 'end' : 'middle';
      const rot = e.rot ? ` transform="rotate(${(-e.rot).toFixed(2)} ${e.p.x.toFixed(3)} ${Y(e.p.y)})"` : '';
      // direction=rtl הופך את משמעות start/end; עוגנים מפורשים לפי כיוון ltr
      out.push(`<text x="${e.p.x.toFixed(3)}" y="${Y(e.p.y)}" font-size="${e.h}" fill="${c}" text-anchor="${anchor}" direction="ltr" unicode-bidi="plaintext"${e.bold ? ' font-weight="700"' : ''}${rot}>${esc(e.s)}</text>`);
    }
  }
  out.push('</svg>');
  return out.join('');
}
