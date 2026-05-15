import { D } from '../state.js';
import { uid, toast, can } from '../utils.js';
import { sAppend, rebuildTab, logAudit } from '../api.js';

let _adminTab = 'users';

const usersRow = () => D.users.map(u => [u.id, u.email, u.name, u.role, u.addedAt, u.addedBy]);
const asgnRow  = () => D.siteAssignments.map(a => [a.id, a.email, a.siteId, a.siteName, a.addedAt, a.addedBy]);

export function renderAdmin() {
  const el = document.getElementById('gm-content');
  if (!el) return;
  el.innerHTML = `
    <div class="tabs" id="admin-tabs">
      <button class="tab${_adminTab==='users'?' active':''}" id="atab-users">משתמשים</button>
      <button class="tab${_adminTab==='assignments'?' active':''}" id="atab-assignments">הקצאות אתרים</button>
    </div>
    <div id="admin-tab-content"></div>`;
  const setTab = tab => {
    _adminTab = tab;
    document.querySelectorAll('#admin-tabs .tab').forEach(b => b.classList.remove('active'));
    document.getElementById(`atab-${tab}`).classList.add('active');
    renderAdminTabContent();
  };
  document.getElementById('atab-users').addEventListener('click', () => setTab('users'));
  document.getElementById('atab-assignments').addEventListener('click', () => setTab('assignments'));
  renderAdminTabContent();
}

function renderAdminTabContent() {
  const el = document.getElementById('admin-tab-content');
  if (!el) return;
  if (_adminTab === 'users') renderUsersTab(el); else renderAssignmentsTab(el);
}

function renderUsersTab(el) {
  if (!can('manage_users')) {
    el.innerHTML = `<div class="empty"><div class="empty-icon">🔒</div><div class="empty-title">אין הרשאה</div></div>`;
    return;
  }
  const usersHtml = D.users.length
    ? D.users.map(u => {
        const isGM = u.role === 'GeneralManager';
        return `<div class="list-item" data-uid="${u.id}">
          <div class="avatar av-blue">${(u.name || u.email || '?')[0].toUpperCase()}</div>
          <div class="li-info"><div class="li-name">${u.name || '—'}</div><div class="li-sub">${u.email}</div></div>
          <span class="badge ${isGM ? 'b-red' : 'b-blue'}">${isGM ? 'מנהל כללי' : 'מנהל אתר'}</span>
          <div class="btn-row" style="margin-right:8px;flex-shrink:0">
            <button class="btn btn-outline btn-sm btn-toggle-role" data-uid="${u.id}">${isGM ? 'שנה ל-מנהל אתר' : 'שנה ל-מנהל כללי'}</button>
            <button class="btn btn-danger btn-sm btn-del-user" data-uid="${u.id}" ${D.user?.email===u.email ? 'disabled title="לא ניתן למחוק את עצמך"' : ''}>מחק</button>
          </div>
        </div>`;
      }).join('')
    : `<div class="empty"><div class="empty-icon">👥</div><div class="empty-title">אין משתמשים עדיין</div></div>`;

  el.innerHTML = `
    <div class="card" style="margin-bottom:12px"><div id="users-list">${usersHtml}</div></div>
    <div class="card">
      <div style="font-weight:600;margin-bottom:12px">הוסף משתמש</div>
      <div class="form-group"><label class="form-label">אימייל</label>
        <input class="form-input" id="new-user-email" type="email" placeholder="user@example.com" dir="ltr"></div>
      <div class="form-group"><label class="form-label">שם</label>
        <input class="form-input" id="new-user-name" type="text" placeholder="שם מלא"></div>
      <div class="form-group"><label class="form-label">תפקיד</label>
        <select class="form-input" id="new-user-role">
          <option value="GeneralManager">מנהל כללי</option>
          <option value="SiteManager">מנהל אתר</option>
        </select></div>
      <button class="btn btn-primary" id="btn-add-user">הוסף</button>
    </div>`;
  el.querySelectorAll('.btn-toggle-role').forEach(btn => btn.addEventListener('click', () => toggleUserRole(btn.dataset.uid)));
  el.querySelectorAll('.btn-del-user').forEach(btn => btn.addEventListener('click', () => deleteUser(btn.dataset.uid)));
  document.getElementById('btn-add-user').addEventListener('click', addUser);
}

