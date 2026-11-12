// Bills: list per contract, execution grid, summary/adjustments, payments.
import { h, formModal, modal, attempt, confirmBox, toast, monthLabel, dateLabel } from './dom.js';
import { money, qty, addQ } from '../money.js';
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
  const scope = c.planned_cents || v.net; // signed contract amount when set
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
      h('div', { class: 'kpi' }, h('div', { class: 'l' }, c.planned_cents ? 'סכום חוזה חתום' : 'היקף חוזה (אחרי הנחות)'), h('div', { class: 'v' }, money(scope))),
      h('div', { class: 'kpi accent' }, h('div', { class: 'l' }, 'מצטבר מאושר'), h('div', { class: 'v' }, money(lastAppr?.snap.cumNet ?? 0))),
      h('div', { class: 'kpi' }, h('div', { class: 'l' }, 'ביצוע מההיקף'), h('div', { class: 'v' }, scope ? `${(((lastAppr?.snap.cumNet ?? 0) / scope) * 100).toFixed(1)}%` : '—')),
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
  // Same columns, order and grouping as the printed Binarit bill; quantities are edited in place.
  const api = ctx.api;
  const periodic = c.mode === 'periodic';
  const col = { calc: 'q_calc', sub: 'q_sub', appr: 'q_appr' }[b.basis];
  const canEdit = col === 'q_appr' ? apprEditable : editable;
  const items = api.items(c.id).filter((i) => i.kind !== 'note' && (i.kind === 'contract' || i.change_status === 'approved'));
  const sections = new Map(api.sections(c.id).map((s) => [s.code, s]));
  const secName = (k) => sections.get(k)?.name ?? '';
  let showVersions = sessionStorage.getItem('exec-versions') === '1';
  let filter = sessionStorage.getItem('exec-filter') || 'all';
  const tbody = h('tbody');
  const sumBox = h('div', { class: 'statusbar' });
  const n2 = (v) => (Number(v) ? Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
  const pctOf = (cum, cq) => (Number(cq) ? n2((Number(cum) / Number(cq)) * 100) : '');
  const code = (it) => `${it.chapter}.${+it.sub}.${String(it.num).padStart(3, '0')}`;
  let res = r;

  const drawSum = () => sumBox.replaceChildren(
    h('span', {}, 'חישוב לפי: ', h('b', {}, `כמות ${BASIS[b.basis]}`)),
    h('span', {}, 'מצטבר נטו: ', h('b', {}, money(res.cumNet))),
    h('span', {}, 'קודם: ', h('b', {}, money(res.prevNet))),
    h('span', {}, 'לתקופה: ', h('b', {}, money(res.periodNet))),
    h('span', {}, 'לתשלום כולל מע"מ: ', h('b', {}, money(res.due))));

  const numInput = (value, onCommit, enabled, cls = '') => {
    if (!enabled) return h('td', { class: `n locked ${cls}` }, n2(value));
    const shown = value === '0' || value == null || value === '' ? '' : (/^-?\d+(\.\d{1,2})?$/.test(String(value)) ? Number(value).toFixed(2) : String(value));
    const inp = h('input', { class: 'n', value: shown, dir: 'ltr', inputmode: 'decimal', 'data-col': cls });
    inp.addEventListener('change', () => { if (onCommit(inp.value) !== undefined) { res = api.calc(b.id); draw(); drawSum(); setTimeout(() => focusNext(cls, inp.closest('tr')?.dataset.id, 0), 0); } });
    inp.addEventListener('keydown', (e) => {
      if (!['Enter', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
      e.preventDefault();
      const id = inp.closest('tr').dataset.id;
      const changed = inp.value !== inp.defaultValue;
      if (changed) { inp.dispatchEvent(new Event('change')); setTimeout(() => focusNext(cls, id, e.key === 'ArrowUp' ? -1 : 1), 0); }
      else focusNext(cls, id, e.key === 'ArrowUp' ? -1 : 1);
    });
    return h('td', { class: 'edit' }, inp);
  };
  const focusNext = (cls, id, step) => {
    const all = [...tbody.querySelectorAll(`input[data-col="${cls}"]`)];
    const i = all.findIndex((x) => x.closest('tr').dataset.id === String(id));
    all[i + step]?.focus(); all[i + step]?.select();
  };

  const NCOL = 10 + (showVersions ? 3 : 0);
  function draw() {
    const rows = new Map(res.rows.map((x) => [x.itemId, x]));
    const lines = api.lines(b.id);
    tbody.replaceChildren();
    const groups = new Map(res.totals.groups.map((g) => [g.key, g]));
    let chap = null, sub = null, subSum = 0;
    const closeSub = () => { if (sub != null) tbody.append(h('tr', { class: 'bn-ssum' }, h('td', { colspan: NCOL - 1 }, `סה"כ ${chap.split('.')[1]}.${+sub} ${secName(`${chap}.${sub}`)}`), h('td', { class: 'n' }, money(subSum)))); };
    const closeChap = () => {
      if (!chap) return;
      closeSub();
      const g = groups.get(chap);
      if (!g) return;
      tbody.append(h('tr', { class: 'bn-csum' }, h('td', { colspan: NCOL - 1 }, `סה"כ ${g.chapter} ${g.name}`), h('td', { class: 'n' }, money(g.gross))));
      if (g.discount) tbody.append(
        h('tr', { class: 'bn-csum' }, h('td', { colspan: NCOL - 1 }, `הנחה ${g.rate}% מסך ${money(g.gross)}`), h('td', { class: 'n minus' }, money(-g.discount))),
        h('tr', { class: 'bn-csum' }, h('td', { colspan: NCOL - 1 }, `סה"כ ${g.chapter} (לאחר הנחה)`), h('td', { class: 'n' }, money(g.net))));
    };
    for (const it of items) {
      const x = rows.get(it.id);
      if (filter === 'active' && x && x.cumQ === '0' && x.prevQ === '0') continue;
      if (filter === 'period' && x && x.curQ === '0') continue;
      if (filter === 'over' && x && x.cat.over === 0) continue;
      const ck = `${it.struct}.${it.chapter}`;
      if (ck !== chap) {
        closeChap(); chap = ck; sub = null;
        tbody.append(h('tr', { class: 'group' }, h('td', { colspan: NCOL }, `מבנה ${+it.struct} ${secName(it.struct)}  ·  פרק ${it.chapter} ${secName(ck)}`)));
      }
      if (it.sub !== sub) {
        closeSub(); sub = it.sub; subSum = 0;
        tbody.append(h('tr', { class: 'bn-shead' }, h('td'), h('td', { colspan: NCOL - 1 }, `תת פרק ${it.chapter}.${+it.sub} ${secName(`${ck}.${it.sub}`)}`)));
      }
      subSum += x?.amount ?? 0;
      const L = lines.get(it.id) ?? {};
      const prev = x?.prevQ ?? '0';
      const setCum = (v) => attempt(() => api.setLine(b.id, it.id, { [col]: v === '' ? (periodic ? '0' : prev) : v }));
      const setCur = (v) => attempt(() => api.setLine(b.id, it.id, { [col]: periodic ? (v || '0') : addQ(prev, v || '0') }));
      const tr = h('tr', { class: `${x?.cat.over ? 'over' : ''}`, 'data-id': it.id },
        h('td', { class: 'code' }, code(it)),
        h('td', { class: 'desc', title: it.description }, it.description.length > 140 ? it.description.slice(0, 140) + '…' : it.description),
        h('td', {}, it.unit),
        h('td', { class: 'n' }, n2(it.qty)),
        h('td', { class: 'n muted' }, x ? pctOf(x.cumQ, it.qty) : ''),
        h('td', { class: 'n muted' }, x ? n2(x.prevQ) : ''),
        numInput(x?.curQ, setCur, canEdit, 'cur'),
        numInput(x?.cumQ, setCum, canEdit, 'cum'),
        ...(showVersions ? ['q_calc', 'q_sub', 'q_appr'].map((k) => numInput(L[k], (v) => attempt(() => api.setLine(b.id, it.id, { [k]: v })), k === 'q_appr' ? apprEditable : editable, k)) : []),
        numInput(L.price ?? it.price, (v) => attempt(() => api.setLine(b.id, it.id, { price: v === it.price ? '' : v })), editable, 'price'),
        h('td', { class: 'n' }, x ? money(x.amount) : ''));
      tbody.append(tr);
    }
    closeChap();
  }
  draw(); drawSum();

  const basisSel = h('select', { disabled: !editable && b.status !== 'submitted', onchange: (e) => attempt(() => { api.saveBill(b.id, { basis: e.target.value }); ctx.refresh(); }) },
    Object.entries(BASIS).map(([k, l]) => h('option', { value: k, selected: b.basis === k }, `עדכון כמות ${l}`)));
  const filterSel = h('select', { onchange: (e) => { filter = e.target.value; sessionStorage.setItem('exec-filter', filter); draw(); } },
    [['all', 'כל הסעיפים'], ['active', 'סעיפים עם ביצוע'], ['period', 'התקדמות בתקופה'], ['over', 'חריגה מכמות חוזה']].map(([k, l]) => h('option', { value: k, selected: filter === k }, l)));
  const copyBtn = (from, to, label, enabled) => h('button', { disabled: !enabled, onclick: async () => {
    if (await confirmBox('העתקת כמויות', `להעתיק את כל ${label}?`)) attempt(() => { api.copyColumn(b.id, from, to); ctx.refresh(); });
  } }, label);
  const heads = ['סעיף', 'תאור', 'יחידה', 'כמות חוזה', '% ביצוע', 'מצטבר קודם', 'כמות נוכחית', 'כמות מצטברת', ...(showVersions ? ['מחושבת', 'מוגשת', 'מאושרת'] : []), 'מחיר יחידה', periodic ? 'סה"כ לתקופה' : 'סה"כ מצטבר'];
  return h('div', { style: { display: 'grid', gridTemplateRows: 'auto 1fr auto', minHeight: 0 } },
    h('div', { class: 'toolbar no-print' }, basisSel, filterSel,
      h('label', { style: { display: 'flex', gap: '4px', alignItems: 'center' } }, h('input', { type: 'checkbox', checked: showVersions, onchange: (e) => { sessionStorage.setItem('exec-versions', e.target.checked ? '1' : '0'); ctx.refresh(); } }), 'גרסאות כמות'),
      h('span', { class: 'sep' }),
      copyBtn('q_calc', 'q_sub', 'מחושבת ← מוגשת', editable), copyBtn('q_sub', 'q_appr', 'מוגשת ← מאושרת', apprEditable),
      h('div', { class: 'grow' }), h('span', { class: 'muted' }, canEdit ? 'הזן כמות נוכחית או מצטברת · Enter לשורה הבאה' : 'החשבון נעול לעריכה')),
    h('div', { class: 'grid-area' }, h('table', { class: 't exec bn-screen lines fixed' },
      h('colgroup', {}, [92, null, 58, 90, 78, 94, 98, 98, ...(showVersions ? [90, 90, 90] : []), 96, 116].map((w) => h('col', { style: w ? { width: `${w}px` } : {} }))),
      h('thead', {}, h('tr', {}, heads.map((x, i) => h('th', { class: i >= 3 ? 'n' : '' }, x)))), tbody)),
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
    line(c.mode === 'periodic' ? 'סה"כ לתקופה (נטו)' : 'מצטבר מחושב במחירי בסיס', c.mode === 'periodic' ? r.periodNet : r.cumNet, 'strong'),
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
    line('סכום לתשלום בחשבון זה', r.due, 'grand')));

  const groups = h('table', { class: 't' }, h('thead', {}, h('tr', {}, ['מבנה.פרק', 'שם', 'ברוטו', 'הנחה', 'הנחה כללית', 'נטו'].map((x, i) => h('th', { class: i >= 2 ? 'n' : '' }, x)))),
    h('tbody', {}, T.groups.filter((g) => g.gross !== 0).map((g) => h('tr', {}, h('td', { class: 'code' }, g.key), h('td', {}, g.name, g.exempt ? h('span', { class: 'tag', style: { marginInlineStart: '6px' } }, 'מוחרג') : null),
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
