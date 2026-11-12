// Tenders and bid comparison, cash flow, management dashboard.
import { h, formModal, modal, attempt, confirmBox, toast, monthLabel, dateLabel } from './dom.js';
import { money, qty, lineCents } from '../money.js';
import { itemCode } from '../engine.js';
import { pickFile, download } from '../persist.js';
import { loadExcel, exportBidForm, readBidForm } from '../excel.js';

const pctTxt = (a, b) => (b ? `${a >= b ? '+' : ''}${(((a / b) - 1) * 100).toFixed(1)}%` : '—');
const safe = (s) => s.replace(/[\\/:*?"<>|]/g, '_');

// ---------------- tenders ----------------
export function tendersView(ctx, cid) {
  const api = ctx.api;
  const c = api.contract(cid);
  const list = api.tenders(cid);
  const scopes = [['', 'כל כתב הכמויות'], ...api.sections(cid).map((s) => [s.code, `${s.code} ${s.name}`])];
  const create = () => formModal('מכרז חדש', [
    { name: 'name', label: 'שם המכרז', required: true, span: true, placeholder: 'לדוגמה: עבודות שלד מבנה 2' },
    { name: 'scope', label: 'היקף', type: 'select', options: scopes, span: true },
    { name: 'due', label: 'מועד הגשה', type: 'date' },
  ], (v) => { const id = api.createTender(cid, v); ctx.go(`t/${id}`); });
  const ST = { open: 'פתוח', awarded: 'נסגר — זוכה', cancelled: 'בוטל' };
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'מכרזים והשוואת הצעות'), h('div', { class: 'sub' }, c.name)),
      h('div', { class: 'actions' }, h('button', { onclick: () => ctx.go(`c/${cid}`) }, 'כתב כמויות'), h('button', { class: 'primary', onclick: create }, '+ מכרז חדש'))),
    h('div', { class: 'card' }, list.length ? h('table', { class: 't lines' },
      h('thead', {}, h('tr', {}, ['מכרז', 'היקף', 'סעיפים', 'מציעים', 'מועד הגשה', 'סטטוס'].map((x) => h('th', {}, x)))),
      h('tbody', {}, list.map((t) => h('tr', { class: 'click', onclick: () => ctx.go(`t/${t.id}`) },
        h('td', {}, h('b', {}, t.name)), h('td', {}, t.scope || 'הכל'), h('td', { class: 'n' }, t.items), h('td', { class: 'n' }, t.bidders),
        h('td', {}, dateLabel(t.due)), h('td', {}, h('span', { class: `tag ${t.status === 'awarded' ? 'ok' : t.status === 'open' ? 'warn' : ''}` }, ST[t.status]))))))
      : h('div', { class: 'empty' }, h('b', {}, 'אין מכרזים'), 'צור מכרז על כל כתב הכמויות או על פרק, הוסף מציעים, שלח להם טופס Excel וקלוט את המחירים להשוואה.')));
}

