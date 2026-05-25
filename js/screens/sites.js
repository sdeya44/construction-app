import { HDR, MN, DAYS_HE, BUSINESS_NAME } from '../config.js';
import { D } from '../state.js';
import { uid, todayStr, toast, can, openSheet, closeSheet, setBtn, monthPrefix, exportCSV, getActs } from '../utils.js';
import { sAppend, sWrite, logAudit } from '../api.js';
import { openSitePhotos } from './photos.js';

export function renderSites() {
  let s = [...D.sites];
  if (D.role === 'SiteManager') {
    const assigned = new Set(D.siteAssignments.filter(a => a.email === D.user?.email).map(a => a.siteId));
    s = s.filter(x => assigned.has(x.id));
  }
  const tab = D.siteTab;
  if (tab === 'active') s = s.filter(x => x.status === 'פעיל');
  else if (tab === 'frozen') s = s.filter(x => x.status !== 'פעיל' && x.status !== 'הסתיים');
  const el = document.getElementById('sites-list');
  if (!s.length) {
    el.innerHTML = `<div class="empty"><div class="empty-icon">📍</div><div class="empty-title">אין אתרים</div><div class="empty-sub">לחץ ➕ להוסיף</div></div>`;
    return;
  }
  el.innerHTML = s.map(site => {
    const logs     = D.logs.filter(l => l.siteId === site.id);
    const td       = logs.find(l => l.date === todayStr());
    const sc       = site.status==='פעיל'?'b-green':site.status==='מוקפא'?'b-gold':'b-gray';
    const photoCnt = D.photos.filter(p => p.siteId === site.id).length;
    return `<div class="card" style="margin-bottom:10px">
      <div class="list-item clickable site-row" data-id="${site.id}">
        <div class="avatar av-navy">📍</div>
        <div class="li-info">
          <div class="li-name">${site.name}</div>
          <div class="li-sub">${site.address||'ללא כתובת'} · ${logs.length} יומנים${td?' · ✅ היום':''}</div>
        </div>
        <span class="badge ${sc}">${site.status}</span>
      </div>
      <button class="btn btn-ghost btn-sm site-photos-btn" data-id="${site.id}" style="margin-top:8px;justify-content:flex-start;gap:6px">
        📸 תמונות <span class="badge b-blue" style="margin-right:4px">${photoCnt}</span>
      </button>
    </div>`;
  }).join('');
  document.querySelectorAll('.site-row').forEach(row => { row.onclick = () => _openDetails(row.dataset.id); });
  document.querySelectorAll('.site-photos-btn').forEach(btn => {
    btn.onclick = e => { e.stopPropagation(); openSitePhotos(btn.dataset.id); };
  });
}