async function toggleUserRole(id) {
  if (!can('manage_users')) { toast('אין הרשאה', 'err'); return; }
  const idx = D.users.findIndex(u => u.id === id); if (idx === -1) return;
  const user = D.users[idx];
  const newRole = user.role === 'GeneralManager' ? 'SiteManager' : 'GeneralManager';
  D.users[idx] = { ...user, role: newRole };
  try {
    await rebuildTab('Users', usersRow());
    await logAudit('UPDATE', 'User', id, `שינוי תפקיד של ${user.email} ל-${newRole}`);
    toast('תפקיד עודכן ✓', 'ok');
  } catch (e) { D.users[idx] = user; toast('שגיאה: ' + e.message, 'err'); }
  renderAdmin();
}

async function deleteUser(id) {
  if (!can('manage_users')) { toast('אין הרשאה', 'err'); return; }
  const user = D.users.find(u => u.id === id); if (!user) return;
  if (D.user?.email === user.email) { toast('לא ניתן למחוק את עצמך', 'err'); return; }
  if (!confirm(`האם למחוק את המשתמש "${user.name || user.email}"?`)) return;
  const prev = [...D.users];
  D.users = D.users.filter(u => u.id !== id);
  try {
    await rebuildTab('Users', usersRow());
    await logAudit('DELETE', 'User', id, `מחיקת משתמש: ${user.email}`);
    toast('משתמש נמחק ✓', 'ok');
  } catch (e) { D.users = prev; toast('שגיאה: ' + e.message, 'err'); }
  renderAdmin();
}

async function addUser() {
  if (!can('manage_users')) { toast('אין הרשאה', 'err'); return; }
  const email = (document.getElementById('new-user-email')?.value || '').trim().toLowerCase();
  const name  = (document.getElementById('new-user-name')?.value  || '').trim();
  const role  = document.getElementById('new-user-role')?.value || 'SiteManager';
  if (!email) { toast('יש להזין אימייל', 'err'); return; }
  if (!name)  { toast('יש להזין שם',    'err'); return; }
  if (D.users.find(u => u.email.toLowerCase() === email)) { toast('משתמש עם אימייל זה כבר קיים', 'err'); return; }
  const id = uid(), addedAt = new Date().toISOString(), addedBy = D.user?.email || '';
  document.getElementById('btn-add-user').disabled = true;
  try {
    await sAppend('Users', [id, email, name, role, addedAt, addedBy]);
    D.users.push({ id, email, name, role, addedAt, addedBy });
    await logAudit('CREATE', 'User', id, `הוספת משתמש: ${email} (${role})`);
    toast('משתמש נוסף ✓', 'ok');
  } catch (e) {
    toast('שגיאה: ' + e.message, 'err');
    document.getElementById('btn-add-user').disabled = false;
    return;
  }
  renderAdmin();
}

function renderAssignmentsTab(el) {
  if (!can('manage_site_assignments')) {
    el.innerHTML = `<div class="empty"><div class="empty-icon">🔒</div><div class="empty-title">אין הרשאה</div></div>`;
    return;
  }
  const siteManagers = D.users.filter(u => u.role === 'SiteManager');
  if (!siteManagers.length) {
    el.innerHTML = `<div class="card"><div class="empty-title muted">אין מנהלי אתר כרגע</div></div>`;
    return;
  }
  const selValue  = el.querySelector('#assign-user-sel')?.value || '';
  const currentSel = selValue && siteManagers.find(u => u.email === selValue) ? selValue : siteManagers[0].email;
  el.innerHTML = `
    <div class="card" style="margin-bottom:12px">
      <div class="form-group"><label class="form-label">מנהל אתר</label>
        <select class="form-input" id="assign-user-sel">
          ${siteManagers.map(u => `<option value="${u.email}" ${u.email===currentSel?'selected':''}>${u.name||u.email}</option>`).join('')}
        </select></div>
    </div>
    <div id="assignments-panel"></div>`;
  document.getElementById('assign-user-sel').addEventListener('change', renderAssignmentsPanel);
  renderAssignmentsPanel();
}