export function tenderView(ctx, tid) {
  const api = ctx.api;
  const cmp = api.compareTender(tid);
  const t = cmp.tender;
  const c = api.contract(t.contract_id);
  const open = t.status === 'open';
  const B = t.bidders;
  const bidderForm = (b = {}) => formModal(b.id ? 'עריכת מציע' : 'מציע חדש', [
    { name: 'name', label: 'שם הקבלן / המציע', value: b.name, required: true },
    { name: 'contact', label: 'איש קשר / טלפון', value: b.contact },
    { name: 'discount', label: 'הנחה כללית על ההצעה %', value: b.discount ?? '0', numeric: true },
    { name: 'note', label: 'הערות', value: b.note, span: true },
  ], (v) => { api.saveBidder({ ...b, ...v, tender_id: tid }); ctx.refresh(); });
  const sendForm = async (b) => {
    try {
      const bytes = await exportBidForm(await loadExcel(), { tender: t, bidder: b, sections: api.sections(c.id), company: api.company().name });
      download(safe(`מכרז ${t.name} - ${b?.name ?? 'טופס ריק'}.xlsx`), bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    } catch (e) { toast(e.message, 'err'); }
  };
  const importForm = async (b) => {
    const f = await pickFile('.xlsx');
    if (!f) return;
    try {
      const rows = await readBidForm(await loadExcel(), f.bytes);
      const r = attempt(() => api.importBidPrices(b.id, rows));
      if (r === undefined) return;
      toast(`נקלטו ${r.matched} מחירים${r.missing ? ` · חסרים ${r.missing}` : ''}${r.unmatched.length ? ` · ${r.unmatched.length} קודים לא מוכרים` : ''}${r.bad.length ? ` · ${r.bad.length} מחירים לא תקינים` : ''}`, r.missing || r.bad.length ? 'err' : 'ok');
      ctx.refresh();
    } catch (e) { toast(`קריאת הקובץ נכשלה: ${e.message}`, 'err'); }
  };
  const award = async (b) => {
    const tt = cmp.totals[b.id];
    if (await confirmBox('בחירת זוכה', `לבחור ב-${b.name} כזוכה?\nסה"כ הצעה אחרי הנחה: ${money(tt.net)} ₪ (${pctTxt(tt.net, cmp.estimate)} מהאומדן).\nייווצר חוזה קבלן משנה עם מחירי ההצעה, מקושר לסעיפי ${c.name}.`, { ok: 'בחירה ויצירת חוזה' })) {
      const id = attempt(() => api.awardTender(tid, b.id), 'נוצר חוזה קבלן משנה');
      if (id !== undefined) ctx.go(`c/${id}`);
    }
  };

  const priceCell = (r, b) => {
    const p = r.bids[b.id];
    const low = r.low === b.id && B.length > 1;
    if (!open) return h('td', { class: `n ${low ? 'bid-low' : ''}` }, p == null ? '—' : qty(p));
    const inp = h('input', { class: 'n', dir: 'ltr', value: p ?? '', inputmode: 'decimal', placeholder: '—' });
    inp.addEventListener('change', () => { if (attempt(() => api.setBidPrice(b.id, r.item.id, inp.value)) !== undefined) ctx.refresh(); });
    return h('td', { class: `edit ${low ? 'bid-low' : ''}` }, inp);
  };
  const devCls = (p, ref) => (p == null || !Number(ref) ? '' : Number(p) > Number(ref) * 1.15 ? 'dev-high' : Number(p) < Number(ref) * 0.85 ? 'dev-low' : '');

  const table = h('table', { class: 't lines fixed tender' },
    h('colgroup', {}, [118, null, 56, 84, 96, 90, ...B.map(() => 110)].map((w) => h('col', { style: w ? { width: `${w}px` } : {} }))),
    h('thead', {}, h('tr', {}, h('th', {}, 'סעיף'), h('th', {}, 'תאור'), h('th', {}, "יח'"), h('th', { class: 'n' }, 'כמות'), h('th', { class: 'n' }, 'אומדן'), h('th', { class: 'n' }, 'דקל'),
      ...B.map((b) => h('th', { class: 'n' }, h('div', {}, b.name), b.discount !== '0' ? h('div', { class: 'muted' }, `הנחה ${b.discount}%`) : null)))),
    h('tbody', {}, cmp.rows.map((r) => h('tr', { 'data-id': r.item.id },
      h('td', { class: 'code' }, itemCode(r.item)), h('td', { class: 'desc', title: r.item.description }, r.item.description.length > 120 ? r.item.description.slice(0, 120) + '…' : r.item.description),
      h('td', {}, r.item.unit), h('td', { class: 'n' }, qty(r.item.qty)), h('td', { class: 'n' }, qty(r.estimate)), h('td', { class: 'n muted' }, r.dekel ? qty(r.dekel) : ''),
      ...B.map((b) => { const td = priceCell(r, b); const d = devCls(r.bids[b.id], r.estimate); if (d) td.classList.add(d); return td; }))),
    h('tr', { class: 'total' }, h('td', { colspan: 4 }, 'סה"כ לפני הנחה'), h('td', { class: 'n' }, money(cmp.estimate)), h('td'), ...B.map((b) => h('td', { class: 'n' }, money(cmp.totals[b.id].gross)))),
    h('tr', { class: 'total' }, h('td', { colspan: 4 }, 'סה"כ אחרי הנחה'), h('td'), h('td'), ...B.map((b) => h('td', { class: `n ${cmp.best === b.id ? 'bid-low' : ''}` }, h('b', {}, money(cmp.totals[b.id].net))))),
    h('tr', { class: 'total' }, h('td', { colspan: 4 }, 'מול האומדן'), h('td'), h('td'), ...B.map((b) => h('td', { class: 'n' }, pctTxt(cmp.totals[b.id].net, cmp.estimate)))),
    h('tr', { class: 'total' }, h('td', { colspan: 4 }, 'מחירים חסרים'), h('td'), h('td'), ...B.map((b) => h('td', { class: `n ${cmp.totals[b.id].missing ? 'dev-high' : ''}` }, cmp.totals[b.id].missing || '✓'))),
    open ? h('tr', {}, h('td', { colspan: 6 }), ...B.map((b) => h('td', { class: 'bid-actions' },
      h('button', { class: 'sm', onclick: () => sendForm(b), title: 'טופס Excel למילוי המחירים' }, 'טופס'),
      h('button', { class: 'sm', onclick: () => importForm(b), title: 'קליטת טופס שמולא' }, 'קליטה'),
      h('button', { class: 'sm ghost', onclick: () => bidderForm(b) }, 'עריכה'),
      h('button', { class: 'sm primary', disabled: !!cmp.totals[b.id].missing, onclick: () => award(b) }, 'זוכה'))))
      : null));
  const winner = B.find((b) => b.id === t.awarded_bidder);
  return h('div', { class: 'page full' }, h('section', { class: 'center', style: { height: '100%', gridTemplateRows: 'auto auto 1fr' } },
    h('div', { class: 'toolbar', style: { borderBottom: '1px solid var(--line)' } },
      h('h2', {}, t.name), h('span', { class: 'muted' }, `${c.name} · ${cmp.rows.length} סעיפים${t.due ? ` · הגשה ${dateLabel(t.due)}` : ''}`),
      winner ? h('span', { class: 'tag ok' }, `זוכה: ${winner.name}`) : null,
      h('div', { class: 'grow' }),
      h('button', { onclick: () => ctx.go(`c/${c.id}/tenders`) }, 'כל המכרזים'),
      winner ? h('button', { class: 'primary', onclick: () => ctx.go(`c/${t.awarded_contract}`) }, 'לחוזה הזוכה') : null,
      open ? h('button', { onclick: () => sendForm(null) }, 'טופס ריק') : null,
      open ? h('button', { class: 'primary', onclick: () => bidderForm() }, '+ מציע') : null,
      h('button', { class: 'danger ghost', onclick: async () => { if (await confirmBox('מחיקת מכרז', 'למחוק את המכרז וכל ההצעות?', { danger: true })) { attempt(() => api.deleteTender(tid)); ctx.go(`c/${c.id}/tenders`); } } }, 'מחיקה')),
    h('div', { class: 'statusbar', style: { borderTop: 'none', borderBottom: '1px solid var(--line)' } },
      h('span', {}, 'מחיר נמוך בכל סעיף — ', h('b', { class: 'bid-low', style: { padding: '0 6px' } }, 'ירוק')),
      h('span', {}, 'סטייה מעל ±15% מהאומדן מסומנת'),
      cmp.best ? h('span', {}, 'ההצעה השלמה הזולה: ', h('b', {}, B.find((b) => b.id === cmp.best).name)) : h('span', {}, 'אין עדיין הצעה שלמה')),
    h('div', { class: 'grid-area' }, B.length ? table : h('div', { class: 'empty' }, h('b', {}, 'אין מציעים'), 'הוסף מציעים, הורד לכל אחד טופס Excel, וקלוט את הטופס שמולא — או הקלד מחירים ישירות בטבלה.'))));
}

// ---------------- cash flow ----------------
export function cashflowView(ctx) {
  const api = ctx.api;
  let pid = Number(sessionStorage.getItem('cf-project')) || null;
  const body = h('div');
  const draw = () => {
    const cf = api.cashflow({ projectId: pid });
    const max = Math.max(1, ...cf.months.map((r) => Math.max(r.inActual + r.inExpected, r.outActual + r.outExpected)));
    const bar = (a, e, cls) => h('div', { class: `cf-bar ${cls}` }, h('span', { class: 'a', style: { width: `${(a / max) * 100}%` } }), h('span', { class: 'e', style: { width: `${(e / max) * 100}%` } }));
    const tot = (k) => cf.months.reduce((s, r) => s + r[k], 0);
    body.replaceChildren(
      cf.warnings.length ? h('div', { class: 'alert' }, h('b', {}, 'שים לב: '), h('div', { class: 'pre' }, cf.warnings.join('\n')), h('div', { class: 'muted' }, 'הגדר "חודש סיום צפוי" ו"תנאי תשלום" בהגדרות כל חוזה.')) : null,
      h('div', { class: 'kpis' },
        h('div', { class: 'kpi' }, h('div', { class: 'l' }, 'תקבולים בפועל'), h('div', { class: 'v' }, money(tot('inActual')))),
        h('div', { class: 'kpi' }, h('div', { class: 'l' }, 'תקבולים צפויים'), h('div', { class: 'v' }, money(tot('inExpected')))),
        h('div', { class: 'kpi' }, h('div', { class: 'l' }, 'תשלומים לקבלנים בפועל'), h('div', { class: 'v' }, money(tot('outActual')))),
        h('div', { class: 'kpi' }, h('div', { class: 'l' }, 'תשלומים לקבלנים צפויים'), h('div', { class: 'v' }, money(tot('outExpected')))),
        h('div', { class: 'kpi accent' }, h('div', { class: 'l' }, 'יתרה מצטברת'), h('div', { class: 'v' }, money(cf.months.at(-1)?.cumulative ?? 0)))),
      h('div', { class: 'card' }, cf.months.length ? h('div', { class: 'table-wrap' }, h('table', { class: 't lines cf' },
        h('thead', {}, h('tr', {}, ['חודש', 'תקבולים בפועל', 'תקבולים צפויים', 'תשלומים בפועל', 'תשלומים צפויים', 'נטו', 'מצטבר', ''].map((x, i) => h('th', { class: i && i < 7 ? 'n' : '' }, x)))),
        h('tbody', {}, cf.months.map((r) => h('tr', { class: r.month === cf.current ? 'sel' : r.past ? 'cf-past' : '' },
          h('td', {}, monthLabel(r.month), r.month === cf.current ? h('span', { class: 'tag', style: { marginInlineStart: '6px' } }, 'נוכחי') : null),
          h('td', { class: 'n' }, r.inActual ? money(r.inActual) : ''), h('td', { class: 'n muted' }, r.inExpected ? money(r.inExpected) : ''),
          h('td', { class: 'n' }, r.outActual ? money(r.outActual) : ''), h('td', { class: 'n muted' }, r.outExpected ? money(r.outExpected) : ''),
          h('td', { class: `n ${r.net < 0 ? 'dev-high' : ''}` }, money(r.net)), h('td', { class: `n ${r.cumulative < 0 ? 'dev-high' : ''}` }, h('b', {}, money(r.cumulative))),
          h('td', { style: { width: '220px' } }, bar(r.inActual, r.inExpected, 'in'), bar(r.outActual, r.outExpected, 'out')))))))
        : h('div', { class: 'empty' }, h('b', {}, 'אין נתונים לתזרים'), 'התזרים נבנה מחשבונות מאושרים, תשלומים ויתרת הביצוע של כל חוזה.')),
      h('p', { class: 'muted', style: { fontSize: '12.5px' } }, 'צפי: יתרות חשבונות מאושרים לפי תנאי התשלום (שוטף + ימים), יתרה שעבר מועדה מוצגת בחודש הנוכחי; ויתרת ההיקף לביצוע מחולקת שווה עד חודש הסיום, כוללת מע"מ. בפועל: תשלומים שנרשמו.'));
  };
  const sel = h('select', { onchange: (e) => { pid = Number(e.target.value) || null; sessionStorage.setItem('cf-project', pid ?? ''); draw(); } },
    h('option', { value: '' }, 'כל הפרויקטים'), api.projects().map((p) => h('option', { value: p.id, selected: p.id === pid }, p.name)));
  draw();
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'תזרים מזומנים'), h('div', { class: 'sub' }, 'תקבולים ממזמינים מול תשלומים לקבלני משנה, לפי חודש')), h('div', { class: 'actions' }, sel)),
    body);
}

