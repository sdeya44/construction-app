import { MN, DAYS_HE, BUSINESS_NAME } from '../config.js';
import { D } from '../state.js';
import { uid, pad, monthPrefix, getDaysInMonth, toast, openSheet, isLocked, getActs, exportCSV } from '../utils.js';
import { sAppend, rebuildTab, logAudit } from '../api.js';

let _type = 'attendance'; // attendance | site | equip | payroll | builder

// ── ENTRY POINT ───────────────────────────────────────────────────────────────
export function renderReports() {
  const scroll = document.querySelector('#s-reports .scroll');
  if (!scroll) return;
  const now = new Date(), cm = now.getMonth()+1, cy = now.getFullYear();
  scroll.innerHTML = `
    <div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:6px;margin-bottom:14px;scrollbar-width:none">
      ${[
        ['attendance','👷 נוכחות'],
        ['site',      '📍 יומן אתר'],
        ['equip',     '🚜 ציוד'],
        ['payroll',   '💰 שכר'],
        ['builder',   '⚙️ מחולל'],
      ].map(([k,l])=>`<button class="status-chip${_type===k?' active-s':''}" style="white-space:nowrap;flex-shrink:0" data-rtype="${k}">${l}</button>`).join('')}
    </div>
    <div id="rep-body"></div>`;
  scroll.querySelectorAll('[data-rtype]').forEach(btn =>
    btn.addEventListener('click', () => { _type = btn.dataset.rtype; renderReports(); }));
  if      (_type==='attendance') _renderAttendance(cm, cy);
  else if (_type==='site')       _renderSite(cm, cy);
  else if (_type==='equip')      _renderEquip(cm, cy);
  else if (_type==='payroll')    _renderPayroll(cm, cy);
  else if (_type==='builder')    _renderBuilder(cm, cy);
}

export function initSelects() {
  // Only populate lock-month selects (reports are fully dynamic now)
  const now = new Date();
  const lm = document.getElementById('lk-month');
  const ly = document.getElementById('lk-year');
  if (lm) { MN.slice(1).forEach((m,i) => { lm.innerHTML += `<option value="${i+1}">${m}</option>`; }); lm.value = now.getMonth()+1; }
  if (ly) { for (let y=now.getFullYear(); y>=now.getFullYear()-3; y--) ly.innerHTML += `<option value="${y}">${y}</option>`; }
}

// ── SHARED HELPERS ────────────────────────────────────────────────────────────
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
  w.document.write(html); w.document.close(); setTimeout(()=>w.print(),700);
}

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

// ── ATTENDANCE ────────────────────────────────────────────────────────────────
function _renderAttendance(cm, cy) {
  const b = document.getElementById('rep-body');
  b.innerHTML = _periodRow(cm, cy, 'att');
  document.getElementById('att-gen').onclick = () => _showAttendance(_getm('att'), _gety('att'));
  _showAttendance(cm, cy);
}

function _getAttData(month, year) {
  const pfx = monthPrefix(month, year);
  const ma  = D.attendance.filter(a => a.date?.startsWith(pfx));
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
  D.reportMonth=month; D.reportYear=year;
  return {empMap, siteD, total:ma.length, month, year};
}

function _showAttendance(month, year) {
  const {empMap,siteD,total} = _getAttData(month,year);
  const lk = isLocked(`${monthPrefix(month,year)}-01`);
  const el = document.getElementById('rep-body');
  const existing = el.querySelector('#att-results');
  const html = `<div id="att-results">
    ${lk?'<div class="locked-bar">🔒 חודש נעול</div>':''}
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
    <div class="btn-row mt8">
      <button class="btn btn-ghost btn-sm fg" id="att-pdf-sum">📄 ריכוז PDF</button>
      <button class="btn btn-ghost btn-sm fg" id="att-pdf-full">📋 דוח מלא PDF</button>
      <button class="btn btn-ghost btn-sm fg" id="att-csv">📥 CSV</button>
    </div>
  </div>`;
  if (existing) existing.outerHTML = html; else el.insertAdjacentHTML('beforeend', html);
  document.getElementById('att-pdf-sum').onclick  = () => exportSummaryPDF();
  document.getElementById('att-pdf-full').onclick = () => exportAllEmployeesPDF();
  document.getElementById('att-csv').onclick      = () => exportMonthCSV();
}

