// Reports: client-vs-subcontract profit, status as of a cut-off date, defects register.
import { h, formModal, attempt, confirmBox, monthLabel, dateLabel } from './dom.js';
import { money, qty } from '../money.js';
import { itemCode } from '../engine.js';
import { KIND } from './projects.js';

const pctOf = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : '—');

export function profitView(ctx, cid) {
  const api = ctx.api;
  const r = api.profit(cid);
  const T = r.totals;
  const bySub = new Map();
  for (const l of r.lines) { const k = l.sub; if (!bySub.has(k)) bySub.set(k, []); bySub.get(k).push(l); }
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'דוח רווח מול קבלני משנה'), h('div', { class: 'sub' }, `${r.client.name} · ${r.subs.length} קבלני משנה`)),
      h('div', { class: 'actions' }, h('button', { onclick: () => ctx.go(`c/${cid}/bills`) }, 'חזרה'))),
    h('div', { class: 'kpis' },
      h('div', { class: 'kpi' }, h('div', { class: 'l' }, 'מזמין — מתוכנן (ברוטו)'), h('div', { class: 'v' }, money(T.plannedClient))),
      h('div', { class: 'kpi' }, h('div', { class: 'l' }, 'קבלני משנה — מתוכנן'), h('div', { class: 'v' }, money(T.plannedSub))),
      h('div', { class: 'kpi accent' }, h('div', { class: 'l' }, 'רווח מתוכנן'), h('div', { class: 'v' }, `${money(T.plannedMargin)}  (${pctOf(T.plannedMargin, T.plannedClient)})`)),
      h('div', { class: 'kpi' }, h('div', { class: 'l' }, 'מזמין — בוצע מאושר'), h('div', { class: 'v' }, money(T.execClient))),
      h('div', { class: 'kpi' }, h('div', { class: 'l' }, 'קבלני משנה — חויב בפועל'), h('div', { class: 'v' }, money(T.execSub))),
      h('div', { class: 'kpi accent' }, h('div', { class: 'l' }, 'רווח על הביצוע'), h('div', { class: 'v' }, `${money(T.execMargin)}  (${pctOf(T.execMargin, T.execClient)})`))),
    r.lines.length ? [...bySub].map(([name, lines]) => h('div', { class: 'card', style: { marginBottom: '14px' } }, h('header', {}, h('h2', {}, name)),
      h('div', { class: 'table-wrap' }, h('table', { class: 't lines' },
        h('thead', {}, h('tr', {}, ['סעיף', 'תאור', "יח'", 'כמות חוזה', 'מחיר מזמין', 'מחיר קבלן', 'רווח ליחידה', 'רווח מתוכנן', 'רווח על הביצוע'].map((x, i) => h('th', { class: i >= 3 ? 'n' : '' }, x)))),
        h('tbody', {}, lines.map((l) => h('tr', { class: Number(l.unitMargin) < 0 ? 'over' : '' },
          h('td', { class: 'code' }, itemCode(l.item)), h('td', { class: 'desc' }, l.item.description.slice(0, 110)), h('td', {}, l.item.unit),
          h('td', { class: 'n' }, qty(l.item.qty)), h('td', { class: 'n' }, qty(l.item.price)), h('td', { class: 'n' }, qty(l.subPrice)),
          h('td', { class: `n ${Number(l.unitMargin) < 0 ? 'dev-high' : ''}` }, qty(l.unitMargin)), h('td', { class: 'n' }, money(l.plannedMargin)), h('td', { class: 'n' }, money(l.execMargin)))))))))
      : h('div', { class: 'card empty' }, h('b', {}, 'אין סעיפי קבלן משנה מקושרים'), 'צור קבלן משנה מתוך הפרויקט עם "העתק סעיפים מחוזה המזמין" — הסעיפים יקושרו אוטומטית.'));
}

export function statusView(ctx) {
  const api = ctx.api;
  let day = sessionStorage.getItem('status-date') || new Date().toISOString().slice(0, 10);
  const body = h('div');
  const draw = () => {
    const rows = api.statusAsOf(day);
    const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
    body.replaceChildren(h('div', { class: 'card' }, h('div', { class: 'table-wrap' }, h('table', { class: 't lines' },
      h('thead', {}, h('tr', {}, ['פרויקט', 'חוזה', 'סוג', 'חשבון אחרון', 'היקף', 'מצטבר מאושר', 'ביצוע', 'עיכבון', 'חויב (כולל מע"מ)', 'שולם', 'יתרה'].map((x, i) => h('th', { class: i >= 4 ? 'n' : '' }, x)))),
      h('tbody', {}, rows.map((r) => h('tr', { class: 'click', onclick: () => ctx.go(`c/${r.contract.id}/bills`) },
        h('td', {}, r.project), h('td', {}, r.contract.name), h('td', {}, KIND[r.contract.kind]), h('td', {}, r.lastBill ? `${r.lastBill} · ${monthLabel(r.lastMonth)}` : '—'),
        h('td', { class: 'n' }, money(r.scope)), h('td', { class: 'n' }, money(r.cumNet)), h('td', { class: 'n' }, `${(r.progress * 100).toFixed(1)}%`),
        h('td', { class: 'n' }, money(r.retention)), h('td', { class: 'n' }, money(r.billed)), h('td', { class: 'n' }, money(r.paid)), h('td', { class: 'n' }, h('b', {}, money(r.balance))))),
        h('tr', { class: 'total' }, h('td', { colspan: 5 }, 'סה"כ'), h('td', { class: 'n' }, money(sum('cumNet'))), h('td'), h('td', { class: 'n' }, money(sum('retention'))),
          h('td', { class: 'n' }, money(sum('billed'))), h('td', { class: 'n' }, money(sum('paid'))), h('td', { class: 'n' }, money(sum('balance')))))))));
  };
  const input = h('input', { type: 'date', value: day, onchange: (e) => { day = e.target.value; sessionStorage.setItem('status-date', day); draw(); } });
  draw();
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'מצב חוזים לתאריך'), h('div', { class: 'sub' }, 'כולל רק חשבונות שאושרו ותשלומים שנרשמו עד התאריך שנבחר')),
      h('div', { class: 'actions' }, h('label', { class: 'field', style: { gridAutoFlow: 'column', alignItems: 'center' } }, h('span', {}, 'תאריך חיתוך'), input))),
    body);
}

