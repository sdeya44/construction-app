// Versions of a BOQ: copy (whole or chosen chapters, to any project), import from another BOQ,
// compare two BOQs / a revision against the current state, and quote revisions (מהדורות).
import { h, modal, formModal, attempt, toast, dateLabel } from './dom.js';
import { money, lineCents, qty } from '../money.js';
import { isBillable } from '../engine.js';
import { KIND } from './projects.js';

/** Chapters (SS.CC) of a contract with names and gross amounts. */
function chaptersOf(api, cid) {
  const names = new Map(api.sections(cid).map((s) => [s.code, s.name]));
  const out = new Map();
  for (const it of api.items(cid)) {
    const k = `${it.struct}.${it.chapter}`;
    const g = out.get(k) ?? { code: k, name: `${names.get(it.struct) ? names.get(it.struct) + ' · ' : ''}${names.get(k) || `פרק ${it.chapter}`}`, n: 0, amount: 0 };
    if (it.kind !== 'note') g.n++;
    if (isBillable(it)) g.amount += lineCents(it.qty, it.price);
    out.set(k, g);
  }
  return [...out.values()].sort((a, b) => a.code.localeCompare(b.code));
}

const contractLabel = (c) => `${c.project_name ? c.project_name + ' — ' : ''}${c.name}${c.version_label ? ` (${c.version_label})` : ''} · ${KIND[c.kind]}`;

/**
 * mode: 'version' — new version of src in its project · 'copy' — new BOQ in any project ·
 *       'import' — append chosen chapters of another BOQ into `into`.
 */
