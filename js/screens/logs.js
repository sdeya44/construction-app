import { BUSINESS_NAME, DAYS_HE } from '../config.js';
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
      <button class="btn btn-ghost fg" id="log-pdf-btn">📄 PDF</button>
    </div>
    ${canEdit||canDel ? `<div class="btn-row mt8">
      ${canEdit ? `<button class="btn btn-outline fg" id="log-edit-btn">✏️ ערוך</button>` : ''}
      ${canDel  ? `<button class="btn btn-danger fg" id="log-del-btn">🗑️ מחק</button>` : ''}
    </div>` : ''}
    <button class="btn btn-ghost mt8" id="log-close-btn">סגור</button>`;

  document.getElementById('log-close-btn')?.addEventListener('click', () => closeSheet('sh-log'));
  document.getElementById('log-wa-btn')?.addEventListener('click', () => shareLogWhatsApp(log, att, eq, dl));
  document.getElementById('log-pdf-btn')?.addEventListener('click', () => _exportLogPDF(log, att, eq, dl, ph, acts));
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

function _exportLogPDF(log, att, eq, dl, ph, acts) {
  const w = window.open('', '_blank');
  if (!w) { toast('אפשר חלונות קופצים', 'err'); return; }
  const dow = DAYS_HE[new Date(log.date+'T12:00:00').getDay()];
  const attRows = att.map((a,i) => `<tr><td class="tc muted">${i+1}</td><td class="tname">👷 ${a.empName}</td></tr>`).join('');
  const eqRows  = eq.map((e,i)  => `<tr><td class="tc muted">${i+1}</td><td class="tname">🚜 ${e.eqName}</td></tr>`).join('');
  const dlRows  = dl.map((d,i)  => `<tr><td class="tc muted">${i+1}</td><td class="tname">${d.material}</td><td class="tc">${d.suppName||'—'}</td><td class="tc mono">${d.qty||'—'}</td></tr>`).join('');
  const photoGrid = ph.map(p => `<div style="border-radius:8px;overflow:hidden;background:#F0EDE8">
    <img src="${p.url}" style="width:100%;aspect-ratio:4/3;object-fit:cover;display:block"
      data-fileid="${p.fileId||''}"
      onerror="if(this.dataset.fileid&&!this.dataset.retried){this.dataset.retried='1';this.src='https://drive.google.com/thumbnail?id='+this.dataset.fileid+'&sz=w400';}else{this.parentElement.style.display='none';}">
  </div>`).join('');
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
  .page-body{padding:28px 36px}
  .stats-banner{display:flex;gap:0;border:1.5px solid rgba(184,146,44,.30);border-radius:10px;overflow:hidden;margin-bottom:20px}
  .stat-item{flex:1;padding:14px 10px;text-align:center;background:#FBF6EC;border-left:1px solid rgba(184,146,44,.20)}
  .stat-item:last-child{border-left:none}
  .stat-label{font-size:10px;color:#9A9189;margin-bottom:5px;font-weight:600}
  .stat-value{font-size:22px;font-weight:800;color:#B8922C;font-family:'JetBrains Mono',monospace}
  .sec-title{font-size:12px;font-weight:800;color:#B8922C;border-bottom:1.5px solid rgba(184,146,44,.25);padding-bottom:5px;margin:18px 0 10px}
  table{width:100%;border-collapse:collapse;margin-bottom:4px}
  thead tr{background:#B8922C}
  thead th{color:#fff;padding:8px 10px;font-size:11px;font-weight:700;text-align:center}
  thead th.tleft{text-align:right}
  tbody tr:nth-child(even){background:#FBF9F4}
  td{padding:8px 10px;font-size:12px;border-bottom:1px solid rgba(184,146,44,.08)}
  td.tc{text-align:center} td.tname{text-align:right;font-weight:600;color:#181410}
  td.mono{font-family:'JetBrains Mono',monospace} td.muted{color:#9A9189;font-size:11px}
  .acts{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:4px}
  .act-badge{background:rgba(184,146,44,.12);border:1px solid rgba(184,146,44,.28);border-radius:20px;padding:4px 12px;font-size:11px;font-weight:700;color:#B8922C}
  .notes-box{background:#FBF9F4;border:1.5px solid rgba(184,146,44,.15);border-radius:8px;padding:12px 16px;font-size:12px;line-height:1.7;color:#3D3530;margin-bottom:4px}
  .photos-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:4px}
  .page-footer{text-align:center;font-size:10px;color:#9A9189;border-top:1px solid #E5E0D8;padding-top:12px;margin-top:20px}
  @media print{body{background:#fff}@page{size:A4 portrait;margin:0}.page{width:auto}}
</style>
</head><body><div class="page">
  <div class="page-header">
    <div class="biz-name">${BUSINESS_NAME} — יומן עבודה</div>
    <div class="rep-title">${log.siteName}</div>
    <div class="rep-sub">${log.date} · ${dow} · ${log.manager?.split('@')[0]||''}</div>
  </div>
  <div class="page-body">
    <div class="stats-banner">
      <div class="stat-item"><div class="stat-label">עובדים</div><div class="stat-value">${att.length}</div></div>
      <div class="stat-item"><div class="stat-label">ציוד</div><div class="stat-value">${eq.length}</div></div>
      <div class="stat-item"><div class="stat-label">אספקות</div><div class="stat-value">${dl.length}</div></div>
      <div class="stat-item"><div class="stat-label">תמונות</div><div class="stat-value">${ph.length}</div></div>
    </div>
    ${acts.length ? `<div class="sec-title">פעילויות</div><div class="acts">${acts.map(a=>`<span class="act-badge">${a}</span>`).join('')}</div>` : ''}
    ${att.length ? `<div class="sec-title">עובדים (${att.length})</div>
    <table><thead><tr><th style="width:36px">#</th><th class="tleft">שם עובד</th></tr></thead>
    <tbody>${attRows}</tbody></table>` : ''}
    ${eq.length ? `<div class="sec-title">ציוד (${eq.length})</div>
    <table><thead><tr><th style="width:36px">#</th><th class="tleft">ציוד</th></tr></thead>
    <tbody>${eqRows}</tbody></table>` : ''}
    ${dl.length ? `<div class="sec-title">אספקות (${dl.length})</div>
    <table><thead><tr><th style="width:36px">#</th><th class="tleft">חומר</th><th>ספק</th><th>כמות</th></tr></thead>
    <tbody>${dlRows}</tbody></table>` : ''}
    ${log.notes ? `<div class="sec-title">הערות</div><div class="notes-box">${log.notes}</div>` : ''}
    ${ph.length ? `<div class="sec-title">תמונות (${ph.length})</div><div class="photos-grid">${photoGrid}</div>` : ''}
    <div class="page-footer">הופק: ${new Date().toLocaleDateString('he-IL')} &nbsp;|&nbsp; ${BUSINESS_NAME}</div>
  </div>
</div></body></html>`);
  w.document.close(); setTimeout(() => w.print(), ph.length > 0 ? 1500 : 700);
  toast('נפתח חלון הדפסה', 'ok');
}

