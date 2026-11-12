// Bills: list per contract, execution grid, summary/adjustments, payments.
import { h, formModal, modal, attempt, confirmBox, toast, monthLabel, dateLabel } from './dom.js';
import { money, qty, lineCents } from '../money.js';
import { itemCode } from '../engine.js';
import { STATUS, KIND } from './projects.js';
import { INDEX_SERIES } from '../schema.js';

const BASIS = { calc: 'מחושבת', sub: 'מוגשת', appr: 'מאושרת' };
const billTag = (b) => {
  const paid = b.status === 'approved' && b.snap && b.paid >= b.snap.due && b.snap.due > 0;
  return h('span', { class: `tag ${paid ? 'paid' : b.status}` }, paid ? 'נפרע' : STATUS[b.status]);
};

export function billsView(ctx, cid) {
  const api = ctx.api;
  const c = api.contract(cid);
  const bills = api.bills(cid);
  const v = api.contractValue(cid);
  const lastAppr = [...bills].reverse().find((b) => b.status === 'approved');
  const paid = bills.reduce((s, b) => s + b.paid, 0);
  const dueAll = bills.filter((b) => b.status === 'approved').reduce((s, b) => s + b.snap.due, 0);
  const newBill = () => {
    const last = bills.at(-1);
    const nextMonth = last ? last.month : new Date().toISOString().slice(0, 7);
    formModal('פתיחת חשבון', [
      { name: 'month', label: 'חודש ביצוע', type: 'month', value: nextMonth, required: true },
      { name: 'type', label: 'סוג', type: 'select', value: 'partial', options: [['partial', 'חשבון חלקי'], ['final', 'חשבון סופי']] },
    ], (val) => { const id = api.createBill(cid, val); ctx.go(`b/${id}`); }, {
      intro: c.mode === 'cumulative' && lastAppr ? h('p', { class: 'muted' }, `הכמויות ייפתחו מהמצטבר של חשבון ${lastAppr.number}. עדכן רק סעיפים שהתקדמו.`) : null,
    });
  };
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, `חשבונות — ${c.name}`), h('div', { class: 'sub' }, [KIND[c.kind], c.party, c.mode === 'periodic' ? 'תקופתי' : 'מצטבר'].filter(Boolean).join(' · '))),
      h('div', { class: 'actions' }, h('button', { onclick: () => ctx.go(`c/${cid}`) }, 'כתב כמויות'),
        h('button', { class: 'primary', disabled: c.status === 'closed', onclick: () => attempt(newBill) }, '+ חשבון חדש'))),
    h('div', { class: 'kpis' },
      h('div', { class: 'kpi' }, h('div', { class: 'l' }, 'היקף חוזה (אחרי הנחות)'), h('div', { class: 'v' }, money(v.net))),
      h('div', { class: 'kpi accent' }, h('div', { class: 'l' }, 'מצטבר מאושר'), h('div', { class: 'v' }, money(lastAppr?.snap.cumNet ?? 0))),
      h('div', { class: 'kpi' }, h('div', { class: 'l' }, 'ביצוע מההיקף'), h('div', { class: 'v' }, v.net ? `${(((lastAppr?.snap.cumNet ?? 0) / v.net) * 100).toFixed(1)}%` : '—')),
      h('div', { class: 'kpi' }, h('div', { class: 'l' }, 'עיכבון מצטבר'), h('div', { class: 'v' }, money(lastAppr?.snap.cumRetention ?? 0))),
      h('div', { class: 'kpi' }, h('div', { class: 'l' }, 'לתשלום כולל מע"מ (מאושר)'), h('div', { class: 'v' }, money(dueAll))),
      h('div', { class: 'kpi' }, h('div', { class: 'l' }, 'יתרה פתוחה'), h('div', { class: 'v' }, money(dueAll - paid)))),
    h('div', { class: 'card' }, bills.length ? h('div', { class: 'table-wrap' }, h('table', { class: 't' },
      h('thead', {}, h('tr', {}, ['מס׳', 'חודש ביצוע', 'סוג', 'סטטוס', 'מצטבר נטו', 'ביצוע לתקופה', 'התייקרות', 'לפני מע"מ', 'לתשלום', 'שולם', 'יתרה'].map((x, i) => h('th', { class: i >= 4 ? 'n' : '' }, x)))),
      h('tbody', {}, bills.map((b) => {
        let r; try { r = b.snap ?? api.calc(b.id); } catch (e) { r = null; }
        return h('tr', { class: 'click', onclick: () => ctx.go(`b/${b.id}`) },
          h('td', {}, h('b', {}, b.number)), h('td', {}, monthLabel(b.month)), h('td', {}, b.type === 'final' ? 'סופי' : 'חלקי'), h('td', {}, billTag(b)),
          h('td', { class: 'n' }, r ? money(r.cumNet) : '!'), h('td', { class: 'n' }, r ? money(r.periodNet) : ''), h('td', { class: 'n' }, r ? money(r.indexation.amount) : ''),
          h('td', { class: 'n' }, r ? money(r.beforeVat) : ''), h('td', { class: 'n' }, r ? h('b', {}, money(r.due)) : ''),
          h('td', { class: 'n' }, b.paid ? money(b.paid) : ''), h('td', { class: 'n' }, b.status === 'approved' ? money(r.due - b.paid) : ''));
      })))) : h('div', { class: 'empty' }, h('b', {}, 'אין חשבונות'), c.status === 'closed' ? 'החוזה סגור.' : 'פתח חשבון חלקי ראשון.')));
}

