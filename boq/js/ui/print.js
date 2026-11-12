// Printable documents: bill (layout of account 8 — landscape detail + concentration, portrait
// payment summary) and BOQ / quote. Pagination happens in the DOM after layout so every page
// carries exact "להעברה / מהעברה" totals.
import { h, dateLabel, monthLabel, toast } from './dom.js';
import { money, qty, lineCents, pct } from '../money.js';
import { itemCode, isBillable, contractValue } from '../engine.js';
import { printPdf } from '../persist.js';

const cash = (c) => money(c);

/**
 * Lay out row descriptors onto sheets.
 * @param root   container
 * @param mkSheet ({first}) => {sheet, body, tbody}
 * @param rows   [{el, amount?, breakBefore?}]  amount = contribution to the running carry total
 * @param carryCols number of columns before the amount column
 */
function paginate(root, mkSheet, rows, carryCols, totalCols, groupKey = () => '') {
  let page = mkSheet(), running = 0, group = null;
  root.append(page.sheet);
  const carryRow = (label, v) => h('tr', { class: 'carry' }, h('td', { colspan: carryCols }, label), h('td', { class: 'nm' }, cash(v)), totalCols > carryCols + 1 ? h('td', { colspan: totalCols - carryCols - 1 }) : null);
  const fits = () => page.body.scrollHeight <= page.body.clientHeight + 1;
  for (const r of rows) {
    const g = groupKey(r);
    if (r.breakBefore && page.tbody.children.length) {
      page = mkSheet(r); root.append(page.sheet); running = 0;
    } else if (g !== group) running = 0;
    group = g;
    page.tbody.append(r.el);
    // leave room for a carry row
    const probe = carryRow('להעברה', running);
    page.tbody.append(probe);
    const ok = fits();
    probe.remove();
    if (!ok && page.tbody.children.length > 1) {
      r.el.remove();
      page.tbody.append(carryRow('להעברה', running));
      page = mkSheet(r, true); root.append(page.sheet);
      page.tbody.append(carryRow('מהעברה', running));
      page.tbody.append(r.el);
    }
    if (r.reset) running = 0;
    running += r.amount ?? 0;
  }
  const sheets = [...root.querySelectorAll('.sheet')];
  sheets.forEach((s, i) => { const p = s.querySelector('.pg'); if (p) p.textContent = `עמוד ${i + 1} מתוך ${sheets.length}`; });
}

function docShell(title, onBack, fileName) {
  const root = h('div', { class: 'print-root' });
  const bar = h('div', { class: 'print-bar no-print' },
    h('button', { onclick: onBack }, '→ חזרה'),
    h('button', { class: 'primary', onclick: async () => { try { await printPdf(fileName); } catch (e) { toast(e.message, 'err'); } } }, 'שמירה כ-PDF / הדפסה'),
    h('span', { class: 'muted' }, title));
  return { root, wrap: h('div', {}, bar, root) };
}

function head({ issuer, contact, title, project, recipient, number, date, extra }) {
  return h('div', { class: 's-head' },
    h('div', { class: 'issuer' }, h('b', {}, issuer), h('div', {}, contact)),
    h('div', { class: 'title' }, h('h1', {}, title), h('div', { class: 'proj' }, project), recipient ? h('div', { class: 'recipient' }, `לכבוד: ${recipient}`) : null),
    h('div', { class: 'meta' }, number ? h('div', {}, number) : null, h('div', {}, `תאריך: ${dateLabel(date)}`), extra ? h('div', {}, extra) : null, h('div', { class: 'pg' })));
}

