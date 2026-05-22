import { MN, DAYS_HE, BUSINESS_NAME } from '../config.js';
import { D } from '../state.js';
import { uid, pad, monthPrefix, getDaysInMonth, toast, openSheet, isLocked, getActs, exportCSV } from '../utils.js';
import { sAppend, rebuildTab, logAudit } from '../api.js';

let _type = 'attendance'; // attendance | site | equip | payroll | builder

// ── DESIGN TOKENS (A4 print) ─────────────────────────────────────────────────
const RP = {
  gold: '#B8922C', goldSoft: '#FBF6EC', goldBorder: 'rgba(184,146,44,0.30)',
  ink: '#181410', ink2: '#3A332C', ink3: '#6C6259', ink4: '#9A9189',
  paper: '#FFFFFF', paperSoft: '#FBF9F4', paperWarm: '#F7F4EE',
  green: '#2A6B47', greenSoft: '#E9F1EC',
  red: '#A8362B',
  dark1: '#1A1714', dark2: '#2C2620',
  font: "'Heebo', sans-serif",
  mono: "'JetBrains Mono', ui-monospace, monospace",
};

// ── ENTRY POINT ──────────────────────────────────────────────────────────────
export function renderReports() {
  const scroll = document.querySelector('#s-reports .scroll');
  if (!scroll) return;
  const now = new Date(), cm = now.getMonth()+1, cy = now.getFullYear();
  scroll.innerHTML = `
    <div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:6px;margin-bottom:14px;scrollbar-width:none">
      ${[
        ['attendance','👷 נוכחות'],
        ['site',      '📍 יומן אתר'],
        ['equip',     '🏗️ ציוד'],
        ['payroll',   '💰 שכר'],
        ['builder',   '⚙️ מחולל'],
      ].map(([k,l])=>`<button class="status-chip${_type===k?' active-s':''}" style="white-space:nowrap;flex-shrink:0" data-rtype="${k}">${l}</button>`).join('')}
    </div>
    <div id="rep-body"></div>`;
  scroll.querySelectorAll('[data-rtype]').forEach(btn => btn.addEventListener('click', () => {
    _type = btn.dataset.rtype; renderReports();
  }));
  if      (_type==='attendance') _renderAttendance(cm, cy);
  else if (_type==='site')       _renderSite(cm, cy);
  else if (_type==='equip')      _renderEquipReport(cm, cy);
  else if (_type==='payroll')    _renderPayroll(cm, cy);
  else if (_type==='builder')    _renderBuilder(cm, cy);
}

export function initSelects() {
  const now = new Date();
  const lm = document.getElementById('lk-month');
  const ly = document.getElementById('lk-year');
  if (lm) {
    MN.slice(1).forEach((m,i) => { lm.innerHTML += `<option value="${i+1}">${m}</option>`; });
    lm.value = now.getMonth()+1;
  }
  if (ly) {
    for (let y=now.getFullYear(); y>=now.getFullYear()-3; y--) ly.innerHTML += `<option value="${y}">${y}</option>`;
  }
}

// ── SHARED HELPERS ───────────────────────────────────────────────────────────
function _periodRow(cm, cy, id='rp') {
  return `<div class="row" style="gap:8px;align-items:flex-end;flex-wrap:wrap;margin-bottom:12px">
    <div class="form-group" style="flex:1;min-width:100px"><label class="form-label">חודש</label>
    <select class="form-input" id="${id}-m">${MN.slice(1).map((n,i)=>`<option value="${i+1}"${i+1===cm?' selected':''}>${n}</option>`).join('')}</select></div>
    <div class="form-group" style="flex:1;min-width:80px"><label class="form-label">שנה</label>
    <select class="form-input" id="${id}-y">${[cy,cy-1,cy-2].map(y=>`<option value="${y}"${y===cy?' selected':''}>${y}</option>`).join('')}</select></div>
    <button class="btn btn-primary" id="${id}-gen" style="width:auto;padding:12px 20px;margin-bottom:2px">📊 הפק</button>
  </div>`;
}
function _getm(id='rp') { return +document.getElementById(`${id}-m`).value; }
function _gety(id='rp') { return +document.getElementById(`${id}-y`).value; }

function _openPrint(html) {
  const w = window.open('','_blank');
  if (!w) { toast('אפשר חלונות קופצים','err'); return; }
  w.document.write(html);
  w.document.close();
  setTimeout(()=>w.print(), 700);
}

// Legacy simple doc builder (used by payroll + builder tabs)
function _buildDoc(title, subtitle, body) {
  return `<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="UTF-8">
  <link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;700;800&display=swap" rel="stylesheet">
  <style>*{font-family:'Heebo',sans-serif;box-sizing:border-box}body{margin:16px;direction:rtl;font-size:12px;background:#fff}
  .biz{color:#B8922C;font-size:13px;font-weight:800;text-align:center;margin-bottom:2px}
  h2{color:#B8922C;text-align:center;font-size:18px;margin-bottom:4px;font-weight:800}
  .sub{color:#726E68;text-align:center;font-size:12px;margin-bottom:16px}
  table{width:100%;border-collapse:collapse}
  th{background:#B8922C;color:#fff;padding:8px 6px;font-size:11px;text-align:center}
  td{padding:7px 6px;border-bottom:1px solid rgba(184,146,44,.12);font-size:11px;text-align:center;vertical-align:top}
  tr:nth-child(even) td{background:#FEFCF5}
  tfoot td{background:#B8922C;color:#fff;font-weight:800}
  @media print{body{margin:8px}}</style></head><body>
  <div class="biz">${BUSINESS_NAME}</div><h2>${title}</h2><div class="sub">${subtitle}</div>${body}</body></html>`;
}

// ── ATTENDANCE ───────────────────────────────────────────────────────────────
function _renderAttendance(cm, cy) {
  const b = document.getElementById('rep-body');
  b.innerHTML = _periodRow(cm, cy, 'att');
  document.getElementById('att-gen').onclick = () => _showAttendance(_getm('att'), _gety('att'));
  _showAttendance(cm, cy);
}

function _getAttData(month, year) {
  const pfx = monthPrefix(month, year);
  const ma = D.attendance.filter(a => a.date?.startsWith(pfx));
  const siteD = {};
  D.logs.filter(l=>l.date?.startsWith(pfx)).forEach(l=>{
    if (!siteD[l.siteId]) siteD[l.siteId]={name:l.siteName,days:0};
    siteD[l.siteId].days++;
  });
  const empMap = {};
  ma.forEach(a => {
    if (!empMap[a.empId]) empMap[a.empId]={name:a.empName,days:0,dates:new Set()};
    empMap[a.empId].days++;
    empMap[a.empId].dates.add(a.date);
  });
  D.employees.filter(e=>e.active==='פעיל').forEach(e=>{
    if (!empMap[e.id]) empMap[e.id]={name:e.name,days:0,dates:new Set()};
  });
  return {empMap, siteD, total:ma.length, month, year};
}

