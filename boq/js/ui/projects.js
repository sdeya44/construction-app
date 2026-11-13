import { h, formModal, attempt, confirmBox, monthLabel, menuButton } from './dom.js';
import { money } from '../money.js';
import { INDEX_SERIES } from '../schema.js';

// a bill of quantities and a quote are the same document: the BOQ, priced and sent to the client
export const KIND = { client: 'חוזה מזמין', sub: 'קבלן משנה', quote: 'כתב כמויות / הצעה' };
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
    fields.push({ name: 'general_discount', label: 'הנחה כללית על כל הפרויקט %', value: c.general_discount ?? '0', numeric: true, hint: 'מופיעה בסוף ההצעה, אחרי הנחות המבנים / הפרקים / תתי-הפרקים' },
      { name: 'quote_markup', label: 'תמחור מדקל: תוספת (+) / הנחה (−) % למחירי היחידה', value: c.quote_markup ?? '0', numeric: true, hint: 'משנה מחירי יחידה של סעיפים מדקל, לדוגמה ‎-12' },
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

/** Home attention list ("דורש טיפול"), shown when no project is selected. */
function attentionList(ctx) {
  const api = ctx.api;
  const COLORS = { returned: 'var(--bad)', index: 'var(--bad)', draft: 'var(--muted)', submitted: 'var(--warn)', meas: 'var(--warn)', change: 'var(--warn)', unpaid: 'var(--accent)', topay: 'var(--gold)' };
  const ORDER = ['returned', 'index', 'submitted', 'meas', 'change', 'draft', 'topay', 'unpaid'];
  const items = api.attention().sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  const days = (iso) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 864e5) : null);
  return items.length ? h('section', {}, h('h2', { style: { margin: '0 0 10px' } }, `דורש טיפול (${items.length})`),
    h('div', { class: 'attn' }, items.slice(0, 18).map((x) => h('a', { href: `#/${x.go}` },
      h('span', { class: 'dot', style: { background: COLORS[x.kind] } }), h('b', {}, x.text, x.since && days(x.since) > 0 ? h('span', { class: 'muted', style: { fontWeight: 400 } }, ` · ${days(x.since)} ימים`) : null),
      x.amount ? h('span', { class: 'amt' }, money(x.amount)) : h('span'), h('small', {}, x.where)))),
    items.length > 18 ? h('div', { class: 'muted', style: { margin: '-8px 0 16px' } }, `ועוד ${items.length - 18}…`) : null) : null;
}

const LIST_SCROLL = 'proj-list-scroll';
/**
 * Projects screen, split in two: the project list on the right; the selected project's files
 * (its quotes / BOQs, client contracts and subcontracts — a project often has several, e.g.
 * electrical, finishes, plumbing) on the left. With nothing selected the left side shows what
 * needs attention across all projects.
 */
