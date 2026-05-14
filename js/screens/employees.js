import { HDR } from '../config.js';
import { D } from '../state.js';
import { uid, todayStr, toast, can, openSheet, closeSheet, setBtn } from '../utils.js';
import { sAppend, sWrite, logAudit } from '../api.js';

export function renderEmps() { filterEmps(); }

export function setEmpTab(t, el) {
  D.empTab = t;
  document.querySelectorAll('#s-emp .tab').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  filterEmps();
}

export function filterEmps() {
  const q = (document.getElementById('emp-q')?.value || '').toLowerCase();
  let emps = [...D.employees];
  if (D.empTab === 'active') emps = emps.filter(e => e.active === 'פעיל');
  else if (D.empTab === 'frozen') emps = emps.filter(e => e.active !== 'פעיל');
  if (q) emps = emps.filter(e => e.name?.toLowerCase().includes(q) || e.phone?.includes(q));
  const el = document.getElementById('emp-list');
  if (!emps.length) {
    el.innerHTML = `<div class="empty"><div class="empty-icon">👷</div><div class="empty-title">לא נמצאו עובדים</div></div>`;
    return;
  }
  const grp = {};
  emps.forEach(e => { const p = e.profession||'אחר'; (grp[p]=grp[p]||[]).push(e); });
  el.innerHTML = Object.entries(grp).map(([p,list]) => `
    <div class="card"><div class="card-title">${p} (${list.length})</div>
      ${list.map(e => {
        const ta = D.attendance.find(a => a.empId===e.id && a.date===todayStr());
        const site = ta ? D.sites.find(s => s.id===ta.siteId)?.name || 'אתר' : null;
        return `<div class="list-item clickable emp-row" data-id="${e.id}">
          <div class="avatar av-blue">👷</div>
          <div class="li-info">
            <div class="li-name">${e.name}</div>
            <div class="li-sub">${e.phone||''}${site ? ` · היום: ${site}` : ''}</div>
          </div>
          <span class="badge ${e.active==='פעיל'?'b-green':'b-orange'}">${e.active==='פעיל'?'פעיל':'מוקפא'}</span>
        </div>`;
      }).join('')}
    </div>`).join('');
  document.querySelectorAll('.emp-row').forEach(row => {
    row.onclick = () => openEditEmp(row.dataset.id);
  });
}

export function openAddEmp() {
  if (!can('manage_employees')) { toast('אין הרשאה','err'); return; }
  D.editEmpId = null; D.empStatus = 'פעיל';
  document.getElementById('emp-sh-title').textContent = '➕ הוספת עובד';
  ['e-name','e-phone','e-daily-rate'].forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; });
  selectStatus('active');
  document.getElementById('btn-save-emp').textContent = 'שמור עובד';
  openSheet('sh-emp');
}

export function openEditEmp(id) {
  const e = D.employees.find(x => x.id === id); if (!e) return;
  D.editEmpId = id; D.empStatus = e.active || 'פעיל';
  document.getElementById('emp-sh-title').textContent = '✏️ עריכת עובד';
  document.getElementById('e-name').value  = e.name;
  document.getElementById('e-prof').value  = e.profession || 'פועל';
  document.getElementById('e-phone').value = e.phone || '';
  const rateEl = document.getElementById('e-daily-rate');
  if (rateEl) rateEl.value = e.dailyRate || '';
  selectStatus(e.active === 'פעיל' ? 'active' : 'frozen');
  document.getElementById('btn-save-emp').textContent = 'עדכן עובד';
  openSheet('sh-emp');
}

export function selectStatus(v) {
  D.empStatus = v === 'active' ? 'פעיל' : 'מוקפא';
  document.getElementById('sc-active')?.classList.toggle('active-s', v==='active');
  document.getElementById('sc-frozen')?.classList.toggle('frozen-s', v==='frozen');
}

export async function saveEmp() {
  if (!can('manage_employees')) { toast('אין הרשאה','err'); return; }
  const name  = document.getElementById('e-name').value.trim();
  if (!name) { toast('יש להזין שם','err'); return; }
  const prof      = document.getElementById('e-prof').value;
  const phone     = document.getElementById('e-phone').value.trim();
  const dailyRate = parseFloat(document.getElementById('e-daily-rate')?.value || '0') || 0;
  setBtn('btn-save-emp', true, 'שומר...');
  try {
    if (D.editEmpId) {
      const i = D.employees.findIndex(e => e.id === D.editEmpId);
      D.employees[i] = { ...D.employees[i], name, profession: prof, phone, active: D.empStatus, dailyRate };
      await sWrite('Employees','A1',[HDR.Employees,...D.employees.map(e=>[e.id,e.name,e.phone,e.profession,e.active,e.notes||'',e.dailyRate||''])]);
      await logAudit('UPDATE','Employee',D.editEmpId,`עדכון עובד: ${name}`);
      toast('עובד עודכן ✓','ok');
    } else {
      const id = uid();
      await sAppend('Employees',[id,name,phone,prof,D.empStatus,'',dailyRate||'']);
      D.employees.push({ id, name, phone, profession: prof, active: D.empStatus, notes: '', dailyRate });
      await logAudit('CREATE','Employee',id,`הוספת עובד: ${name}`);
      toast('עובד נוסף ✓','ok');
    }
    closeSheet('sh-emp'); filterEmps();
  } catch(e) { toast('שגיאה: '+e.message,'err'); }
  setBtn('btn-save-emp', false, 'שמור עובד');
}
