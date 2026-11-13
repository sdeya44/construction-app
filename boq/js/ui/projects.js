import { h, formModal, attempt, confirmBox, monthLabel, dateLabel } from './dom.js';
import { money } from '../money.js';
import { INDEX_SERIES } from '../schema.js';

export const KIND = { client: 'חוזה מזמין', sub: 'קבלן משנה', quote: 'הצעת מחיר' };
export const STATUS = { draft: 'בהכנה', submitted: 'הוגש', approved: 'מאושר' };

export function projectForm(ctx, p = {}) {
  formModal(p.id ? 'עריכת פרויקט' : 'פרויקט חדש', [
    { name: 'name', label: 'שם הפרויקט', value: p.name, required: true, span: true },
    { name: 'client', label: 'מזמין', value: p.client },
    { name: 'location', label: 'מיקום', value: p.location },
    { name: 'supervisor', label: 'מפקח', value: p.supervisor },
    { name: 'manager', label: 'מנהל פרויקט', value: p.manager },
    { name: 'dekel_threshold', label: 'סף סטייה מדקל (%)', value: p.dekel_threshold ?? '15', numeric: true, hint: 'סעיף שמחירו חורג מדקל מעבר לסף יסומן' },
    { name: 'status', label: 'סטטוס', type: 'select', value: p.status ?? 'active', options: [['active', 'פעיל'], ['closed', 'סגור']] },
    { name: 'notes', label: 'הערות', type: 'textarea', value: p.notes, span: true },
  ], (v) => {
    const id = ctx.api.saveProject({ ...p, ...v });
    p.id ? ctx.refresh() : ctx.go(`p/${id}`);
  });
}

/** Contract fields grouped into tabs: details / payment terms / indexation. */
export function contractFields(c, { forConvert = false } = {}) {
  const isQuote = c.kind === 'quote';
  const fields = [
    { type: 'tab', label: forConvert ? '1 · פרטי החוזה' : 'פרטים' },
    { name: 'name', label: isQuote ? 'שם ההצעה' : 'שם החוזה', value: c.name, required: true, span: true },
    { name: 'number', label: isQuote ? 'מספר הצעה' : 'מספר חוזה', value: c.number },
    { name: 'party', label: c.kind === 'sub' ? 'קבלן משנה' : 'מזמין / נמען', value: c.party },
  ];
  if (isQuote) {
    fields.push({ name: 'quote_markup', label: 'תוספת (+) / הנחה (−) כללית מדקל %', value: c.quote_markup ?? '0', numeric: true, hint: 'לדוגמה ‎-12 = הנחה של 12% ממחירון דקל' },
      { name: 'vat_rate', label: 'מע"מ %', value: c.vat_rate ?? '18', numeric: true });
    return fields;
  }
  fields.push(
    { name: 'mode', label: 'שיטת חשבון', type: 'select', value: c.mode ?? 'cumulative', options: [['cumulative', 'מצטבר (כמות מצטברת, ניכוי חשבון קודם)'], ['periodic', 'תקופתי (כמויות לתקופה)']] },
    { name: 'planned', label: 'סכום חוזה חתום (₪)', value: String((c.planned_cents ?? 0) / 100), numeric: true, hint: 'מודפס כ"היקף עבודה מתוכנן" בסיכום החשבון; 0 = מחושב מכתב הכמויות' },
    { name: 'end_month', label: 'חודש סיום צפוי (לתזרים)', type: 'month', value: c.end_month },
    { type: 'tab', label: forConvert ? '2 · תנאי תשלום' : 'תשלומים והנחות' },
    { name: 'general_discount', label: 'הנחה כללית %', value: c.general_discount ?? '0', numeric: true, hint: 'לאחר הנחות פרקים; פרק 99 מוחרג כברירת מחדל' },
    { name: 'retention_rate', label: 'עיכבון %', value: c.retention_rate ?? '0', numeric: true },
    { name: 'advance', label: 'מקדמה ששולמה (₪)', value: String((c.advance_cents ?? 0) / 100), numeric: true },
    { name: 'advance_rate', label: 'קיזוז מקדמה מכל חשבון %', value: c.advance_rate ?? '0', numeric: true },
    { name: 'vat_rate', label: 'מע"מ %', value: c.vat_rate ?? '18', numeric: true },
    { name: 'pay_terms', label: 'תנאי תשלום — שוטף + ימים', value: c.pay_terms ?? 60, numeric: true },
    ...(forConvert ? [] : [{ name: 'opening', label: 'יתרת פתיחה — מצטבר קודם מאושר (₪)', value: String((c.opening_cents ?? 0) / 100), numeric: true, hint: 'רק להעברת חוזה קיים באמצע ביצוע' }]),
    { type: 'tab', label: forConvert ? '3 · הצמדה למדד' : 'הצמדה למדד' },
    { name: 'index_rule', label: 'כלל הצמדה', type: 'select', value: c.index_rule ?? 'none', options: [['none', 'ללא'], ['full', 'מלאה'], ['threshold', 'מעל סף'], ['partial', 'חלקית (% מהעלייה)'], ['manual', 'סכום ידני בכל חשבון']] },
    { name: 'index_series', label: 'מדד', type: 'select', value: c.index_series ?? 'residential', options: Object.entries(INDEX_SERIES) },
    { name: 'index_base_month', label: 'חודש מדד בסיס', type: 'month', value: c.index_base_month },
    { name: 'index_lag', label: 'מדד קובע', type: 'select', value: c.index_lag ?? 0, options: [[0, 'מדד חודש הביצוע'], [1, 'מדד החודש שקדם לביצוע'], [2, 'שני חודשים לפני']] },
    { name: 'index_threshold', label: 'סף (%) — בכלל "מעל סף"', value: c.index_threshold ?? '0', numeric: true },
    { name: 'index_share', label: 'שיעור הצמדה (%) — בכלל "חלקית"', value: c.index_share ?? '100', numeric: true });
  return fields;
}

