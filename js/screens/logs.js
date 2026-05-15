import { BUSINESS_NAME } from '../config.js';
import { D } from '../state.js';
import { todayStr, fmtDate, toast, can, confirm2, openSheet, closeSheet, isLocked, getActs, isDayOff, logCardHtml } from '../utils.js';
import { sRead, rebuildTab, logAudit } from '../api.js';
import { editLog } from './wizard.js';
import { renderDash } from './dashboard.js';
import { openLightbox } from '../lightbox.js';

export function renderLogs() { filterLogs(); }

export function setLogTab(t, el) {
  D.logTab = t;
  document.querySelectorAll('#s-logs .tab').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  filterLogs();
}

export function filterLogs() {
  const q     = (document.getElementById('log-q')?.value || '').toLowerCase();
  const site  = document.getElementById('log-filter-site')?.value || '';
  const act   = document.getElementById('log-filter-act')?.value  || '';
  const today = todayStr();
  let f = [...D.logs].sort((a,b) => b.date.localeCompare(a.date));
  if (D.logTab === 'today') f = f.filter(l => l.date === today);
  if (D.logTab === 'month') f = f.filter(l => l.date?.startsWith(today.slice(0,7)));
  if (site) f = f.filter(l => l.siteId === site);
  if (act)  f = f.filter(l => l[act] === true || (act==='other' && l.other));
  if (q)    f = f.filter(l => {
    if (l.siteName?.toLowerCase().includes(q)) return true;
    const att = D.attendance.filter(a => a.logId === l.id);
    if (att.some(a => a.empName?.toLowerCase().includes(q))) return true;
    const del = D.deliveries.filter(d => d.logId === l.id);
    if (del.some(d => d.material?.toLowerCase().includes(q) || d.suppName?.toLowerCase().includes(q))) return true;
    return false;
  });
  const el = document.getElementById('logs-list');
  el.innerHTML = f.length
    ? f.map(l => logCardHtml(l, D.attendance)).join('')
    : `<div class="empty"><div class="empty-icon">🔍</div><div class="empty-title">אין תוצאות</div></div>`;
  document.querySelectorAll('#logs-list .log-card').forEach(card => {
    card.onclick = () => showLog(card.dataset.logid);
  });
}

export function populateLogFilters() {
  const siteEl = document.getElementById('log-filter-site');
  if (!siteEl) return;
  siteEl.innerHTML = '<option value="">כל האתרים</option>' +
    D.sites.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
}

export function showLog(id) {
  const log = D.logs.find(l => l.id === id); if (!log) return;
  const att = D.attendance.filter(a => a.logId === id);
  const eq  = D.logEquip.filter(e => e.logId === id);
  const dl  = D.deliveries.filter(d => d.logId === id);
  const ph  = D.photos.filter(p => p.logId === id);
  const acts = getActs(log);
  const lk   = isLocked(log.date);
  const canEdit = can('edit_log') && !lk;
  const canDel  = can('delete_log') && !lk;

  const off = isDayOff(log);
  document.getElementById('sh-log-body').innerHTML = `
    ${lk ? '<div class="locked-bar">🔒 חודש נעול – לא ניתן לערוך</div>' : ''}
    ${off ? `<div class="locked-bar" style="background:rgba(239,68,68,.06);border-color:rgba(239,68,68,.2);color:var(--red)">🚫 ${log.other}</div>` : ''}
    <div class="sh-title">${log.siteName}</div>
    <div class="muted" style="margin-bottom:16px">${fmtDate(log.date)} · ${log.manager?.split('@')[0]}</div>
    ${!off && acts.length ? `<div class="card-title">פעילויות</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px">
        ${acts.map(a=>`<span class="badge b-blue">${a}</span>`).join('')}
      </div>` : ''}
    <div class="card-title">עובדים (${att.length})</div>
    <div style="margin-bottom:16px">${att.length
      ? att.map(a=>`<div class="list-item"><div class="avatar av-blue">👷</div><div class="li-name">${a.empName}</div></div>`).join('')
      : '<div class="muted">לא דווחו עובדים</div>'}</div>
    ${eq.length ? `<div class="card-title">ציוד</div>
      <div style="margin-bottom:16px">${eq.map(e=>`<div class="list-item"><div class="avatar av-gold">🚜</div><div class="li-name">${e.eqName}</div></div>`).join('')}</div>` : ''}
    ${dl.length ? `<div class="card-title">אספקות</div>
      <div style="margin-bottom:16px">${dl.map(d=>`<div class="list-item">
        <div class="avatar av-green">🚚</div>
        <div class="li-info"><div class="li-name">${d.material}</div><div class="li-sub">${d.suppName} · ${d.qty}</div></div>
      </div>`).join('')}</div>` : ''}
    ${ph.length ? `<div class="card-title">תמונות (${ph.length})</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:16px" id="log-photos-grid">
        ${ph.map((p,i)=>`<div style="border-radius:10px;overflow:hidden;background:rgba(255,255,255,0.5)">
          <img src="${p.url}" data-fileid="${p.fileId}" data-idx="${i}" class="photo-thumb"
            style="width:100%;aspect-ratio:1;object-fit:cover;display:block" loading="lazy"
            onerror="if(this.dataset.fileid&&!this.dataset.retried){this.dataset.retried='1';this.src='https://drive.google.com/thumbnail?id='+this.dataset.fileid+'&sz=w400';}else{this.parentElement.style.display='none';}">
        </div>`).join('')}
      </div>` : ''}
    ${log.notes ? `<div class="card-title">הערות</div>
      <div class="muted" style="margin-bottom:16px;line-height:1.6">${log.notes}</div>` : ''}
    <div class="btn-row mt8">
      <button class="btn btn-ghost fg" id="log-wa-btn" style="background:#25d366;color:#fff;border:none">
        <span style="font-size:1.1em">💬</span> שתף בוואטסאפ
      </button>
    </div>
    ${canEdit||canDel ? `<div class="btn-row mt8">
      ${canEdit ? `<button class="btn btn-outline fg" id="log-edit-btn">✏️ ערוך</button>` : ''}
      ${canDel  ? `<button class="btn btn-danger fg" id="log-del-btn">🗑️ מחק</button>` : ''}
    </div>` : ''}
    <button class="btn btn-ghost mt8" id="log-close-btn">סגור</button>`;

  document.getElementById('log-close-btn')?.addEventListener('click', () => closeSheet('sh-log'));
  document.getElementById('log-wa-btn')?.addEventListener('click', () => shareLogWhatsApp(log, att, eq, dl));
  if (ph.length) {
    document.querySelectorAll('#log-photos-grid .photo-thumb').forEach((img, i) => {
      img.addEventListener('click', () => openLightbox(ph, i));
    });
  }
  document.getElementById('log-edit-btn')?.addEventListener('click', () => {
    closeSheet('sh-log'); editLog(id);
  });
  document.getElementById('log-del-btn')?.addEventListener('click', () => confirmDelLog(id, log));
  openSheet('sh-log');
}

