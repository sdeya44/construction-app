// Calculation sheets (דפי חישוב): measurement entry per BOQ item and the printed sheets.
// Screens and print layouts are ported from the KAYAN execution-accounts app (v3.0.0):
// same columns, shapes, live drawing, substituted formula, ± deduction, N multiplier,
// claimed vs. approved, row status, history, and the report options (cumulative / period,
// concise / detailed, orientation, which items to print, page per item, cards, contract).
import { h, modal, formModal, attempt, confirmBox, toast, dateLabel } from './dom.js';
import { itemCode } from '../engine.js';
import {
  CROSS, shapeDims, itemUnitKind, calcRow, approvedRowValue, approvalBadge, baseVal, rowFormulaText, shapeSVG,
  fn, pct, esc, moneyFmt as money, KIND_LABEL, APPROVAL_STATUS_LABEL,
} from '../meas.js';

const ROW_HIST_LABEL = { created: 'נוצר', corrected: 'תוקן', cancelled: 'בוטל' };
const ROW_STATUS_LABEL = { new: 'חדש', approved: 'מאושר', corrected: 'תוקן', cancelled: 'בוטל' };
const ROW_STATUS_CLASS = { new: 'new', approved: 'ok', corrected: 'chg', cancelled: 'chg' };
const html = (s) => { const d = document.createElement('template'); d.innerHTML = s.trim(); return d.content; };
const r4 = (x) => Number(Number(x).toFixed(4)); // stored values are rounded to 4 decimals — compare like with like
const fullCode = (it) => `${it.struct}.${it.chapter}.${it.sub}.${String(it.num).padStart(4, '0')}`;

function liveRowStatus(m, item) {
  if (m.cancelled) return 'cancelled';
  if (!m.history.length) return 'new';
  return Math.abs(r4(approvedRowValue(m, item)) - m.history.at(-1).value) > 1e-9 ? 'corrected' : 'approved';
}

/** Per-item movement for a bill — the source app's itemMovement(), on this app's data. */
export function itemMovement(api, contract, item, bill, calc) {
  const isDraft = bill.status !== 'approved';
  const curRows = isDraft ? api.measRows(contract.id, item.id).filter((m) => !m.isGroup)
    : (bill.snap?.frozen?.measurements ?? []).filter((r) => r.itemId === item.id);
  const prevSnap = api.prevApproved(contract.id, bill.number);
  const prevRows = (prevSnap?.frozen?.measurements ?? []).filter((r) => r.itemId === item.id);
  const row = calc.rows.find((r) => r.itemId === item.id);
  const unitPrice = Number(row?.price ?? item.price);
  const contractQty = Number(item.qty);
  if (!curRows.length && !prevRows.length) { // item billed directly (no calculation sheet)
    const prevQ = Number(row?.prevQ ?? 0), cur = Number(row?.curQ ?? 0), cum = Number(row?.cumQ ?? 0);
    return { measured: false, previousCumulative: prevQ, addition: cur, correction: 0, currentCumulative: cum, claimedCurrentCumulative: cum, contractQty,
      balance: contractQty - cum, completionPct: contractQty > 0 ? cum / contractQty * 100 : (Math.abs(cum) > 1e-9 ? 100 : 0), unitPrice,
      amount: (row?.cumGross ?? 0) / 100, previousAmount: (row?.prevGross ?? 0) / 100, periodAmount: (row?.periodGross ?? 0) / 100, pendingCount: 0, rows: [] };
  }
  // quantity billed manually before the sheet was opened (carried as an opening balance)
  const opening = item.qsrc === 'meas' && item.meas_opening != null ? Number(item.meas_opening) : 0;
  let previousCumulative = opening, addition = 0, correction = 0, claimedPrevious = opening, claimedAddition = 0, claimedCorrection = 0, pendingCount = 0;
  const seen = new Set();
  for (const r of curRows) {
    seen.add(r.id);
    const curVal = r.cancelled ? 0 : (isDraft ? r4(approvedRowValue(r, item)) : Number(r.value));
    const claimedVal = r.cancelled ? 0 : (isDraft ? r4(calcRow(r, item)) : Number(r.claimedValue ?? r.value));
    if (isDraft && !r.cancelled && r.approval?.status === 'pending') pendingCount++;
    const pr = prevRows.find((x) => x.id === r.id);
    if (pr) {
      const pv = pr.cancelled ? 0 : Number(pr.value); previousCumulative += pv; correction += curVal - pv;
      const cpv = pr.cancelled ? 0 : Number(pr.claimedValue ?? pr.value); claimedPrevious += cpv; claimedCorrection += claimedVal - cpv;
    } else { addition += curVal; claimedAddition += claimedVal; }
  }
  for (const pr of prevRows) if (!seen.has(pr.id)) {
    const pv = pr.cancelled ? 0 : Number(pr.value); previousCumulative += pv; correction -= pv;
    const cpv = pr.cancelled ? 0 : Number(pr.claimedValue ?? pr.value); claimedPrevious += cpv; claimedCorrection -= cpv;
  }
  const currentCumulative = previousCumulative + addition + correction;
  const claimedCurrentCumulative = claimedPrevious + claimedAddition + claimedCorrection;
  const movementRows = curRows.filter((r) => {
    const cv = r.cancelled ? 0 : (isDraft ? r4(approvedRowValue(r, item)) : Number(r.value));
    const pr = prevRows.find((x) => x.id === r.id);
    const pv = pr ? (pr.cancelled ? 0 : Number(pr.value)) : 0;
    return Math.abs(cv - pv) > 1e-9 || (r.cancelled && pr && !pr.cancelled);
  });
  return { measured: true, previousCumulative, addition, correction, currentCumulative, claimedCurrentCumulative, contractQty,
    balance: contractQty - currentCumulative, completionPct: contractQty > 0 ? currentCumulative / contractQty * 100 : (Math.abs(currentCumulative) > 1e-9 ? 100 : 0),
    unitPrice, amount: (row?.cumGross ?? 0) / 100, previousAmount: (row?.prevGross ?? 0) / 100, periodAmount: (row?.periodGross ?? 0) / 100,
    pendingCount, rows: curRows, movementRows, isDraft, opening };
}

