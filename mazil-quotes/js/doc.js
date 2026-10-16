// Quote document: calculations, A4 rendering with pagination, PDF export.

const PAGE_W = 794, PAGE_H = 1123;
const ROWS_MAX = 878;      // rows may extend to here on pages without totals
const TOTALS_MAX = 880;    // totals block must end above the footer (top 888)

// Round half away from zero to agorot; toPrecision strips float noise (8745.255 stored as 8745.25499…).
export const r2 = n => { const x = Number(n) || 0; return Math.sign(x) * Math.round(Number((Math.abs(x) * 100).toPrecision(15))) / 100; };
export const fmt = n => r2(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const num = v => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return isFinite(n) ? n : 0; };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pad2 = n => String(n).padStart(2, '0');

export const isPriced = it => String(it.qty ?? '').trim() !== '';
export const quoteNo = q => q.no == null ? 'טיוטה' : `${q.prefix}/${String(q.no).padStart(6, '0')}`;
export const fmtDate = iso => { const d = new Date(iso); return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`; };
export const fmtTime = iso => { const d = new Date(iso); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

export function lineCalc(it) {
  const qty = num(it.qty), gross = num(it.price), disc = num(it.disc);
  const net = r2(gross * (1 - disc / 100));
  return { qty, gross, disc, net, total: r2(net * qty) };
}

export function calc(q) {
  let sub = 0, qtySum = 0;
  for (const it of q.items) if (isPriced(it)) { const l = lineCalc(it); sub += l.total; qtySum += l.qty; }
  sub = r2(sub);
  const userPct = num(q.discount), vatPct = num(q.vat);
  const vatOf = a => r2(a * vatPct / 100);
  let after = r2(sub - r2(sub * userPct / 100));
  const userAfter = after;
  if (q.roundTotal && sub > 0) after = roundedAfter(after, vatPct, vatOf);
  const discAmt = r2(sub - after);
  const vat = vatOf(after);
  // The document shows one discount line, so the rounding is folded into it and the % is the effective one.
  const discPct = discAmt ? r2(discAmt / sub * 100) : 0;
  return { sub, qtySum: r2(qtySum), discPct, discAmt, after, vatPct, vat, grand: r2(after + vat), roundAdj: r2(userAfter - after) };
}

// Largest pre-VAT amount ≤ `after` whose total incl. VAT is a whole shekel (rounds down only — never raises the price).
// Not every integer is reachable (VAT rounding steps by 0.02 at times), so it falls back to the next shekel down.
function roundedAfter(after, vatPct, vatOf) {
  let target = Math.floor(r2(after + vatOf(after)) + 1e-9);
  for (let k = 0; k < 5 && target > 0; k++, target--) {
    const a0 = Math.round(target / (1 + vatPct / 100) * 100);
    for (let d = 3; d >= -3; d--) {
      const a = (a0 + d) / 100;
      if (a <= after && r2(a + vatOf(a)) === target) return a;
    }
  }
  return after;
}

// One item = one or more description lines. Each line is a row (as in the source system);
// prices and the running row number (#) appear on the item's last line only.
function buildBlocks(q) {
  let row = 0;
  return q.items.map(it => {
    const lines = String(it.desc ?? '').split('\n');
    const priced = isPriced(it), l = lineCalc(it);
    return lines.map((text, i) => {
      row++;
      const last = i === lines.length - 1;
      return { n: priced && last ? row : '', code: it.code === '' || it.code == null ? '0' : it.code, text, priced: priced && last, l };
    });
  });
}

function rowHtml(r) {
  const v = x => r.priced ? fmt(x) : '';
  return `<tr>
    <td class="c-num"><div>${r.n}</div></td>
    <td class="c-code"><div>${esc(r.code)}</div></td>
    <td class="c-desc qd-desc"><div>${esc(r.text)}</div></td>
    <td class="c-qty"><div>${v(r.l.qty)}</div></td>
    <td class="c-gross"><div>${v(r.l.gross)}</div></td>
    <td class="c-disc"><div>${v(r.l.disc)}</div></td>
    <td class="c-net qd-bold"><div>${v(r.l.net)}</div></td>
    <td class="c-tot qd-bold"><div>${v(r.l.total)}</div></td>
  </tr>`;
}

function pageHtml(q, s) {
  const c = q.customer || {};
  const ab = (right, top, html, cls = '') => `<div class="qd-abs ${cls}" style="right:${right}px;top:${top}px">${html}</div>`;
  return `<div class="qd-page">
    <img class="qd-hdr" src="${esc(s.headerImg || 'assets/header.jpg')}" alt="">
    <div class="qd-line" style="top:190px"></div>
    ${ab(39, 193, 'הצעת מחיר', 'qd-title')}
    ${ab(329, 193, `מספר : <span class="qd-ltr">${esc(quoteNo(q))}</span>`, 'qd-title')}
    ${ab(663, 193, esc(q.copyType || 'מקור'), 'qd-title')}
    <div class="qd-line" style="top:221px;border-top-width:1.5px"></div>
    ${ab(39, 226, 'לכבוד :', 'qd-info qd-b')}
    ${ab(39, 246, esc(c.name), 'qd-info')}
    ${ab(241, 267, `טלפון: <span class="qd-ltr">${esc(c.phone)}</span>`, 'qd-info')}
    ${ab(241, 287, `פקס: <span class="qd-ltr">${esc(c.fax)}</span>`, 'qd-info')}
    ${ab(241, 307, `ע.מ./ת.ז: ${esc(c.taxId)}`, 'qd-info')}
    ${ab(400, 226, 'מספרכם:', 'qd-info')}
    ${ab(491, 226, esc(q.ref), 'qd-info')}
    ${ab(590, 226, `עוסק מורשה&nbsp; ${esc(s.osek)}`, 'qd-info-l')}
    ${ab(590, 246, `תאריך: ${fmtDate(q.createdAt)}`, 'qd-info-l')}
    ${ab(590, 267, `שעה :&nbsp; ${fmtTime(q.createdAt)}`, 'qd-info-l')}
    ${ab(590, 287, '<span class="qd-pgno"></span>', 'qd-info-l qd-pg')}
    <div class="qd-line" style="top:327px"></div>
    <table class="qd-table"><thead><tr>
      <th class="c-num"><div>#</div></th>
      <th class="c-code"><div>מס' פריט</div></th>
      <th class="c-desc"><div>תאור פריט</div></th>
      <th class="c-qty"><div>כמות</div></th>
      <th class="c-gross"><div>ברוטו/לצרכן<br>ליחידה</div></th>
      <th class="c-disc"><div>%הנחה</div></th>
      <th class="c-net"><div>נטו&nbsp; ליחידה</div></th>
      <th class="c-tot"><div>סה''כ נטו</div></th>
    </tr></thead><tbody></tbody></table>
  </div>`;
}

function totalsHtml(q, s, t) {
  const row = (val, lab) => `<div class="qd-trow"><div class="qd-tval">${val}</div><div class="qd-tlab">${lab}</div></div>`;
  return `<div class="qd-totals">
    <div class="qd-qsum" style="right:309px">${fmt(t.qtySum)}</div>
    <div class="qd-tgrid">
      <div class="qd-grp g1">${row(fmt(t.sub), 'סה"כ ללא מע"מ:')}${row(fmt(t.discAmt), `הנחה:&nbsp; %&nbsp; ${fmt(t.discPct)}`)}</div>
      <div class="qd-grp">${row(fmt(t.after), 'סה"כ לאחר הנחה:')}${row(fmt(t.vat), `מע"מ&nbsp;&nbsp; ${fmt(t.vatPct)}%`)}</div>
      <div class="qd-grp">${row(fmt(t.grand), 'סה"כ לתשלום:')}</div>
    </div>
    ${q.notes ? `<div class="qd-notes"><b>הערות:</b> ${esc(q.notes)}</div>` : ''}
  </div>`;
}

const footHtml = (q, s) => `<div class="qd-foot">מפיק המסמך: ${esc(q.producer ?? s.producer)}<br>${esc(s.company)} ____________</div>`;

function el(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
function tblBottom(page) { const t = page.querySelector('.qd-table'); return t.offsetTop + t.offsetHeight; }

// Renders all pages of the quote into `host` (must be attached and not transformed). Returns page elements.
export function renderDoc(q, s, host) {
  host.innerHTML = '';
  const pages = [];
  const newPage = () => { const p = el(pageHtml(q, s)); host.appendChild(p); pages.push(p); return p; };
  let page = newPage();
  for (const blk of buildBlocks(q)) {
    const trs = blk.map(r => el(`<table><tbody>${rowHtml(r)}</tbody></table>`).querySelector('tr'));
    const tb = () => page.querySelector('tbody');
    const before = tb().children.length;
    trs.forEach(tr => tb().appendChild(tr));
    if (tblBottom(page) <= ROWS_MAX) continue;
    if (before > 0) { trs.forEach(tr => tr.remove()); page = newPage(); trs.forEach(tr => tb().appendChild(tr)); }
    // A single item taller than a page: split it across pages row by row.
    while (tblBottom(page) > ROWS_MAX && tb().children.length > 1) {
      const carry = [];
      while (tblBottom(page) > ROWS_MAX && tb().children.length > 1) { const last = tb().lastElementChild; last.remove(); carry.unshift(last); }
      page = newPage(); carry.forEach(tr => tb().appendChild(tr));
    }
  }
  const t = calc(q);
  const placeTotals = p => { const tot = el(totalsHtml(q, s, t)); tot.style.top = (tblBottom(p) + 4) + 'px'; p.appendChild(tot); return tot; };
  let tot = placeTotals(page);
  if (tot.offsetTop + tot.offsetHeight > TOTALS_MAX && page.querySelector('tbody').children.length) {
    tot.remove(); page = newPage(); placeTotals(page);
  }
  page.insertAdjacentHTML('beforeend', footHtml(q, s));
  pages.forEach((p, i) => { p.querySelector('.qd-pgno').textContent = `דף ${i + 1} מתוך ${pages.length}`; });
  return pages;
}

export async function fontsReady() {
  try { await Promise.all([document.fonts.load('400 14px Arimo', 'אבג 123'), document.fonts.load('700 14px Arimo', 'אבג 123')]); } catch { }
  await document.fonts.ready;
}

function imagesReady(root) {
  return Promise.all([...root.querySelectorAll('img')].map(img => img.complete ? 0 : new Promise(r => { img.onload = img.onerror = r; })));
}

export async function makePdf(q, s, host) {
  await fontsReady();
  const pages = renderDoc(q, s, host);
  await imagesReady(host);
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  pdf.setProperties({ title: `הצעת מחיר ${quoteNo(q)}`, author: s.company });
  for (let i = 0; i < pages.length; i++) {
    const canvas = await window.html2canvas(pages[i], { scale: 2.5, backgroundColor: '#ffffff', logging: false, width: PAGE_W, height: PAGE_H, windowWidth: PAGE_W });
    if (i) pdf.addPage();
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
  }
  host.innerHTML = '';
  return pdf.output('blob');
}

export const pdfName = q => `הצעת מחיר ${quoteNo(q).replace('/', '-')}.pdf`;
// Download names stay ASCII: some browsers drop non-ASCII a[download] names.
export const pdfFileName = q => `Quote-${quoteNo(q).replace('/', '-')}.pdf`;
export { PAGE_W, PAGE_H };
