// Multi-row selection in a grid: Ctrl/⌘+click toggles a row, Shift+click selects a range.
// A floating bar shows how many rows are selected and their total, with bulk actions.
import { h } from './dom.js';
import { money } from '../money.js';

/**
 * @param {HTMLElement} tbody  rows carry data-id
 * @param {{ amount?: (id:number)=>number|null, tsv: (id:number)=>string, header?: string,
 *           actions?: Array<[string, (ids:number[])=>void, {danger?:boolean}?]> }} o
 */
export function multiSelect(tbody, o) {
  const picked = new Set();
  let anchor = null;
  const bar = h('div', { class: 'selbar no-print', role: 'toolbar', 'aria-label': 'פעולות על השורות שנבחרו', hidden: true });
  const rows = () => [...tbody.querySelectorAll('tr[data-id]')];
  const paint = () => {
    rows().forEach((tr) => tr.classList.toggle('msel', picked.has(+tr.dataset.id)));
    if (!picked.size) { bar.hidden = true; return; }
    const ids = [...picked];
    const sum = o.amount ? ids.reduce((s, id) => s + (o.amount(id) ?? 0), 0) : null;
    bar.replaceChildren(
      h('b', {}, `${ids.length} ${ids.length === 1 ? 'שורה נבחרה' : 'שורות נבחרו'}`, sum != null ? h('span', { class: 'num' }, ` · ${money(sum)}`) : null),
      h('button', { class: 'p', onclick: () => copy(ids) }, 'העתקה לאקסל'),
      ...(o.actions ?? []).map(([label, fn, opt]) => h('button', { class: opt?.danger ? 'danger' : '', onclick: () => { const list = [...picked]; clear(); fn(list); } }, label)),
      h('button', { class: 'x', title: 'ביטול הבחירה (Esc)', 'aria-label': 'ביטול הבחירה', onclick: clear }, '✕'));
    bar.hidden = false;
    if (!bar.isConnected) document.body.append(bar);
  };
  const clear = () => { picked.clear(); anchor = null; paint(); };
  async function copy(ids) {
    const order = rows().map((tr) => +tr.dataset.id).filter((id) => ids.includes(id));
    const text = [o.header, ...order.map(o.tsv)].filter(Boolean).join('\n');
    try { await navigator.clipboard.writeText(text); } catch {
      const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } }, text); document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    const { toast } = await import('./dom.js');
    toast(`הועתקו ${order.length} שורות — אפשר להדביק באקסל`);
  }
  tbody.addEventListener('click', (e) => {
    if (!(e.ctrlKey || e.metaKey || e.shiftKey)) return;
    const tr = e.target.closest('tr[data-id]');
    if (!tr || !tbody.contains(tr)) return;
    e.preventDefault();
    const id = +tr.dataset.id;
    if (e.shiftKey && anchor != null) {
      const list = rows().map((r) => +r.dataset.id);
      const [a, b] = [list.indexOf(anchor), list.indexOf(id)].sort((x, y) => x - y);
      list.slice(a, b + 1).forEach((x) => picked.add(x));
    } else {
      picked.has(id) ? picked.delete(id) : picked.add(id);
      anchor = id;
    }
    document.getSelection()?.removeAllRanges();
    paint();
  }, true);
  // stop the browser's own shift-click text selection inside the grid
  tbody.addEventListener('mousedown', (e) => { if (e.shiftKey && !e.target.closest('input,textarea')) e.preventDefault(); });
  const esc = (e) => { if (e.key === 'Escape' && picked.size && !document.querySelector('.backdrop, .palette')) clear(); };
  document.addEventListener('keydown', esc);
  // the bar lives on <body>; drop it (and the key listener) once the grid leaves the page
  const watch = new MutationObserver(() => { if (!tbody.isConnected) { bar.remove(); document.removeEventListener('keydown', esc); watch.disconnect(); } });
  queueMicrotask(() => watch.observe(document.body, { childList: true, subtree: true }));
  return { clear, get ids() { return [...picked]; } };
}
