import { HDR, MN, BUSINESS_NAME } from '../config.js';
import { D } from '../state.js';
import { uid, todayStr, toast, can, openSheet, closeSheet, setBtn, monthPrefix, exportCSV } from '../utils.js';
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
      _exportSitePDF(site, month, year, workDays, siteLogs.length, workers, equipUsed, totalEquipCost);
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

function _exportSitePDF(site, month, year, workDays, logCount, workers, equipUsed, totalEquipCost) {
  const w = window.open('', '_blank');
  if (!w) { toast('אפשר חלונות קופצים', 'err'); return; }
  w.document.write(`<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="UTF-8">
  <link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;700;800&display=swap" rel="stylesheet">
  <style>*{font-family:'Heebo',sans-serif;box-sizing:border-box}body{margin:16px;direction:rtl;font-size:12px}
  .biz{color:#B8922C;font-size:13px;font-weight:800;text-align:center;margin-bottom:2px}
  h2{color:#B8922C;text-align:center;font-size:18px;margin-bottom:4px;font-weight:800}
  .sub{color:#726E68;text-align:center;font-size:12px;margin-bottom:16px}
  .sec{font-weight:800;font-size:13px;color:#B8922C;border-bottom:2px solid #B8922C;padding-bottom:4px;margin:16px 0 8px}
  .kv{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #eee}
  table{width:100%;border-collapse:collapse;margin-top:8px}
  th{background:#B8922C;color:#fff;padding:8px 6px;font-size:11px;text-align:center}
  td{padding:7px 6px;border-bottom:1px solid rgba(184,146,44,.12);font-size:11px;text-align:center}
  @media print{body{margin:8px}}</style></head><body>
  <div class="biz">${BUSINESS_NAME}</div>
  <h2>דוח חודשי — ${site.name}</h2>
  <div class="sub">${MN[month]} ${year}${site.address?' | '+site.address:''} | הופק: ${new Date().toLocaleDateString('he-IL')}</div>
  <div class="sec">סיכום</div>
  <div class="kv"><span>ימי עבודה</span><strong>${workDays}</strong></div>
  <div class="kv"><span>יומנים</span><strong>${logCount}</strong></div>
  ${workers.length?`<div class="kv"><span>עובדים</span><strong>${workers.join(', ')}</strong></div>`:''}
  ${equipUsed.length?`<div class="sec">ציוד בשימוש</div>
  <table><thead><tr><th style="text-align:right">ציוד</th><th>ימים</th><th>עלות</th></tr></thead><tbody>
  ${equipUsed.map(e=>`<tr><td style="text-align:right">${e.name}</td><td>${e.days}</td><td>${e.cost>0?e.cost.toLocaleString('he-IL')+' ₪':'—'}</td></tr>`).join('')}
  ${totalEquipCost>0?`<tr><td style="text-align:right;font-weight:800">סה"כ</td><td></td><td style="font-weight:800">${totalEquipCost.toLocaleString('he-IL')} ₪</td></tr>`:''}
  </tbody></table>`:''}
  </body></html>`);
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
