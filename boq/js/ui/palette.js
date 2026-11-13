// Command palette (Ctrl/⌘+K): jump to any project, BOQ, contract, bill or screen, or run a command,
// by typing part of its name. Arrow keys move, Enter runs, Esc closes.
import { h } from './dom.js';
import { KIND } from './projects.js';

const norm = (s) => String(s ?? '').toLowerCase().replace(/[״"׳']/g, '').replace(/[ךםןףץ]/g, (c) => ({ 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' })[c]);

function entries(ctx, extra) {
  const api = ctx.api, out = [];
  const go = (p) => () => ctx.go(p);
  out.push(...extra);
  for (const [p, l] of [['', 'פרויקטים'], ['mgmt', 'דוחות מנהלים'], ['cashflow', 'תזרים'], ['status', 'מצב לתאריך'], ['indices', 'מדדים'], ['settings', 'הגדרות'], ['help', 'עזרה']])
    out.push({ group: 'מסכים', label: l, run: go(p) });
  try {
    for (const p of api.projects()) out.push({ group: 'פרויקטים', label: p.name, hint: [p.client, p.location].filter(Boolean).join(' · '), run: go(`p/${p.id}`) });
    for (const c of api.allContracts()) {
      out.push({ group: 'כתבי כמויות וחוזים', label: c.name, hint: `${KIND[c.kind]} · ${c.project_name}`, run: go(`c/${c.id}`) });
      if (c.kind !== 'quote') for (const b of api.bills(c.id)) out.push({ group: 'חשבונות', label: `חשבון ${b.number} · ${c.name}`, hint: `${c.project_name} · ${b.month ?? ''}`, run: go(`b/${b.id}`) });
    }
  } catch { /* store not ready */ }
  return out;
}

export function openPalette(ctx, extra = []) {
  if (document.querySelector('.palette')) return;
  const all = entries(ctx, extra);
  let shown = [], at = 0;
  const input = h('input', { type: 'search', placeholder: 'הקלד שם פרויקט, כתב כמויות, חשבון או פקודה…', 'aria-label': 'חיפוש פקודה', autocomplete: 'off' });
  const list = h('div', { class: 'pal-list', role: 'listbox' });
  const veil = h('div', { class: 'palette-veil no-print', onclick: (e) => { if (e.target === veil) close(); } },
    h('div', { class: 'palette', role: 'dialog', 'aria-label': 'לוח פקודות' }, h('div', { class: 'pal-in' }, h('span', { class: 'pal-k' }, '⌘K'), input), list,
      h('div', { class: 'pal-foot' }, '↑ ↓ מעבר · Enter פתיחה · Esc סגירה')));
  const draw = () => {
    const full = norm(input.value).trim(), q = full.split(/\s+/).filter(Boolean);
    // every word must appear; the name starting with / containing the whole query ranks first ("חשבון 2" before a 2026 date match)
    const rank = (x) => { const l = norm(x.label); return !full ? 0 : l.startsWith(full) ? 0 : l.includes(full) ? 1 : 2; };
    shown = all.map((x, i) => ({ x, i, t: norm(`${x.label} ${x.hint ?? ''} ${x.group}`) }))
      .filter(({ t }) => q.every((w) => t.includes(w)))
      .sort((a, b) => rank(a.x) - rank(b.x) || a.i - b.i).map(({ x }) => x).slice(0, 60);
    at = Math.min(at, Math.max(0, shown.length - 1));
    let last = null;
    list.replaceChildren(...shown.flatMap((x, i) => {
      const head = x.group !== last ? h('div', { class: 'pal-g' }, x.group) : null; last = x.group;
      return [head, h('button', { class: `pal-it ${i === at ? 'on' : ''}`, role: 'option', 'aria-selected': String(i === at), onmousemove: () => { if (at !== i) { at = i; mark(); } }, onclick: () => run(i) },
        h('span', {}, x.label), x.hint ? h('small', {}, x.hint) : null, x.key ? h('kbd', {}, x.key) : null)];
    }).filter(Boolean));
    if (!shown.length) list.append(h('div', { class: 'pal-empty' }, 'לא נמצא'));
  };
  const mark = () => list.querySelectorAll('.pal-it').forEach((b, i) => { b.classList.toggle('on', i === at); b.setAttribute('aria-selected', String(i === at)); if (i === at) b.scrollIntoView({ block: 'nearest' }); });
  const run = (i) => { const x = shown[i]; if (!x) return; close(); x.run(); };
  const close = () => { veil.remove(); document.removeEventListener('keydown', keys, true); };
  const keys = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); at = Math.min(at + 1, shown.length - 1); mark(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); at = Math.max(at - 1, 0); mark(); }
    else if (e.key === 'Enter') { e.preventDefault(); run(at); }
  };
  input.addEventListener('input', () => { at = 0; draw(); });
  document.addEventListener('keydown', keys, true);
  document.body.append(veil);
  draw();
  input.focus();
}
