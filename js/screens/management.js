import { HDR } from '../config.js';
import { D } from '../state.js';
import { uid, toast, can, openSheet, closeSheet, setBtn } from '../utils.js';
import { sAppend, sWrite, logAudit } from '../api.js';

export function renderMgmt() {
  const el = document.getElementById('mgmt-content');
  if (D.mgmtTab === 'suppliers') renderSuppliers(el); else renderEquipment(el);
}

export function setMgmtTab(t, el) {
  D.mgmtTab = t;
  document.querySelectorAll('#s-mgmt .tab').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  renderMgmt();
}

// ── SUPPLIERS ─────────────────────────────────────────────────────────────────
function renderSuppliers(el) {
  const active = D.suppliers.filter(s => s.status === 'פעיל');
  const frozen = D.suppliers.filter(s => s.status !== 'פעיל');
  el.innerHTML = [
    active.length ? `<div class="card"><div class="card-title">פעילים (${active.length})</div>${active.map(suppRow).join('')}</div>` : '',
    frozen.length ? `<div class="card"><div class="card-title">מוקפאים (${frozen.length})</div>${frozen.map(suppRow).join('')}</div>` : '',
    !D.suppliers.length ? `<div class="empty"><div class="empty-icon">🚚</div><div class="empty-title">אין ספקים עדיין</div></div>` : '',
  ].join('');
  document.querySelectorAll('#mgmt-content .supp-row').forEach(row => {
    row.onclick = () => openEditSupp(row.dataset.id);
  });
}

function suppRow(s) {
  return `<div class="list-item clickable supp-row" data-id="${s.id}">
    <div class="avatar av-green">🚚</div>
    <div class="li-info"><div class="li-name">${s.name}</div><div class="li-sub">${s.notes||s.phone||'ללא פרטים'}</div></div>
    <span class="badge ${s.status==='פעיל'?'b-green':'b-orange'}">${s.status}</span>
  </div>`;
}

function fillSuppForm(name, phone, notes) {
  document.getElementById('sp-name').value  = name;
  document.getElementById('sp-phone').value = phone;
  document.getElementById('sp-notes').value = notes;
}

export function openAddSupp() {
  D.editSuppId = null; D.suppStatus = 'פעיל';
  document.getElementById('supp-sh-title').textContent = '➕ הוספת ספק';
  fillSuppForm('', '', '');
  selectSuppStatus('פעיל'); openSheet('sh-supp');
}

export function openEditSupp(id) {
  const s = D.suppliers.find(x => x.id === id); if (!s) return;
  D.editSuppId = id; D.suppStatus = s.status || 'פעיל';
  document.getElementById('supp-sh-title').textContent = '✏️ עריכת ספק';
  fillSuppForm(s.name, s.phone||'', s.notes||'');
  selectSuppStatus(s.status || 'פעיל'); openSheet('sh-supp');
}

export function selectSuppStatus(v) {
  D.suppStatus = v;
  document.getElementById('ssp-active')?.classList.toggle('active-s', v==='פעיל');
  document.getElementById('ssp-frozen')?.classList.toggle('frozen-s', v!=='פעיל');
}

export async function saveSupp() {
  if (!can('manage_suppliers')) { toast('אין הרשאה','err'); return; }
  const name  = document.getElementById('sp-name').value.trim();
  if (!name) { toast('יש להזין שם ספק','err'); return; }
  const phone = document.getElementById('sp-phone').value.trim();
  const notes = document.getElementById('sp-notes').value.trim();
  setBtn('btn-save-supp', true, 'שומר...');
  try {
    if (D.editSuppId) {
      const i = D.suppliers.findIndex(s => s.id === D.editSuppId);
      D.suppliers[i] = { ...D.suppliers[i], name, phone, notes, status: D.suppStatus };
      await sWrite('Suppliers','A1',[HDR.Suppliers,...D.suppliers.map(s=>[s.id,s.name,s.phone,s.notes,s.status])]);
      await logAudit('UPDATE','Supplier',D.editSuppId,`עדכון ספק: ${name}`);
      toast('ספק עודכן ✓','ok');
    } else {
      const id = uid();
      await sAppend('Suppliers',[id,name,phone,notes,D.suppStatus]);
      D.suppliers.push({ id, name, phone, notes, status: D.suppStatus });
      await logAudit('CREATE','Supplier',id,`הוספת ספק: ${name}`);
      toast('ספק נוסף ✓','ok');
    }
    closeSheet('sh-supp'); renderMgmt();
  } catch(e) { toast('שגיאה: '+e.message,'err'); }
  setBtn('btn-save-supp', false, 'שמור ספק');
}

