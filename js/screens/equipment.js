import { HDR, MN, BUSINESS_NAME } from '../config.js';
import { D } from '../state.js';
import { uid, toast, can, openSheet, closeSheet, setBtn, monthPrefix, exportCSV } from '../utils.js';
import { sAppend, sWrite, logAudit } from '../api.js';

let _tab = 'list';

export function renderEquipScreen() {
  const el = document.getElementById('gm-content');
  if (!el) return;
  el.innerHTML = `
    <div class="tabs">
      <button class="tab ${_tab==='list'?'active':''}" id="eq-t-list">📋 רשימה</button>
      <button class="tab ${_tab==='report'?'active':''}" id="eq-t-report">📊 דוח</button>
    </div>
    <div id="eq-body"></div>`;
  document.getElementById('eq-t-list').onclick   = () => { _tab='list';   renderEquipScreen(); };
  document.getElementById('eq-t-report').onclick = () => { _tab='report'; renderEquipScreen(); };
  _tab === 'list' ? _renderList() : _renderReport();
}

// ── LIST ──────────────────────────────────────────────────────────────────────
function _renderList() {
  const el = document.getElementById('eq-body');
  const active = D.equipment.filter(e => e.active === 'פעיל');
  const frozen = D.equipment.filter(e => e.active !== 'פעיל');
  el.innerHTML = [
    `<button class="btn btn-primary mt8" id="btn-eq-add">➕ הוסף ציוד</button>`,
    active.length ? `<div class="card mt12"><div class="card-title">פעיל (${active.length})</div>${active.map(_eqRow).join('')}</div>` : '',
    frozen.length ? `<div class="card mt12"><div class="card-title">מוקפא (${frozen.length})</div>${frozen.map(_eqRow).join('')}</div>` : '',
    !D.equipment.length ? `<div class="empty mt16"><div class="empty-icon">🚜</div><div class="empty-title">אין ציוד עדיין</div><div class="empty-sub">הוסף ציוד ראשון</div></div>` : '',
  ].join('');
  document.getElementById('btn-eq-add').onclick = () => _openAdd();
  document.querySelectorAll('#eq-body .eq-row').forEach(r => { r.onclick = () => _openEdit(r.dataset.id); });
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

function _openAdd() {
  D.editEquipId = null; D.equipStatus = 'פעיל';
  document.getElementById('equip-sh-title').textContent = '➕ הוספת ציוד';
  document.getElementById('eq-name').value  = '';
  document.getElementById('eq-type').value  = 'כבד';
  document.getElementById('eq-rate').value  = 0;
  selectEquipStatus('פעיל');
  openSheet('sh-equip');
}

function _openEdit(id) {
  const e = D.equipment.find(x => x.id === id); if (!e) return;
  D.editEquipId = id; D.equipStatus = e.active || 'פעיל';
  document.getElementById('equip-sh-title').textContent = '✏️ עריכת ציוד';
  document.getElementById('eq-name').value  = e.name;
  document.getElementById('eq-type').value  = e.type || 'כבד';
  document.getElementById('eq-rate').value  = e.dailyRate || 0;
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
    if (_tab === 'list') _renderList();
  } catch(e) { toast('שגיאה: ' + e.message, 'err'); }
  setBtn('btn-save-equip', false, 'שמור ציוד');
}