export function projectsView(ctx, selectedId = null) {
  const api = ctx.api;
  const list = api.projects();
  const q = sessionStorage.getItem('proj-q') ?? '';
  const ul = h('div', { class: 'pl-items', role: 'listbox', 'aria-label': 'פרויקטים' });
  const fill = (term) => {
    const t = term.trim();
    const shown = list.filter((p) => !t || `${p.name} ${p.client ?? ''} ${p.location ?? ''}`.includes(t));
    ul.replaceChildren(...(shown.length ? shown.map((p) => h('button', { class: `pl-item ${p.id === selectedId ? 'on' : ''} ${p.status === 'active' ? '' : 'closed'}`, role: 'option', 'aria-selected': String(p.id === selectedId),
      onclick: () => { try { sessionStorage.setItem(LIST_SCROLL, String(ul.scrollTop)); } catch { /* */ } ctx.go(`p/${p.id}`); } },
    h('span', { class: 'pl-name' }, p.name),
    h('span', { class: 'pl-meta' }, [p.client, p.location].filter(Boolean).join(' · ') || '—'),
    h('span', { class: 'pl-count' }, p.contracts ? `${p.contracts} ${p.contracts === 1 ? 'קובץ' : 'קבצים'}` : 'ריק', p.status === 'active' ? null : h('span', { class: 'tag' }, 'סגור'))))
      : [h('div', { class: 'empty' }, list.length ? 'לא נמצא פרויקט' : 'עדיין אין פרויקטים')]));
  };
  fill(q);
  const search = h('input', { type: 'search', class: 'pl-search', placeholder: 'חיפוש פרויקט / מזמין…', value: q,
    oninput: (e) => { try { sessionStorage.setItem('proj-q', e.target.value); } catch { /* */ } fill(e.target.value); } });
  const aside = h('aside', { class: 'pl' },
    h('div', { class: 'pl-head' }, h('h1', {}, 'פרויקטים'), h('button', { class: 'primary sm', onclick: () => projectForm(ctx) }, '+ פרויקט חדש')),
    list.length > 6 ? search : null, ul);
  requestAnimationFrame(() => { const y = +sessionStorage.getItem(LIST_SCROLL) || 0; ul.scrollTop = y; ul.querySelector('.pl-item.on')?.scrollIntoView({ block: 'nearest' }); });
  let detail;
  if (selectedId != null) detail = projectDetail(ctx, selectedId);
  else detail = h('div', { class: 'pd' },
    attentionList(ctx),
    h('div', { class: 'card empty' }, list.length
      ? [h('b', {}, '← בחר פרויקט מהרשימה'), 'יוצגו כאן כתבי הכמויות שלו (חשמל, גמרים, אינסטלציה…), ולכל אחד: ההצעה, החוזה שנבנה ממנו והחשבונות שבתוכו.']
      : [h('b', {}, 'עדיין אין פרויקטים'), 'צור פרויקט, ובתוכו כתבי כמויות; מכל כתב כמויות נבנה חוזה, ובתוך החוזה החשבונות.']));
  return h('div', { class: 'page full' }, h('div', { class: 'split' }, aside, h('div', { class: 'split-main' }, detail)));
}

/**
 * One card per bill of quantities (= the quote: the same document, priced and sent), showing its
 * whole life in this project: versions / editions → the client contract made from it → that
 * contract's bills, with the subcontracts taken from it underneath. Chains are rebuilt from the
 * links copyContract stores (origin_id, parent_id, version_group), so no data model change.
 */
function chains(all) {
  const byId = new Map(all.map((c) => [c.id, c]));
  const up = (c) => byId.get(c.kind === 'sub' ? (c.parent_id ?? c.origin_id) : c.origin_id) ?? null;
  const root = (c) => { const seen = new Set(); let r = c; while (up(r) && !seen.has(r.id)) { seen.add(r.id); r = up(r); } return r; };
  const map = new Map();
  for (const c of all) {
    const r = root(c);
    const key = r.kind === 'sub' ? 'orphan-subs' : r.version_group ?? r.id;
    if (!map.has(key)) map.set(key, { key, quotes: [], clients: [], subs: [] });
    map.get(key)[{ quote: 'quotes', client: 'clients', sub: 'subs' }[c.kind]].push(c);
  }
  const list = [...map.values()];
  for (const ch of list) { ch.head = ch.quotes[0] ?? ch.clients[0] ?? ch.subs[0]; }
  return list.sort((a, b) => (a.key === 'orphan-subs') - (b.key === 'orphan-subs') || a.head.id - b.head.id);
}

const billLabel = (b) => (b.status === 'draft' && b.returned ? 'הוחזר לתיקונים' : b.status === 'submitted' && b.returned ? 'הוגש מחדש' : STATUS[b.status]);

