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
  [/^c\/(\d+)\/print$/, (m) => boqPrintView(ctx, +m[1])],
  [/^b\/(\d+)(?:\/(\w+))?$/, (m) => (m[2] === 'print' ? billPrintRoute(ctx, +m[1]) : billView(ctx, +m[1], m[2] || 'exec'))],
  [/^indices$/, () => indicesView(ctx)],
  [/^settings$/, () => settingsView(ctx)],
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
    else if ((m = path.match(/^b\/(\d+)/))) { const b = api.bill(+m[1]); addContract(b.contract_id); out.push([`חשבון ${b.number}`, `b/${b.id}`]); }
    else if (path === 'indices') out.push(['מדדים', 'indices']);
    else if (path === 'status') out.push(['מצב לתאריך', 'status']);
    else if (path === 'cashflow') out.push(['תזרים', 'cashflow']);
    else if (path === 'mgmt') out.push(['דוחות מנהלים', 'mgmt']);
    else if ((m = path.match(/^t\/(\d+)/))) { const t = api.tender(+m[1]); addContract(t.contract_id); out.push([`מכרז: ${t.name}`, `t/${t.id}`]); }
    else if (path === 'settings') out.push(['הגדרות', 'settings']);
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
    h('nav', { class: 'topnav' },
      h('a', { href: '#/', class: path === '' ? 'on' : '' }, 'פרויקטים'),
      h('a', { href: '#/mgmt', class: path === 'mgmt' ? 'on' : '' }, 'דוחות מנהלים'),
      h('a', { href: '#/cashflow', class: path === 'cashflow' ? 'on' : '' }, 'תזרים'),
      h('a', { href: '#/status', class: path === 'status' ? 'on' : '' }, 'מצב לתאריך'),
      h('a', { href: '#/indices', class: path === 'indices' ? 'on' : '' }, 'מדדים'),
      h('a', { href: '#/settings', class: path === 'settings' ? 'on' : '' }, 'הגדרות')),
    h('span', { class: `tag ${ctx.dekel ? 'ok' : 'warn'}`, title: ctx.dekel ? `${ctx.dekel.items.length.toLocaleString()} סעיפים` : 'טען מחירון בהגדרות' }, ctx.dekel ? `דקל ${ctx.dekel.label || ''}`.trim() : 'דקל לא נטען'),
    dot);
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
  const app = h('div', { class: 'app' }, topbar(path), h('main', { id: 'main' }, view));
  document.body.replaceChildren(app);
}

async function boot() {
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
