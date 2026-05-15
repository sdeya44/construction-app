import { D } from '../state.js';
import { MN } from '../config.js';
import { pad, monthPrefix, getDaysInMonth } from '../utils.js';

let _calSite  = '';
let _calMonth = new Date().getMonth() + 1;
let _calYear  = new Date().getFullYear();
let _calTab   = 'site';

const DAY_SHORT = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];

function todayStr() {
  const t = new Date();
  return `${t.getFullYear()}-${pad(t.getMonth()+1)}-${pad(t.getDate())}`;
}

function makeCell(style) {
  const c = document.createElement('div');
  c.style.cssText = style;
  return c;
}

function appendDayHeaders(gridEl) {
  DAY_SHORT.forEach(label => {
    const h = makeCell('text-align:center;font-weight:700;font-size:12px;color:var(--muted);padding:4px 0');
    h.textContent = label;
    gridEl.appendChild(h);
  });
}

function appendBlanks(gridEl, count) {
  for (let i = 0; i < count; i++) gridEl.appendChild(document.createElement('div'));
}

function buildGrid() {
  const gridEl = document.getElementById('cal-grid');
  if (!gridEl) return;
  gridEl.innerHTML = '';

  if (!_calSite) {
    gridEl.innerHTML = '<div class="empty" style="grid-column:span 7"><div class="empty-icon">📅</div><div class="empty-title">בחר אתר לצפייה בלוח שנה</div></div>';
    const summEl = document.getElementById('cal-summary');
    if (summEl) summEl.textContent = '';
    return;
  }

  const today      = todayStr();
  const pfx        = monthPrefix(_calMonth, _calYear);
  const daysInMon  = getDaysInMonth(_calYear, _calMonth);
  const firstDow   = new Date(_calYear, _calMonth - 1, 1).getDay();
  const logByDate  = {};
  D.logs.filter(l => l.siteId===_calSite && l.date?.startsWith(pfx)).forEach(l => { logByDate[l.date] = l; });

  appendDayHeaders(gridEl);
  appendBlanks(gridEl, firstDow);

  let workDays=0, absentDays=0, futureDays=0;
  for (let d = 1; d <= daysInMon; d++) {
    const dateStr  = `${_calYear}-${pad(_calMonth)}-${pad(d)}`;
    const dow      = new Date(_calYear, _calMonth-1, d).getDay();
    const isWeekend = dow===5||dow===6;
    const isFuture  = dateStr > today;
    const log       = logByDate[dateStr];

    const cell = makeCell('border-radius:8px;padding:6px 2px;text-align:center;font-weight:700;font-size:13px;min-height:44px;display:flex;flex-direction:column;align-items:center;justify-content:center;');
    const dayNum = document.createElement('span');
    dayNum.textContent = d;
    cell.appendChild(dayNum);

    if (isFuture) {
      cell.style.background='#f1f5f9'; cell.style.color='#94a3b8'; futureDays++;
    } else if (isWeekend) {
      cell.style.background='#f8fafc'; cell.style.color='#cbd5e1';
    } else if (log) {
      cell.style.cssText += 'background:#dcfce7;color:#15803d;cursor:pointer';
      const check = document.createElement('span');
      check.textContent='✓'; check.style.fontSize='11px';
      cell.appendChild(check);
      const logId = log.id;
      cell.addEventListener('click', () => import('./logs.js').then(m => m.showLog(logId)));
      workDays++;
    } else {
      cell.style.cssText += 'background:#fee2e2;color:#b91c1c;cursor:pointer';
      const x = document.createElement('span');
      x.textContent='✗'; x.style.fontSize='11px';
      cell.appendChild(x);
      const capturedDate=dateStr, capturedSite=_calSite;
      cell.addEventListener('click', () => {
        document.getElementById('gm-panel')?.classList.remove('open');
        D.wiz = { step:1, date:capturedDate, siteId:capturedSite, acts:[], note:'', gNote:'', emps:[], equip:[], dels:[], photos:[], editMode:false, dayOff:false, dayOffReason:'' };
        import('../utils.js').then(u => u.go('newlog'));
        import('./wizard.js').then(w => w.drawWiz());
      });
      absentDays++;
    }
    gridEl.appendChild(cell);
  }

  const summEl = document.getElementById('cal-summary');
  if (summEl) summEl.textContent = `${workDays} ימי עבודה | ${absentDays} ימי היעדרות | ${futureDays} ימי עתיד`;
}