function boqCard(ctx, ch, project) {
  const api = ctx.api;
  const go = (path) => (e) => { e?.stopPropagation(); ctx.go(path); };
  const cell = (k, title, body, cls = '') => h('div', { class: `bc-step ${cls}` }, h('span', { class: 'k' }, k), title, ...body.filter(Boolean));
  // 1 · BOQ / quote (all versions; each with its sent editions)
  const qs = ch.quotes;
  const stepQ = qs.length
    ? cell('1 · כתב כמויות / הצעה', null, qs.map((q) => {
      const revs = api.revisions(q.id);
      return h('a', { class: 'bc-line', href: `#/c/${q.id}` },
        h('b', {}, q.version_label || (qs.length > 1 ? q.name : 'כתב הכמויות')), h('span', { class: 'n' }, money(api.contractValue(q.id).net)),
        h('small', {}, revs.length ? `מהדורה ${revs[0].rev} נשלחה ${revs[0].created_at.slice(8, 10)}/${revs[0].created_at.slice(5, 7)}` : 'טרם נשלח למזמין'));
    }))
    : cell('1 · כתב כמויות / הצעה', null, [h('small', { class: 'muted' }, 'החוזה נפתח ישירות, בלי שלב הצעה')], 'dim');
  // 2 · client contract
  const cl = ch.clients[0];
  const stepC = cl
    ? cell('2 · חוזה', null, [h('a', { class: 'bc-line', href: `#/c/${cl.id}` }, h('b', {}, cl.number ? `חוזה ${cl.number}` : 'חוזה מזמין'),
      h('span', { class: 'n' }, money(cl.planned_cents || api.contractValue(cl.id).net)), h('small', {}, cl.locked ? '🔒 כמויות ומחירים נעולים' : 'פתוח לעריכה'))])
    : cell('2 · חוזה', null, [h('small', { class: 'muted' }, 'עדיין לא נחתם'),
      qs.length ? h('button', { class: 'sm', onclick: go(`c/${qs.at(-1).id}`), title: 'פותח את כתב הכמויות — שם "אישור והמרה לחוזה"' }, 'אישור והמרה לחוזה ←') : null], 'dim');
  // 3 · bills
  let stepB;
  if (cl) {
    const bills = api.bills(cl.id);
    const lastA = [...bills].reverse().find((b) => b.status === 'approved');
    const open = bills.find((b) => b.status !== 'approved');
    const owed = bills.filter((b) => b.status === 'approved').reduce((t, b) => t + b.snap.due - b.paid, 0);
    stepB = cell('3 · חשבונות', null, [
      h('a', { class: 'bc-line', href: `#/c/${cl.id}/bills` }, h('b', {}, bills.length ? `${bills.length} חשבונות` : 'אין עדיין חשבונות'),
        h('span', { class: 'n' }, lastA ? money(lastA.snap.cumNet) : ''), h('small', {}, lastA ? `מצטבר מאושר (חשבון ${lastA.number} · ${monthLabel(lastA.month)})` : '')),
      open ? h('a', { class: `bc-tag tag ${open.returned && open.status === 'draft' ? 'warn' : open.status}`, href: `#/b/${open.id}` }, `חשבון ${open.number}: ${billLabel(open)}`) : null,
      owed > 0 ? h('small', {}, `יתרה לגבייה: ${money(owed)}`) : null]);
  } else stepB = cell('3 · חשבונות', null, [h('small', { class: 'muted' }, 'נפתחים אחרי החוזה')], 'dim');
  // subcontracts made from this BOQ
  const subs = ch.subs.map((sc) => {
    const bills = api.bills(sc.id);
    const last = bills.at(-1);
    return h('a', { class: 'bc-sub', href: `#/c/${sc.id}` }, h('b', {}, sc.party || sc.name), h('span', { class: 'muted' }, sc.party ? sc.name : ''),
      h('span', { class: 'n' }, money(api.contractValue(sc.id).net)), h('span', {}, last ? `חשבון ${last.number}: ${billLabel(last)}` : 'אין חשבונות'));
  });
  const name = ch.head.name.replace(/^(הצעה|חוזה|כתב כמויות)\s*[—–-]\s*/, '');
  return h('section', { class: 'card bcard' },
    h('header', {}, h('h2', {}, name), h('span', { class: 'muted' }, ch.head.party || project.client || ''),
      ch.head.version_label && qs.length === 1 ? h('span', { class: 'tag' }, ch.head.version_label) : null,
      h('div', { class: 'actions' },
        cl ? h('button', { class: 'sm', onclick: () => newSub(ctx, project.id, cl) }, '+ קבלן משנה') : null,
        cl ? h('button', { class: 'sm', title: 'השוואת הצעות של קבלני משנה על כתב הכמויות של החוזה', onclick: go(`c/${cl.id}/tenders`) }, 'מכרז קבלני משנה') : null)),
    h('div', { class: 'bc-flow' }, stepQ, h('span', { class: 'arrow' }, '‹'), stepC, h('span', { class: 'arrow' }, '‹'), stepB),
    subs.length ? h('div', { class: 'bc-subs' }, h('span', { class: 'k' }, 'קבלני משנה'), ...subs) : null);
}

