import { Store } from '../store.js';
import { Api } from '../api.js';
import { Dekel } from '../dekel.js';
import * as persist from '../persist.js';
import { h, $, toast } from './dom.js';
import { projectsView, projectView } from './projects.js';
import { boqView } from './boq.js';
import { billsView, billView } from './bills.js';
import { indicesView } from './indices.js';
import { settingsView } from './settings.js';
import { boqPrintView } from './print.js';
import { billPrintRoute } from './print-bill.js';
import { dekelReportView } from './dekel-ui.js';
import { profitView, statusView, defectsView } from './reports.js';
import { tendersView, tenderView, cashflowView, managementView } from './stage3.js';
import { measView, sheetsView } from './meas-ui.js';
import { themeButton, applyTheme, currentTheme, applyUi, uiPrefs, setUi, uiSwitch } from './theme.js';
import { compareView } from './versions.js';
import { helpView } from './help.js';

const ctx = {
  SQL: null, store: null, api: null, dekel: null,
  go(path) { location.hash = '#/' + path; },
  refresh() { render(); },
  async setDekel(bytes, label) {
    const d = new Dekel(ctx.SQL, bytes, label);
    await persist.saveDekel(bytes);
    ctx.dekel = d;
    return d;
  },
  crumbs: [],
};
globalThis.kayan = ctx; // handy for debugging from devtools

const ROUTES = [
  [/^$/, () => projectsView(ctx)],
  [/^p\/(\d+)$/, (m) => projectView(ctx, +m[1])],
  [/^c\/(\d+)$/, (m) => boqView(ctx, +m[1])],
  [/^c\/(\d+)\/bills$/, (m) => billsView(ctx, +m[1])],
  [/^c\/(\d+)\/dekel$/, (m) => dekelReportView(ctx, +m[1])],
  [/^c\/(\d+)\/profit$/, (m) => profitView(ctx, +m[1])],
  [/^p\/(\d+)\/defects$/, (m) => defectsView(ctx, +m[1])],
  [/^status$/, () => statusView(ctx)],
  [/^c\/(\d+)\/tenders$/, (m) => tendersView(ctx, +m[1])],
  [/^t\/(\d+)$/, (m) => tenderView(ctx, +m[1])],
  [/^cashflow$/, () => cashflowView(ctx)],
  [/^mgmt$/, () => managementView(ctx)],
  [/^c\/(\d+)\/print$/, (m) => boqPrintView(ctx, +m[1], new URLSearchParams(location.hash.split('?')[1] || '').get('rev'))],
  [/^c\/(\d+)\/compare$/, (m) => compareView(ctx, +m[1])],
  [/^m\/(\d+)$/, (m) => measView(ctx, +m[1])],
  [/^b\/(\d+)\/sheets$/, (m) => sheetsView(ctx, +m[1], new URLSearchParams(location.hash.split('?')[1] || '').get('item'))],
  [/^b\/(\d+)(?:\/(\w+))?$/, (m) => (m[2] === 'print' ? billPrintRoute(ctx, +m[1]) : billView(ctx, +m[1], m[2] || 'exec'))],
  [/^indices$/, () => indicesView(ctx)],
  [/^settings$/, () => settingsView(ctx)],
  [/^help$/, () => helpView()],
];

function crumbsFor(path) {
  const api = ctx.api, out = [];
  const addContract = (cid) => {
    const c = api.contract(cid), p = api.project(c.project_id);
    out.push([p.name, `p/${p.id}`], [c.name, `c/${c.id}`]);
    return c;
  };
  try {
    let m;
    if ((m = path.match(/^p\/(\d+)/))) { const p = api.project(+m[1]); out.push([p.name, `p/${p.id}`]); }
    else if ((m = path.match(/^c\/(\d+)/))) addContract(+m[1]);
    else if ((m = path.match(/^m\/(\d+)/))) { const it = api.item(+m[1]); addContract(it.contract_id); out.push([`דף חישוב ${it.chapter}.${it.sub}.${it.num}`, `m/${it.id}`]); }
    else if ((m = path.match(/^b\/(\d+)/))) { const b = api.bill(+m[1]); addContract(b.contract_id); out.push([`חשבון ${b.number}`, `b/${b.id}`]); }
    else if (path === 'indices') out.push(['מדדים', 'indices']);
    else if (path === 'status') out.push(['מצב לתאריך', 'status']);
    else if (path === 'cashflow') out.push(['תזרים', 'cashflow']);
    else if (path === 'mgmt') out.push(['דוחות מנהלים', 'mgmt']);
    else if ((m = path.match(/^t\/(\d+)/))) { const t = api.tender(+m[1]); addContract(t.contract_id); out.push([`מכרז: ${t.name}`, `t/${t.id}`]); }
    else if (path === 'settings') out.push(['הגדרות', 'settings']);
    else if (path === 'help') out.push(['עזרה', 'help']);
  } catch { /* stale link */ }
  return out;
}

