import { MN, DAYS_HE, BUSINESS_NAME } from '../config.js';
import { D } from '../state.js';
import { uid, pad, monthPrefix, getDaysInMonth, toast, openSheet, isLocked, getActs, exportCSV } from '../utils.js';
import { sAppend, rebuildTab, logAudit } from '../api.js';

export function initSelects() {
  const now = new Date();
  const rm  = document.getElementById('r-month');
  const ry  = document.getElementById('r-year');
  const ly  = document.getElementById('lk-year');
  if (!rm) return;
  MN.slice(1).forEach((m,i) => { rm.innerHTML += `<option value="${i+1}">${m}</option>`; });
  for (let y=now.getFullYear(); y>=now.getFullYear()-3; y--) {
    ry.innerHTML += `<option value="${y}">${y}</option>`;
    if (ly) ly.innerHTML += `<option value="${y}">${y}</option>`;
  }
  rm.value = now.getMonth()+1;
  if (document.getElementById('lk-month')) document.getElementById('lk-month').value = now.getMonth()+1;
}

export function renderReports() { /* screen rendered by genReport on demand */ }

export function genReport() {
  const month = +document.getElementById('r-month').value;
  const year  = +document.getElementById('r-year').value;
  D.reportMonth = month; D.reportYear = year;
  const pfx = monthPrefix(month, year);
  const ml  = D.logs.filter(l => l.date?.startsWith(pfx));
  const ma  = D.attendance.filter(a => a.date?.startsWith(pfx));
  const empD = {};
  ma.forEach(a => {
    if (!empD[a.empId]) empD[a.empId] = { name:a.empName, days:0, dates:[] };
    empD[a.empId].days++;
    empD[a.empId].dates.push(a.date);
  });
  const siteD = {};
  ml.forEach(l => { if (!siteD[l.siteId]) siteD[l.siteId]={ name:l.siteName, days:0 }; siteD[l.siteId].days++; });
  const lk = isLocked(`${pfx}-01`);
  document.getElementById('r-out').style.display = 'block';
  document.getElementById('r-content').innerHTML = `
    ${lk ? '<div class="locked-bar">🔒 חודש נעול</div>' : ''}
    <div class="card">
      <div class="card-title">סיכום ${MN[month]} ${year}</div>
      <div class="list-item" style="border:none;padding:4px 0"><span>סה"כ יומנים</span><span style="font-weight:700;margin-right:auto">${ml.length}</span></div>
      <div class="list-item" style="border:none;padding:4px 0"><span>עובדים שעבדו</span><span style="font-weight:700;margin-right:auto">${Object.keys(empD).length}</span></div>
      <div class="list-item" style="border:none;padding:4px 0"><span>ימי נוכחות כולל</span><span style="font-weight:700;margin-right:auto">${ma.length}</span></div>
    </div>
    <div class="card">
      <div class="card-title">ימי עבודה לפי עובד</div>
      ${Object.values(empD).sort((a,b)=>b.days-a.days).map(e=>`
        <div class="list-item"><div class="avatar av-blue">👷</div>
        <div class="li-name fg">${e.name}</div>
        <span class="badge b-blue">${e.days} ימים</span></div>`).join('')}
      ${!Object.keys(empD).length?'<div class="muted tc" style="padding:12px">אין נתונים</div>':''}
    </div>
    <div class="card">
      <div class="card-title">ימי עבודה לפי אתר</div>
      ${Object.values(siteD).sort((a,b)=>b.days-a.days).map(s=>`
        <div class="list-item"><div class="avatar av-gold">📍</div>
        <div class="li-name fg">${s.name}</div>
        <span class="badge b-gold">${s.days} ימים</span></div>`).join('')}
    </div>
    ${Object.entries(siteD).map(([sid,s]) => {
      const siteLogs = ml.filter(l=>l.siteId===sid).sort((a,b)=>a.date.localeCompare(b.date));
      return `<div class="card" style="margin-top:4px">
        <div class="card-title" style="display:flex;justify-content:space-between;align-items:center">
          <span>📍 ${s.name} — פירוט חודשי</span>
          <button class="btn btn-ghost btn-sm site-pdf-btn" data-sid="${sid}" data-month="${month}" data-year="${year}" style="width:auto;padding:6px 10px;font-size:12px">📄 PDF</button>
        </div>
        ${siteLogs.map(l => {
          const att  = D.attendance.filter(a=>a.logId===l.id);
          const eq   = D.logEquip.filter(e=>e.logId===l.id);
          const dl   = D.deliveries.filter(d=>d.logId===l.id);
          const acts = getActs(l);
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
    }).join('')}`;
  document.querySelectorAll('.site-pdf-btn').forEach(btn => {
    btn.addEventListener('click', () => exportSiteMonthPDF(btn.dataset.sid, +btn.dataset.month, +btn.dataset.year));
  });
}

export function exportSiteMonthPDF(siteId, month, year) {
  const pfx  = monthPrefix(month, year);
  const site = D.sites.find(s => s.id === siteId); if (!site) return;
  const siteLogs = D.logs.filter(l=>l.siteId===siteId && l.date?.startsWith(pfx)).sort((a,b)=>a.date.localeCompare(b.date));
  const rows = siteLogs.map(l => {
    const att  = D.attendance.filter(a=>a.logId===l.id).map(a=>a.empName).join(', ')||'—';
    const eq   = D.logEquip.filter(e=>e.logId===l.id).map(e=>e.eqName).join(', ')||'—';
    const dl   = D.deliveries.filter(d=>d.logId===l.id).map(d=>d.material+(d.qty?' ('+d.qty+')':'')).join(', ')||'—';
    const acts = getActs(l).join(', ')||'—';
    return `<tr><td>${new Date(l.date+'T12:00:00').toLocaleDateString('he-IL',{day:'numeric',month:'long'})}</td><td>${acts}</td><td>${att}</td><td>${eq}</td><td>${dl}</td><td>${l.notes||''}</td></tr>`;
  }).join('');
  const html = buildPrintDoc(`יומן ביצוע חודשי — ${site.name}`, `${MN[month]} ${year} | הופק: ${new Date().toLocaleDateString('he-IL')}`,
    `<table><thead><tr><th>תאריך</th><th>פעילויות</th><th>עובדים</th><th>ציוד</th><th>אספקות</th><th>הערות</th></tr></thead>
     <tbody>${rows}</tbody>
     <tfoot><tr style="background:#1a1400"><td colspan="6" style="font-weight:800;color:#f0c842">סה"כ ${siteLogs.length} ימי עבודה | ${MN[month]} ${year}</td></tr></tfoot></table>`);
  openPrint(html); toast('נפתח חלון הדפסה','ok');
}