function newSub(ctx, projectId, client) {
  const api = ctx.api;
  formModal('קבלן משנה חדש', [
    { name: 'party', label: 'קבלן משנה', required: true },
    { name: 'name', label: 'שם החוזה', value: client.name ? `${client.name.replace(/^חוזה\s*[—–-]\s*/, '')} — ` : '' },
    { name: 'from', label: 'בסיס', type: 'select', value: String(client.id), options: client.id ? [[String(client.id), `סעיפי ${client.name} (ללא מחירים)`], ['', 'כתב כמויות ריק']] : [['', 'כתב כמויות ריק']] },
  ], (v) => {
    const name = v.name?.trim() || v.party;
    const nid = v.from ? api.copyContract(+v.from, { kind: 'sub', name, party: v.party, keepPrices: false })
      : api.saveContract({ project_id: projectId, kind: 'sub', name, party: v.party });
    ctx.go(`c/${nid}`);
  });
}

export function projectView(ctx, id) { return projectsView(ctx, id); }

function projectDetail(ctx, id) {
  const api = ctx.api;
  const p = api.project(id);
  const all = api.contracts(id);
  const list = chains(all);
  const clients = all.filter((c) => c.kind === 'client');
  const scope = clients.reduce((t, c) => t + (c.planned_cents || api.contractValue(c.id).net), 0);
  const newBoq = () => contractForm(ctx, { project_id: id, kind: 'quote', party: p.client ?? '' });
  const empty = h('div', { class: 'card empty' }, h('b', {}, 'אין עדיין כתבי כמויות בפרויקט'),
    'כתב כמויות אחד לכל חוזה (חשמל, גמרים, אינסטלציה…): בונים או קולטים אותו, מתמחרים ושולחים כהצעה; אחרי אישור הוא הופך לחוזה, ובתוך החוזה נפתחים החשבונות.',
    h('div', { style: { marginTop: '12px', display: 'flex', gap: '8px', justifyContent: 'center' } },
      h('button', { class: 'primary', onclick: newBoq }, '+ כתב כמויות חדש'),
      h('button', { onclick: async () => { const { copyDialog } = await import('./versions.js'); copyDialog(ctx, { mode: 'copy', projectId: id, kind: 'quote' }); } }, 'העתקה מכתב כמויות קיים')));
  return h('div', { class: 'pd' },
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, p.name), h('div', { class: 'sub' }, [p.client, p.location].filter(Boolean).join(' · '),
        `  ·  ${list.filter((c) => c.key !== 'orphan-subs').length} כתבי כמויות`, clients.length ? `  ·  היקף חוזים ${money(scope)}` : '')),
      h('div', { class: 'actions' },
        h('button', { class: 'primary', onclick: newBoq }, '+ כתב כמויות'),
        menuButton('עוד', [
          ['העתקה מכתב כמויות קיים…', async () => { const { copyDialog } = await import('./versions.js'); copyDialog(ctx, { mode: 'copy', projectId: id, kind: 'quote' }); }],
          ['חוזה מזמין ישיר (בלי שלב הצעה)', () => contractForm(ctx, { project_id: id, kind: 'client', party: p.client ?? '' })],
          ['קבלן משנה ללא כתב כמויות', () => newSub(ctx, id, { id: '', name: '' })],
          '-',
          ['ליקויים', () => ctx.go(`p/${id}/defects`)],
          ['עריכת פרויקט', () => projectForm(ctx, p)],
          ['מחיקת פרויקט', async () => {
            if (await confirmBox('מחיקת פרויקט', `למחוק את "${p.name}" וכל כתבי הכמויות, החוזים והחשבונות שבו?`, { danger: true, ok: 'מחיקה' }))
              attempt(() => { api.deleteProject(id); ctx.go(''); }, 'הפרויקט נמחק');
          }],
        ]))),
    list.length ? h('div', { class: 'stack' }, list.map((ch) => (ch.key === 'orphan-subs'
      ? h('section', { class: 'card bcard' }, h('header', {}, h('h2', {}, 'קבלני משנה ללא כתב כמויות מקושר')),
        h('div', { class: 'bc-subs' }, ch.subs.map((sc) => h('a', { class: 'bc-sub', href: `#/c/${sc.id}` }, h('b', {}, sc.party || sc.name), h('span', { class: 'muted' }, sc.party ? sc.name : ''), h('span', { class: 'n' }, money(api.contractValue(sc.id).net)), h('span')))))
      : boqCard(ctx, ch, p)))) : empty);
}