export function copyDialog(ctx, { src = null, mode = 'copy', into = null, projectId = null, kind = null } = {}) {
  const api = ctx.api;
  const all = api.allContracts();
  let source = src ? api.contract(src) : null;
  const target = into ? api.contract(into) : null;
  const srcSel = h('select', {}, h('option', { value: '' }, '— בחר כתב כמויות מקור —'),
    all.filter((c) => c.id !== into).map((c) => h('option', { value: c.id, selected: c.id === source?.id }, contractLabel(c))));
  const name = h('input', { value: source ? (mode === 'version' ? source.name : `${source.name} — העתק`) : '' });
  const label = h('input', { placeholder: 'למשל: בטונים בלבד / חלופה ב׳' });
  const proj = h('select', {}, api.projects().map((p) => h('option', { value: p.id, selected: p.id === (projectId ?? source?.project_id) }, p.name)));
  const kindSel = h('select', {}, Object.entries(KIND).map(([k, l]) => h('option', { value: k, selected: k === (kind ?? source?.kind ?? 'quote') }, l)));
  const keep = h('input', { type: 'checkbox', checked: true });
  const chapBox = h('div', { class: 'chap-pick' });
  let checks = [];
  const drawChapters = () => {
    if (!source) { chapBox.replaceChildren(h('div', { class: 'muted' }, 'בחר מקור כדי לראות את הפרקים')); checks = []; return; }
    const list = chaptersOf(api, source.id);
    checks = list.map((g) => ({ g, el: h('input', { type: 'checkbox', checked: true }) }));
    chapBox.replaceChildren(
      h('div', { style: { display: 'flex', gap: '6px', marginBottom: '6px' } },
        h('button', { type: 'button', class: 'sm', onclick: () => checks.forEach((c) => { c.el.checked = true; }) }, 'בחר הכל'),
        h('button', { type: 'button', class: 'sm', onclick: () => checks.forEach((c) => { c.el.checked = false; }) }, 'נקה')),
      ...checks.map(({ g, el }) => h('label', { class: 'chap-row' }, el, h('span', { class: 'code' }, g.code), h('span', { class: 'nm' }, g.name),
        h('span', { class: 'muted' }, `${g.n} סעיפים`), h('span', { class: 'n' }, money(g.amount)))));
  };
  srcSel.addEventListener('change', () => { source = srcSel.value ? api.contract(+srcSel.value) : null; if (source && mode !== 'import') name.value = `${source.name} — העתק`; drawChapters(); });
  drawChapters();
  const field = (l, el, span) => h('label', { class: `field ${span ? 'span2' : ''}` }, h('span', {}, l), el);
  const title = mode === 'version' ? 'גרסה חדשה של כתב הכמויות' : mode === 'import' ? `העתקת סעיפים אל ${target.name}` : 'העתקת כתב כמויות';
  const intro = mode === 'version' ? 'נוצר עותק בתוך הפרויקט, באותה משפחת גרסאות. אפשר לבחור רק חלק מהפרקים (למשל בטונים בלבד) ולהשוות בין הגרסאות.'
    : mode === 'import' ? 'הפרקים שנבחרו יתווספו לכתב הכמויות הנוכחי. מספור כפול יבטל את ההעתקה כולה — לא יישמר דבר חלקית.'
      : 'יוצר כתב כמויות חדש מכל פרויקט. המקור אינו משתנה.';
  modal(title, [h('p', { class: 'muted' }, intro), h('div', { class: 'form-grid' },
    !src || mode === 'import' ? field('מקור', srcSel, true) : null,
    mode !== 'import' ? field('שם', name, true) : null,
    mode === 'version' ? field('תווית גרסה', label) : null,
    mode === 'copy' ? field('לפרויקט', proj) : null,
    mode === 'copy' ? field('סוג', kindSel) : null,
    h('label', { class: 'field check span2' }, keep, h('span', {}, 'להעתיק גם מחירים'))),
  h('h3', { style: { margin: '14px 0 6px' } }, 'פרקים להעתקה'), chapBox], { wide: true, actions: [{ label: 'ביטול' }, { label: mode === 'import' ? 'העתקה' : 'יצירה', primary: true, onClick: () => {
    if (!source) { toast('בחר מקור', 'err'); return false; }
    const chosen = checks.filter((c) => c.el.checked).map((c) => c.g.code);
    if (!chosen.length) { toast('לא נבחרו פרקים', 'err'); return false; }
    const chapters = chosen.length === checks.length ? null : chosen;
    if (mode === 'import') {
      const pick = new Set(chosen);
      const items = api.items(source.id).filter((i) => pick.has(`${i.struct}.${i.chapter}`) && i.change_status !== 'rejected')
        .map(({ id, contract_id, qsrc, meas_opening, source_item_id, ...i }) => ({ ...i, price: keep.checked ? i.price : '0', price_manual: 1, change_status: 'approved' }));
      const sections = api.sections(source.id).filter((s) => [...pick].some((c) => s.code === c.split('.')[0] || s.code === c || s.code.startsWith(c + '.')));
      const ok = attempt(() => api.importItems(target.id, { items, sections }), `הועתקו ${items.length} סעיפים`);
      if (ok === undefined) return false;
      ctx.refresh(); return true;
    }
    const id = attempt(() => api.copyContract(source.id, { kind: mode === 'version' ? source.kind : kindSel.value, name: name.value || source.name, party: source.party,
      keepPrices: keep.checked, projectId: mode === 'copy' ? +proj.value : null, chapters, asVersion: mode === 'version', versionLabel: label.value }));
    if (id === undefined) return false;
    toast(mode === 'version' ? 'נוצרה גרסה חדשה' : 'כתב הכמויות הועתק');
    ctx.go(`c/${id}`); return true;
  } }] });
}

// ---------------------------------------------------------------------------------------------
const ST = { added: ['נוסף', 'ok'], removed: ['הוסר', 'bad'], changed: ['שונה', 'warn'], same: ['זהה', ''] };