async function shareLogWhatsApp(log, att, eq, dl) {
  const acts = getActs(log);
  const lines = [
    `*${BUSINESS_NAME} — דיווח יומי*`,
    `אתר: ${log.siteName}`,
    `תאריך: ${fmtDate(log.date)}`,
    acts.length ? `פעילויות: ${acts.join(', ')}` : null,
    att.length  ? `עובדים (${att.length}): ${att.map(a=>a.empName).join(', ')}` : null,
    eq.length   ? `ציוד: ${eq.map(e=>e.eqName).join(', ')}` : null,
    dl.length   ? `אספקות: ${dl.map(d=>`${d.material} (${d.suppName})`).join(', ')}` : null,
    log.notes   ? `הערות: ${log.notes}` : null,
  ].filter(Boolean);
  const text = lines.join('\n');

  if (navigator.share) {
    try { await navigator.share({ text }); return; } catch {}
  }

  const encoded = encodeURIComponent(text);
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  if (isMobile) window.location.href = `https://wa.me/?text=${encoded}`;
  else window.open(`https://wa.me/?text=${encoded}`, '_blank');
}

function confirmDelLog(id, log) {
  confirm2('מחיקת יומן', `האם למחוק את היומן של ${log.siteName} מתאריך ${fmtDate(log.date)}?`, async () => {
    await delLog(id, log);
  });
}

export async function delLog(id, log) {
  closeSheet('sh-log');
  toast('מוחק...','');
  try {
    const [lg,at,le,dl] = await Promise.all([
      sRead('DailyLogs','A2:P5000'), sRead('Attendance','A2:F5000'),
      sRead('LogEquipment','A2:F5000'), sRead('Deliveries','A2:G5000')
    ]);
    await Promise.all([
      rebuildTab('DailyLogs',  lg.filter(r=>r[0] && r[0]!==id)),
      rebuildTab('Attendance', at.filter(r=>r[0] && r[1]!==id)),
      rebuildTab('LogEquipment',le.filter(r=>r[0] && r[1]!==id)),
      rebuildTab('Deliveries', dl.filter(r=>r[0] && r[1]!==id)),
    ]);
    D.logs       = D.logs.filter(l => l.id !== id);
    D.attendance = D.attendance.filter(a => a.logId !== id);
    D.logEquip   = D.logEquip.filter(e => e.logId !== id);
    D.deliveries = D.deliveries.filter(d => d.logId !== id);
    await logAudit('DELETE','DailyLog',id, `מחיקת יומן: ${log?.siteName||''} ${log?.date||''}`);
    filterLogs(); renderDash();
    toast('יומן נמחק','ok');
  } catch(e) { toast('שגיאה: '+e.message,'err'); }
}
