import { MN } from '../config.js';
import { D, loadAll } from '../state.js';
import { todayStr, fmtDate, toast, go, logCardHtml, can } from '../utils.js';
import { renderCurrentScreen } from '../app.js';

let _autoTimer = null;

function _activeSitesForUser() {
  const active = D.sites.filter(s => s.status === 'פעיל');
  if (D.role === 'SiteManager') {
    const assigned = new Set(D.siteAssignments.filter(a => a.email === D.user?.email).map(a => a.siteId));
    return active.filter(s => assigned.has(s.id));
  }
  return active;
}

export function renderDash() {
  const t = todayStr();
  const el = n => document.getElementById(n);
  el('d-name').textContent  = D.user?.given_name || D.user?.name?.split(' ')[0] || 'מנהל';
  el('d-date').textContent  = fmtDate(t);
  el('d-sites').textContent = D.logs.filter(l => l.date === t).length;
  el('d-workers').textContent = D.attendance.filter(a => a.date === t).length;
  el('d-mlogs').textContent = D.logs.filter(l => l.date?.startsWith(t.slice(0,7))).length;
  el('d-empt').textContent  = D.employees.filter(e => e.active === 'פעיל').length;
  const recent = [...D.logs].sort((a,b) => b.date.localeCompare(a.date)).slice(0,6);
  el('d-recent').innerHTML = recent.length
    ? recent.map(l => logCardHtml(l, D.attendance)).join('')
    : `<div class="empty"><div class="empty-icon">📋</div><div class="empty-title">אין יומנים עדיין</div><div class="empty-sub">לחץ ➕ כדי ליצור דיווח ראשון</div></div>`;
  renderAlerts(t);
  renderQuickSites(t);
  bindDashLogCards();
  renderRoleBadge();
}

function renderAlerts(today) {
  const el = document.getElementById('d-alerts');
  if (!el || !can('create_log')) { if (el) el.innerHTML = ''; return; }
  const sites = _activeSitesForUser();
  const reportedIds = new Set(D.logs.filter(l => l.date === today).map(l => l.siteId));
  const unreported = sites.filter(s => !reportedIds.has(s.id));
  if (!unreported.length) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <div class="alert-card">
      <div class="alert-card-title">⚠️ ${unreported.length} אתרים ללא דיווח היום</div>
      ${unreported.map(s => `
        <div class="alert-site-item" data-site-id="${s.id}">
          <div class="alert-site-name">📍 ${s.name}</div>
          <button class="alert-site-action" data-site-id="${s.id}">+ דווח</button>
        </div>`).join('')}
    </div>`;
  el.querySelectorAll('[data-site-id]').forEach(btn => {
    btn.addEventListener('click', e => {
      const sid = e.currentTarget.dataset.siteId;
      if (sid) import('./wizard.js').then(m => m.startLogForSite(sid));
    });
  });
}

function renderQuickSites(today) {
  const el = document.getElementById('d-quick-sites');
  if (!el) return;
  const sites = _activeSitesForUser();
  if (!sites.length) { el.innerHTML = ''; return; }
  const reportedIds = new Set(D.logs.filter(l => l.date === today).map(l => l.siteId));
  const sorted = [...sites].sort((a,b) => (reportedIds.has(a.id)?1:0) - (reportedIds.has(b.id)?1:0));
  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <div style="font-size:13px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.4px">אתרים פעילים</div>
      ${can('create_log') ? `<button class="btn btn-sm" id="d-quick-log-btn" style="width:auto;padding:5px 12px;font-size:12px;background:rgba(45,91,227,.1);border:1.5px solid var(--blue);color:var(--blue)">⚡ דיווח מהיר</button>` : ''}
    </div>
    <div class="quick-sites">
      ${sorted.map(s => `
        <button class="quick-site-chip ${reportedIds.has(s.id)?'has-report':''}"
          data-site-id="${s.id}" data-reported="${reportedIds.has(s.id)?'1':'0'}">
          ${reportedIds.has(s.id) ? '✓' : '+'} ${s.name}
        </button>`).join('')}
    </div>`;
  document.getElementById('d-quick-log-btn')?.addEventListener('click', () => {
    import('./wizard.js').then(m => m.startQuickLog());
  });
  el.querySelectorAll('.quick-site-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const sid = chip.dataset.siteId;
      if (chip.dataset.reported === '0') {
        import('./wizard.js').then(m => m.startLogForSite(sid));
      } else {
        import('./logs.js').then(m => { m.populateLogFilters(); go('logs'); }).then(() => {
          const sel = document.getElementById('log-filter-site');
          if (sel) { sel.value = sid; import('./logs.js').then(m => m.filterLogs()); }
          document.querySelectorAll('.nav-item').forEach(x => x.classList.remove('active'));
          document.getElementById('nav-logs')?.classList.add('active');
          D.activeScreen = 'logs';
        });
      }
    });
  });
}

function renderRoleBadge() {
  const el = document.getElementById('d-role-badge');
  if (!el) return;
  const colors = { GeneralManager:'b-blue', SiteManager:'b-green', Admin:'b-blue', Manager:'b-green', Viewer:'b-gray' };
  const labels = { GeneralManager:'מנהל ראשי', SiteManager:'מנהל אתר', Admin:'מנהל ראשי', Manager:'מנהל אתר', Viewer:'צופה' };
  el.className = 'badge ' + (colors[D.role]||'b-gray');
  el.textContent = labels[D.role] || D.role;
}

function bindDashLogCards() {
  document.querySelectorAll('#d-recent .log-card').forEach(card => {
    card.onclick = () => {
      const id = card.dataset.logid;
      if (id) { import('./logs.js').then(m => m.showLog(id)); }
    };
  });
}

export async function refreshData() {
  const btn = document.getElementById('refresh-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
  try {
    await loadAll();
    renderCurrentScreen();
    toast('נתונים עודכנו ✓','ok');
  } catch(e) {
    toast('שגיאת רענון: '+e.message,'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔄'; }
  }
}

export function startAutoRefresh() {
  stopAutoRefresh();
  _autoTimer = setInterval(() => {
    const wizActive = D.wiz && (D.wiz.step > 0 || D.wiz.editMode);
    if (!wizActive) refreshData();
  }, 45000);
}
export function stopAutoRefresh() {
  if (_autoTimer) clearInterval(_autoTimer);
  _autoTimer = null;
}