export function compareView(ctx, cid) {
  const api = ctx.api;
  const c = api.contract(cid);
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const withId = q.get('with') ? +q.get('with') : null, revId = q.get('rev') ? +q.get('rev') : null;
  const showSame = sessionStorage.getItem('cmp-same') === '1';
  const versions = api.versions(cid).filter((v) => v.id !== cid);
  const others = api.contracts(c.project_id).filter((x) => x.id !== cid && !versions.some((v) => v.id === x.id));
  const revs = api.revisions(cid);
  const pick = h('select', { onchange: (e) => { const [k, v] = e.target.value.split(':'); ctx.go(`c/${cid}/compare?${k}=${v}`); } },
    h('option', { value: '' }, '— בחר גרסה או מהדורה להשוואה —'),
    versions.length ? h('optgroup', { label: 'גרסאות של כתב כמויות זה' }, versions.map((v) => h('option', { value: `with:${v.id}`, selected: v.id === withId }, `${v.name}${v.version_label ? ` (${v.version_label})` : ''}`))) : null,
    revs.length ? h('optgroup', { label: 'מהדורות שהופקו (מול המצב הנוכחי)' }, revs.map((r) => h('option', { value: `rev:${r.id}`, selected: r.id === revId }, `מהדורה ${r.rev} · ${dateLabel(r.created_at)} · ${money(r.total_cents)}`))) : null,
    others.length ? h('optgroup', { label: 'כתבי כמויות אחרים בפרויקט' }, others.map((v) => h('option', { value: `with:${v.id}`, selected: v.id === withId }, `${v.name} · ${KIND[v.kind]}`))) : null);
  const head = h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'השוואת גרסאות'), h('div', { class: 'sub' }, c.name)),
    h('div', { class: 'actions' }, pick, h('button', { onclick: () => ctx.go(`c/${cid}`) }, 'חזרה לכתב הכמויות')));
  if (!withId && !revId) return h('div', { class: 'page' }, head, h('div', { class: 'card empty' }, h('b', {}, 'בחר מול מה להשוות'), versions.length || revs.length ? '' : 'אין עדיין גרסאות או מהדורות. צור גרסה ("כלים ← גרסה חדשה") או הפק מהדורה.'));
  const r = revId ? api.compareBoq({ revisionId: revId }, { contractId: cid }) : api.compareBoq({ contractId: cid }, { contractId: withId });
  const rows = r.rows.filter((x) => showSame || x.status !== 'same');
  const diff = r.totals.b - r.totals.a;
  const cell = (side, k) => side ? (k === 'total' ? money(side.total) : qty(side[k])) : '';
  return h('div', { class: 'page' }, head,
    h('div', { class: 'kpis' },
      h('div', { class: 'kpi' }, h('div', { class: 'l' }, `א׳ · ${r.a}`), h('div', { class: 'v' }, money(r.totals.a))),
      h('div', { class: 'kpi' }, h('div', { class: 'l' }, `ב׳ · ${r.b}`), h('div', { class: 'v' }, money(r.totals.b))),
      h('div', { class: 'kpi accent' }, h('div', { class: 'l' }, 'הפרש ב׳ − א׳'), h('div', { class: 'v', style: { color: diff < 0 ? 'var(--bad)' : diff > 0 ? 'var(--ok)' : '' } }, money(diff))),
      h('div', { class: 'kpi' }, h('div', { class: 'l' }, 'סעיפים'), h('div', { class: 'v', style: { fontSize: '15px' } }, `${r.counts.added} נוספו · ${r.counts.removed} הוסרו · ${r.counts.changed} שונו`))),
    h('div', { class: 'card', style: { marginBottom: '16px' } }, h('header', {}, h('h2', {}, 'לפי פרקים')), h('div', { class: 'table-wrap' }, h('table', { class: 't' },
      h('thead', {}, h('tr', {}, ['פרק', 'שם', 'א׳', 'ב׳', 'הפרש'].map((x, i) => h('th', { class: i >= 2 ? 'n' : '' }, x)))),
      h('tbody', {}, r.chapters.map((g) => h('tr', {}, h('td', { class: 'code' }, g.key), h('td', {}, g.name), h('td', { class: 'n' }, money(g.a)), h('td', { class: 'n' }, money(g.b)),
        h('td', { class: 'n', style: { color: g.b - g.a < 0 ? 'var(--bad)' : '' } }, g.b - g.a ? money(g.b - g.a) : ''))))))),
    h('div', { class: 'card' }, h('header', {}, h('h2', {}, 'סעיפים'),
      h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center', marginInlineStart: 'auto' } }, h('input', { type: 'checkbox', checked: showSame, onchange: (e) => { sessionStorage.setItem('cmp-same', e.target.checked ? '1' : '0'); ctx.refresh(); } }), 'הצג גם סעיפים זהים')),
      rows.length ? h('div', { class: 'table-wrap' }, h('table', { class: 't lines' },
        h('thead', {}, h('tr', {}, ['סעיף', 'תיאור', "יח'", 'שינוי', 'כמות א׳', 'כמות ב׳', 'מחיר א׳', 'מחיר ב׳', 'סה"כ א׳', 'סה"כ ב׳', 'הפרש'].map((x, i) => h('th', { class: i >= 4 ? 'n' : '' }, x)))),
        h('tbody', {}, rows.map((x) => h('tr', {},
          h('td', { class: 'code' }, x.code), h('td', { class: 'desc' }, x.description.length > 110 ? x.description.slice(0, 110) + '…' : x.description), h('td', {}, x.unit),
          h('td', {}, h('span', { class: `tag ${ST[x.status][1]}` }, ST[x.status][0])),
          h('td', { class: 'n' }, cell(x.a, 'qty')), h('td', { class: `n ${x.qtyChanged ? 'dev-low' : ''}` }, cell(x.b, 'qty')),
          h('td', { class: 'n' }, cell(x.a, 'price')), h('td', { class: `n ${x.priceChanged ? 'dev-low' : ''}` }, cell(x.b, 'price')),
          h('td', { class: 'n' }, cell(x.a, 'total')), h('td', { class: 'n' }, cell(x.b, 'total')),
          h('td', { class: 'n', style: { color: x.diff < 0 ? 'var(--bad)' : '' } }, x.diff ? money(x.diff) : '')))))) : h('div', { class: 'empty' }, 'אין הבדלים')));
}