export async function delLog(id, log) {
  closeSheet('sh-log');
  toast('מוחק...','');
  try {
    const [lg,at,le,dl,ph] = await Promise.all([
      sRead('DailyLogs','A2:P5000'), sRead('Attendance','A2:F5000'),
      sRead('LogEquipment','A2:F5000'), sRead('Deliveries','A2:G5000'),
      sRead('SitePhotos','A2:K5000')
    ]);
    await Promise.all([
      rebuildTab('DailyLogs',   lg.filter(r=>r[0] && r[0]!==id)),
      rebuildTab('Attendance',  at.filter(r=>r[0] && r[1]!==id)),
      rebuildTab('LogEquipment',le.filter(r=>r[0] && r[1]!==id)),
      rebuildTab('Deliveries',  dl.filter(r=>r[0] && r[1]!==id)),
      rebuildTab('SitePhotos',  ph.filter(r=>r[0] && r[9]!==id)),
    ]);
    D.logs       = D.logs.filter(l => l.id !== id);
    D.attendance = D.attendance.filter(a => a.logId !== id);
    D.logEquip   = D.logEquip.filter(e => e.logId !== id);
    D.deliveries = D.deliveries.filter(d => d.logId !== id);
    D.photos     = D.photos.filter(p => p.logId !== id);
    await logAudit('DELETE','DailyLog',id, `מחיקת יומן: ${log?.siteName||''} ${log?.date||''}`);
    filterLogs(); renderDash();
    toast('יומן נמחק','ok');
  } catch(e) { toast('שגיאה: '+e.message,'err'); }
}
