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
  // Fills every page: headings stay with the row after them, and a long row (r.split) is
  // divided between pages — the first part of the text here, the rest with the numbers next page.
  let page = mkSheet(rows[0]), running = 0, group = null;
  root.append(page.sheet);
  const carryRow = (label, v) => h('tr', { class: 'carry' }, h('td', { colspan: carryCols }, label), h('td', { class: 'nm' }, cash(v)), totalCols > carryCols + 1 ? h('td', { colspan: totalCols - carryCols - 1 }) : null);
  const fits = () => page.tbody.closest('table').offsetHeight <= page.body.clientHeight + 1;
  const fitsWithCarry = () => { const pr = carryRow('להעברה', running); page.tbody.append(pr); const ok = fits(); pr.remove(); return ok; };
  const newPage = (r, el) => {
    const moving = [el];
    while (page.tbody.lastElementChild?._keep && page.tbody.children.length > 1) { const k = page.tbody.lastElementChild; k.remove(); moving.unshift(k); }
    if (running) page.tbody.append(carryRow('להעברה', running));
    page = mkSheet(r); root.append(page.sheet);
    if (running) page.tbody.append(carryRow('מהעברה', running));
    moving.forEach((m) => page.tbody.append(m));
  };
  for (const r of rows) {
    const g = groupKey(r);
    if (g !== group) running = 0;
    group = g;
    r.el._keep = !!r.keep;
    page.tbody.append(r.el);
    if (!fitsWithCarry() && page.tbody.children.length > 1) {
      r.el.remove();
      let done = false;
      if (r.split) {
        // largest word count of the first part that still fits on this page
        const words = r.words;
        let lo = 1, hi = words.length - 1, best = 0;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          const part = r.split(words.slice(0, mid).join(' '), false);
          page.tbody.append(part);
          const ok = fitsWithCarry();
          part.remove();
          if (ok) { best = mid; lo = mid + 1; } else hi = mid - 1;
        }
        if (best >= 3) {
          page.tbody.append(r.split(words.slice(0, best).join(' '), false));
          r.el = r.split(words.slice(best).join(' '), true);
          newPage(r, r.el); done = true;
        }
      }
      if (!done) newPage(r, r.el);
    }
    if (r.reset) running = 0;
    running += r.amount ?? 0;
  }
  const sheets = [...root.querySelectorAll('.sheet')];
  sheets.forEach((sh, i) => { const p = sh.querySelector('.pg'); if (p) p.textContent = `עמוד ${i + 1} מתוך ${sheets.length}`; });
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
export function boqPrintView(ctx, cid, revId = null) {
  const api = ctx.api;
  // a revision prints the frozen copy that was sent, not the live quote
  const rev = revId ? api.revision(+revId) : null;
  const c = rev ? rev.snapshot.contract : api.contract(cid);
  const p = api.project(c.project_id);
  const co = api.company();
  const isQuote = c.kind === 'quote';
  const secs = new Map((rev ? rev.snapshot.sections : api.sections(cid)).map((s) => [s.code, s]));
  const items = (rev ? rev.snapshot.items : api.items(cid)).filter((i) => i.kind === 'note' || i.change_status !== 'rejected');
  const D = { issuer: co.name, contact: [co.phone, co.email, co.vat_id && `ח.פ ${co.vat_id}`].filter(Boolean).join(' · '), recipient: rev?.recipient || c.party,
    project: p.name, number: (isQuote ? `הצעה ${c.number || ''}` : `חוזה ${c.number || ''}`).trim() + (rev ? ` · מהדורה ${rev.rev}` : ''), date: (rev ? rev.created_at : new Date().toISOString()).slice(0, 10) };
  const title = (isQuote ? `הצעת מחיר — ${c.name}` : `כתב כמויות — ${c.name}`) + (rev ? ` (מהדורה ${rev.rev})` : '');
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
  let lastStruct = null;
  for (const key of chapters) {
    const [st, ch] = key.split('.');
    if (st !== lastStruct) {
      lastStruct = st;
      rows.push({ el: h('tr', { class: 'sh st' }, h('td', { class: 'cd' }, st), h('td', { colspan: 5 }, `מבנה ${+st} ${secs.get(st)?.name ?? ''}`)), struct: st, chapter: ch, keep: true });
    }
    let sub = null, subSum = 0, chSum = 0, first = true;
    const pushSub = () => { if (sub != null) rows.push({ el: h('tr', { class: 'sum' }, h('td', { colspan: 5 }, `סה"כ ${sub} ${secs.get(`${key}.${sub}`)?.name ?? ''}`), h('td', { class: 'nm' }, cash(subSum))), struct: st, chapter: ch, reset: true }); };
    for (const it of items.filter((i) => i.struct === st && i.chapter === ch)) {
      if (it.sub !== sub) {
        pushSub(); sub = it.sub; subSum = 0;
        rows.push({ el: h('tr', { class: 'sh' }, h('td', { class: 'cd' }, `${ch}.${it.sub}`), h('td', { colspan: 5 }, secs.get(`${key}.${it.sub}`)?.name ?? '')), struct: st, chapter: ch, keep: true });
        first = false;
      }
      const a = isBillable(it) ? lineCents(it.qty, it.price) : 0;
      subSum += a; chSum += a;
      const mkRow = (text, full) => (it.kind === 'note'
        ? h('tr', { class: 'note' }, h('td', {}), h('td', { colspan: 5 }, text))
        : h('tr', {}, h('td', { class: 'cd' }, full === 'first' || full === undefined ? itemCode(it).slice(3) : ''), h('td', {}, text), h('td', {}, full !== false ? it.unit : ''),
          h('td', { class: 'nm' }, full !== false ? qty(it.qty) : ''), h('td', { class: 'nm' }, full !== false ? qty(it.price) : ''), h('td', { class: 'nm' }, full !== false ? cash(a) : '')));
      rows.push({ el: mkRow(it.description), amount: a, struct: st, chapter: ch, words: it.description.split(' '),
        split: (text, isLast) => { const r = mkRow(text, isLast ? true : false); if (!isLast) r.querySelector('td.cd') && (r.querySelector('td.cd').textContent = itemCode(it).slice(3)); return r; } });
    }
    pushSub();
    rows.push({ el: h('tr', { class: 'sum chap' }, h('td', { colspan: 5 }, `סה"כ פרק ${ch} ${secs.get(key)?.name ?? ''}`), h('td', { class: 'nm' }, cash(chSum))), struct: st, chapter: ch, reset: true });
  }
  const v = contractValue({ contract: c, sections: [...secs.values()], items });
  const vat = pct(v.net, c.vat_rate);
  const L = (label, val, cls = '') => h('tr', { class: cls }, h('td', {}, label), h('td', {}, cash(val)));
  const summary = h('section', { class: 'sheet port' }, head({ ...D, title }),
    h('div', { class: 's-body' }, h('h2', { style: { textAlign: 'center', margin: '4mm 0 6mm', fontSize: '15px' } }, 'ריכוז'),
      h('table', {}, h('thead', {}, h('tr', {}, ['פרק', 'תאור', 'סכום', 'הנחה', 'נטו'].map((x) => h('th', {}, x)))),
        h('tbody', {}, v.groups.map((g) => h('tr', {}, h('td', { class: 'cd' }, g.key), h('td', {}, g.name), h('td', { class: 'nm' }, cash(g.gross)), h('td', { class: 'nm' }, g.discount ? cash(-g.discount) : ''), h('td', { class: 'nm' }, cash(g.net)))))),
      h('table', { class: 'pay', style: { marginTop: '8mm' } }, h('tbody', {},
        v.chapterDiscount || v.structs?.length ? L('סה"כ אחרי הנחות מבנים / פרקים / תתי-פרקים', v.beforeGeneral) : null,
        v.general ? L(`הנחה כללית על הפרויקט ${String(v.generalRate).replace(/\.0+$/, '')}%`, -v.general) : null,
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
