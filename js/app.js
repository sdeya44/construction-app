import { D } from './state.js';
import { go, can, openSheet, closeSheet, initSheetSwipe, setupPullToRefresh } from './utils.js';
import { signIn, tryAutoLogin } from './auth.js';
import { renderDash, refreshData } from './screens/dashboard.js';
import { renderLogs, setLogTab, filterLogs, populateLogFilters } from './screens/logs.js';
import { renderEmps, setEmpTab, filterEmps, openAddEmp, selectStatus, saveEmp } from './screens/employees.js';
import { renderSites, setSiteTab, openAddSite, selectSiteStatus, saveSite } from './screens/sites.js';
import { renderMgmt, setMgmtTab, mgmtAdd, selectSuppStatus, selectEquipStatus, saveSupp, saveEquip } from './screens/management.js';
import { startLog } from './screens/wizard.js';
import { handlePhotoUpload } from './screens/photos.js';
import { renderReports, genReport, exportSummaryPDF, exportAllEmployeesPDF, exportMonthCSV, exportSiteMonthPDF, lockMonth, drawLocks, initSelects } from './screens/reports.js';
import { renderSearch } from './screens/search.js';

const DARK_KEY = 'cnstr_dark';
const FONT_KEY = 'cnstr_font';

function initPrefs() {
  if (localStorage.getItem(DARK_KEY) === '1') document.documentElement.setAttribute('data-theme', 'dark');
  if (localStorage.getItem(FONT_KEY) === '1') document.documentElement.setAttribute('data-fontsize', 'large');
}

function renderSettings() {
  const isDark  = document.documentElement.getAttribute('data-theme') === 'dark';
  const isLarge = document.documentElement.getAttribute('data-fontsize') === 'large';
  document.getElementById('settings-body').innerHTML = `
    <div class="settings-row">
      <div><div class="settings-label">🌙 מצב כהה</div><div class="settings-sub">רקע כהה לשימוש בלילה</div></div>
      <label class="toggle-sw"><input type="checkbox" id="dark-toggle" ${isDark?'checked':''}><span class="toggle-track"></span></label>
    </div>
    <div class="settings-row">
      <div><div class="settings-label">🔤 גופן גדול</div><div class="settings-sub">טקסט גדול לשימוש בשטח</div></div>
      <label class="toggle-sw"><input type="checkbox" id="fontsize-toggle" ${isLarge?'checked':''}><span class="toggle-track"></span></label>
    </div>
    <div class="divider" style="margin:8px 0 16px"></div>
    <button class="btn btn-danger" id="logout-confirm-btn">🚪 התנתקות</button>
    <button class="btn btn-ghost mt8" id="settings-close">סגור</button>`;
  document.getElementById('dark-toggle').addEventListener('change', e => {
    e.target.checked ? document.documentElement.setAttribute('data-theme','dark') : document.documentElement.removeAttribute('data-theme');
    localStorage.setItem(DARK_KEY, e.target.checked ? '1' : '0');
  });
  document.getElementById('fontsize-toggle').addEventListener('change', e => {
    e.target.checked ? document.documentElement.setAttribute('data-fontsize','large') : document.documentElement.removeAttribute('data-fontsize');
    localStorage.setItem(FONT_KEY, e.target.checked ? '1' : '0');
  });
  document.getElementById('logout-confirm-btn').addEventListener('click', () => { if (confirm('להתנתק?')) location.reload(); });
  document.getElementById('settings-close').addEventListener('click', () => closeSheet('sh-settings'));
}

function openSettings() { renderSettings(); openSheet('sh-settings'); }

function initRipple() {
  document.addEventListener('pointerdown', e => {
    const el = e.target.closest('.btn, .chip, .nav-item, .sel-item, .quick-site-chip, .group-chip, .list-item.clickable');
    if (!el) return;
    const rect = el.getBoundingClientRect(), size = Math.max(rect.width, rect.height);
    const r = document.createElement('span');
    r.className = 'ripple-el';
    r.style.cssText = `width:${size}px;height:${size}px;top:${e.clientY-rect.top-size/2}px;left:${e.clientX-rect.left-size/2}px`;
    el.appendChild(r);
    setTimeout(() => r.remove(), 600);
  }, { passive: true });
}

