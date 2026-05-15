import { D } from '../state.js';
import { MN, BUSINESS_NAME } from '../config.js';
import { pad, monthPrefix, toast, exportCSV } from '../utils.js';

function openPrint(html) {
  const w = window.open('', '_blank');
  if (!w) { toast('אפשר חלונות קופצים בדפדפן', 'err'); return; }
  w.document.write(html); w.document.close();
  setTimeout(() => w.print(), 700);
}

function buildSelectOptions(selEl, items) {
  selEl.innerHTML = items.map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
}

function calcEquipUsage(month, year) {
  const pfx = monthPrefix(month, year);
  return D.equipment.map(eq => {
    const entries = D.logEquip.filter(e => e.eqId===eq.id && e.date?.startsWith(pfx));
    const uniqueSiteIds = [...new Set(entries.map(e => e.siteId))];
    return {
      id: eq.id, name: eq.name, type: eq.type||'', active: eq.active,
      daysUsed: new Set(entries.map(e => e.date)).size,
      sites: uniqueSiteIds.map(sid => D.sites.find(s=>s.id===sid)?.name||sid).filter(Boolean),
    };
  }).sort((a, b) => b.daysUsed - a.daysUsed);
}

function renderResults(month, year) {
  const rows = calcEquipUsage(month, year);
  const totalDays = rows.reduce((s, r) => s + r.daysUsed, 0);
  const usedCount = rows.filter(r => r.daysUsed > 0).length;
  const listHtml  = rows.map(r => `
    <div class="card" style="margin-bottom:8px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:10px;min-width:0">
          <div class="avatar av-gold">🚜</div>
          <div class="li-info" style="min-width:0">
            <div class="li-name">${r.name}</div>
            <div class="li-sub">${r.type?`<span class="badge b-blue" style="font-size:11px">${r.type}</span>`:''}
              ${r.active!=='פעיל'?'<span class="badge b-gray" style="font-size:11px;margin-right:4px">לא פעיל</span>':''}</div>
          </div>
        </div>
        ${r.daysUsed>0?`<span class="badge b-gold">${r.daysUsed} ימי שימוש</span>`:'<span class="badge b-gray">0</span>'}
      </div>
      ${r.daysUsed>0?`<div style="margin-top:6px;font-size:12px;color:var(--muted)">📍 ${r.sites.join(', ')}</div>`:'<div class="muted" style="margin-top:6px;font-size:12px">לא נעשה שימוש החודש</div>'}
    </div>`).join('');

  const out = document.getElementById('eq-rep-out');
  out.innerHTML = `
    <div class="card">
      <div class="card-title">סיכום ${MN[month]} ${year}</div>
      <div class="list-item" style="border:none;padding:4px 0"><span>פריטי ציוד</span><span style="font-weight:700;margin-right:auto">${rows.length}</span></div>
      <div class="list-item" style="border:none;padding:4px 0"><span>בשימוש החודש</span><span style="font-weight:700;margin-right:auto">${usedCount}</span></div>
      <div class="list-item" style="border:none;padding:4px 0"><span>סה"כ ימי שימוש</span><span style="font-weight:700;margin-right:auto;color:#f59e0b">${totalDays}</span></div>
    </div>
    <div id="eq-rep-list">${listHtml||'<div class="empty"><div class="empty-icon">🚜</div><div class="empty-title">אין ציוד</div></div>'}</div>
    <div class="btn-row">
      <button class="btn btn-ghost btn-sm" id="btn-eq-pdf">📄 ייצוא PDF</button>
      <button class="btn btn-ghost btn-sm" id="btn-eq-csv">📥 ייצוא CSV</button>
    </div>`;
  out.style.display = 'block';

  document.getElementById('btn-eq-pdf').addEventListener('click', () => {
    const tableRows = rows.map((r, i) => `<tr>
      <td>${i+1}</td><td style="text-align:right">${r.name}</td><td>${r.type||'—'}</td>
      <td>${r.daysUsed}</td><td style="text-align:right">${r.sites.join(', ')||'—'}</td>
    </tr>`).join('');
    openPrint(`<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="UTF-8">
      <link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;700;800&display=swap" rel="stylesheet">
      <style>*{font-family:'Heebo',sans-serif;box-sizing:border-box}body{margin:20px;direction:rtl;font-size:12px;background:#fff}
      .biz{color:#888;font-size:12px;text-align:center;margin-bottom:4px}h2{color:#4f46e5;text-align:center;font-size:20px;margin-bottom:4px;font-weight:800}
      .sub{color:#666;text-align:center;font-size:12px;margin-bottom:18px}table{width:100%;border-collapse:collapse}
      th{background:#4f46e5;color:#fff;padding:9px 7px;font-size:11px;text-align:center}
      td{padding:7px;border-bottom:1px solid rgba(99,102,241,.12);font-size:11px;text-align:center;vertical-align:middle}
      tr:nth-child(even) td{background:#f5f3ff}tfoot tr td{background:#4f46e5;color:#fff;font-weight:800;font-size:12px}
      @media print{body{margin:8px}}</style></head><body>
      <div class="biz">${BUSINESS_NAME}</div>
      <h2>דוח שימוש ציוד — ${MN[month]} ${year}</h2>
      <div class="sub">תאריך הפקה: ${new Date().toLocaleDateString('he-IL')}</div>
      <table><thead><tr><th>#</th><th style="text-align:right">ציוד</th><th>סוג</th><th>ימי שימוש</th><th style="text-align:right">אתרים</th></tr></thead>
      <tbody>${tableRows}</tbody>
      <tfoot><tr><td colspan="3" style="text-align:right">סה"כ</td><td>${totalDays}</td><td></td></tr></tfoot>
      </table></body></html>`);
    toast('נפתח חלון הדפסה', 'ok');
  });

  document.getElementById('btn-eq-csv').addEventListener('click', () => {
    exportCSV(['ציוד','סוג','ימי שימוש','אתרים'],
      rows.map(r => [r.name, r.type||'', r.daysUsed, r.sites.join(', ')]),
      `ציוד_${MN[month]}_${year}.csv`);
    toast('קובץ CSV הורד', 'ok');
  });
}

export function renderEquipReport() {
  const el = document.getElementById('gm-content');
  if (!el) return;
  const now = new Date(), cm = now.getMonth()+1, cy = now.getFullYear();
  el.innerHTML = `
    <div class="card">
      <div class="card-title">📊 דוח שימוש ציוד</div>
      <div class="row" style="gap:8px;align-items:flex-end;flex-wrap:wrap">
        <div class="form-group" style="flex:1;min-width:120px"><label class="form-label">חודש</label><select class="form-input" id="eq-rep-month"></select></div>
        <div class="form-group" style="flex:1;min-width:100px"><label class="form-label">שנה</label><select class="form-input" id="eq-rep-year"></select></div>
        <button class="btn btn-primary" id="btn-gen-eq-rep" style="width:auto;padding:10px 18px;margin-bottom:2px">📊 הפק דוח</button>
      </div>
    </div>
    <div id="eq-rep-out" style="display:none"></div>`;
  buildSelectOptions(document.getElementById('eq-rep-month'), MN.slice(1).map((n,i)=>[i+1,n]));
  buildSelectOptions(document.getElementById('eq-rep-year'),  Array.from({length:3},(_,i)=>[cy-i,cy-i]));
  document.getElementById('eq-rep-month').value = cm;
  document.getElementById('eq-rep-year').value  = cy;
  document.getElementById('btn-gen-eq-rep').addEventListener('click', () => {
    renderResults(+document.getElementById('eq-rep-month').value, +document.getElementById('eq-rep-year').value);
  });
}
