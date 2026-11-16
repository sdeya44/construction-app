import { fillOf, penOf, type Sheet } from './sheet';

const hex = (c: [number, number, number]) => `rgb(${c.map((x) => Math.round(x * 255)).join(',')})`;
/** גוון מילוי למבט מוצלל: 0 כהה … 1 בהיר, בגוון אפור-ירקרק */
export function shadeTuple(v: number, mono = false): [number, number, number] {
  const k = Math.max(0, Math.min(1, v));
  if (mono) { const g = (90 + (240 - 90) * k) / 255; return [g, g, g]; }
  const c = (a: number, b: number) => (a + (b - a) * k) / 255;
  return [c(70, 236), c(80, 238), c(76, 232)];
}
export function shadeRgb(v: number, mono = false): string { return hex(shadeTuple(v, mono)); }
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** SVG בקואורדינטות נייר (מ"מ). טקסט עברי — direction=rtl של הדפדפן. */
export function sheetToSvg(sh: Sheet): string {
  const H = sh.h;
  const mono = sh.mono !== false;
  const Y = (y: number) => (H - y).toFixed(3);
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${sh.w} ${sh.h}" width="${sh.w}mm" height="${sh.h}mm" font-family="'KSP Sans','Segoe UI',Arial,sans-serif">`);
  out.push(`<rect x="0" y="0" width="${sh.w}" height="${sh.h}" fill="#fff"/>`);
  for (const e of sh.ents) {
    const [cc, w, dsh] = penOf(e.layer, mono);
    const c = hex(cc), dash = dsh?.join(' ');
    const st = `stroke="${c}" stroke-width="${w}"${dash ? ` stroke-dasharray="${dash}"` : ''}`;
    if (e.k === 'line') out.push(`<line x1="${e.a.x.toFixed(3)}" y1="${Y(e.a.y)}" x2="${e.b.x.toFixed(3)}" y2="${Y(e.b.y)}" ${st}/>`);
    else if (e.k === 'poly' && e.shade !== undefined) {
      const g = shadeRgb(e.shade, mono);
      out.push(`<polygon points="${e.pts.map((q) => `${q.x.toFixed(2)},${Y(q.y)}`).join(' ')}" fill="${g}" stroke="${g}" stroke-width="0.14"/>`);
    }
    else if (e.k === 'poly') out.push(`<${e.closed ? 'polygon' : 'polyline'} points="${e.pts.map((q) => `${q.x.toFixed(3)},${Y(q.y)}`).join(' ')}" fill="${e.fill ? hex(fillOf(mono)) : 'none'}" ${st}/>`);
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