export function exportSummaryPDF() {
  const data = getReportData(); if (!data) return;
  const { month, year, empMap } = data;
  const rows = Object.values(empMap).sort((a,b)=>b.dates.size-a.dates.size)
    .map((e,i)=>`<tr><td>${i+1}</td><td style="text-align:right">${e.name}</td><td>${e.dates.size}</td><td style="color:${e.dates.size>0?'#10b981':'#ccc'};font-size:16px">${e.dates.size>0?'✓':''}</td></tr>`).join('');
  const total = Object.values(empMap).reduce((s,e)=>s+e.dates.size,0);
  const html = buildPrintDoc(`ריכוז ימי עבודה – ${MN[month]} ${year}`, `תאריך הפקה: ${new Date().toLocaleDateString('he-IL')}`,
    `<table><thead><tr><th>#</th><th style="text-align:right">שם עובד</th><th>ימי עבודה</th><th>נוכחות</th></tr></thead>
     <tbody>${rows}</tbody>
     <tfoot><tr><td></td><td style="text-align:right">סה"כ</td><td>${total}</td><td></td></tr></tfoot></table>`);
  openPrint(html); toast('נפתח חלון הדפסה','ok');
}

export function exportAllEmployeesPDF() {
  const data = getReportData(); if (!data) return;
  const { month, year, empMap } = data;
  const daysCount = getDaysInMonth(year, month);
  const emps = Object.entries(empMap).sort((a,b)=>a[1].name.localeCompare(b[1].name,'he'));
  let pages = '';
  emps.forEach(([,emp], idx) => {
    let dayHeaders='', dayCells='', total=0;
    for (let d=1; d<=daysCount; d++) {
      const dateStr = `${year}-${pad(month)}-${pad(d)}`;
      const dow = new Date(dateStr+'T12:00:00').getDay();
      const wknd = dow===5||dow===6;
      dayHeaders += `<th style="min-width:16px;${wknd?'background:#2a1400':''}">${d}<br><span style="font-size:8px">${DAYS_HE[dow]}</span></th>`;
      const worked = emp.dates.has(dateStr); if (worked) total++;
      dayCells += `<td style="${wknd?'background:#1a0d00':''}${worked?'color:#22c55e;font-weight:800;font-size:14px':''}">${worked?'✓':''}</td>`;
    }
    pages += `<div class="page"${idx>0?' style="page-break-before:always"':''}>
      <div class="hdr"><div class="emp-name">${emp.name}</div><div class="sub2">ימי עבודה: ${MN[month]} ${year}</div></div>
      <table><thead><tr><th style="min-width:60px;text-align:right">שם עובד</th>${dayHeaders}<th class="tot-h">סה"כ</th></tr></thead>
      <tbody><tr><td style="font-weight:700;background:#fff7ed;text-align:right">${emp.name}</td>${dayCells}<td class="tot-c">${total}</td></tr></tbody></table>
      <div class="footer">סה"כ ימי עבודה: ${total} | חודש: ${MN[month]} ${year}</div>
    </div>`;
  });
  const html = `<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="UTF-8">
    <link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;700;800&display=swap" rel="stylesheet">
    <style>*{font-family:'Heebo',sans-serif;box-sizing:border-box;margin:0;padding:0}body{direction:rtl;font-size:11px}
    .biz-hdr{color:#d4a017;font-size:12px;font-weight:800;text-align:center;padding:6px 0 2px}
    .page{padding:6mm}.hdr{background:#1a1400;color:#f0c842;padding:10px 14px;border-radius:8px;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between}
    .emp-name{font-size:16px;font-weight:800;color:#f0c842}.sub2{font-size:12px;color:rgba(255,255,255,.7)}
    table{width:100%;border-collapse:collapse;font-size:10px}th{background:#1a1400;color:#f0c842;padding:3px 1px;text-align:center;font-size:9px}
    td{padding:4px 1px;border:1px solid rgba(212,160,23,.15);text-align:center}.tot-h{background:#d4a017;color:#0d1117;font-weight:800}
    .tot-c{background:#d4a017;color:#0d1117;font-weight:800;font-size:13px}.footer{text-align:center;color:#888;font-size:10px;margin-top:6px}
    @media print{.page{padding:4mm}}</style></head><body>
    <div class="biz-hdr">${BUSINESS_NAME}</div>${pages}</body></html>`;
  openPrint(html); toast(`נפתח חלון הדפסה – ${emps.length} עובדים`,'ok');
}

