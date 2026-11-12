// Bill of quantities workspace: section tree · editable grid · Dekel side panel.
import { h, $, formModal, modal, attempt, confirmBox, toast } from './dom.js';
import { money, qty, lineCents } from '../money.js';
import { itemCode, isBillable } from '../engine.js';
import { deviation, deviationFlag } from '../dekel.js';
import { parseSkn, buildSkn } from '../skn.js';
import { pickFile, download } from '../persist.js';
import { loadExcel, exportBoq, readSheetRows } from '../excel.js';
import { readPdf } from '../pdfimport.js';
import { KIND, contractForm } from './projects.js';
import { dekelPanel } from './dekel-ui.js';

const KINDS = { contract: 'חוזה', extra: 'חריג/נוסף', note: 'הערה' };
const CHG = { approved: 'מאושר', pending: 'ממתין לאישור', rejected: 'נדחה' };

const selKey = (cid) => `boq-sel-${cid}`;
const loadSel = (cid) => { try { return JSON.parse(sessionStorage.getItem(selKey(cid))) ?? {}; } catch { return {}; } };
const saveSel = (cid, s) => { try { sessionStorage.setItem(selKey(cid), JSON.stringify(s)); } catch { /* private mode */ } };

export function itemForm(ctx, contract, it, defaults = {}) {
  const api = ctx.api;
  const v0 = { struct: '01', chapter: '01', sub: '01', kind: 'contract', ...defaults, ...it };
  if (!it?.id && !v0.num) v0.num = api.nextNum(contract.id, v0.struct, v0.chapter, v0.sub);
  const fields = [
    { name: 'struct', label: 'מבנה', value: v0.struct, numeric: true },
    { name: 'chapter', label: 'פרק', value: v0.chapter, numeric: true },
    { name: 'sub', label: 'תת-פרק', value: v0.sub, numeric: true },
    { name: 'num', label: 'מספר סעיף', value: v0.num, numeric: true },
    { name: 'kind', label: 'סוג', type: 'select', value: v0.kind, options: Object.entries(KINDS) },
    { name: 'unit', label: 'יחידה', value: v0.unit },
    { name: 'description', label: 'תיאור', type: 'textarea', value: v0.description, span: true, rows: 4 },
    { name: 'qty', label: 'כמות', value: v0.qty ?? '0', numeric: true },
    { name: 'price', label: 'מחיר יחידה', value: v0.price ?? '0', numeric: true },
  ];
  if (contract.kind !== 'quote') fields.push({ name: 'change_status', label: 'סטטוס סעיף חריג', type: 'select', value: v0.change_status ?? 'pending', options: Object.entries(CHG), hint: 'סעיף חריג מחויב רק לאחר אישור' });
  fields.push({ name: 'notes', label: 'הערה פנימית', value: v0.notes, span: true });
  formModal(it?.id ? `עריכת סעיף ${itemCode(it)}` : 'סעיף חדש', fields, (v) => {
    // a quote line taken from Dekel stays Dekel-priced unless the user typed a different price
    const fromDekel = contract.kind === 'quote' && v0.dekel_price != null && v.price === String(v0.price ?? '');
    const priceManual = fromDekel ? (it?.id ? it.price_manual : 0) : (it?.id && v.price === it.price ? it.price_manual : 1);
    const id = api.saveItem({ ...v0, ...v, contract_id: contract.id, price_manual: priceManual });
    ctx._focusItem = id;
    ctx.refresh();
  }, { wide: true });
}

function sectionForm(ctx, contract, code, sec) {
  const level = code.split('.').length;
  const fields = [{ name: 'name', label: ['שם מבנה', 'שם פרק', 'שם תת-פרק'][level - 1], value: sec?.name ?? '', span: true }];
  if (level === 2) {
    if (contract.kind === 'quote') fields.push({ name: 'markup', label: 'תוספת/הנחה לפרק מדקל %', value: sec?.markup ?? '0', numeric: true, hint: 'מצטבר על התוספת הכללית של ההצעה' });
    else fields.push({ name: 'discount', label: 'הנחה לפרק %', value: sec?.discount ?? '0', numeric: true });
    fields.push({ name: 'exempt', label: 'מוחרג מההנחה הכללית', type: 'checkbox', value: sec ? !!sec.exempt : code.endsWith('.99') });
  }
  formModal(`${['מבנה', 'פרק', 'תת-פרק'][level - 1]} ${code}`, fields, (v) => {
    ctx.api.saveSection(contract.id, code, { name: v.name, discount: v.discount, markup: v.markup, exempt: level === 2 ? v.exempt : undefined });
    ctx.refresh();
  });
}

