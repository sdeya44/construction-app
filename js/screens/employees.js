import { HDR, MN, DAYS_HE, BUSINESS_NAME } from '../config.js';
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
    el.innerHTML = `
      <button class="btn btn-ghost btn-sm mt8" id="btn-all-emp-report" style="width:auto">📊 דוח כל העובדים</button>
      <div class="empty"><div class="empty-icon">👷</div><div class="empty-title">לא נמצאו עובדים</div></div>`;
    document.getElementById('btn-all-emp-report').onclick = _openAllEmpReport;
    return;
  }
  const grp = {};
  emps.forEach(e => { const p = e.profession||'אחר'; (grp[p]=grp[p]||[]).push(e); });
  el.innerHTML = `
    <button class="btn btn-ghost btn-sm mt8" id="btn-all-emp-report" style="width:auto">📊 דוח כל העובדים</button>
    ${Object.entries(grp).map(([p,list]) => `
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
    </div>`).join('')}`;
  document.getElementById('btn-all-emp-report').onclick = _openAllEmpReport;
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
  const pfx      = monthPrefix(month, year);
  const attEntries = D.attendance.filter(a => a.empId === empId && a.date?.startsWith(pfx));
  const days     = [...new Set(attEntries.map(a => a.date))].sort();
  const workDays = days.length;
  const rate     = +(emp.dailyRate||0);
  const totalPay = workDays * rate;
  const siteMap  = new Map();
  attEntries.forEach(a => {
    if (!siteMap.has(a.siteId)) siteMap.set(a.siteId, D.sites.find(s=>s.id===a.siteId)?.name||a.siteId);
  });
  const sites = [...siteMap.values()];

  const dayRows = days.map(date => {
    const a = attEntries.find(x => x.date === date);
    const siteName = siteMap.get(a?.siteId) || '—';
    const d = new Date(date); const dayHe = DAYS_HE[d.getDay()];
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px">
      <span style="color:var(--muted);direction:ltr;font-family:monospace;min-width:90px">${date}</span>
      <span style="color:var(--muted);min-width:40px;text-align:center">${dayHe}</span>
      <span style="color:var(--text);text-align:right;flex:1;padding-right:4px">${siteName}</span>
    </div>`;
  }).join('');

  document.getElementById('emp-r-out').innerHTML = `
    <div class="card mt8">
      <div class="card-title">סיכום ${MN[month]} ${year}</div>
      <div class="list-item" style="border:none;padding:4px 0"><span>ימי עבודה</span><span style="font-weight:700;margin-right:auto;color:var(--gold)">${workDays}</span></div>
      <div class="list-item" style="border:none;padding:4px 0"><span>תעריף יומי</span><span style="font-weight:700;margin-right:auto">${rate?rate.toLocaleString('he-IL')+' ₪':'לא הוגדר'}</span></div>
      ${rate?`<div class="list-item" style="border:none;padding:6px 0;border-top:1px solid var(--border)"><span style="font-weight:700">סה"כ לתשלום</span><span style="font-weight:800;margin-right:auto;color:var(--gold);font-size:16px">${totalPay.toLocaleString('he-IL')} ₪</span></div>`:''}
    </div>
    ${workDays ? `
    <div class="card mt8">
      <div class="card-title">פירוט ימי עבודה</div>
      ${dayRows}
    </div>` : ''}
    ${!workDays?`<div class="empty mt16"><div class="empty-icon">📋</div><div class="empty-title">אין נוכחות לחודש זה</div></div>`:''}
    ${workDays?`<div class="btn-row mt8">
      <button class="btn btn-ghost btn-sm fg" id="btn-emp-pdf">📄 תלוש שכר</button>
      <button class="btn btn-ghost btn-sm fg" id="btn-emp-csv">📥 CSV</button>
    </div>`:''}`;

  if (workDays) {
    document.getElementById('btn-emp-pdf').onclick = () =>
      _exportPayslipPDF(emp, month, year, workDays, rate, totalPay, sites, days, siteMap);
    document.getElementById('btn-emp-csv').onclick = () => {
      exportCSV(['תאריך','יום','אתר'], days.map(date => {
        const a = attEntries.find(x => x.date === date);
        const d = new Date(date);
        return [date, DAYS_HE[d.getDay()], siteMap.get(a?.siteId)||''];
      }), `${emp.name}_${MN[month]}_${year}.csv`);
      toast('CSV הורד','ok');
    };
  }
}

function _exportPayslipPDF(emp, month, year, workDays, rate, totalPay, sites, days, siteMap) {
  const w = window.open('', '_blank');
  if (!w) { toast('אפשר חלונות קופצים','err'); return; }
  const pad = n => String(n).padStart(2, '0');
  const daysCount = new Date(year, month, 0).getDate();
  const DS = ['א','ב','ג','ד','ה','ו','ש'];
  const workedSet = new Set(days||[]);
  let dayHeaders = '', dayCells = '';
  for (let d = 1; d <= daysCount; d++) {
    const ds = `${year}-${pad(month)}-${pad(d)}`;
    const dow = new Date(ds+'T12:00:00').getDay();
    const wknd = dow === 5 || dow === 6;
    const did = workedSet.has(ds);
    dayHeaders += `<th class="${wknd?'wh':''}">${d}<br><span class="dow">${DS[dow]}</span></th>`;
    dayCells   += `<td class="${wknd?'wd':''} ${did?'wk':''}">${did?'✓':''}</td>`;
  }
  const estHours = workDays * 9;
  w.document.write(`<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;600;700;800&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Heebo',sans-serif;direction:rtl;background:#fff;color:#181410}
  .page{width:794px;padding:28px 28px 20px;background:#fff}
  .card-hdr{background:linear-gradient(135deg,#1A1714 0%,#2C2620 100%);border-radius:10px 10px 0 0;padding:18px 22px;display:flex;align-items:center;justify-content:space-between;color:#EDE8DF}
  .biz-label{font-size:9.5px;color:#B8922C;font-weight:800;letter-spacing:.8px;margin-bottom:8px}
  .emp-name{font-size:21px;font-weight:800;margin-bottom:3px}
  .emp-sub{font-size:11.5px;color:rgba(237,232,223,.70)}
  .month-badge{text-align:center;background:rgba(184,146,44,.18);border:1.5px solid rgba(184,146,44,.45);border-radius:8px;padding:8px 16px;font-size:15px;font-weight:800;color:#D4A843;line-height:1.4;min-width:70px}
  .grid-wrap{border:1.5px solid rgba(184,146,44,.22);border-top:none;border-radius:0 0 8px 8px;overflow:hidden;margin-bottom:14px}
  table.dg{width:100%;border-collapse:collapse}
  .dg thead tr{background:#B8922C}
  .dg th{color:#fff;padding:3px 1px;text-align:center;font-size:8.5px;font-weight:700;border-left:1px solid rgba(255,255,255,.15);white-space:nowrap}
  .dg th.rl{min-width:52px;text-align:right;padding-right:6px;font-size:9.5px;border-left:2px solid rgba(255,255,255,.25)}
  .dow{font-size:7px;opacity:.8;font-weight:400;display:block}
  .dg td{text-align:center;padding:5px 1px;border:1px solid rgba(184,146,44,.08);font-size:9px}
  .dg td.rn{text-align:right;padding-right:7px;font-weight:700;font-size:10px;background:#FBF9F4;border-left:2px solid rgba(184,146,44,.18)}
  .wh{background:#8B6E14 !important}
  .wd{background:#F7F4EE}
  .wk{color:#2A6B47;font-weight:900;font-size:12px}
  .stats-strip{display:flex;align-items:stretch;background:#FBF6EC;border:1.5px solid rgba(184,146,44,.28);border-radius:10px;padding:14px 16px;margin-bottom:14px}
  .stat{flex:1;text-align:center}
  .sl{font-size:9.5px;color:#9A9189;margin-bottom:4px;font-weight:600}
  .sv{font-size:20px;font-weight:800;font-family:'JetBrains Mono',monospace;color:#181410;line-height:1}
  .sv.gold{color:#B8922C} .sv.grn{color:#2A6B47}
  .sn{font-size:8.5px;color:#9A9189;margin-top:3px}
  .sdiv{width:1px;background:rgba(184,146,44,.25);margin:0 6px;flex-shrink:0}
  .sig-row{display:flex;gap:28px;margin-bottom:10px;padding-top:6px}
  .sig{flex:1;text-align:center}
  .sig-line{height:1px;background:#181410;margin-bottom:5px;margin-top:24px}
  .sig-lbl{font-size:10px;color:#6C6259}
  .fnote{font-size:8.5px;color:#9A9189;text-align:center;border-top:1px solid #E5E0D8;padding-top:8px}
  @media print{body{background:#fff}@page{size:A4 portrait;margin:0}.page{width:auto;padding:20px 20px 16px}}
</style>
</head><body><div class="page">
  <div class="card-hdr">
    <div>
      <div class="biz-label">${BUSINESS_NAME} — תלוש שכר</div>
      <div class="emp-name">${emp.name}</div>
      <div class="emp-sub">${MN[month]} ${year}${emp.profession?' | '+emp.profession:''}</div>
    </div>
    <div class="month-badge">${MN[month]}<br><span style="font-size:13px;opacity:.8">${year}</span></div>
  </div>
  <div class="grid-wrap">
    <table class="dg">
      <thead><tr><th class="rl">ימי עבודה</th>${dayHeaders}</tr></thead>
      <tbody><tr><td class="rn">${emp.name}</td>${dayCells}</tr></tbody>
    </table>
  </div>
  <div class="stats-strip">
    <div class="stat"><div class="sl">ימי עבודה</div><div class="sv gold">${workDays}</div></div>
    <div class="sdiv"></div>
    <div class="stat"><div class="sl">שעות מוערכות</div><div class="sv">${estHours}</div><div class="sn">× 9 שע'</div></div>
    <div class="sdiv"></div>
    <div class="stat"><div class="sl">תעריף יומי</div><div class="sv" style="font-size:16px">${rate>0?rate.toLocaleString('he-IL')+' ₪':'לא הוגדר'}</div></div>
    <div class="sdiv"></div>
    <div class="stat"><div class="sl">שכר לתשלום</div><div class="sv grn" style="font-size:${totalPay>99999?'14':'18'}px">${totalPay>0?totalPay.toLocaleString('he-IL')+' ₪':'—'}</div></div>
  </div>
  <div class="sig-row">
    <div class="sig"><div class="sig-line"></div><div class="sig-lbl">חתימת עובד</div></div>
    <div class="sig"><div class="sig-line"></div><div class="sig-lbl">אישור מנהל</div></div>
    <div class="sig"><div class="sig-line"></div><div class="sig-lbl">תאריך</div></div>
  </div>
  <div class="fnote">* שעות מוערכות לפי 9 שעות ביום — אינן כוללות שעות נוספות &nbsp;|&nbsp; הופק: ${new Date().toLocaleDateString('he-IL')}</div>
</div></body></html>`);
  w.document.close(); setTimeout(() => w.print(), 700);
  toast('נפתח חלון הדפסה','ok');
}

// ── ALL EMPLOYEES REPORT ──────────────────────────────────────────────────────

function _openAllEmpReport() {
  const el = document.getElementById('emp-list');
  const now = new Date(), cm = now.getMonth()+1, cy = now.getFullYear();
  el.innerHTML = `
    <button class="btn btn-ghost btn-sm mt8" id="emp-rpt-back">← חזרה לרשימה</button>
    <div class="card mt12">
      <div class="card-title">דוח נוכחות — כל העובדים</div>
      <div class="row" style="gap:8px;align-items:flex-end;flex-wrap:wrap">
        <div class="form-group" style="flex:1;min-width:100px"><label class="form-label">חודש</label>
          <select class="form-input" id="all-emp-r-month">${MN.slice(1).map((n,i)=>`<option value="${i+1}">${n}</option>`).join('')}</select></div>
        <div class="form-group" style="flex:1;min-width:80px"><label class="form-label">שנה</label>
          <select class="form-input" id="all-emp-r-year">${[cy,cy-1,cy-2].map(y=>`<option value="${y}">${y}</option>`).join('')}</select></div>
        <button class="btn btn-primary" id="btn-all-emp-gen" style="width:auto;padding:12px 20px;margin-bottom:2px">📊 הפק</button>
      </div>
    </div>
    <div id="all-emp-r-out"></div>`;
  document.getElementById('emp-rpt-back').onclick = filterEmps;
  document.getElementById('all-emp-r-month').value = cm;
  document.getElementById('all-emp-r-year').value = cy;
  document.getElementById('btn-all-emp-gen').onclick = () =>
    _showAllEmpMonthly(+document.getElementById('all-emp-r-month').value, +document.getElementById('all-emp-r-year').value);
  _showAllEmpMonthly(cm, cy);
}

function _showAllEmpMonthly(month, year) {
  const pfx = monthPrefix(month, year);
  const data = D.employees.map(emp => {
    const entries  = D.attendance.filter(a => a.empId === emp.id && a.date?.startsWith(pfx));
    const workDays = new Set(entries.map(a => a.date)).size;
    const rate     = +(emp.dailyRate||0);
    return { emp, workDays, rate, totalPay: workDays * rate };
  }).filter(r => r.workDays > 0).sort((a,b) => b.workDays - a.workDays);

  const totalDays  = data.reduce((s,r) => s + r.workDays, 0);
  const grandTotal = data.reduce((s,r) => s + r.totalPay, 0);
  const out = document.getElementById('all-emp-r-out');

  if (!data.length) {
    out.innerHTML = `<div class="empty mt16"><div class="empty-icon">📋</div><div class="empty-title">אין נוכחות לחודש זה</div></div>`;
    return;
  }

  out.innerHTML = `
    <div class="card mt8">
      <div class="card-title">סיכום ${MN[month]} ${year}</div>
      <div class="list-item" style="border:none;padding:4px 0"><span>עובדים שדווחו</span><span style="font-weight:700;margin-right:auto">${data.length}</span></div>
      <div class="list-item" style="border:none;padding:4px 0"><span>סה"כ ימי עבודה</span><span style="font-weight:700;margin-right:auto;color:var(--gold)">${totalDays}</span></div>
      ${grandTotal?`<div class="list-item" style="border:none;padding:6px 0;border-top:1px solid var(--border)"><span style="font-weight:700">סה"כ שכר</span><span style="font-weight:800;margin-right:auto;color:var(--gold);font-size:16px">${grandTotal.toLocaleString('he-IL')} ₪</span></div>`:''}
    </div>
    <div class="card mt8">
      ${data.map(r => `
        <div class="list-item" style="padding:8px 0">
          <div class="li-info" style="flex:1">
            <div class="li-name">${r.emp.name}</div>
            <div class="li-sub">${r.emp.profession||''}</div>
          </div>
          <div style="text-align:left">
            <div style="font-weight:700;color:var(--gold)">${r.workDays} ימים</div>
            ${r.rate?`<div style="font-size:12px;color:var(--muted)">${r.totalPay.toLocaleString('he-IL')} ₪</div>`:''}
          </div>
        </div>`).join('')}
    </div>
    <div class="btn-row mt8">
      <button class="btn btn-ghost btn-sm fg" id="btn-all-emp-pdf">📄 PDF</button>
      <button class="btn btn-ghost btn-sm fg" id="btn-all-emp-csv">📥 CSV</button>
    </div>`;

  document.getElementById('btn-all-emp-pdf').onclick = () =>
    _exportAllEmpPDF(data, month, year, totalDays, grandTotal);
  document.getElementById('btn-all-emp-csv').onclick = () => {
    exportCSV(
      ['עובד','מקצוע','ימי עבודה','תעריף יומי','סה"כ שכר'],
      data.map(r => [r.emp.name, r.emp.profession||'', r.workDays, r.rate||'', r.totalPay||'']),
      `עובדים_${MN[month]}_${year}.csv`
    );
    toast('CSV הורד','ok');
  };
}

function _exportAllEmpPDF(data, month, year, totalDays, grandTotal) {
  const w = window.open('', '_blank');
  if (!w) { toast('אפשר חלונות קופצים','err'); return; }
  const tableRows = data.map((r,i) => `
    <tr>
      <td class="tc muted">${i+1}</td>
      <td class="tname">${r.emp.name}${r.emp.profession?`<br><span class="sub-cell">${r.emp.profession}</span>`:''}</td>
      <td class="tc mono bold ${r.workDays>0?'green':''}">${r.workDays}</td>
      <td class="tc mono">${r.rate>0?r.rate.toLocaleString('he-IL')+' ₪':'—'}</td>
      <td class="tc mono bold ${r.totalPay>0?'green':''}">${r.totalPay>0?r.totalPay.toLocaleString('he-IL')+' ₪':'—'}</td>
    </tr>`).join('');
  w.document.write(`<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;600;700;800&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Heebo',sans-serif;direction:rtl;background:#fff;color:#181410}
  .page{width:794px;padding:0;background:#fff}
  .page-header{background:linear-gradient(135deg,#1A1714 0%,#2C2620 100%);padding:28px 36px 24px;border-bottom:3px solid #B8922C}
  .biz-name{color:#B8922C;font-size:11px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:10px}
  .rep-title{color:#EDE8DF;font-size:26px;font-weight:800;margin-bottom:4px}
  .rep-sub{color:rgba(237,232,223,.65);font-size:13px}
  .page-body{padding:28px 36px}
  table{width:100%;border-collapse:collapse;margin-bottom:20px}
  thead tr{background:#B8922C}
  thead th{color:#fff;padding:10px;font-size:11px;font-weight:700;text-align:center}
  thead th.tleft{text-align:right}
  tbody tr:nth-child(even){background:#FBF9F4}
  td{padding:9px 10px;font-size:12px;border-bottom:1px solid rgba(184,146,44,.10)}
  td.tc{text-align:center} td.tname{text-align:right;font-weight:600;color:#181410}
  td.mono{font-family:'JetBrains Mono',monospace} td.bold{font-weight:700}
  td.green{color:#2A6B47} td.muted{color:#9A9189;font-size:11px}
  .sub-cell{font-size:10px;color:#9A9189;font-weight:400}
  tfoot tr{background:#B8922C}
  tfoot td{color:#fff;padding:10px;font-weight:800;text-align:center;font-size:13px}
  tfoot td.tname{text-align:right} tfoot td.mono{font-family:'JetBrains Mono',monospace}
  .stats-banner{display:flex;gap:0;border:1.5px solid rgba(184,146,44,.30);border-radius:10px;overflow:hidden;margin-bottom:20px}
  .stat-item{flex:1;padding:14px 10px;text-align:center;background:#FBF6EC;border-left:1px solid rgba(184,146,44,.20)}
  .stat-item:last-child{border-left:none}
  .stat-label{font-size:10px;color:#9A9189;margin-bottom:5px;font-weight:600}
  .stat-value{font-size:22px;font-weight:800;color:#B8922C;font-family:'JetBrains Mono',monospace}
  .page-footer{text-align:center;font-size:10px;color:#9A9189;border-top:1px solid #E5E0D8;padding-top:12px}
  @media print{body{background:#fff}@page{size:A4 portrait;margin:0}.page{width:auto}}
</style>
</head><body><div class="page">
  <div class="page-header">
    <div class="biz-name">${BUSINESS_NAME}</div>
    <div class="rep-title">דוח נוכחות חודשי</div>
    <div class="rep-sub">${MN[month]} ${year}</div>
  </div>
  <div class="page-body">
    <table>
      <thead><tr>
        <th style="width:36px">#</th><th class="tleft">שם עובד</th>
        <th>ימי עבודה</th><th>תעריף יומי</th><th>סה"כ לתשלום</th>
      </tr></thead>
      <tbody>${tableRows}</tbody>
      <tfoot><tr>
        <td></td><td class="tname">סה"כ</td>
        <td class="mono">${totalDays}</td><td>—</td>
        <td class="mono">${grandTotal>0?grandTotal.toLocaleString('he-IL')+' ₪':'—'}</td>
      </tr></tfoot>
    </table>
    <div class="stats-banner">
      <div class="stat-item"><div class="stat-label">עובדים ברשימה</div><div class="stat-value">${data.length}</div></div>
      <div class="stat-item"><div class="stat-label">עובדים שהגיעו</div><div class="stat-value">${data.filter(r=>r.workDays>0).length}</div></div>
      <div class="stat-item"><div class="stat-label">ימי נוכחות</div><div class="stat-value">${totalDays}</div></div>
      <div class="stat-item"><div class="stat-label">שכר כולל מוערך</div><div class="stat-value" style="font-size:${grandTotal>999999?'14':'17'}px">${grandTotal>0?grandTotal.toLocaleString('he-IL')+' ₪':'—'}</div></div>
    </div>
    <div class="page-footer">הופק: ${new Date().toLocaleDateString('he-IL')} &nbsp;|&nbsp; ${BUSINESS_NAME} &nbsp;|&nbsp; * תעריפים לפי נתוני מערכת</div>
  </div>
</div></body></html>`);
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
