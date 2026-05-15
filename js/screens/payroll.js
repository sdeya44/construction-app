import { D } from '../state.js';
import { MN, BUSINESS_NAME } from '../config.js';
import { pad, monthPrefix, toast, can, exportCSV } from '../utils.js';

function renderCostChart() {
  const now = new Date();
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const m = d.getMonth() + 1;
    const y = d.getFullYear();
    const pfx = `${y}-${pad(m)}`;
    const total = D.employees.reduce((sum, emp) => {
      if (!emp.dailyRate) return sum;
      const days = new Set(
        D.attendance.filter(a => a.empId === emp.id && a.date?.startsWith(pfx)).map(a => a.date)
      ).size;
      return sum + days * (+emp.dailyRate);
    }, 0);
    months.push({ label: MN[m], total });
  }

  const max = Math.max(...months.map(m => m.total), 1);
  const svgW = 300, svgH = 130;
  const padL = 8, padR = 8, padT = 22, padB = 28;
  const chartW = svgW - padL - padR;
  const chartH = svgH - padT - padB;
  const slotW = chartW / months.length;
  const barW  = Math.floor(slotW * 0.6);

  const bars = months.map((m, i) => {
    const x    = padL + i * slotW + (slotW - barW) / 2;
    const barH = m.total > 0 ? Math.max(4, Math.floor((m.total / max) * chartH)) : 3;
    const y    = padT + chartH - barH;
    const fmt  = m.total >= 10000 ? '₪'+(m.total/1000).toFixed(0)+'K' : m.total > 0 ? '₪'+m.total.toLocaleString() : '';
    return `
      <rect x="${x}" y="${y}" width="${barW}" height="${barH}" rx="4" fill="url(#cg)"/>
      ${m.total > 0 ? `<text x="${x+barW/2}" y="${y-4}" text-anchor="middle" class="chart-bar-label">${fmt}</text>` : ''}
      <text x="${x+barW/2}" y="${svgH-6}" text-anchor="middle" class="chart-axis-label">${m.label}</text>`;
  }).join('');

  return `
    <div class="card" style="margin-bottom:12px">
      <div class="card-title">📈 עלויות שכר — 6 חודשים אחרונים</div>
      <svg viewBox="0 0 ${svgW} ${svgH}" style="width:100%;height:auto;direction:ltr">
        <defs>
          <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#f97316"/>
            <stop offset="100%" stop-color="#fb923c" stop-opacity=".7"/>
          </linearGradient>
        </defs>
        <line x1="${padL}" y1="${padT+chartH}" x2="${svgW-padR}" y2="${padT+chartH}" stroke="#fed7aa" stroke-width="1"/>
        ${bars}
      </svg>
    </div>`;
}

function openPrint(html) {
  const w = window.open('', '_blank');
  if (!w) { toast('אפשר חלונות קופצים בדפדפן', 'err'); return; }
  w.document.write(html); w.document.close();
  setTimeout(() => w.print(), 700);
}

function buildYearOptions(selEl, currentYear) {
  selEl.innerHTML = '';
  for (let y = currentYear; y >= currentYear - 2; y--) {
    const opt = document.createElement('option');
    opt.value = y; opt.textContent = y;
    selEl.appendChild(opt);
  }
  selEl.value = currentYear;
}

function buildMonthOptions(selEl, currentMonth) {
  selEl.innerHTML = '';
  MN.slice(1).forEach((name, i) => {
    const opt = document.createElement('option');
    opt.value = i + 1; opt.textContent = name;
    selEl.appendChild(opt);
  });
  selEl.value = currentMonth;
}

function calcPayroll(month, year) {
  const pfx = monthPrefix(month, year);
  const activeEmps = D.employees.filter(e => e.active === 'פעיל');

  return activeEmps.map(emp => {
    const uniqueDates = new Set(
      D.attendance
        .filter(a => a.empId === emp.id && a.date && a.date.startsWith(pfx))
        .map(a => a.date)
    );
    const workDays = uniqueDates.size;
    const rate = emp.dailyRate ? +emp.dailyRate : 0;
    const total = workDays * rate;
    return { id: emp.id, name: emp.name, workDays, rate, total };
  }).sort((a, b) => a.name.localeCompare(b.name, 'he'));
}

