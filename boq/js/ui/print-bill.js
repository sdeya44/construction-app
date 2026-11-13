// Bill document in the layout of Binarit's "חשבון חלקי" output (verified against bills 6 and 7,
// Hanaton): landscape detail pages with full-height column rules, carry rows per subchapter,
// chapter totals pinned to the page bottom, a concentration (ריכוז) section and a payment summary.
import { h, dateLabel, toast } from './dom.js';
import { money, fixed, divRound, dec } from '../money.js';
import { INDEX_SERIES } from '../schema.js';
import { printPdf } from '../persist.js';
import { periodTotals, discountLines } from '../engine.js';

const n2 = (v) => { const x = Number(v); return x ? x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''; };
const q2 = (v) => (Number(v) ? n2(v) : '');
const cash = (c) => (Number(c) / 100 || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const code = (x) => `${x.chapter}.${+x.sub}.${String(x.num).padStart(3, '0')}`;
const pageNo = (i) => String(i).padStart(3, '0');
const execPct = (cum, cq) => { const c = fixed(cq); if (c <= 0n) return ''; return n2(dec(divRound(fixed(cum) * 1000000n, c))); };

const DETAIL_COLS = [['סעיף', 6.3], ['תאור', 26.7], ['יחידה', 5], ['כמות חוזה', 8.6], ['% ביצוע', 5.8], ['מצטבר קודם', 10.4], ['כמות נוכחית', 8.6], ['כמות\nמצטברת', 8.6], ['מחיר יחידה', 9.6], ['סה"כ מצטבר', 10.4]];
// monthly (non-cumulative) bill: only this month's quantity and amount
const DETAIL_COLS_P = [['סעיף', 6.3], ['תאור', 43.7], ['יחידה', 5], ['כמות חוזה', 9], ['כמות החודש', 10], ['מחיר יחידה', 11], ['סה"כ לחודש', 15]];
const CONC_COLS = [['', 45], ['סכום מצטבר\nתת פרק', 18.3], ['סכום מצטבר\nפרק', 18.3], ['סכום מצטבר\nמבנה', 18.4]];

export function billPrintView(ctx, bid, mount) {
  const api = ctx.api;
  const b = api.bill(bid);
  const c = api.contract(b.contract_id);
  const p = api.project(c.project_id);
  const co = api.company();
  const r = api.calc(bid);
  const pv = b.doc?.view === 'period';
  const V = pv ? periodTotals(r, api.prevApproved(c.id, b.number), c.mode === 'periodic') : null;
  const COLS = pv ? DETAIL_COLS_P : DETAIL_COLS;
  const ROWS = pv ? V.rows.filter((x) => x.curQ !== '0').map((x) => ({ ...x, amount: x.pAmount })) : r.rows;
  const GROUPS = pv ? V.groups : r.totals.groups;
  const secs = new Map((r.frozen?.sections ?? api.sections(c.id)).map((s) => [s.code, s]));
  const secName = (k) => secs.get(k)?.name ?? '';
  const D = {
    issuer: b.doc.issuer || (c.kind === 'sub' ? c.party : co.name),
    contact: b.doc.contact || [co.email, co.phone && `נייד: ${co.phone}`].filter(Boolean).join(' '),
    project: b.doc.projectTitle || p.name,
    title: `${b.type === 'final' ? 'חשבון סופי' : 'חשבון חלקי'} מס. ${b.doc.displayNumber || b.number}${pv ? ' — חודשי' : ''}`,
    date: dateLabel(b.doc.date || b.created_at.slice(0, 10)),
    file: p.name.split(' ')[0],
  };
  const companyLine = `${co.name}  ${[co.email, co.phone && `נייד: ${co.phone}`].filter(Boolean).join(' ')}`.trim();

  const root = h('div', { class: 'print-root bn' });
  const wrap = h('div', {},
    h('div', { class: 'print-bar no-print' },
      h('button', { onclick: () => ctx.go(`b/${bid}`) }, '→ חזרה'),
      h('button', { class: 'primary', onclick: async () => { try { await printPdf(`${D.project} - ${D.title}.pdf`); } catch (e) { toast(e.message, 'err'); } } }, 'שמירה כ-PDF / הדפסה'),
      h('span', { class: 'muted' }, `${D.title} · ${b.status === 'approved' ? 'מאושר' : 'טיוטה — טרם אושר'}`)),
    root);
  mount.append(wrap); // pagination measures real layout, so build inside the live document

  let pageCount = 0;
  const sheet = ({ first = false, issuer = false, conc = false, sub = [] } = {}) => {
    pageCount++;
    const pg = h('div', { class: 'bn-pg' });
    // only the cumulative bill is landscape; the monthly bill has 7 columns and prints portrait
    const s = h('section', { class: `sheet ${pv ? 'port' : 'land'} bn-sheet` },
      h('header', { class: `bn-head ${issuer ? '' : 'noiss'}` },
        h('div', { class: 'bn-left' }, h('div', {}, D.date), h('div', { class: 'bn-pgl' }, h('span', {}, "דף מס':"), pg)),
        h('div', { class: 'bn-right' },
          issuer ? h('div', { class: 'bn-issuer' }, h('div', {}, D.issuer), h('div', {}, D.contact)) : null,
          h('div', { class: 'bn-project' }, D.project), ...sub.map((t) => h('div', {}, t))),
        first ? h('h1', { class: 'bn-title' }, conc ? `${D.title}  (ריכוז)` : D.title) : null),
      h('div', { class: 'bn-body' }),
      h('div', { class: 'bn-company' }),
      h('footer', { class: 'bn-foot' }, h('span', {}, 'הופק באמצעות KAYAN BOQ'), h('span', { class: 'bn-file' })));
    root.append(s);
    return { s, body: s.querySelector('.bn-body'), pg, company: s.querySelector('.bn-company') };
  };
  const table = (cols, body) => {
    const tb = h('tbody');
    const t = h('table', { class: 'bn-t' }, h('colgroup', {}, cols.map(([, w]) => h('col', { style: { width: `${w}%` } }))),
      h('thead', {}, h('tr', {}, cols.map(([l]) => h('th', {}, l)))), tb);
    body.append(t);
    return tb;
  };
  const tableH = (pg) => [...pg.body.children].reduce((a, e) => a + e.offsetHeight, 0);
  const fits = (pg) => tableH(pg) <= pg.body.clientHeight + 0.5;
  const filler = (n) => h('tr', { class: 'bn-fill' }, Array.from({ length: n }, () => h('td')));
  const stretch = (pg, tb, before, n) => {
    const f = filler(n);
    tb.insertBefore(f, before ?? null);
    const gap = pg.body.clientHeight - tableH(pg);
    if (gap > 0) f.firstChild.style.height = `${gap}px`; else f.remove();
  };

  // ---------------- detail pages ----------------
  const NC = COLS.length;
  const span = (label, amount, cls) => h('tr', { class: cls }, h('td', { colspan: NC - 1, class: 'lab' }, label), h('td', { class: 'nm' }, amount == null ? '' : cash(amount)));
  const head = (t) => h('tr', { class: 'bn-h' }, h('td'), h('td', {}, h('span', {}, t)), ...Array.from({ length: NC - 2 }, () => h('td')));
  const rowsBy = new Map();
  for (const x of ROWS) {
    if (!pv && x.amount === 0 && x.cumQ === '0' && x.prevQ === '0') continue;
    const k = `${x.struct}.${x.chapter}`;
    if (!rowsBy.has(k)) rowsBy.set(k, []);
    rowsBy.get(k).push(x);
  }
  for (const g of GROUPS) {
    const list = rowsBy.get(g.key);
    if (!list?.length) continue;
    const sub = [`מבנה ${+g.struct} ${secName(g.struct)}`, `פרק ${g.chapter} ${g.name}`];
    let pg = sheet({ first: pageCount === 0, issuer: pageCount === 0, sub });
    let tb = table(COLS, pg.body);
    let running = 0;
    let open = false; // inside a subchapter whose subtotal has not been printed yet
    const add = (el, keepWithNext = false) => {
      el._keep = keepWithNext;
      tb.append(el);
      const probe = open ? span('', 0, 'bn-carry') : null;
      if (probe) tb.append(probe);
      const ok = fits(pg);
      probe?.remove();
      if (ok || tb.children.length <= 1) return;
      // move this row — and any heading rows that must stay with it — to the next page
      const moving = [el];
      el.remove();
      while (tb.lastElementChild?._keep && tb.children.length > 1) { const k = tb.lastElementChild; moving.unshift(k); k.remove(); }
      const carrying = open && running !== 0 && !moving.some((m) => m._startsSub);
      const carry = carrying ? span(`להעברה בתת פרק ${+g.struct}.${g.chapter}.${+cur}`, running, 'bn-carry') : null;
      if (carry) tb.append(carry);
      stretch(pg, tb, carry, NC);
      pg = sheet({ sub });
      tb = table(COLS, pg.body);
      if (carrying) tb.append(h('tr', { class: 'bn-from' }, h('td'), h('td', {}, 'מהעברה'), ...Array.from({ length: NC - 3 }, () => h('td')), h('td', { class: 'nm' }, cash(running))));
      moving.forEach((m) => tb.append(m));
    };
    let cur = null, subSum = 0;
    add(head(`פרק ${g.chapter} ${g.name}`), true);
    const closeSub = () => { if (cur != null) { add(span(`סה"כ ${g.chapter}.${+cur} ${secName(`${g.key}.${cur}`)}`, subSum, 'bn-sum')); open = false; running = 0; } };
    for (const x of list) {
      if (x.sub !== cur) {
        closeSub(); cur = x.sub; subSum = 0; running = 0;
        const hd = head(`תת פרק ${g.chapter}.${+cur} ${secName(`${g.key}.${cur}`)}`); hd._startsSub = true;
        add(hd, true); open = true;
      }
      const tr = pv ? h('tr', { class: 'bn-item' },
        h('td', { class: 'cd' }, code(x)), h('td', { class: 'ds' }, x.description), h('td', { class: 'un' }, x.unit),
        h('td', { class: 'nm' }, q2(x.contractQty)), h('td', { class: 'nm' }, q2(x.curQ)),
        h('td', { class: 'nm' }, n2(x.price)), h('td', { class: 'nm' }, cash(x.amount)))
        : h('tr', { class: 'bn-item' },
          h('td', { class: 'cd' }, code(x)), h('td', { class: 'ds' }, x.description), h('td', { class: 'un' }, x.unit),
          h('td', { class: 'nm' }, q2(x.contractQty)), h('td', { class: 'nm' }, execPct(x.cumQ, x.contractQty)),
          h('td', { class: 'nm' }, q2(x.prevQ)), h('td', { class: 'nm' }, q2(x.curQ)), h('td', { class: 'nm' }, q2(x.cumQ)),
          h('td', { class: 'nm' }, n2(x.price)), h('td', { class: 'nm' }, cash(x.amount)));
      add(tr);
      running += x.amount; subSum += x.amount;
    }
    closeSub();
    // chapter total block pinned to the bottom of the page
    const end = [span(`סה"כ ${g.chapter} ${g.name}`, g.gross, 'bn-end bn-end-first')];
    if (g.discount) {
      // a chapter-only discount prints exactly as Binarit does; sub / structure discounts add their own lines
      for (const d of discountLines(g, cash)) end.push(d.kind === 'chapter'
        ? span(h('span', {}, `הנחה  ${n2(g.rate).replace(/\.00$/, '')}%  מסך `, h('b', {}, cash(g.chapterBase ?? g.gross))), -d.amount, 'bn-end')
        : span(d.label, -d.amount, 'bn-end'));
      end.push(span(`סה"כ ${g.chapter} (לאחר הנחה)`, g.net, 'bn-end'));
    }
    end.forEach((e) => tb.append(e));
    if (!fits(pg)) {
      end.forEach((e) => e.remove());
      stretch(pg, tb, null, NC);
      pg = sheet({ sub }); tb = table(COLS, pg.body);
      end.forEach((e) => tb.append(e));
    }
    stretch(pg, tb, end[0], NC);
    pg.company.textContent = companyLine;
  }

  // ---------------- concentration (ריכוז) ----------------
  const T = pv ? V.T : r.totals;
  const cRow = (label, col, amount, cls = '') => h('tr', { class: cls }, h('td', { class: 'lab' }, label),
    ...[1, 2, 3].map((i) => h('td', { class: 'nm' }, i === col ? cash(amount) : '')));
  const concRows = [];
  const structs = [...new Set(T.groups.map((g) => g.struct))];
  const live = (g) => g.gross !== 0 || (rowsBy.get(g.key)?.length ?? 0) > 0;
  for (const s of structs) {
    if (!T.groups.some((x) => x.struct === s && live(x))) continue;
    concRows.push(cRow(`מבנה ${+s} ${secName(s)}`, 0, 0, 'bn-c-gap'));
    let sTotal = 0;
    for (const g of T.groups.filter((x) => x.struct === s && live(x))) {
      concRows.push(cRow(`פרק ${g.chapter} ${g.name}`, 0, 0, 'bn-c-gap'));
      for (const [subCode, amt] of Object.entries(g.subs).sort()) if (amt) concRows.push(cRow(` תת פרק ${g.chapter}.${+subCode} ${secName(`${g.key}.${subCode}`)}`, 1, amt, 'bn-c-gap'));
      concRows.push(g.discount
        ? (discountLines(g).length === 1 && g.chapterDisc
          ? cRow(h('span', {}, `סה"כ ${g.chapter}  לאחר הנחה  ${n2(g.rate).replace(/\.00$/, '')}%  מסך  ${cash(g.gross)}`), 2, g.net, 'bn-c-chap')
          : cRow(`סה"כ ${g.chapter}  לאחר הנחות (${discountLines(g, cash).map((d) => d.kind === 'chapter' ? `פרק ${n2(g.rate).replace(/\.00$/, '')}%` : d.kind === 'sub' ? 'תת פרק' : `מבנה ${n2(g.structRate).replace(/\.00$/, '')}%`).join(', ')})  מסך  ${cash(g.gross)}`, 2, g.net, 'bn-c-chap'))
        : cRow(`סה"כ ${g.chapter} ${g.name}`, 2, g.net, 'bn-c-chap'));
      sTotal += g.net;
    }
    concRows.push(cRow(`סה"כ ${+s} ${secName(s)}`, 3, sTotal, 'bn-c-struct'));
  }
  {
    let pg = sheet({ first: true, conc: true });
    let tb = table(pv ? CONC_COLS.map(([l, w]) => [l.replace('מצטבר', 'לחודש'), w]) : CONC_COLS, pg.body);
    for (const el of concRows) {
      tb.append(el);
      if (!fits(pg) && tb.children.length > 1) {
        el.remove(); stretch(pg, tb, null, 4); pg.company.textContent = companyLine;
        pg = sheet({}); tb = table(pv ? CONC_COLS.map(([l, w]) => [l.replace('מצטבר', 'לחודש'), w]) : CONC_COLS, pg.body); tb.append(el);
      }
    }
    stretch(pg, tb, null, 4);
    pg.company.textContent = companyLine;
  }
  // general discount
  {
    const pg = sheet({});
    const rows = [];
    const g = (label, amount, cls = '') => h('tr', { class: cls }, h('td', { class: 'lab' }, label), h('td', { class: 'nm' }, cash(amount)));
    if (T.exempt) {
      rows.push(g('סכום לחישוב הנחה כללית', T.eligible), g(`הנחה כללית ${n2(T.generalRate).replace(/0$/, '')}%`, -T.general), g('לאחר הנחה', T.eligible - T.general),
        g('ועוד סכום ללא הנחה', T.exempt), g('סה"כ כללי', T.net, 'bn-g-total'));
    } else {
      rows.push(g('סכום לחישוב הנחה/תוספת', T.beforeGeneral), g(`הנחה כללית ${n2(T.generalRate).replace(/0$/, '')}%`, -T.general), g('סה"כ כללי', T.net, 'bn-g-total'));
    }
    pg.body.append(h('table', { class: 'bn-gen' }, h('colgroup', {}, h('col', { style: { width: '57%' } }), h('col', { style: { width: '43%' } })),
      h('thead', {}, h('tr', {}, h('th'), h('th', {}, pv ? 'סה"כ לחודש' : 'סה"כ מצטבר'))), h('tbody', {}, rows)));
    pg.body.classList.add('bn-short');
    pg.company.textContent = companyLine;
    pg.body.after(pg.company);
  }
  // payment summary
  {
    const pg = sheet({ first: true, conc: true });
    pg.s.classList.add('bn-summary');
    const planned = c.planned_cents || null;
    const ix = r.indexation;
    const L = (label, v, sign = '', cls = '') => h('tr', { class: cls }, h('td', { class: 'lab' }, label), h('td', { class: 'nm' }, cash(v)), h('td', { class: 'sg' }, sign));
    const rows = [
      ...(pv ? [
        V.cat.extra || V.cat.over ? [L('עבודות לפי כמות חוזה (החודש)', V.cat.contract), L('עבודות מעל כמות חוזה (החודש)', V.cat.over), L('עבודות נוספות (החודש)', V.cat.extra)] : null,
        L('ביצוע בחודש זה במחירי בסיס', r.periodNet, '', 'ul')] : [
        r.totals.cat.extra || r.totals.cat.over ? [L('עבודות לפי כמות חוזה', T.cat.contract), L('עבודות מעל כמות חוזה', T.cat.over), L('עבודות נוספות', T.cat.extra)] : null,
        L('מצטבר מחושב במחירי בסיס', r.cumNet),
        L('פחות חשבון קודם', r.prevNet, '(-)', 'ul')]),
      ix.amount ? L(`התייקרות${ix.current ? ` (${INDEX_SERIES[c.index_series]} ${ix.current}/${ix.base})` : ''}`, ix.amount, '(+)') : null,
      r.retention ? L(`עיכבון ${n2(r.retentionRate)}%`, r.retention, '(-)') : null,
      r.release ? L('שחרור עיכבון', r.release, '(+)') : null,
      r.advance ? L('קיזוז מקדמה', r.advance, '(-)') : null,
      r.materials ? L('קיזוז חומרים / רכש', r.materials, '(-)') : null,
      r.other ? L(r.otherLabel, r.other, '(-)') : null,
      L('סה"כ לפני מע"מ', r.beforeVat),
      L(`${Number(r.vatRate).toFixed(1)}% מע"מ`, r.vat, '(+)', 'ul'),
      L('סכום לתשלום בחשבון זה', r.due, '', 'bn-due'),
    ];
    const pct = planned ? ` (${((r.cumNet / planned) * 100).toFixed(1)}%)` : '';
    pg.body.append(...[
      h('div', { class: 'bn-scope' }, planned ? `היקף עבודה מתוכנן: ${cash(planned)}    ` : '', `ביצוע: ${cash(r.cumNet)}${pct}`),
      h('table', { class: 'bn-pay' }, h('colgroup', {}, h('col', { style: { width: '62%' } }), h('col', { style: { width: '22%' } }), h('col', { style: { width: '16%' } })), h('tbody', {}, rows)),
      h('p', { class: 'bn-note' }, `הפרש לתשלום מח-ן קודמים ${cash(r.prevNet)}`),
      h('p', { class: 'bn-note' }, `סה"כ לתשלום כולל ח-ן זה ${cash(r.cumNet)}  נכון לתאריך ${D.date}  לא כולל הצמדות, ריביות ומע"מ.`),
      b.doc.note ? h('p', { class: 'bn-note' }, b.doc.note) : null].filter(Boolean));
    pg.body.classList.add('bn-short');
    pg.company.classList.add('bn-company-rule');
    pg.company.textContent = companyLine;
    pg.company.after(h('div', { class: 'bn-sign' }, h('div', {}, 'שם,  חתימה  וחותמת הקבלן'), h('div', {}, 'תאריך')));
  }
  // page numbers ("דף מס'" on top, "קובץ: …/NNN" = next page, as Binarit prints it)
  const sheets = [...root.querySelectorAll('.bn-sheet')];
  sheets.forEach((s, i) => {
    s.querySelector('.bn-pg').textContent = pageNo(i + 1);
    s.querySelector('.bn-file').textContent = i < sheets.length - 1 ? `קובץ: ${D.file}  .../${pageNo(i + 2)}` : `קובץ: ${D.file}`;
  });
  return wrap;
}

/** Route entry: mount first, then build (layout must exist to paginate). */
export function billPrintRoute(ctx, bid) {
  const host = h('div', {}, h('div', { class: 'empty' }, 'מכין מסמך…'));
  requestAnimationFrame(() => {
    try { host.replaceChildren(); billPrintView(ctx, bid, host); }
    catch (e) { console.error(e); host.replaceChildren(h('div', { class: 'page' }, h('div', { class: 'alert err' }, e.message))); }
  });
  return host;
}
