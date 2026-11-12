// BOQ import from PDF (Binarit-style bills and BOQ printouts). PDF text has no structure, so
// this is a best-effort reader: items are found by their code (e.g. 01.1.010), numbers by
// position, and every result goes through a review screen before anything is saved.
import { unitCode, UNIT_CODES } from './skn.js';
import { lineCents, cents } from './money.js';

const HEB = /[֐-׿]/;
const NUM = /^-?[\d,]+\.\d{2}$/; // column values are printed with 2 decimals; numbers inside descriptions are not
const CODE = /^(\d{1,2})\.(\d{1,2})\.(\d{1,4})$/;

/** pdf.js text items of one page → lines (top to bottom) of tokens in reading order. */
export function pageLines(items) {
  const chars = items.filter((i) => i.str && i.str.trim() !== '' || i.str === ' ')
    .map((i) => ({ s: i.str, x: i.transform[4], y: i.transform[5], w: i.width || 0 }));
  const rows = [];
  for (const c of chars.sort((a, b) => b.y - a.y)) {
    let r = rows.find((r) => Math.abs(r.y - c.y) < 2.2);
    if (!r) { r = { y: c.y, cs: [] }; rows.push(r); }
    r.cs.push(c);
  }
  return rows.sort((a, b) => b.y - a.y).map((r) => {
    const cs = r.cs.sort((a, b) => a.x - b.x);
    const toks = [];
    let cur = null;
    for (const c of cs) {
      if (c.s.trim() === '') { cur = null; continue; }
      const gap = cur ? c.x - (cur.x1) : Infinity;
      // letters within a word sit ~0 apart; word gaps are ~2.6+
      if (!cur || gap > 1.5) { cur = { parts: [c.s], x0: c.x, x1: c.x + c.w }; toks.push(cur); }
      else { cur.parts.push(c.s); cur.x1 = Math.max(cur.x1, c.x + c.w); }
    }
    const out = toks.map((t) => {
      let s = t.parts.join('');
      if (HEB.test(s)) s = [...s].reverse().join('').replace(/[()]/g, (p) => (p === '(' ? ')' : '('));
      return { s, x0: t.x0, x1: t.x1 };
    }).sort((a, b) => b.x1 - a.x1); // right-to-left reading order
    return { y: r.y, toks: out, text: out.map((t) => t.s).join(' ') };
  });
}