// =============================================================================================
//  ENTRY SCREEN
// =============================================================================================
export function measView(ctx, itemId) {
  const api = ctx.api;
  const item = api.item(itemId);
  const contract = api.contract(item.contract_id);
  const useAreas = !!contract.meas_areas;
  const kind = itemUnitKind(item);
  const openBill = api.s.get(`SELECT * FROM bills WHERE contract_id=? AND status!='approved' ORDER BY number DESC LIMIT 1`, [contract.id]);
  const geoLocked = openBill?.status === 'submitted' || contract.status === 'closed';
  let periodOnly = sessionStorage.getItem('meas-period') === '1';
  const root = h('div', { class: 'kea page meas-entry' });

  const movementNow = () => {
    const bill = openBill ? api.bill(openBill.id) : { status: 'draft', number: 1e9, id: 0 };
    const calc = openBill ? api.calc(openBill.id) : { rows: [] };
    return itemMovement(api, contract, item, bill, calc);
  };
  const ctxStatsHTML = (mv) => {
    const claimedDiffers = Math.abs(mv.claimedCurrentCumulative - mv.currentCumulative) > 1e-9;
    return `<div>חוזי<b>${fn(mv.contractQty)}</b></div><div>מצטבר קודם<b>${fn(mv.previousCumulative)}</b></div>
      <div>בתקופה<b>${fn(mv.addition)}</b></div><div>תיקון<b>${fn(mv.correction)}</b></div>
      <div>מצטבר נוכחי (מאושר)<b>${fn(mv.currentCumulative)}</b></div><div>יתרה<b>${fn(mv.balance)}</b></div>
      <div>% ביצוע<b>${pct(mv.completionPct)}</b></div>
      ${claimedDiffers ? `<div>מצטבר נתבע<b style="color:var(--gold)">${fn(mv.claimedCurrentCumulative)}</b></div>` : ''}
      ${mv.pendingCount > 0 ? `<div>ממתין לאישור<b style="color:var(--gold)">${mv.pendingCount}</b></div>` : ''}`;
  };
  const headers = () => {
    const hd = ['#', 'תיאור'];
    if (useAreas) hd.push('אזור');
    if (kind === 'area' || kind === 'volume') hd.push('צורה');
    hd.push('שרטוט');
    if (kind === 'length') hd.push('אורך'); else if (kind === 'count') hd.push('כמות'); else hd.push('מידה 1', 'מידה 2', 'מידה 3');
    if (kind === 'volume') hd.push('עובי / אורך');
    hd.push('N', 'נוסחה', '±', 'נתבע', 'אישור', 'סטטוס', 'הערות', '');
    return hd;
  };
  const formulaHTML = (m) => {
    const warn = kind === 'volume' && !baseVal(m, kind).complete ? '<span class="ru warn">חסר עובי/אורך</span>' : '';
    return `${esc(rowFormulaText(m, kind))}${warn}`;
  };
  const save = (id, patch) => attempt(() => api.saveMeas(id, patch));

  function rowEl(m, n) {
    const lockedIn = api.measLockedIn(m);
    const ro = geoLocked || m.cancelled || lockedIn ? 'disabled' : '';
    if (m.isGroup) {
      const span = headers().length - 3;
      const tr = html(`<tr class="grp-row" data-row-id="${m.id}" style="background:#F0F4F9"><td colspan="2"><input value="${esc(m.groupLabel)}" style="font-weight:700;color:var(--navy)" ${ro}></td>
        <td colspan="${span}"></td><td><button class="icon-btn del" title="מחיקה">🗑</button></td></tr>`).firstChild;
      tr.querySelector('input').addEventListener('change', (e) => save(m.id, { groupLabel: e.target.value }));
      tr.querySelector('button').onclick = async () => { if (await confirmBox('מחיקת קבוצה', 'למחוק את הקבוצה?', { danger: true })) attempt(() => { api.deleteMeas(m.id); ctx.refresh(); }); };
      return tr;
    }
    const v = calcRow(m, item);
    const status = liveRowStatus(m, item);
    const b = approvalBadge(m);
    let cells = `<td>${n}</td><td class="col-desc"><textarea class="desc-in" rows="1" data-k="desc" ${ro}>${esc(m.desc)}</textarea></td>`;
    if (useAreas) cells += `<td><input data-k="area" value="${esc(m.area)}" style="min-width:70px" ${ro}></td>`;
    if (kind === 'area' || kind === 'volume') cells += `<td><select data-k="shape" ${ro}>${Object.keys(CROSS).map((s) => `<option ${m.shape === s ? 'selected' : ''}>${s}</option>`).join('')}</select></td>`;
    cells += `<td class="shape-cell">${shapeSVG(m.shape, m.d1, m.d2, m.d3, m.sign === -1, false, m.t, kind)}</td>`;
    if (kind === 'length') cells += `<td class="col-dim"><input class="dim-in" placeholder="אורך" data-k="d1" value="${esc(m.d1)}" ${ro}></td>`;
    else if (kind === 'count') cells += `<td class="col-dim"><input class="dim-in" placeholder="כמות" data-k="d1" value="${esc(m.d1)}" ${ro}></td>`;
    else { const dims = shapeDims(m.shape); for (let i = 0; i < 3; i++) cells += dims[i] ? `<td class="col-dim"><input class="dim-in" placeholder="${esc(dims[i])}" data-k="d${i + 1}" value="${esc(m['d' + (i + 1)])}" ${ro}></td>` : '<td class="col-dim"></td>'; }
    if (kind === 'volume') cells += `<td class="col-dim thick-on"><input class="dim-in" placeholder="${m.shape === 'שטח מיוחד' ? 'אורך' : 'עובי'}" data-k="t" value="${esc(m.t)}" ${ro}></td>`;
    cells += `<td style="max-width:52px"><input data-k="qty" value="${esc(m.qty)}" placeholder="1" ${ro}></td>`;
    cells += `<td class="formula">${formulaHTML(m)}</td>`;
    cells += `<td><span class="sign-pill ${m.sign === -1 ? 'n' : 'p'}" title="תוספת / הפחתה">${m.sign === -1 ? '－' : '＋'}</span></td>`;
    cells += `<td class="res ${v < 0 ? 'n' : 'p'}">${fn(v)}</td>`;
    cells += `<td><button class="stat ${b.cls} ap-btn" style="border:none;cursor:${lockedIn ? 'default' : 'pointer'}" title="${lockedIn ? 'ההחלטה אושרה בחשבון ונעולה' : 'קביעת סטטוס אישור'}" ${lockedIn ? 'disabled' : ''}>${esc(b.label)}</button></td>`;
    cells += `<td>${lockedIn ? `<span class="stat locked" title="אושרה בחשבון ${lockedIn} — לא ניתנת לשינוי">🔒 אושר בח׳ ${lockedIn}</span>` : `<span class="stat ${ROW_STATUS_CLASS[status]}">${ROW_STATUS_LABEL[status]}</span>`}</td>`;
    cells += `<td><input data-k="notes" value="${esc(m.notes)}" style="min-width:80px" ${geoLocked || m.cancelled ? 'disabled' : ''}></td>`;
    cells += `<td><span class="actions" style="display:flex;gap:3px;justify-content:center">${m.cancelled
      ? '<button class="icon-btn act-restore" title="שחזור">↺</button><button class="icon-btn act-hist" title="היסטוריה">🕓</button>'
      : `<button class="icon-btn act-dup" title="שכפול">⧉</button><button class="icon-btn act-hist" title="היסטוריה">🕓</button><button class="icon-btn act-copy" title="העתק לסעיף אחר">⇥</button>${lockedIn
        ? '<button class="icon-btn act-fix" title="תיקון שורה שאושרה (נשמרת היסטוריה)">✎</button>' : '<button class="icon-btn del act-del" title="מחיקה">🗑</button>'}`}</span></td>`;
    const tr = html(`<tr data-row-id="${m.id}" class="${m.cancelled ? 'cancelled-row' : ''} ${m.sign === -1 ? 'ded-row' : ''}">${cells}</tr>`).firstChild;
    const repaint = (nm) => { tr.replaceWith(rowEl(nm, n)); stats(); };
    tr.querySelectorAll('[data-k]').forEach((el) => {
      const k = el.dataset.k;
      if (k === 'shape') { el.addEventListener('change', () => { const nm = save(m.id, { shape: el.value }); if (nm) repaint(nm); }); return; }
      el.addEventListener('input', () => {
        if (['desc', 'notes', 'area'].includes(k)) return;
        const tmp = { ...m, [k]: el.value }; const val = calcRow(tmp, item); m[k] = el.value;
        tr.querySelector('.formula').innerHTML = formulaHTML(tmp);
        const res = tr.querySelector('.res'); res.textContent = fn(val); res.className = `res ${val < 0 ? 'n' : 'p'}`;
        tr.querySelector('.shape-cell').innerHTML = shapeSVG(tmp.shape, tmp.d1, tmp.d2, tmp.d3, tmp.sign === -1, false, tmp.t, kind);
      });
      // save on change and patch only this row's status cells — never re-render the row, so typing
      // continues uninterrupted in the next field (same behaviour as the source app's liveUpdate)
      el.addEventListener('change', () => {
        const nm = save(m.id, { [k]: el.value });
        if (!nm) { el.value = m[k]; return; }
        Object.assign(m, nm);
        const st = liveRowStatus(m, item), bd = approvalBadge(m);
        const stEl = tr.querySelector('td .stat:not(.ap-btn)'); if (stEl) { stEl.className = `stat ${ROW_STATUS_CLASS[st]}`; stEl.textContent = ROW_STATUS_LABEL[st]; }
        const ap = tr.querySelector('.ap-btn'); ap.className = `stat ${bd.cls} ap-btn`; ap.textContent = bd.label;
        stats();
      });
    });
    tr.querySelector('.sign-pill').onclick = () => { if (geoLocked) return toast('החשבון הוגש — לא ניתן לשנות מדידות', 'err'); if (lockedIn) return toast(`השורה אושרה בחשבון ${lockedIn} — לתיקון לחץ ✎`, 'err'); const nm = save(m.id, { sign: m.sign === -1 ? 1 : -1 }); if (nm) repaint(nm); };
    tr.querySelector('.ap-btn').onclick = () => { if (!lockedIn) approvalDialog(m); };
    tr.querySelector('.act-fix')?.addEventListener('click', () => formModal(`תיקון שורה שאושרה בחשבון ${lockedIn}`, [
      { name: 'reason', label: 'סיבת התיקון', type: 'textarea', span: true, required: true },
    ], (v) => { const nid = api.correctMeas(m.id, v.reason); toast('נוצרה שורת תיקון — ערוך בה את המידות'); ctx._measFocusRow = nid; ctx.refresh(); }, {
      submit: 'יצירת שורת תיקון',
      intro: h('p', { class: 'muted' }, 'כמות שאושרה אינה משתנה. השורה המקורית תסומן כמבוטלת (נשארת בהיסטוריה), ותיווצר שורה זהה שאפשר לערוך. בחשבון הבא ההפרש יופיע כתיקון גלוי, עם הסיבה.') }));
    tr.querySelector('.act-dup')?.addEventListener('click', () => attempt(() => { api.duplicateMeas(m.id); ctx.refresh(); }));
    tr.querySelector('.act-hist')?.addEventListener('click', () => historyDialog(m));
    tr.querySelector('.act-copy')?.addEventListener('click', () => copyDialog([m.id]));
    tr.querySelector('.act-restore')?.addEventListener('click', () => attempt(() => { api.restoreMeas(m.id); ctx.refresh(); }));
    tr.querySelector('.act-del')?.addEventListener('click', async () => {
      const msg = m.history.length ? 'לשורה זו יש היסטוריית אישור בחשבון מאושר — לא ניתן למחוק לצמיתות. לסמן כמבוטלת?' : 'למחוק את שורת המדידה?';
      if (await confirmBox('מחיקת שורה', msg, { danger: true, ok: m.history.length ? 'סימון כמבוטלת' : 'מחיקה' })) attempt(() => { api.deleteMeas(m.id); ctx.refresh(); });
    });
    // keyboard: Enter = next field, new row at the end; ↑↓ move between fields
    return tr;
  }

  function approvalDialog(m) {
    const claimed = calcRow(m, item);
    const status = m.approval ? m.approval.status : 'approved';
    const value = m.approval?.status === 'reduced' ? m.approval.value : claimed;
    formModal('קביעת סטטוס אישור', [
      { name: 'status', label: 'סטטוס', type: 'select', value: status, options: [['approved', 'מאושר כמוגש'], ['reduced', 'הפחתה'], ['rejected', 'דחייה'], ['pending', 'ממתין לאישור (טרם הוכרע)']] },
      { name: 'value', label: 'כמות מאושרת (בהפחתה)', value: String(value), numeric: true },
      { name: 'note', label: 'הערת מפקח', type: 'textarea', value: m.approval?.note ?? '', span: true },
    ], (v) => { api.setMeasApproval(m.id, v); toast('סטטוס האישור נשמר'); ctx.refresh(); }, { intro: h('p', { class: 'muted' }, `${m.desc || 'שורת מדידה'} — נתבע: ${fn(claimed)} ${item.unit}`) });
  }
  function historyDialog(m) {
    const body = m.history.length ? m.history.map((hh) => {
      const differs = hh.claimedValue != null && Math.abs(hh.claimedValue - hh.value) > 1e-9;
      return h('div', { class: 'alert info', style: { marginBottom: '6px' } }, h('b', {}, `חשבון ${hh.accountNumber}`), ` — ${ROW_HIST_LABEL[hh.action]} · ${dateLabel(hh.date)}`, h('br'),
        hh.action === 'created' ? `אושר: ${fn(hh.value)}` : `${fn(hh.prevValue)} ← אושר: ${fn(hh.value)}`, ` ${item.unit}`,
        differs ? h('div', {}, `נתבע: ${fn(hh.claimedValue)} ${item.unit} (${APPROVAL_STATUS_LABEL[hh.approvalStatus] || 'הופחת'})`) : null,
        hh.approvalNote ? h('div', { class: 'muted' }, `הערה: ${hh.approvalNote}`) : null);
    }) : h('div', { class: 'empty' }, 'טרם אושרה בחשבון כלשהו');
    modal(`היסטוריית שורה — ${m.desc || ''}`, body);
  }
  function copyDialog(ids) {
    const items = api.items(contract.id).filter((i) => i.kind !== 'note');
    formModal('העתקה לסעיף אחר', [{ name: 'target', label: 'סעיף יעד', type: 'select', options: items.map((i) => [i.id, `${fullCode(i)} — ${i.description.slice(0, 60)}`]), span: true }],
      (v) => { api.copyMeas(ids, Number(v.target)); toast(`${ids.length} שורות הועתקו`); ctx.refresh(); });
  }

  const statsHost = h('div', { class: 'ic-stats' });
  const sumHost = h('div', { class: 'r' });
  function stats() { const mv = movementNow(); statsHost.innerHTML = ctxStatsHTML(mv); sumHost.innerHTML = `${fn(mv.currentCumulative)} <span class="u">${esc(item.unit)}</span>`; }

  const tbody = h('tbody');
  const draw = () => {
    let rows = api.measRows(contract.id, item.id);
    if (periodOnly && openBill) { const mv = movementNow(); const moved = new Set((mv.movementRows ?? []).map((r) => r.id)); rows = rows.filter((m) => m.isGroup || moved.has(m.id)); }
    tbody.replaceChildren();
    const hd = headers();
    if (!rows.length) { tbody.append(html(`<tr><td colspan="${hd.length}" style="padding:24px"><div class="empty"><b>אין שורות מדידה</b>הוסף שורת מדידה — הכמות תעבור אוטומטית לחשבון</div></td></tr>`)); return; }
    if (useAreas) {
      const idx = new Map(rows.map((m, i) => [m, i]));
      const key = (m) => (m.area || '').trim() || '￿';
      const sorted = rows.slice().sort((a, b) => key(a).localeCompare(key(b), 'he') || idx.get(a) - idx.get(b));
      let cur, bucket = [], n = 0;
      const flush = () => {
        if (!bucket.length) return;
        const total = bucket.filter((m) => !m.isGroup && !m.cancelled).reduce((s, m) => s + calcRow(m, item), 0);
        tbody.append(html(`<tr class="grp-row"><td colspan="${hd.length}" style="text-align:right;background:#F0EAD8;color:var(--gold-dk);font-weight:700">📍 ${esc(cur || 'ללא אזור')}</td></tr>`));
        for (const m of bucket) tbody.append(rowEl(m, ++n));
        tbody.append(html(`<tr class="grp-row"><td colspan="${hd.length}" style="text-align:left;direction:ltr;font-weight:800;color:var(--navy)">סה"כ ${esc(cur || 'ללא אזור')}: ${fn(total)} ${esc(item.unit)}</td></tr>`));
        bucket = [];
      };
      for (const m of sorted) { const a = key(m) === '￿' ? '' : key(m); if (a !== cur) { flush(); cur = a; } bucket.push(m); }
      flush();
    } else rows.forEach((m, i) => tbody.append(rowEl(m, i + 1)));
  };
  draw(); stats();

  const table = h('table', { id: 'meas-table' }, h('thead', {}, h('tr', {}, headers().map((x) => h('th', {}, x)))), tbody);
  table.addEventListener('keydown', (e) => {
    const els = [...table.querySelectorAll('input:not([disabled]),select:not([disabled]),textarea:not([disabled])')];
    const i = els.indexOf(e.target);
    if (i < 0) return;
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); e.target.dispatchEvent(new Event('change')); if (i === els.length - 1) addRow(); else els[i + 1].focus(); }
    else if (e.key === 'ArrowDown' && e.target.tagName !== 'SELECT') { e.preventDefault(); els[Math.min(i + 1, els.length - 1)].focus(); }
    else if (e.key === 'ArrowUp' && e.target.tagName !== 'SELECT') { e.preventDefault(); els[Math.max(i - 1, 0)].focus(); }
  });
  table.addEventListener('focusin', (e) => { if (e.target.select && e.target.tagName === 'INPUT') e.target.select(); });
  const addRow = () => { if (attempt(() => api.addMeas(contract.id, item.id)) !== undefined) { ctx._measFocusLast = true; ctx.refresh(); } };

  const items = api.items(contract.id).filter((i) => i.kind !== 'note');
  const counts = new Map(api.s.all('SELECT item_id, COUNT(*) n FROM measurements WHERE contract_id=? AND is_group=0 AND cancelled=0 GROUP BY item_id', [contract.id]).map((r) => [r.item_id, r.n]));
  const sel = h('select', { class: 'sel-sec', onchange: (e) => ctx.go(`m/${e.target.value}`) }, items.map((i) => h('option', { value: i.id, selected: i.id === item.id }, `${fullCode(i)} — ${i.description.slice(0, 70) || 'ללא תיאור'}${counts.get(i.id) ? `  📐${counts.get(i.id)}` : ''}`)));
  const srcSel = h('select', { title: 'מאיפה מגיעה הכמות לחשבון', onchange: (e) => attempt(() => { api.setQtySource(item.id, e.target.value); ctx.refresh(); }, e.target.value === 'meas' ? 'הכמות לחשבון תחושב מדף החישוב' : 'הכמות לחשבון תוקלד ידנית בחשבון') },
    h('option', { value: 'meas', selected: item.qsrc === 'meas' }, 'מקור כמות: דף חישוב'), h('option', { value: 'manual', selected: item.qsrc !== 'meas' }, 'מקור כמות: הקלדה בחשבון'));
  root.append(...[
    h('div', { class: 'meas-tools no-print' }, sel, srcSel,
      h('label', { class: 'field check' }, h('input', { type: 'checkbox', checked: periodOnly, onchange: (e) => { sessionStorage.setItem('meas-period', e.target.checked ? '1' : '0'); ctx.refresh(); } }), h('span', {}, 'רק שינויים בחשבון הפתוח')),
      h('label', { class: 'field check' }, h('input', { type: 'checkbox', checked: useAreas, onchange: (e) => attempt(() => { api.saveContract({ ...contract, meas_areas: e.target.checked }); ctx.refresh(); }) }), h('span', {}, 'קיבוץ לפי אזור')),
      h('div', { style: { flex: 1 } }),
      h('button', { onclick: () => ctx.go(`c/${contract.id}`) }, 'כתב כמויות'),
      openBill ? h('button', { onclick: () => ctx.go(`b/${openBill.id}`) }, `חשבון ${openBill.number}`) : null,
      h('button', { class: 'primary', onclick: () => { const b = openBill ?? api.s.get(`SELECT * FROM bills WHERE contract_id=? ORDER BY number DESC LIMIT 1`, [contract.id]); if (!b) return toast('אין חשבון — פתח חשבון כדי להדפיס דף חישוב', 'err'); ctx.go(`b/${b.id}/sheets?item=${item.id}`); } }, '🖨 דף חישוב')),
    h('div', { class: 'item-context' }, h('div', {}, h('div', { class: 'ic-code' }, fullCode(item)), h('div', { class: 'ic-name' }, item.description)), statsHost),
    geoLocked ? h('div', { class: 'alert' }, `חשבון ${openBill?.number ?? ''} הוגש — ניתן לקבוע סטטוס אישור לשורות, אך לא לשנות מידות. להחזרה להכנה עבור לחשבון.`) : null,
    item.qsrc !== 'meas' ? h('div', { class: 'alert' }, 'מקור הכמות של סעיף זה הוא הקלדה בחשבון — שורות המדידה כאן אינן נכנסות לחשבון. לשינוי בחר "מקור כמות: דף חישוב".') : null,
    item.qsrc === 'meas' && item.meas_opening != null ? h('div', { class: 'alert info' }, `יתרת פתיחה: ${fn(Number(item.meas_opening), 4)} ${item.unit} — כמות שחויבה ידנית לפני פתיחת דף החישוב. היא נכללת במצטבר, כך שהמצטבר לא יורד כשמוסיפים מדידות.`) : null,
    html(`<div class="formula-hint">⌨ <span class="kbd">Enter</span> שדה הבא / שורה חדשה בסוף &nbsp; <span class="kbd">↑↓</span> ניווט &nbsp; <b>יחידת הסעיף: ${esc(item.unit)} (${KIND_LABEL[kind]})</b> — רק צורות וחישובים תואמים ליחידה זו זמינים</div>`),
    h('div', { class: 'tbl-wrap', style: { overflow: 'auto', background: '#fff', border: '1px solid var(--line)', borderRadius: '10px' } }, table),
    h('div', { class: 'boq-actions-row', style: { marginTop: '10px' } },
      h('button', { class: 'primary', disabled: geoLocked, onclick: addRow }, '＋ שורת מדידה'),
      h('button', { disabled: geoLocked, onclick: () => attempt(() => { api.addMeas(contract.id, item.id, { isGroup: true }); ctx.refresh(); }) }, '＋ קבוצה')),
    h('div', { class: 'sec-sum' }, h('div', { class: 'l' }, h('span', { class: 'code' }, fullCode(item)), ` — ${item.description.slice(0, 90)}`), sumHost)].filter(Boolean));
  if (ctx._measFocusRow) { const id = ctx._measFocusRow; ctx._measFocusRow = null; setTimeout(() => table.querySelector(`tr[data-row-id="${id}"] input.dim-in`)?.focus(), 30); }
  if (ctx._measFocusLast) { ctx._measFocusLast = false; setTimeout(() => { const rows = table.querySelectorAll('tbody tr[data-row-id]'); rows[rows.length - 1]?.querySelector('input,select,textarea')?.focus(); }, 30); }
  return root;
}