function renderResults(month, year) {
  const rows = calcPayroll(month, year);
  const totalDays = rows.reduce((s, r) => s + r.workDays, 0);
  const totalPay  = rows.reduce((s, r) => s + r.total, 0);

  const listHtml = rows.map(r => `
    <div class="list-item">
      <div class="avatar av-blue">👷</div>
      <div class="li-info">
        <div class="li-name">${r.name}</div>
        <div class="li-sub">${r.workDays} ימי עבודה · ${r.rate ? '₪' + r.rate.toLocaleString() + ' ליום' : ''}</div>
      </div>
      ${r.rate === 0
        ? '<span class="muted" style="font-size:12px">לא הוגדר תעריף</span>'
        : `<span class="badge b-green">₪${r.total.toLocaleString()}</span>`}
    </div>`).join('');

  document.getElementById('pay-out').innerHTML = `
    <div class="card">
      <div class="card-title">סיכום ${MN[month]} ${year}</div>
      <div class="list-item" style="border:none;padding:4px 0">
        <span>עובדים פעילים</span>
        <span style="font-weight:700;margin-right:auto">${rows.length}</span>
      </div>
      <div class="list-item" style="border:none;padding:4px 0">
        <span>סה"כ ימי עבודה</span>
        <span style="font-weight:700;margin-right:auto">${totalDays}</span>
      </div>
      <div class="list-item" style="border:none;padding:4px 0">
        <span>סה"כ לתשלום</span>
        <span style="font-weight:700;margin-right:auto;color:#10b981">₪${totalPay.toLocaleString()}</span>
      </div>
    </div>
    <div class="card">
      <div class="card-title">פירוט לפי עובד</div>
      ${listHtml || '<div class="muted" style="padding:12px;text-align:center">אין עובדים פעילים</div>'}
    </div>
    <div class="btn-row">
      <button class="btn btn-ghost btn-sm" id="btn-pay-pdf">📄 ייצוא PDF</button>
      <button class="btn btn-ghost btn-sm" id="btn-pay-csv">📥 ייצוא CSV</button>
    </div>`;

  document.getElementById('pay-out').style.display = 'block';

  document.getElementById('btn-pay-pdf').addEventListener('click', () => {
    const tableRows = rows.map((r, i) => `
      <tr>
        <td>${i + 1}</td>
        <td style="text-align:right">${r.name}</td>
        <td>${r.workDays}</td>
        <td>${r.rate ? '₪' + r.rate.toLocaleString() : '—'}</td>
        <td>${r.rate ? '₪' + r.total.toLocaleString() : '<span style="color:#999;font-size:11px">לא הוגדר תעריף</span>'}</td>
      </tr>`).join('');

    const html = `<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="UTF-8">
      <link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;700;800&display=swap" rel="stylesheet">
      <style>
        *{font-family:'Heebo',sans-serif;box-sizing:border-box}
        body{margin:20px;direction:rtl;font-size:12px}
        .biz{color:#888;font-size:12px;text-align:center;margin-bottom:4px}
        h2{color:#7c2d12;text-align:center;font-size:20px;margin-bottom:4px;font-weight:800}
        .sub{color:#666;text-align:center;font-size:12px;margin-bottom:18px}
        table{width:100%;border-collapse:collapse}
        th{background:#7c2d12;color:#fff;padding:9px 7px;font-size:11px;text-align:center}
        td{padding:7px 7px;border-bottom:1px solid #fed7aa;font-size:11px;text-align:center;vertical-align:middle}
        tr:nth-child(even) td{background:#fff7ed}
        tfoot tr td{background:#7c2d12;color:#fbbf24;font-weight:800;font-size:12px}
        @media print{body{margin:8px}}
      </style></head><body>
      <div class="biz">${BUSINESS_NAME}</div>
      <h2>דוח שכר — ${MN[month]} ${year}</h2>
      <div class="sub">תאריך הפקה: ${new Date().toLocaleDateString('he-IL')}</div>
      <table>
        <thead><tr><th>#</th><th style="text-align:right">שם עובד</th><th>ימי עבודה</th><th>תעריף יומי</th><th>סה"כ לתשלום</th></tr></thead>
        <tbody>${tableRows}</tbody>
        <tfoot><tr>
          <td colspan="2" style="text-align:right">סה"כ</td>
          <td>${totalDays}</td>
          <td></td>
          <td>₪${totalPay.toLocaleString()}</td>
        </tr></tfoot>
      </table>
      </body></html>`;
    openPrint(html);
    toast('נפתח חלון הדפסה', 'ok');
  });

  document.getElementById('btn-pay-csv').addEventListener('click', () => {
    const headers = ['שם עובד', 'ימי עבודה', 'תעריף יומי (₪)', 'סה"כ (₪)'];
    const csvRows = rows.map(r => [r.name, r.workDays, r.rate || '', r.rate ? r.total : '']);
    exportCSV(headers, csvRows, `שכר_${MN[month]}_${year}.csv`);
    toast('קובץ CSV הורד', 'ok');
  });
}

export function renderPayroll() {
  const el = document.getElementById('gm-content');
  if (!el) return;

  if (!can('view_payroll')) {
    el.innerHTML = `
      <div class="empty">
        <div class="empty-icon">🔒</div>
        <div class="empty-title">אין הרשאה</div>
        <div class="muted">אין לך הרשאה לצפות בדוח שכר</div>
      </div>`;
    return;
  }

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear  = now.getFullYear();

  el.innerHTML = renderCostChart() + `
    <div class="card">
      <div class="card-title">💰 דוח שכר</div>
      <div class="row" style="gap:8px;align-items:flex-end;flex-wrap:wrap">
        <div class="form-group" style="flex:1;min-width:120px">
          <label class="form-label">חודש</label>
          <select class="form-input" id="pay-month"></select>
        </div>
        <div class="form-group" style="flex:1;min-width:100px">
          <label class="form-label">שנה</label>
          <select class="form-input" id="pay-year"></select>
        </div>
        <button class="btn btn-primary" id="btn-gen-payroll" style="width:auto;padding:10px 18px;margin-bottom:2px">💰 חשב שכר</button>
      </div>
    </div>
    <div id="pay-out" style="display:none"></div>`;

  buildMonthOptions(document.getElementById('pay-month'), currentMonth);
  buildYearOptions(document.getElementById('pay-year'), currentYear);

  document.getElementById('btn-gen-payroll').addEventListener('click', () => {
    const month = +document.getElementById('pay-month').value;
    const year  = +document.getElementById('pay-year').value;
    renderResults(month, year);
  });
}
