// Minimal DOM helpers: h() builder, modal forms, toasts, confirm.
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function toast(msg, kind = 'ok') {
  let box = $('#toasts');
  if (!box) { box = h('div', { id: 'toasts' }); document.body.append(box); }
  const t = h('div', { class: `toast ${kind}`, role: kind === 'err' ? 'alert' : 'status' }, msg);
  box.append(t);
  setTimeout(() => t.classList.add('out'), kind === 'err' ? 7000 : 2600);
  setTimeout(() => t.remove(), kind === 'err' ? 7600 : 3200);
}

/** Run an action; show errors as toast. Returns the result (true for void) or undefined on failure. */
export function attempt(fn, okMsg) {
  try {
    const r = fn();
    if (okMsg) toast(okMsg);
    return r === undefined ? true : r;
  } catch (e) {
    console.error(e);
    toast(e.message || String(e), 'err');
    return undefined;
  }
}

export function modal(title, body, { actions = [], wide = false, onClose } = {}) {
  const close = () => { back.remove(); document.removeEventListener('keydown', key); onClose?.(); };
  const key = (e) => { if (e.key === 'Escape') close(); };
  const box = h('div', { class: `modal ${wide ? 'wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('header', {}, h('h2', {}, title), h('button', { class: 'icon ghost', 'aria-label': 'סגירה', onclick: close }, '✕')),
    h('div', { class: 'modal-body' }, body),
    actions.length ? h('footer', {}, actions.map((a) => h('button', { class: a.primary ? 'primary' : a.danger ? 'danger' : '', onclick: () => { if (a.onClick?.(close) !== false) close(); } }, a.label))) : null);
  const back = h('div', { class: 'backdrop', onmousedown: (e) => { if (e.target === back) close(); } }, box);
  document.body.append(back);
  document.addEventListener('keydown', key);
  setTimeout(() => box.querySelector('input,select,textarea,button.primary')?.focus(), 0);
  return { close, box };
}

export function confirmBox(title, text, { danger = false, ok = 'אישור' } = {}) {
  return new Promise((res) => {
    modal(title, h('p', { class: 'pre' }, text), { actions: [
      { label: 'ביטול', onClick: () => res(false) },
      { label: ok, primary: !danger, danger, onClick: () => res(true) },
    ], onClose: () => res(false) });
  });
}

/**
 * Form modal. fields: [{name,label,type,value,options,hint,span,required}]
 * onSubmit(values, close) → return false to keep open.
 */
export function formModal(title, fields, onSubmit, { submit = 'שמירה', wide = false, intro = null } = {}) {
  const form = h('form', { class: 'form-grid', onsubmit: (e) => { e.preventDefault(); go(); } });
  const inputs = {};
  // fields may be grouped into tabs ({type:'tab', label}) — shown one group at a time
  const tabs = [];
  let curTab = null;
  for (const f of fields) {
    if (f.type === 'tab') { curTab = tabs.length; tabs.push(f.label); continue; }
    if (f.type === 'section') { const el = h('h3', { class: 'span2 form-section' }, f.label); el.dataset.tab = curTab ?? ''; form.append(el); continue; }
    let input;
    if (f.type === 'select') input = h('select', { name: f.name }, f.options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(f.value ?? '') }, l)));
    else if (f.type === 'textarea') input = h('textarea', { name: f.name, rows: f.rows ?? 3 }, f.value ?? '');
    else if (f.type === 'checkbox') input = h('input', { type: 'checkbox', name: f.name, checked: !!f.value });
    else input = h('input', { name: f.name, type: f.type ?? 'text', value: f.value ?? '', inputmode: f.numeric ? 'decimal' : null, required: f.required, placeholder: f.placeholder ?? '', dir: f.numeric ? 'ltr' : null });
    let dl = null;
    if (f.list) { dl = h('datalist', { id: `dl-${f.name}-${Math.random().toString(36).slice(2, 8)}` }, f.list.map((o) => h('option', { value: o }))); input.setAttribute('list', dl.id); }
    inputs[f.name] = input;
    const lab = h('label', { class: `field ${f.span ? 'span2' : ''} ${f.type === 'checkbox' ? 'check' : ''}` },
      h('span', {}, f.label), input, dl, f.hint ? h('small', {}, f.hint) : null);
    lab.dataset.tab = curTab ?? '';
    form.append(lab);
  }
  let tabNav = null;
  if (tabs.length) {
    const show = (i) => {
      form.querySelectorAll('[data-tab]').forEach((el) => { el.hidden = el.dataset.tab !== '' && Number(el.dataset.tab) !== i; });
      tabNav.querySelectorAll('button').forEach((b, k) => b.classList.toggle('on', k === i));
    };
    tabNav = h('div', { class: 'form-tabs', role: 'tablist' }, tabs.map((t, i) => h('button', { type: 'button', role: 'tab', onclick: () => show(i) }, t)));
    setTimeout(() => show(0), 0);
    form.addEventListener('invalid', (e) => { const t = e.target.closest('[data-tab]')?.dataset.tab; if (t !== '' && t != null) show(Number(t)); }, true);
  }
  form.append(h('button', { type: 'submit', hidden: true }));
  const values = () => Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.type === 'checkbox' ? i.checked : i.value]));
  let m;
  const go = () => { try { if (onSubmit(values(), m.close) !== false) m.close(); } catch (e) { toast(e.message, 'err'); } };
  m = modal(title, [intro, tabNav, form], { wide, actions: [{ label: 'ביטול' }, { label: submit, primary: true, onClick: () => { go(); return false; } }] });
  return { ...m, inputs };
}

export const monthLabel = (m) => { if (!m) return ''; const [y, mo] = m.split('-'); return `${mo}/${y}`; };
export const dateLabel = (d) => { if (!d) return ''; const [y, m, dd] = d.slice(0, 10).split('-'); return `${dd}/${m}/${y}`; };

/** A button that opens a short list of actions under it. items: [[label, fn] | null]. */
export function menuButton(label, items, { cls = '' } = {}) {
  const btn = h('button', { class: `menu-btn ${cls}`, 'aria-haspopup': 'menu', onclick: (e) => {
    e.stopPropagation();
    document.querySelector('.menu-pop')?.remove();
    const r = btn.getBoundingClientRect();
    const pop = h('div', { class: 'menu-pop', role: 'menu', style: { top: `${r.bottom + 4}px`, right: `${Math.max(8, window.innerWidth - r.right)}px` } },
      items.filter(Boolean).map((it) => it === '-' ? h('hr') : h('button', { role: 'menuitem', disabled: !!it[2], title: typeof it[2] === 'string' ? it[2] : '', onclick: () => { close(); it[1](); } }, it[0])));
    const close = () => { pop.remove(); document.removeEventListener('click', close); document.removeEventListener('keydown', esc); };
    const esc = (ev) => { if (ev.key === 'Escape') close(); };
    document.body.append(pop);
    setTimeout(() => { document.addEventListener('click', close); document.addEventListener('keydown', esc); pop.querySelector('button:not([disabled])')?.focus(); });
  } }, label, ' ▾');
  return btn;
}
