import { HDR, MN, BUSINESS_NAME } from '../config.js';
import { D } from '../state.js';
import { uid, monthPrefix, todayStr, toast, can, openSheet, closeSheet, setBtn, exportCSV } from '../utils.js';
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
        const ta   = D.attendance.find(a => a.empId===e.id && a.date===todayStr());
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
  document.querySelectorAll('.emp-row').forEach(row => { row.onclick = () => _openEmpDetails(row.dataset.id); });
}

function _openEmpDetails(id) {
  const emp = D.employees.find(e => e.id === id); if (!emp) return;
  const el = document.getElementById('emp-list');
  const now = new Date(), cm = now.getMonth()+1, cy = now.getFullYear();
  el.innerHTML = `
    <button class="btn btn-ghost btn-sm mt8" id="emp-back">← חזרה לרשימה</button>
    <div class="card mt12">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
        <div style="min-width:0">
          <div style="font-size:20px;font-weight:800;color:var(--text)">${emp.name}</div>
          <div style="color:var(--muted);font-size:13px;margin-top:4px">${emp.profession||''}${emp.phone?' · '+emp.phone:''}</div>
          ${emp.dailyRate?`<div style="margin-top:6px;font-size:13px">תעריף יומי: <strong>${(+emp.dailyRate).toLocaleString('he-IL')} ₪</strong></div>`:''}
        </div>
        <span class="badge ${emp.active==='פעיל'?'b-green':'b-orange'}" style="flex-shrink:0">${emp.active==='פעיל'?'פעיל':'מוקפא'}</span>
      </div>
      ${can('manage_employees')?`<button class="btn btn-ghost fg mt12" id="emp-det-edit">✏️ עריכה</button>`:''}
    </div>
    <div class="card mt8">
      <div class="card-title">דוח נוכחות ושכר</div>
      <div class="row" style="gap:8px;align-items:flex-end;flex-wrap:wrap">
        <div class="form-group" style="flex:1;min-width:100px"><label class="form-label">חודש</label>
          <select class="form-input" id="emp-r-month">${MN.slice(1).map((n,i)=>`<option value="${i+1}">${n}</option>`).join('')}</select></div>
        <div class="form-group" style="flex:1;min-width:80px"><label class="form-label">שנה</label>
          <select class="form-input" id="emp-r-year">${[cy,cy-1,cy-2].map(y=>`<option value="${y}">${y}</option>`).join('')}</select></div>
        <button class="btn btn-primary" id="btn-emp-gen" style="width:auto;padding:12px 20px;margin-bottom:2px">📊 הפק</button>
      </div>
    </div>
    <div id="emp-r-out"></div>`;
  document.getElementById('emp-back').onclick = filterEmps;
  document.getElementById('emp-det-edit')?.addEventListener('click', () => openEditEmp(id));
  document.getElementById('emp-r-month').value = cm;
  document.getElementById('emp-r-year').value  = cy;
  document.getElementById('btn-emp-gen').onclick = () =>
    _showEmpMonthly(id, emp, +document.getElementById('emp-r-month').value, +document.getElementById('emp-r-year').value);
  _showEmpMonthly(id, emp, cm, cy);
}