// ---------------------------------------------------------------------------------------------
export function billView(ctx, bid, tab) {
  const api = ctx.api;
  const b = api.bill(bid);
  const c = api.contract(b.contract_id);
  const editable = b.status === 'draft';
  const apprEditable = b.status === 'draft' || b.status === 'submitted';
  let r;
  try { r = api.calc(bid); } catch (e) { return h('div', { class: 'page' }, h('div', { class: 'alert err' }, e.message)); }

  const head = h('div', { class: 'toolbar', style: { borderBottom: '1px solid var(--line)' } },
    h('h2', {}, `חשבון ${b.type === 'final' ? 'סופי' : 'חלקי'} ${b.number}`), h('span', { class: 'muted' }, `ביצוע ${monthLabel(b.month)} · ${c.name}`), billTag(b),
    h('div', { class: 'grow' }),
    editable ? h('button', { onclick: () => attempt(() => { api.submitBill(bid); ctx.refresh(); }, 'החשבון הוגש') }, 'הגשה') : null,
    b.status === 'submitted' ? h('button', { onclick: () => attempt(() => { api.returnBill(bid); ctx.refresh(); }) }, 'החזרה להכנה') : null,
    b.status !== 'approved' ? h('button', { class: 'primary', onclick: async () => {
      const basisWarn = b.basis !== 'appr' ? `\n\nשים לב: החשבון מחושב לפי כמות ${BASIS[b.basis]}. אם המזמין אישר כמויות אחרות — עבור לבסיס "מאושרת" לפני האישור.` : '';
      if (await confirmBox('אישור חשבון', `לאשר ולנעול את חשבון ${b.number}?\nלתשלום: ${money(r.due)} ₪\nלאחר האישור לא ניתן לערוך.${basisWarn}`, { ok: 'אישור ונעילה' }))
        attempt(() => { api.approveBill(bid); ctx.refresh(); }, 'החשבון אושר ונעול');
    } }, 'אישור ונעילה') : null,
    b.status !== 'approved' ? h('button', { class: 'danger ghost', onclick: async () => {
      if (await confirmBox('מחיקת חשבון', `למחוק את חשבון ${b.number}?`, { danger: true, ok: 'מחיקה' })) attempt(() => { api.deleteBill(bid); ctx.go(`c/${c.id}/bills`); });
    } }, 'מחיקה') : null,
    h('button', { onclick: () => ctx.go(`b/${bid}/print`) }, 'הפקת חשבון / PDF'));

  const tabs = h('nav', { class: 'tabs no-print' }, [['exec', 'כמויות ביצוע'], ['summary', 'סיכום והתאמות'], ['pay', 'תשלומים']].map(([k, l]) =>
    h('a', { href: `#/b/${bid}/${k}`, class: tab === k ? 'on' : '' }, l)));

  const warn = r.warnings.length ? h('div', { class: 'alert', style: { margin: '10px 14px 0' } }, h('b', {}, `${r.warnings.length} התראות: `),
    h('span', { class: 'pre' }, r.warnings.slice(0, 6).map((w) => w.text).join(' · ')), r.warnings.length > 6 ? ' …' : '') : null;

  let body;
  if (tab === 'summary') body = summaryTab(ctx, b, c, r, editable);
  else if (tab === 'pay') body = paymentsTab(ctx, b, r);
  else body = execTab(ctx, b, c, r, editable, apprEditable);

  return h('div', { class: 'page full' }, h('section', { class: 'center', style: { height: '100%', gridTemplateRows: 'auto auto auto 1fr' } }, head, tabs, warn ?? h('div'), body));
}