// ── EQUIPMENT ─────────────────────────────────────────────────────────────────
function renderEquipment(el) {
  const active = D.equipment.filter(e => e.active === 'פעיל');
  const frozen = D.equipment.filter(e => e.active !== 'פעיל');
  el.innerHTML = [
    active.length ? `<div class="card"><div class="card-title">פעיל (${active.length})</div>${active.map(equipRow).join('')}</div>` : '',
    frozen.length ? `<div class="card"><div class="card-title">מוקפא (${frozen.length})</div>${frozen.map(equipRow).join('')}</div>` : '',
    !D.equipment.length ? `<div class="empty"><div class="empty-icon">🚜</div><div class="empty-title">אין ציוד עדיין</div></div>` : '',
  ].join('');
  document.querySelectorAll('#mgmt-content .equip-row').forEach(row => {
    row.onclick = () => openEditEquip(row.dataset.id);
  });
}

function equipRow(e) {
  return `<div class="list-item clickable equip-row" data-id="${e.id}">
    <div class="avatar av-gold">🚜</div>
    <div class="li-info"><div class="li-name">${e.name}</div><div class="li-sub">${e.type||''}</div></div>
    <span class="badge ${e.active==='פעיל'?'b-green':'b-orange'}">${e.active}</span>
      ${e.dailyRate>0 ? `<span class="badge b-gold" style="margin-right:4px">${e.dailyRate.toLocaleString('he-IL')}₪/יום</span>` : ''}
  </div>`;
}

export function openAddEquip() {
  D.editEquipId = null; D.equipStatus = 'פעיל';
  document.getElementById('equip-sh-title').textContent = '➕ הוספת ציוד';
  document.getElementById('eq-name').value = '';
  document.getElementById('eq-rate').value = 0;
  selectEquipStatus('פעיל'); openSheet('sh-equip');
}

export function openEditEquip(id) {
  const e = D.equipment.find(x => x.id === id); if (!e) return;
  D.editEquipId = id; D.equipStatus = e.active || 'פעיל';
  document.getElementById('equip-sh-title').textContent = '✏️ עריכת ציוד';
  document.getElementById('eq-name').value = e.name;
  document.getElementById('eq-type').value = e.type || 'כבד';
  document.getElementById('eq-rate').value = e.dailyRate || 0;
  selectEquipStatus(e.active || 'פעיל'); openSheet('sh-equip');
}

export function selectEquipStatus(v) {
  D.equipStatus = v;
  document.getElementById('seq-active')?.classList.toggle('active-s', v==='פעיל');
  document.getElementById('seq-frozen')?.classList.toggle('frozen-s', v!=='פעיל');
}

export async function saveEquip() {
  if (!can('manage_equipment')) { toast('אין הרשאה','err'); return; }
  const name = document.getElementById('eq-name').value.trim();
  if (!name) { toast('יש להזין שם ציוד','err'); return; }
  const type = document.getElementById('eq-type').value;
  const dailyRate = +(document.getElementById('eq-rate').value) || 0;
  setBtn('btn-save-equip', true, 'שומר...');
  try {
    if (D.editEquipId) {
      const i = D.equipment.findIndex(e => e.id === D.editEquipId);
      D.equipment[i] = { ...D.equipment[i], name, type, active: D.equipStatus, dailyRate };
      await sWrite('Equipment','A1',[HDR.Equipment,...D.equipment.map(e=>[e.id,e.name,e.type,e.active,e.notes||'',e.dailyRate||0])]);
      await logAudit('UPDATE','Equipment',D.editEquipId,`עדכון ציוד: ${name}`);
      toast('ציוד עודכן ✓','ok');
    } else {
      const id = uid();
      await sAppend('Equipment',[id,name,type,D.equipStatus,'',dailyRate]);
      D.equipment.push({ id, name, type, active: D.equipStatus, notes: '', dailyRate });
      await logAudit('CREATE','Equipment',id,`הוספת ציוד: ${name}`);
      toast('ציוד נוסף ✓','ok');
    }
    closeSheet('sh-equip'); renderMgmt();
  } catch(e) { toast('שגיאה: '+e.message,'err'); }
  setBtn('btn-save-equip', false, 'שמור ציוד');
}

export function mgmtAdd() {
  if (D.mgmtTab === 'suppliers') openAddSupp(); else openAddEquip();
}