function _showEmpMonthly(empId, emp, month, year) {
  const pfx = monthPrefix(month, year);
  const attEntries = D.attendance.filter(a => a.empId === empId && a.date?.startsWith(pfx));
  const workDays   = new Set(attEntries.map(a => a.date)).size;
  const rate       = +(emp.dailyRate||0);
  const totalPay   = workDays * rate;
  const siteMap    = new Map();
  attEntries.forEach(a => {
    if (!siteMap.has(a.siteId)) siteMap.set(a.siteId, D.sites.find(s=>s.id===a.siteId)?.name||a.siteId);
  });
  const sites = [...siteMap.values()];

  document.getElementById('emp-r-out').innerHTML = `
    <div class="card mt8">
      <div class="card-title">סיכום ${MN[month]} ${year}</div>
      <div class="list-item" style="border:none;padding:4px 0"><span>ימי עבודה</span><span style="font-weight:700;margin-right:auto;color:var(--gold)">${workDays}</span></div>
      <div class="list-item" style="border:none;padding:4px 0"><span>תעריף יומי</span><span style="font-weight:700;margin-right:auto">${rate?rate.toLocaleString('he-IL')+' ₪':'לא הוגדר'}</span></div>
      ${rate?`<div class="list-item" style="border:none;padding:6px 0;border-top:1px solid var(--border)"><span style="font-weight:700">סה"כ לתשלום</span><span style="font-weight:800;margin-right:auto;color:var(--gold);font-size:16px">${totalPay.toLocaleString('he-IL')} ₪</span></div>`:''}
      ${sites.length?`<div style="padding:6px 0"><div style="font-size:12px;color:var(--muted);margin-bottom:6px">אתרים</div><div style="display:flex;flex-wrap:wrap;gap:4px">${sites.map(s=>`<span class="badge b-blue">${s}</span>`).join('')}</div></div>`:''}
    </div>
    ${!workDays?`<div class="empty mt16"><div class="empty-icon">📋</div><div class="empty-title">אין נוכחות לחודש זה</div></div>`:''}
    ${workDays?`<div class="btn-row mt8">
      <button class="btn btn-ghost btn-sm fg" id="btn-emp-pdf">📄 תלוש שכר</button>
      <button class="btn btn-ghost btn-sm fg" id="btn-emp-csv">📥 CSV</button>
    </div>`:''}`;

  if (workDays) {
    document.getElementById('btn-emp-pdf').onclick = () =>
      _exportPayslipPDF(emp, month, year, workDays, rate, totalPay, sites);
    document.getElementById('btn-emp-csv').onclick = () => {
      const rows = [...new Set(attEntries.map(a=>a.date))].sort().map(date => {
        const a = attEntries.find(x=>x.date===date);
        return [date, siteMap.get(a?.siteId)||''];
      });
      exportCSV(['תאריך','אתר'], rows, `${emp.name}_${MN[month]}_${year}.csv`);
      toast('CSV הורד','ok');
    };
  }
}

function _exportPayslipPDF(emp, month, year, workDays, rate, totalPay, sites) {
  const w = window.open('', '_blank');
  if (!w) { toast('אפשר חלונות קופצים','err'); return; }
  w.document.write(`<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="UTF-8">
  <link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;700;800&display=swap" rel="stylesheet">
  <style>*{font-family:'Heebo',sans-serif;box-sizing:border-box}body{margin:16px;direction:rtl;font-size:12px}
  .biz{color:#B8922C;font-size:13px;font-weight:800;text-align:center;margin-bottom:2px}
  h2{color:#B8922C;text-align:center;font-size:18px;margin-bottom:4px;font-weight:800}
  .sub{color:#726E68;text-align:center;font-size:12px;margin-bottom:16px}
  .sec{font-weight:800;font-size:13px;color:#B8922C;border-bottom:2px solid #B8922C;padding-bottom:4px;margin:16px 0 8px}
  .kv{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #eee}
  .total{display:flex;justify-content:space-between;padding:10px 0;font-weight:800;font-size:15px;border-top:2px solid #B8922C;margin-top:8px}
  @media print{body{margin:8px}}</style></head><body>
  <div class="biz">${BUSINESS_NAME}</div>
  <h2>תלוש שכר — ${emp.name}</h2>
  <div class="sub">${MN[month]} ${year} | הופק: ${new Date().toLocaleDateString('he-IL')}</div>
  <div class="sec">פרטי עובד</div>
  <div class="kv"><span>שם</span><strong>${emp.name}</strong></div>
  ${emp.profession?`<div class="kv"><span>מקצוע</span><strong>${emp.profession}</strong></div>`:''}
  ${emp.phone?`<div class="kv"><span>טלפון</span><strong>${emp.phone}</strong></div>`:''}
  <div class="sec">נוכחות ושכר</div>
  <div class="kv"><span>ימי עבודה</span><strong>${workDays}</strong></div>
  <div class="kv"><span>תעריף יומי</span><strong>${rate.toLocaleString('he-IL')} ₪</strong></div>
  ${sites.length?`<div class="kv"><span>אתרים</span><strong>${sites.join(', ')}</strong></div>`:''}
  <div class="total"><span>סה"כ לתשלום</span><span>${totalPay.toLocaleString('he-IL')} ₪</span></div>
  </body></html>`);
  w.document.close(); setTimeout(() => w.print(), 700);
  toast('נפתח חלון הדפסה','ok');
}

export function openEmpHistory(id) {
  const emp = D.employees.find(e => e.id === id); if (!emp) return;
  const now = new Date();
  const monthStats = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
    const m = d.getMonth()+1, y = d.getFullYear();
    const days = new Set(D.attendance.filter(a => a.empId===id && a.date?.startsWith(monthPrefix(m,y))).map(a=>a.date)).size;
    monthStats.push({ label:MN[m], month:m, year:y, days });
  }
  const uniqueDays = new Set(D.attendance.filter(a => a.empId===id).map(a=>a.date)).size;
  const rate = +(emp.dailyRate||0), totalCost = uniqueDays * rate;

  const recentSiteMap = new Map();
  [...D.attendance].filter(a=>a.empId===id).sort((a,b)=>b.date.localeCompare(a.date))
    .forEach(a => { if (!recentSiteMap.has(a.siteId)) recentSiteMap.set(a.siteId, D.sites.find(s=>s.id===a.siteId)?.name||'אתר'); });
  const recentSites = [...recentSiteMap.entries()].slice(0,5);

  const maxD=Math.max(...monthStats.map(m=>m.days),1), svgW=280, svgH=100;
  const padL=8, padT=20, chartH=60, chartW=svgW-padL*2, slotW=chartW/monthStats.length, barW=Math.floor(slotW*0.55);
  const svgBars = monthStats.map((m,i) => {
    const x = padL+i*slotW+(slotW-barW)/2;
    const barH = m.days>0 ? Math.max(3,Math.floor((m.days/maxD)*chartH)) : 3;
    const y = padT+chartH-barH;
    return `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" rx="3" fill="#6366f1" opacity=".9"/>
      ${m.days>0?`<text x="${x+barW/2}" y="${y-3}" text-anchor="middle" font-size="8" fill="#6366f1" font-weight="600" font-family="Heebo">${m.days}</text>`:''}
      <text x="${x+barW/2}" y="${svgH-4}" text-anchor="middle" font-size="8" fill="rgba(99,102,241,0.5)" font-family="Heebo">${m.label}</text>`;
  }).join('');

  document.getElementById('sh-emp-hist-body').innerHTML = `
    <div class="sh-title">👷 ${emp.name}</div>
    <div class="muted" style="margin-bottom:16px">${emp.profession||''} · <span class="badge ${emp.active==='פעיל'?'b-green':'b-orange'}">${emp.active}</span></div>
    <div class="emp-stat-grid">
      <div class="emp-stat-box"><div class="emp-stat-val">${uniqueDays}</div><div class="emp-stat-lab">סה"כ ימים</div></div>
      <div class="emp-stat-box"><div class="emp-stat-val">${rate?'₪'+rate.toLocaleString():'—'}</div><div class="emp-stat-lab">תעריף יומי</div></div>
      <div class="emp-stat-box" style="background:rgba(99,102,241,0.08)">
        <div class="emp-stat-val" style="color:var(--blue)">${totalCost?'₪'+totalCost.toLocaleString():'—'}</div>
        <div class="emp-stat-lab">סה"כ שכר</div>
      </div>
    </div>
    <div class="card-title" style="margin-bottom:8px">נוכחות — 6 חודשים</div>
    <svg viewBox="0 0 ${svgW} ${svgH}" style="width:100%;height:auto;direction:ltr;margin-bottom:16px">
      <line x1="${padL}" y1="${padT+chartH}" x2="${svgW-padL}" y2="${padT+chartH}" stroke="rgba(99,102,241,0.15)" stroke-width="1"/>
      ${svgBars}
    </svg>
    ${recentSites.length ? `
      <div class="card-title" style="margin-bottom:8px">אתרים אחרונים</div>
      ${recentSites.map(([,name]) => `
        <div class="list-item" style="padding:8px 0">
          <div class="avatar av-blue" style="width:32px;height:32px;font-size:14px">📍</div>
          <div class="li-name">${name}</div>
        </div>`).join('')}` : ''}
    ${can('manage_employees') ? `<button class="btn btn-outline mt8" id="emp-hist-edit">✏️ ערוך פרטי עובד</button>` : ''}
    <button class="btn btn-ghost mt8" id="emp-hist-close">סגור</button>`;

  document.getElementById('emp-hist-close').addEventListener('click', () => closeSheet('sh-emp-hist'));
  document.getElementById('emp-hist-edit')?.addEventListener('click', () => { closeSheet('sh-emp-hist'); openEditEmp(id); });
  openSheet('sh-emp-hist');
}

export function openAddEmp() {
  if (!can('manage_employees')) { toast('אין הרשאה','err'); return; }
  D.editEmpId = null; D.empStatus = 'פעיל';
  document.getElementById('emp-sh-title').textContent = '➕ הוספת עובד';
  ['e-name','e-phone','e-daily-rate'].forEach(id => { document.getElementById(id).value = ''; });
  selectStatus('active');
  document.getElementById('btn-save-emp').textContent = 'שמור עובד';
  openSheet('sh-emp');
}

export function openEditEmp(id) {
  const e = D.employees.find(x => x.id === id); if (!e) return;
  D.editEmpId = id; D.empStatus = e.active || 'פעיל';
  document.getElementById('emp-sh-title').textContent = '✏️ עריכת עובד';
  document.getElementById('e-name').value       = e.name;
  document.getElementById('e-prof').value       = e.profession || 'פועל';
  document.getElementById('e-phone').value      = e.phone || '';
  document.getElementById('e-daily-rate').value = e.dailyRate || '';
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
  const dailyRate = parseFloat(document.getElementById('e-daily-rate').value||'0')||0;
  setBtn('btn-save-emp', true, 'שומר...');
  try {
    if (D.editEmpId) {
      const i = D.employees.findIndex(e => e.id === D.editEmpId);
      D.employees[i] = { ...D.employees[i], name, profession:prof, phone, active:D.empStatus, dailyRate };
      await sWrite('Employees','A1',[HDR.Employees,...D.employees.map(e=>[e.id,e.name,e.phone,e.profession,e.active,e.notes||'',e.dailyRate||''])]);
      await logAudit('UPDATE','Employee',D.editEmpId,`עדכון עובד: ${name}`);
      toast('עובד עודכן ✓','ok');
    } else {
      const id = uid();
      await sAppend('Employees',[id,name,phone,prof,D.empStatus,'',dailyRate||'']);
      D.employees.push({ id, name, phone, profession:prof, active:D.empStatus, notes:'', dailyRate });
      await logAudit('CREATE','Employee',id,`הוספת עובד: ${name}`);
      toast('עובד נוסף ✓','ok');
    }
    closeSheet('sh-emp'); filterEmps();
  } catch(e) { toast('שגיאה: '+e.message,'err'); }
  setBtn('btn-save-emp', false, 'שמור עובד');
}
