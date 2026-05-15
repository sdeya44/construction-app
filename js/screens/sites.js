import { HDR } from '../config.js';
import { D } from '../state.js';
import { uid, todayStr, toast, can, openSheet, closeSheet, setBtn } from '../utils.js';
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
  document.querySelectorAll('.site-row').forEach(row => { row.onclick = () => openEditSite(row.dataset.id); });
  document.querySelectorAll('.site-photos-btn').forEach(btn => {
    btn.onclick = e => { e.stopPropagation(); openSitePhotos(btn.dataset.id); };
  });
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
