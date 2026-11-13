// Bill of quantities workspace: section tree · editable grid · Dekel side panel.
import { h, $, formModal, modal, attempt, confirmBox, toast, menuButton } from './dom.js';
import { money, qty, lineCents } from '../money.js';
import { itemCode, isBillable } from '../engine.js';
import { deviation, deviationFlag } from '../dekel.js';
import { parseSkn, buildSkn } from '../skn.js';
import { pickFile, download } from '../persist.js';
import { loadExcel, exportBoq, readSheetRows } from '../excel.js';
import { readPdf } from '../pdfimport.js';
import { KIND, contractForm, contractFields } from './projects.js';
import { UNIT_CODES } from '../skn.js';

const UNITS = Object.entries(UNIT_CODES).filter(([k]) => k !== '00').map(([, v]) => v).concat(['מ"א']);
import { dekelPanel } from './dekel-ui.js';
import { multiSelect } from './multisel.js';
import { copyDialog, issueRevisionDialog, revisionsDialog } from './versions.js';

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
    // a quote has no change orders: extra (ch. 99) lines and their approval belong to contracts / bills
    { name: 'kind', label: 'סוג', type: 'select', value: v0.kind, options: Object.entries(KINDS).filter(([k]) => contract.kind !== 'quote' || k !== 'extra' || v0.kind === 'extra') },
    { name: 'unit', label: 'יחידה', value: v0.unit, list: UNITS, hint: 'בחר מהרשימה (יחידות בנארית) — קובעת את סוג המדידה בדף החישוב' },
    { name: 'description', label: 'תיאור', type: 'textarea', value: v0.description, span: true, rows: 4 },
    { name: 'qty', label: 'כמות', value: v0.qty ?? '0', numeric: true },
    { name: 'price', label: 'מחיר יחידה', value: v0.price ?? '0', numeric: true },
  ];
  if (contract.kind !== 'quote') fields.push({ name: 'change_status', label: 'סטטוס סעיף חריג', type: 'select', value: v0.change_status ?? 'pending',
    options: [['pending', 'ממתין לאישור המזמין'], ['approved', 'אושר על ידי המזמין — לחייב בחשבון'], ['rejected', 'נדחה']], hint: 'סעיף חריג נכלל בחשבון רק כשהוא מאושר' });
  fields.push({ name: 'notes', label: 'הערה פנימית', value: v0.notes, span: true });
  formModal(it?.id ? `עריכת סעיף ${itemCode(it)}` : 'סעיף חדש', fields, (v) => {
    // a quote line taken from Dekel stays Dekel-priced unless the user typed a different price
    const fromDekel = contract.kind === 'quote' && v0.dekel_price != null && v.price === String(v0.price ?? '');
    const priceManual = fromDekel ? (it?.id ? it.price_manual : 0) : (it?.id && v.price === it.price ? it.price_manual : 1);
    if (v.kind !== 'note' && v.unit && !UNITS.includes(v.unit.trim()) && !confirm_unit(v.unit)) return false;
    const id = api.saveItem({ ...v0, ...v, contract_id: contract.id, price_manual: priceManual });
    if (!it?.id && contract.kind !== 'quote' && contract.locked && v.kind !== 'note') toast(v.change_status === 'approved' ? 'נוסף סעיף חריג מאושר — הוא נכלל בחשבון' : 'כתב הכמויות נעול — הסעיף נוסף כסעיף חריג וממתין לאישור (⋯ ← אישור סעיף חריג)');
    ctx._focusItem = id;
    if (ctx._afterItemSave) { const f = ctx._afterItemSave; ctx._afterItemSave = null; f(id); }
    ctx.refresh();
  }, { wide: true, intro: contract.kind !== 'quote' && contract.locked ? h('div', { class: 'alert info' }, '🔒 כתב הכמויות החוזי נעול: אפשר לשנות תיאור והערות. כמות, מחיר, יחידה ומספור משתנים רק בסעיף חריג (פקודת שינוי) עד שהוא מאושר. סעיף חדש נשמר כחריג ממתין לאישור.') : null });
}

// a unit outside the Binarit list still saves, but SKN export and the measurement type need it mapped
const confirm_unit = (u) => { toast(`יחידה "${u}" אינה ברשימת יחידות בנארית — נשמרה, אך ייתכן שלא תיוצא ל-SKN ותימדד כ"כמות"`, 'err'); return true; };