function _openDetails(id) {
  const site = D.sites.find(x => x.id === id); if (!site) return;
  const el = document.getElementById('sites-list');
  const now = new Date(), cm = now.getMonth()+1, cy = now.getFullYear();
  const sc = site.status==='פעיל'?'b-green':site.status==='מוקפא'?'b-gold':'b-gray';
  el.innerHTML = `
    <button class="btn btn-ghost btn-sm mt8" id="site-back">← חזרה לרשימה</button>
    <div class="card mt12">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
        <div style="min-width:0">
          <div style="font-size:20px;font-weight:800;color:var(--text)">${site.name}</div>
          <div style="color:var(--muted);font-size:13px;margin-top:4px">${site.address||'ללא כתובת'}</div>
          ${site.notes?`<div style="font-size:12px;color:var(--muted);margin-top:6px">${site.notes}</div>`:''}
        </div>
        <span class="badge ${sc}" style="flex-shrink:0">${site.status}</span>
      </div>
      <div class="btn-row mt12">
        <button class="btn btn-ghost fg" id="site-det-edit">✏️ עריכה</button>
        <button class="btn btn-ghost fg" id="site-det-photos">📸 תמונות</button>
      </div>
    </div>
    <div class="card mt8">
      <div class="card-title">דוח חודשי</div>
      <div class="row" style="gap:8px;align-items:flex-end;flex-wrap:wrap">
        <div class="form-group" style="flex:1;min-width:100px"><label class="form-label">חודש</label>
          <select class="form-input" id="site-r-month">${MN.slice(1).map((n,i)=>`<option value="${i+1}">${n}</option>`).join('')}</select></div>
        <div class="form-group" style="flex:1;min-width:80px"><label class="form-label">שנה</label>
          <select class="form-input" id="site-r-year">${[cy,cy-1,cy-2].map(y=>`<option value="${y}">${y}</option>`).join('')}</select></div>
        <button class="btn btn-primary" id="btn-site-gen" style="width:auto;padding:12px 20px;margin-bottom:2px">📊 הפק</button>
      </div>
    </div>
    <div id="site-r-out"></div>`;
  document.getElementById('site-back').onclick = renderSites;
  document.getElementById('site-det-edit').onclick = () => openEditSite(id);
  document.getElementById('site-det-photos').onclick = () => openSitePhotos(id);
  document.getElementById('site-r-month').value = cm;
  document.getElementById('site-r-year').value  = cy;
  document.getElementById('btn-site-gen').onclick = () =>
    _showSiteReport(id, site, +document.getElementById('site-r-month').value, +document.getElementById('site-r-year').value);
  _showSiteReport(id, site, cm, cy);
}

function _showSiteReport(siteId, site, month, year) {
  const pfx      = monthPrefix(month, year);
  const siteLogs = D.logs.filter(l => l.siteId === siteId && l.date?.startsWith(pfx));
  const workDays = new Set(siteLogs.map(l => l.date)).size;
  const workerIds = [...new Set(siteLogs.flatMap(l => l.workers || []))];
  const workers  = workerIds.map(wid => D.employees.find(e => e.id === wid)?.name || wid).filter(Boolean);
  const equipEntries = D.logEquip.filter(e => e.siteId === siteId && e.date?.startsWith(pfx));
  const equipUsed = [...new Set(equipEntries.map(e => e.eqId))].map(eid => {
    const eq = D.equipment.find(e => e.id === eid); if (!eq) return null;
    const days = new Set(equipEntries.filter(e => e.eqId === eid).map(e => e.date)).size;
    return { name: eq.name, days, cost: days * (eq.dailyRate || 0) };
  }).filter(Boolean);
  const totalEquipCost = equipUsed.reduce((s, e) => s + e.cost, 0);
  const photoCnt = D.photos.filter(p => p.siteId === siteId).length;

  document.getElementById('site-r-out').innerHTML = `
    <div class="card mt8">
      <div class="card-title">סיכום ${MN[month]} ${year}</div>
      <div class="list-item" style="border:none;padding:4px 0"><span>ימי עבודה</span><span style="font-weight:700;margin-right:auto;color:var(--gold)">${workDays}</span></div>
      <div class="list-item" style="border:none;padding:4px 0"><span>יומנים שנרשמו</span><span style="font-weight:700;margin-right:auto">${siteLogs.length}</span></div>
      <div class="list-item" style="border:none;padding:4px 0"><span>תמונות באתר</span><span style="font-weight:700;margin-right:auto">${photoCnt}</span></div>
      ${workers.length ? `<div style="padding:6px 0"><div style="font-size:12px;color:var(--muted);margin-bottom:6px">עובדים בחודש</div><div style="display:flex;flex-wrap:wrap;gap:4px">${workers.map(w=>`<span class="badge b-blue">${w}</span>`).join('')}</div></div>` : ''}
    </div>
    ${equipUsed.length ? `<div class="card mt8">
      <div class="card-title">ציוד בשימוש</div>
      ${equipUsed.map(e=>`<div class="list-item" style="border:none;padding:4px 0"><span>🚜 ${e.name}</span><div style="display:flex;gap:6px;margin-right:auto"><span class="badge b-gold">${e.days} ימים</span>${e.cost>0?`<span class="badge b-green">${e.cost.toLocaleString('he-IL')} ₪</span>`:''}</div></div>`).join('')}
      ${totalEquipCost>0?`<div class="list-item" style="border:none;padding:6px 0;border-top:1px solid var(--border)"><span style="font-weight:700">סה"כ עלות ציוד</span><span style="font-weight:700;margin-right:auto;color:var(--gold)">${totalEquipCost.toLocaleString('he-IL')} ₪</span></div>`:''}
    </div>` : ''}
    ${!workDays && !equipUsed.length ? `<div class="empty mt16"><div class="empty-icon">📋</div><div class="empty-title">אין נתונים לחודש זה</div></div>` : ''}
    ${workDays > 0 ? `<div class="btn-row mt8">
      <button class="btn btn-ghost btn-sm fg" id="btn-site-pdf">📄 PDF</button>
      <button class="btn btn-ghost btn-sm fg" id="btn-site-csv">📥 CSV</button>
    </div>` : ''}`;

  if (workDays > 0) {
    document.getElementById('btn-site-pdf').onclick = () =>
      _exportSitePDF(site, month, year, workDays, siteLogs, workers, equipUsed, totalEquipCost, siteId);
    document.getElementById('btn-site-csv').onclick = () => {
      exportCSV(
        ['תאריך','עובדים','ציוד'],
        siteLogs.map(l => [
          l.date,
          (l.workers||[]).map(wid => D.employees.find(e=>e.id===wid)?.name||wid).join(', '),
          D.logEquip.filter(e=>e.siteId===siteId&&e.date===l.date).map(e=>D.equipment.find(x=>x.id===e.eqId)?.name||e.eqId).join(', ')
        ]),
        `${site.name}_${MN[month]}_${year}.csv`
      );
      toast('CSV הורד', 'ok');
    };
  }
}