// ---------------- management dashboard ----------------
export function managementView(ctx) {
  const rows = ctx.api.managementReport();
  const sum = (f) => rows.reduce((a, r) => a + f(r), 0);
  const cell = (v, cls = '') => h('td', { class: `n ${cls}` }, v);
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'דוחות מנהלים'), h('div', { class: 'sub' }, 'ביצוע, חיובים, גבייה ורווחיות לכל פרויקט'))),
    h('div', { class: 'kpis' },
      h('div', { class: 'kpi' }, h('div', { class: 'l' }, 'היקף חוזי מזמין'), h('div', { class: 'v' }, money(sum((r) => r.client.scope)))),
      h('div', { class: 'kpi' }, h('div', { class: 'l' }, 'בוצע (מאושר)'), h('div', { class: 'v' }, money(sum((r) => r.client.cumNet)))),
      h('div', { class: 'kpi' }, h('div', { class: 'l' }, 'יתרה לגבייה'), h('div', { class: 'v' }, money(sum((r) => r.client.balance)))),
      h('div', { class: 'kpi' }, h('div', { class: 'l' }, 'יתרה לתשלום לקבלנים'), h('div', { class: 'v' }, money(sum((r) => r.sub.balance)))),
      h('div', { class: 'kpi accent' }, h('div', { class: 'l' }, 'רווח על הביצוע מול קבלנים'), h('div', { class: 'v' }, money(sum((r) => r.execMargin))))),
    h('div', { class: 'card' }, rows.length ? h('div', { class: 'table-wrap' }, h('table', { class: 't lines' },
      h('thead', {}, h('tr', {}, ['פרויקט', 'היקף מזמין', 'בוצע', 'ביצוע %', 'לגבייה', 'קבלנים — בוצע', 'לתשלום לקבלנים', 'רווח מתוכנן', 'רווח על הביצוע', 'חריגות כמות', 'עבודות נוספות', 'חריגות מדקל', 'ליקויים פתוחים'].map((x, i) => h('th', { class: i ? 'n' : '' }, x)))),
      h('tbody', {}, rows.map((r) => h('tr', { class: 'click', onclick: () => ctx.go(`p/${r.project.id}`) },
        h('td', {}, h('b', {}, r.project.name), r.project.status === 'closed' ? h('span', { class: 'tag', style: { marginInlineStart: '6px' } }, 'סגור') : null),
        cell(money(r.client.scope)), cell(money(r.client.cumNet)), cell(`${(r.progress * 100).toFixed(1)}%`), cell(money(r.client.balance)),
        cell(money(r.sub.cumNet)), cell(money(r.sub.balance)), cell(money(r.plannedMargin)), cell(money(r.execMargin), r.execMargin < 0 ? 'dev-high' : ''),
        cell(r.overrunItems ? `${r.overrunItems} · ${money(r.overrunCents)}` : '—', r.overrunItems ? 'dev-low' : ''), cell(r.extraCents ? money(r.extraCents) : '—'),
        cell(r.dekelFlags || '—', r.dekelFlags ? 'dev-high' : ''), cell(r.openDefects ? `${r.openDefects}${r.overdueDefects ? ` (${r.overdueDefects} באיחור)` : ''}` : '—', r.overdueDefects ? 'dev-high' : ''))))))
      : h('div', { class: 'empty' }, 'אין פרויקטים')));
}