export function renderCurrentScreen() {
  const s = D.activeScreen || 'dash';
  if (s==='dash')    renderDash();
  else if (s==='logs')   { populateLogFilters(); renderLogs(); }
  else if (s==='emp')    renderEmps();
  else if (s==='sites')  renderSites();
  else if (s==='mgmt')   renderMgmt();
  else if (s==='reports') renderReports();
  else if (s==='search') renderSearch('field');
}

function navigate(s) { go(s); renderCurrentScreen(); }

const GM_PANEL_TABS = new Set(['payroll','equip','calendar','search','admin']);
const GM_NAV_TABS   = { reports:'reports', logs:'logs', sites:'sites', emp:'emp', mgmt:'mgmt' };

export function openGMPanel() {
  const panel = document.getElementById('gm-panel'); if (!panel) return;
  if (panel.classList.contains('open')) return;
  panel.style.display = 'flex';
  requestAnimationFrame(() => panel.classList.add('open'));
  renderGMTab(GM_PANEL_TABS.has(D.gmTab) ? D.gmTab : 'payroll');
}

export function closeGMPanel() {
  const panel = document.getElementById('gm-panel'); if (!panel) return;
  panel.classList.remove('open');
  setTimeout(() => { if (!panel.classList.contains('open')) panel.style.display = 'none'; }, 380);
}

export function renderGMTab(tab) {
  if (GM_PANEL_TABS.has(tab)) D.gmTab = tab;
  document.querySelectorAll('#gm-tabs .gm-tab').forEach(el => el.classList.toggle('active', el.dataset.tab === tab));
  if (tab === 'payroll')  import('./screens/payroll.js').then(m => m.renderPayroll());
  else if (tab === 'equip')    import('./screens/equipment.js').then(m => m.renderEquipScreen());
  else if (tab === 'calendar') import('./screens/calendar.js').then(m => m.renderCalendar());
  else if (tab === 'search')   import('./screens/search.js').then(m => m.renderSearch('gm'));
  else if (tab === 'admin')    import('./screens/admin.js').then(m => m.renderAdmin());
  else if (tab in GM_NAV_TABS) {
    closeGMPanel();
    if (tab === 'logs') { populateLogFilters(); navigate('logs'); }
    else navigate(GM_NAV_TABS[tab]);
  }
}

export function applyRoleUI() {
  const isGM = D.role === 'GeneralManager';
  document.getElementById('nav-newlog').style.display    = can('create_log') ? '' : 'none';
  document.getElementById('btn-open-gm').style.display   = isGM ? '' : 'none';
  document.getElementById('nav-search').style.display    = isGM ? '' : 'none';
  document.getElementById('nav-reports').style.display   = isGM ? 'none' : '';
  document.querySelectorAll('[data-role-require]').forEach(el => {
    el.style.display = can(el.dataset.roleRequire) ? '' : 'none';
  });
}

