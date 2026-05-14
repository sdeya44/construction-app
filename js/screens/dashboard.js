import { MN } from '../config.js';
import { D, loadAll } from '../state.js';
import { todayStr, fmtDate, toast, go, logCardHtml } from '../utils.js';
import { renderCurrentScreen } from '../app.js';

let _autoTimer = null;

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
  bindDashLogCards();
  renderRoleBadge();
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
