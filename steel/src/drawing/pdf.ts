import { PDFDocument, rgb, degrees, LineCapStyle, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { KSP_BOLD, KSP_REGULAR } from './font/fontData';
import { fillOf, penOf, visualRuns, type Sheet } from './sheet';
import { shadeTuple } from './svg';

const MM = 72 / 25.4;
function b64(s: string): Uint8Array {
  if (typeof atob === 'function') return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  return new Uint8Array(Buffer.from(s, 'base64'));
}

/** הפקת PDF וקטורי (עמוד לכל גיליון) עם גופן עברי מוטמע. מחזיר בתים. */
export async function sheetsToPdf(sheets: Sheet[], meta: { title: string; author?: string }, fonts?: { regular: Uint8Array; bold: Uint8Array }): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(meta.title); doc.setCreator('KAYAN STEEL PRO'); doc.setProducer('KAYAN STEEL PRO');
  if (meta.author) doc.setAuthor(meta.author);
  const reg = await doc.embedFont(fonts?.regular ?? b64(KSP_REGULAR), { subset: true });
  const bold = await doc.embedFont(fonts?.bold ?? b64(KSP_BOLD), { subset: true });
  for (const sh of sheets) drawSheet(doc.addPage([sh.w * MM, sh.h * MM]), sh, reg, bold);
  return doc.save();
}

function drawSheet(page: PDFPage, sh: Sheet, reg: PDFFont, bold: PDFFont) {
  const P = (x: number, y: number) => ({ x: x * MM, y: y * MM });
  for (const e of sh.ents) {
    const mono = sh.mono !== false;
    const [[r, g, b], w, dash] = penOf(e.layer, mono);
    const color = rgb(r, g, b);
    const opts = { thickness: w * MM, color, dashArray: dash?.map((x) => x * MM), lineCap: LineCapStyle.Round };
    if (e.k === 'line') page.drawLine({ start: P(e.a.x, e.a.y), end: P(e.b.x, e.b.y), ...opts });
    else if (e.k === 'poly') {
      const pts = e.closed ? [...e.pts, e.pts[0]] : e.pts;
      if (e.shade !== undefined && e.pts.length > 2) {
        const d = e.pts.map((q, i) => `${i ? 'L' : 'M'} ${(q.x * MM).toFixed(2)} ${(-q.y * MM).toFixed(2)}`).join(' ') + ' Z';
        const [sr, sg, sb] = shadeTuple(e.shade, mono);
        page.drawSvgPath(d, { x: 0, y: 0, color: rgb(sr, sg, sb), borderColor: rgb(sr, sg, sb), borderWidth: 0.06 * MM });
      } else if (e.fill && e.pts.length > 2) {
        const d = e.pts.map((q, i) => `${i ? 'L' : 'M'} ${(q.x * MM).toFixed(2)} ${(-q.y * MM).toFixed(2)}`).join(' ') + ' Z';
        page.drawSvgPath(d, { x: 0, y: 0, color: rgb(...fillOf(mono)), borderColor: color, borderWidth: w * MM });
      } else for (let i = 1; i < pts.length; i++) page.drawLine({ start: P(pts[i - 1].x, pts[i - 1].y), end: P(pts[i].x, pts[i].y), ...opts });
    } else if (e.k === 'circle') page.drawCircle({ ...P(e.c.x, e.c.y), size: e.r * MM, borderColor: color, borderWidth: w * MM });
    else {
      const font = e.bold ? bold : reg;
      const size = e.h * MM * 1.35;
      // fontkit מסדר רצף עברי בעצמו (RTL) — לכן מציירים רצף-רצף בסדר חזותי, כל רצף בסדר לוגי
      const runs = visualRuns(e.s).map((r) => ({ ...r, w: font.widthOfTextAtSize(r.t, size) }));
      const width = runs.reduce((acc, r) => acc + r.w, 0);
      let dx = e.align === 'left' ? 0 : e.align === 'right' ? -width : -width / 2;
      const a = ((e.rot ?? 0) * Math.PI) / 180;
      for (const r of runs) {
        const x = e.p.x * MM + dx * Math.cos(a), y = e.p.y * MM + dx * Math.sin(a);
        page.drawText(r.t, { x, y, size, font, color, rotate: degrees(e.rot ?? 0) });
        dx += r.w;
      }
    }
  }
}