export function contractForm(ctx, c) {
  const isQuote = c.kind === 'quote';
  formModal(c.id ? 'הגדרות ' + KIND[c.kind] : KIND[c.kind] + ' חדש', contractFields(c), (v) => {
    const id = ctx.api.saveContract({ ...c, ...v });
    c.id ? ctx.refresh() : ctx.go(`c/${id}`);
  }, { wide: !isQuote });
}

export function projectsView(ctx) {
  const api = ctx.api;
  const list = api.projects();
  const body = list.length
    ? h('div', { class: 'card' }, h('div', { class: 'table-wrap' }, h('table', { class: 't' },
      h('thead', {}, h('tr', {}, h('th', {}, 'פרויקט'), h('th', {}, 'מזמין'), h('th', {}, 'מיקום'), h('th', { class: 'n' }, 'חוזים'), h('th', {}, 'סטטוס'), h('th', {}, 'נוצר'))),
      h('tbody', {}, list.map((p) => h('tr', { class: 'click', onclick: () => ctx.go(`p/${p.id}`) },
        h('td', {}, h('b', {}, p.name)), h('td', {}, p.client), h('td', {}, p.location), h('td', { class: 'n' }, p.contracts),
        h('td', {}, h('span', { class: `tag ${p.status === 'active' ? 'ok' : ''}` }, p.status === 'active' ? 'פעיל' : 'סגור')), h('td', { class: 'muted' }, dateLabel(p.created_at))))))))
    : h('div', { class: 'card empty' }, h('b', {}, 'עדיין אין פרויקטים'), 'צור פרויקט, ובתוכו חוזה מזמין, חוזי קבלני משנה או הצעות מחיר.');
  const COLORS = { returned: 'var(--bad)', index: 'var(--bad)', draft: 'var(--muted)', submitted: 'var(--warn)', meas: 'var(--warn)', change: 'var(--warn)', unpaid: 'var(--accent)', topay: 'var(--gold)' };
  const ORDER = ['returned', 'index', 'submitted', 'meas', 'change', 'draft', 'topay', 'unpaid'];
  const items = api.attention().sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  const days = (iso) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 864e5) : null);
  const attn = items.length ? h('section', {}, h('h2', { style: { margin: '0 0 10px' } }, `דורש טיפול (${items.length})`),
    h('div', { class: 'attn' }, items.slice(0, 18).map((x) => h('a', { href: `#/${x.go}` },
      h('span', { class: 'dot', style: { background: COLORS[x.kind] } }), h('b', {}, x.text, x.since && days(x.since) > 0 ? h('span', { class: 'muted', style: { fontWeight: 400 } }, ` · ${days(x.since)} ימים`) : null),
      x.amount ? h('span', { class: 'amt' }, money(x.amount)) : h('span'), h('small', {}, x.where)))),
    items.length > 18 ? h('div', { class: 'muted', style: { margin: '-8px 0 16px' } }, `ועוד ${items.length - 18}…`) : null) : null;
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'פרויקטים'), h('div', { class: 'sub' }, 'כתבי כמויות, הצעות מחיר וחשבונות')),
      h('div', { class: 'actions' }, h('button', { class: 'primary', onclick: () => projectForm(ctx) }, '+ פרויקט חדש'))),
    attn, body);
}