function execTab(ctx, b, c, r, editable, apprEditable) {
  const api = ctx.api;
  const periodic = c.mode === 'periodic';
  const lines = api.lines(b.id);
  const items = api.items(c.id).filter((i) => i.kind !== 'note' && (i.kind === 'contract' || i.change_status === 'approved'));
  const rowsById = new Map(r.rows.map((x) => [x.itemId, x]));
  const sections = new Map(api.sections(c.id).map((s) => [s.code, s]));
  let filter = sessionStorage.getItem('exec-filter') || 'all';
  const tbody = h('tbody');
  const cells = new Map();
  const sumBox = h('div', { class: 'statusbar' });

  const drawSum = (res) => {
    sumBox.replaceChildren(
      h('span', {}, `בסיס חישוב: `, h('b', {}, `כמות ${BASIS[b.basis]}`)),
      h('span', {}, `מצטבר ברוטו: `, h('b', {}, money(res.totals.gross))),
      h('span', {}, `מצטבר נטו: `, h('b', {}, money(res.cumNet))),
      h('span', {}, `קודם: `, h('b', {}, money(res.prevNet))),
      h('span', {}, `לתקופה: `, h('b', {}, money(res.periodNet))),
      h('span', {}, `לתשלום כולל מע"מ: `, h('b', {}, money(res.due))));
  };
  drawSum(r);

  const qCols = periodic ? [['q_calc', 'כמות מחושבת לתקופה'], ['q_sub', 'מוגשת לתקופה'], ['q_appr', 'מאושרת לתקופה']]
    : [['q_calc', 'מצטבר מחושב'], ['q_sub', 'מצטבר מוגש'], ['q_appr', 'מצטבר מאושר']];

  const recalc = () => { const res = api.calc(b.id); for (const x of res.rows) { const cs = cells.get(x.itemId); if (cs) { cs.cur.textContent = qty(x.curQ); cs.cum.textContent = qty(x.cumQ); cs.amt.textContent = money(x.amount); cs.tr.classList.toggle('over', x.cat.over !== 0); } } drawSum(res); };

  const input = (it, col, enabled) => {
    const L = lines.get(it.id) ?? {};
    const val = L[col] ?? '';
    if (!enabled) return h('td', { class: 'n locked' }, val === '' ? '' : qty(val));
    const inp = h('input', { class: 'n', value: val, dir: 'ltr', inputmode: 'decimal', 'data-col': col, placeholder: !periodic && rowsById.get(it.id)?.prevQ !== '0' && val === '' ? qty(rowsById.get(it.id).prevQ) : '' });
    inp.addEventListener('change', () => {
      const ok = attempt(() => api.setLine(b.id, it.id, { [col]: inp.value }));
      if (ok === undefined) { inp.value = (api.lines(b.id).get(it.id) ?? {})[col] ?? ''; return; }
      lines.set(it.id, { ...(lines.get(it.id) ?? {}), [col]: inp.value });
      recalc();
    });
    inp.addEventListener('keydown', (e) => {
      if (['Enter', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
        e.preventDefault(); inp.dispatchEvent(new Event('change'));
        const all = [...tbody.querySelectorAll(`input[data-col="${col}"]`)]; const i = all.indexOf(inp);
        all[e.key === 'ArrowUp' ? i - 1 : i + 1]?.focus();
      }
    });
    return h('td', { class: 'edit' }, inp);
  };
  const smallInput = (it, col, placeholder) => {
    const L = lines.get(it.id) ?? {};
    if (!editable) return h('td', { class: 'n locked' }, L[col] ?? '');
    const inp = h('input', { class: 'n', value: L[col] ?? '', placeholder, dir: 'ltr', style: { minWidth: '60px' } });
    inp.addEventListener('change', () => { if (attempt(() => api.setLine(b.id, it.id, { [col]: inp.value })) !== undefined) recalc(); });
    return h('td', { class: 'edit' }, inp);
  };

  const draw = () => {
    tbody.replaceChildren();
    cells.clear();
    let group = '';
    for (const it of items) {
      const x = rowsById.get(it.id);
      if (filter === 'active' && x && x.curQ === '0' && x.cumQ === '0') continue;
      if (filter === 'period' && x && x.curQ === '0') continue;
      if (filter === 'over' && x && x.cat.over === 0) continue;
      const g = `${it.struct}.${it.chapter}`;
      if (g !== group) { group = g; tbody.append(h('tr', { class: 'group' }, h('td', { class: 'code' }, g), h('td', { colspan: 12 }, [sections.get(it.struct)?.name, sections.get(g)?.name].filter(Boolean).join(' · ')))); }
      const cur = h('td', { class: 'n' }, x ? qty(x.curQ) : ''), cum = h('td', { class: 'n' }, x ? qty(x.cumQ) : ''), amt = h('td', { class: 'n' }, x ? money(x.amount) : '');
      const tr = h('tr', { class: x?.cat.over ? 'over' : '' },
        h('td', { class: 'code' }, itemCode(it)), h('td', { class: 'desc', title: it.description }, it.description.length > 110 ? it.description.slice(0, 110) + '…' : it.description), h('td', {}, it.unit),
        h('td', { class: 'n' }, qty(it.qty)), h('td', { class: 'n muted' }, x ? qty(x.prevQ) : ''),
        input(it, 'q_calc', editable), input(it, 'q_sub', editable), input(it, 'q_appr', apprEditable),
        smallInput(it, 'percent', '100'), smallInput(it, 'price', qty(it.price)),
        cur, cum, amt);
      cells.set(it.id, { cur, cum, amt, tr });
      tbody.append(tr);
    }
  };
  draw();

  const basisSel = h('select', { disabled: !editable, onchange: (e) => attempt(() => { api.saveBill(b.id, { basis: e.target.value }); ctx.refresh(); }) },
    Object.entries(BASIS).map(([k, l]) => h('option', { value: k, selected: b.basis === k }, `חישוב לפי כמות ${l}`)));
  const filterSel = h('select', { onchange: (e) => { filter = e.target.value; sessionStorage.setItem('exec-filter', filter); draw(); } },
    [['all', 'כל הסעיפים'], ['active', 'סעיפים עם ביצוע'], ['period', 'התקדמות בתקופה'], ['over', 'חריגה מכמות חוזה']].map(([k, l]) => h('option', { value: k, selected: filter === k }, l)));
  const copyBtn = (from, to, label, enabled) => h('button', { disabled: !enabled, onclick: async () => {
    if (await confirmBox('העתקת כמויות', `להעתיק את כל ${label}?`)) attempt(() => { api.copyColumn(b.id, from, to); ctx.refresh(); });
  } }, label);

  return h('div', { style: { display: 'grid', gridTemplateRows: 'auto 1fr auto', minHeight: 0 } },
    h('div', { class: 'toolbar no-print' }, basisSel, filterSel, h('span', { class: 'sep' }),
      copyBtn('q_calc', 'q_sub', 'מחושבת ← מוגשת', editable), copyBtn('q_sub', 'q_appr', 'מוגשת ← מאושרת', apprEditable),
      h('div', { class: 'grow' }), h('span', { class: 'muted' }, periodic ? 'הזן כמויות לתקופה' : 'הזן כמויות מצטברות (כולל חשבונות קודמים)')),
    h('div', { class: 'grid-area' }, h('table', { class: 't exec' },
      h('thead', {}, h('tr', {}, ['סעיף', 'תיאור', "יח'", 'כמות חוזה', 'מצטבר קודם', ...qCols.map((q) => q[1]), '% תשלום', 'מחיר בחשבון', 'לתקופה', 'מצטבר', periodic ? 'סכום לתקופה' : 'סכום מצטבר'].map((x, i) => h('th', { class: i >= 3 ? 'n' : '' }, x)))),
      tbody)),
    sumBox);
}

function summaryTab(ctx, b, c, r, editable) {
  const api = ctx.api;
  const T = r.totals;
  const line = (label, v, cls = '', note = '') => h('tr', { class: cls }, h('td', { class: 'lab' }, label, note ? h('small', {}, note) : null), h('td', {}, money(v)));
  const ledger = h('table', { class: 'ledger' }, h('tbody', {},
    line('עבודות לפי כמות חוזה', T.cat.contract),
    line('עבודות מעל כמות חוזה', T.cat.over),
    line('עבודות נוספות / חריגים', T.cat.extra),
    T.chapterDiscount ? line('כלול: הנחות פרקים', -T.chapterDiscount, 'minus') : null,
    T.general ? line(`כלול: הנחה כללית ${T.generalRate}%`, -T.general, 'minus', `על ${money(T.eligible)}`) : null,
    line(c.mode === 'periodic' ? 'סה"כ לתקופה (נטו)' : 'מצטבר כללי (נטו)', c.mode === 'periodic' ? r.periodNet : r.cumNet, 'strong'),
    c.mode === 'cumulative' ? line('פחות חשבון קודם', -r.prevNet, 'minus') : null,
    line('ביצוע לתקופה', r.periodNet, 'strong'),
    c.index_rule !== 'none' ? line('התייקרות', r.indexation.amount, '', r.indexation.current ? `${INDEX_SERIES[c.index_series]}: ${r.indexation.current} / בסיס ${r.indexation.base} (${monthLabel(r.indexation.month)})` : '') : null,
    r.retention ? line(`עיכבון ${r.retentionRate}%`, -r.retention, 'minus') : null,
    r.release ? line('שחרור עיכבון', r.release) : null,
    r.advance ? line('קיזוז מקדמה', -r.advance, 'minus') : null,
    r.materials ? line('קיזוז חומרים / רכש', -r.materials, 'minus') : null,
    r.other ? line(r.otherLabel, -r.other, 'minus') : null,
    line('סה"כ לפני מע"מ', r.beforeVat, 'strong'),
    line(`מע"מ ${r.vatRate}%`, r.vat),
    line('לתשלום בחשבון זה', r.due, 'grand')));

  const groups = h('table', { class: 't' }, h('thead', {}, h('tr', {}, ['מבנה.פרק', 'שם', 'ברוטו', 'הנחה', 'הנחה כללית', 'נטו'].map((x, i) => h('th', { class: i >= 2 ? 'n' : '' }, x)))),
    h('tbody', {}, T.groups.map((g) => h('tr', {}, h('td', { class: 'code' }, g.key), h('td', {}, g.name, g.exempt ? h('span', { class: 'tag', style: { marginInlineStart: '6px' } }, 'מוחרג') : null),
      h('td', { class: 'n' }, money(g.gross)), h('td', { class: 'n' }, g.discount ? `${money(g.discount)} (${g.rate}%)` : ''), h('td', { class: 'n' }, g.general ? money(g.general) : ''), h('td', { class: 'n' }, money(g.final)))),
    h('tr', { class: 'total' }, h('td', {}, ''), h('td', {}, 'סה"כ'), h('td', { class: 'n' }, money(T.gross)), h('td', { class: 'n' }, money(T.chapterDiscount)), h('td', { class: 'n' }, money(T.general)), h('td', { class: 'n' }, money(T.net)))));

  const adjForm = () => formModal('התאמות לחשבון', [
    c.index_rule === 'manual' ? { name: 'indexation', label: 'התייקרות (₪)', value: b.adj.indexation ?? '', numeric: true } : null,
    { name: 'retention_rate', label: `עיכבון % (בחוזה: ${c.retention_rate})`, value: b.adj.retention_rate ?? '', numeric: true, placeholder: c.retention_rate },
    { name: 'retention_release', label: 'שחרור עיכבון (₪)', value: b.adj.retention_release ?? '', numeric: true },
    { name: 'advance', label: 'קיזוז מקדמה (₪) — ריק = אוטומטי', value: b.adj.advance ?? '', numeric: true },
    { name: 'materials', label: 'קיזוז חומרים / רכש (₪)', value: b.adj.materials ?? '', numeric: true },
    { name: 'other_label', label: 'הפחתה אחרת — תיאור', value: b.adj.other_label ?? '' },
    { name: 'other', label: 'הפחתה אחרת (₪)', value: b.adj.other ?? '', numeric: true },
    { name: 'vat', label: `מע"מ % (בחוזה: ${c.vat_rate})`, value: b.adj.vat ?? '', numeric: true, placeholder: c.vat_rate },
  ].filter(Boolean), (v) => { api.saveBill(b.id, { adj: v }); ctx.refresh(); });

  const docForm = () => {
    const co = api.company();
    formModal('פרטי מסמך החשבון', [
      { name: 'issuer', label: 'מגיש', value: b.doc.issuer ?? (c.kind === 'sub' ? c.party : co.name) },
      { name: 'recipient', label: 'נמען', value: b.doc.recipient ?? (c.kind === 'sub' ? co.name : c.party) },
      { name: 'projectTitle', label: 'כותרת פרויקט', value: b.doc.projectTitle ?? api.project(c.project_id).name, span: true },
      { name: 'displayNumber', label: 'מספר מודפס', value: b.doc.displayNumber ?? String(b.number) },
      { name: 'date', label: 'תאריך', type: 'date', value: b.doc.date ?? new Date().toISOString().slice(0, 10) },
      { name: 'contact', label: 'פרטי קשר בתחתית', value: b.doc.contact ?? [co.phone, co.email].filter(Boolean).join(' · '), span: true },
      { name: 'note', label: 'הערה במסמך', type: 'textarea', value: b.doc.note ?? '', span: true },
    ], (v) => { api.saveBill(b.id, { doc: v }); ctx.refresh(); });
  };

  return h('div', { class: 'grid-area' }, h('div', { class: 'page' }, h('div', { class: 'grid2' },
    h('div', { class: 'card' }, h('header', {}, h('h2', {}, 'סיכום לתשלום'), h('div', { class: 'actions' },
      h('button', { disabled: !editable, onclick: () => attempt(adjForm) }, 'התאמות'), h('button', { disabled: !editable, onclick: docForm }, 'פרטי מסמך'))),
    h('div', { class: 'card-body' }, ledger)),
    h('div', { class: 'stack' },
      h('div', { class: 'card' }, h('header', {}, h('h2', {}, 'ריכוז לפי פרקים')), h('div', { class: 'table-wrap' }, groups),
        h('div', { class: 'card-body muted', style: { fontSize: '12.5px' } }, 'הנחות פרקים ופטור מההנחה הכללית נקבעים בכתב הכמויות (לחיצה כפולה על פרק בעץ). הנחה כללית — בהגדרות החוזה.')),
      h('div', { class: 'card' }, h('header', {}, h('h2', {}, 'מצטברים')), h('div', { class: 'card-body' }, h('table', { class: 'ledger' }, h('tbody', {},
        line('התייקרות מצטברת', r.cumIndex), line('עיכבון מצטבר (נטו לאחר שחרורים)', r.cumRetention), line('מקדמה שקוזזה מצטבר', r.cumAdvance), line('סה"כ לתשלום מצטבר', r.cumDue, 'strong')))))))));
}

function paymentsTab(ctx, b, r) {
  const api = ctx.api;
  const pays = api.payments(b.id);
  const add = () => formModal('רישום תשלום', [
    { name: 'amount', label: 'סכום (₪)', value: ((r.due - b.paid) / 100).toFixed(2), numeric: true, required: true },
    { name: 'date', label: 'תאריך', type: 'date', value: new Date().toISOString().slice(0, 10) },
    { name: 'method', label: 'אמצעי', type: 'select', options: [['העברה', 'העברה בנקאית'], ['צ׳ק', 'צ׳ק'], ['מזומן', 'מזומן'], ['קיזוז', 'קיזוז'], ['אחר', 'אחר']] },
    { name: 'ref', label: 'אסמכתא' }, { name: 'note', label: 'הערה', span: true },
  ], (v) => { api.addPayment(b.id, v); ctx.refresh(); });
  return h('div', { class: 'grid-area' }, h('div', { class: 'page' },
    b.status !== 'approved' ? h('div', { class: 'alert info' }, 'תשלומים נרשמים רק לאחר אישור החשבון.') : null,
    h('div', { class: 'kpis' },
      h('div', { class: 'kpi' }, h('div', { class: 'l' }, 'לתשלום'), h('div', { class: 'v' }, money(r.due))),
      h('div', { class: 'kpi' }, h('div', { class: 'l' }, 'שולם'), h('div', { class: 'v' }, money(b.paid))),
      h('div', { class: 'kpi accent' }, h('div', { class: 'l' }, 'יתרה'), h('div', { class: 'v' }, money(r.due - b.paid)))),
    h('div', { class: 'card' }, h('header', {}, h('h2', {}, 'תשלומים'), h('div', { class: 'actions' }, h('button', { class: 'primary', disabled: b.status !== 'approved' || r.due - b.paid <= 0, onclick: add }, '+ תשלום'))),
      pays.length ? h('table', { class: 't' }, h('thead', {}, h('tr', {}, ['תאריך', 'סכום', 'אמצעי', 'אסמכתא', 'הערה', ''].map((x, i) => h('th', { class: i === 1 ? 'n' : '' }, x)))),
        h('tbody', {}, pays.map((p) => h('tr', {}, h('td', {}, dateLabel(p.date)), h('td', { class: 'n' }, money(p.amount_cents)), h('td', {}, p.method), h('td', {}, p.ref), h('td', {}, p.note),
          h('td', {}, h('button', { class: 'ghost sm danger', onclick: async () => { if (await confirmBox('מחיקת תשלום', 'למחוק?', { danger: true })) attempt(() => { api.deletePayment(p.id); ctx.refresh(); }); } }, 'מחיקה'))))))
        : h('div', { class: 'empty' }, 'לא נרשמו תשלומים'))));
}