// ── SITE JOURNAL ──────────────────────────────────────────────────────────────
function _renderSite(cm, cy) {
  const b = document.getElementById('rep-body');
  b.innerHTML = _periodRow(cm, cy, 'site');
  document.getElementById('site-gen').onclick = () => _showSite(_getm('site'), _gety('site'));
}

function _showSite(month, year) {
  const pfx  = monthPrefix(month, year);
  const ml   = D.logs.filter(l=>l.date?.startsWith(pfx));
  const siteD = {};
  ml.forEach(l=>{ if(!siteD[l.siteId]) siteD[l.siteId]={name:l.siteName,days:0,logs:[]}; siteD[l.siteId].days++; siteD[l.siteId].logs.push(l); });
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
        const att=D.attendance.filter(a=>a.logId===l.id), eq=D.logEquip.filter(e=>e.logId===l.id), dl=D.deliveries.filter(d=>d.logId===l.id), acts=getActs(l);
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
  el.querySelectorAll('.site-pdf-btn').forEach(btn =>
    btn.addEventListener('click', ()=>exportSiteMonthPDF(btn.dataset.sid,+btn.dataset.month,+btn.dataset.year)));
}

// ── EQUIP (redirect to equipment tab) ────────────────────────────────────────
function _renderEquip(cm, cy) {
  const b = document.getElementById('rep-body');
  b.innerHTML = _periodRow(cm, cy, 'eqrep');
  document.getElementById('eqrep-gen').onclick = () => _showEquipReport(_getm('eqrep'), _gety('eqrep'));
  _showEquipReport(cm, cy);
}