// ------------------------------------------------------------------------------------------
export function boqPrintView(ctx, cid) {
  const api = ctx.api;
  const c = api.contract(cid);
  const p = api.project(c.project_id);
  const co = api.company();
  const isQuote = c.kind === 'quote';
  const secs = new Map(api.sections(cid).map((s) => [s.code, s]));
  const items = api.items(cid).filter((i) => i.kind === 'note' || i.change_status !== 'rejected');
  const D = { issuer: co.name, contact: [co.phone, co.email, co.vat_id && `ח.פ ${co.vat_id}`].filter(Boolean).join(' · '), recipient: c.party,
    project: p.name, number: isQuote ? `הצעה ${c.number || ''}`.trim() : `חוזה ${c.number || ''}`.trim(), date: new Date().toISOString().slice(0, 10) };
  const title = isQuote ? `הצעת מחיר — ${c.name}` : `כתב כמויות — ${c.name}`;
  const { root, wrap } = docShell(title, () => ctx.go(`c/${cid}`), `${title}.pdf`);
  const foot = () => h('div', { class: 's-foot' }, h('span', {}, `${D.issuer}  ${D.contact}`), h('span', {}, isQuote ? 'המחירים אינם כוללים מע"מ' : ''));
  const COLS = ['סעיף', 'תאור', 'יחידה', 'כמות', 'מחיר יחידה', 'סה"כ'];
  const W = [10, 50, 7, 10, 10, 13];
  const mk = (r0) => {
    const tbody = h('tbody');
    const body = h('div', { class: 's-body' }, h('table', {}, h('colgroup', {}, W.map((w) => h('col', { style: { width: `${w}%` } }))), h('thead', {}, h('tr', {}, COLS.map((x) => h('th', {}, x)))), tbody));
    const st = r0?.struct ?? '', ch = r0?.chapter ?? '';
    const sheet = h('section', { class: 'sheet port' }, head({ ...D, title }),
      h('div', { class: 's-sub' }, st ? h('span', {}, `מבנה ${st} ${secs.get(st)?.name ?? ''}`) : null, ch ? h('span', {}, `פרק ${ch} ${secs.get(`${st}.${ch}`)?.name ?? ''}`) : null), body, foot());
    return { sheet, body, tbody };
  };
  const rows = [];
  const chapters = [...new Set(items.map((i) => `${i.struct}.${i.chapter}`))].sort();
  for (const key of chapters) {
    const [st, ch] = key.split('.');
    let sub = null, subSum = 0, chSum = 0, first = true;
    const pushSub = () => { if (sub != null) rows.push({ el: h('tr', { class: 'sum' }, h('td', { colspan: 5 }, `סה"כ ${sub} ${secs.get(`${key}.${sub}`)?.name ?? ''}`), h('td', { class: 'nm' }, cash(subSum))), struct: st, chapter: ch, reset: true }); };
    for (const it of items.filter((i) => i.struct === st && i.chapter === ch)) {
      if (it.sub !== sub) {
        pushSub(); sub = it.sub; subSum = 0;
        rows.push({ el: h('tr', { class: 'sh' }, h('td', { class: 'cd' }, `${ch}.${it.sub}`), h('td', { colspan: 5 }, secs.get(`${key}.${it.sub}`)?.name ?? '')), struct: st, chapter: ch, breakBefore: first });
        first = false;
      }
      const a = isBillable(it) ? lineCents(it.qty, it.price) : 0;
      subSum += a; chSum += a;
      rows.push({ el: it.kind === 'note' ? h('tr', { class: 'note' }, h('td', {}), h('td', { colspan: 5 }, it.description))
        : h('tr', {}, h('td', { class: 'cd' }, itemCode(it).slice(3)), h('td', {}, it.description), h('td', {}, it.unit), h('td', { class: 'nm' }, qty(it.qty)), h('td', { class: 'nm' }, qty(it.price)), h('td', { class: 'nm' }, cash(a))),
      amount: a, struct: st, chapter: ch });
    }
    pushSub();
    rows.push({ el: h('tr', { class: 'sum chap' }, h('td', { colspan: 5 }, `סה"כ פרק ${ch} ${secs.get(key)?.name ?? ''}`), h('td', { class: 'nm' }, cash(chSum))), struct: st, chapter: ch, reset: true });
  }
  const v = contractValue({ contract: c, sections: [...secs.values()], items });
  const vat = pct(v.net, c.vat_rate);
  const L = (label, val, cls = '') => h('tr', { class: cls }, h('td', {}, label), h('td', {}, cash(val)));
  const summary = h('section', { class: 'sheet port' }, head({ ...D, title }),
    h('div', { class: 's-body' }, h('h2', { style: { textAlign: 'center', margin: '4mm 0 6mm', fontSize: '15px' } }, 'ריכוז'),
      h('table', {}, h('thead', {}, h('tr', {}, ['פרק', 'תאור', 'סכום', isQuote ? '' : 'הנחה', 'נטו'].map((x) => h('th', {}, x)))),
        h('tbody', {}, v.groups.map((g) => h('tr', {}, h('td', { class: 'cd' }, g.key), h('td', {}, g.name), h('td', { class: 'nm' }, cash(g.gross)), h('td', { class: 'nm' }, g.discount ? cash(-g.discount) : ''), h('td', { class: 'nm' }, cash(g.final)))))),
      h('table', { class: 'pay', style: { marginTop: '8mm' } }, h('tbody', {},
        v.general ? L(`הנחה כללית ${v.generalRate}%`, -v.general) : null,
        L('סה"כ לפני מע"מ', v.net, 'b'), L(`מע"מ ${c.vat_rate}%`, vat), L('סה"כ כולל מע"מ', v.net + vat, 'g'))),
      isQuote ? h('div', { style: { marginTop: '8mm', fontSize: '11px' } }, h('b', {}, 'תנאים: '), 'ההצעה בתוקף ל-30 יום. הכמויות משוערות; החיוב לפי מדידה בפועל ובמחירי היחידה שבהצעה.') : null,
      h('div', { class: 'sign' }, h('div', {}, 'חתימה'), h('div', {}, 'אישור הלקוח'))),
    foot());
  queueMicrotask(() => requestAnimationFrame(() => {
    if (rows.length) paginate(root, mk, rows, 5, 6, (x) => `${x.struct}.${x.chapter}`);
    root.append(summary);
    const sheets = [...root.querySelectorAll('.sheet')];
    sheets.forEach((s, i) => { const pg = s.querySelector('.pg'); if (pg) pg.textContent = `עמוד ${i + 1} מתוך ${sheets.length}`; });
  }));
  return wrap;
}