export function exportMonthCSV() {
  const data = getReportData(); if (!data) return;
  const { month, year, empMap } = data;
  const headers = ['שם עובד','ימי עבודה','תאריכים'];
  const rows = Object.values(empMap).sort((a,b)=>b.dates.size-a.dates.size)
    .map(e => [e.name, e.dates.size, [...e.dates].sort().join(' | ')]);
  exportCSV(headers, rows, `נוכחות_${MN[month]}_${year}.csv`);
  toast('קובץ CSV הורד','ok');
}

// ── MONTH LOCK ────────────────────────────────────────────────────────────────
export function drawLocks() {
  const el = document.getElementById('lock-list');
  if (!D.monthLocks.length) { el.innerHTML='<div class="muted tc" style="padding:12px">אין חודשים נעולים</div>'; return; }
  el.innerHTML = D.monthLocks.sort((a,b)=>b.year-a.year||b.month-a.month).map(m=>`
    <div class="list-item">
      <div style="font-size:24px">${m.locked?'🔒':'🔓'}</div>
      <div class="li-info"><div class="li-name">${MN[m.month]} ${m.year}</div><div class="li-sub">${m.by?.split('@')[0]||''}</div></div>
      <button class="btn ${m.locked?'btn-outline':'btn-danger'} btn-sm lock-toggle-btn" data-id="${m.id}">${m.locked?'🔓 פתח':'🔒 נעל'}</button>
    </div>`).join('');
  document.querySelectorAll('.lock-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => togLock(btn.dataset.id));
  });
}