function bindEvents() {
  document.getElementById('g-btn')?.addEventListener('click', signIn);

  document.getElementById('nav-dash')?.addEventListener('click',    () => navigate('dash'));
  document.getElementById('nav-sites')?.addEventListener('click',   () => navigate('sites'));
  document.getElementById('nav-newlog')?.addEventListener('click',  startLog);
  document.getElementById('nav-logs')?.addEventListener('click',    () => { populateLogFilters(); navigate('logs'); });
  document.getElementById('nav-reports')?.addEventListener('click', () => navigate('reports'));
  document.getElementById('nav-search')?.addEventListener('click',  () => navigate('search'));

  document.getElementById('btn-open-gm')?.addEventListener('click', openGMPanel);
  document.getElementById('btn-close-gm')?.addEventListener('click', closeGMPanel);
  document.getElementById('gm-panel')?.addEventListener('click', e => { if (e.target === document.getElementById('gm-panel')) closeGMPanel(); });

  document.querySelectorAll('#gm-tabs .gm-tab').forEach(tab => tab.addEventListener('click', () => renderGMTab(tab.dataset.tab)));

  document.getElementById('refresh-btn')?.addEventListener('click', refreshData);
  document.getElementById('logout-btn')?.addEventListener('click', openSettings);

  document.getElementById('log-q')?.addEventListener('input', filterLogs);
  document.getElementById('log-filter-site')?.addEventListener('change', filterLogs);
  document.getElementById('log-filter-act')?.addEventListener('change', filterLogs);
  document.querySelectorAll('#s-logs .tab').forEach(tab => tab.addEventListener('click', () => setLogTab(tab.dataset.tab, tab)));

  document.getElementById('emp-q')?.addEventListener('input', filterEmps);
  document.getElementById('btn-add-emp')?.addEventListener('click', openAddEmp);
  document.getElementById('btn-save-emp')?.addEventListener('click', saveEmp);
  document.getElementById('sc-active')?.addEventListener('click', () => selectStatus('active'));
  document.getElementById('sc-frozen')?.addEventListener('click', () => selectStatus('frozen'));
  document.querySelectorAll('#s-emp .tab').forEach(tab => tab.addEventListener('click', () => setEmpTab(tab.dataset.tab, tab)));

  document.getElementById('btn-add-site')?.addEventListener('click', openAddSite);
  document.getElementById('btn-save-site')?.addEventListener('click', saveSite);
  document.getElementById('ss-active')?.addEventListener('click', () => selectSiteStatus('פעיל'));
  document.getElementById('ss-frozen')?.addEventListener('click', () => selectSiteStatus('מוקפא'));
  document.getElementById('ss-ended')?.addEventListener('click',  () => selectSiteStatus('הסתיים'));
  document.querySelectorAll('#s-sites .tab').forEach(tab => tab.addEventListener('click', () => setSiteTab(tab.dataset.tab, tab)));

  document.getElementById('mgmt-add-btn')?.addEventListener('click', mgmtAdd);
  document.getElementById('btn-save-supp')?.addEventListener('click', saveSupp);
  document.getElementById('btn-save-equip')?.addEventListener('click', saveEquip);
  document.getElementById('ssp-active')?.addEventListener('click', () => selectSuppStatus('פעיל'));
  document.getElementById('ssp-frozen')?.addEventListener('click', () => selectSuppStatus('מוקפא'));
  document.getElementById('seq-active')?.addEventListener('click', () => selectEquipStatus('פעיל'));
  document.getElementById('seq-frozen')?.addEventListener('click', () => selectEquipStatus('מוקפא'));
  document.querySelectorAll('#s-mgmt .tab').forEach(tab => tab.addEventListener('click', () => setMgmtTab(tab.dataset.tab, tab)));

  document.getElementById('btn-gen-report')?.addEventListener('click', genReport);
  document.getElementById('btn-summary-pdf')?.addEventListener('click', exportSummaryPDF);
  document.getElementById('btn-full-pdf')?.addEventListener('click', exportAllEmployeesPDF);
  document.getElementById('btn-csv')?.addEventListener('click', exportMonthCSV);

  document.getElementById('btn-lock-month')?.addEventListener('click', lockMonth);
  document.getElementById('sh-lock')?.addEventListener('click', e => { if (e.target === document.getElementById('sh-lock')) closeSheet('sh-lock'); });
  document.querySelector('#s-reports .topbar-btn')?.addEventListener('click', () => { drawLocks(); openSheet('sh-lock'); });

  document.getElementById('btn-cancel-emp')?.addEventListener('click',   () => closeSheet('sh-emp'));
  document.getElementById('btn-cancel-site')?.addEventListener('click',  () => closeSheet('sh-site'));
  document.getElementById('btn-cancel-supp')?.addEventListener('click',  () => closeSheet('sh-supp'));
  document.getElementById('btn-cancel-equip')?.addEventListener('click', () => closeSheet('sh-equip'));

  document.getElementById('photo-input')?.addEventListener('change',    e => handlePhotoUpload(e));
  document.getElementById('site-cam-input')?.addEventListener('change', e => handlePhotoUpload(e));

  document.querySelectorAll('.overlay').forEach(ov => {
    ov.addEventListener('click', e => { if (e.target === ov) closeSheet(ov.id); });
  });
}

window.addEventListener('load', () => {
  initPrefs();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  bindEvents();
  initSheetSwipe();
  setupPullToRefresh('dash-scroll', refreshData);
  initRipple();
  setTimeout(tryAutoLogin, 800);
});

export { initSelects };