function parsePaste(text) {
  return text.replace(/\r/g, '').split('\n').filter((l) => l.trim()).map((l) => l.split('\t').map((c) => c.trim().replace(/^"|"$/g, '')));
}
function pasteImport(ctx, contract, sel, initial = '', title = 'הדבקה מאקסל') {
  const [s0, c0, t0] = (sel.code && sel.code !== 'all' ? sel.code : '01.01.01').split('.');
  const ta = h('textarea', { rows: 10, style: { width: '100%', fontFamily: 'monospace', direction: 'rtl' }, placeholder: 'העתק שורות מאקסל והדבק כאן (Ctrl+V)' });
  const COLS = [['', '— התעלם —'], ['code', 'מספר סעיף'], ['description', 'תיאור'], ['unit', 'יחידה'], ['qty', 'כמות'], ['price', 'מחיר'], ['dekel_code', 'קוד דקל']];
  const mapBox = h('div', { class: 'form-grid' });
  const preview = h('div', { class: 'muted' });
  let rows = [], selects = [];
  const guess = (i, n) => (n >= 5 ? ['code', 'description', 'unit', 'qty', 'price', ''][i] ?? '' : n === 4 ? ['description', 'unit', 'qty', 'price'][i] : '');
  const refresh = () => {
    rows = parsePaste(ta.value);
    const n = Math.max(0, ...rows.map((r) => r.length));
    if (selects.length !== n) {
      selects = Array.from({ length: n }, (_, i) => h('select', {}, COLS.map(([v, l]) => h('option', { value: v, selected: v === guess(i, n) }, l))));
      mapBox.replaceChildren(...selects.map((s, i) => h('label', { class: 'field' }, h('span', {}, `עמודה ${i + 1}: ${rows[0]?.[i]?.slice(0, 24) ?? ''}`), s)));
    }
    preview.textContent = rows.length ? `${rows.length} שורות` : '';
  };
  ta.addEventListener('input', refresh);
  if (initial) { ta.value = initial; setTimeout(refresh, 0); }
  modal(title, [h('p', { class: 'muted' }, `מספר סעיף בפורמט מבנה.פרק.תת-פרק.סעיף (או פרק.תת-פרק.סעיף). בלי עמודת מספר — הסעיפים ימוספרו אוטומטית תחת ${s0}.${c0}.${t0}. שורת כותרת תדולג אם אין בה מספרים.`), ta, mapBox, preview], {
    wide: true,
    actions: [{ label: 'ביטול' }, { label: 'ייבוא', primary: true, onClick: () => {
      const map = selects.map((s) => s.value);
      const at = (r, k) => { const i = map.indexOf(k); return i < 0 ? '' : r[i] ?? ''; };
      let auto = ctx.api.nextNum(contract.id, s0, c0, t0);
      const items = [];
      const sections = [];
      let cur = { s: s0, c: c0, t: t0 };
      for (const r of rows) {
        const q = at(r, 'qty').replace(/,/g, ''), p = at(r, 'price').replace(/,/g, '').replace(/₪/g, '').trim();
        if (q && isNaN(+q)) continue; // header row
        const desc = at(r, 'description');
        if (/^סה"?כ/.test(desc) && !q) continue; // total rows (e.g. from our own Excel export)
        const code = at(r, 'code');
        const parts = code ? code.split(/[.\-/ ]+/).filter(Boolean).map((x) => x.replace(/\D/g, '')).filter(Boolean) : [];
        // a code without quantity/price is a structure / chapter / subchapter title row
        if (parts.length && !q && !p && (parts.length <= 3 && parts.every((x) => x.length <= 2))) {
          const [a, b2, c2] = parts.map((x) => x.padStart(2, '0'));
          if (parts.length === 1) { cur = { s: a, c: cur.c, t: cur.t }; sections.push({ code: a, name: desc }); }
          else if (parts.length === 2) { cur = { s: a, c: b2, t: '01' }; sections.push({ code: `${a}.${b2}`, name: desc }); }
          else { cur = { s: a, c: b2, t: c2 }; sections.push({ code: `${a}.${b2}.${c2}`, name: desc }); }
          continue;
        }
        let s = cur.s, c = cur.c, t = cur.t, n;
        if (parts.length) {
          if (parts.length >= 4) [s, c, t, n] = parts.slice(-4);
          else if (parts.length === 3) [c, t, n] = parts;
          else if (parts.length === 2) [c, n] = parts;
          else n = parts[0];
          n = Number(n);
        } else { n = auto; auto += 10; }
        if (!desc && !q) continue;
        items.push({ struct: s, chapter: c, sub: t, num: n, description: desc, unit: at(r, 'unit'), qty: q || '0', price: p || '0',
          dekel_code: at(r, 'dekel_code') || null, kind: !q && !p ? 'note' : String(c).padStart(2, '0') === '99' ? 'extra' : 'contract' });
      }
      if (!items.length) { toast('לא זוהו שורות לייבוא', 'err'); return false; }
      const ok = attempt(() => ctx.api.importItems(contract.id, { items, sections: sections.filter((x) => x.name) }), `יובאו ${items.length} סעיפים`);
      if (ok === undefined) return false;
      if (ctx.dekel) for (const it of ctx.api.items(contract.id)) if (it.dekel_code && !it.dekel_price) { const d = ctx.dekel.get(it.dekel_code); if (d) ctx.api.linkDekel(it.id, d); }
      ctx.refresh();
    } }],
  });
}

async function importSkn(ctx, contract) {
  const f = await pickFile('.skn,.SKN,.txt');
  if (!f) return;
  let parsed;
  try { parsed = parseSkn(f.bytes); } catch (e) { toast(`קובץ SKN לא תקין: ${e.message}`, 'err'); return; }
  const real = parsed.items.filter((i) => i.kind !== 'note');
  const existing = ctx.api.items(contract.id).length;
  const hasBills = ctx.api.bills(contract.id).length > 0;
  const total = real.reduce((s, i) => s + lineCents(i.qty, i.price), 0);
  modal('ייבוא SKN', [
    h('table', { class: 'ledger' }, h('tbody', {},
      h('tr', {}, h('td', {}, 'כותרת'), h('td', {}, parsed.title)),
      h('tr', {}, h('td', {}, 'סעיפים'), h('td', {}, real.length)),
      h('tr', {}, h('td', {}, 'הערות'), h('td', {}, parsed.items.length - real.length)),
      h('tr', {}, h('td', {}, 'מבנים / פרקים / תתי-פרקים'), h('td', {}, parsed.sections.length)),
      h('tr', { class: 'strong' }, h('td', {}, 'סה"כ כמות × מחיר'), h('td', {}, money(total))))),
    parsed.warnings.length ? h('div', { class: 'alert' }, h('b', {}, 'אזהרות: '), h('div', { class: 'pre' }, parsed.warnings.slice(0, 20).join('\n'))) : null,
    existing ? h('div', { class: 'alert info' }, `בחוזה כבר ${existing} סעיפים. "הוספה" תיכשל אם יש מספור כפול. ${hasBills ? 'יש חשבונות — החלפה חסומה.' : ''}`) : null,
  ], { actions: [
    { label: 'ביטול' },
    ...(existing && !hasBills ? [{ label: 'החלפת כל הסעיפים', danger: true, onClick: () => run('replace') }] : []),
    { label: existing ? 'הוספה' : 'ייבוא', primary: true, onClick: () => run('append') },
  ] });
  function run(mode) {
    const r = attempt(() => ctx.api.importItems(contract.id, parsed, mode), `יובאו ${parsed.items.length} רשומות`);
    if (r === undefined) return false;
    if (!contract.name || contract.name === 'חדש') ctx.api.saveContract({ ...contract, name: parsed.title });
    ctx.refresh();
  }
}

function exportSkn(ctx, contract) {
  try {
    const items = ctx.api.items(contract.id).filter((i) => i.kind === 'note' || i.change_status !== 'rejected');
    const r = buildSkn(contract.name, ctx.api.sections(contract.id), items);
    download(`${contract.name.replace(/[\\/:*?"<>|]/g, '_')}.skn`, r.bytes);
    if (r.warnings.length) modal('SKN נוצר — שים לב', h('div', { class: 'pre' }, r.warnings.join('\n')), { actions: [{ label: 'סגירה', primary: true }] });
    else toast(`נוצר קובץ SKN עם ${r.records} רשומות`);
  } catch (e) { toast(`לא ניתן לייצא: ${e.message}`, 'err'); }
}

export function boqView(ctx, cid) {
  const api = ctx.api;
  const contract = api.contract(cid);
  const project = api.project(contract.project_id);
  const isQuote = contract.kind === 'quote';
  const sel = { code: 'all', itemId: null, showDekel: !!ctx.dekel, q: '', ...loadSel(cid) };
  const items = api.items(cid);
  const sections = new Map(api.sections(cid).map((s) => [s.code, s]));
  const billed = new Set(api.s.all(`SELECT DISTINCT l.item_id FROM bill_lines l JOIN bills b ON b.id=l.bill_id WHERE b.contract_id=? AND b.status='approved'`, [cid]).map((r) => r.item_id));
  const thr = project.dekel_threshold;

  // ---- tree ----
  const amounts = new Map();
  for (const it of items) if (isBillable(it)) {
    const a = lineCents(it.qty, it.price);
    for (const k of [it.struct, `${it.struct}.${it.chapter}`, `${it.struct}.${it.chapter}.${it.sub}`, 'all']) amounts.set(k, (amounts.get(k) ?? 0) + a);
  }
  const tree = h('nav', { class: 'tree', 'aria-label': 'מבנים ופרקים' });
  const codes = [...new Set(items.flatMap((i) => [i.struct, `${i.struct}.${i.chapter}`, `${i.struct}.${i.chapter}.${i.sub}`]))].sort();
  const node = (code, label, cls) => h('div', { class: `node ${cls} ${sel.code === code ? 'on' : ''}`, onclick: () => { sel.code = code; sel.itemId = null; saveSel(cid, sel); ctx.refresh(); },
    ondblclick: code === 'all' ? null : () => sectionForm(ctx, contract, code, sections.get(code)), title: code === 'all' ? '' : 'לחיצה כפולה לעריכה' },
  h('span', { class: 'c' }, code === 'all' ? '' : code.split('.').at(-1)), h('span', {}, label), h('span', { class: 'amt' }, amounts.has(code) ? money(amounts.get(code)).replace(/\.\d\d$/, '') : ''));
  tree.append(h('h3', {}, 'כתב כמויות'), node('all', 'הכל', 'l1'));
  for (const code of codes) {
    const lvl = code.split('.').length;
    const s = sections.get(code);
    const extra = lvl === 2 && s && (isQuote ? s.markup !== '0' ? ` (${s.markup}%)` : '' : s.discount !== '0' ? ` (−${s.discount}%)` : '');
    tree.append(node(code, (s?.name || ['מבנה', 'פרק', 'תת-פרק'][lvl - 1] + ' ' + code.split('.').at(-1)) + (extra || ''), `l${lvl}`));
  }

  // ---- grid ----
  const visible = items.filter((it) => (sel.code === 'all' || itemCode(it).startsWith(sel.code + '.'))
    && (!sel.q || `${itemCode(it)} ${it.description} ${it.dekel_code ?? ''}`.includes(sel.q)));
  const tbody = h('tbody');
  const totalCell = new Map();
  const statusTotal = h('b');
  const visTotal = h('b');
  const recomputeTotals = () => {
    const all = api.items(cid).filter(isBillable).reduce((s, i) => s + lineCents(i.qty, i.price), 0);
    statusTotal.textContent = money(all);
    const ids = new Set(visible.map((v) => v.id));
    visTotal.textContent = money(api.items(cid).filter((i) => ids.has(i.id) && isBillable(i)).reduce((s, i) => s + lineCents(i.qty, i.price), 0));
  };

  const devCell = (it) => {
    if (!it.dekel_price) return h('td', { class: 'muted' }, it.dekel_code ? it.dekel_code : '');
    const d = deviation(it.price, it.dekel_price);
    const f = deviationFlag(d, thr);
    return h('td', { class: 'n', title: `דקל ${it.dekel_code}: ${it.dekel_price} ₪` },
      h('span', { class: `dev-${f}` }, `${Number(d) > 0 ? '+' : ''}${Number(d).toFixed(1)}%`), h('div', { class: 'muted', style: { fontSize: '11.5px' } }, `${it.dekel_code} · ${qty(it.dekel_price)}`));
  };

  const cellInput = (it, field, cls = '') => {
    const lockedNum = !isQuote && billed.has(it.id) && (field === 'price' || field === 'unit');
    const quoteAuto = isQuote && field === 'price' && !it.price_manual && it.dekel_price;
    if (it.kind === 'note' && field !== 'description') return h('td');
    if (lockedNum) return h('td', { class: `locked ${cls}`, title: 'הסעיף חויב בחשבון מאושר' }, field === 'price' ? qty(it.price) : it.unit);
    const multi = field === 'description';
    const inp = multi ? h('textarea', { rows: 1 }, it[field]) : h('input', { value: it[field] ?? '', class: cls, dir: cls === 'n' ? 'ltr' : null, inputmode: cls === 'n' ? 'decimal' : null, title: quoteAuto ? 'מחושב מדקל — עריכה תהפוך למחיר ידני' : '' });
    inp.dataset.field = field; inp.dataset.id = it.id;
    inp.addEventListener('focus', () => select(it.id));
    inp.addEventListener('change', () => {
      const cur = api.item(it.id);
      if (String(cur[field]) === inp.value) return;
      const r = attempt(() => api.saveItem({ ...cur, [field]: inp.value, price_manual: field === 'price' ? 1 : cur.price_manual }));
      if (r === undefined) { inp.value = cur[field]; return; }
      const nw = api.item(it.id);
      Object.assign(it, nw);
      if (field !== 'description') inp.value = nw[field];
      totalCell.get(it.id).textContent = isBillable(nw) ? money(lineCents(nw.qty, nw.price)) : '';
      const row = inp.closest('tr');
      const nd = devCell(nw); nd.classList.add('dev'); row.querySelector('td.dev')?.replaceWith(nd);
      recomputeTotals();
    });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !(multi && e.shiftKey) || e.key === 'ArrowDown' && !multi || e.key === 'ArrowUp' && !multi) {
        e.preventDefault();
        inp.dispatchEvent(new Event('change'));
        const rows = [...tbody.querySelectorAll(`[data-field="${field}"]`)];
        const i = rows.indexOf(inp);
        rows[e.key === 'ArrowUp' ? i - 1 : i + 1]?.focus();
      }
    });
    return h('td', { class: multi ? 'edit desc' : 'edit' }, inp);
  };

  let lastGroup = '';
  for (const it of visible) {
    const g = `${it.struct}.${it.chapter}.${it.sub}`;
    if (g !== lastGroup && sel.code.split('.').length < 3) {
      lastGroup = g;
      const names = [sections.get(it.struct)?.name, sections.get(`${it.struct}.${it.chapter}`)?.name, sections.get(g)?.name].filter(Boolean);
      tbody.append(h('tr', { class: 'group' }, h('td', { class: 'code' }, g), h('td', { colspan: 7 }, names.join(' · '))));
    }
    const tc = h('td', { class: 'n' }, isBillable(it) ? money(lineCents(it.qty, it.price)) : '');
    totalCell.set(it.id, tc);
    const dc = devCell(it); dc.classList.add('dev');
    const tagKind = it.kind === 'extra' ? h('span', { class: `tag ${it.change_status === 'approved' ? 'ok' : it.change_status === 'rejected' ? 'bad' : 'warn'}` }, `חריג · ${CHG[it.change_status]}`)
      : it.kind === 'note' ? h('span', { class: 'tag' }, 'הערה') : null;
    const tr = h('tr', { class: `${it.kind === 'note' ? 'note' : ''} ${sel.itemId === it.id ? 'sel' : ''}`, 'data-id': it.id },
      h('td', { class: 'code', ondblclick: () => itemForm(ctx, contract, it), title: 'לחיצה כפולה לעריכה מלאה', style: { cursor: 'pointer' } }, itemCode(it),
        tagKind || (isQuote && it.dekel_price && !it.price_manual) ? h('div', { style: { marginTop: '4px', display: 'flex', gap: '4px', justifyContent: 'flex-end' } }, tagKind,
          isQuote && it.dekel_price && !it.price_manual ? h('span', { class: 'tag', title: 'המחיר נגזר מדקל' }, 'דקל') : null) : null),
      cellInput(it, 'description'),
      cellInput(it, 'unit'),
      cellInput(it, 'qty', 'n'),
      cellInput(it, 'price', 'n'),
      tc,
      dc,
      h('td', { class: 'no-print' }, h('button', { class: 'ghost icon', title: 'אפשרויות', onclick: (e) => rowMenu(e, it) }, '⋯')));
    tr.addEventListener('click', () => select(it.id));
    tbody.append(tr);
  }

  function rowMenu(e, it) {
    e.stopPropagation();
    const acts = [
      ['עריכה מלאה', () => itemForm(ctx, contract, it)],
      ['שכפול סעיף', () => itemForm(ctx, contract, { ...it, id: null, num: api.nextNum(cid, it.struct, it.chapter, it.sub) })],
      it.kind === 'extra' && it.change_status !== 'approved' && !isQuote ? ['אישור סעיף חריג', () => attempt(() => { api.approveChange(it.id); ctx.refresh(); }, 'אושר')] : null,
      it.kind === 'extra' && it.change_status === 'pending' && !isQuote ? ['דחיית סעיף חריג', () => attempt(() => { api.approveChange(it.id, 'rejected'); ctx.refresh(); })] : null,
      it.dekel_code ? ['ניתוק מדקל', () => attempt(() => { api.linkDekel(it.id, null); ctx.refresh(); })] : null,
      isQuote && it.price_manual && it.dekel_price ? ['החזרת מחיר מחושב מדקל', () => attempt(() => { api.saveItem({ ...api.item(it.id), price_manual: 0 }); ctx.refresh(); })] : null,
      ['מחיקה', async () => { if (await confirmBox('מחיקת סעיף', `למחוק את ${itemCode(it)}?`, { danger: true, ok: 'מחיקה' })) attempt(() => { api.deleteItem(it.id); ctx.refresh(); }); }],
    ].filter(Boolean);
    const m = modal(`סעיף ${itemCode(it)}`, h('div', { class: 'stack' }, acts.map(([l, f]) => h('button', { onclick: () => { m.close(); f(); } }, l))));
  }

  const grid = h('div', { class: 'grid-area' }, visible.length ? h('table', { class: 't lines fixed' },
    h('colgroup', {}, [136, null, 64, 100, 100, 120, 132, 40].map((w) => h('col', { style: w ? { width: `${w}px` } : {} }))),
    h('thead', {}, h('tr', {}, h('th', {}, 'סעיף'), h('th', {}, 'תיאור'), h('th', {}, "יח'"), h('th', { class: 'n' }, 'כמות'), h('th', { class: 'n' }, 'מחיר'),
      h('th', { class: 'n' }, 'סה"כ'), h('th', {}, 'דקל / סטייה'), h('th', { class: 'no-print' }, ''))),
    tbody) : h('div', { class: 'empty' }, h('b', {}, items.length ? 'אין סעיפים בתצוגה' : 'כתב הכמויות ריק'),
    items.length ? '' : 'הוסף סעיף, ייבא SKN, הדבק מאקסל או חפש בדקל בפאנל הצד.'));

  // ---- side ----
  const side = h('aside', { class: 'side' });
  function select(id) {
    if (sel.itemId === id) return;
    sel.itemId = id; saveSel(cid, sel);
    tbody.querySelectorAll('tr.sel').forEach((r) => r.classList.remove('sel'));
    tbody.querySelector(`tr[data-id="${id}"]`)?.classList.add('sel');
    renderSide();
  }
  function renderSide() {
    if (!sel.showDekel) { side.hidden = true; return; }
    side.hidden = false;
    const it = sel.itemId ? items.find((i) => i.id === sel.itemId) : null;
    side.replaceChildren(dekelPanel(ctx, {
      contract, item: it, threshold: thr,
      defaultChapter: sel.code !== 'all' ? sel.code.split('.')[1] : '',
      onLink: (dk) => { attempt(() => api.linkDekel(it.id, dk), `קושר ל-${dk.code}`); ctx._focusItem = it.id; ctx.refresh(); },
      onAdd: (dk) => {
        const [s, c, t] = (sel.code !== 'all' ? sel.code : '01.01.01').split('.');
        itemForm(ctx, contract, null, { struct: s ?? '01', chapter: c ?? dk.chapter, sub: t ?? '01', description: dk.description, unit: dk.unit, price: dk.price, dekel_code: dk.code, dekel_price: dk.price });
      },
      onClose: () => { sel.showDekel = false; saveSel(cid, sel); ctx.refresh(); },
    }));
  }

  // ---- toolbar ----
  const search = h('input', { type: 'search', placeholder: 'חיפוש בכתב הכמויות…', value: sel.q, oninput: (e) => { sel.q = e.target.value; saveSel(cid, sel); clearTimeout(search._t); search._t = setTimeout(() => { ctx._keepSearchFocus = true; ctx.refresh(); }, 300); } });
  const curSub = () => { const [s, c, t] = (sel.code !== 'all' ? sel.code : '').split('.'); return { struct: s || '01', chapter: c || '01', sub: t || '01' }; };
  const tb = h('div', { class: 'toolbar no-print' },
    h('button', { class: 'primary', onclick: () => itemForm(ctx, contract, null, curSub()) }, '+ סעיף'),
    h('button', { onclick: () => itemForm(ctx, contract, null, { ...curSub(), kind: 'note' }) }, '+ הערה'),
    h('span', { class: 'sep' }),
    h('button', { onclick: () => importSkn(ctx, contract) }, 'ייבוא SKN'),
    h('button', { onclick: () => exportSkn(ctx, contract) }, 'ייצוא SKN'),
    h('button', { onclick: () => pasteImport(ctx, contract, sel) }, 'הדבקה מאקסל'),
    h('button', { onclick: () => importExcel(ctx, contract, sel) }, 'ייבוא Excel'),
    h('button', { onclick: () => exportExcel(ctx, contract) }, 'ייצוא Excel'),
    h('button', { onclick: () => importPdf(ctx, contract) }, 'ייבוא PDF'),
    h('span', { class: 'sep' }),
    h('button', { class: sel.showDekel ? 'primary' : '', onclick: () => { sel.showDekel = !sel.showDekel; saveSel(cid, sel); renderSide(); ctx.refresh(); } }, 'דקל'),
    h('button', { onclick: () => ctx.go(`c/${cid}/dekel`) }, 'בדיקת תמחור מול דקל'),
    h('span', { class: 'sep' }),
    !isQuote ? h('button', { onclick: () => ctx.go(`c/${cid}/bills`) }, 'חשבונות') : h('button', { onclick: () => convertQuote(ctx, contract) }, 'המרה לחוזה'),
    h('button', { onclick: () => ctx.go(`c/${cid}/print`) }, isQuote ? 'הדפסת הצעה' : 'הדפסה'),
    h('button', { onclick: () => contractForm(ctx, contract) }, 'הגדרות'),
    h('div', { class: 'grow' }),
    search);

  const v = api.contractValue(cid);
  const status = h('div', { class: 'statusbar' },
    h('span', {}, KIND[contract.kind], contract.kind !== 'quote' ? ` · ${contract.mode === 'periodic' ? 'תקופתי' : 'מצטבר'}` : ''),
    h('span', {}, 'סעיפים: ', h('b', {}, items.filter((i) => i.kind !== 'note').length)),
    h('span', {}, 'בתצוגה: ', visTotal),
    h('span', {}, 'סה"כ ברוטו: ', statusTotal),
    v.chapterDiscount + v.general ? h('span', {}, 'אחרי הנחות: ', h('b', {}, money(v.net))) : null,
    isQuote ? h('span', {}, 'כולל מע"מ: ', h('b', {}, money(v.net + Math.round(v.net * Number(contract.vat_rate) / 100)))) : null);
  recomputeTotals();

  const center = h('section', { class: 'center' },
    h('div', { class: 'toolbar', style: { borderBottom: '1px solid var(--line)' } },
      h('h2', {}, contract.name), h('span', { class: 'muted' }, [KIND[contract.kind], contract.party, contract.number].filter(Boolean).join(' · ')),
      isQuote ? h('span', { class: 'tag' }, `מדקל ${Number(contract.quote_markup) > 0 ? '+' : ''}${contract.quote_markup}%`) : null),
    tb, grid, status);

  const root = h('div', { class: `page full` }, h('div', { class: `ws ${sel.showDekel ? 'with-side' : ''}` }, tree, center, side));
  renderSide();
  setTimeout(() => {
    if (ctx._focusItem) { const r = tbody.querySelector(`tr[data-id="${ctx._focusItem}"]`); r?.scrollIntoView({ block: 'center' }); r?.classList.add('sel'); ctx._focusItem = null; }
    if (ctx._keepSearchFocus) { search.focus(); search.setSelectionRange(search.value.length, search.value.length); ctx._keepSearchFocus = false; }
  }, 0);
  return root;
}