function _showAttendance(month, year) {
  const {empMap,siteD,total} = _getAttData(month,year);
  const lk = isLocked(`${monthPrefix(month,year)}-01`);
  const el = document.getElementById('rep-body');
  const existing = el.querySelector('#att-results');
  const empOptions = Object.entries(empMap)
    .sort((a,b)=>a[1].name.localeCompare(b[1].name,'he'))
    .map(([id,e])=>`<option value="${id}">${e.name} (${e.days} ימים)</option>`)
    .join('');
  const html = `<div id="att-results">
    ${lk?'<div class="locked-bar">נעול</div>':''}
    <div class="card">
      <div class="card-title">סיכום ${MN[month]} ${year}</div>
      <div class="list-item" style="border:none;padding:4px 0"><span>יומנים</span><span style="font-weight:700;margin-right:auto">${D.logs.filter(l=>l.date?.startsWith(monthPrefix(month,year))).length}</span></div>
      <div class="list-item" style="border:none;padding:4px 0"><span>עובדים שעבדו</span><span style="font-weight:700;margin-right:auto">${Object.values(empMap).filter(e=>e.days>0).length}</span></div>
      <div class="list-item" style="border:none;padding:4px 0"><span>ימי נוכחות כולל</span><span style="font-weight:700;margin-right:auto;color:var(--gold)">${total}</span></div>
    </div>
    <div class="card">
      <div class="card-title">לפי עובד</div>
      ${Object.values(empMap).sort((a,b)=>b.days-a.days).map(e=>`
        <div class="list-item"><div class="avatar av-blue">👷</div>
        <div class="li-name fg">${e.name}</div>
        <span class="badge ${e.days>0?'b-blue':'b-gray'}">${e.days} ימים</span></div>`).join('')}
    </div>
    <div class="card">
      <div class="card-title">לפי אתר</div>
      ${Object.values(siteD).sort((a,b)=>b.days-a.days).map(s=>`
        <div class="list-item"><div class="avatar av-gold">📍</div>
        <div class="li-name fg">${s.name}</div>
        <span class="badge b-gold">${s.days} ימים</span></div>`).join('')}
    </div>
    <div class="card">
      <div class="card-title">הפקת דוחות</div>
      <div style="margin-bottom:12px">
        <div style="font-size:11px;color:var(--muted);font-weight:700;letter-spacing:.3px;margin-bottom:6px;text-transform:uppercase">ריכוז ניהולי — כל העובדים</div>
        <div class="btn-row">
          <button class="btn btn-ghost btn-sm fg" id="att-pdf-sum">ריכוז PDF</button>
          <button class="btn btn-ghost btn-sm fg" id="att-csv">CSV</button>
        </div>
      </div>
      <div style="border-top:1px solid var(--border);padding-top:12px">
        <div style="font-size:11px;color:var(--muted);font-weight:700;letter-spacing:.3px;margin-bottom:6px;text-transform:uppercase">כרטיס עובד — בחר עובד ספציפי</div>
        <div class="row" style="gap:8px;align-items:center;flex-wrap:wrap">
          <select class="form-input" id="att-emp-sel" style="flex:1;min-width:140px">
            <option value="">כל העובדים</option>
            ${empOptions}
          </select>
          <button class="btn btn-ghost btn-sm fg" id="att-pdf-full" style="width:auto;padding:8px 14px;flex-shrink:0">כרטיס עובד PDF</button>
        </div>
      </div>
    </div>
  </div>`;
  if (existing) existing.outerHTML = html; else el.insertAdjacentHTML('beforeend', html);
  document.getElementById('att-pdf-sum').onclick  = () => _doSummaryPDF({month, year, empMap});
  document.getElementById('att-pdf-full').onclick = () => {
    const empId = document.getElementById('att-emp-sel').value || null;
    _doFullPDF({month, year, empMap, empId});
  };
  document.getElementById('att-csv').onclick = () => _doCSV({month, year, empMap});
}