function _exportSitePDF(site, month, year, workDays, siteLogs, workers, equipUsed, totalEquipCost, siteId) {
  const w = window.open('', '_blank');
  if (!w) { toast('אפשר חלונות קופצים', 'err'); return; }
  const sortedLogs = [...siteLogs].sort((a,b) => a.date.localeCompare(b.date));
  const dayRows = sortedLogs.map(log => {
    const dow = new Date(log.date+'T12:00:00').getDay();
    const wc  = (log.workers || []).length;
    const dayEquip = D.logEquip
      .filter(e => e.siteId === siteId && e.date === log.date)
      .map(e => D.equipment.find(x => x.id === e.eqId)?.name || '')
      .filter(Boolean);
    const logActs = getActs(log);
    return `<tr>
      <td class="ddate">${log.date}</td>
      <td class="tc daycol">${DAYS_HE[dow]}</td>
      <td class="tc mono bold ${wc>0?'gold':''}">${wc}</td>
      <td class="tleft">${dayEquip.join(', ')||'—'}</td>
      <td class="tleft">${logActs.join(', ')||'—'}</td>
    </tr>`;
  }).join('');
  const equipRows = equipUsed.map(e => `<tr>
    <td class="tname">🚜 ${e.name}</td>
    <td class="tc mono bold">${e.days}</td>
    <td class="tc mono ${e.cost>0?'grn':''}">${e.cost>0?e.cost.toLocaleString('he-IL')+' ₪':'—'}</td>
  </tr>`).join('');
  w.document.write(`<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;600;700;800&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Heebo',sans-serif;direction:rtl;background:#fff;color:#181410}
  .page{width:794px;padding:0;background:#fff}
  .page-header{background:linear-gradient(135deg,#1A1714 0%,#2C2620 100%);padding:28px 36px 24px;border-bottom:3px solid #B8922C}
  .biz-name{color:#B8922C;font-size:11px;font-weight:800;letter-spacing:1.5px;margin-bottom:10px}
  .rep-title{color:#EDE8DF;font-size:26px;font-weight:800;margin-bottom:4px}
  .rep-sub{color:rgba(237,232,223,.65);font-size:13px}
  .page-body{padding:24px 36px}
  .stats-banner{display:flex;gap:0;border:1.5px solid rgba(184,146,44,.30);border-radius:10px;overflow:hidden;margin-bottom:20px}
  .stat-item{flex:1;padding:14px 10px;text-align:center;background:#FBF6EC;border-left:1px solid rgba(184,146,44,.20)}
  .stat-item:last-child{border-left:none}
  .stat-label{font-size:10px;color:#9A9189;margin-bottom:5px;font-weight:600}
  .stat-value{font-size:22px;font-weight:800;color:#B8922C;font-family:'JetBrains Mono',monospace}
  .stat-value.grn{color:#2A6B47}
  .sec-title{font-size:12px;font-weight:800;color:#B8922C;border-bottom:1.5px solid rgba(184,146,44,.25);padding-bottom:5px;margin:18px 0 10px}
  table{width:100%;border-collapse:collapse;margin-bottom:8px}
  thead tr{background:#B8922C}
  thead th{color:#fff;padding:9px 10px;font-size:11px;font-weight:700;text-align:center}
  thead th.tleft{text-align:right}
  tbody tr:nth-child(even){background:#FBF9F4}
  td{padding:8px 10px;font-size:11.5px;border-bottom:1px solid rgba(184,146,44,.08)}
  td.tc{text-align:center} td.tname{text-align:right;font-weight:600;color:#181410}
  td.tleft{text-align:right;font-size:11px;color:#4A4540}
  td.mono{font-family:'JetBrains Mono',monospace} td.bold{font-weight:700}
  td.gold{color:#B8922C} td.grn{color:#2A6B47}
  td.daycol{color:#9A9189;font-size:10.5px}
  .ddate{font-family:'JetBrains Mono',monospace;font-size:11px;color:#6C6259;direction:ltr;text-align:left}
  tfoot tr{background:rgba(184,146,44,.12)}
  tfoot td{color:#B8922C;padding:9px 10px;font-weight:800;font-size:12px;text-align:center}
  tfoot td.tname{text-align:right}
  .page-footer{text-align:center;font-size:10px;color:#9A9189;border-top:1px solid #E5E0D8;padding-top:12px;margin-top:4px}
  @media print{body{background:#fff}@page{size:A4 landscape;margin:0}.page{width:auto}}
</style></head><body><div class="page">
  <div class="page-header">
    <div class="biz-name">${BUSINESS_NAME}</div>
    <div class="rep-title">דוח חודשי — ${site.name}</div>
    <div class="rep-sub">${MN[month]} ${year}${site.address?' · '+site.address:''}</div>
  </div>
  <div class="page-body">
    <div class="stats-banner">
      <div class="stat-item"><div class="stat-label">ימי עבודה</div><div class="stat-value">${workDays}</div></div>
      <div class="stat-item"><div class="stat-label">יומנים</div><div class="stat-value">${siteLogs.length}</div></div>
      <div class="stat-item"><div class="stat-label">עובדים</div><div class="stat-value">${workers.length}</div></div>
      <div class="stat-item"><div class="stat-label">עלות ציוד</div><div class="stat-value grn" style="font-size:${totalEquipCost>99999?'14':'18'}px">${totalEquipCost>0?totalEquipCost.toLocaleString('he-IL')+' ₪':'—'}</div></div>
    </div>
    ${dayRows ? `
    <div class="sec-title">פירוט ימי עבודה</div>
    <table>
      <thead><tr>
        <th class="tleft" style="min-width:90px">תאריך</th>
        <th>יום</th><th>עובדים</th>
        <th class="tleft">ציוד</th>
        <th class="tleft">פעילויות</th>
      </tr></thead>
      <tbody>${dayRows}</tbody>
    </table>` : ''}
    ${equipUsed.length ? `
    <div class="sec-title">ציוד בשימוש</div>
    <table>
      <thead><tr><th class="tleft">ציוד</th><th>ימי שימוש</th><th>עלות</th></tr></thead>
      <tbody>${equipRows}</tbody>
      ${totalEquipCost>0?`<tfoot><tr><td class="tname">סה"כ</td><td class="mono">${equipUsed.reduce((s,e)=>s+e.days,0)}</td><td class="mono">${totalEquipCost.toLocaleString('he-IL')} ₪</td></tr></tfoot>`:''}
    </table>` : ''}
    <div class="page-footer">הופק: ${new Date().toLocaleDateString('he-IL')} &nbsp;|&nbsp; ${BUSINESS_NAME}</div>
  </div>
</div></body></html>`);
  w.document.close(); setTimeout(() => w.print(), 700);
  toast('נפתח חלון הדפסה', 'ok');
}

