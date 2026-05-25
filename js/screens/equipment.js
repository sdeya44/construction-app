import { HDR, MN, DAYS_HE, BUSINESS_NAME } from '../config.js';
import { D } from '../state.js';
import { uid, toast, can, openSheet, closeSheet, setBtn, monthPrefix, exportCSV } from '../utils.js';
import { sAppend, sWrite, logAudit } from '../api.js';

export function renderEquipScreen() {
  const el = document.getElementById('equip-scroll');
  if (!el) return;
  el.innerHTML = `<div id="eq-body" style="padding:0 16px 80px"></div>`;
  _renderList();
}

// ── LIST ──────────────────────────────────────────────────────────────────────
function _renderList() {
  const el = document.getElementById('eq-body');
  const active = D.equipment.filter(e => e.active === 'פעיל');
  const frozen = D.equipment.filter(e => e.active !== 'פעיל');
  el.innerHTML = [
    `<button class="btn btn-ghost btn-sm mt8" id="btn-all-equip-report" style="width:auto">📊 דוח כל הציוד</button>`,
    active.length ? `<div class="card mt12"><div class="card-title">פעיל (${active.length})</div>${active.map(_eqRow).join('')}</div>` : '',
    frozen.length ? `<div class="card mt12"><div class="card-title">מוקפא (${frozen.length})</div>${frozen.map(_eqRow).join('')}</div>` : '',
    !D.equipment.length ? `<div class="empty mt16"><div class="empty-icon">🚜</div><div class="empty-title">אין ציוד עדיין</div><div class="empty-sub">לחץ ➕ להוספת ציוד</div></div>` : '',
  ].join('');
  document.getElementById('btn-all-equip-report').onclick = _openAllEquipReport;
  document.querySelectorAll('#eq-body .eq-row').forEach(r => { r.onclick = () => _openDetails(r.dataset.id); });
}

function _eqRow(e) {
  return `<div class="list-item clickable eq-row" data-id="${e.id}">
    <div class="avatar av-gold">🚜</div>
    <div class="li-info">
      <div class="li-name">${e.name}</div>
      <div class="li-sub">${[e.type, e.dailyRate>0 ? e.dailyRate.toLocaleString('he-IL')+' ₪/יום' : ''].filter(Boolean).join(' · ')}</div>
    </div>
    <span class="badge ${e.active==='פעיל'?'b-green':'b-orange'}">${e.active}</span>
  </div>`;
}

// ── DETAILS ───────────────────────────────────────────────────────────────────
function _openDetails(id) {
  const eq = D.equipment.find(x => x.id === id); if (!eq) return;
  const el = document.getElementById('eq-body');
  const now = new Date(), cm = now.getMonth()+1, cy = now.getFullYear();
  el.innerHTML = `
    <button class="btn btn-ghost btn-sm mt8" id="eq-back">← חזרה לרשימה</button>
    <div class="card mt12">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
        <div style="min-width:0">
          <div style="font-size:20px;font-weight:800;color:var(--text)">${eq.name}</div>
          <div style="color:var(--muted);font-size:13px;margin-top:4px">${eq.type||''}${eq.dailyRate>0?' · '+eq.dailyRate.toLocaleString('he-IL')+' ₪/יום':''}</div>
        </div>
        <span class="badge ${eq.active==='פעיל'?'b-green':'b-orange'}" style="flex-shrink:0">${eq.active}</span>
      </div>
      <button class="btn btn-ghost fg mt12" id="eq-det-edit">✏️ עריכה</button>
    </div>
    <div class="card mt8">
      <div class="card-title">דוח שימוש חודשי</div>
      <div class="row" style="gap:8px;align-items:flex-end;flex-wrap:wrap">
        <div class="form-group" style="flex:1;min-width:100px"><label class="form-label">חודש</label>
          <select class="form-input" id="eq-r-month">${MN.slice(1).map((n,i)=>`<option value="${i+1}">${n}</option>`).join('')}</select></div>
        <div class="form-group" style="flex:1;min-width:80px"><label class="form-label">שנה</label>
          <select class="form-input" id="eq-r-year">${[cy,cy-1,cy-2].map(y=>`<option value="${y}">${y}</option>`).join('')}</select></div>
        <button class="btn btn-primary" id="btn-eq-gen" style="width:auto;padding:12px 20px;margin-bottom:2px">📊 הפק</button>
      </div>
    </div>
    <div id="eq-r-out"></div>`;
  document.getElementById('eq-back').onclick = _renderList;
  document.getElementById('eq-det-edit').onclick = () => _openEdit(id);
  document.getElementById('eq-r-month').value = cm;
  document.getElementById('eq-r-year').value  = cy;
  document.getElementById('btn-eq-gen').onclick = () =>
    _showEqMonthly(id, eq, +document.getElementById('eq-r-month').value, +document.getElementById('eq-r-year').value);
  _showEqMonthly(id, eq, cm, cy);
}