// ── R2: MANAGEMENT SUMMARY PDF ───────────────────────────────────────────────
function _doSummaryPDF({month, year, empMap}) {
  if (!month) { toast('הפק דוח תחילה','err'); return; }
  const rows = Object.entries(empMap)
    .sort((a,b)=>a[1].name.localeCompare(b[1].name,'he'))
    .map(([empId,e]) => {
      const emp  = D.employees.find(x=>x.id===empId);
      const rate = emp?.dailyRate || 0;
      return { name:e.name, profession:emp?.profession||'', days:e.days, rate, pay:e.days*rate };
    });
  const totalDays = rows.reduce((s,r)=>s+r.days, 0);
  const totalPay  = rows.reduce((s,r)=>s+r.pay,  0);
  const activeCount = rows.filter(r=>r.days>0).length;

  const tableRows = rows.map((r,i)=>`
    <tr>
      <td class="tc muted">${i+1}</td>
      <td class="tname">${r.name}${r.profession?`<br><span class="sub-cell">${r.profession}</span>`:''}</td>
      <td class="tc mono bold ${r.days>0?'green':''}">${r.days}</td>
      <td class="tc mono">${r.rate>0?r.rate.toLocaleString('he-IL')+' ₪':'—'}</td>
      <td class="tc mono bold ${r.pay>0?'green':''}">${r.pay>0?r.pay.toLocaleString('he-IL')+' ₪':'—'}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="UTF-8">
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
  thead th{color:#fff;padding:10px 10px;font-size:11px;font-weight:700;text-align:center}
  thead th.tleft{text-align:right}
  tbody tr:nth-child(even){background:#FBF9F4}
  tbody tr:hover{background:#FBF6EC}
  td{padding:9px 10px;font-size:12px;border-bottom:1px solid rgba(184,146,44,.10)}
  td.tc{text-align:center}
  td.tname{text-align:right;font-weight:600;color:#181410}
  td.mono{font-family:'JetBrains Mono',monospace}
  td.bold{font-weight:700}
  td.green{color:#2A6B47}
  td.muted{color:#9A9189;font-size:11px}
  .sub-cell{font-size:10px;color:#9A9189;font-weight:400}
  tfoot tr{background:#B8922C}
  tfoot td{color:#fff;padding:10px 10px;font-weight:800;text-align:center;font-size:13px}
  tfoot td.tname{text-align:right;font-size:13px}
  tfoot td.mono{font-family:'JetBrains Mono',monospace}
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
        <th style="width:36px">#</th>
        <th class="tleft">שם עובד</th>
        <th>ימי עבודה</th>
        <th>תעריף יומי</th>
        <th>סה"כ לתשלום</th>
      </tr></thead>
      <tbody>${tableRows}</tbody>
      <tfoot><tr>
        <td></td>
        <td class="tname">סה"כ</td>
        <td class="mono">${totalDays}</td>
        <td>—</td>
        <td class="mono">${totalPay>0?totalPay.toLocaleString('he-IL')+' ₪':'—'}</td>
      </tr></tfoot>
    </table>
    <div class="stats-banner">
      <div class="stat-item"><div class="stat-label">עובדים ברשימה</div><div class="stat-value">${rows.length}</div></div>
      <div class="stat-item"><div class="stat-label">עובדים שהגיעו</div><div class="stat-value">${activeCount}</div></div>
      <div class="stat-item"><div class="stat-label">ימי נוכחות</div><div class="stat-value">${totalDays}</div></div>
      <div class="stat-item"><div class="stat-label">שכר כולל מוערך</div><div class="stat-value" style="font-size:17px">${totalPay>0?totalPay.toLocaleString('he-IL')+' ₪':'—'}</div></div>
    </div>
    <div class="page-footer">
      הופק: ${new Date().toLocaleDateString('he-IL')} &nbsp;|&nbsp; ${BUSINESS_NAME} &nbsp;|&nbsp; * תעריפים לפי נתוני מערכת
    </div>
  </div>
</div></body></html>`;
  _openPrint(html);
  toast('נפתח חלון הדפסה','ok');
}

// ── R1: INDIVIDUAL ATTENDANCE CARD PDF ──────────────────────────────────────
function _doFullPDF({month, year, empMap, empId}) {
  if (!month) { toast('הפק דוח תחילה','err'); return; }
  const daysCount = getDaysInMonth(year, month);
  // Short day labels Sun→Sat (index = JS getDay())
  const DS = ['א','ב','ג','ד','ה','ו','ש'];

  const emps = empId && empMap[empId]
    ? [[empId, empMap[empId]]]
    : Object.entries(empMap).sort((a,b)=>a[1].name.localeCompare(b[1].name,'he'));

  const pages = emps.map(([eid, emp], idx) => {
    const empDef    = D.employees.find(x=>x.id===eid);
    const rate      = empDef?.dailyRate || 0;
    const profession = empDef?.profession || '';

    let dayHeaders = '', dayCells = '', workedDays = 0;
    for (let d=1; d<=daysCount; d++) {
      const ds   = `${year}-${pad(month)}-${pad(d)}`;
      const dow  = new Date(ds+'T12:00:00').getDay();
      const wknd = dow===5 || dow===6;
      const did  = emp.dates.has(ds);
      if (did) workedDays++;
      dayHeaders += `<th class="${wknd?'wh':''}">${d}<br><span class="dow">${DS[dow]}</span></th>`;
      dayCells   += `<td class="${wknd?'wd':''} ${did?'wk':''}">${did?'✓':''}</td>`;
    }

    const estHours = workedDays * 9;
    const estPay   = workedDays * rate;

    return `<div class="page${idx>0?' brk':''}">
      <div class="card-hdr">
        <div class="hdr-left">
          <div class="biz-label">${BUSINESS_NAME} — כרטיס נוכחות חודשי</div>
          <div class="emp-name">${emp.name}</div>
          <div class="emp-sub">${MN[month]} ${year}${profession?' | '+profession:''}</div>
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
        <div class="stat"><div class="sl">ימי עבודה</div><div class="sv gold">${workedDays}</div></div>
        <div class="sdiv"></div>
        <div class="stat"><div class="sl">שעות מוערכות</div><div class="sv">${estHours}</div><div class="sn">× 9 שע'</div></div>
        <div class="sdiv"></div>
        <div class="stat"><div class="sl">תעריף יומי</div><div class="sv" style="font-size:16px">${rate>0?rate.toLocaleString('he-IL')+' ₪':'לא הוגדר'}</div></div>
        <div class="sdiv"></div>
        <div class="stat"><div class="sl">שכר מוערך</div><div class="sv grn" style="font-size:${estPay>99999?'14':'18'}px">${estPay>0?estPay.toLocaleString('he-IL')+' ₪':'—'}</div></div>
      </div>
      <div class="sig-row">
        <div class="sig"><div class="sig-line"></div><div class="sig-lbl">חתימת עובד</div></div>
        <div class="sig"><div class="sig-line"></div><div class="sig-lbl">אישור מנהל</div></div>
        <div class="sig"><div class="sig-line"></div><div class="sig-lbl">תאריך</div></div>
      </div>
      <div class="fnote">* שעות מוערכות לפי 9 שעות ביום — אינן כוללות שעות נוספות &nbsp;|&nbsp; הופק: ${new Date().toLocaleDateString('he-IL')}</div>
    </div>`;
  }).join('');

  const html = `<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;600;700;800&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Heebo',sans-serif;direction:rtl;background:#fff;color:#181410}
  .page{width:794px;padding:28px 28px 20px;background:#fff}
  .brk{page-break-before:always}
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
  .sv.gold{color:#B8922C}
  .sv.grn{color:#2A6B47}
  .sn{font-size:8.5px;color:#9A9189;margin-top:3px}
  .sdiv{width:1px;background:rgba(184,146,44,.25);margin:0 6px;flex-shrink:0}
  .sig-row{display:flex;gap:28px;margin-bottom:10px;padding-top:6px}
  .sig{flex:1;text-align:center}
  .sig-line{height:1px;background:#181410;margin-bottom:5px;margin-top:24px}
  .sig-lbl{font-size:10px;color:#6C6259}
  .fnote{font-size:8.5px;color:#9A9189;text-align:center;border-top:1px solid #E5E0D8;padding-top:8px}
  @media print{body{background:#fff}@page{size:A4 portrait;margin:0}.page{width:auto;padding:20px 20px 16px}.brk{page-break-before:always}}
</style>
</head><body>${pages}</body></html>`;
  _openPrint(html);
  toast(`${emps.length === 1 ? 'כרטיס עובד' : emps.length+' כרטיסים'} — נפתח חלון הדפסה`, 'ok');
}

// ── CSV EXPORT ───────────────────────────────────────────────────────────────
function _doCSV({month, year, empMap}) {
  if (!month) { toast('הפק דוח תחילה','err'); return; }
  exportCSV(
    ['שם עובד','ימי עבודה','תאריכים'],
    Object.values(empMap).sort((a,b)=>b.days-a.days)
      .map(e=>[e.name, e.days, [...e.dates].sort().join(' | ')]),
    `נוכחות_${MN[month]}_${year}.csv`
  );
  toast('CSV הורד','ok');
}

// ── R3: EQUIPMENT COST REPORT ────────────────────────────────────────────────
function _renderEquipReport(cm, cy) {
  const b = document.getElementById('rep-body');
  b.innerHTML = _periodRow(cm, cy, 'eq') + '<div id="eq-results"></div>';
  document.getElementById('eq-gen').onclick = () => _showEquipReport(_getm('eq'), _gety('eq'));
  _showEquipReport(cm, cy);
}

function _buildEquipRows(month, year) {
  const pfx = monthPrefix(month, year);
  return D.equipment
    .map(eq => {
      const entries  = D.logEquip.filter(e => e.eqId === eq.id && e.date?.startsWith(pfx));
      const daysUsed = new Set(entries.map(e => e.date)).size;
      const dailyRate = eq.dailyRate || 0;
      const totalCost = daysUsed * dailyRate;
      const sites = [...new Set(entries.map(e => e.siteId))]
        .map(sid => D.sites.find(s => s.id === sid)?.name || sid)
        .filter(Boolean);
      return { name: eq.name, type: eq.type || '', dailyRate, daysUsed, totalCost, sites };
    })
    .sort((a, b) => b.daysUsed - a.daysUsed);
}

function _showEquipReport(month, year) {
  const rows       = _buildEquipRows(month, year);
  const activeRows = rows.filter(r => r.daysUsed > 0);
  const totalDays  = rows.reduce((s, r) => s + r.daysUsed, 0);
  const grandTotal = rows.reduce((s, r) => s + r.totalCost, 0);

  const el       = document.getElementById('rep-body');
  const existing = el.querySelector('#eq-results');

  const html = `<div id="eq-results">
    <div class="card">
      <div class="card-title">ציוד — ${MN[month]} ${year}</div>
      <div class="list-item" style="border:none;padding:4px 0"><span>סה״כ ציוד</span><span style="font-weight:700;margin-right:auto">${rows.length}</span></div>
      <div class="list-item" style="border:none;padding:4px 0"><span>ציוד בשימוש</span><span style="font-weight:700;margin-right:auto">${activeRows.length}</span></div>
      <div class="list-item" style="border:none;padding:4px 0"><span>סה״כ ימי שימוש</span><span style="font-weight:700;margin-right:auto">${totalDays}</span></div>
      <div class="list-item" style="border:none;padding:4px 0"><span>עלות כוללת</span><span style="font-weight:700;margin-right:auto;color:var(--gold)">${grandTotal > 0 ? grandTotal.toLocaleString('he-IL') + ' ₪' : '—'}</span></div>
    </div>
    <div class="card">
      <div class="card-title">פירוט ציוד</div>
      ${rows.length ? rows.map(r => `
        <div class="list-item" style="padding:10px 0;border-bottom:1px solid var(--border)">
          <div class="avatar av-gold">🏗️</div>
          <div class="li-info">
            <div class="li-name">${r.name}${r.type ? ` · <span style="font-weight:400;color:var(--muted)">${r.type}</span>` : ''}</div>
            <div class="li-sub">${r.daysUsed} ימים × ${r.dailyRate > 0 ? r.dailyRate.toLocaleString('he-IL') + ' ₪' : '—'}</div>
          </div>
          <span class="badge ${r.totalCost > 0 ? 'b-gold' : 'b-gray'}">${r.totalCost > 0 ? r.totalCost.toLocaleString('he-IL') + ' ₪' : '0 ₪'}</span>
        </div>`).join('') :
        '<div class="empty"><div class="empty-icon">🏗️</div><div class="empty-title">אין ציוד רשום</div></div>'}
    </div>
    <div class="btn-row mt8">
      <button class="btn btn-ghost btn-sm fg" id="eq-pdf">🖨️ PDF</button>
      <button class="btn btn-ghost btn-sm fg" id="eq-csv">📥 CSV</button>
    </div>
  </div>`;

  if (existing) existing.outerHTML = html; else el.insertAdjacentHTML('beforeend', html);

  document.getElementById('eq-pdf').onclick = () => _doEquipPDF({ month, year, rows });
  document.getElementById('eq-csv').onclick = () => {
    exportCSV(
      ['ציוד', 'סוג', 'תעריף יומי (₪)', 'ימי שימוש', 'עלות כוללת (₪)'],
      rows.map(r => [r.name, r.type, r.dailyRate, r.daysUsed, r.totalCost]),
      `ציוד_${MN[month]}_${year}.csv`
    );
    toast('CSV הורד', 'ok');
  };
}

function _doEquipPDF({ month, year, rows }) {
  const grandTotal = rows.reduce((s, r) => s + r.totalCost, 0);
  const totalDays  = rows.reduce((s, r) => s + r.daysUsed, 0);
  const activeRows = rows.filter(r => r.daysUsed > 0);

  const tableRows = rows.map((r, i) => `
    <tr>
      <td class="tc muted">${i + 1}</td>
      <td class="tname">${r.name}${r.type ? `<br><span class="sub-cell">${r.type}</span>` : ''}</td>
      <td class="tc mono">${r.dailyRate > 0 ? r.dailyRate.toLocaleString('he-IL') + ' ₪' : '—'}</td>
      <td class="tc mono bold ${r.daysUsed > 0 ? 'gold' : ''}">${r.daysUsed}</td>
      <td class="tc mono bold ${r.totalCost > 0 ? 'green' : ''}">${r.totalCost > 0 ? r.totalCost.toLocaleString('he-IL') + ' ₪' : '—'}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;600;700;800&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Heebo',sans-serif;direction:rtl;background:#fff;color:#181410}
  .page{width:794px;padding:0;background:#fff}
  .page-header{background:linear-gradient(135deg,#1A1714 0%,#2C2620 100%);padding:28px 36px 24px;border-bottom:3px solid #B8922C}
  .biz-name{color:#B8922C;font-size:11px;font-weight:800;letter-spacing:1.5px;margin-bottom:10px}
  .rep-title{color:#EDE8DF;font-size:26px;font-weight:800;margin-bottom:4px}
  .rep-sub{color:rgba(237,232,223,.65);font-size:13px}
  .page-body{padding:28px 36px}
  table{width:100%;border-collapse:collapse;margin-bottom:20px}
  thead tr{background:#B8922C}
  thead th{color:#fff;padding:10px;font-size:11px;font-weight:700;text-align:center}
  thead th.tleft{text-align:right}
  tbody tr:nth-child(even){background:#FBF9F4}
  tbody tr:hover{background:#FBF6EC}
  td{padding:9px 10px;font-size:12px;border-bottom:1px solid rgba(184,146,44,.10)}
  td.tc{text-align:center}
  td.tname{text-align:right;font-weight:600;color:#181410}
  td.mono{font-family:'JetBrains Mono',monospace}
  td.bold{font-weight:700}
  td.green{color:#2A6B47}
  td.gold{color:#B8922C}
  td.muted{color:#9A9189;font-size:11px}
  .sub-cell{font-size:10px;color:#9A9189;font-weight:400}
  tfoot tr{background:#B8922C}
  tfoot td{color:#fff;padding:10px;font-weight:800;text-align:center;font-size:13px}
  tfoot td.tname{text-align:right}
  tfoot td.mono{font-family:'JetBrains Mono',monospace}
  .stats-banner{display:flex;gap:0;border:1.5px solid rgba(184,146,44,.30);border-radius:10px;overflow:hidden;margin-bottom:20px}
  .stat-item{flex:1;padding:14px 10px;text-align:center;background:#FBF6EC;border-left:1px solid rgba(184,146,44,.20)}
  .stat-item:last-child{border-left:none}
  .stat-label{font-size:10px;color:#9A9189;margin-bottom:5px;font-weight:600}
  .stat-value{font-size:22px;font-weight:800;color:#B8922C;font-family:'JetBrains Mono',monospace}
  .stat-value.grn{color:#2A6B47}
  .page-footer{text-align:center;font-size:10px;color:#9A9189;border-top:1px solid #E5E0D8;padding-top:12px;margin-top:4px}
  @media print{body{background:#fff}@page{size:A4 portrait;margin:0}.page{width:auto}}
</style>
</head><body><div class="page">
  <div class="page-header">
    <div class="biz-name">${BUSINESS_NAME}</div>
    <div class="rep-title">דוח עלויות ציוד</div>
    <div class="rep-sub">${MN[month]} ${year}</div>
  </div>
  <div class="page-body">
    <div class="stats-banner">
      <div class="stat-item"><div class="stat-label">סה״כ ציוד</div><div class="stat-value">${rows.length}</div></div>
      <div class="stat-item"><div class="stat-label">ציוד פעיל</div><div class="stat-value">${activeRows.length}</div></div>
      <div class="stat-item"><div class="stat-label">ימי שימוש</div><div class="stat-value">${totalDays}</div></div>
      <div class="stat-item"><div class="stat-label">עלות כוללת</div><div class="stat-value grn" style="font-size:${grandTotal > 99999 ? '15' : '18'}px">${grandTotal > 0 ? grandTotal.toLocaleString('he-IL') + ' ₪' : '—'}</div></div>
    </div>
    <table>
      <thead><tr>
        <th style="width:36px">#</th>
        <th class="tleft">ציוד</th>
        <th>תעריף יומי</th>
        <th>ימי שימוש</th>
        <th>עלות כוללת</th>
      </tr></thead>
      <tbody>${tableRows}</tbody>
      <tfoot><tr>
        <td></td>
        <td class="tname">סה״כ</td>
        <td></td>
        <td class="mono">${totalDays}</td>
        <td class="mono">${grandTotal > 0 ? grandTotal.toLocaleString('he-IL') + ' ₪' : '—'}</td>
      </tr></tfoot>
    </table>
    <div class="page-footer">תאריך הפקה: ${new Date().toLocaleDateString('he-IL')} &nbsp;|&nbsp; ${BUSINESS_NAME}</div>
  </div>
</div></body></html>`;
  _openPrint(html);
  toast('מפיק PDF ציוד', 'ok');
}

// ── SITE JOURNAL ─────────────────────────────────────────────────────────────
function _renderSite(cm, cy) {
  const b = document.getElementById('rep-body');
  b.innerHTML = _periodRow(cm, cy, 'site') + '<div id="site-results"></div>';
  document.getElementById('site-gen').onclick = () => _showSite(_getm('site'), _gety('site'));
  _showSite(cm, cy);
}

function _showSite(month, year) {
  const pfx = monthPrefix(month, year);
  const ml  = D.logs.filter(l=>l.date?.startsWith(pfx));
  const siteD = {};
  ml.forEach(l=>{
    if(!siteD[l.siteId]) siteD[l.siteId]={name:l.siteName,days:0,logs:[]};
    siteD[l.siteId].days++;
    siteD[l.siteId].logs.push(l);
  });
  const el = document.getElementById('rep-body');
  const existing = el.querySelector('#site-results');
  const siteCards = Object.entries(siteD).map(([sid,s]) => {
    const logs = s.logs.sort((a,b)=>a.date.localeCompare(b.date));
    return `<div class="card" style="margin-top:8px">
      <div class="card-title" style="display:flex;justify-content:space-between;align-items:center">
        <span>📍 ${s.name}</span>
        <button class="btn btn-ghost btn-sm site-pdf-btn" data-sid="${sid}" data-month="${month}" data-year="${year}" style="width:auto;padding:5px 10px;font-size:12px">📄 PDF</button>
      </div>
      ${logs.map(l=>{
        const att=D.attendance.filter(a=>a.logId===l.id),eq=D.logEquip.filter(e=>e.logId===l.id),dl=D.deliveries.filter(d=>d.logId===l.id),acts=getActs(l);
        return `<div style="border-bottom:1px solid var(--border);padding:10px 0">
          <div style="font-weight:700;font-size:14px;margin-bottom:4px">${new Date(l.date+'T12:00:00').toLocaleDateString('he-IL',{day:'numeric',month:'long'})}</div>
          ${acts.length?`<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:4px">${acts.map(a=>`<span class="badge b-blue">${a}</span>`).join('')}</div>`:''}
          ${att.length?`<div style="font-size:12px;color:var(--muted);margin-bottom:2px">👷 ${att.map(a=>a.empName).join(', ')}</div>`:''}
          ${eq.length?`<div style="font-size:12px;color:var(--muted);margin-bottom:2px">🚜 ${eq.map(e=>e.eqName).join(', ')}</div>`:''}
          ${dl.length?`<div style="font-size:12px;color:var(--muted);margin-bottom:2px">🚚 ${dl.map(d=>d.material+(d.qty?' ('+d.qty+')':'')).join(', ')}</div>`:''}
          ${l.notes?`<div style="font-size:12px;color:var(--text);margin-top:2px;line-height:1.5">${l.notes}</div>`:''}
        </div>`;
      }).join('')}
    </div>`;
  }).join('');
  const html = `<div id="site-results">
    <div class="card"><div class="card-title">סיכום ${MN[month]} ${year}</div>
      <div class="list-item" style="border:none;padding:4px 0"><span>אתרים פעילים</span><span style="font-weight:700;margin-right:auto">${Object.keys(siteD).length}</span></div>
      <div class="list-item" style="border:none;padding:4px 0"><span>סה"כ יומנים</span><span style="font-weight:700;margin-right:auto;color:var(--gold)">${ml.length}</span></div>
    </div>
    ${siteCards||'<div class="empty"><div class="empty-icon">📍</div><div class="empty-title">אין יומנים לחודש זה</div></div>'}
  </div>`;
  if (existing) existing.outerHTML = html; else el.insertAdjacentHTML('beforeend', html);
  el.querySelectorAll('.site-pdf-btn').forEach(btn => btn.addEventListener('click',
    ()=>exportSiteMonthPDF(btn.dataset.sid,+btn.dataset.month,+btn.dataset.year)));
}

// ── PAYROLL ──────────────────────────────────────────────────────────────────
function _renderPayroll(cm, cy) {
  const b = document.getElementById('rep-body');
  b.innerHTML = _periodRow(cm, cy, 'pay');
  document.getElementById('pay-gen').onclick = () => _showPayroll(_getm('pay'), _gety('pay'));
  _showPayroll(cm, cy);
}

function _showPayroll(month, year) {
  const pfx = monthPrefix(month, year);
  const ma  = D.attendance.filter(a=>a.date?.startsWith(pfx));
  const empMap = {};
  ma.forEach(a=>{
    if (!empMap[a.empId]) { const e=D.employees.find(x=>x.id===a.empId); empMap[a.empId]={name:a.empName,days:0,rate:e?.dailyRate||0}; }
    empMap[a.empId].days++;
  });
  D.employees.filter(e=>e.active==='פעיל').forEach(e=>{
    if(!empMap[e.id]) empMap[e.id]={name:e.name,days:0,rate:e.dailyRate||0};
  });
  const rows = Object.values(empMap).sort((a,b)=>b.days-a.days).map(e=>({...e,total:e.days*e.rate}));
  const grandTotal = rows.reduce((s,r)=>s+r.total,0);
  const el = document.getElementById('rep-body');
  const existing = el.querySelector('#pay-results');
  const html = `<div id="pay-results">
    <div class="card">
      <div class="card-title">שכר ${MN[month]} ${year}</div>
      <div class="list-item" style="border:none;padding:4px 0"><span>עובדים</span><span style="font-weight:700;margin-right:auto">${rows.length}</span></div>
      <div class="list-item" style="border:none;padding:4px 0"><span>עובדים שהגיעו</span><span style="font-weight:700;margin-right:auto">${rows.filter(r=>r.days>0).length}</span></div>
      <div class="list-item" style="border:none;padding:4px 0"><span>סה"כ לתשלום</span><span style="font-weight:700;margin-right:auto;color:var(--gold)">${grandTotal.toLocaleString('he-IL')} ₪</span></div>
    </div>
    <div class="card">
      <div class="card-title">פירוט עובדים</div>
      ${rows.map(r=>`<div class="list-item" style="padding:10px 0;border-bottom:1px solid var(--border)">
        <div class="avatar av-blue">👷</div>
        <div class="li-info"><div class="li-name">${r.name}</div>
        <div class="li-sub">${r.days} ימים × ${r.rate.toLocaleString('he-IL')} ₪</div></div>
        <span class="badge ${r.total>0?'b-gold':'b-gray'}">${r.total.toLocaleString('he-IL')} ₪</span>
      </div>`).join('')}
    </div>
    <div class="btn-row mt8">
      <button class="btn btn-ghost btn-sm fg" id="pay-pdf">📄 PDF</button>
      <button class="btn btn-ghost btn-sm fg" id="pay-csv">📥 CSV</button>
    </div>
  </div>`;
  if (existing) existing.outerHTML = html; else el.insertAdjacentHTML('beforeend', html);
  document.getElementById('pay-pdf').onclick = () => {
    const tableRows=rows.map((r,i)=>`<tr><td>${i+1}</td><td style="text-align:right">${r.name}</td><td>${r.days}</td><td>${r.rate.toLocaleString('he-IL')} ₪</td><td style="font-weight:700">${r.total.toLocaleString('he-IL')} ₪</td></tr>`).join('');
    _openPrint(_buildDoc(`דוח שכר — ${MN[month]} ${year}`,`הופק: ${new Date().toLocaleDateString('he-IL')}`,
      `<table><thead><tr><th>#</th><th style="text-align:right">עובד</th><th>ימי עבודה</th><th>תעריף יומי</th><th>סה"כ לתשלום</th></tr></thead><tbody>${tableRows}</tbody><tfoot><tr><td colspan="4" style="text-align:right">סה"כ</td><td>${grandTotal.toLocaleString('he-IL')} ₪</td></tr></tfoot></table>`));
    toast('נפתח חלון הדפסה','ok');
  };
  document.getElementById('pay-csv').onclick = () => {
    exportCSV(['עובד','ימי עבודה','תעריף יומי (₪)','סה"כ (₪)'],rows.map(r=>[r.name,r.days,r.rate,r.total]),`שכר_${MN[month]}_${year}.csv`);
    toast('CSV הורד','ok');
  };
}

// ── REPORT BUILDER ───────────────────────────────────────────────────────────
const BUILDER_COLS = {
  employees: [
    {id:'name',       label:'שם עובד',        def:true},
    {id:'days',       label:'ימי עבודה',       def:true},
    {id:'rate',       label:'תעריף יומי (₪)',  def:true},
    {id:'total',      label:'סה"כ שכר (₪)',   def:true},
    {id:'profession', label:'תפקיד',           def:false},
    {id:'phone',      label:'טלפון',           def:false},
  ],
  equipment: [
    {id:'name',      label:'שם ציוד',         def:true},
    {id:'type',      label:'סוג',             def:true},
    {id:'dailyRate', label:'תעריף/יום (₪)',   def:true},
    {id:'daysUsed',  label:'ימי שימוש',       def:true},
    {id:'totalCost', label:'עלות (₪)',         def:true},
    {id:'sites',     label:'אתרים',            def:false},
    {id:'active',    label:'סטטוס',           def:false},
  ],
  sites: [
    {id:'name',     label:'שם אתר',          def:true},
    {id:'address',  label:'כתובת',           def:false},
    {id:'logDays',  label:'ימי דיווח',       def:true},
    {id:'empCount', label:'מס\' עובדים',     def:true},
    {id:'eqCount',  label:'מס\' ציוד',       def:false},
    {id:'status',   label:'סטטוס',           def:false},
  ],
  logs: [
    {id:'date',       label:'תאריך',          def:true},
    {id:'site',       label:'אתר',            def:true},
    {id:'acts',       label:'פעילויות',       def:true},
    {id:'emps',       label:'עובדים',         def:true},
    {id:'equip',      label:'ציוד',           def:false},
    {id:'notes',      label:'הערות',          def:false},
    {id:'deliveries', label:'אספקות',         def:false},
  ],
};
let _bSource = 'employees', _bCols = null;

function _renderBuilder(cm, cy) {
  if (!_bCols) _bCols = {
    employees: new Set(BUILDER_COLS.employees.filter(c=>c.def).map(c=>c.id)),
    equipment: new Set(BUILDER_COLS.equipment.filter(c=>c.def).map(c=>c.id)),
    sites:     new Set(BUILDER_COLS.sites.filter(c=>c.def).map(c=>c.id)),
    logs:      new Set(BUILDER_COLS.logs.filter(c=>c.def).map(c=>c.id)),
  };
  const b = document.getElementById('rep-body');
  b.innerHTML = `
    <div class="card">
      <div class="card-title">⚙️ מחולל דוחות מותאם</div>
      <div class="form-group"><label class="form-label">מקור נתונים</label>
        <div class="status-toggle" id="bld-src">
          ${[['employees','👷 עובדים'],['equipment','🚜 ציוד'],['sites','📍 אתרים'],['logs','📋 יומנים']].map(([k,l])=>
            `<div class="status-chip${_bSource===k?' active-s':''}" data-src="${k}">${l}</div>`).join('')}
        </div>
      </div>
      ${_periodRow(cm, cy, 'bld')}
      <div class="form-group mt8">
        <label class="form-label">עמודות להצגה</label>
        <div id="bld-cols" style="display:flex;flex-wrap:wrap;gap:8px">
          ${BUILDER_COLS[_bSource].map(c=>`
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:6px 10px;border-radius:10px;border:1.5px solid ${_bCols[_bSource].has(c.id)?'var(--gold)':'var(--border)'};background:${_bCols[_bSource].has(c.id)?'var(--gold-bg)':'transparent'};font-size:13px;font-weight:600;color:${_bCols[_bSource].has(c.id)?'var(--gold-d)':'var(--muted)'};transition:all .15s">
              <input type="checkbox" data-col="${c.id}" ${_bCols[_bSource].has(c.id)?'checked':''} style="width:14px;height:14px;accent-color:var(--gold)">
              ${c.label}
            </label>`).join('')}
        </div>
      </div>
    </div>
    <div id="bld-results"></div>`;
  document.querySelectorAll('#bld-src [data-src]').forEach(btn=>btn.addEventListener('click',()=>{
    _bSource=btn.dataset.src;
    _renderBuilder(document.getElementById('bld-m').value, document.getElementById('bld-y').value);
  }));
  document.querySelectorAll('#bld-cols input[data-col]').forEach(cb=>cb.addEventListener('change',()=>{
    if(cb.checked) _bCols[_bSource].add(cb.dataset.col); else _bCols[_bSource].delete(cb.dataset.col);
    const lbl=cb.closest('label');
    lbl.style.borderColor=cb.checked?'var(--gold)':'var(--border)';
    lbl.style.background=cb.checked?'var(--gold-bg)':'transparent';
    lbl.style.color=cb.checked?'var(--gold-d)':'var(--muted)';
  }));
  document.getElementById('bld-gen').onclick = () => _runBuilder(_getm('bld'), _gety('bld'));
}

function _runBuilder(month, year) {
  const pfx     = monthPrefix(month, year);
  const cols    = [..._bCols[_bSource]];
  const colDefs = BUILDER_COLS[_bSource].filter(c=>cols.includes(c.id));
  let rows = [];
  if (_bSource === 'employees') {
    const ma=D.attendance.filter(a=>a.date?.startsWith(pfx)), empMap={};
    ma.forEach(a=>{ if(!empMap[a.empId]){const e=D.employees.find(x=>x.id===a.empId);empMap[a.empId]={name:a.empName,days:0,rate:e?.dailyRate||0,profession:e?.profession||'',phone:e?.phone||''};} empMap[a.empId].days++; });
    D.employees.filter(e=>e.active==='פעיל').forEach(e=>{ if(!empMap[e.id]) empMap[e.id]={name:e.name,days:0,rate:e.dailyRate||0,profession:e.profession||'',phone:e.phone||''}; });
    rows=Object.values(empMap).sort((a,b)=>b.days-a.days).map(e=>({name:e.name,days:e.days,rate:e.rate,total:e.days*e.rate,profession:e.profession,phone:e.phone}));
  } else if (_bSource === 'equipment') {
    rows=D.equipment.map(eq=>{ const entries=D.logEquip.filter(e=>e.eqId===eq.id&&e.date?.startsWith(pfx)); const daysUsed=new Set(entries.map(e=>e.date)).size,dailyRate=eq.dailyRate||0; const sites=[...new Set(entries.map(e=>e.siteId))].map(sid=>D.sites.find(s=>s.id===sid)?.name||sid).filter(Boolean); return {name:eq.name,type:eq.type||'',dailyRate,daysUsed,totalCost:daysUsed*dailyRate,sites:sites.join(', '),active:eq.active}; }).sort((a,b)=>b.daysUsed-a.daysUsed);
  } else if (_bSource === 'sites') {
    const ml=D.logs.filter(l=>l.date?.startsWith(pfx)),siteMap={};
    D.sites.filter(s=>s.status==='פעיל').forEach(s=>{ siteMap[s.id]={name:s.name,address:s.address||'',logDays:0,emps:new Set(),eqs:new Set(),status:s.status}; });
    ml.forEach(l=>{ if(!siteMap[l.siteId]) siteMap[l.siteId]={name:l.siteName,address:'',logDays:0,emps:new Set(),eqs:new Set(),status:'פעיל'}; siteMap[l.siteId].logDays++; D.attendance.filter(a=>a.logId===l.id).forEach(a=>siteMap[l.siteId].emps.add(a.empId)); D.logEquip.filter(e=>e.logId===l.id).forEach(e=>siteMap[l.siteId].eqs.add(e.eqId)); });
    rows=Object.values(siteMap).sort((a,b)=>b.logDays-a.logDays).map(s=>({name:s.name,address:s.address,logDays:s.logDays,empCount:s.emps.size,eqCount:s.eqs.size,status:s.status}));
  } else if (_bSource === 'logs') {
    rows=D.logs.filter(l=>l.date?.startsWith(pfx)).sort((a,b)=>a.date.localeCompare(b.date)).map(l=>{ const site=D.sites.find(s=>s.id===l.siteId); return {date:new Date(l.date+'T12:00:00').toLocaleDateString('he-IL'),site:site?.name||l.siteName,acts:getActs(l).join(', ')||'—',emps:D.attendance.filter(a=>a.logId===l.id).map(a=>a.empName).join(', ')||'—',equip:D.logEquip.filter(e=>e.logId===l.id).map(e=>e.eqName).join(', ')||'—',notes:l.notes||'',deliveries:D.deliveries.filter(d=>d.logId===l.id).map(d=>d.material+(d.qty?' ('+d.qty+')':'')).join(', ')||''}; });
  }
  const el=document.getElementById('bld-results');
  if (!rows.length) { el.innerHTML='<div class="empty mt12"><div class="empty-title">אין נתונים לתקופה</div></div>'; return; }
  el.innerHTML=`
    <div class="card mt12" style="overflow-x:auto">
      <div class="card-title" style="margin-bottom:8px">${rows.length} רשומות — ${MN[month]} ${year}</div>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="border-bottom:2px solid var(--gold-border)">${colDefs.map(c=>`<th style="text-align:right;padding:6px 8px;font-size:11px;color:var(--gold);font-weight:800;white-space:nowrap">${c.label}</th>`).join('')}</tr></thead>
        <tbody>${rows.map((r,i)=>`<tr style="border-bottom:1px solid var(--border);background:${i%2===0?'transparent':'rgba(184,146,44,.03)'}">${colDefs.map(c=>`<td style="text-align:right;padding:6px 8px;font-size:12px;color:var(--text)">${_fmtCell(r[c.id])}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>
    </div>
    <div class="btn-row mt8">
      <button class="btn btn-ghost btn-sm fg" id="bld-pdf">📄 PDF</button>
      <button class="btn btn-ghost btn-sm fg" id="bld-csv">📥 CSV</button>
    </div>`;
  document.getElementById('bld-pdf').onclick=()=>{ const src={employees:'עובדים',equipment:'ציוד',sites:'אתרים',logs:'יומנים'}[_bSource]; const tableRows=rows.map(r=>`<tr>${colDefs.map(c=>`<td>${_fmtCell(r[c.id])}</td>`).join('')}</tr>`).join(''); _openPrint(_buildDoc(`דוח ${src} — ${MN[month]} ${year}`,`הופק: ${new Date().toLocaleDateString('he-IL')}`,`<table><thead><tr>${colDefs.map(c=>`<th>${c.label}</th>`).join('')}</tr></thead><tbody>${tableRows}</tbody></table>`)); toast('נפתח חלון הדפסה','ok'); };
  document.getElementById('bld-csv').onclick=()=>{ exportCSV(colDefs.map(c=>c.label),rows.map(r=>colDefs.map(c=>r[c.id]??'')),`דוח_${MN[month]}_${year}.csv`); toast('CSV הורד','ok'); };
}

function _fmtCell(v) {
  if (v===null||v===undefined) return '—';
  if (typeof v==='number') return v.toLocaleString('he-IL');
  return String(v)||'—';
}

// ── MONTH LOCK ───────────────────────────────────────────────────────────────
export function drawLocks() {
  const el = document.getElementById('lock-list');
  if (!el) return;
  if (!D.monthLocks.length) { el.innerHTML='<div class="muted tc" style="padding:12px">אין חודשים נעולים</div>'; return; }
  el.innerHTML = D.monthLocks.sort((a,b)=>b.year-a.year||b.month-a.month).map(m=>`
    <div class="list-item">
      <div style="font-size:24px">${m.locked?'🔒':'🔓'}</div>
      <div class="li-info"><div class="li-name">${MN[m.month]} ${m.year}</div><div class="li-sub">${m.by?.split('@')[0]||''}</div></div>
      <button class="btn ${m.locked?'btn-outline':'btn-danger'} btn-sm lock-toggle-btn" data-id="${m.id}">${m.locked?'🔓 פתח':'🔒 נעל'}</button>
    </div>`).join('');
  document.querySelectorAll('.lock-toggle-btn').forEach(btn=>btn.addEventListener('click',()=>_togLock(btn.dataset.id)));
}

export async function lockMonth() {
  const month=+document.getElementById('lk-month').value, year=+document.getElementById('lk-year').value;
  if (D.monthLocks.find(m=>m.month===month&&m.year===year)) { toast('חודש זה כבר ברשימה','err'); return; }
  const id=uid(), now=new Date().toISOString();
  await sAppend('MonthLocks',[id,month,year,'TRUE',D.user?.email||'',now,'','']);
  D.monthLocks.push({id,month,year,locked:true,by:D.user?.email||'',at:now});
  await logAudit('LOCK','Month',`${month}/${year}`,`נעילת חודש ${MN[month]} ${year}`);
  drawLocks();
  toast(`${MN[month]} ${year} נעול`,'ok');
}

async function _togLock(id) {
  const m=D.monthLocks.find(x=>x.id===id); if(!m) return;
  m.locked=!m.locked;
  await rebuildTab('MonthLocks',D.monthLocks.map(x=>[x.id,x.month,x.year,x.locked?'TRUE':'FALSE',x.by||'',x.at||'','','']));
  await logAudit(m.locked?'LOCK':'UNLOCK','Month',`${m.month}/${m.year}`,`${m.locked?'נעילת':'שחרור'} חודש`);
  drawLocks();
  toast(m.locked?'נעול':'שוחרר','ok');
}

// ── LEGACY EXPORTS (app.js compatibility) ────────────────────────────────────
export function exportSiteMonthPDF(siteId, month, year) { _doSitePDF(siteId, month, year); }

function _doSitePDF(siteId, month, year) {
  const pfx=monthPrefix(month,year), site=D.sites.find(s=>s.id===siteId);
  if(!site) return;
  const rows=D.logs.filter(l=>l.siteId===siteId&&l.date?.startsWith(pfx)).sort((a,b)=>a.date.localeCompare(b.date)).map(l=>{
    const att=D.attendance.filter(a=>a.logId===l.id).map(a=>a.empName).join(', ')||'—';
    const eq=D.logEquip.filter(e=>e.logId===l.id).map(e=>e.eqName).join(', ')||'—';
    const dl=D.deliveries.filter(d=>d.logId===l.id).map(d=>d.material+(d.qty?' ('+d.qty+')':'')).join(', ')||'—';
    return `<tr><td>${new Date(l.date+'T12:00:00').toLocaleDateString('he-IL',{day:'numeric',month:'long'})}</td><td>${getActs(l).join(', ')||'—'}</td><td>${att}</td><td>${eq}</td><td>${dl}</td><td>${l.notes||''}</td></tr>`;
  }).join('');
  _openPrint(_buildDoc(
    `יומן ביצוע — ${site.name}`,
    `${MN[month]} ${year} | הופק: ${new Date().toLocaleDateString('he-IL')}`,
    `<table><thead><tr><th>תאריך</th><th>פעילויות</th><th>עובדים</th><th>ציוד</th><th>אספקות</th><th>הערות</th></tr></thead><tbody>${rows}</tbody></table>`
  ));
}