function convertQuote(ctx, q) {
  formModal('המרת הצעת מחיר לחוזה', [
    { name: 'name', label: 'שם החוזה', value: q.name, span: true },
    { name: 'party', label: 'מזמין', value: q.party },
    { name: 'mode', label: 'שיטת חשבון', type: 'select', value: 'cumulative', options: [['cumulative', 'מצטבר'], ['periodic', 'תקופתי']] },
  ], (v) => {
    const id = ctx.api.copyContract(q.id, { kind: 'client', name: v.name, party: v.party });
    ctx.api.saveContract({ ...ctx.api.contract(id), mode: v.mode });
    ctx.go(`c/${id}`);
  }, { submit: 'יצירת חוזה', intro: h('p', { class: 'muted' }, 'נוצר חוזה מזמין חדש עם כל הסעיפים והמחירים הסופיים של ההצעה. ההצעה עצמה נשמרת ללא שינוי.') });
}

async function importExcel(ctx, contract, sel) {
  const f = await pickFile('.xlsx');
  if (!f) return;
  try {
    const sheets = await readSheetRows(await loadExcel(), f.bytes);
    if (!sheets.length) return toast('הקובץ ריק', 'err');
    const open = (sh) => pasteImport(ctx, contract, sel, sh.rows.map((r) => r.join('\t')).join('\n'), `ייבוא Excel — ${sh.name}`);
    if (sheets.length === 1) return open(sheets[0]);
    const m = modal('בחירת גיליון', h('div', { class: 'stack' }, sheets.map((sh) => h('button', { onclick: () => { m.close(); open(sh); } }, `${sh.name} (${sh.rows.length} שורות)`))));
  } catch (e) { toast(`קריאת הקובץ נכשלה: ${e.message}`, 'err'); }
}