const isNum = (t) => NUM.test(t.s) && /\d/.test(t.s);
const num = (s) => s.replace(/,/g, '');
const STOP = /^(סה"כ|להעברה|מהעברה|תת|פרק|מבנה|הנחה)/;

/**
 * @param pages array of line arrays (from pageLines), one per page
 * @returns {{items:object[], sections:{code,name}[], warnings:string[], layout:string}}
 */
export function parsePdfLines(pages) {
  const items = [], warnings = [], sections = new Map(), blocks = [];
  let struct = '01', layout = null;
  for (let pi = 0; pi < pages.length; pi++) {
    const lines = pages[pi];
    if (lines.some((l) => /ריכוז/.test(l.text))) continue; // concentration pages carry no items
    const width = Math.max(...lines.flatMap((l) => l.toks.map((t) => t.x1)), 1);
    // header: "מבנה N name"
    for (const l of lines.slice(0, 8)) {
      const m = l.text.match(/^מבנה\s+(\d{1,2})\s*(.*)$/);
      if (m) { struct = m[1].padStart(2, '0'); if (m[2]) sections.set(struct, m[2].trim()); break; }
    }
    // body
    let blk = null;
    const close = () => { if (blk) { blk.struct = struct; blk.page = pi + 1; blocks.push(blk); } blk = null; };
    for (const l of lines) {
      const right = l.toks[0];
      const m = right && right.x1 > width * 0.8 && right.s.match(CODE);
      const head = l.text.match(/^(?:תת פרק|פרק)\s+(\d{1,2})(?:\.(\d{1,2}))?\s+(.+)$/);
      if (head && !m) {
        close();
        const ch = head[1].padStart(2, '0');
        sections.set(head[2] ? `${struct}.${ch}.${head[2].padStart(2, '0')}` : `${struct}.${ch}`, head[3].trim());
        continue;
      }
      if (STOP.test(l.text) && !m) { close(); continue; }
      if (m) { close(); blk = { code: m, codeTok: right, lines: [l] }; continue; }
      if (blk) blk.lines.push(l);
    }
    close();
  }
  // Learn where the numeric columns end: the right edge of the right-most number on data rows is
  // the quantity column for almost every item. Numbers further right belong to the description.
  const edges = blocks.map((b) => Math.max(0, ...b.lines.flatMap((l) => l.toks.filter(isNum).map((t) => t.x1)))).filter((x) => x > 0).sort((a, b) => a - b);
  const qtyEdge = edges.length ? edges[Math.floor(edges.length / 2)] + 4 : Infinity;
  for (const b of blocks) {
    const it = finish(b, b.struct, warnings, b.page, qtyEdge);
    if (it) { items.push(it); layout ??= it._layout; }
  }
  const seen = new Set();
  for (const it of items) {
    const k = `${it.struct}.${it.chapter}.${it.sub}.${it.num}`;
    if (seen.has(k)) warnings.push(`מספור כפול: ${k}`);
    seen.add(k);
    for (const s of [it.struct, `${it.struct}.${it.chapter}`, `${it.struct}.${it.chapter}.${it.sub}`]) if (!sections.has(s)) sections.set(s, '');
  }
  return { items, sections: [...sections].map(([code, name]) => ({ code, name })), warnings, layout: layout ?? 'unknown' };
}

function finish(blk, struct, warnings, page, qtyEdge = Infinity) {
  const [, ch, sub, n] = blk.code;
  const code = blk.codeTok.s;
  // the data row is the one with the most numbers (numbers are bottom-aligned in Binarit)
  let data = null, best = 0;
  const colNum = (t) => isNum(t) && t.x1 <= qtyEdge;
  for (const l of blk.lines) { const c = l.toks.filter(colNum).length; if (c >= best && c > 0) { best = c; data = l; } }
  const descLines = [];
  let unit = '';
  let unitToks = [];
  let nums = [];
  if (data) {
    nums = data.toks.filter(colNum).sort((a, b) => a.x0 - b.x0);
    const rightmostNum = nums[nums.length - 1];
    // unit = closest non-number token right of the numbers
    const cand = data.toks.filter((t) => !colNum(t) && t.x0 >= rightmostNum.x1 - 1 && t !== blk.codeTok).sort((a, b) => a.x0 - b.x0);
    // the unit cell is often split into pieces ("מ" + "\"ק"); join the nearest 1–3 in reading order
    for (let k = 1; k <= Math.min(3, cand.length) && !unitToks.length; k++) {
      const parts = cand.slice(0, k);
      if (unitCode(parts.slice().reverse().map((t) => t.s).join(''))) unitToks = parts;
    }
    if (!unitToks.length && cand[0] && cand[0].s.length <= 6) unitToks = [cand[0]];
    unit = unitToks.slice().reverse().map((t) => t.s).join('');
  }
  const unitTok = unitToks.length ? { x1: Math.max(...unitToks.map((t) => t.x1)) } : null;
  const descRight = blk.codeTok.x0 - 1;
  const descLeft = unitTok ? unitTok.x1 + 1 : (nums.length ? nums[nums.length - 1].x1 + 1 : 0);
  for (const l of blk.lines) {
    const t = l.toks.filter((t) => t !== blk.codeTok && t.x0 >= descLeft - 0.5 && t.x1 <= descRight + 0.5 && !unitToks.includes(t));
    if (t.length) descLines.push(t.map((x) => x.s).join(' '));
  }
  const description = descLines.join(' ').replace(/\s+/g, ' ').trim();
  if (!nums.length) { warnings.push(`עמ' ${page}, סעיף ${code}: לא נמצאו כמות ומחיר — דולג`); return null; }
  let qty, price, total, layout;
  const v = nums.map((t) => num(t.s));
  if (v.length >= 6) { // bill: total, price, cum, [cur], [prev], pct, contract qty
    layout = 'bill'; total = v[0]; price = v[1]; qty = v[v.length - 1];
    const cum = v[2];
    if (Math.abs(lineCents(cum, price) - cents(total)) > 1) warnings.push(`סעיף ${code}: מצטבר×מחיר אינו תואם את הסכום המודפס`);
  } else if (v.length >= 3) { // BOQ: total, price, qty
    layout = 'boq'; total = v[0]; price = v[1]; qty = v[v.length - 1];
    if (Math.abs(lineCents(qty, price) - cents(total)) > 1) warnings.push(`סעיף ${code}: כמות×מחיר (${qty}×${price}) ≠ ${total}`);
  } else { warnings.push(`עמ' ${page}, סעיף ${code}: מבנה מספרים לא מזוהה (${v.join(', ')})`); return null; }
  if (!unitCode(unit)) warnings.push(`סעיף ${code}: יחידה "${unit}" לא מזוהה`);
  return { struct, chapter: ch.padStart(2, '0'), sub: sub.padStart(2, '0'), num: Number(n), description, unit: UNIT_CODES[unitCode(unit)] ?? unit,
    qty, price, kind: ch === '99' ? 'extra' : 'contract', _layout: layout, _page: page };
}

/** Browser: read a PDF file with pdf.js (scripts in the PDF are never evaluated). */
export async function readPdf(bytes) {
  const pdfjs = await import('../vendor/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;
  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, enableXfa: false }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) pages.push(pageLines((await (await doc.getPage(i)).getTextContent()).items));
  return parsePdfLines(pages);
}