function _showEquipReport(month, year) {
  const pfx = monthPrefix(month,year);
  const rows = D.equipment.map(eq=>{
    const entries=D.logEquip.filter(e=>e.eqId===eq.id&&e.date?.startsWith(pfx));
    const daysUsed=new Set(entries.map(e=>e.date)).size, dailyRate=eq.dailyRate||0;
    const sites=[...new Set(entries.map(e=>e.siteId))].map(sid=>D.sites.find(s=>s.id===sid)?.name||sid).filter(Boolean);
    return {id:eq.id,name:eq.name,type:eq.type||'',dailyRate,daysUsed,totalCost:daysUsed*dailyRate,sites};
  }).sort((a,b)=>b.daysUsed-a.daysUsed);
  const totalDays=rows.reduce((s,r)=>s+r.daysUsed,0), totalCost=rows.reduce((s,r)=>s+r.totalCost,0);
  const el = document.getElementById('rep-body');
  const existing = el.querySelector('#eqrep-results');
  const html = `<div id="eqrep-results">
    <div class="card">
      <div class="card-title">סיכום ${MN[month]} ${year}</div>
      <div class="list-item" style="border:none;padding:4px 0"><span>בשימוש</span><span style="font-weight:700;margin-right:auto">${rows.filter(r=>r.daysUsed>0).length}</span></div>
      <div class="list-item" style="border:none;padding:4px 0"><span>סה"כ ימי שימוש</span><span style="font-weight:700;margin-right:auto;color:var(--gold)">${totalDays}</span></div>
      ${totalCost>0?`<div class="list-item" style="border:none;padding:4px 0"><span>סה"כ עלות</span><span style="font-weight:700;margin-right:auto;color:var(--gold)">${totalCost.toLocaleString('he-IL')} ₪</span></div>`:''}
    </div>
    ${rows.map(r=>`<div class="card" style="margin-bottom:8px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
        <div style="display:flex;align-items:center;gap:10px">
          <div class="avatar av-gold">🚜</div>
          <div class="li-info"><div class="li-name">${r.name}</div><div class="li-sub">${r.type||''}</div></div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px">
          ${r.daysUsed>0?`<span class="badge b-gold">${r.daysUsed} ימים</span>`:'<span class="badge b-gray">0</span>'}
          ${r.dailyRate>0&&r.daysUsed>0?`<span class="badge b-green">${r.totalCost.toLocaleString('he-IL')} ₪</span>`:''}
        </div>
      </div>
      ${r.daysUsed>0?`<div style="margin-top:6px;font-size:12px;color:var(--muted)">📍 ${r.sites.join(', ')}</div>`:''}
    </div>`).join('')}
    <div class="btn-row mt8">
      <button class="btn btn-ghost btn-sm fg" id="eqrep-pdf">📄 PDF</button>
      <button class="btn btn-ghost btn-sm fg" id="eqrep-csv">📥 CSV</button>
    </div>
  </div>`;
  if (existing) existing.outerHTML = html; else el.insertAdjacentHTML('beforeend', html);
  document.getElementById('eqrep-pdf').onclick = () => {
    const tableRows=rows.map((r,i)=>`<tr><td>${i+1}</td><td style="text-align:right">${r.name}</td><td>${r.type||'—'}</td><td>${r.dailyRate>0?r.dailyRate.toLocaleString('he-IL')+' ₪':'—'}</td><td>${r.daysUsed}</td><td>${r.dailyRate>0&&r.daysUsed>0?r.totalCost.toLocaleString('he-IL')+' ₪':'—'}</td><td style="text-align:right;font-size:10px">${r.sites.join(', ')||'—'}</td></tr>`).join('');
    _openPrint(_buildDoc(`דוח ציוד — ${MN[month]} ${year}`,`הופק: ${new Date().toLocaleDateString('he-IL')}`,
      `<table><thead><tr><th>#</th><th style="text-align:right">ציוד</th><th>סוג</th><th>תעריף/יום</th><th>ימי שימוש</th><th>עלות</th><th>אתרים</th></tr></thead><tbody>${tableRows}</tbody><tfoot><tr><td colspan="4" style="text-align:right">סה"כ</td><td>${totalDays}</td><td>${totalCost>0?totalCost.toLocaleString('he-IL')+' ₪':''}</td><td></td></tr></tfoot></table>`));
    toast('נפתח חלון הדפסה','ok');
  };
  document.getElementById('eqrep-csv').onclick = () => {
    exportCSV(['ציוד','סוג','תעריף יומי (₪)','ימי שימוש','עלות (₪)','אתרים'],
      rows.map(r=>[r.name,r.type||'',r.dailyRate||0,r.daysUsed,r.totalCost,r.sites.join(', ')]),
      `ציוד_${MN[month]}_${year}.csv`); toast('CSV הורד','ok');
  };
}

// ── PAYROLL ───────────────────────────────────────────────────────────────────
function _renderPayroll(cm, cy) {
  const b = document.getElementById('rep-body');
  b.innerHTML = _periodRow(cm, cy, 'pay');
  document.getElementById('pay-gen').onclick = () => _showPayroll(_getm('pay'), _gety('pay'));
  _showPayroll(cm, cy);
}

function _showPayroll(month, year) {
  const pfx  = monthPrefix(month, year);
  const ma   = D.attendance.filter(a=>a.date?.startsWith(pfx));
  const empMap = {};
  ma.forEach(a=>{
    if (!empMap[a.empId]) { const e=D.employees.find(x=>x.id===a.empId); empMap[a.empId]={name:a.empName,days:0,rate:e?.dailyRate||0}; }
    empMap[a.empId].days++;
  });
  D.employees.filter(e=>e.active==='פעיל').forEach(e=>{ if(!empMap[e.id]) empMap[e.id]={name:e.name,days:0,rate:e.dailyRate||0}; });
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
    exportCSV(['עובד','ימי עבודה','תעריף יומי (₪)','סה"כ (₪)'],
      rows.map(r=>[r.name,r.days,r.rate,r.total]),`שכר_${MN[month]}_${year}.csv`); toast('CSV הורד','ok');
  };
}

