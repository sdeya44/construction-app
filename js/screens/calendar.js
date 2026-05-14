import { D } from '../state.js';
import { MN } from '../config.js';
import { pad, monthPrefix, getDaysInMonth } from '../utils.js';

let _calSite  = '';
let _calMonth = new Date().getMonth() + 1;
let _calYear  = new Date().getFullYear();

const DAY_SHORT = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];

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

  const today     = new Date();
  const todayStr  = `${today.getFullYear()}-${pad(today.getMonth()+1)}-${pad(today.getDate())}`;
  const pfx       = monthPrefix(_calMonth, _calYear);
  const daysInMon = getDaysInMonth(_calYear, _calMonth);
  const firstDow  = new Date(_calYear, _calMonth - 1, 1).getDay();

  const siteLogs  = D.logs.filter(l => l.siteId === _calSite && l.date && l.date.startsWith(pfx));
  const logByDate = {};
  siteLogs.forEach(l => { logByDate[l.date] = l; });

  DAY_SHORT.forEach(label => {
    const hdr = document.createElement('div');
    hdr.textContent = label;
    hdr.style.cssText = 'text-align:center;font-weight:700;font-size:12px;color:var(--muted);padding:4px 0';
    gridEl.appendChild(hdr);
  });

  for (let blank = 0; blank < firstDow; blank++) {
    const empty = document.createElement('div');
    gridEl.appendChild(empty);
  }

  let workDays   = 0;
  let absentDays = 0;
  let futureDays = 0;

  for (let d = 1; d <= daysInMon; d++) {
    const dateStr = `${_calYear}-${pad(_calMonth)}-${pad(d)}`;
    const dow     = new Date(_calYear, _calMonth - 1, d).getDay();
    const isWeekend = dow === 5 || dow === 6;
    const isFuture  = dateStr > todayStr;
    const log       = logByDate[dateStr];

    const cell = document.createElement('div');
    cell.style.cssText = 'border-radius:8px;padding:6px 2px;text-align:center;font-weight:700;font-size:13px;min-height:44px;display:flex;flex-direction:column;align-items:center;justify-content:center;';

    const dayNum = document.createElement('span');
    dayNum.textContent = d;
    cell.appendChild(dayNum);

    if (isFuture) {
      cell.style.background = '#f1f5f9';
      cell.style.color = '#94a3b8';
      futureDays++;
    } else if (isWeekend) {
      cell.style.background = '#f8fafc';
      cell.style.color = '#cbd5e1';
    } else if (log) {
      cell.style.background = '#dcfce7';
      cell.style.color = '#15803d';
      cell.style.cursor = 'pointer';
      const check = document.createElement('span');
      check.textContent = '✓';
      check.style.fontSize = '11px';
      cell.appendChild(check);
      const logId = log.id;
      cell.addEventListener('click', () => {
        import('./logs.js').then(m => m.showLog(logId));
      });
      workDays++;
    } else {
      cell.style.background = '#fee2e2';
      cell.style.color = '#b91c1c';
      cell.style.cursor = 'pointer';
      const x = document.createElement('span');
      x.textContent = '✗';
      x.style.fontSize = '11px';
      cell.appendChild(x);
      const capturedDate  = dateStr;
      const capturedSite  = _calSite;
      cell.addEventListener('click', () => {
        const panel = document.getElementById('gm-panel');
        if (panel) panel.classList.remove('open');
        D.wiz = {
          step: 1,
          date: capturedDate,
          siteId: capturedSite,
          acts: [],
          note: '',
          gNote: '',
          emps: [],
          equip: [],
          dels: [],
          photos: [],
          editMode: false,
        };
        import('../utils.js').then(u => u.go('newlog'));
        import('./wizard.js').then(w => w.drawWiz());
      });
      absentDays++;
    }

    gridEl.appendChild(cell);
  }

  const summEl = document.getElementById('cal-summary');
  if (summEl) {
    summEl.textContent = `${workDays} ימי עבודה | ${absentDays} ימי היעדרות | ${futureDays} ימי עתיד`;
  }
}

function updateLabel() {
  const lbl = document.getElementById('cal-month-label');
  if (lbl) lbl.textContent = `${MN[_calMonth]} ${_calYear}`;
}

export function renderCalendar() {
  const el = document.getElementById('gm-content');
  if (!el) return;

  const siteOptions = D.sites
    .map(s => `<option value="${s.id}">${s.name}</option>`)
    .join('');

  el.innerHTML = `
    <div class="card">
      <div class="card-title">📅 לוח שנה לפי אתר</div>
      <div class="form-group">
        <label class="form-label">אתר</label>
        <select class="form-input" id="cal-site-sel">
          <option value="">— בחר אתר —</option>
          ${siteOptions}
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

  if (_calSite) {
    const siteSel = document.getElementById('cal-site-sel');
    if (siteSel) siteSel.value = _calSite;
  }

  updateLabel();
  buildGrid();

  document.getElementById('cal-site-sel').addEventListener('change', e => {
    _calSite = e.target.value;
    buildGrid();
  });

  document.getElementById('cal-prev').addEventListener('click', () => {
    _calMonth--;
    if (_calMonth < 1) { _calMonth = 12; _calYear--; }
    updateLabel();
    buildGrid();
  });

  document.getElementById('cal-next').addEventListener('click', () => {
    _calMonth++;
    if (_calMonth > 12) { _calMonth = 1; _calYear++; }
    updateLabel();
    buildGrid();
  });
}
