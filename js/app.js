import { D } from './state.js';
import { go, can, openSheet, closeSheet } from './utils.js';
import { signIn, tryAutoLogin } from './auth.js';
import { renderDash, refreshData } from './screens/dashboard.js';
import { renderLogs, setLogTab, filterLogs, populateLogFilters } from './screens/logs.js';
import { renderEmps, setEmpTab, filterEmps, openAddEmp, selectStatus, saveEmp } from './screens/employees.js';
import { renderSites, setSiteTab, openAddSite, selectSiteStatus, saveSite } from './screens/sites.js';
import { renderMgmt, setMgmtTab, mgmtAdd, openAddSupp, openAddEquip, selectSuppStatus, selectEquipStatus, saveSupp, saveEquip } from './screens/management.js';
import { startLog } from './screens/wizard.js';
import { handlePhotoUpload } from './screens/photos.js';
import { genReport, exportSummaryPDF, exportAllEmployeesPDF, exportMonthCSV, exportSiteMonthPDF, lockMonth, drawLocks, initSelects } from './screens/reports.js';
import { drawLocks as _drawLocks } from './screens/reports.js';

// ── SCREEN RENDERER MAP ───────────────────────────────────────────────────────
export function renderCurrentScreen() {
  const s = D.activeScreen || 'dash';
  if (s==='dash')    renderDash();
  else if (s==='logs')   { populateLogFilters(); renderLogs(); }
  else if (s==='emp')    renderEmps();
  else if (s==='sites')  renderSites();
  else if (s==='mgmt')   renderMgmt();
  else if (s==='reports'){ /* genReport on demand */ }
}

// ── NAVIGATION WITH RENDER ────────────────────────────────────────────────────
function navigate(s) {
  go(s);
  renderCurrentScreen();
}

// ── ROLE-BASED UI ─────────────────────────────────────────────────────────────
export function applyRoleUI() {
  const addLogBtn = document.getElementById('nav-newlog');
  if (addLogBtn) addLogBtn.style.display = can('create_log') ? '' : 'none';
  document.querySelectorAll('[data-role-require]').forEach(el => {
    const req = el.dataset.roleRequire;
    el.style.display = can(req) ? '' : 'none';
  });
}

// ── BIND ALL EVENTS ───────────────────────────────────────────────────────────
function bindEvents() {
  // Auth
  document.getElementById('g-btn')?.addEventListener('click', signIn);

  // Bottom nav
  document.getElementById('nav-dash')?.addEventListener('click',    () => navigate('dash'));
  document.getElementById('nav-sites')?.addEventListener('click',   () => navigate('sites'));
  document.getElementById('nav-newlog')?.addEventListener('click',  startLog);
  document.getElementById('nav-emp')?.addEventListener('click',     () => navigate('emp'));
  document.getElementById('nav-mgmt')?.addEventListener('click',   () => navigate('mgmt'));
  document.getElementById('nav-reports')?.addEventListener('click', () => navigate('reports'));

  // Dashboard
  document.getElementById('refresh-btn')?.addEventListener('click', refreshData);
  document.getElementById('logout-btn')?.addEventListener('click', () => {
    if (confirm('להתנתק?')) location.reload();
  });

  // Logs
  document.getElementById('log-q')?.addEventListener('input', filterLogs);
  document.getElementById('log-filter-site')?.addEventListener('change', filterLogs);
  document.getElementById('log-filter-act')?.addEventListener('change', filterLogs);
  document.querySelectorAll('#s-logs .tab').forEach(tab => {
    tab.addEventListener('click', () => setLogTab(tab.dataset.tab, tab));
  });

  // Employees
  document.getElementById('emp-q')?.addEventListener('input', filterEmps);
  document.getElementById('btn-add-emp')?.addEventListener('click', openAddEmp);
  document.getElementById('btn-save-emp')?.addEventListener('click', saveEmp);
  document.getElementById('sc-active')?.addEventListener('click', () => selectStatus('active'));
  document.getElementById('sc-frozen')?.addEventListener('click', () => selectStatus('frozen'));
  document.querySelectorAll('#s-emp .tab').forEach(tab => {
    tab.addEventListener('click', () => setEmpTab(tab.dataset.tab, tab));
  });

  // Sites
  document.getElementById('btn-add-site')?.addEventListener('click', openAddSite);
  document.getElementById('btn-save-site')?.addEventListener('click', saveSite);
  document.getElementById('ss-active')?.addEventListener('click', () => selectSiteStatus('פעיל'));
  document.getElementById('ss-frozen')?.addEventListener('click', () => selectSiteStatus('מוקפא'));
  document.getElementById('ss-ended')?.addEventListener('click',  () => selectSiteStatus('הסתיים'));
  document.querySelectorAll('#s-sites .tab').forEach(tab => {
    tab.addEventListener('click', () => setSiteTab(tab.dataset.tab, tab));
  });

  // Management
  document.getElementById('mgmt-add-btn')?.addEventListener('click', mgmtAdd);
  document.getElementById('btn-save-supp')?.addEventListener('click', saveSupp);
  document.getElementById('btn-save-equip')?.addEventListener('click', saveEquip);
  document.getElementById('ssp-active')?.addEventListener('click', () => selectSuppStatus('פעיל'));
  document.getElementById('ssp-frozen')?.addEventListener('click', () => selectSuppStatus('מוקפא'));
  document.getElementById('seq-active')?.addEventListener('click', () => selectEquipStatus('פעיל'));
  document.getElementById('seq-frozen')?.addEventListener('click', () => selectEquipStatus('מוקפא'));
  document.querySelectorAll('#s-mgmt .tab').forEach(tab => {
    tab.addEventListener('click', () => setMgmtTab(tab.dataset.tab, tab));
  });

  // Reports
  document.getElementById('btn-gen-report')?.addEventListener('click', genReport);
  document.getElementById('btn-summary-pdf')?.addEventListener('click', exportSummaryPDF);
  document.getElementById('btn-full-pdf')?.addEventListener('click', exportAllEmployeesPDF);
  document.getElementById('btn-csv')?.addEventListener('click', exportMonthCSV);

  // Month lock
  document.getElementById('btn-lock-month')?.addEventListener('click', lockMonth);
  document.getElementById('sh-lock')?.addEventListener('click', e => {
    if (e.target === document.getElementById('sh-lock')) closeSheet('sh-lock');
  });
  document.querySelector('#s-reports .topbar-btn')?.addEventListener('click', () => {
    drawLocks(); openSheet('sh-lock');
  });

  // Cancel / close sheet buttons
  document.getElementById('btn-cancel-emp')?.addEventListener('click',   () => closeSheet('sh-emp'));
  document.getElementById('btn-cancel-site')?.addEventListener('click',  () => closeSheet('sh-site'));
  document.getElementById('btn-cancel-supp')?.addEventListener('click',  () => closeSheet('sh-supp'));
  document.getElementById('btn-cancel-equip')?.addEventListener('click', () => closeSheet('sh-equip'));

  // Photo inputs
  document.getElementById('photo-input')?.addEventListener('change',    e => handlePhotoUpload(e));
  document.getElementById('site-cam-input')?.addEventListener('change', e => handlePhotoUpload(e));

  // Close overlays on backdrop click
  document.querySelectorAll('.overlay').forEach(ov => {
    ov.addEventListener('click', e => { if (e.target === ov) closeSheet(ov.id); });
  });
}

// ── INIT ──────────────────────────────────────────────────────────────────────
window.addEventListener('load', () => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
  bindEvents();
  setTimeout(tryAutoLogin, 800);
});

// Re-export initSelects so auth.js can call it
export { initSelects };