// ── REPORT BUILDER ────────────────────────────────────────────────────────────
const BUILDER_COLS = {
  employees: [
    {id:'name',    label:'שם עובד',        def:true},
    {id:'days',    label:'ימי עבודה',      def:true},
    {id:'rate',    label:'תעריף יומי (₪)', def:true},
    {id:'total',   label:'סה"כ שכר (₪)',  def:true},
    {id:'profession',label:'תפקיד',        def:false},
    {id:'phone',   label:'טלפון',          def:false},
  ],
  equipment: [
    {id:'name',      label:'שם ציוד',      def:true},
    {id:'type',      label:'סוג',          def:true},
    {id:'dailyRate', label:'תעריף/יום (₪)',def:true},
    {id:'daysUsed',  label:'ימי שימוש',    def:true},
    {id:'totalCost', label:'עלות (₪)',     def:true},
    {id:'sites',     label:'אתרים',        def:false},
    {id:'active',    label:'סטטוס',        def:false},
  ],
  sites: [
    {id:'name',     label:'שם אתר',        def:true},
    {id:'address',  label:'כתובת',         def:false},
    {id:'logDays',  label:'ימי דיווח',     def:true},
    {id:'empCount', label:'מס׳ עובדים',    def:true},
    {id:'eqCount',  label:'מס׳ ציוד',      def:false},
    {id:'status',   label:'סטטוס',         def:false},
  ],
  logs: [
    {id:'date',    label:'תאריך',          def:true},
    {id:'site',    label:'אתר',            def:true},
    {id:'acts',    label:'פעילויות',       def:true},
    {id:'emps',    label:'עובדים',         def:true},
    {id:'equip',   label:'ציוד',           def:false},
    {id:'notes',   label:'הערות',          def:false},
    {id:'deliveries',label:'אספקות',       def:false},
  ],
};

let _bSource = 'employees', _bCols = null;

