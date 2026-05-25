import { HDR, MN, BUSINESS_NAME } from '../config.js';
import { D } from '../state.js';
import { uid, toast, can, openSheet, closeSheet, setBtn, monthPrefix } from '../utils.js';
import { sAppend, sWrite, logAudit } from '../api.js';

export function renderEquipScreen() {
  const el = document.getElementById('equip-scroll');
  if (!el) return;
  el.innerHTML = `<div id="eq-body" style="padding:0 16px 80px"></div>`;
  _renderList();
}

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
  document.getElementById('btn-eq-add').onclick = () => openAddEquip();
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

function _openDetails(id) {
  const e = D.equipment.find(x => x.id === id); if (!e) return;
  const el = document.getElementById('eq-body');
  const now = new Date(), cm = now.getMonth()+1, cy = now.getFullYear();
  const pfx = monthPrefix(cm, cy);
  const entries  = D.logEquip.filter(x => x.eqId === id && x.date?.startsWith(pfx));
  const daysUsed = new Set(entries.map(x => x.date)).size;
  const totalCost = daysUsed * (e.dailyRate || 0);
  const sites = [...new Set(entries.map(x => x.siteId))]
    .map(sid => D.sites.find(s => s.id === sid)?.name || sid).filter(Boolean);

  el.innerHTML = `
    <button class="btn btn-ghost btn-sm mt8" id="eq-back">← חזרה לרשימה</button>
    <div class="card mt12">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
        <div class="avatar av-gold" style="width:52px;height:52px;font-size:24px">🚜</div>
        <div class="li-info">
          <div class="li-name" style="font-size:18px;font-weight:800">${e.name}</div>
          <div class="li-sub">${e.type || ''}</div>
        </div>
        <span class="badge ${e.active==='פעיל'?'b-green':'b-orange'}">${e.active}</span>
      </div>
      ${e.dailyRate > 0 ? `<div class="list-item" style="border:none;padding:4px 0"><span>תעריף יומי</span><span style="font-weight:700;margin-right:auto">${e.dailyRate.toLocaleString('he-IL')} ₪</span></div>` : ''}
      <div class="divider"></div>
      <div class="card-title">שימוש החודש — ${MN[cm]} ${cy}</div>
      <div class="list-item" style="border:none;padding:4px 0"><span>ימי שימוש</span><span style="font-weight:700;margin-right:auto;color:var(--gold)">${daysUsed}</span></div>
      ${totalCost > 0 ? `<div class="list-item" style="border:none;padding:4px 0"><span>עלות</span><span style="font-weight:700;margin-right:auto;color:var(--gold)">${totalCost.toLocaleString('he-IL')} ₪</span></div>` : ''}
      ${sites.length ? `<div class="list-item" style="border:none;padding:4px 0;align-items:flex-start"><span>אתרים</span><span style="font-weight:600;margin-right:auto;font-size:13px">${sites.join(', ')}</span></div>` : ''}
    </div>
    <div class="btn-row mt8">
      <button class="btn btn-ghost fg" id="eq-det-edit">✏️ עריכה</button>
      <button class="btn btn-primary fg" id="eq-det-report">📊 הפק דוח</button>
    </div>`;

  document.getElementById('eq-back').onclick    = () => _renderList();
  document.getElementById('eq-det-edit').onclick = () => _openEdit(id);
  document.getElementById('eq-det-report').onclick = () => {
    const rows = _calcRows(cm, cy).filter(r => r.id === id);
    const td = rows.reduce((s,r) => s+r.daysUsed, 0);
    const tc = rows.reduce((s,r) => s+r.totalCost, 0);
    _exportPDF(rows, cm, cy, td, tc);
  };
}

export function openAddEquip() {
  D.editEquipId = null; D.equipStatus = 'פעיל';
  document.getElementById('equip-sh-title').textContent = '➕ הוספת ציוד';
  document.getElementById('eq-name').value = '';
  document.getElementById('eq-type').value = 'כבד';
  document.getElementById('eq-rate').value = 0;
  selectEquipStatus('פעיל');
  openSheet('sh-equip');
}

function _openEdit(id) {
  const e = D.equipment.find(x => x.id === id); if (!e) return;
  D.editEquipId = id; D.equipStatus = e.active || 'פעיל';
  document.getElementById('equip-sh-title').textContent = '✏️ עריכת ציוד';
  document.getElementById('eq-name').value = e.name;
  document.getElementById('eq-type').value = e.type || 'כבד';
  document.getElementById('eq-rate').value = e.dailyRate || 0;
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

function _calcRows(month, year) {
  const pfx = monthPrefix(month, year);
  return D.equipment.map(eq => {
    const entries  = D.logEquip.filter(e => e.eqId===eq.id && e.date?.startsWith(pfx));
    const daysUsed = new Set(entries.map(e => e.date)).size;
    const dailyRate = eq.dailyRate || 0;
    const sites = [...new Set(entries.map(e => e.siteId))]
      .map(sid => D.sites.find(s => s.id===sid)?.name || sid).filter(Boolean);
    return { id:eq.id, name:eq.name, type:eq.type||'', active:eq.active, dailyRate, daysUsed, totalCost:daysUsed*dailyRate, sites };
  }).sort((a,b) => b.daysUsed - a.daysUsed);
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
