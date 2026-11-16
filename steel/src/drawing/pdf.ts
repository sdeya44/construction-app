import { PDFDocument, PDFHexString, PDFName, PDFNull, PDFNumber, rgb, degrees, LineCapStyle, type PDFDict, type PDFFont, type PDFPage, type PDFRef } from 'pdf-lib';
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
/** סימניות (Outline) לסט שרטוטים: קבוצות → גיליונות. page = אינדקס הגיליון במערך */
export interface OutlineGroup { title: string; items: { title: string; page: number }[] }

function addOutline(doc: PDFDocument, groups: OutlineGroup[]) {
  const ctx = doc.context, pages = doc.getPages();
  const rootRef = ctx.nextRef();
  const dest = (i: number) => ctx.obj([pages[Math.min(i, pages.length - 1)].ref, PDFName.of('Fit')]);
  const gRefs = groups.map(() => ctx.nextRef());
  let total = 0;
  groups.forEach((g, gi) => {
    const iRefs = g.items.map(() => ctx.nextRef());
    g.items.forEach((it, ii) => {
      const d: Record<string, unknown> = { Title: PDFHexString.fromText(it.title), Parent: gRefs[gi], Dest: dest(it.page) };
      if (ii > 0) d.Prev = iRefs[ii - 1];
      if (ii < iRefs.length - 1) d.Next = iRefs[ii + 1];
      ctx.assign(iRefs[ii], ctx.obj(d as never) as unknown as PDFDict);
    });
    const gd: Record<string, unknown> = { Title: PDFHexString.fromText(g.title), Parent: rootRef, Dest: dest(g.items[0]?.page ?? 0) };
    if (iRefs.length) { gd.First = iRefs[0]; gd.Last = iRefs[iRefs.length - 1]; gd.Count = PDFNumber.of(-iRefs.length); }
    if (gi > 0) gd.Prev = gRefs[gi - 1];
    if (gi < gRefs.length - 1) gd.Next = gRefs[gi + 1];
    ctx.assign(gRefs[gi], ctx.obj(gd as never) as unknown as PDFDict);
    total += 1;
  });
  const root = ctx.obj({ Type: 'Outlines', First: gRefs[0] ?? PDFNull, Last: gRefs[gRefs.length - 1] ?? PDFNull, Count: PDFNumber.of(total) } as never) as unknown as PDFDict;
  ctx.assign(rootRef, root);
  doc.catalog.set(PDFName.of('Outlines'), rootRef as PDFRef);
  doc.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
}

export async function sheetsToPdf(sheets: Sheet[], meta: { title: string; author?: string; outline?: OutlineGroup[]; images?: { page: number; x: number; y: number; w: number; h: number; png: Uint8Array }[] }, fonts?: { regular: Uint8Array; bold: Uint8Array }): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(meta.title); doc.setCreator('KAYAN STEEL PRO'); doc.setProducer('KAYAN STEEL PRO');
  if (meta.author) doc.setAuthor(meta.author);
  const reg = await doc.embedFont(fonts?.regular ?? b64(KSP_REGULAR), { subset: true });
  const bold = await doc.embedFont(fonts?.bold ?? b64(KSP_BOLD), { subset: true });
  const pages = sheets.map((sh) => { const pg = doc.addPage([sh.w * MM, sh.h * MM]); drawSheet(pg, sh, reg, bold); return pg; });
  for (const im of meta.images ?? []) {
    const img = await doc.embedPng(im.png);
    // התאמה לתיבה תוך שמירת יחס
    const k = Math.min(im.w / img.width, im.h / img.height);
    const w = img.width * k, h = img.height * k;
    pages[im.page]?.drawImage(img, { x: (im.x + (im.w - w) / 2) * MM, y: (im.y + (im.h - h) / 2) * MM, width: w * MM, height: h * MM });
  }
  if (meta.outline?.length) addOutline(doc, meta.outline.filter((g) => g.items.length));
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
        page.drawSvgPath(d, { x: 0, y: 0, color: rgb(sr, sg, sb), borderColor: rgb(sr, sg, sb), borderWidth: 0.14 * MM });
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