function contractRow(ctx, c, all) {
  const api = ctx.api;
  const v = api.contractValue(c.id);
  const isQuote = c.kind === 'quote';
  const bills = isQuote ? [] : api.bills(c.id);
  const last = [...bills].reverse().find((b) => b.status === 'approved');
  const open = bills.find((b) => b.status !== 'approved');
  const paid = bills.reduce((s, b) => s + b.paid, 0);
  const revs = isQuote ? api.revisions(c.id) : [];
  const converted = isQuote ? all.find((x) => x.kind === 'client' && x.origin_id === c.id) : null;
  const origin = !isQuote && c.origin_id ? all.find((x) => x.id === c.origin_id) : null;
  const openLabel = open ? (open.status === 'draft' && open.returned ? 'הוחזר לתיקונים' : open.status === 'submitted' && open.returned ? 'הוגש מחדש' : STATUS[open.status]) : '';
  return h('tr', { class: 'click', onclick: () => ctx.go(`c/${c.id}`) },
    h('td', {}, h('b', {}, c.name), c.number ? h('span', { class: 'muted' }, `  ${c.number}`) : null,
      h('div', { style: { display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '3px' } },
        c.version_label ? h('span', { class: 'tag' }, `גרסה: ${c.version_label}`) : null,
        !isQuote && c.locked ? h('span', { class: 'tag', title: 'כמויות ומחירי המכרז קפואים' }, '🔒 נעול') : null,
        converted ? h('span', { class: 'tag ok' }, `אושרה ← ${converted.name}`) : null,
        origin ? h('span', { class: 'tag' }, `מקור: ${origin.name}`) : null)),
    h('td', {}, c.party),
    h('td', { class: 'n' }, money(v.net)),
    h('td', { class: 'n' }, isQuote ? (revs.length ? `מהדורה ${revs[0].rev}` : '—') : last ? money(last.snap.cumNet) : '—'),
    h('td', {}, isQuote ? (revs.length ? `נשלחה ${revs[0].created_at.slice(8, 10)}/${revs[0].created_at.slice(5, 7)}` : 'טרם נשלחה') : last ? `${last.number} · ${monthLabel(last.month)}` : '—'),
    h('td', {}, open ? h('span', { class: `tag ${open.returned && open.status === 'draft' ? 'warn' : open.status}` }, `${open.number} ${openLabel}`) : (c.status === 'closed' ? h('span', { class: 'tag' }, 'סגור') : '')),
    h('td', { class: 'n' }, isQuote ? '' : money(paid)));
}

/** The project's flow at a glance: quote(s) → client contract → bills. */
function pipeline(ctx, all) {
  const api = ctx.api;
  const quotes = all.filter((c) => c.kind === 'quote');
  const client = all.find((c) => c.kind === 'client');
  const bills = client ? api.bills(client.id) : [];
  const lastA = [...bills].reverse().find((b) => b.status === 'approved');
  const open = bills.find((b) => b.status !== 'approved');
  const owed = bills.filter((b) => b.status === 'approved').reduce((s, b) => s + b.snap.due - b.paid, 0);
  const lastQ = quotes.at(-1);
  const revs = lastQ ? api.revisions(lastQ.id) : [];
  const step = (k, title, lines, go, empty) => h('button', { class: `pstep ${empty ? 'empty-step' : ''}`, onclick: go }, h('span', { class: 'k' }, k), h('b', {}, title), ...lines.filter(Boolean).map((l) => h('span', { class: 'v' }, l)));
  return h('div', { class: 'pipeline' },
    step('1 · הצעת מחיר', quotes.length ? `${quotes.length} ${quotes.length === 1 ? 'הצעה' : 'הצעות / גרסאות'}` : 'אין עדיין',
      [lastQ && `${lastQ.name}: ${money(api.contractValue(lastQ.id).net)}`, lastQ && (revs.length ? `מהדורה ${revs[0].rev} נשלחה` : 'טרם הופקה מהדורה')],
      () => (lastQ ? ctx.go(`c/${lastQ.id}`) : null), !quotes.length),
    h('span', { class: 'arrow' }, '‹'),
    step('2 · חוזה (כמויות מכרז)', client ? client.name : 'טרם אושרה הצעה',
      [client && `היקף: ${money(client.planned_cents || api.contractValue(client.id).net)}`, client && (client.locked ? '🔒 כתב הכמויות נעול' : 'פתוח לעריכה')],
      () => (client ? ctx.go(`c/${client.id}`) : null), !client),
    h('span', { class: 'arrow' }, '‹'),
    step('3 · חשבונות', client ? `${bills.length} חשבונות` : '—',
      [lastA && `מצטבר מאושר: ${money(lastA.snap.cumNet)}`, open && `חשבון ${open.number}: ${open.status === 'draft' && open.returned ? 'הוחזר לתיקונים' : STATUS[open.status]}`, owed > 0 && `יתרה לגבייה: ${money(owed)}`],
      () => (client ? ctx.go(`c/${client.id}/bills`) : null), !client));
}