// ---------------------------------------------------------------------------------------------
export function issueRevisionDialog(ctx, c) {
  const n = ctx.api.revisions(c.id).length + 1;
  formModal(`הפקת מהדורה ${n}`, [
    { name: 'recipient', label: 'נמען', value: c.party, span: true },
    { name: 'note', label: 'הערה (למשל: נשלח במייל לרכש)', type: 'textarea', span: true },
  ], (v) => { const id = ctx.api.issueRevision(c.id, v); toast(`מהדורה ${n} נשמרה`); ctx.go(`c/${c.id}/print?rev=${id}`); }, {
    submit: 'הפקה והדפסה',
    intro: h('p', { class: 'muted' }, 'נשמר עותק קפוא של ההצעה כפי שהיא עכשיו — מה שנשלח למזמין. ההצעה עצמה ממשיכה להיות ניתנת לעריכה, ותמיד אפשר להשוות אותה למהדורה שנשלחה.'),
  });
}

export function revisionsDialog(ctx, c) {
  const revs = ctx.api.revisions(c.id);
  const m = modal(`מהדורות — ${c.name}`, revs.length ? h('table', { class: 't' },
    h('thead', {}, h('tr', {}, ['מהדורה', 'תאריך', 'נמען', 'סה"כ', 'הערה', ''].map((x, i) => h('th', { class: i === 3 ? 'n' : '' }, x)))),
    h('tbody', {}, revs.map((r) => h('tr', {}, h('td', {}, h('b', {}, r.rev)), h('td', {}, dateLabel(r.created_at)), h('td', {}, r.recipient), h('td', { class: 'n' }, money(r.total_cents)), h('td', {}, r.note),
      h('td', { style: { whiteSpace: 'nowrap' } }, h('button', { class: 'sm', onclick: () => { m.close(); ctx.go(`c/${c.id}/print?rev=${r.id}`); } }, 'הדפסה'),
        h('button', { class: 'sm', onclick: () => { m.close(); ctx.go(`c/${c.id}/compare?rev=${r.id}`); } }, 'השוואה למצב הנוכחי'))))))
    : h('div', { class: 'empty' }, h('b', {}, 'טרם הופקו מהדורות'), 'לחץ "הפקת מהדורה" כדי לשמור עותק קפוא של מה שנשלח.'), { wide: true });
}
