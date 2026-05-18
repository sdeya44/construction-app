import { HDR, BUSINESS_NAME } from '../config.js';
import { D } from '../state.js';
import { uid, toast, can, openSheet, closeSheet, setBtn } from '../utils.js';
import { sWrite, logAudit } from '../api.js';

// ── ENTRY POINT ───────────────────────────────────────────────────────────────
export function renderActivities() {
  const el = document.getElementById('gm-content');
  if (!el) return;
  const active  = D.activities.filter(a => a.active);
  const inactive = D.activities.filter(a => !a.active);
  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <div style="font-size:13px;font-weight:700;color:var(--muted)">פעילויות (${D.activities.length})</div>
      <button class="btn btn-primary btn-sm" id="btn-act-add" style="width:auto;padding:8px 14px;font-size:13px">➕ הוסף</button>
    </div>
    ${!D.activities.length ? `<div class="empty"><div class="empty-icon">⚡</div><div class="empty-title">אין פעילויות עדיין</div></div>` : ''}
    ${active.length ? `
      <div class="card" style="margin-bottom:10px">
        <div class="card-title" style="margin-bottom:8px">פעילויות פעילות (${active.length})</div>
        ${active.map(_actRow).join('')}
      </div>` : ''}
    ${inactive.length ? `
      <div class="card" style="margin-bottom:10px;opacity:.7">
        <div class="card-title" style="margin-bottom:8px">מושבתות (${inactive.length})</div>
        ${inactive.map(_actRow).join('')}
      </div>` : ''}`;

  document.getElementById('btn-act-add').onclick = _openAdd;
  document.querySelectorAll('.act-edit-btn').forEach(btn => btn.onclick = e => { e.stopPropagation(); _openEdit(btn.dataset.id); });
  document.querySelectorAll('.act-toggle-btn').forEach(btn => btn.onclick = e => { e.stopPropagation(); _toggleActive(btn.dataset.id); });
  document.querySelectorAll('.act-del-btn').forEach(btn => btn.onclick = e => { e.stopPropagation(); _deleteAct(btn.dataset.id); });
}

function _actRow(a) {
  const presetBadge = a.isPreset ? `<span class="badge b-blue" style="font-size:9px;margin-right:4px">ברירת מחדל</span>` : '';
  return `<div class="list-item" style="padding:10px 0">
    <div class="avatar av-gold" style="font-size:20px;width:38px;height:38px">${a.emoji||'⚡'}</div>
    <div class="li-info">
      <div class="li-name" style="display:flex;align-items:center;gap:4px">${a.name}${presetBadge}</div>
    </div>
    <div style="display:flex;gap:6px;align-items:center">
      <button class="btn btn-ghost btn-sm act-edit-btn" data-id="${a.id}" style="width:auto;padding:5px 10px;font-size:12px">✏️</button>
      <button class="btn btn-ghost btn-sm act-toggle-btn" data-id="${a.id}" style="width:auto;padding:5px 10px;font-size:12px;color:${a.active?'var(--muted)':'var(--gold)'}">
        ${a.active ? '🔕 השבת' : '✅ הפעל'}
      </button>
      ${!a.isPreset ? `<button class="btn btn-danger btn-sm act-del-btn" data-id="${a.id}" style="width:auto;padding:5px 10px;font-size:12px">🗑</button>` : ''}
    </div>
  </div>`;
}

// ── ADD ───────────────────────────────────────────────────────────────────────
function _openAdd() {
  D.editActId = null;
  document.getElementById('act-sh-title').textContent = '➕ פעילות חדשה';
  document.getElementById('act-name').value  = '';
  document.getElementById('act-emoji').value = '⚡';
  openSheet('sh-act');
}

// ── EDIT ──────────────────────────────────────────────────────────────────────
function _openEdit(id) {
  const a = D.activities.find(x => x.id === id); if (!a) return;
  D.editActId = id;
  document.getElementById('act-sh-title').textContent = '✏️ עריכת פעילות';
  document.getElementById('act-name').value  = a.name;
  document.getElementById('act-emoji').value = a.emoji || '⚡';
  openSheet('sh-act');
}

// ── SAVE (add/edit) ───────────────────────────────────────────────────────────
export async function saveAct() {
  if (!can('manage_equipment')) { toast('אין הרשאה','err'); return; }
  const name  = document.getElementById('act-name').value.trim();
  const emoji = document.getElementById('act-emoji').value.trim() || '⚡';
  if (!name) { toast('יש להזין שם פעילות','err'); return; }

  setBtn('btn-save-act', true, 'שומר...');
  try {
    if (D.editActId) {
      const i = D.activities.findIndex(a => a.id === D.editActId);
      D.activities[i] = { ...D.activities[i], name, emoji };
      await _persistActivities();
      await logAudit('UPDATE','Activity',D.editActId,`עדכון פעילות: ${name}`);
      toast('פעילות עודכנה ✓','ok');
    } else {
      const order = D.activities.length + 1;
      const id = uid();
      D.activities.push({ id, name, emoji, isPreset:false, presetKey:'', order, active:true });
      await _persistActivities();
      await logAudit('CREATE','Activity',id,`פעילות חדשה: ${name}`);
      toast('פעילות נוספה ✓','ok');
    }
    closeSheet('sh-act');
    renderActivities();
  } catch(e) { toast('שגיאה: '+e.message,'err'); }
  setBtn('btn-save-act', false, 'שמור');
}

// ── TOGGLE ACTIVE ─────────────────────────────────────────────────────────────
async function _toggleActive(id) {
  const a = D.activities.find(x => x.id === id); if (!a) return;
  a.active = !a.active;
  try {
    await _persistActivities();
    toast(`${a.name}: ${a.active ? 'הופעל ✓' : 'הושבת ✓'}`, 'ok');
    renderActivities();
  } catch(e) { a.active = !a.active; toast('שגיאה','err'); }
}

// ── DELETE (custom only) ──────────────────────────────────────────────────────
async function _deleteAct(id) {
  const a = D.activities.find(x => x.id === id); if (!a) return;
  if (a.isPreset) { toast('לא ניתן למחוק פעילות ברירת מחדל','err'); return; }
  if (!confirm(`למחוק את הפעילות "${a.name}"?`)) return;
  D.activities = D.activities.filter(x => x.id !== id);
  try {
    await _persistActivities();
    await logAudit('DELETE','Activity',id,`מחיקת פעילות: ${a.name}`);
    toast('פעילות נמחקה ✓','ok');
    renderActivities();
  } catch(e) { toast('שגיאה','err'); }
}

// ── PERSIST ───────────────────────────────────────────────────────────────────
async function _persistActivities() {
  const rows = D.activities.map(a => [
    a.id, a.name, a.emoji||'', a.isPreset?'TRUE':'FALSE',
    a.presetKey||'', a.order||0, a.active?'TRUE':'FALSE'
  ]);
  await sWrite('Activities','A1',[HDR.Activities,...rows]);
}