const SEV = { low: 'נמוכה', normal: 'רגילה', high: 'גבוהה', critical: 'קריטית' };
const DST = { open: 'פתוח', in_progress: 'בטיפול', fixed: 'תוקן', closed: 'סגור' };

function defectForm(ctx, pid, d = {}) {
  const contracts = ctx.api.contracts(pid).filter((c) => c.kind !== 'quote');
  formModal(d.id ? 'עריכת ליקוי' : 'ליקוי חדש', [
    { name: 'description', label: 'תיאור הליקוי', type: 'textarea', value: d.description, span: true, required: true },
    { name: 'location', label: 'מיקום (מבנה / קומה / ציר)', value: d.location },
    { name: 'contract_id', label: 'חוזה / קבלן', type: 'select', value: d.contract_id ?? '', options: [['', '—'], ...contracts.map((c) => [c.id, `${c.name}${c.party ? ` · ${c.party}` : ''}`])] },
    { name: 'severity', label: 'חומרה', type: 'select', value: d.severity ?? 'normal', options: Object.entries(SEV) },
    { name: 'status', label: 'סטטוס', type: 'select', value: d.status ?? 'open', options: Object.entries(DST) },
    { name: 'responsible', label: 'אחראי לתיקון', value: d.responsible },
    { name: 'due', label: 'יעד לתיקון', type: 'date', value: d.due },
    { name: 'notes', label: 'הערות', type: 'textarea', value: d.notes, span: true },
  ], (v) => { ctx.api.saveDefect({ ...d, ...v, project_id: pid }); ctx.refresh(); }, { wide: true });
}

export function defectsView(ctx, pid) {
  const api = ctx.api;
  const p = api.project(pid);
  const list = api.defects(pid);
  const contracts = new Map(api.contracts(pid).map((c) => [c.id, c]));
  const today = new Date().toISOString().slice(0, 10);
  const open = list.filter((d) => d.status !== 'closed');
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'ליקויים'), h('div', { class: 'sub' }, p.name)),
      h('div', { class: 'actions' }, h('button', { onclick: () => ctx.go(`p/${pid}`) }, 'חזרה לפרויקט'), h('button', { class: 'primary', onclick: () => defectForm(ctx, pid) }, '+ ליקוי'))),
    h('div', { class: 'kpis' },
      h('div', { class: 'kpi' }, h('div', { class: 'l' }, 'פתוחים'), h('div', { class: 'v' }, open.length)),
      h('div', { class: 'kpi' }, h('div', { class: 'l' }, 'קריטיים / גבוהים פתוחים'), h('div', { class: 'v dev-high' }, open.filter((d) => ['critical', 'high'].includes(d.severity)).length)),
      h('div', { class: 'kpi' }, h('div', { class: 'l' }, 'באיחור'), h('div', { class: 'v dev-low' }, open.filter((d) => d.due && d.due < today).length)),
      h('div', { class: 'kpi' }, h('div', { class: 'l' }, 'נסגרו'), h('div', { class: 'v' }, list.length - open.length))),
    h('div', { class: 'card' }, list.length ? h('div', { class: 'table-wrap' }, h('table', { class: 't lines' },
      h('thead', {}, h('tr', {}, ['נפתח', 'מיקום', 'תיאור', 'חוזה', 'חומרה', 'אחראי', 'יעד', 'סטטוס', ''].map((x) => h('th', {}, x)))),
      h('tbody', {}, list.map((d) => h('tr', { class: d.status !== 'closed' && d.due && d.due < today ? 'over' : '' },
        h('td', {}, dateLabel(d.opened)), h('td', {}, d.location), h('td', { class: 'desc' }, d.description), h('td', {}, contracts.get(d.contract_id)?.name ?? ''),
        h('td', {}, h('span', { class: `tag ${['critical', 'high'].includes(d.severity) ? 'bad' : ''}` }, SEV[d.severity])), h('td', {}, d.responsible), h('td', {}, dateLabel(d.due)),
        h('td', {}, h('span', { class: `tag ${d.status === 'closed' ? 'ok' : d.status === 'fixed' ? 'paid' : 'warn'}` }, DST[d.status])),
        h('td', {}, h('button', { class: 'ghost sm', onclick: () => defectForm(ctx, pid, d) }, 'עריכה'),
          h('button', { class: 'ghost sm danger', onclick: async () => { if (await confirmBox('מחיקת ליקוי', 'למחוק?', { danger: true })) attempt(() => { api.deleteDefect(d.id); ctx.refresh(); }); } }, 'מחיקה')))))))
      : h('div', { class: 'empty' }, h('b', {}, 'אין ליקויים רשומים'), 'רשום ליקוי, שייך אותו לחוזה/קבלן ועקוב אחרי טיפול וסגירה.')));
}
