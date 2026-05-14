import { D } from '../state.js';
import { fmtDate } from '../utils.js';

const _debounceTimers = {};

export function renderSearch(context) {
  const containerId = context === 'gm' ? 'gm-content' : 'search-content';
  const el = document.getElementById(containerId);
  if (!el) return;

  el.innerHTML = `
    <div class="card" style="margin-bottom:12px">
      <input
        class="form-input"
        id="search-q-${context}"
        type="search"
        placeholder="חיפוש..."
        autocomplete="off"
        dir="rtl"
      >
    </div>
    <div id="search-results-${context}">
      <div class="muted" style="text-align:center;padding:20px">הזן לפחות 2 תווים</div>
    </div>
  `;

  const input = document.getElementById(`search-q-${context}`);
  input.addEventListener('input', () => {
    clearTimeout(_debounceTimers[context]);
    _debounceTimers[context] = setTimeout(() => runSearch(context), 300);
  });
}

function runSearch(context) {
  const input   = document.getElementById(`search-q-${context}`);
  const results = document.getElementById(`search-results-${context}`);
  if (!input || !results) return;

  const raw = input.value || '';
  const q   = raw.trim().toLowerCase();

  if (q.length < 2) {
    results.innerHTML = `<div class="muted" style="text-align:center;padding:20px">הזן לפחות 2 תווים</div>`;
    return;
  }

  const sections = [];

  // עובדים
  const empMatches = (D.employees || []).filter(e =>
    (e.name        || '').toLowerCase().includes(q) ||
    (e.phone       || '').toLowerCase().includes(q) ||
    (e.profession  || '').toLowerCase().includes(q)
  );
  if (empMatches.length) {
    sections.push(buildSection('עובדים', empMatches.length, empMatches.map(e => {
      return itemHtml(
        '👷',
        'av-blue',
        e.name,
        `${e.profession || ''}${e.profession && e.phone ? ' · ' : ''}${e.phone || ''}`,
        null,
        null,
        null
      );
    })));
  }

  // אתרים
  const siteMatches = (D.sites || []).filter(s =>
    (s.name    || '').toLowerCase().includes(q) ||
    (s.address || '').toLowerCase().includes(q)
  );
  if (siteMatches.length) {
    sections.push(buildSection('אתרים', siteMatches.length, siteMatches.map(s => {
      const badgeCls = s.status === 'פעיל' ? 'b-green' : s.status === 'מוקפא' ? 'b-gray' : 'b-gray';
      return itemHtml('📍', 'av-navy', s.name, s.address || '', s.status, badgeCls, null);
    })));
  }

  // יומנים
  const logMatches = (D.logs || []).filter(l =>
    (l.siteName || '').toLowerCase().includes(q) ||
    (l.notes    || '').toLowerCase().includes(q) ||
    (l.manager  || '').toLowerCase().includes(q)
  );
  if (logMatches.length) {
    sections.push(buildSection('יומנים', logMatches.length, logMatches.map(l => {
      return itemHtml(
        '📋',
        'av-blue',
        l.siteName,
        `${fmtDate(l.date)} · ${l.manager ? l.manager.split('@')[0] : ''}`,
        null,
        null,
        l.id
      );
    })));
  }

  // ספקים
  const suppMatches = (D.suppliers || []).filter(s =>
    (s.name  || '').toLowerCase().includes(q) ||
    (s.notes || '').toLowerCase().includes(q)
  );
  if (suppMatches.length) {
    sections.push(buildSection('ספקים', suppMatches.length, suppMatches.map(s => {
      return itemHtml('🚚', 'av-green', s.name, s.phone || '', null, null, null);
    })));
  }

  // ציוד
  const equipMatches = (D.equipment || []).filter(e =>
    (e.name || '').toLowerCase().includes(q) ||
    (e.type || '').toLowerCase().includes(q)
  );
  if (equipMatches.length) {
    sections.push(buildSection('ציוד', equipMatches.length, equipMatches.map(e => {
      return itemHtml('🔧', 'av-navy', e.name, e.type || '', null, null, null);
    })));
  }

  // אספקות
  const deliveryMatches = (D.deliveries || []).filter(d =>
    (d.material || '').toLowerCase().includes(q) ||
    (d.suppName || '').toLowerCase().includes(q)
  );
  if (deliveryMatches.length) {
    sections.push(buildSection('אספקות', deliveryMatches.length, deliveryMatches.map(d => {
      return itemHtml(
        '📦',
        'av-blue',
        d.material,
        `${d.qty ? 'כמות: ' + d.qty + ' · ' : ''}${d.suppName || ''}`,
        null,
        null,
        null
      );
    })));
  }

  if (!sections.length) {
    results.innerHTML = `
      <div class="empty">
        <div class="empty-icon">🔍</div>
        <div class="empty-title">אין תוצאות</div>
      </div>
    `;
    return;
  }

  results.innerHTML = sections.join('');

  results.querySelectorAll('.search-log-item').forEach(el => {
    el.addEventListener('click', () => {
      const logId = el.dataset.logid;
      import('./logs.js').then(m => m.showLog(logId));
    });
  });
}

function buildSection(title, count, itemsHtml) {
  return `
    <div style="margin-bottom:16px">
      <div class="muted" style="font-size:12px;font-weight:600;padding:4px 0 8px;border-bottom:1px solid var(--border);margin-bottom:8px">
        ${title} (${count})
      </div>
      <div class="card" style="padding:0">
        ${itemsHtml.join('')}
      </div>
    </div>
  `;
}

function itemHtml(icon, avatarCls, name, sub, badge, badgeCls, logId) {
  const isLog      = logId !== null && logId !== undefined;
  const clickClass = isLog ? ' clickable search-log-item' : '';
  const logAttr    = isLog ? ` data-logid="${logId}"` : '';
  const badgeHtml  = badge ? `<span class="badge ${badgeCls || ''}">${badge}</span>` : '';
  return `
    <div class="list-item${clickClass}"${logAttr}>
      <div class="avatar ${avatarCls}">${icon}</div>
      <div class="li-info">
        <div class="li-name">${name || '—'}</div>
        ${sub ? `<div class="li-sub">${sub}</div>` : ''}
      </div>
      ${badgeHtml}
    </div>
  `;
}