async function exportExcel(ctx, contract) {
  try {
    const bytes = await exportBoq(await loadExcel(), { contract, sections: ctx.api.sections(contract.id), items: ctx.api.items(contract.id) });
    download(`${contract.name.replace(/[\\/:*?"<>|]/g, '_')}.xlsx`, bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  } catch (e) { toast(`ייצוא נכשל: ${e.message}`, 'err'); }
}

async function importPdf(ctx, contract) {
  const f = await pickFile('.pdf');
  if (!f) return;
  toast('קורא את קובץ ה-PDF…');
  let r;
  try { r = await readPdf(f.bytes); } catch (e) { return toast(`קריאת ה-PDF נכשלה: ${e.message}`, 'err'); }
  if (!r.items.length) return toast('לא זוהו סעיפים בקובץ. ייבוא PDF תומך בכתבי כמויות וחשבונות בפורמט בנארית.', 'err');
  const total = r.items.reduce((s, i) => s + lineCents(i.qty, i.price), 0);
  const rows = r.items.map((it) => {
    const desc = h('textarea', { rows: 2, style: { width: '100%' } }, it.description);
    desc.addEventListener('change', () => { it.description = desc.value.trim(); });
    return h('tr', {}, h('td', { class: 'code' }, `${it.struct}.${it.chapter}.${it.sub}.${String(it.num).padStart(4, '0')}`), h('td', { class: 'edit desc' }, desc),
      h('td', {}, it.unit), h('td', { class: 'n' }, qty(it.qty)), h('td', { class: 'n' }, qty(it.price)), h('td', { class: 'n' }, money(lineCents(it.qty, it.price))));
  });
  modal('ייבוא כתב כמויות מ-PDF — בדיקה לפני שמירה', [
    h('div', { class: 'alert info' }, `זוהו ${r.items.length} סעיפים בסך ${money(total)} ₪ (${r.layout === 'bill' ? 'מתוך חשבון — הכמות היא כמות החוזה' : 'כתב כמויות'}). `,
      'קריאת PDF אינה מדויקת ב-100%: בדוק את התיאורים ותקן לפני השמירה. הערות כלליות אינן מיובאות.'),
    r.warnings.length ? h('div', { class: 'alert' }, h('div', { class: 'pre' }, r.warnings.slice(0, 15).join('\n'))) : null,
    h('div', { class: 'table-wrap', style: { maxHeight: '55vh' } }, h('table', { class: 't lines' },
      h('thead', {}, h('tr', {}, ['סעיף', 'תאור', "יח'", 'כמות', 'מחיר', 'סה"כ'].map((x, i) => h('th', { class: i >= 3 ? 'n' : '' }, x)))), h('tbody', {}, rows))),
  ], { wide: true, actions: [{ label: 'ביטול' }, { label: `ייבוא ${r.items.length} סעיפים`, primary: true, onClick: () => {
    const items = r.items.map(({ _layout, _page, ...it }) => it);
    const ok = attempt(() => ctx.api.importItems(contract.id, { items, sections: r.sections }), `יובאו ${items.length} סעיפים`);
    if (ok === undefined) return false;
    ctx.refresh();
  } }] });
}