// ── REPORT ────────────────────────────────────────────────────────────────────
function _renderReport() {
  const el  = document.getElementById('eq-body');
  const now = new Date(), cm = now.getMonth()+1, cy = now.getFullYear();
  el.innerHTML = `
    <div class="card mt8">
      <div class="card-title">דוח שימוש ציוד</div>
      <div class="row" style="gap:8px;align-items:flex-end;flex-wrap:wrap">
        <div class="form-group" style="flex:1;min-width:100px"><label class="form-label">חודש</label>
          <select class="form-input" id="eq-r-month">${MN.slice(1).map((n,i)=>`<option value="${i+1}">${n}</option>`).join('')}</select></div>
        <div class="form-group" style="flex:1;min-width:80px"><label class="form-label">שנה</label>
          <select class="form-input" id="eq-r-year">${[cy,cy-1,cy-2].map(y=>`<option value="${y}">${y}</option>`).join('')}</select></div>
        <button class="btn btn-primary" id="btn-eq-gen" style="width:auto;padding:12px 20px;margin-bottom:2px">📊 הפק</button>
      </div>
    </div>
    <div id="eq-r-out"></div>`;
  document.getElementById('eq-r-month').value = cm;
  document.getElementById('eq-r-year').value  = cy;
  document.getElementById('btn-eq-gen').onclick = () =>
    _showResults(+document.getElementById('eq-r-month').value, +document.getElementById('eq-r-year').value);
  _showResults(cm, cy);
}

function _calcRows(month, year) {
  const pfx = monthPrefix(month, year);
  return D.equipment.map(eq => {
    const entries   = D.logEquip.filter(e => e.eqId===eq.id && e.date?.startsWith(pfx));
    const daysUsed  = new Set(entries.map(e => e.date)).size;
    const dailyRate = eq.dailyRate || 0;
    const sites     = [...new Set(entries.map(e => e.siteId))]
      .map(sid => D.sites.find(s => s.id===sid)?.name || sid).filter(Boolean);
    return { id:eq.id, name:eq.name, type:eq.type||'', active:eq.active, dailyRate, daysUsed, totalCost:daysUsed*dailyRate, sites };
  }).sort((a,b) => b.daysUsed - a.daysUsed);
}