function topbar(path) {
  const dot = h('span', { class: `save-dot ${persist.saveState.status}`, title: persist.dataLocation() }, saveText(persist.saveState.status));
  persist.saveState.listeners.clear();
  persist.saveState.listeners.add((s) => { dot.className = `save-dot ${s}`; dot.textContent = saveText(s); if (s === 'error') toast(`שגיאת שמירה: ${persist.saveState.error?.message}`, 'err'); });
  const crumbs = crumbsFor(path);
  return h('header', { class: 'topbar no-print' },
    h('a', { class: 'brand', href: '#/' }, 'KAYAN', h('small', {}, 'BOQ')),
    h('nav', { class: 'crumbs', 'aria-label': 'מיקום' }, h('a', { href: '#/' }, 'פרויקטים'),
      crumbs.map(([l, p]) => [h('span', { class: 'sep' }, '‹'), h('a', { href: '#/' + p }, l)])),
    h('div', { class: 'spacer' }),
    h('nav', { class: 'topnav' }, NAV.map(([p, l]) => h('a', { href: '#/' + p, class: path === p ? 'on' : '' }, l))),
    dekelTag(),
    undoButtons(),
    themeButton(render),
    uiSwitch(render),
    dot);
}
/** ↶ / ↷ — whole-database undo of the last saved changes (also Ctrl+Z / Ctrl+Y outside text fields). */
function undoButtons() {
  const s = ctx.store;
  if (!s) return null;
  return h('span', { class: 'undo-btns' },
    h('button', { class: 'sm ghost', disabled: !s.canUndo, title: s.canUndo ? `ביטול: ${s.undoLabel} (Ctrl+Z)` : 'אין מה לבטל', onclick: doUndo }, '↶ ביטול'),
    h('button', { class: 'sm ghost', disabled: !s.canRedo, title: s.canRedo ? `חזרה: ${s.redoLabel} (Ctrl+Y)` : 'אין מה להחזיר', onclick: doRedo }, '↷'));
}
function doUndo() { const l = ctx.store.undo(); if (l) { toast(`בוטל: ${l}`); render(); } }
function doRedo() { const l = ctx.store.redo(); if (l) { toast(`הוחזר: ${l}`); render(); } }
document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const el = document.activeElement;
  if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return; // native text undo
  if (document.querySelector('.backdrop')) return;
  const k = e.key.toLowerCase();
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); doUndo(); }
  else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); doRedo(); }
});
const NAV = [['', 'פרויקטים'], ['mgmt', 'דוחות מנהלים'], ['cashflow', 'תזרים'], ['status', 'מצב לתאריך'], ['indices', 'מדדים'], ['settings', 'הגדרות'], ['help', 'עזרה']];
const dekelTag = () => h('span', { class: `tag ${ctx.dekel ? 'ok' : 'warn'}`, title: ctx.dekel ? `${ctx.dekel.items.length.toLocaleString()} סעיפים` : 'טען מחירון בהגדרות' }, ctx.dekel ? `דקל ${ctx.dekel.label || ''}`.trim() : 'דקל לא נטען');
function sidenav(path) {
  const sect = path.split('/')[0];
  const on = (p) => (p === '' ? ['', 'p', 'c', 'b', 'm', 't'].includes(sect) : sect === p);
  return h('aside', { class: 'sidenav no-print' },
    h('a', { class: 'brand', href: '#/' }, 'KAYAN', h('small', {}, 'BOQ')),
    h('h4', {}, 'עבודה'), NAV.slice(0, 1).map(([p, l]) => h('a', { class: `nav ${on(p) ? 'on' : ''}`, href: '#/' + p }, l)),
    h('h4', {}, 'דוחות'), NAV.slice(1, 4).map(([p, l]) => h('a', { class: `nav ${on(p) ? 'on' : ''}`, href: '#/' + p }, l)),
    h('h4', {}, 'מערכת'), NAV.slice(4).map(([p, l]) => h('a', { class: `nav ${on(p) ? 'on' : ''}`, href: '#/' + p }, l)),
    h('div', { class: 'foot' }, dekelTag(), h('span', {}, 'כיאן הנדסה בע"מ')));
}
const saveText = (s) => ({ saved: 'נשמר', pending: 'ממתין לשמירה', saving: 'שומר…', error: 'שגיאת שמירה' }[s]);

