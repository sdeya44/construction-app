import { HDR } from '../config.js';
import { D } from '../state.js';
import { uid, toast, can, openSheet, closeSheet, setBtn } from '../utils.js';
import { sAppend, sWrite, logAudit } from '../api.js';

export function renderSuppliersScreen() {
  _render();
}

function _render() {
  const el = document.getElementById('suppliers-scroll');
  if (!el) return;
  const active = D.suppliers.filter(s => s.status === 'פעיל');
  const frozen = D.suppliers.filter(s => s.status !== 'פעיל');
  el.innerHTML = [
    active.length ? `<div class="card" style="margin:12px 16px 0"><div class="card-title">פעילים (${active.length})</div>${active.map(_suppRow).join('')}</div>` : '',
    frozen.length ? `<div class="card" style="margin:12px 16px 0"><div class="card-title">מוקפאים (${frozen.length})</div>${frozen.map(_suppRow).join('')}</div>` : '',
    !D.suppliers.length ? `<div class="empty"><div class="empty-icon">🚚</div><div class="empty-title">אין ספקים עדיין</div><div class="empty-sub">לחץ ➕ להוספת ספק</div></div>` : '',
  ].join('');
  document.querySelectorAll('#suppliers-scroll .supp-row').forEach(row => {
    row.onclick = () => openEditSupp(row.dataset.id);
  });
}

function _suppRow(s) {
  return `<div class="list-item clickable supp-row" data-id="${s.id}">
    <div class="avatar av-green">🚚</div>
    <div class="li-info">
      <div class="li-name">${s.name}</div>
      <div class="li-sub">${s.notes || s.phone || 'ללא פרטים'}</div>
    </div>
    <span class="badge ${s.status==='פעיל'?'b-green':'b-orange'}">${s.status}</span>
  </div>`;
}

function _fillForm(name, phone, notes) {
  document.getElementById('sp-name').value  = name;
  document.getElementById('sp-phone').value = phone;
  document.getElementById('sp-notes').value = notes;
}

export function openAddSupp() {
  D.editSuppId = null; D.suppStatus = 'פעיל';
  document.getElementById('supp-sh-title').textContent = '➕ הוספת ספק';
  _fillForm('', '', '');
  selectSuppStatus('פעיל'); openSheet('sh-supp');
}

export function openEditSupp(id) {
  const s = D.suppliers.find(x => x.id === id); if (!s) return;
  D.editSuppId = id; D.suppStatus = s.status || 'פעיל';
  document.getElementById('supp-sh-title').textContent = '✏️ עריכת ספק';
  _fillForm(s.name, s.phone || '', s.notes || '');
  selectSuppStatus(s.status || 'פעיל'); openSheet('sh-supp');
}

export function selectSuppStatus(v) {
  D.suppStatus = v;
  document.getElementById('ssp-active')?.classList.toggle('active-s', v === 'פעיל');
  document.getElementById('ssp-frozen')?.classList.toggle('frozen-s', v !== 'פעיל');
}

export async function saveSupp() {
  if (!can('manage_suppliers')) { toast('אין הרשאה', 'err'); return; }
  const name  = document.getElementById('sp-name').value.trim();
  if (!name) { toast('יש להזין שם ספק', 'err'); return; }
  const phone = document.getElementById('sp-phone').value.trim();
  const notes = document.getElementById('sp-notes').value.trim();
  setBtn('btn-save-supp', true, 'שומר...');
  try {
    if (D.editSuppId) {
      const i = D.suppliers.findIndex(s => s.id === D.editSuppId);
      D.suppliers[i] = { ...D.suppliers[i], name, phone, notes, status: D.suppStatus };
      await sWrite('Suppliers', 'A1', [HDR.Suppliers, ...D.suppliers.map(s => [s.id, s.name, s.phone, s.notes, s.status])]);
      await logAudit('UPDATE', 'Supplier', D.editSuppId, `עדכון ספק: ${name}`);
      toast('ספק עודכן ✓', 'ok');
    } else {
      const id = uid();
      await sAppend('Suppliers', [id, name, phone, notes, D.suppStatus]);
      D.suppliers.push({ id, name, phone, notes, status: D.suppStatus });
      await logAudit('CREATE', 'Supplier', id, `הוספת ספק: ${name}`);
      toast('ספק נוסף ✓', 'ok');
    }
    closeSheet('sh-supp'); _render();
  } catch(e) { toast('שגיאה: ' + e.message, 'err'); }
  setBtn('btn-save-supp', false, 'שמור ספק');
}