export function projectView(ctx, id) {
  const api = ctx.api;
  const p = api.project(id);
  const all = api.contracts(id);
  const section = (kind, title, hint) => {
    const list = all.filter((c) => c.kind === kind);
    return h('div', { class: 'card' },
      h('header', {}, h('h2', {}, title), h('span', { class: 'muted' }, hint),
        h('div', { class: 'actions' },
          kind !== 'sub' ? h('button', { onclick: async () => { const { copyDialog } = await import('./versions.js'); copyDialog(ctx, { mode: 'copy', projectId: id, kind }); } }, 'העתקה מכתב כמויות קיים') : null,
          h('button', { class: kind === 'quote' && !all.some((c) => c.kind === 'quote') ? 'primary' : '', onclick: () => newContract(kind) }, `+ ${KIND[kind]}`))),
      list.length ? h('div', { class: 'table-wrap' }, h('table', { class: 't' },
        h('thead', {}, h('tr', {}, h('th', {}, 'שם'), h('th', {}, kind === 'sub' ? 'קבלן' : 'צד'), h('th', { class: 'n' }, kind === 'quote' ? 'סה"כ הצעה' : 'היקף חוזה'),
          h('th', { class: 'n' }, kind === 'quote' ? 'מהדורה' : 'מצטבר מאושר'), h('th', {}, kind === 'quote' ? 'נשלחה' : 'חשבון אחרון'), h('th', {}, 'פתוח'), h('th', { class: 'n' }, kind === 'quote' ? '' : 'שולם'))),
        h('tbody', {}, list.map((c) => contractRow(ctx, c, all)))))
        : h('div', { class: 'empty' }, 'אין עדיין'));
  };
  const newContract = (kind) => {
    if (kind === 'sub') {
      const clients = all.filter((c) => c.kind === 'client');
      formModal('קבלן משנה חדש', [
        { name: 'name', label: 'שם החוזה', required: true, span: true },
        { name: 'party', label: 'קבלן משנה' },
        { name: 'from', label: 'בסיס', type: 'select', value: '', options: [['', 'כתב כמויות ריק'], ...clients.map((c) => [c.id, `העתק סעיפים מ: ${c.name} (ללא מחירים)`])] },
      ], (v) => {
        const nid = v.from ? api.copyContract(+v.from, { kind: 'sub', name: v.name, party: v.party, keepPrices: false })
          : api.saveContract({ project_id: id, kind: 'sub', name: v.name, party: v.party });
        ctx.go(`c/${nid}`);
      });
    } else contractForm(ctx, { project_id: id, kind, party: p.client ?? '' });
  };
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, p.name), h('div', { class: 'sub' }, [p.client, p.location].filter(Boolean).join(' · '), `  ·  סף דקל ${p.dekel_threshold}%`)),
      h('div', { class: 'actions' },
        h('button', { onclick: () => ctx.go(`p/${id}/defects`) }, 'ליקויים'),
        h('button', { onclick: () => projectForm(ctx, p) }, 'עריכה'),
        h('button', { class: 'danger', onclick: async () => {
          if (await confirmBox('מחיקת פרויקט', `למחוק את "${p.name}" וכל החוזים שבו?`, { danger: true, ok: 'מחיקה' }))
            attempt(() => { api.deleteProject(id); ctx.go(''); }, 'הפרויקט נמחק');
        } }, 'מחיקה'))),
    pipeline(ctx, all),
    h('div', { class: 'stack' },
      section('quote', 'הצעות מחיר וגרסאות', 'בונים, מתמחרים ושולחים; אישור הופך הצעה לחוזה'),
      section('client', 'חוזה מזמין', 'כמויות ומחירי מכרז · חשבונות שאנו מגישים'),
      section('sub', 'קבלני משנה', 'חשבונות שאנו מאשרים')));
}