// =============================================================================================
//  PRINTED CALCULATION SHEETS
// =============================================================================================
const opt = (k, d) => { try { return sessionStorage.getItem(`sheets-${k}`) ?? d; } catch { return d; } };
const setOpt = (k, v) => { try { sessionStorage.setItem(`sheets-${k}`, String(v)); } catch { /* private mode */ } };

export function sheetsView(ctx, billId, itemParam) {
  const api = ctx.api;
  const bill = api.bill(billId);
  const contract = api.contract(bill.contract_id);
  const project = api.project(contract.project_id);
  const co = api.company();
  const calc = api.calc(billId);
  const S = {
    mode: opt('mode', 'cumulative'), layout: opt('layout', 'detailed'), orientation: opt('orientation', 'landscape'), itemFilter: opt('filter', 'withQty'),
    printPerPage: opt('perpage', 'false') === 'true', showCards: opt('cards', 'true') === 'true', showContract: opt('contract', 'true') === 'true',
  };
  const sheetItemId = itemParam ? Number(itemParam) : null;
  const items = api.items(contract.id).filter((i) => i.kind !== 'note' && (i.kind === 'contract' || i.change_status === 'approved'));
  const mvCache = new Map();
  const mv = (it) => { if (!mvCache.has(it.id)) mvCache.set(it.id, itemMovement(api, contract, it, bill, calc)); return mvCache.get(it.id); };
  const secs = new Map(api.sections(contract.id).map((s) => [s.code, s.name]));
  const accNo = String(bill.doc?.displayNumber || bill.number).padStart(3, '0');
  const executor = contract.kind === 'sub' ? contract.party : co.name;
  const client = contract.kind === 'sub' ? co.name : contract.party;

  const reportClass = () => (S.orientation === 'portrait' ? 'report report-portrait' : S.layout === 'detailed' ? 'report' : 'report report-wide');
  const logoSrc = co.logo || 'assets/kayan-logo.jpg';
  const logoMode = co.logo_mode || 'wide';
  const logoHTML = () => {
    if (logoMode === 'wide') return `<div class="rlogo-band"><img src="${esc(logoSrc)}" class="logo-wide" alt="לוגו"></div>`;
    const details = esc([co.address, co.phone, co.vat_id && `עוסק מורשה: ${co.vat_id}`].filter(Boolean).join(' · '));
    return `<div class="rlogo"><img src="${esc(logoSrc)}" class="logo-corner" alt="לוגו"><div class="rbrand">${esc(co.name)}${details ? `<small>${details}</small>` : ''}</div></div>`;
  };
  const headerHTML = (title, sub) => {
    const wide = logoMode === 'wide';
    return `<div class="rhdr ${wide ? 'rhdr-wide' : ''}">${wide ? logoHTML() : ''}${wide ? '' : logoHTML()}
      <div class="rttl">${client ? `<div class="rclient">${esc(client)}</div>` : ''}<h1>${esc(title)}</h1><div class="goldline"></div><div class="sub">${esc(sub || '')}</div></div>
      <div class="rmeta"><div style="font-size:13px">${esc([project.name, project.location].filter(Boolean).join(' — ') || '—')}</div>
        ${contract.number ? `<div>חוזה ${esc(contract.number)}</div>` : ''}${executor ? `<div>${esc(executor)}</div>` : ''}
        <div style="margin-top:6px;font-weight:500">${dateLabel(bill.doc?.date || bill.created_at)}</div></div></div>`;
  };
  const caps = (it) => ({ b: `${it.struct}${secs.get(it.struct) ? ' ' + esc(secs.get(it.struct)) : ''}`,
    c: `${it.struct}.${it.chapter}${secs.get(`${it.struct}.${it.chapter}`) ? ' ' + esc(secs.get(`${it.struct}.${it.chapter}`)) : ''}`,
    s: `${it.struct}.${it.chapter}.${it.sub}${secs.get(`${it.struct}.${it.chapter}.${it.sub}`) ? ' ' + esc(secs.get(`${it.struct}.${it.chapter}.${it.sub}`)) : ''}` });
  const subtotalRow = (amount, cap) => `<tr class="rgrp-tot"><td colspan="9">סה"כ ${cap}</td><td class="num">${money(amount)}</td></tr>`;

  function groupedTableHTML(list) {
    if (!list.length) return '<div class="empty"><div class="t">אין סעיפים להצגה</div></div>';
    let curB = null, curC = null, curS = null, bCap = '', cCap = '', sCap = '', bT = 0, cT = 0, sT = 0, grand = 0, rows = '';
    const cS = () => { if (curS !== null) rows += subtotalRow(sT, sCap); }, cC = () => { if (curC !== null) rows += subtotalRow(cT, cCap); }, cB = () => { if (curB !== null) rows += subtotalRow(bT, bCap); };
    for (const it of list) {
      const k = caps(it);
      if (it.struct !== curB) { cS(); cC(); cB(); curB = it.struct; curC = null; curS = null; bT = 0; bCap = k.b; rows += `<tr class="rgrp-b"><td colspan="10">מבנה ${bCap}</td></tr>`; }
      if (it.chapter !== curC) { cS(); cC(); curC = it.chapter; curS = null; cT = 0; cCap = k.c; rows += `<tr class="rgrp-c"><td colspan="10">פרק ${cCap}</td></tr>`; }
      if (it.sub !== curS) { cS(); curS = it.sub; sT = 0; sCap = k.s; rows += `<tr class="rgrp-s"><td colspan="10">תת פרק ${sCap}</td></tr>`; }
      const m = mv(it);
      sT += m.amount; cT += m.amount; bT += m.amount; grand += m.amount;
      rows += `<tr><td class="rcode">${esc(fullCode(it))}</td><td class="rname">${esc(it.description)}</td><td>${esc(it.unit)}</td>
        <td class="num">${fn(m.contractQty)}</td><td class="num">${pct(m.completionPct)}</td><td class="num">${fn(m.previousCumulative)}</td>
        <td class="num">${fn(m.addition + m.correction)}</td><td class="num" style="font-weight:700">${fn(m.currentCumulative)}</td>
        <td class="num">${money(m.unitPrice)}</td><td class="num">${money(m.amount)}</td></tr>`;
    }
    cS(); cC(); cB();
    rows += `<tr class="rgrp-grand"><td colspan="9">סה"כ כללי</td><td class="num">${money(grand)}</td></tr>`;
    return `<div class="tbl-wrap"><table class="rtbl rgrouped"><thead><tr>
      <th style="width:80px">סעיף</th><th>תיאור</th><th style="width:45px">יחידה</th><th style="width:65px">כמות חוזה</th><th style="width:55px">% ביצוע</th>
      <th style="width:70px">מצטבר קודם</th><th style="width:70px">כמות נוכחית</th><th style="width:75px">כמות מצטברת</th><th style="width:75px">מחיר יחידה</th><th style="width:85px">סה"כ מצטבר</th>
      </tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  function rollupHTML(list) {
    if (!list.length) return '';
    let curB = null, curC = null, curS = null, bCap = '', cCap = '', sCap = '', bT = 0, cT = 0, sT = 0, grand = 0, rows = '';
    const line = (lvl, cap, a) => `<tr><td class="rname" style="padding-inline-start:${8 + lvl * 16}px">${cap}</td><td class="num">${money(a)}</td></tr>`;
    const cS = () => { if (curS !== null) rows += line(2, 'תת פרק ' + sCap, sT); }, cC = () => { if (curC !== null) rows += line(1, 'סה"כ פרק ' + cCap, cT); }, cB = () => { if (curB !== null) rows += line(0, 'סה"כ מבנה ' + bCap, bT); };
    for (const it of list) {
      const k = caps(it);
      if (it.struct !== curB) { cS(); cC(); cB(); curB = it.struct; curC = null; curS = null; bT = 0; bCap = k.b; rows += `<tr><td class="rname" style="font-weight:800">מבנה ${bCap}</td><td></td></tr>`; }
      if (it.chapter !== curC) { cS(); cC(); curC = it.chapter; curS = null; cT = 0; cCap = k.c; }
      if (it.sub !== curS) { cS(); curS = it.sub; sT = 0; sCap = k.s; }
      const m = mv(it); sT += m.amount; cT += m.amount; bT += m.amount; grand += m.amount;
    }
    cS(); cC(); cB();
    return `<div class="rsec rsec-pagebreak"><div class="rsec-hd"><span class="rtitle">ריכוז</span></div>
      <table class="rtbl sumtbl"><tbody>${rows}<tr class="t3"><td class="rname">סה"כ כללי</td><td class="num">${money(grand)}</td></tr></tbody></table></div>`;
  }
  function itemSectionHTML(it, mode, pageBreak, showContract) {
    const m = mv(it);
    const rows = mode === 'period' ? (m.measured ? m.movementRows : []) : m.rows.filter((r) => !r.isGroup && !r.cancelled);
    if (mode === 'period' && !rows.length && !(m.addition + m.correction)) return '';
    const kind = itemUnitKind(it);
    const claimedDiffers = Math.abs(m.claimedCurrentCumulative - m.currentCumulative) > 1e-9;
    const rowsHTML = rows.map((r, i) => {
      const claimedVal = m.isDraft ? calcRow(r, it) : Number(r.claimedValue ?? r.value);
      const approvedVal = m.isDraft ? approvedRowValue(r, it) : Number(r.value);
      const differs = Math.abs(claimedVal - approvedVal) > 1e-9;
      return `<tr class="${r.sign === -1 ? 'rded' : ''}"><td class="ri">${i + 1}</td><td class="rname">${esc(r.desc || '')}</td>
        <td>${shapeSVG(r.shape, r.d1, r.d2, r.d3, r.sign === -1, false, r.t, kind)}</td><td class="rf">${esc(rowFormulaText(r, kind))}</td>
        <td class="rres ${claimedVal < 0 ? 'n' : 'p'}">${fn(claimedVal)}</td>
        <td class="rres ${approvedVal < 0 ? 'n' : 'p'}" style="${differs ? 'color:var(--neg);font-weight:800' : ''}">${fn(approvedVal)}</td></tr>`;
    }).join('');
    return `<div class="rsec${pageBreak ? ' rsec-pagebreak' : ''}"><div class="rsec-hd"><span class="rcode">${esc(fullCode(it))}</span>
      <span class="rtitle">${esc(it.description)}</span><span class="rfacts">${esc(it.unit)} · ${money(m.unitPrice)}/${esc(it.unit)}</span></div>
      <table class="rtbl"><thead><tr><th style="width:24px">#</th><th>תיאור</th><th style="width:90px">שרטוט</th><th>נוסחה</th><th style="width:60px">נתבע</th><th style="width:60px">אושר</th></tr></thead>
      <tbody>${rowsHTML || `<tr><td colspan="6" style="padding:10px;color:var(--muted)">${m.measured ? 'אין שורות מדידה' : 'הכמות הוזנה ישירות בחשבון (ללא דף חישוב)'}</td></tr>`}</tbody></table>
      <div class="rbal">${showContract === false ? '' : `<div class="bc"><div class="k">חוזי</div><div class="v">${fn(m.contractQty)}</div></div>`}
        <div class="bc"><div class="k">מצטבר קודם</div><div class="v">${fn(m.previousCumulative)}</div></div>
        <div class="bc"><div class="k">בתקופה</div><div class="v">${fn(m.addition)}</div></div>
        <div class="bc"><div class="k">תיקון</div><div class="v">${fn(m.correction)}</div></div>
        ${claimedDiffers ? `<div class="bc"><div class="k">מצטבר נתבע</div><div class="v">${fn(m.claimedCurrentCumulative)}</div></div>` : ''}
        <div class="bc net"><div class="k">מצטבר נוכחי (מאושר)</div><div class="v">${fn(m.currentCumulative)} ${esc(it.unit)}</div></div></div></div>`;
  }
  function auditHTML(it) {
    const rows = api.measRows(contract.id, it.id).filter((m) => !m.isGroup);
    const entries = rows.flatMap((r) => r.history.map((hh) => ({ ...hh, rowDesc: r.desc }))).sort((a, b) => (a.date < b.date ? -1 : 1));
    if (!entries.length) return '';
    return `<div class="rsec"><div class="rsec-hd"><span class="rtitle">היסטוריית ביקורת (Audit Trail)</span></div>
      <table class="rtbl"><thead><tr><th>חשבון</th><th>פעולה</th><th>שורה</th><th>מ → אל (מאושר)</th><th>נתבע</th><th>הערה</th><th>תאריך</th></tr></thead><tbody>
      ${entries.map((hh) => { const cd = hh.claimedValue != null && Math.abs(hh.claimedValue - hh.value) > 1e-9;
        return `<tr><td>${esc(String(hh.accountNumber).padStart(3, '0'))}</td><td>${esc(ROW_HIST_LABEL[hh.action])}</td><td class="rname">${esc(hh.rowDesc || '')}</td>
        <td class="num">${hh.action === 'created' ? fn(hh.value) : fn(hh.prevValue) + ' ← ' + fn(hh.value)}</td>
        <td class="num" style="${cd ? 'color:var(--gold-dk);font-weight:700' : ''}">${hh.claimedValue != null ? fn(hh.claimedValue) : '—'}</td>
        <td class="rname" style="font-size:10px">${esc(hh.approvalNote || '')}</td><td>${dateLabel(hh.date)}</td></tr>`; }).join('')}
      </tbody></table></div>`;
  }
  const totals = () => {
    let contractTotal = 0, cumulativeAmount = 0, previousAmount = 0, periodAmount = 0;
    for (const it of items) { contractTotal += Number(it.qty) * Number(it.price); const m = mv(it); cumulativeAmount += m.amount; previousAmount += m.previousAmount; periodAmount += m.periodAmount; }
    const vat = Number(contract.vat_rate) / 100;
    return { contractTotal, cumulativeAmount, previousAmount, periodAmount, cumulativeWithVat: cumulativeAmount * (1 + vat), vatAmount: cumulativeAmount * vat,
      balance: contractTotal - cumulativeAmount, completionPct: contractTotal > 0 ? cumulativeAmount / contractTotal * 100 : 0 };
  };
  const summaryHTML = () => { const t = totals();
    return `<div class="rsum"><div class="rsec-hd sumhd"><span class="rtitle">ריכוז חשבון ${esc(accNo)}</span></div><table class="rtbl sumtbl"><tbody>
      <tr><td class="rname">סה"כ חוזה</td><td class="rres">${money(t.contractTotal)}</td></tr>
      <tr><td class="rname">מצטבר קודם</td><td class="rres">${money(t.previousAmount)}</td></tr>
      <tr><td class="rname">בתקופה נוכחית</td><td class="rres">${money(t.periodAmount)}</td></tr>
      <tr class="t1"><td class="rname">מצטבר נוכחי (לפני מע"מ)</td><td class="rres">${money(t.cumulativeAmount)}</td></tr>
      <tr><td class="rname">מע"מ (${esc(contract.vat_rate)}%)</td><td class="rres">${money(t.vatAmount)}</td></tr>
      <tr class="t3"><td class="rname">סה"כ מצטבר כולל מע"מ</td><td class="rres num">${money(t.cumulativeWithVat)}</td></tr>
      <tr><td class="rname">יתרת חוזה</td><td class="rres ${t.balance < 0 ? 'over' : ''}">${money(t.balance)}</td></tr>
      <tr><td class="rname">% ביצוע</td><td class="rres">${pct(t.completionPct)}</td></tr></tbody></table></div>`; };
  const signaturesHTML = () => `<div class="rsigns"><div>קבלן מבצע<span>${esc(executor || '')}</span></div>
    <div>מפקח<span>${esc(project.supervisor || '')}</span></div><div>מנהל פרויקט<span>${esc(project.manager || '')}</span></div></div>`;
  const reportItems = () => {
    let list = items.slice();
    if (S.itemFilter === 'withQty') list = list.filter((it) => { const m = mv(it); return Math.abs(m.currentCumulative) > 1e-9 || Math.abs(m.claimedCurrentCumulative) > 1e-9; });
    else if (S.itemFilter === 'changed') list = list.filter((it) => { const m = mv(it); return Math.abs(m.addition) + Math.abs(m.correction) > 1e-9; });
    else if (S.itemFilter === 'measured') list = list.filter((it) => mv(it).measured);
    return list.sort((a, b) => fullCode(a).localeCompare(fullCode(b)));
  };
  const statusLabel = bill.status === 'approved' ? 'נעול' : 'טיוטה';
  function buildHTML() {
    if (sheetItemId) {
      const it = items.find((x) => x.id === sheetItemId);
      if (!it) return '<div class="empty">סעיף לא נמצא</div>';
      return `<div class="${reportClass()}">${headerHTML('דף חישוב לסעיף', fullCode(it) + ' — ' + it.description)}
        ${itemSectionHTML(it, 'cumulative', false, S.showContract)}${auditHTML(it)}${signaturesHTML()}</div>`;
    }
    const list = reportItems();
    const t = totals();
    const title = S.mode === 'period' ? `תנועה בחשבון ${accNo}` : `${bill.type === 'final' ? 'חשבון סופי' : 'חשבון חלקי'} מס' ${accNo}`;
    let out = `<div class="${reportClass()}">${headerHTML(title, statusLabel)}`;
    if (S.layout === 'detailed') {
      if (S.showCards) out += `<div class="scards">
        <div class="scard"><div class="sc-ic">📐</div><div class="sc-k">סה"כ חוזה</div><div class="sc-v">${money(t.contractTotal)}</div></div>
        <div class="scard"><div class="sc-ic">📒</div><div class="sc-k">מצטבר קודם</div><div class="sc-v">${money(t.previousAmount)}</div></div>
        <div class="scard"><div class="sc-ic">➕</div><div class="sc-k">בתקופה</div><div class="sc-v">${money(t.periodAmount)}</div></div>
        <div class="scard"><div class="sc-ic">✅</div><div class="sc-k">מצטבר נוכחי</div><div class="sc-v">${money(t.cumulativeAmount)}</div></div>
        <div class="scard"><div class="sc-ic">📊</div><div class="sc-k">% ביצוע</div><div class="sc-v">${pct(t.completionPct)}</div></div></div>`;
      out += list.map((it, i) => itemSectionHTML(it, S.mode, S.printPerPage && i > 0, S.showContract)).join('');
    } else out += groupedTableHTML(list) + rollupHTML(list);
    return out + summaryHTML() + signaturesHTML() + '</div>';
  }

  const radio = (name, k, v, label) => h('label', { class: 'opt' }, h('input', { type: 'radio', name, checked: S[k] === v, onchange: () => { setOpt(k === 'itemFilter' ? 'filter' : k, v); ctx.refresh(); } }), label);
  const check = (k, key, label) => h('label', { class: 'opt' }, h('input', { type: 'checkbox', checked: S[k], onchange: (e) => { setOpt(key, e.target.checked); ctx.refresh(); } }), label);
  const controls = h('div', { class: 'report-controls no-print' },
    h('div', { class: 'rc-row' },
      h('b', {}, `חשבון ${accNo} · ${statusLabel}`),
      radio('rmode', 'mode', 'cumulative', 'מצטבר עד חשבון זה'), radio('rmode', 'mode', 'period', 'רק תנועה בחשבון זה'),
      sheetItemId ? h('button', { onclick: () => ctx.go(`b/${billId}/sheets`) }, '← חזרה לדוח מלא') : null,
      h('button', { onclick: () => ctx.go(`b/${billId}`) }, 'חזרה לחשבון')),
    h('div', { class: 'rc-row', style: { paddingTop: '12px', flexWrap: 'wrap' } },
      radio('rlayout', 'layout', 'concise', 'תמציתי (סעיף לשורה, כמו הדפסה רגילה)'), radio('rlayout', 'layout', 'detailed', 'מפורט (שורות מדידה, שרטוט ונוסחה)'),
      h('label', { class: 'opt' }, 'כיוון הדפסה', h('select', { onchange: (e) => { setOpt('orientation', e.target.value); ctx.refresh(); } },
        h('option', { value: 'landscape', selected: S.orientation === 'landscape' }, 'לרוחב'), h('option', { value: 'portrait', selected: S.orientation === 'portrait' }, 'לאורך'))),
      h('label', { class: 'opt' }, 'סעיפים להצגה', h('select', { onchange: (e) => { setOpt('filter', e.target.value); ctx.refresh(); } },
        [['all', 'הכל'], ['withQty', 'רק עם כמות'], ['changed', 'רק עם שינוי בתקופה'], ['measured', 'רק סעיפים עם דף חישוב']].map(([v, l]) => h('option', { value: v, selected: S.itemFilter === v }, l))))),
    S.layout === 'detailed' && !sheetItemId ? h('div', { class: 'rc-row', style: { paddingTop: '12px', flexWrap: 'wrap' } },
      check('printPerPage', 'perpage', 'כל סעיף בדף נפרד בהדפסה'), check('showCards', 'cards', 'הצגת כרטיסי סיכום'), check('showContract', 'contract', 'הצגת חוזי מול מדידה')) : null,
    h('div', { class: 'rc-row', style: { borderBottom: 'none', paddingTop: '12px' } },
      h('button', { class: 'primary', onclick: async () => { const { printPdf } = await import('../persist.js'); printPdf(`דפי חישוב - ${contract.name} - חשבון ${accNo}.pdf`); } }, '🖨 הדפסה / שמירה כ-PDF'),
      h('span', { class: 'muted' }, 'ליצירת PDF: בחלון ההדפסה בחרו יעד ״שמירה כ-PDF״')));
  const out = h('div', { class: 'kea page', style: { maxWidth: 'none' } }, controls);
  out.append(html(buildHTML()));
  return out;
}