/** A change / extra-work line in chapter 99 of a structure, numbered automatically. */
export function extraForm(ctx, contract, struct = '01', after = null) {
  const api = ctx.api;
  const num = api.nextNum(contract.id, struct, '99', '01');
  if (!api.sections(contract.id).some((s) => s.code === `${struct}.99`)) attempt(() => api.saveSection(contract.id, `${struct}.99`, { name: 'עבודות נוספות / חריגים' }));
  ctx._afterItemSave = after;
  itemForm(ctx, contract, null, { struct, chapter: '99', sub: '01', num, kind: 'extra', change_status: contract.kind === 'quote' ? 'approved' : 'pending' });
}

function sectionForm(ctx, contract, code, sec) {
  const level = code.split('.').length;
  const what = ['מבנה', 'פרק', 'תת-פרק'][level - 1];
  const fields = [{ name: 'name', label: `שם ${what}`, value: sec?.name ?? '', span: true },
    { name: 'discount', label: `הנחה על כל ה${what} %`, value: sec?.discount ?? '0', numeric: true,
      hint: `חלה על סכום כל הסעיפים ב${what} (לא על מחירי היחידה), ומופיעה כשורת הנחה בסוף ה${what}. סדר: תת-פרק ← פרק ← מבנה ← הנחה כללית.` }];
  if (level === 2) {
    if (contract.kind === 'quote') fields.push({ name: 'markup', label: 'תמחור מדקל: תוספת (+) / הנחה (−) % למחירי היחידה', value: sec?.markup ?? '0', numeric: true, hint: 'משנה רק את מחירי היחידה של סעיפים שתומחרו מדקל — בנפרד מההנחה על הסכום' });
    // chapter 99 (extras) is always outside the general and structure discounts — no choice to offer
    if (code.split('.')[1] !== '99') fields.push({ name: 'exempt', label: 'מוחרג מההנחה הכללית', type: 'checkbox', value: sec ? !!sec.exempt : false });
  }
  const locked = contract.kind !== 'quote' && !!contract.locked;
  const m = formModal(`${['מבנה', 'פרק', 'תת-פרק'][level - 1]} ${code}`, fields, (v) => {
    ctx.api.saveSection(contract.id, code, { name: v.name, discount: v.discount, markup: v.markup, exempt: level === 2 ? v.exempt : undefined });
    ctx.refresh();
  }, { intro: locked ? null : h('div', { style: { display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' } },
    h('button', { class: 'danger sm', type: 'button', onclick: () => { m.close(); deleteSection(ctx, contract, code); } }, `מחיקת ה${what} וכל הסעיפים שבו…`)) });
}

/** Delete a structure / chapter / subchapter after confirming what goes (one Ctrl+Z restores it). */
export async function deleteSection(ctx, contract, code) {
  const api = ctx.api;
  const what = ['מבנה', 'פרק', 'תת-פרק'][code.split('.').length - 1];
  const items = api.sectionScope(contract.id, code);
  const total = items.filter(isBillable).reduce((t, i) => t + lineCents(i.qty, i.price), 0);
  const name = api.sections(contract.id).find((s) => s.code === code)?.name ?? '';
  if (!(await confirmBox(`מחיקת ${what} ${code}`, `למחוק את ה${what} ${code}${name ? ` "${name}"` : ''} עם ${items.length} סעיפים בסך ${money(total)} ₪? אפשר לבטל מיד עם Ctrl+Z.`, { danger: true, ok: 'מחיקה' }))) return;
  const n = attempt(() => api.deleteSection(contract.id, code));
  if (n === undefined) return;
  const sel = loadSel(contract.id);
  if (sel.code && (sel.code === code || sel.code.startsWith(code + '.'))) saveSel(contract.id, { ...sel, code: 'all', itemId: null });
  toast(`נמחק ה${what} ${code} — ${n} סעיפים (Ctrl+Z לביטול)`);
  ctx.refresh();
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
  const sel = { code: 'all', itemId: null, showDekel: !!ctx.dekel && contract.kind === 'quote', q: '', ...loadSel(cid) };
  const items = api.items(cid);
  const sections = new Map(api.sections(cid).map((s) => [s.code, s]));
  const billed = new Set(api.s.all(`SELECT DISTINCT l.item_id FROM bill_lines l JOIN bills b ON b.id=l.bill_id WHERE b.contract_id=? AND b.status='approved'`, [cid]).map((r) => r.item_id));
  const thr = project.dekel_threshold;
  const measured = new Map(api.s.all('SELECT item_id, COUNT(*) n FROM measurements WHERE contract_id=? AND is_group=0 AND cancelled=0 GROUP BY item_id', [cid]).map((r) => [r.item_id, r.n]));

  // ---- tree ----
  const amounts = new Map();
  for (const it of items) if (isBillable(it)) {
    const a = lineCents(it.qty, it.price);
    for (const k of [it.struct, `${it.struct}.${it.chapter}`, `${it.struct}.${it.chapter}.${it.sub}`, 'all']) amounts.set(k, (amounts.get(k) ?? 0) + a);
  }
  // Hierarchy reads at a glance: structure = shaded band with a level badge, chapter = indented
  // under a guide line with its full code, subchapter = smaller row under a second guide line.
  // Every level folds (▾/▸); the fold state is kept per contract for the session.
  const tree = h('nav', { class: 'tree', 'aria-label': 'מבנים ופרקים' });
  const codes = [...new Set(items.flatMap((i) => [i.struct, `${i.struct}.${i.chapter}`, `${i.struct}.${i.chapter}.${i.sub}`]))].sort();
  const folded = new Set(sel.folded ?? []);
  const LV = ['מבנה', 'פרק', 'תת-פרק'];
  const node = (code, lvl, hasKids) => {
    const s = sections.get(code);
    const tags = s ? [s.discount && s.discount !== '0' ? `הנחה ${s.discount}%` : '', isQuote && lvl === 2 && s.markup && s.markup !== '0' ? `דקל ${s.markup}%` : ''].filter(Boolean) : [];
    const tw = hasKids ? h('button', { class: 'tw', 'aria-label': 'קיפול / פתיחה', 'aria-expanded': String(!folded.has(code)), onclick: (e) => {
      e.stopPropagation();
      folded.has(code) ? folded.delete(code) : folded.add(code);
      sel.folded = [...folded]; saveSel(cid, sel);
      const g = e.currentTarget.closest('.tg');
      g.classList.toggle('folded', folded.has(code));
      e.currentTarget.setAttribute('aria-expanded', String(!folded.has(code)));
    } }) : h('span', { class: 'tw none' });
    return h('div', { class: `node l${lvl} ${sel.code === code ? 'on' : ''}`, onclick: () => { sel.code = code; sel.itemId = null; saveSel(cid, sel); ctx.refresh(); },
      ondblclick: () => sectionForm(ctx, contract, code, sections.get(code)), title: `${LV[lvl - 1]} ${code} — לחיצה כפולה להגדרות · לחיצה ימנית לתפריט`,
      oncontextmenu: (e) => { e.preventDefault(); nodeMenu(code, lvl); } },
    tw, lvl === 1 ? h('span', { class: 'lv' }, `${LV[0]} ${code}`) : h('span', { class: 'c' }, code),
    h('span', { class: 'nm' }, s?.name || (lvl === 1 ? '' : `${LV[lvl - 1]} ${code.split('.').at(-1)}`)), ...tags.map((t) => h('span', { class: 'tt', title: t }, t.replace('הנחה ', '−'))),
    h('span', { class: 'amt' }, amounts.has(code) ? money(amounts.get(code)).replace(/\.\d\d$/, '') : ''));
  };
  const nodeMenu = (code, lvl) => {
    const acts = [[`הגדרות ה${LV[lvl - 1]} (שם, הנחה)`, () => sectionForm(ctx, contract, code, sections.get(code))],
      ['+ סעיף כאן', () => { const [s0, c0, t0] = code.split('.'); itemForm(ctx, contract, null, { struct: s0, chapter: c0 ?? '01', sub: t0 ?? '01' }); }],
      boqLocked ? null : [`מחיקת ה${LV[lvl - 1]} וכל הסעיפים שבו…`, () => deleteSection(ctx, contract, code), true]].filter(Boolean);
    const m = modal(`${LV[lvl - 1]} ${code} ${sections.get(code)?.name ?? ''}`, h('div', { class: 'stack' }, acts.map(([l, f, danger]) => h('button', { class: danger ? 'danger' : '', onclick: () => { m.close(); f(); } }, l))));
  };
  const kids = (pre, lvl) => codes.filter((c) => c.split('.').length === lvl && c.startsWith(pre + '.'));
  const branch = (code, lvl) => {
    const ch = lvl < 3 ? kids(code, lvl + 1) : [];
    return h('div', { class: `tg tg${lvl} ${folded.has(code) ? 'folded' : ''}` }, node(code, lvl, ch.length > 0),
      ch.length ? h('div', { class: 'tk' }, ch.map((c) => branch(c, lvl + 1))) : null);
  };
  const setAll = (fold) => { sel.folded = fold ? codes.filter((c) => c.split('.').length < 3) : []; saveSel(cid, sel); ctx.refresh(); };
  tree.append(h('div', { class: 'tree-hd' }, h('h3', {}, 'כתב כמויות'),
    h('button', { class: 'sm ghost', title: 'קיפול הכל — מבנים ופרקים בלבד', onclick: () => setAll(true) }, '⊟'),
    h('button', { class: 'sm ghost', title: 'פתיחת הכל', onclick: () => setAll(false) }, '⊞')),
  h('div', { class: `node all ${sel.code === 'all' ? 'on' : ''}`, onclick: () => { sel.code = 'all'; sel.itemId = null; saveSel(cid, sel); ctx.refresh(); } },
    h('span', { class: 'nm' }, 'כל כתב הכמויות'), h('span', { class: 'amt' }, amounts.has('all') ? money(amounts.get('all')).replace(/\.\d\d$/, '') : '')),
  ...codes.filter((c) => !c.includes('.')).map((c) => branch(c, 1)));

  // ---- grid ----
  const visible = items.filter((it) => (sel.code === 'all' || itemCode(it).startsWith(sel.code + '.'))
    && (!sel.q || `${itemCode(it)} ${it.description} ${it.dekel_code ?? ''}`.includes(sel.q)));
  const tbody = h('tbody');
  const totalCell = new Map();
  const statusTotal = h('b');
  const visTotal = h('b');
  const netTotal = h('b'), vatTotal = h('b');
  const recomputeTotals = () => {
    const all = api.items(cid).filter(isBillable).reduce((s, i) => s + lineCents(i.qty, i.price), 0);
    statusTotal.textContent = money(all);
    // totals after discounts / with VAT follow every inline edit (they were computed once at render)
    const vv = api.contractValue(cid);
    netTotal.textContent = money(vv.net);
    vatTotal.textContent = money(vv.net + Math.round(vv.net * Number(contract.vat_rate) / 100));
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

  const boqLocked = !isQuote && !!contract.locked;
  const cellInput = (it, field, cls = '') => {
    const frozen = boqLocked && !api.itemOpen(it) && ['qty', 'price', 'unit'].includes(field);
    if (frozen) return h('td', { class: `locked locked-boq ${cls}`, title: 'כתב הכמויות החוזי נעול — שינוי דרך סעיף חריג' }, field === 'unit' ? it.unit : qty(it[field]));
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

  // one heading row per level (structure / chapter / subchapter), each styled by level, instead of
  // a single "01.02.03 a · b · c" line — the grid shows the same hierarchy as the tree
  const seen = new Set();
  const lvlName = (code, lvl) => sections.get(code)?.name || `${['מבנה', 'פרק', 'תת-פרק'][lvl - 1]} ${code.split('.').at(-1)}`;
  const selDepth = sel.code === 'all' ? 0 : sel.code.split('.').length;
  for (const it of visible) {
    const path = [it.struct, `${it.struct}.${it.chapter}`, `${it.struct}.${it.chapter}.${it.sub}`];
    path.forEach((code, i) => {
      if (i < selDepth || seen.has(code)) return;
      seen.add(code);
      const amt = amounts.get(code);
      tbody.append(h('tr', { class: `group g${i + 1}` }, h('td', { class: 'code' }, code), h('td', { class: 'gname' }, sections.get(code)?.name ? `${['מבנה', 'פרק', 'תת-פרק'][i]}: ${sections.get(code).name}` : lvlName(code, i + 1)),
        h('td'), h('td'), h('td'), h('td', { class: 'n' }, amt ? money(amt) : ''), h('td'), h('td')));
    });
    const tc = h('td', { class: 'n' }, isBillable(it) ? money(lineCents(it.qty, it.price)) : '');
    totalCell.set(it.id, tc);
    const dc = devCell(it); dc.classList.add('dev');
    const tagKind = it.kind === 'extra' ? h('span', { class: `tag ${it.change_status === 'approved' ? 'ok' : it.change_status === 'rejected' ? 'bad' : 'warn'}` }, `חריג · ${CHG[it.change_status]}`)
      : it.kind === 'note' ? h('span', { class: 'tag' }, 'הערה') : null;
    const tr = h('tr', { class: `${it.kind === 'note' ? 'note' : ''} ${sel.itemId === it.id ? 'sel' : ''}`, 'data-id': it.id },
      h('td', { class: 'code', ondblclick: () => itemForm(ctx, contract, it), title: 'לחיצה כפולה לעריכה מלאה', style: { cursor: 'pointer' } }, itemCode(it),
        !isQuote && measured.has(it.id) ? h('a', { href: `#/m/${it.id}`, class: 'meas-link', title: `דף חישוב: ${measured.get(it.id)} שורות`, onclick: (e) => e.stopPropagation() }, ` 📐${measured.get(it.id)}`) : null,
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

  // ---- quick-add row: type a new line straight into the grid (Enter saves and opens the next) ----
  {
    const lastVis = [...visible].reverse().find((i) => i.kind !== 'note');
    const [s0, c0, t0] = sel.code !== 'all' && sel.code.split('.').length === 3 ? sel.code.split('.')
      : sel.code !== 'all' && lastVis ? [lastVis.struct, lastVis.chapter, lastVis.sub]
        : lastVis ? [lastVis.struct, lastVis.chapter, lastVis.sub] : ['01', '01', '01'];
    const num = api.nextNum(cid, s0, c0, t0);
    const inp = (k, ph, cls = '') => { const i = h('input', { placeholder: ph, class: cls, dir: cls === 'n' ? 'ltr' : null, inputmode: cls === 'n' ? 'decimal' : null, 'data-new': k }); return i; };
    const f = { description: inp('description', '+ סעיף חדש — הקלד תיאור ולחץ Enter'), unit: inp('unit', "יח'"), qty: inp('qty', 'כמות', 'n'), price: inp('price', 'מחיר', 'n') };
    const dl = h('datalist', { id: `units-${cid}` }, UNITS.map((u) => h('option', { value: u })));
    f.unit.setAttribute('list', dl.id);
    const commit = () => {
      if (!f.description.value.trim()) { f.description.focus(); return toast('הקלד תיאור לסעיף', 'err'); }
      const id = attempt(() => api.saveItem({ contract_id: cid, struct: s0, chapter: c0, sub: t0, num, kind: c0 === '99' && !isQuote ? 'extra' : 'contract',
        description: f.description.value, unit: f.unit.value.trim(), qty: f.qty.value || '0', price: f.price.value || '0', price_manual: 1 }));
      if (id === undefined) return;
      if (boqLocked) toast('כתב הכמויות נעול — הסעיף נוסף כסעיף חריג וממתין לאישור');
      ctx._focusNewRow = true; ctx._focusItem = id; ctx.refresh();
    };
    Object.values(f).forEach((i, k, all) => i.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); if (k < all.length - 1 && !e.ctrlKey) all[k + 1].focus(); else commit(); }
      if (e.key === 'Escape') { all.forEach((x) => { x.value = ''; }); }
    }));
    tbody.append(h('tr', { class: 'new-row no-print' },
      h('td', { class: 'code muted', title: 'המספר הבא בתת-הפרק — נקבע אוטומטית' }, `${s0}.${c0}.${t0}.${String(num).padStart(4, '0')}`),
      h('td', { class: 'edit' }, f.description), h('td', { class: 'edit' }, f.unit, dl), h('td', { class: 'edit' }, f.qty), h('td', { class: 'edit' }, f.price),
      h('td', { class: 'muted', colspan: 3, style: { fontSize: '12px' } }, 'Enter = שדה הבא · Enter במחיר = שמירה')));
  }

  function rowMenu(e, it) {
    e.stopPropagation();
    const acts = [
      isQuote ? null : ['📐 דף חישוב כמויות', () => ctx.go(`m/${it.id}`)],
      ['עריכה מלאה', () => itemForm(ctx, contract, it)],
      ['שכפול סעיף', () => itemForm(ctx, contract, { ...it, id: null, num: api.nextNum(cid, it.struct, it.chapter, it.sub) })],
      it.kind === 'extra' && it.change_status !== 'approved' && !isQuote ? ['אישור סעיף חריג', () => attempt(() => { api.approveChange(it.id); ctx.refresh(); }, 'אושר')] : null,
      it.kind === 'extra' && it.change_status === 'pending' && !isQuote ? ['דחיית סעיף חריג', () => attempt(() => { api.approveChange(it.id, 'rejected'); ctx.refresh(); })] : null,
      !isQuote && (contract.locked || billed.has(it.id)) && it.kind !== 'note' ? ['תיקון מחיר (טעות בכתב הכמויות)…', () => formModal(`תיקון מחיר — ${itemCode(it)}`, [
        { name: 'price', label: `מחיר נכון (כעת ${qty(it.price)})`, value: it.price, numeric: true, required: true },
        { name: 'reason', label: 'סיבה (נרשמת בסעיף וביומן)', type: 'textarea', span: true, required: true },
      ], (v) => { api.correctItemPrice(it.id, v.price, v.reason); toast('המחיר תוקן — החשבון הבא יחושב לפיו, כולל ההפרש על כמויות שחויבו קודם'); ctx.refresh(); }, {
        submit: 'תיקון מחיר', intro: h('p', { class: 'muted' }, 'לתיקון טעות במחיר (לא לשינוי מוסכם — לזה משמשים סעיפים חריגים). חשבונות שאושרו לא משתנים; החשבון הפתוח / הבא מחשב את כל הכמות המצטברת במחיר המתוקן, ולכן כולל את ההפרש על מה שחויב קודם.') })] : null,
      it.dekel_code ? ['ניתוק מדקל', () => attempt(() => { api.linkDekel(it.id, null); ctx.refresh(); })] : null,
      isQuote && it.price_manual && it.dekel_price ? ['החזרת מחיר מחושב מדקל', () => attempt(() => { api.saveItem({ ...api.item(it.id), price_manual: 0 }); ctx.refresh(); })] : null,
      ['מחיקה', async () => { if (await confirmBox('מחיקת סעיף', `למחוק את ${itemCode(it)}?`, { danger: true, ok: 'מחיקה' })) attempt(() => { api.deleteItem(it.id); ctx.refresh(); }); }],
    ].filter(Boolean);
    const m = modal(`סעיף ${itemCode(it)}`, h('div', { class: 'stack' }, acts.map(([l, f]) => h('button', { onclick: () => { m.close(); f(); } }, l))));
  }

  const grid = h('div', { class: 'grid-area' }, visible.length || sel.code !== 'all' || !items.length ? h('table', { class: 't lines fixed' },
    h('colgroup', {}, [136, null, 64, 100, 100, 120, 132, 40].map((w) => h('col', { style: w ? { width: `${w}px` } : {} }))),
    h('thead', {}, h('tr', {}, h('th', {}, 'סעיף'), h('th', {}, 'תיאור'), h('th', {}, "יח'"), h('th', { class: 'n' }, isQuote ? 'כמות' : 'כמות מכרז'), h('th', { class: 'n' }, 'מחיר'),
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
  const revCount = isQuote ? api.revisions(cid).length : 0;
  const hasBills = !isQuote && api.bills(cid).length > 0;
  const tb = h('div', { class: 'toolbar no-print' },
    h('button', { class: 'primary', onclick: () => itemForm(ctx, contract, null, curSub()) }, '+ סעיף'),
    h('button', { onclick: () => itemForm(ctx, contract, null, { ...curSub(), kind: 'note' }) }, '+ הערה'),
    // extras and calculation sheets exist only once there is a contract to bill against
    isQuote ? null : h('button', { title: 'עבודה נוספת / חריגה — פרק 99 של המבנה הנבחר', onclick: () => extraForm(ctx, contract, curSub().struct) }, '+ סעיף חריג (99)'),
    h('span', { class: 'sep' }),
    menuButton('ייבוא', [
      ['קובץ SKN (בנארית)', () => importSkn(ctx, contract), boqLocked && 'כתב הכמויות נעול'],
      ['קובץ Excel', () => importExcel(ctx, contract, sel), boqLocked && 'כתב הכמויות נעול'],
      ['קובץ PDF', () => importPdf(ctx, contract), boqLocked && 'כתב הכמויות נעול'],
      ['הדבקה מאקסל', () => pasteImport(ctx, contract, sel), boqLocked && 'כתב הכמויות נעול'],
      '-',
      ['העתקת פרקים מכתב כמויות אחר…', () => copyDialog(ctx, { mode: 'import', into: cid }), boqLocked && 'כתב הכמויות נעול'],
    ]),
    menuButton('ייצוא', [
      ['קובץ SKN (בנארית)', () => exportSkn(ctx, contract)],
      ['קובץ Excel', () => exportExcel(ctx, contract)],
      ['הדפסה / PDF', () => ctx.go(`c/${cid}/print`)],
    ]),
    h('span', { class: 'sep' }),
    h('button', { class: sel.showDekel ? 'primary' : '', onclick: () => { sel.showDekel = !sel.showDekel; saveSel(cid, sel); renderSide(); ctx.refresh(); } }, 'דקל'),
    isQuote ? null : h('button', { onclick: () => { const id = sel.itemId ?? items.find((i) => i.kind !== 'note')?.id; if (id) ctx.go(`m/${id}`); else toast('אין סעיפים', 'err'); } }, '📐 דפי חישוב'),
    menuButton('כלים', [
      ['בדיקת תמחור מול דקל', () => ctx.go(`c/${cid}/dekel`)],
      ['גרסה חדשה (מלאה או לפי פרקים)…', () => copyDialog(ctx, { src: cid, mode: 'version' })],
      ['העתקה לפרויקט אחר…', () => copyDialog(ctx, { src: cid, mode: 'copy' })],
      ['השוואת גרסאות / מהדורות', () => ctx.go(`c/${cid}/compare`)],
      '-',
      ['מכרזי קבלני משנה', () => ctx.go(`c/${cid}/tenders`)],
    ]),
    sel.code !== 'all' ? h('button', { title: 'שם, הנחה / תוספת ופטור — לחיצה כפולה על העץ עושה את אותו הדבר', onclick: () => sectionForm(ctx, contract, sel.code, sections.get(sel.code)) },
      `הגדרות ${['מבנה', 'פרק', 'תת-פרק'][sel.code.split('.').length - 1]} ${sel.code}`) : null,
    h('span', { class: 'sep' }),
    isQuote ? h('button', { onclick: () => issueRevisionDialog(ctx, contract) }, 'הפקת מהדורה') : null,
    isQuote ? h('button', { onclick: () => revisionsDialog(ctx, contract) }, `מהדורות${revCount ? ` (${revCount})` : ''}`) : null,
    isQuote ? h('button', { class: 'primary', onclick: () => convertQuote(ctx, contract) }, 'אישור והמרה לחוזה') : h('button', { onclick: () => ctx.go(`c/${cid}/bills`) }, 'חשבונות'),
    h('button', { onclick: () => contractForm(ctx, contract) }, 'הגדרות'),
    h('div', { class: 'grow' }),
    search);

  const lockChip = isQuote ? null : contract.locked
    ? h('span', { class: 'lock-chip' }, h('span', { class: 'tag', title: 'כמויות ומחירי החוזה קפואים. שינויים — בסעיפים חריגים.' }, '🔒 כתב כמויות נעול'),
      !hasBills ? h('button', { class: 'sm ghost', onclick: () => formModal('ביטול נעילת כתב הכמויות', [{ name: 'reason', label: 'סיבה (נרשמת ביומן)', type: 'textarea', span: true, required: true }],
        (v) => { api.unlockContract(cid, v.reason); ctx.refresh(); }, { submit: 'ביטול נעילה', intro: h('p', { class: 'muted' }, 'אפשרי רק לפני החשבון הראשון — למשל לתיקון טעות בכמות שהועתקה מההצעה.') }) }, 'ביטול נעילה') : null)
    : h('span', { class: 'lock-chip' }, h('span', { class: 'tag warn' }, 'כתב כמויות פתוח לעריכה'),
      h('button', { class: 'sm ghost', onclick: () => attempt(() => { api.lockContract(cid); ctx.refresh(); }, 'כתב הכמויות ננעל') }, 'נעילה'));
  const verChip = contract.version_label ? h('span', { class: 'tag' }, `גרסה: ${contract.version_label}`) : null;

  const v = api.contractValue(cid);
  const status = h('div', { class: 'statusbar' },
    h('span', {}, KIND[contract.kind], contract.kind !== 'quote' ? ` · ${contract.mode === 'periodic' ? 'תקופתי' : 'מצטבר'}` : ''),
    h('span', {}, 'סעיפים: ', h('b', {}, items.filter((i) => i.kind !== 'note').length)),
    h('span', {}, 'בתצוגה: ', visTotal),
    h('span', {}, 'סה"כ ברוטו: ', statusTotal),
    v.chapterDiscount + v.general ? h('span', {}, 'אחרי הנחות: ', netTotal) : null,
    isQuote ? h('span', {}, 'כולל מע"מ: ', vatTotal) : null);
  recomputeTotals();

  const center = h('section', { class: 'center' },
    h('div', { class: 'toolbar', style: { borderBottom: '1px solid var(--line)' } },
      h('h2', {}, contract.name), h('span', { class: 'muted' }, [KIND[contract.kind], contract.party, contract.number].filter(Boolean).join(' · ')),
      isQuote ? h('span', { class: 'tag' }, `מדקל ${Number(contract.quote_markup) > 0 ? '+' : ''}${contract.quote_markup}%`) : null, verChip, lockChip),
    tb, grid, status);

  // Ctrl/⌘+click or Shift+click selects several rows: total in a floating bar, copy to Excel, duplicate, delete
  const byId = new Map(items.map((i) => [i.id, i]));
  const tsvCell = (v) => String(v ?? '').replace(/[\t\n]+/g, ' ');
  multiSelect(tbody, {
    amount: (id) => { const it = api.item(id); return isBillable(it) ? lineCents(it.qty, it.price) : 0; },
    header: ['סעיף', 'תיאור', 'יחידה', 'כמות', 'מחיר', 'סה"כ'].join('\t'),
    tsv: (id) => { const it = byId.get(id); return [itemCode(it), it.description, it.unit, it.qty, it.price, isBillable(it) ? (lineCents(it.qty, it.price) / 100).toFixed(2) : ''].map(tsvCell).join('\t'); },
    // a locked contract BOQ changes only through extra (ch. 99) lines, so no bulk duplicate / delete there
    actions: boqLocked ? [] : [
      ['שכפול', (ids) => { let n = 0; for (const id of ids) { const it = api.item(id); if (attempt(() => api.saveItem({ ...it, id: null, num: api.nextNum(cid, it.struct, it.chapter, it.sub) })) !== undefined) n++; } if (n) toast(`שוכפלו ${n} סעיפים`); ctx.refresh(); }],
      ['מחיקה', async (ids) => {
        if (!(await confirmBox('מחיקת סעיפים', `למחוק ${ids.length} סעיפים?`, { danger: true, ok: 'מחיקה' }))) return;
        let n = 0; for (const id of ids) if (attempt(() => api.deleteItem(id)) !== undefined) n++;
        if (n) toast(`נמחקו ${n} סעיפים`); ctx.refresh();
      }, { danger: true }],
    ],
  });
  const root = h('div', { class: `page full` }, h('div', { class: `ws ${sel.showDekel ? 'with-side' : ''}` }, tree, center, side));
  renderSide();
  setTimeout(() => {
    if (ctx._focusItem) { const r = tbody.querySelector(`tr[data-id="${ctx._focusItem}"]`); r?.scrollIntoView({ block: 'center' }); r?.classList.add('sel'); ctx._focusItem = null; }
    if (ctx._focusNewRow) { ctx._focusNewRow = false; tbody.querySelector('tr.new-row input')?.focus(); }
    if (ctx._keepSearchFocus) { search.focus(); search.setSelectionRange(search.value.length, search.value.length); ctx._keepSearchFocus = false; }
  }, 0);
  return root;
}

function convertQuote(ctx, q) {
  // 3-step wizard: details → payment terms → indexation, so no contract term is forgotten
  const base = { kind: 'client', name: `חוזה — ${q.name.replace(/^הצעה\s*[—–-]?\s*/, '')}`, party: q.party, number: '', vat_rate: q.vat_rate, mode: 'cumulative' };
  formModal('אישור הצעה והמרה לחוזה', contractFields(base, { forConvert: true }), (v) => {
    if (!v.party?.trim() && !(confirm_party())) return false;
    const id = ctx.api.copyContract(q.id, { kind: 'client', name: v.name, party: v.party });
    ctx.api.saveContract({ ...ctx.api.contract(id), ...v });
    toast('נוצר חוזה — כתב הכמויות ננעל');
    ctx.go(`c/${id}`);
  }, { wide: true, submit: 'יצירת חוזה', intro: h('p', { class: 'muted' }, 'ההצעה אושרה: נוצר חוזה מזמין עם כל הסעיפים והמחירים — כמויות ומחירי המכרז — וכתב הכמויות ננעל. מלא את שלושת השלבים (אפשר לחזור לכל לשונית); ניתן לשנות תנאים אחר כך בהגדרות החוזה. ההצעה עצמה נשמרת ללא שינוי.') });
}
const confirm_party = () => { toast('חסר שם מזמין — הוא מודפס בכל חשבון. מלא אותו בלשונית 1.', 'err'); return false; };

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
