import { HDR, MN } from '../config.js';
import { D } from '../state.js';
import { uid, pad, monthPrefix, todayStr, toast, can, openSheet, closeSheet, setBtn } from '../utils.js';
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
    row.onclick = () => openEmpHistory(row.dataset.id);
  });
}

export function openEmpHistory(id) {
  const emp = D.employees.find(e => e.id === id);
  if (!emp) return;

  const now = new Date();
  const monthStats = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const m = d.getMonth() + 1;
    const y = d.getFullYear();
    const days = new Set(
      D.attendance.filter(a => a.empId === id && a.date?.startsWith(monthPrefix(m, y))).map(a => a.date)
    ).size;
    monthStats.push({ label: MN[m], month: m, year: y, days });
  }

  const uniqueDays = new Set(D.attendance.filter(a => a.empId === id).map(a => a.date)).size;
  const rate = +(emp.dailyRate || 0);
  const totalCost = uniqueDays * rate;

  const recentSiteMap = new Map();
  [...D.attendance].filter(a => a.empId === id).sort((a,b) => b.date.localeCompare(a.date))
    .forEach(a => { if (!recentSiteMap.has(a.siteId)) recentSiteMap.set(a.siteId, D.sites.find(s=>s.id===a.siteId)?.name||'אתר'); });
  const recentSites = [...recentSiteMap.entries()].slice(0, 5);

  const maxD = Math.max(...monthStats.map(m => m.days), 1);
  const svgW = 280, svgH = 100;
  const padL = 8, padT = 20, chartH = 60, chartW = svgW - padL * 2;
  const slotW = chartW / monthStats.length;
  const barW  = Math.floor(slotW * 0.55);
  const svgBars = monthStats.map((m, i) => {
    const x    = padL + i * slotW + (slotW - barW) / 2;
    const barH = m.days > 0 ? Math.max(3, Math.floor((m.days / maxD) * chartH)) : 3;
    const y    = padT + chartH - barH;
    return `
      <rect x="${x}" y="${y}" width="${barW}" height="${barH}" rx="3" fill="#2d5be3" opacity=".82"/>
      ${m.days > 0 ? `<text x="${x+barW/2}" y="${y-3}" text-anchor="middle" font-size="8" fill="#374151" font-weight="600" font-family="Heebo">${m.days}</text>` : ''}
      <text x="${x+barW/2}" y="${svgH-4}" text-anchor="middle" font-size="8" fill="#6b7280" font-family="Heebo">${m.label}</text>`;
  }).join('');

  document.getElementById('sh-emp-hist-body').innerHTML = `
    <div class="sh-title">👷 ${emp.name}</div>
    <div class="muted" style="margin-bottom:16px">${emp.profession||''} · <span class="badge ${emp.active==='פעיל'?'b-green':'b-orange'}">${emp.active}</span></div>
    <div class="emp-stat-grid">
      <div class="emp-stat-box">
        <div class="emp-stat-val">${uniqueDays}</div>
        <div class="emp-stat-lab">סה"כ ימים</div>
      </div>
      <div class="emp-stat-box">
        <div class="emp-stat-val">${rate ? '₪'+rate.toLocaleString() : '—'}</div>
        <div class="emp-stat-lab">תעריף יומי</div>
      </div>
      <div class="emp-stat-box" style="background:rgba(45,91,227,.08)">
        <div class="emp-stat-val" style="color:var(--blue)">${totalCost ? '₪'+totalCost.toLocaleString() : '—'}</div>
        <div class="emp-stat-lab">סה"כ שכר</div>
      </div>
    </div>
    <div class="card-title" style="margin-bottom:8px">נוכחות — 6 חודשים</div>
    <svg viewBox="0 0 ${svgW} ${svgH}" style="width:100%;height:auto;direction:ltr;margin-bottom:16px">
      <line x1="${padL}" y1="${padT+chartH}" x2="${svgW-padL}" y2="${padT+chartH}" stroke="#e5e9f5" stroke-width="1"/>
      ${svgBars}
    </svg>
    ${recentSites.length ? `
      <div class="card-title" style="margin-bottom:8px">אתרים אחרונים</div>
      ${recentSites.map(([,name]) => `
        <div class="list-item" style="padding:8px 0">
          <div class="avatar av-blue" style="width:32px;height:32px;font-size:14px">📍</div>
          <div class="li-name">${name}</div>
        </div>`).join('')}` : ''}
    ${can('manage_employees') ? `
      <button class="btn btn-outline mt8" id="emp-hist-edit">✏️ ערוך פרטי עובד</button>` : ''}
    <button class="btn btn-ghost mt8" id="emp-hist-close">סגור</button>
  `;

  document.getElementById('emp-hist-close')?.addEventListener('click', () => closeSheet('sh-emp-hist'));
  document.getElementById('emp-hist-edit')?.addEventListener('click', () => {
    closeSheet('sh-emp-hist'); openEditEmp(id);
  });
  openSheet('sh-emp-hist');
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