export function setSiteTab(t, el) {
  D.siteTab = t;
  document.querySelectorAll('#s-sites .tab').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  renderSites();
}

function applySiteStatusUI(v) {
  ['ss-active','ss-frozen','ss-ended'].forEach(id => document.getElementById(id)?.classList.remove('active-s','frozen-s','ended-s'));
  if (v==='פעיל')   document.getElementById('ss-active')?.classList.add('active-s');
  else if (v==='מוקפא') document.getElementById('ss-frozen')?.classList.add('frozen-s');
  else              document.getElementById('ss-ended')?.classList.add('ended-s');
}

export function openAddSite() {
  if (!can('manage_sites')) { toast('אין הרשאה','err'); return; }
  D.editSiteId = null; D.siteStatus = 'פעיל';
  document.getElementById('site-sh-title').textContent = '➕ הוספת אתר';
  ['s-name','s-addr','s-notes'].forEach(id => { document.getElementById(id).value = ''; });
  applySiteStatusUI('פעיל');
  document.getElementById('btn-save-site').textContent = 'שמור אתר';
  openSheet('sh-site');
}

export function openEditSite(id) {
  const s = D.sites.find(x => x.id === id); if (!s) return;
  D.editSiteId = id; D.siteStatus = s.status || 'פעיל';
  document.getElementById('site-sh-title').textContent = '✏️ עריכת אתר';
  document.getElementById('s-name').value  = s.name;
  document.getElementById('s-addr').value  = s.address || '';
  document.getElementById('s-notes').value = s.notes   || '';
  applySiteStatusUI(s.status || 'פעיל');
  document.getElementById('btn-save-site').textContent = 'עדכן אתר';
  openSheet('sh-site');
}

