// Dekel side panel (search, suggestions, link) and the contract-wide price check report.
import { h, attempt, toast } from './dom.js';
import { money, qty, lineCents } from '../money.js';
import { deviation, deviationFlag, quotePrice } from '../dekel.js';
import { itemCode, isBillable } from '../engine.js';
import { download } from '../persist.js';

function dkRow(dk, { item, isQuote, contract, onLink, onAdd, threshold }) {
  let devTag = null;
  if (item && item.kind !== 'note' && Number(item.price)) {
    const d = deviation(item.price, dk.price);
    devTag = h('span', { class: `dev-${deviationFlag(d, threshold)}`, title: 'סטיית מחיר הסעיף ממחיר זה' }, `${Number(d) > 0 ? '+' : ''}${Number(d).toFixed(1)}%`);
  }
  const unitMismatch = item?.unit && item.unit.replace(/[״"׳']/g, '') !== dk.unit.replace(/[״"׳']/g, '');
  return h('div', { class: 'dk-item' },
    h('div', { class: 'top' }, h('span', { class: 'code' }, dk.code), h('span', { class: 'tag' }, dk.unit), devTag,
      h('span', { class: 'price' }, `${qty(dk.price)} ₪`)),
    h('div', { class: 'desc' }, dk.description),
    isQuote && contract ? h('div', { class: 'muted', style: { fontSize: '12px' } }, `מחיר בהצעה לפי ההנחה הכללית: ${qty(quotePrice(dk.price, contract.quote_markup))} ₪`) : null,
    h('div', { style: { display: 'flex', gap: '6px' } },
      item && item.kind !== 'note' ? h('button', { class: 'sm primary', onclick: () => onLink(dk), title: unitMismatch ? `שים לב: יחידת הסעיף "${item.unit}" שונה` : '' },
        `${isQuote ? 'קשר ותמחר' : 'קשר להשוואה'}${unitMismatch ? ' ⚠' : ''}`) : null,
      h('button', { class: 'sm', onclick: () => onAdd(dk) }, 'הוסף כסעיף חדש')));
}

export function dekelPanel(ctx, { contract, item, threshold, defaultChapter, onLink, onAdd, onClose }) {
  const isQuote = contract.kind === 'quote';
  const head = h('header', {}, h('h2', {}, 'מחירון דקל'), h('span', { class: 'muted' }, ctx.dekel?.label ?? ''),
    h('button', { class: 'ghost icon', style: { marginInlineStart: 'auto' }, onclick: onClose, 'aria-label': 'סגירה' }, '✕'));
  if (!ctx.dekel) {
    return h('div', {}, head, h('div', { class: 'side-body' }, h('div', { class: 'alert' }, 'מחירון דקל לא נטען.'),
      h('button', { class: 'primary', onclick: () => ctx.go('settings') }, 'טעינת מחירון בהגדרות')));
  }
  const dk = ctx.dekel;
  const results = h('div');
  const chapters = h('select', { class: 'dk-search' }, h('option', { value: '' }, 'כל הפרקים'),
    [...dk.chapters].sort().map(([c, n]) => h('option', { value: c, selected: c === defaultChapter && false }, `${c} ${n}`)));
  const q = h('input', { type: 'search', class: 'dk-search', placeholder: 'חיפוש: מילים / קוד דקל' });
  const opts = { item, isQuote, contract, onLink, onAdd, threshold };
  const runSearch = () => {
    const text = q.value.trim();
    if (!text) { showSuggest(); return; }
    const exact = dk.get(text);
    const list = exact ? [exact] : dk.search(text, { chapter: chapters.value, limit: 80 });
    results.replaceChildren(h('h3', { style: { margin: '10px 0 0' } }, `${list.length}${list.length === 80 ? '+' : ''} תוצאות`), ...list.map((x) => dkRow(x, opts)));
  };
  const showSuggest = () => {
    if (!item || item.kind === 'note' || !item.description) {
      results.replaceChildren(h('p', { class: 'muted' }, 'בחר סעיף בכתב הכמויות כדי לקבל הצעות התאמה מדקל, או חפש חופשי.'));
      return;
    }
    const linked = item.dekel_code ? dk.get(item.dekel_code) : null;
    const sug = dk.suggest(item.description, item.unit, 12).filter((x) => x.code !== item.dekel_code);
    results.replaceChildren(...[
      linked ? h('div', {}, h('h3', { style: { margin: '10px 0 0' } }, 'מקושר כעת'), dkRow(linked, opts)) : null,
      h('h3', { style: { margin: '12px 0 0' } }, 'הצעות התאמה'),
      h('p', { class: 'muted', style: { fontSize: '12px', margin: '2px 0 0' } }, 'סעיפי דקל רבים נבדלים רק בטווח כמות/עומק/עובי — בחר את הסעיף המדויק.'),
      ...sug.map((x) => dkRow(x, opts))].filter(Boolean));
  };
  q.addEventListener('input', () => { clearTimeout(q._t); q._t = setTimeout(runSearch, 200); });
  chapters.addEventListener('change', runSearch);
  showSuggest();
  const info = item ? h('div', { class: 'card-body', style: { background: 'var(--surface-2)', borderRadius: '6px', padding: '8px 10px', marginBottom: '8px' } },
    h('div', { class: 'muted', style: { fontSize: '12px' } }, `סעיף ${itemCode(item)} · ${item.unit || ''} · ${qty(item.price)} ₪`),
    h('div', { style: { fontSize: '13px' } }, item.description.slice(0, 160))) : null;
  return h('div', {}, head, h('div', { class: 'side-body' }, info, h('div', { class: 'stack', style: { gap: '6px' } }, q, chapters), results));
}

export function dekelReportView(ctx, cid) {
  const api = ctx.api;
  const contract = api.contract(cid);
  const project = api.project(contract.project_id);
  const thr = project.dekel_threshold;
  const items = api.items(cid).filter((i) => i.kind !== 'note');
  if (ctx.dekel) {
    // refresh stale linked prices silently from the loaded book (display only)
    for (const it of items) if (it.dekel_code) { const d = ctx.dekel.get(it.dekel_code); if (d) it._live = d.price; }
  }
  const rows = items.map((it) => {
    const ref = it.dekel_price;
    const d = ref ? deviation(it.price, ref) : null;
    return { it, ref, d, flag: deviationFlag(d, thr), amount: lineCents(it.qty, it.price), refAmount: ref ? lineCents(it.qty, ref) : 0 };
  });
  const linked = rows.filter((r) => r.ref);
  const high = linked.filter((r) => r.flag === 'high'), low = linked.filter((r) => r.flag === 'low');
  const sumA = linked.reduce((s, r) => s + r.amount, 0), sumR = linked.reduce((s, r) => s + r.refAmount, 0);
  const total = rows.filter((r) => isBillable(r.it)).reduce((s, r) => s + r.amount, 0);
  let filter = 'flag';
  const tbody = h('tbody');
  const draw = () => {
    const list = filter === 'flag' ? rows.filter((r) => r.flag === 'high' || r.flag === 'low') : filter === 'unlinked' ? rows.filter((r) => !r.ref) : rows;
    tbody.replaceChildren(...list.map((r) => h('tr', { class: 'click', onclick: () => { ctx._focusItem = r.it.id; ctx.go(`c/${cid}`); } },
      h('td', { class: 'code' }, itemCode(r.it)), h('td', { class: 'desc' }, r.it.description.slice(0, 140)), h('td', {}, r.it.unit),
      h('td', { class: 'n' }, qty(r.it.qty)), h('td', { class: 'n' }, qty(r.it.price)),
      h('td', { class: 'code' }, r.it.dekel_code ?? ''), h('td', { class: 'n' }, r.ref ? qty(r.ref) : ''),
      h('td', { class: 'n' }, r.it._live && r.it._live !== r.ref ? h('span', { class: 'dev-low', title: 'המחיר במחירון הטעון שונה מהמחיר ששמור בסעיף' }, qty(r.it._live)) : ''),
      h('td', { class: 'n' }, r.d != null ? h('span', { class: `dev-${r.flag}` }, `${Number(r.d) > 0 ? '+' : ''}${Number(r.d).toFixed(1)}%`) : h('span', { class: 'muted' }, 'לא מקושר')),
      h('td', { class: 'n' }, r.ref ? money(r.amount - r.refAmount) : ''))));
  };
  draw();
  const btn = (k, l) => h('button', { class: filter === k ? 'primary' : '', onclick: (e) => { filter = k; e.target.parentNode.querySelectorAll('button').forEach((b) => b.classList.remove('primary')); e.target.classList.add('primary'); draw(); } }, l);
  const csv = () => {
    const lines = [['סעיף', 'תיאור', 'יחידה', 'כמות', 'מחיר', 'קוד דקל', 'מחיר דקל', 'סטייה %', 'הפרש ₪'].join(',')];
    for (const r of rows) lines.push([itemCode(r.it), `"${r.it.description.replace(/"/g, '""')}"`, r.it.unit, r.it.qty, r.it.price, r.it.dekel_code ?? '', r.ref ?? '', r.d ?? '', r.ref ? ((r.amount - r.refAmount) / 100).toFixed(2) : ''].join(','));
    download(`בדיקת דקל - ${contract.name}.csv`, new TextEncoder().encode('﻿' + lines.join('\r\n')), 'text/csv');
  };
  const relink = () => {
    if (!ctx.dekel) return toast('מחירון לא נטען', 'err');
    let n = 0;
    attempt(() => api.s.tx(() => { for (const r of rows) if (r.it._live && r.it._live !== r.ref) { api.linkDekel(r.it.id, ctx.dekel.get(r.it.dekel_code)); n++; } }, 'עדכון מחירי דקל'));
    toast(`עודכנו ${n} מחירי ייחוס`); ctx.refresh();
  };
  const stale = rows.filter((r) => r.it._live && r.it._live !== r.ref).length;
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'בדיקת תמחור מול דקל'), h('div', { class: 'sub' }, `${contract.name} · סף סטייה ${thr}% (בהגדרות הפרויקט)`)),
      h('div', { class: 'actions' }, stale ? h('button', { onclick: relink }, `עדכון ${stale} מחירי ייחוס למחירון הטעון`) : null,
        h('button', { onclick: csv }, 'ייצוא CSV'), h('button', { onclick: () => ctx.go(`c/${cid}`) }, 'חזרה לכתב הכמויות'))),
    h('div', { class: 'kpis' },
      h('div', { class: 'kpi' }, h('div', { class: 'l' }, 'סעיפים מקושרים לדקל'), h('div', { class: 'v' }, `${linked.length} / ${rows.length}`)),
      h('div', { class: 'kpi' }, h('div', { class: 'l' }, `מעל דקל ביותר מ-${thr}%`), h('div', { class: 'v dev-high' }, high.length)),
      h('div', { class: 'kpi' }, h('div', { class: 'l' }, `מתחת לדקל ביותר מ-${thr}%`), h('div', { class: 'v dev-low' }, low.length)),
      h('div', { class: 'kpi accent' }, h('div', { class: 'l' }, 'מקושרים: מחיר מול דקל'), h('div', { class: 'v' }, sumR ? `${((sumA / sumR - 1) * 100).toFixed(1)}%` : '—')),
      h('div', { class: 'kpi' }, h('div', { class: 'l' }, 'כיסוי כספי של הקישור'), h('div', { class: 'v' }, total ? `${Math.round((sumA / total) * 100)}%` : '—'))),
    h('div', { class: 'card' }, h('header', {}, h('div', { style: { display: 'flex', gap: '6px' } }, btn('flag', 'חריגים'), btn('unlinked', 'לא מקושרים'), btn('all', 'הכל')),
      h('span', { class: 'muted', style: { marginInlineStart: 'auto' } }, 'לחיצה על שורה פותחת את הסעיף בכתב הכמויות לקישור/תיקון')),
    h('div', { class: 'table-wrap' }, h('table', { class: 't' }, h('thead', {}, h('tr', {}, ['סעיף', 'תיאור', "יח'", 'כמות', 'מחיר', 'קוד דקל', 'מחיר דקל (שמור)', 'במחירון הטעון', 'סטייה', 'הפרש בסכום'].map((x, i) => h('th', { class: i >= 3 && i !== 5 ? 'n' : '' }, x)))), tbody))));
}