function _renderBuilder(cm, cy) {
  if (!_bCols) _bCols = { employees:new Set(BUILDER_COLS.employees.filter(c=>c.def).map(c=>c.id)), equipment:new Set(BUILDER_COLS.equipment.filter(c=>c.def).map(c=>c.id)), sites:new Set(BUILDER_COLS.sites.filter(c=>c.def).map(c=>c.id)), logs:new Set(BUILDER_COLS.logs.filter(c=>c.def).map(c=>c.id)) };
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
              <input type="checkbox" data-col="${c.id}" ${_bCols[_bSource].has(c.id)?'checked':''} style="width:14px;height:14px;accent-color:var(--gold)"> ${c.label}
            </label>`).join('')}
        </div>
      </div>
    </div>
    <div id="bld-results"></div>`;

  document.querySelectorAll('#bld-src [data-src]').forEach(btn=>btn.addEventListener('click',()=>{
    _bSource=btn.dataset.src; _renderBuilder(document.getElementById('bld-m').value,document.getElementById('bld-y').value);
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
  const pfx  = monthPrefix(month, year);
  const cols  = [..._bCols[_bSource]];
  const colDefs = BUILDER_COLS[_bSource].filter(c=>cols.includes(c.id));
  let rows = [];

  if (_bSource === 'employees') {
    const ma = D.attendance.filter(a=>a.date?.startsWith(pfx));
    const empMap={};
    ma.forEach(a=>{ if(!empMap[a.empId]){const e=D.employees.find(x=>x.id===a.empId);empMap[a.empId]={name:a.empName,days:0,rate:e?.dailyRate||0,profession:e?.profession||'',phone:e?.phone||''};} empMap[a.empId].days++; });
    D.employees.filter(e=>e.active==='פעיל').forEach(e=>{ if(!empMap[e.id]) empMap[e.id]={name:e.name,days:0,rate:e.dailyRate||0,profession:e.profession||'',phone:e.phone||''}; });
    rows = Object.values(empMap).sort((a,b)=>b.days-a.days).map(e=>({name:e.name,days:e.days,rate:e.rate,total:e.days*e.rate,profession:e.profession,phone:e.phone}));
  } else if (_bSource === 'equipment') {
    rows = D.equipment.map(eq=>{
      const entries=D.logEquip.filter(e=>e.eqId===eq.id&&e.date?.startsWith(pfx));
      const daysUsed=new Set(entries.map(e=>e.date)).size, dailyRate=eq.dailyRate||0;
      const sites=[...new Set(entries.map(e=>e.siteId))].map(sid=>D.sites.find(s=>s.id===sid)?.name||sid).filter(Boolean);
      return {name:eq.name,type:eq.type||'',dailyRate,daysUsed,totalCost:daysUsed*dailyRate,sites:sites.join(', '),active:eq.active};
    }).sort((a,b)=>b.daysUsed-a.daysUsed);
  } else if (_bSource === 'sites') {
    const ml=D.logs.filter(l=>l.date?.startsWith(pfx));
    const siteMap={};
    D.sites.filter(s=>s.status==='פעיל').forEach(s=>{ siteMap[s.id]={name:s.name,address:s.address||'',logDays:0,emps:new Set(),eqs:new Set(),status:s.status}; });
    ml.forEach(l=>{ if(!siteMap[l.siteId]) siteMap[l.siteId]={name:l.siteName,address:'',logDays:0,emps:new Set(),eqs:new Set(),status:'פעיל'}; siteMap[l.siteId].logDays++; D.attendance.filter(a=>a.logId===l.id).forEach(a=>siteMap[l.siteId].emps.add(a.empId)); D.logEquip.filter(e=>e.logId===l.id).forEach(e=>siteMap[l.siteId].eqs.add(e.eqId)); });
    rows = Object.values(siteMap).sort((a,b)=>b.logDays-a.logDays).map(s=>({name:s.name,address:s.address,logDays:s.logDays,empCount:s.emps.size,eqCount:s.eqs.size,status:s.status}));
  } else if (_bSource === 'logs') {
    rows = D.logs.filter(l=>l.date?.startsWith(pfx)).sort((a,b)=>a.date.localeCompare(b.date)).map(l=>{
      const site=D.sites.find(s=>s.id===l.siteId);
      return {date:new Date(l.date+'T12:00:00').toLocaleDateString('he-IL'),site:site?.name||l.siteName,acts:getActs(l).join(', ')||'—',emps:D.attendance.filter(a=>a.logId===l.id).map(a=>a.empName).join(', ')||'—',equip:D.logEquip.filter(e=>e.logId===l.id).map(e=>e.eqName).join(', ')||'—',notes:l.notes||'',deliveries:D.deliveries.filter(d=>d.logId===l.id).map(d=>d.material+(d.qty?' ('+d.qty+')':'')).join(', ')||''};
    });
  }

  const el = document.getElementById('bld-results');
  if (!rows.length) { el.innerHTML='<div class="empty mt12"><div class="empty-title">אין נתונים לתקופה</div></div>'; return; }

  el.innerHTML = `
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

  document.getElementById('bld-pdf').onclick = () => {
    const src={employees:'עובדים',equipment:'ציוד',sites:'אתרים',logs:'יומנים'}[_bSource];
    const tableRows=rows.map(r=>`<tr>${colDefs.map(c=>`<td>${_fmtCell(r[c.id])}</td>`).join('')}</tr>`).join('');
    _openPrint(_buildDoc(`דוח ${src} — ${MN[month]} ${year}`,`הופק: ${new Date().toLocaleDateString('he-IL')}`,
      `<table><thead><tr>${colDefs.map(c=>`<th>${c.label}</th>`).join('')}</tr></thead><tbody>${tableRows}</tbody></table>`));
    toast('נפתח חלון הדפסה','ok');
  };
  document.getElementById('bld-csv').onclick = () => {
    exportCSV(colDefs.map(c=>c.label), rows.map(r=>colDefs.map(c=>r[c.id]??'')), `דוח_${MN[month]}_${year}.csv`);
    toast('CSV הורד','ok');
  };
}

function _fmtCell(v) {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return v.toLocaleString('he-IL');
  return String(v) || '—';
}

// ── MONTH LOCK ────────────────────────────────────────────────────────────────
export function drawLocks() {
  const el = document.getElementById('lock-list'); if (!el) return;
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
  drawLocks(); toast(`${MN[month]} ${year} נעול ✓`,'ok');
}

async function _togLock(id) {
  const m=D.monthLocks.find(x=>x.id===id); if(!m) return;
  m.locked=!m.locked;
  await rebuildTab('MonthLocks',D.monthLocks.map(x=>[x.id,x.month,x.year,x.locked?'TRUE':'FALSE',x.by||'',x.at||'','','']));
  await logAudit(m.locked?'LOCK':'UNLOCK','Month',`${m.month}/${m.year}`,`${m.locked?'נעילת':'שחרור'} חודש`);
  drawLocks(); toast(m.locked?'נעול ✓':'שוחרר ✓','ok');
}

// ── LEGACY EXPORTS (kept for app.js compatibility) ────────────────────────────
export function genReport()             { renderReports(); }
export function exportSummaryPDF()      { const d=_getAttData(D.reportMonth,D.reportYear); if(!d) return; _doSummaryPDF(d); }
export function exportAllEmployeesPDF() { const d=_getAttData(D.reportMonth,D.reportYear); if(!d) return; _doFullPDF(d); }
export function exportMonthCSV()        { const d=_getAttData(D.reportMonth,D.reportYear); if(!d) return; _doCSV(d); }
export function exportSiteMonthPDF(siteId,month,year) { _doSitePDF(siteId,month,year); }

function _doSummaryPDF({month,year,empMap}) {
  if(!month) { toast('הפק דוח תחילה','err'); return; }
  const rows=Object.values(empMap).sort((a,b)=>b.days-a.days).map((e,i)=>`<tr><td>${i+1}</td><td style="text-align:right">${e.name}</td><td>${e.days}</td><td style="color:${e.days>0?'#2A7A50':'#ccc'};font-size:16px">${e.days>0?'✓':''}</td></tr>`).join('');
  const total=Object.values(empMap).reduce((s,e)=>s+e.days,0);
  _openPrint(_buildDoc(`ריכוז ימי עבודה – ${MN[month]} ${year}`,`הופק: ${new Date().toLocaleDateString('he-IL')}`,`<table><thead><tr><th>#</th><th style="text-align:right">שם עובד</th><th>ימי עבודה</th><th>נוכחות</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td></td><td style="text-align:right">סה"כ</td><td>${total}</td><td></td></tr></tfoot></table>`));
  toast('נפתח חלון הדפסה','ok');
}

function _doFullPDF({month,year,empMap}) {
  if(!month) { toast('הפק דוח תחילה','err'); return; }
  const daysCount=getDaysInMonth(year,month);
  const emps=Object.entries(empMap).sort((a,b)=>a[1].name.localeCompare(b[1].name,'he'));
  let pages='';
  emps.forEach(([,emp],idx)=>{
    let dayHeaders='',dayCells='',total=0;
    for(let d=1;d<=daysCount;d++){
      const ds=`${year}-${pad(month)}-${pad(d)}`,dow=new Date(ds+'T12:00:00').getDay(),wknd=dow===5||dow===6;
      dayHeaders+=`<th style="min-width:16px;${wknd?'background:#2A5C36':''}">${d}<br><span style="font-size:8px">${DAYS_HE[dow]}</span></th>`;
      const worked=emp.dates.has(ds); if(worked) total++;
      dayCells+=`<td style="${wknd?'background:#EAF4EE':''}${worked?'color:#2A7A50;font-weight:800;font-size:14px':''}">${worked?'✓':''}</td>`;
    }
    pages+=`<div class="page"${idx>0?' style="page-break-before:always"':''}><div class="hdr"><div class="emp-name">${emp.name}</div><div class="sub2">${MN[month]} ${year}</div></div><table><thead><tr><th style="min-width:60px;text-align:right">שם</th>${dayHeaders}<th class="tot-h">סה"כ</th></tr></thead><tbody><tr><td style="font-weight:700;background:#FEFCF5;text-align:right">${emp.name}</td>${dayCells}<td class="tot-c">${total}</td></tr></tbody></table><div class="footer">ימי עבודה: ${total}</div></div>`;
  });
  const html=`<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="UTF-8"><link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;700;800&display=swap" rel="stylesheet"><style>*{font-family:'Heebo',sans-serif;box-sizing:border-box;margin:0;padding:0}body{direction:rtl;font-size:11px;background:#fff}.biz-hdr{color:#B8922C;font-size:12px;font-weight:800;text-align:center;padding:6px 0 2px}.page{padding:6mm}.hdr{background:linear-gradient(135deg,#1A1714,#2C2620);color:#EDE8DF;padding:10px 14px;border-radius:8px;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between}.emp-name{font-size:16px;font-weight:800}.sub2{font-size:12px;color:rgba(237,232,223,.8)}table{width:100%;border-collapse:collapse;font-size:10px}th{background:#B8922C;color:#fff;padding:3px 1px;text-align:center;font-size:9px}td{padding:4px 1px;border:1px solid rgba(184,146,44,.12);text-align:center}.tot-h{background:#9A7A1C;color:#fff;font-weight:800}.tot-c{background:#9A7A1C;color:#fff;font-weight:800;font-size:13px}.footer{text-align:center;color:#888;font-size:10px;margin-top:6px}@media print{.page{padding:4mm}}</style></head><body><div class="biz-hdr">${BUSINESS_NAME}</div>${pages}</body></html>`;
  _openPrint(html); toast(`הדפסה – ${emps.length} עובדים`,'ok');
}

function _doCSV({month,year,empMap}) {
  if(!month) { toast('הפק דוח תחילה','err'); return; }
  exportCSV(['שם עובד','ימי עבודה','תאריכים'],Object.values(empMap).sort((a,b)=>b.days-a.days).map(e=>[e.name,e.days,[...e.dates].sort().join(' | ')]),`נוכחות_${MN[month]}_${year}.csv`);
  toast('CSV הורד','ok');
}

function _doSitePDF(siteId,month,year) {
  const pfx=monthPrefix(month,year), site=D.sites.find(s=>s.id===siteId); if(!site) return;
  const rows=D.logs.filter(l=>l.siteId===siteId&&l.date?.startsWith(pfx)).sort((a,b)=>a.date.localeCompare(b.date)).map(l=>{
    const att=D.attendance.filter(a=>a.logId===l.id).map(a=>a.empName).join(', ')||'—';
    const eq=D.logEquip.filter(e=>e.logId===l.id).map(e=>e.eqName).join(', ')||'—';
    const dl=D.deliveries.filter(d=>d.logId===l.id).map(d=>d.material+(d.qty?' ('+d.qty+')':'')).join(', ')||'—';
    return `<tr><td>${new Date(l.date+'T12:00:00').toLocaleDateString('he-IL',{day:'numeric',month:'long'})}</td><td>${getActs(l).join(', ')||'—'}</td><td>${att}</td><td>${eq}</td><td>${dl}</td><td>${l.notes||''}</td></tr>`;
  }).join('');
  _openPrint(_buildDoc(`יומן ביצוע — ${site.name}`,`${MN[month]} ${year} | הופק: ${new Date().toLocaleDateString('he-IL')}`,`<table><thead><tr><th>תאריך</th><th>פעילויות</th><th>עובדים</th><th>ציוד</th><th>אספקות</th><th>הערות</th></tr></thead><tbody>${rows}</tbody><tfoot><tr style="background:#B8922C"><td colspan="6" style="color:#fff;font-weight:800">סה"כ ${rows.length?rows.split('<tr>').length-1:0} ימים</td></tr></tfoot></table>`));
  toast('נפתח חלון הדפסה','ok');
}