export async function lockMonth() {
  const month = +document.getElementById('lk-month').value;
  const year  = +document.getElementById('lk-year').value;
  if (D.monthLocks.find(m => m.month===month && m.year===year)) { toast('חודש זה כבר ברשימה','err'); return; }
  const id = uid(), now = new Date().toISOString();
  await sAppend('MonthLocks',[id,month,year,'TRUE',D.user?.email||'',now,'','']);
  D.monthLocks.push({ id, month, year, locked:true, by:D.user?.email||'', at:now });
  await logAudit('LOCK','Month',`${month}/${year}`,`נעילת חודש ${MN[month]} ${year}`);
  drawLocks(); toast(`${MN[month]} ${year} נעול ✓`,'ok');
}

async function togLock(id) {
  const m = D.monthLocks.find(x => x.id===id); if (!m) return;
  m.locked = !m.locked;
  await rebuildTab('MonthLocks', D.monthLocks.map(x=>[x.id,x.month,x.year,x.locked?'TRUE':'FALSE',x.by||'',x.at||'','','']));
  await logAudit(m.locked?'LOCK':'UNLOCK','Month',`${m.month}/${m.year}`, `${m.locked?'נעילת':'שחרור'} חודש ${MN[m.month]} ${m.year}`);
  drawLocks(); toast(m.locked?'נעול ✓':'שוחרר ✓','ok');
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
function getReportData() {
  if (!D.reportMonth||!D.reportYear) { toast('הפק דוח תחילה','err'); return null; }
  const month = D.reportMonth, year = D.reportYear;
  const pfx = monthPrefix(month, year);
  const ma  = D.attendance.filter(a => a.date?.startsWith(pfx));
  const empMap = {};
  ma.forEach(a => {
    if (!empMap[a.empId]) empMap[a.empId] = { name:a.empName, dates:new Set() };
    empMap[a.empId].dates.add(a.date);
  });
  D.employees.filter(e=>e.active==='פעיל').forEach(e => {
    if (!empMap[e.id]) empMap[e.id] = { name:e.name, dates:new Set() };
  });
  return { month, year, pfx, empMap };
}

function buildPrintDoc(title, subtitle, body) {
  return `<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="UTF-8">
    <link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;700;800&display=swap" rel="stylesheet">
    <style>*{font-family:'Heebo',sans-serif;box-sizing:border-box}body{margin:16px;direction:rtl;font-size:12px}
    .biz-name{color:#d4a017;font-size:13px;font-weight:800;text-align:center;margin-bottom:2px}
    h2{color:#d4a017;text-align:center;font-size:18px;margin-bottom:4px}.sub{color:#666;text-align:center;font-size:12px;margin-bottom:16px}
    table{width:100%;border-collapse:collapse}th{background:#1a1400;color:#f0c842;padding:8px 6px;font-size:11px;text-align:center}
    td{padding:7px 6px;border-bottom:1px solid rgba(212,160,23,.15);font-size:11px;text-align:center;vertical-align:top}
    tr:nth-child(even)td{background:#0d1117}@media print{body{margin:8px}}</style></head><body>
    <div class="biz-name">${BUSINESS_NAME}</div>
    <h2>${title}</h2><div class="sub">${subtitle}</div>${body}</body></html>`;
}

function openPrint(html) {
  const w = window.open('','_blank');
  if (!w) { toast('אפשר חלונות קופצים בדפדפן','err'); return; }
  w.document.write(html); w.document.close();
  setTimeout(() => w.print(), 700);
}
