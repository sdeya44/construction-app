import { MN, DAYS_HE, ROLES } from './config.js';
import { D } from './state.js';

// ── DATE ─────────────────────────────────────────────────────────────────────
export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
export function pad(n) { return String(n).padStart(2,'0'); }
export function fmtDate(s) {
  if (!s) return '';
  try { return new Date(s+'T12:00:00').toLocaleDateString('he-IL',{weekday:'long',year:'numeric',month:'long',day:'numeric'}); }
  catch { return s; }
}
export function monthPrefix(month, year) {
  return `${year}-${pad(month)}`;
}
export function getDaysInMonth(year, month) { return new Date(year, month, 0).getDate(); }

// ── IDS ──────────────────────────────────────────────────────────────────────
export function uid() { return Date.now().toString(36)+Math.random().toString(36).substr(2,6); }

// ── PERMISSIONS ──────────────────────────────────────────────────────────────
export function can(action) {
  return (ROLES[D.role] || []).includes(action);
}

// ── TOAST ────────────────────────────────────────────────────────────────────
let _tt;
export function toast(msg, type='') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast show' + (type ? ' '+type : '');
  clearTimeout(_tt);
  _tt = setTimeout(() => el.classList.remove('show'), 3400);
}

// ── CONFIRM ──────────────────────────────────────────────────────────────────
export function confirm2(title, msg, cb) {
  document.getElementById('confirm-body').innerHTML =
    `<div class="sh-title">${title}</div>
     <div class="muted" style="margin-bottom:20px;line-height:1.6">${msg}</div>
     <button class="btn btn-danger" id="cf-ok">אישור</button>
     <button class="btn btn-ghost mt8" id="cf-cancel">ביטול</button>`;
  window._cf = cb;
  document.getElementById('cf-ok').onclick    = () => { closeSheet('sh-confirm'); if(window._cf) window._cf(); };
  document.getElementById('cf-cancel').onclick = () => closeSheet('sh-confirm');
  openSheet('sh-confirm');
}

// ── SHEETS ───────────────────────────────────────────────────────────────────
export function openSheet(id) {
  document.getElementById(id)?.classList.add('open');
}
export function closeSheet(id) {
  document.getElementById(id)?.classList.remove('open');
}

// ── LOADING ──────────────────────────────────────────────────────────────────
export function showLoad(t='טוען...') {
  document.getElementById('loading')?.classList.remove('hidden');
  setLoad(t);
}
export function setLoad(t) {
  const el = document.getElementById('ld-txt');
  if (el) el.textContent = t;
}
export function hideLoad() {
  document.getElementById('loading')?.classList.add('hidden');
}

// ── BUTTON ───────────────────────────────────────────────────────────────────
export function setBtn(id, disabled, txt) {
  const b = document.getElementById(id);
  if (!b) return;
  b.disabled = disabled;
  if (txt) b.textContent = txt;
}

// ── NAVIGATION ───────────────────────────────────────────────────────────────
export function go(s) {
  document.querySelectorAll('.screen').forEach(x => x.classList.remove('active'));
  document.getElementById('s-'+s)?.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(x => x.classList.remove('active'));
  document.getElementById('nav-'+s)?.classList.add('active');
  D.activeScreen = s;
}

// ── LOCK CHECK ───────────────────────────────────────────────────────────────
export function isLocked(ds) {
  if (!ds) return false;
  try {
    const d = new Date(ds+'T12:00:00');
    return D.monthLocks.some(m => m.month === d.getMonth()+1 && m.year === d.getFullYear() && m.locked);
  } catch { return false; }
}

// ── LOG ACTIVITIES ────────────────────────────────────────────────────────────
export function isDayOff(l) {
  return (l.other || '').startsWith('יום חופש:');
}

export function getActs(l) {
  if (isDayOff(l)) return [];
  const a = [];
  if (l.dig)  a.push('חפירה');
  if (l.base) a.push('מצעים');
  if (l.form) a.push('טפסנות');
  if (l.cast) a.push('יציקה');
  if (l.strip)a.push('פירוק טפסנות');
  if (l.other)a.push(l.other);
  return a;
}

// ── IMAGE COMPRESSION ─────────────────────────────────────────────────────────
export function compressImage(file, maxDim=1200, quality=0.82) {
  return new Promise(resolve => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width: w, height: h } = img;
      if (w > maxDim || h > maxDim) {
        if (w > h) { h = Math.round(h * maxDim / w); w = maxDim; }
        else       { w = Math.round(w * maxDim / h); h = maxDim; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        blob => resolve(new File([blob], file.name.replace(/\.[^.]+$/,'.jpg'), {type:'image/jpeg'})),
        'image/jpeg', quality
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

// ── SWIPE TO CLOSE SHEETS ─────────────────────────────────────────────────────
export function initSheetSwipe() {
  document.querySelectorAll('.overlay').forEach(overlay => {
    const sheet = overlay.querySelector('.sheet');
    if (!sheet) return;
    const handle = sheet.querySelector('.sh-handle');
    if (!handle) return;
    let ty = 0;
    handle.addEventListener('touchstart', e => { ty = e.touches[0].clientY; }, { passive: true });
    handle.addEventListener('touchend', e => {
      if (e.changedTouches[0].clientY - ty > 70) overlay.classList.remove('open');
    }, { passive: true });
  });
}

// ── PULL TO REFRESH ───────────────────────────────────────────────────────────
export function setupPullToRefresh(scrollId, onRefresh) {
  const el = document.getElementById(scrollId);
  if (!el) return;
  let ty = 0, active = false;
  el.addEventListener('touchstart', e => {
    if (el.scrollTop > 0) return;
    ty = e.touches[0].clientY;
    active = true;
  }, { passive: true });
  el.addEventListener('touchmove', () => {
    if (!active || el.scrollTop > 0) { active = false; return; }
  }, { passive: true });
  el.addEventListener('touchend', e => {
    if (!active) return;
    active = false;
    const dy = e.changedTouches[0].clientY - ty;
    const ind = el.querySelector('.ptr-indicator');
    if (ind) ind.remove();
    if (dy > 70) onRefresh();
  }, { passive: true });
}

// ── CSV EXPORT ────────────────────────────────────────────────────────────────
export function exportCSV(headers, rows, filename) {
  const BOM = '﻿';
  const esc = v => `"${String(v??'').replace(/"/g,'""')}"`;
  const content = BOM + [headers, ...rows].map(r => r.map(esc).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], {type:'text/csv;charset=utf-8'}));
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

// ── LOG CARD HTML ─────────────────────────────────────────────────────────────
export function logCardHtml(log, attendance) {
  const acts = getActs(log);
  const att  = attendance.filter(a => a.logId === log.id);
  const lk   = isLocked(log.date);
  const off  = isDayOff(log);
  const [,mo,dy] = (log.date||'').split('-');
  return `<div class="log-card${off?' log-card-dayoff':''}" data-logid="${log.id}">
    <div class="log-date${off?' log-date-off':''}">
      <div class="log-day">${dy||'?'}</div>
      <div class="log-mon">${MN[+mo]||''}</div>
    </div>
    <div class="log-info">
      <div class="log-site">${log.siteName} ${lk?'🔒':''}</div>
      <div class="log-meta">👷 ${att.length} עובדים · ${log.manager?.split('@')[0]||''}</div>
      <div class="log-acts">
        ${off ? `<span class="act-tag tag-dayoff">🚫 ${log.other}</span>` : acts.map(a=>`<span class="act-tag">${a}</span>`).join('')}
      </div>
    </div>
  </div>`;
}
