import { D } from '../state.js';
import { fmtDate } from '../utils.js';

const _debounceTimers = {};

export function renderSearch(context) {
  const el = document.getElementById(context === 'gm' ? 'gm-content' : 'search-content');
  if (!el) return;
  el.innerHTML = `
    <div class="card" style="margin-bottom:12px">
      <input class="form-input" id="search-q-${context}" type="search" placeholder="חיפוש..." autocomplete="off" dir="rtl">
    </div>
    <div id="search-results-${context}">
      <div class="muted" style="text-align:center;padding:20px">הזן לפחות 2 תווים</div>
    </div>`;
  document.getElementById(`search-q-${context}`).addEventListener('input', () => {
    clearTimeout(_debounceTimers[context]);
    _debounceTimers[context] = setTimeout(() => runSearch(context), 300);
  });
}

function runSearch(context) {
  const input   = document.getElementById(`search-q-${context}`);
  const results = document.getElementById(`search-results-${context}`);
  if (!input || !results) return;
  const q = input.value.trim().toLowerCase();
  if (q.length < 2) {
    results.innerHTML = `<div class="muted" style="text-align:center;padding:20px">הזן לפחות 2 תווים</div>`;
    return;
  }

  const inc = (v) => (v || '').toLowerCase().includes(q);
  const sections = [];

  const empMatches = D.employees.filter(e => inc(e.name) || inc(e.phone) || inc(e.profession));
  if (empMatches.length)
    sections.push(buildSection('עובדים', empMatches.length, empMatches.map(e =>
      itemHtml('👷', 'av-blue', e.name, [e.profession, e.phone].filter(Boolean).join(' · '), null, null, null))));

  const siteMatches = D.sites.filter(s => inc(s.name) || inc(s.address));
  if (siteMatches.length)
    sections.push(buildSection('אתרים', siteMatches.length, siteMatches.map(s =>
      itemHtml('📍', 'av-navy', s.name, s.address || '', s.status, s.status === 'פעיל' ? 'b-green' : 'b-gray', null))));

  const logMatches = D.logs.filter(l => inc(l.siteName) || inc(l.notes) || inc(l.manager));
  if (logMatches.length)
    sections.push(buildSection('יומנים', logMatches.length, logMatches.map(l =>
      itemHtml('📋', 'av-blue', l.siteName, `${fmtDate(l.date)} · ${l.manager ? l.manager.split('@')[0] : ''}`, null, null, l.id))));

  const suppMatches = D.suppliers.filter(s => inc(s.name) || inc(s.notes));
  if (suppMatches.length)
    sections.push(buildSection('ספקים', suppMatches.length, suppMatches.map(s =>
      itemHtml('🚚', 'av-green', s.name, s.phone || '', null, null, null))));

  const equipMatches = D.equipment.filter(e => inc(e.name) || inc(e.type));
  if (equipMatches.length)
    sections.push(buildSection('ציוד', equipMatches.length, equipMatches.map(e =>
      itemHtml('🔧', 'av-navy', e.name, e.type || '', null, null, null))));

  const deliveryMatches = D.deliveries.filter(d => inc(d.material) || inc(d.suppName));
  if (deliveryMatches.length)
    sections.push(buildSection('אספקות', deliveryMatches.length, deliveryMatches.map(d =>
      itemHtml('📦', 'av-blue', d.material, `${d.qty ? 'כמות: ' + d.qty + ' · ' : ''}${d.suppName || ''}`, null, null, null))));

  if (!sections.length) {
    results.innerHTML = `<div class="empty"><div class="empty-icon">🔍</div><div class="empty-title">אין תוצאות</div></div>`;
    return;
  }
  results.innerHTML = sections.join('');
  results.querySelectorAll('.search-log-item').forEach(el => {
    el.addEventListener('click', () => import('./logs.js').then(m => m.showLog(el.dataset.logid)));
  });
}

function buildSection(title, count, itemsHtml) {
  return `<div style="margin-bottom:16px">
    <div class="muted" style="font-size:12px;font-weight:600;padding:4px 0 8px;border-bottom:1px solid var(--border);margin-bottom:8px">${title} (${count})</div>
    <div class="card" style="padding:0">${itemsHtml.join('')}</div>
  </div>`;
}

function itemHtml(icon, avatarCls, name, sub, badge, badgeCls, logId) {
  const isLog = logId != null;
  return `<div class="list-item${isLog ? ' clickable search-log-item' : ''}"${isLog ? ` data-logid="${logId}"` : ''}>
    <div class="avatar ${avatarCls}">${icon}</div>
    <div class="li-info">
      <div class="li-name">${name || '—'}</div>
      ${sub ? `<div class="li-sub">${sub}</div>` : ''}
    </div>
    ${badge ? `<span class="badge ${badgeCls || ''}">${badge}</span>` : ''}
  </div>`;
}