let renderToken = 0;
function render() {
  const token = ++renderToken;
  const path = decodeURI(location.hash.replace(/^#\/?/, '')).split('?')[0];
  let view;
  try {
    const r = ROUTES.find(([re]) => re.test(path));
    view = r ? r[1](path.match(r[0])) : h('div', { class: 'page empty' }, h('b', {}, 'הדף לא נמצא'), h('a', { href: '#/' }, 'חזרה לפרויקטים'));
  } catch (e) {
    console.error(e);
    view = h('div', { class: 'page' }, h('div', { class: 'alert err' }, e.message), h('a', { href: '#/' }, 'חזרה לפרויקטים'));
  }
  if (token !== renderToken) return;
  const main = h('main', { id: 'main' }, view);
  if (uiPrefs().mode === 'cg') { document.body.replaceChildren(cgShell(path, main)); return; }
  const app = currentTheme().layout === 'side'
    ? h('div', { class: 'app side-layout' }, sidenav(path), h('div', { class: 'app-main' }, topbar(path), main))
    : h('div', { class: 'app' }, topbar(path), main);
  document.body.replaceChildren(app);
}

// ---------- "בטון וזכוכית" shell: dark bar with segmented navigation, icon rail, status bar ----------
const ICONS = {
  home: 'M3 11 12 4l9 7v9H3zM9 20v-6h6v6', folder: 'M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2', cash: 'M2 6h20v12H2zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6', clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7v5l3 2',
  index: 'M3 17l6-6 4 4 8-8M15 7h6v6', gear: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1',
  help: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5V14M12 17.5v.01',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4', moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5',
  rows: 'M4 6h16M4 10h16M4 14h16M4 18h16', rowsWide: 'M4 7h16M4 12h16M4 17h16',
};
const svg = (d) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'cg-i'); s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); s.append(p); return s; };
const CG_MAIN = [['', 'פרויקטים'], ['mgmt', 'דוחות מנהלים'], ['cashflow', 'תזרים'], ['status', 'מצב לתאריך']];
const CG_RAIL = [['', 'folder', 'פרויקטים'], ['mgmt', 'chart', 'דוחות מנהלים'], ['cashflow', 'cash', 'תזרים'], ['status', 'clock', 'מצב לתאריך'], ['indices', 'index', 'מדדים'], '-', ['settings', 'gear', 'הגדרות'], ['help', 'help', 'עזרה']];
function cgShell(path, main) {
  const sect = path.split('/')[0];
  const isOn = (p) => (p === '' ? ['', 'p', 'c', 'b', 'm', 't'].includes(sect) : sect === p);
  const pref = uiPrefs();
  const dot = h('span', { class: `save-dot ${persist.saveState.status}`, title: persist.dataLocation() }, saveText(persist.saveState.status));
  persist.saveState.listeners.clear();
  persist.saveState.listeners.add((s) => { dot.className = `save-dot ${s}`; dot.textContent = saveText(s); if (s === 'error') toast(`שגיאת שמירה: ${persist.saveState.error?.message}`, 'err'); });
  const crumbs = crumbsFor(path);
  const bar = h('header', { class: 'cg-bar no-print' },
    h('a', { class: 'cg-mono', href: '#/', title: 'KAYAN BOQ' }, h('i', {}, 'כ'), h('b', {}, 'KAYAN')),
    h('nav', { class: 'cg-seg', 'aria-label': 'ניווט ראשי' }, CG_MAIN.map(([p, l]) => h('a', { href: '#/' + p, class: isOn(p) ? 'on' : '' }, l))),
    h('nav', { class: 'cg-crumbs', 'aria-label': 'מיקום' }, crumbs.map(([l, p], i) => [i ? h('span', { class: 'sep' }, '‹') : null, h('a', { href: '#/' + p, class: i === crumbs.length - 1 ? 'cur' : '' }, l)])),
    h('div', { class: 'spacer' }),
    undoButtons(),
    h('button', { class: 'cg-ico', title: pref.night ? 'מצב יום' : 'מצב לילה', onclick: () => { setUi({ night: !pref.night }); render(); } }, svg(pref.night ? ICONS.sun : ICONS.moon)),
    h('button', { class: 'cg-ico', title: pref.dense ? 'צפיפות רגילה' : 'צפיפות גבוהה — יותר שורות במסך', onclick: () => { setUi({ dense: !pref.dense }); render(); } }, svg(pref.dense ? ICONS.rowsWide : ICONS.rows)),
    uiSwitch(render));
  const rail = h('nav', { class: 'cg-rail no-print', 'aria-label': 'אזורים' },
    CG_RAIL.map((x) => (x === '-' ? h('hr') : h('a', { href: '#/' + x[0], class: isOn(x[0]) ? 'on' : '', title: x[2], 'aria-label': x[2] }, svg(ICONS[x[1]])))));
  const status = h('footer', { class: 'cg-status no-print' }, dot,
    dekelTag(),
    ctx.store?.canUndo ? h('span', { class: 'muted' }, `פעולה אחרונה: ${ctx.store.undoLabel}`) : null,
    h('span', { class: 'cg-sel', id: 'cg-sel' }),
    h('div', { class: 'spacer' }),
    h('span', {}, `${pref.dense ? 'צפוף' : 'רגיל'} · ${pref.night ? 'לילה' : 'יום'}`),
    h('span', {}, 'כיאן הנדסה בע"מ'));
  return h('div', { class: 'app cg-app' }, bar, rail, main, status);
}
// status bar: count / sum of the numbers in the selected table cells (like a spreadsheet)
document.addEventListener('selectionchange', () => {
  const out = document.getElementById('cg-sel');
  if (!out) return;
  const sel = document.getSelection();
  const txt = sel && !sel.isCollapsed ? sel.toString() : '';
  const nums = (txt.match(/-?\d[\d,]*\.?\d*/g) || []).map((x) => Number(x.replace(/,/g, ''))).filter((x) => Number.isFinite(x));
  out.textContent = nums.length > 1 ? `נבחרו ${nums.length} ערכים · סכום ${nums.reduce((a, b) => a + b, 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '';
});

async function boot() {
  applyTheme();
  applyUi();
  try {
    ctx.SQL = await globalThis.initSqlJs({ locateFile: (f) => `vendor/${f}` });
    const bytes = await persist.loadData();
    ctx.store = new Store(ctx.SQL, bytes, persist.scheduleSave);
    ctx.api = new Api(ctx.store);
    if (!bytes) persist.scheduleSave(ctx.store.export());
    persist.requestPersistence();
    const dk = await persist.loadDekel();
    if (dk) { try { ctx.dekel = new Dekel(ctx.SQL, dk, ctx.store.get("SELECT value FROM meta WHERE key='dekel_label'")?.value ?? ''); } catch (e) { toast(`מחירון דקל: ${e.message}`, 'err'); } }
    window.addEventListener('hashchange', render);
    render();
  } catch (e) {
    console.error(e);
    $('#boot').replaceChildren(h('b', {}, 'שגיאה בטעינה'), h('div', { class: 'pre' }, e.message));
  }
}
boot();