export function selectSiteStatus(v) { D.siteStatus = v; applySiteStatusUI(v); }

export async function saveSite() {
  if (!can('manage_sites')) { toast('אין הרשאה','err'); return; }
  const name  = document.getElementById('s-name').value.trim();
  if (!name) { toast('יש להזין שם אתר','err'); return; }
  const addr  = document.getElementById('s-addr').value.trim();
  const notes = document.getElementById('s-notes').value.trim();
  setBtn('btn-save-site', true, 'שומר...');
  try {
    if (D.editSiteId) {
      const i = D.sites.findIndex(s => s.id === D.editSiteId);
      D.sites[i] = { ...D.sites[i], name, address:addr, status:D.siteStatus, notes };
      await sWrite('Sites','A1',[HDR.Sites,...D.sites.map(s=>[s.id,s.name,s.address,s.status,s.notes])]);
      await logAudit('UPDATE','Site',D.editSiteId,`עדכון אתר: ${name}`);
      toast('אתר עודכן ✓','ok');
    } else {
      const id = uid();
      await sAppend('Sites',[id,name,addr,D.siteStatus,notes]);
      D.sites.push({ id, name, address:addr, status:D.siteStatus, notes });
      await logAudit('CREATE','Site',id,`הוספת אתר: ${name}`);
      toast('אתר נוסף ✓','ok');
    }
    closeSheet('sh-site'); renderSites();
  } catch(e) { toast('שגיאה: '+e.message,'err'); }
  setBtn('btn-save-site', false, D.editSiteId?'עדכן אתר':'שמור אתר');
}