function _showEqMonthly(eqId, eq, month, year) {
  const pfx      = monthPrefix(month, year);
  const entries  = D.logEquip.filter(e => e.eqId === eqId && e.date?.startsWith(pfx));
  const days     = [...new Set(entries.map(e => e.date))].sort();
  const daysUsed = days.length;
  const dailyRate = eq.dailyRate || 0;
  const totalCost = daysUsed * dailyRate;
  const siteMap  = new Map();
  entries.forEach(e => {
    if (!siteMap.has(e.siteId)) siteMap.set(e.siteId, D.sites.find(s=>s.id===e.siteId)?.name||e.siteId);
  });
  const sites = [...siteMap.values()];

  const dayRows = days.map(date => {
    const e = entries.find(x => x.date === date);
    const siteName = siteMap.get(e?.siteId) || '—';
    const d = new Date(date); const dayHe = DAYS_HE[d.getDay()];
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px">
      <span style="color:var(--muted);direction:ltr;font-family:monospace;min-width:90px">${date}</span>
      <span style="color:var(--muted);min-width:40px;text-align:center">${dayHe}</span>
      <span style="color:var(--text);text-align:right;flex:1;padding-right:4px">${siteName}</span>
    </div>`;
  }).join('');

  document.getElementById('eq-r-out').innerHTML = `
    <div class="card mt8">
      <div class="card-title">סיכום ${MN[month]} ${year}</div>
      <div class="list-item" style="border:none;padding:4px 0"><span>ימי שימוש</span><span style="font-weight:700;margin-right:auto;color:var(--gold)">${daysUsed}</span></div>
      <div class="list-item" style="border:none;padding:4px 0"><span>תעריף יומי</span><span style="font-weight:700;margin-right:auto">${dailyRate?dailyRate.toLocaleString('he-IL')+' ₪':'לא הוגדר'}</span></div>
      ${totalCost>0?`<div class="list-item" style="border:none;padding:6px 0;border-top:1px solid var(--border)"><span style="font-weight:700">סה"כ עלות</span><span style="font-weight:800;margin-right:auto;color:var(--gold);font-size:16px">${totalCost.toLocaleString('he-IL')} ₪</span></div>`:''}
    </div>
    ${daysUsed ? `
    <div class="card mt8">
      <div class="card-title">פירוט ימי שימוש</div>
      ${dayRows}
    </div>` : ''}
    ${!daysUsed?`<div class="empty mt16"><div class="empty-icon">🚜</div><div class="empty-title">לא נעשה שימוש בחודש זה</div></div>`:''}
    ${daysUsed?`<div class="btn-row mt8">
      <button class="btn btn-ghost btn-sm fg" id="btn-eq-pdf">📄 PDF</button>
      <button class="btn btn-ghost btn-sm fg" id="btn-eq-csv">📥 CSV</button>
    </div>`:''}`;

  if (daysUsed) {
    document.getElementById('btn-eq-pdf').onclick = () =>
      _exportPDF([{ id:eqId, name:eq.name, type:eq.type||'', active:eq.active, dailyRate, daysUsed, totalCost, sites }], month, year, daysUsed, totalCost);
    document.getElementById('btn-eq-csv').onclick = () => {
      exportCSV(['תאריך','יום','אתר'], days.map(date => {
        const e = entries.find(x => x.date === date);
        const d = new Date(date);
        return [date, DAYS_HE[d.getDay()], D.sites.find(s=>s.id===e?.siteId)?.name||''];
      }), `${eq.name}_${MN[month]}_${year}.csv`);
      toast('CSV הורד', 'ok');
    };
  }
}

// ── ALL EQUIPMENT REPORT ──────────────────────────────────────────────────────

function _openAllEquipReport() {
  const el = document.getElementById('eq-body');
  const now = new Date(), cm = now.getMonth()+1, cy = now.getFullYear();
  el.innerHTML = `
    <button class="btn btn-ghost btn-sm mt8" id="eq-rpt-back">← חזרה לרשימה</button>
    <div class="card mt12">
      <div class="card-title">דוח שימוש — כל הציוד</div>
      <div class="row" style="gap:8px;align-items:flex-end;flex-wrap:wrap">
        <div class="form-group" style="flex:1;min-width:100px"><label class="form-label">חודש</label>
          <select class="form-input" id="all-eq-r-month">${MN.slice(1).map((n,i)=>`<option value="${i+1}">${n}</option>`).join('')}</select></div>
        <div class="form-group" style="flex:1;min-width:80px"><label class="form-label">שנה</label>
          <select class="form-input" id="all-eq-r-year">${[cy,cy-1,cy-2].map(y=>`<option value="${y}">${y}</option>`).join('')}</select></div>
        <button class="btn btn-primary" id="btn-all-eq-gen" style="width:auto;padding:12px 20px;margin-bottom:2px">📊 הפק</button>
      </div>
    </div>
    <div id="all-eq-r-out"></div>`;
  document.getElementById('eq-rpt-back').onclick = _renderList;
  document.getElementById('all-eq-r-month').value = cm;
  document.getElementById('all-eq-r-year').value  = cy;
  document.getElementById('btn-all-eq-gen').onclick = () =>
    _showAllEquipMonthly(+document.getElementById('all-eq-r-month').value, +document.getElementById('all-eq-r-year').value);
  _showAllEquipMonthly(cm, cy);
}

function _showAllEquipMonthly(month, year) {
  const pfx = monthPrefix(month, year);
  const data = D.equipment.map(eq => {
    const entries  = D.logEquip.filter(e => e.eqId === eq.id && e.date?.startsWith(pfx));
    const daysUsed = new Set(entries.map(e => e.date)).size;
    const dailyRate = eq.dailyRate || 0;
    const totalCost = daysUsed * dailyRate;
    const sites = [...new Set(entries.map(e => e.siteId))]
      .map(sid => D.sites.find(s=>s.id===sid)?.name||sid).filter(Boolean);
    return { id:eq.id, name:eq.name, type:eq.type||'', active:eq.active, dailyRate, daysUsed, totalCost, sites };
  }).filter(r => r.daysUsed > 0).sort((a,b) => b.daysUsed - a.daysUsed);

  const totalDays = data.reduce((s,r) => s + r.daysUsed, 0);
  const grandTotal = data.reduce((s,r) => s + r.totalCost, 0);
  const out = document.getElementById('all-eq-r-out');

  if (!data.length) {
    out.innerHTML = `<div class="empty mt16"><div class="empty-icon">🚜</div><div class="empty-title">לא נעשה שימוש בחודש זה</div></div>`;
    return;
  }

  out.innerHTML = `
    <div class="card mt8">
      <div class="card-title">סיכום ${MN[month]} ${year}</div>
      <div class="list-item" style="border:none;padding:4px 0"><span>פריטים שהופעלו</span><span style="font-weight:700;margin-right:auto">${data.length}</span></div>
      <div class="list-item" style="border:none;padding:4px 0"><span>סה"כ ימי שימוש</span><span style="font-weight:700;margin-right:auto;color:var(--gold)">${totalDays}</span></div>
      ${grandTotal>0?`<div class="list-item" style="border:none;padding:6px 0;border-top:1px solid var(--border)"><span style="font-weight:700">סה"כ עלות</span><span style="font-weight:800;margin-right:auto;color:var(--gold);font-size:16px">${grandTotal.toLocaleString('he-IL')} ₪</span></div>`:''}
    </div>
    <div class="card mt8">
      ${data.map(r => `
        <div class="list-item" style="padding:8px 0">
          <div class="li-info" style="flex:1">
            <div class="li-name">${r.name}</div>
            <div class="li-sub">${r.type}${r.sites.length?' · '+r.sites.join(', '):''}</div>
          </div>
          <div style="text-align:left">
            <div style="font-weight:700;color:var(--gold)">${r.daysUsed} ימים</div>
            ${r.totalCost>0?`<div style="font-size:12px;color:var(--muted)">${r.totalCost.toLocaleString('he-IL')} ₪</div>`:''}
          </div>
        </div>`).join('')}
    </div>
    <div class="btn-row mt8">
      <button class="btn btn-ghost btn-sm fg" id="btn-all-eq-pdf">📄 PDF</button>
      <button class="btn btn-ghost btn-sm fg" id="btn-all-eq-csv">📥 CSV</button>
    </div>`;

  document.getElementById('btn-all-eq-pdf').onclick = () =>
    _exportPDF(data, month, year, totalDays, grandTotal);
  document.getElementById('btn-all-eq-csv').onclick = () => {
    exportCSV(
      ['ציוד','סוג','תעריף יומי','ימי שימוש','סה"כ עלות','אתרים'],
      data.map(r => [r.name, r.type||'', r.dailyRate||'', r.daysUsed, r.totalCost||'', r.sites.join(', ')]),
      `ציוד_${MN[month]}_${year}.csv`
    );
    toast('CSV הורד','ok');
  };
}

// ── ADD / EDIT ─────────────────────────────────────────────────────────────────
export function openAddEquip() {
  D.editEquipId = null; D.equipStatus = 'פעיל';
  document.getElementById('equip-sh-title').textContent = '➕ הוספת ציוד';
  document.getElementById('eq-name').value  = '';
  document.getElementById('eq-type').value  = 'כבד';
  document.getElementById('eq-rate').value  = '';
  selectEquipStatus('פעיל');
  openSheet('sh-equip');
}

function _openEdit(id) {
  const e = D.equipment.find(x => x.id === id); if (!e) return;
  D.editEquipId = id; D.equipStatus = e.active || 'פעיל';
  document.getElementById('equip-sh-title').textContent = '✏️ עריכת ציוד';
  document.getElementById('eq-name').value  = e.name;
  document.getElementById('eq-type').value  = e.type || 'כבד';
  document.getElementById('eq-rate').value  = e.dailyRate || '';
  selectEquipStatus(e.active || 'פעיל');
  openSheet('sh-equip');
}

export function selectEquipStatus(v) {
  D.equipStatus = v;
  document.getElementById('seq-active')?.classList.toggle('active-s', v === 'פעיל');
  document.getElementById('seq-frozen')?.classList.toggle('frozen-s', v !== 'פעיל');
}

export async function saveEquip() {
  if (!can('manage_equipment')) { toast('אין הרשאה', 'err'); return; }
  const name      = document.getElementById('eq-name').value.trim();
  if (!name) { toast('יש להזין שם ציוד', 'err'); return; }
  const type      = document.getElementById('eq-type').value;
  const dailyRate = +(document.getElementById('eq-rate').value) || 0;
  setBtn('btn-save-equip', true, 'שומר...');
  try {
    if (D.editEquipId) {
      const i = D.equipment.findIndex(e => e.id === D.editEquipId);
      D.equipment[i] = { ...D.equipment[i], name, type, active: D.equipStatus, dailyRate };
      await sWrite('Equipment', 'A1', [HDR.Equipment, ...D.equipment.map(e => [e.id,e.name,e.type,e.active,e.notes||'',e.dailyRate||0])]);
      await logAudit('UPDATE', 'Equipment', D.editEquipId, `עדכון ציוד: ${name}`);
      toast('ציוד עודכן ✓', 'ok');
    } else {
      const id = uid();
      await sAppend('Equipment', [id, name, type, D.equipStatus, '', dailyRate]);
      D.equipment.push({ id, name, type, active: D.equipStatus, notes: '', dailyRate });
      await logAudit('CREATE', 'Equipment', id, `הוספת ציוד: ${name}`);
      toast('ציוד נוסף ✓', 'ok');
    }
    closeSheet('sh-equip');
    _renderList();
  } catch(e) { toast('שגיאה: ' + e.message, 'err'); }
  setBtn('btn-save-equip', false, 'שמור ציוד');
}

// ── PDF EXPORT ─────────────────────────────────────────────────────────────────
function _exportPDF(rows, month, year, totalDays, totalCost) {
  const w = window.open('', '_blank');
  if (!w) { toast('אפשר חלונות קופצים', 'err'); return; }
  const activeRows = rows.filter(r => r.daysUsed > 0);
  const tableRows = rows.map((r,i) => `
    <tr>
      <td class="tc muted">${i+1}</td>
      <td class="tname">${r.name}${r.type?`<br><span class="sub-cell">${r.type}</span>`:''}</td>
      <td class="tc mono">${r.dailyRate>0?r.dailyRate.toLocaleString('he-IL')+' ₪':'—'}</td>
      <td class="tc mono bold ${r.daysUsed>0?'gold':''}">${r.daysUsed}</td>
      <td class="tc mono bold ${r.totalCost>0?'green':''}">${r.totalCost>0?r.totalCost.toLocaleString('he-IL')+' ₪':'—'}</td>
      <td class="tc" style="font-size:10px;text-align:right">${r.sites.join(', ')||'—'}</td>
    </tr>`).join('');
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
  table{width:100%;border-collapse:collapse;margin-bottom:20px}
  thead tr{background:#B8922C}
  thead th{color:#fff;padding:10px;font-size:11px;font-weight:700;text-align:center}
  thead th.tleft{text-align:right}
  tbody tr:nth-child(even){background:#FBF9F4}
  td{padding:9px 10px;font-size:12px;border-bottom:1px solid rgba(184,146,44,.10)}
  td.tc{text-align:center} td.tname{text-align:right;font-weight:600;color:#181410}
  td.mono{font-family:'JetBrains Mono',monospace} td.bold{font-weight:700}
  td.green{color:#2A6B47} td.gold{color:#B8922C} td.muted{color:#9A9189;font-size:11px}
  .sub-cell{font-size:10px;color:#9A9189;font-weight:400}
  tfoot tr{background:#B8922C}
  tfoot td{color:#fff;padding:10px;font-weight:800;text-align:center;font-size:13px}
  tfoot td.tname{text-align:right} tfoot td.mono{font-family:'JetBrains Mono',monospace}
  .stats-banner{display:flex;gap:0;border:1.5px solid rgba(184,146,44,.30);border-radius:10px;overflow:hidden;margin-bottom:20px}
  .stat-item{flex:1;padding:14px 10px;text-align:center;background:#FBF6EC;border-left:1px solid rgba(184,146,44,.20)}
  .stat-item:last-child{border-left:none}
  .stat-label{font-size:10px;color:#9A9189;margin-bottom:5px;font-weight:600}
  .stat-value{font-size:22px;font-weight:800;color:#B8922C;font-family:'JetBrains Mono',monospace}
  .stat-value.grn{color:#2A6B47}
  .page-footer{text-align:center;font-size:10px;color:#9A9189;border-top:1px solid #E5E0D8;padding-top:12px;margin-top:4px}
  @media print{body{background:#fff}@page{size:A4 portrait;margin:0}.page{width:auto}}
</style>
</head><body><div class="page">
  <div class="page-header">
    <div class="biz-name">${BUSINESS_NAME}</div>
    <div class="rep-title">דוח עלויות ציוד</div>
    <div class="rep-sub">${MN[month]} ${year}</div>
  </div>
  <div class="page-body">
    <div class="stats-banner">
      <div class="stat-item"><div class="stat-label">סה״כ ציוד</div><div class="stat-value">${rows.length}</div></div>
      <div class="stat-item"><div class="stat-label">ציוד פעיל</div><div class="stat-value">${activeRows.length}</div></div>
      <div class="stat-item"><div class="stat-label">ימי שימוש</div><div class="stat-value">${totalDays}</div></div>
      <div class="stat-item"><div class="stat-label">עלות כוללת</div><div class="stat-value grn" style="font-size:${totalCost>99999?'15':'18'}px">${totalCost>0?totalCost.toLocaleString('he-IL')+' ₪':'—'}</div></div>
    </div>
    <table>
      <thead><tr>
        <th style="width:36px">#</th><th class="tleft">ציוד</th>
        <th>תעריף יומי</th><th>ימי שימוש</th><th>עלות כוללת</th><th class="tleft">אתרים</th>
      </tr></thead>
      <tbody>${tableRows}</tbody>
      <tfoot><tr>
        <td></td><td class="tname">סה״כ</td>
        <td></td><td class="mono">${totalDays}</td>
        <td class="mono">${totalCost>0?totalCost.toLocaleString('he-IL')+' ₪':'—'}</td><td></td>
      </tr></tfoot>
    </table>
    <div class="page-footer">תאריך הפקה: ${new Date().toLocaleDateString('he-IL')} &nbsp;|&nbsp; ${BUSINESS_NAME}</div>
  </div>
</div></body></html>`);
  w.document.close(); setTimeout(() => w.print(), 700);
  toast('נפתח חלון הדפסה', 'ok');
}