function _showResults(month, year) {
  const rows      = _calcRows(month, year);
  const totalDays = rows.reduce((s,r) => s+r.daysUsed,   0);
  const totalCost = rows.reduce((s,r) => s+r.totalCost,  0);
  const usedCount = rows.filter(r => r.daysUsed > 0).length;

  document.getElementById('eq-r-out').innerHTML = `
    <div class="card mt8">
      <div class="card-title">סיכום ${MN[month]} ${year}</div>
      <div class="list-item" style="border:none;padding:4px 0"><span>פריטי ציוד</span><span style="font-weight:700;margin-right:auto">${rows.length}</span></div>
      <div class="list-item" style="border:none;padding:4px 0"><span>בשימוש החודש</span><span style="font-weight:700;margin-right:auto">${usedCount}</span></div>
      <div class="list-item" style="border:none;padding:4px 0"><span>סה"כ ימי שימוש</span><span style="font-weight:700;margin-right:auto;color:var(--gold)">${totalDays}</span></div>
      ${totalCost>0?`<div class="list-item" style="border:none;padding:4px 0"><span>סה"כ עלות</span><span style="font-weight:700;margin-right:auto;color:var(--gold)">${totalCost.toLocaleString('he-IL')} ₪</span></div>`:''}
    </div>
    ${rows.map(r => `
      <div class="card" style="margin-bottom:8px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
          <div style="display:flex;align-items:center;gap:10px;min-width:0">
            <div class="avatar av-gold">🚜</div>
            <div class="li-info">
              <div class="li-name">${r.name}</div>
              <div class="li-sub" style="display:flex;gap:4px;flex-wrap:wrap">
                ${r.type?`<span class="badge b-blue" style="font-size:10px">${r.type}</span>`:''}
                ${r.dailyRate>0?`<span class="badge b-gold" style="font-size:10px">${r.dailyRate.toLocaleString('he-IL')} ₪/יום</span>`:''}
              </div>
            </div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
            ${r.daysUsed>0?`<span class="badge b-gold">${r.daysUsed} ימים</span>`:'<span class="badge b-gray">0</span>'}
            ${r.dailyRate>0&&r.daysUsed>0?`<span class="badge b-green">${r.totalCost.toLocaleString('he-IL')} ₪</span>`:''}
          </div>
        </div>
        ${r.daysUsed>0?`<div style="margin-top:6px;font-size:12px;color:var(--muted)">📍 ${r.sites.join(', ')}</div>`:`<div class="muted" style="margin-top:6px;font-size:12px">לא נעשה שימוש</div>`}
      </div>`).join('')}
    <div class="btn-row mt8">
      <button class="btn btn-ghost btn-sm fg" id="btn-eq-pdf">📄 PDF</button>
      <button class="btn btn-ghost btn-sm fg" id="btn-eq-csv">📥 CSV</button>
    </div>`;

  document.getElementById('btn-eq-pdf').onclick = () => _exportPDF(rows, month, year, totalDays, totalCost);
  document.getElementById('btn-eq-csv').onclick = () => {
    exportCSV(['ציוד','סוג','תעריף יומי (₪)','ימי שימוש','עלות (₪)','אתרים'],
      rows.map(r => [r.name, r.type||'', r.dailyRate||0, r.daysUsed, r.totalCost, r.sites.join(', ')]),
      `ציוד_${MN[month]}_${year}.csv`);
    toast('CSV הורד', 'ok');
  };
}

function _exportPDF(rows, month, year, totalDays, totalCost) {
  const tableRows = rows.map((r,i) => `<tr>
    <td>${i+1}</td><td style="text-align:right">${r.name}</td><td>${r.type||'—'}</td>
    <td>${r.dailyRate>0?r.dailyRate.toLocaleString('he-IL')+' ₪':'—'}</td>
    <td>${r.daysUsed}</td>
    <td>${r.dailyRate>0&&r.daysUsed>0?r.totalCost.toLocaleString('he-IL')+' ₪':'—'}</td>
    <td style="text-align:right;font-size:10px">${r.sites.join(', ')||'—'}</td>
  </tr>`).join('');
  const w = window.open('', '_blank');
  if (!w) { toast('אפשר חלונות קופצים', 'err'); return; }
  w.document.write(`<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="UTF-8">
  <link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;700;800&display=swap" rel="stylesheet">
  <style>*{font-family:'Heebo',sans-serif;box-sizing:border-box}body{margin:16px;direction:rtl;font-size:12px}
  .biz{color:#B8922C;font-size:13px;font-weight:800;text-align:center;margin-bottom:2px}
  h2{color:#B8922C;text-align:center;font-size:18px;margin-bottom:4px;font-weight:800}
  .sub{color:#726E68;text-align:center;font-size:12px;margin-bottom:16px}
  table{width:100%;border-collapse:collapse}
  th{background:#B8922C;color:#fff;padding:8px 6px;font-size:11px;text-align:center}
  td{padding:7px 6px;border-bottom:1px solid rgba(184,146,44,.12);font-size:11px;text-align:center;vertical-align:top}
  tr:nth-child(even) td{background:#FEFCF5}
  tfoot td{background:#B8922C;color:#fff;font-weight:800}
  @media print{body{margin:8px}}</style></head><body>
  <div class="biz">${BUSINESS_NAME}</div>
  <h2>דוח שימוש ציוד — ${MN[month]} ${year}</h2>
  <div class="sub">הופק: ${new Date().toLocaleDateString('he-IL')}</div>
  <table><thead><tr><th>#</th><th style="text-align:right">ציוד</th><th>סוג</th><th>תעריף/יום</th><th>ימי שימוש</th><th>עלות</th><th style="text-align:right">אתרים</th></tr></thead>
  <tbody>${tableRows}</tbody>
  <tfoot><tr><td colspan="4" style="text-align:right">סה"כ</td><td>${totalDays}</td><td>${totalCost>0?totalCost.toLocaleString('he-IL')+' ₪':''}</td><td></td></tr></tfoot>
  </table></body></html>`);
  w.document.close(); setTimeout(() => w.print(), 700);
  toast('נפתח חלון הדפסה', 'ok');
}