function buildOverviewGrid() {
  const gridEl = document.getElementById('cal-grid');
  if (!gridEl) return;
  gridEl.innerHTML = '';

  const activeSites = D.sites.filter(s => s.status === 'פעיל');
  if (!activeSites.length) {
    gridEl.innerHTML = '<div class="empty" style="grid-column:span 7"><div class="empty-icon">📍</div><div class="empty-title">אין אתרים פעילים</div></div>';
    const summEl = document.getElementById('cal-summary');
    if (summEl) summEl.innerHTML = '';
    return;
  }

  const today     = todayStr();
  const pfx       = monthPrefix(_calMonth, _calYear);
  const daysInMon = getDaysInMonth(_calYear, _calMonth);
  const firstDow  = new Date(_calYear, _calMonth-1, 1).getDay();
  const total     = activeSites.length;

  const logsByDate = {};
  D.logs.filter(l => l.date?.startsWith(pfx)).forEach(l => {
    (logsByDate[l.date] = logsByDate[l.date] || new Set()).add(l.siteId);
  });

  appendDayHeaders(gridEl);
  appendBlanks(gridEl, firstDow);

  let fullDays=0, partialDays=0, missDays=0;
  for (let d = 1; d <= daysInMon; d++) {
    const dateStr   = `${_calYear}-${pad(_calMonth)}-${pad(d)}`;
    const dow       = new Date(_calYear, _calMonth-1, d).getDay();
    const isWeekend = dow===5||dow===6;
    const isFuture  = dateStr > today;

    const cell = makeCell('border-radius:8px;padding:4px 2px;text-align:center;font-size:12px;font-weight:700;min-height:44px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;');
    const dayNum = document.createElement('span');
    dayNum.textContent = d;
    cell.appendChild(dayNum);

    if (isFuture) {
      cell.style.background='#f1f5f9'; cell.style.color='#94a3b8';
    } else if (isWeekend) {
      cell.style.background='#f8fafc'; cell.style.color='#cbd5e1';
    } else {
      const reported = logsByDate[dateStr] ? logsByDate[dateStr].size : 0;
      const ratio    = reported / total;
      const label = document.createElement('span');
      label.textContent = `${reported}/${total}`;
      label.style.cssText = 'font-size:10px;font-weight:600';
      cell.appendChild(label);
      if (ratio >= 1)       { cell.style.background='#dcfce7'; cell.style.color='#15803d'; fullDays++; }
      else if (ratio >= 0.5){ cell.style.background='#fef9c3'; cell.style.color='#92400e'; partialDays++; }
      else if (ratio > 0)   { cell.style.background='#ffedd5'; cell.style.color='#c2410c'; partialDays++; }
      else                  { cell.style.background='#fee2e2'; cell.style.color='#b91c1c'; missDays++; }
    }
    gridEl.appendChild(cell);
  }

  const summEl = document.getElementById('cal-summary');
  if (summEl) summEl.innerHTML = `
    <div class="cal-legend">
      <div class="cal-legend-item"><span class="cal-legend-dot" style="background:#dcfce7;border:1.5px solid #86efac"></span>כולם דיווחו</div>
      <div class="cal-legend-item"><span class="cal-legend-dot" style="background:#fef9c3;border:1.5px solid #fde047"></span>חלקי</div>
      <div class="cal-legend-item"><span class="cal-legend-dot" style="background:#fee2e2;border:1.5px solid #fca5a5"></span>אין דיווח</div>
    </div>
    <div style="margin-top:6px">${fullDays} ימים מלאים · ${partialDays} חלקיים · ${missDays} ללא דיווח</div>`;
}

function updateLabel() {
  const lbl = document.getElementById('cal-month-label');
  if (lbl) lbl.textContent = `${MN[_calMonth]} ${_calYear}`;
}

function rebuildGrid() {
  if (_calTab === 'overview') buildOverviewGrid(); else buildGrid();
}

function switchTab(tab) {
  _calTab = tab;
  document.querySelectorAll('#cal-tabs .tab').forEach(b => b.classList.remove('active'));
  document.getElementById(`cal-tab-${tab}`)?.classList.add('active');
  const siteSel = document.getElementById('cal-site-row');
  if (siteSel) siteSel.style.display = tab === 'site' ? '' : 'none';
  rebuildGrid();
}

export function renderCalendar() {
  const el = document.getElementById('gm-content');
  if (!el) return;
  el.innerHTML = `
    <div class="card">
      <div class="card-title">📅 לוח שנה</div>
      <div id="cal-tabs" class="tabs" style="margin-bottom:12px">
        <button class="tab ${_calTab==='site'?'active':''}" id="cal-tab-site">לפי אתר</button>
        <button class="tab ${_calTab==='overview'?'active':''}" id="cal-tab-overview">סקירה כללית</button>
      </div>
      <div id="cal-site-row" class="form-group" style="${_calTab==='overview'?'display:none':''}">
        <label class="form-label">אתר</label>
        <select class="form-input" id="cal-site-sel">
          <option value="">— בחר אתר —</option>
          ${D.sites.map(s=>`<option value="${s.id}">${s.name}</option>`).join('')}
        </select>
      </div>
      <div class="row" style="align-items:center;justify-content:space-between;margin-top:8px">
        <button class="btn btn-ghost btn-sm" id="cal-prev" style="width:auto;padding:6px 14px">&#8249;</button>
        <span id="cal-month-label" style="font-weight:700;font-size:15px"></span>
        <button class="btn btn-ghost btn-sm" id="cal-next" style="width:auto;padding:6px 14px">&#8250;</button>
      </div>
    </div>
    <div id="cal-grid" style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:8px"></div>
    <div id="cal-summary" class="muted" style="text-align:center;font-size:13px;padding:8px 0"></div>`;

  if (_calSite && _calTab === 'site') {
    const siteSel = document.getElementById('cal-site-sel');
    if (siteSel) siteSel.value = _calSite;
  }
  updateLabel();
  rebuildGrid();

  document.getElementById('cal-tab-site').addEventListener('click', () => switchTab('site'));
  document.getElementById('cal-tab-overview').addEventListener('click', () => switchTab('overview'));
  document.getElementById('cal-site-sel').addEventListener('change', e => { _calSite = e.target.value; buildGrid(); });
  document.getElementById('cal-prev').addEventListener('click', () => {
    _calMonth--; if (_calMonth < 1) { _calMonth=12; _calYear--; }
    updateLabel(); rebuildGrid();
  });
  document.getElementById('cal-next').addEventListener('click', () => {
    _calMonth++; if (_calMonth > 12) { _calMonth=1; _calYear++; }
    updateLabel(); rebuildGrid();
  });
}