function renderAssignmentsPanel() {
  const panel = document.getElementById('assignments-panel'); if (!panel) return;
  const email = document.getElementById('assign-user-sel')?.value || ''; if (!email) return;
  const existing = D.siteAssignments.filter(a => a.email === email);
  const assignedIds = new Set(existing.map(a => a.siteId));
  const available   = D.sites.filter(s => !assignedIds.has(s.id));
  const existingHtml = existing.length
    ? existing.map(a => `<div class="list-item" data-aid="${a.id}">
        <div class="avatar av-navy">📍</div>
        <div class="li-info"><div class="li-name">${a.siteName}</div></div>
        <button class="btn btn-danger btn-sm btn-remove-assign" data-aid="${a.id}">הסר</button>
      </div>`).join('')
    : `<div class="muted" style="padding:8px 0">אין הקצאות עדיין</div>`;
  panel.innerHTML = `
    <div class="card" style="margin-bottom:12px">
      <div style="font-weight:600;margin-bottom:10px">הקצאות קיימות</div>
      <div id="existing-assignments">${existingHtml}</div>
    </div>
    <div class="card">
      <div style="font-weight:600;margin-bottom:10px">הוסף הקצאה</div>
      ${available.length ? `
        <div class="form-group"><label class="form-label">אתר</label>
          <select class="form-input" id="assign-site-sel">
            <option value="">בחר אתר...</option>
            ${available.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}
          </select></div>
        <button class="btn btn-primary" id="btn-add-assign">הוסף הקצאה</button>
      ` : `<div class="muted">כל האתרים כבר מוקצים למנהל זה</div>`}
    </div>`;
  panel.querySelectorAll('.btn-remove-assign').forEach(btn => btn.addEventListener('click', () => removeAssignment(btn.dataset.aid)));
  document.getElementById('btn-add-assign')?.addEventListener('click', addAssignment);
}

async function addAssignment() {
  if (!can('manage_site_assignments')) { toast('אין הרשאה', 'err'); return; }
  const email  = document.getElementById('assign-user-sel')?.value || '';
  const siteId = document.getElementById('assign-site-sel')?.value || '';
  if (!email || !siteId) { toast('יש לבחור אתר', 'err'); return; }
  const site = D.sites.find(s => s.id === siteId); if (!site) { toast('אתר לא נמצא', 'err'); return; }
  if (D.siteAssignments.find(a => a.email === email && a.siteId === siteId)) { toast('הקצאה זו כבר קיימת', 'err'); return; }
  const id = uid(), addedAt = new Date().toISOString(), addedBy = D.user?.email || '';
  const rec = { id, email, siteId, siteName: site.name, addedAt, addedBy };
  document.getElementById('btn-add-assign').disabled = true;
  try {
    await sAppend('SiteAssignments', [id, email, siteId, site.name, addedAt, addedBy]);
    D.siteAssignments.push(rec);
    await logAudit('CREATE', 'SiteAssignment', id, `הקצאת אתר ${site.name} למנהל ${email}`);
    toast('הקצאה נוספה ✓', 'ok');
  } catch (e) { toast('שגיאה: ' + e.message, 'err'); return; }
  renderAssignmentsPanel();
}

async function removeAssignment(aid) {
  if (!can('manage_site_assignments')) { toast('אין הרשאה', 'err'); return; }
  const rec = D.siteAssignments.find(a => a.id === aid); if (!rec) return;
  const prev = [...D.siteAssignments];
  D.siteAssignments = D.siteAssignments.filter(a => a.id !== aid);
  try {
    await rebuildTab('SiteAssignments', asgnRow());
    await logAudit('DELETE', 'SiteAssignment', aid, `הסרת הקצאת אתר ${rec.siteName} ממנהל ${rec.email}`);
    toast('הקצאה הוסרה ✓', 'ok');
  } catch (e) { D.siteAssignments = prev; toast('שגיאה: ' + e.message, 'err'); }
  renderAssignmentsPanel();
}
