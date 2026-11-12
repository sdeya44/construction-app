// Business operations. Every mutation is one transaction; rules are enforced here, not in the UI.
import { nowIso, today } from './store.js';
import { calcBill, contractValue, isBillable, itemCode } from './engine.js';
import { fixed, dec, cents, norm, lineCents, pct } from './money.js';
import { quotePrice } from './dekel.js';

const two = (v) => String(v ?? '').trim().padStart(2, '0').slice(-2);
const must = (x, msg) => { if (!x) throw new Error(msg); return x; };
const text = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const month = (v) => { if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(v ?? '')) throw new Error('חודש לא תקין (YYYY-MM)'); return v; };
const decStr = (v, what = 'ערך') => { try { return norm(v === '' || v == null ? '0' : v); } catch { throw new Error(`${what} לא תקין: ${v}`); } };
const rate = (v, what) => { const s = decStr(v, what); if (fixed(s) < -1000000n || fixed(s) > 1000000n) throw new Error(`${what} מחוץ לטווח`); return s; };

export class Api {
  constructor(store) { this.s = store; }

  // ---------------- company / projects ----------------
  company() { return this.s.get('SELECT * FROM company WHERE id=1'); }
  saveCompany(c) {
    this.s.tx(() => this.s.run('UPDATE company SET name=?, address=?, phone=?, email=?, vat_id=? WHERE id=1',
      [text(c.name, 200), text(c.address), text(c.phone, 60), text(c.email, 120), text(c.vat_id, 30)]), 'עדכון פרטי חברה');
  }
  projects() {
    return this.s.all(`SELECT p.*, (SELECT COUNT(*) FROM contracts c WHERE c.project_id=p.id) AS contracts
      FROM projects p ORDER BY p.status, p.name`);
  }
  project(id) { return must(this.s.get('SELECT * FROM projects WHERE id=?', [id]), 'הפרויקט לא נמצא'); }
  saveProject(p) {
    const name = must(text(p.name, 200), 'שם פרויקט חובה');
    const thr = rate(p.dekel_threshold ?? '15', 'סף סטייה מדקל');
    return this.s.tx(() => {
      if (p.id) {
        this.s.run('UPDATE projects SET name=?, client=?, location=?, status=?, dekel_threshold=?, notes=? WHERE id=?',
          [name, text(p.client), text(p.location), p.status === 'closed' ? 'closed' : 'active', thr, text(p.notes, 4000), p.id]);
        return p.id;
      }
      return this.s.run('INSERT INTO projects (name, client, location, dekel_threshold, notes, created_at) VALUES (?,?,?,?,?,?)',
        [name, text(p.client), text(p.location), thr, text(p.notes, 4000), nowIso()]).id;
    }, p.id ? `עדכון פרויקט ${name}` : `פרויקט חדש ${name}`);
  }
  deleteProject(id) {
    const n = this.s.get(`SELECT COUNT(*) n FROM bills b JOIN contracts c ON c.id=b.contract_id WHERE c.project_id=? AND b.status='approved'`, [id]).n;
    if (n) throw new Error('לא ניתן למחוק פרויקט עם חשבונות מאושרים. סגור אותו במקום זאת.');
    this.s.tx(() => this.s.run('DELETE FROM projects WHERE id=?', [id]), 'מחיקת פרויקט');
  }

  // ---------------- contracts ----------------
  contracts(projectId) {
    return this.s.all('SELECT * FROM contracts WHERE project_id=? ORDER BY kind, name', [projectId]);
  }
  contract(id) { return must(this.s.get('SELECT * FROM contracts WHERE id=?', [id]), 'החוזה לא נמצא'); }
  saveContract(c) {
    const name = must(text(c.name, 200), 'שם חוזה חובה');
    const kind = ['client', 'sub', 'quote'].includes(c.kind) ? c.kind : 'client';
    const f = {
      name, number: text(c.number, 60), party: text(c.party, 200),
      mode: c.mode === 'periodic' ? 'periodic' : 'cumulative',
      vat_rate: rate(c.vat_rate ?? '18', 'מע"מ'), retention_rate: rate(c.retention_rate ?? '0', 'עיכבון'),
      advance_cents: cents(c.advance ?? (c.advance_cents != null ? c.advance_cents / 100 : '0')), advance_rate: rate(c.advance_rate ?? '0', 'קיזוז מקדמה'),
      general_discount: rate(c.general_discount ?? '0', 'הנחה כללית'),
      opening_cents: cents(c.opening ?? (c.opening_cents != null ? c.opening_cents / 100 : '0')),
      index_rule: ['none', 'manual', 'full', 'threshold', 'partial'].includes(c.index_rule) ? c.index_rule : 'none',
      index_series: ['residential', 'roads', 'general'].includes(c.index_series) ? c.index_series : 'residential',
      index_base_month: c.index_base_month ? month(c.index_base_month) : '',
      index_lag: Math.max(0, Math.min(3, Number(c.index_lag) || 0)),
      index_threshold: rate(c.index_threshold ?? '0', 'סף הצמדה'), index_share: rate(c.index_share ?? '100', 'שיעור הצמדה'),
      quote_markup: rate(c.quote_markup ?? '0', 'תוספת/הנחה מדקל'),
      planned_cents: cents(c.planned ?? (c.planned_cents != null ? c.planned_cents / 100 : '0')),
      end_month: c.end_month ? month(c.end_month) : '',
      pay_terms: Math.max(0, Math.min(365, Number(c.pay_terms ?? 60) || 0)),
      parent_id: c.parent_id || null, status: c.status === 'closed' ? 'closed' : 'active',
    };
    if (['full', 'threshold', 'partial'].includes(f.index_rule) && !f.index_base_month) throw new Error('בהצמדה אוטומטית חובה להגדיר חודש מדד בסיס');
    return this.s.tx(() => {
      if (c.id) {
        const old = this.contract(c.id);
        const approved = this.s.get(`SELECT COUNT(*) n FROM bills WHERE contract_id=? AND status='approved'`, [c.id]).n;
        if (approved && (old.mode !== f.mode || old.opening_cents !== f.opening_cents)) throw new Error('לא ניתן לשנות שיטת חוזה או יתרת פתיחה לאחר אישור חשבון');
        const cols = Object.keys(f);
        this.s.run(`UPDATE contracts SET ${cols.map((k) => `${k}=?`).join(',')} WHERE id=?`, [...cols.map((k) => f[k]), c.id]);
        if (old.kind === 'quote' && old.quote_markup !== f.quote_markup) this.repriceQuote(c.id);
        return c.id;
      }
      const cols = ['project_id', 'kind', 'created_at', ...Object.keys(f)];
      return this.s.run(`INSERT INTO contracts (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
        [c.project_id, kind, nowIso(), ...Object.values(f)]).id;
    }, c.id ? `עדכון חוזה ${name}` : `חוזה חדש ${name}`);
  }
  deleteContract(id) {
    if (this.s.get(`SELECT COUNT(*) n FROM bills WHERE contract_id=? AND status='approved'`, [id]).n) throw new Error('לא ניתן למחוק חוזה עם חשבונות מאושרים');
    this.s.tx(() => this.s.run('DELETE FROM contracts WHERE id=?', [id]), 'מחיקת חוזה');
  }

  // ---------------- sections / items ----------------
  sections(contractId) { return this.s.all('SELECT * FROM sections WHERE contract_id=? ORDER BY code', [contractId]); }
  saveSection(contractId, code, { name, discount, markup, exempt }) {
    if (!/^\d{2}(\.\d{2}){0,2}$/.test(code)) throw new Error('קוד מבנה/פרק לא תקין');
    this.s.tx(() => {
      const ex = this.s.get('SELECT * FROM sections WHERE contract_id=? AND code=?', [contractId, code]);
      const v = { name: text(name ?? ex?.name ?? '', 300), discount: rate(discount ?? ex?.discount ?? '0', 'הנחה'),
        markup: rate(markup ?? ex?.markup ?? '0', 'תוספת'), exempt: exempt == null ? (ex?.exempt ?? (code.endsWith('.99') ? 1 : 0)) : (exempt ? 1 : 0) };
      this.s.run(`INSERT INTO sections (contract_id, code, name, discount, markup, exempt) VALUES (?,?,?,?,?,?)
        ON CONFLICT(contract_id, code) DO UPDATE SET name=excluded.name, discount=excluded.discount, markup=excluded.markup, exempt=excluded.exempt`,
        [contractId, code, v.name, v.discount, v.markup, v.exempt]);
      if (markup != null) this.repriceQuote(contractId);
    }, 'עדכון מבנה/פרק');
  }
  items(contractId) {
    return this.s.all('SELECT * FROM items WHERE contract_id=? ORDER BY struct, chapter, sub, num, id', [contractId]);
  }
  item(id) { return must(this.s.get('SELECT * FROM items WHERE id=?', [id]), 'הסעיף לא נמצא'); }

  /** Highest cumulative quantity the item reached in approved bills (null = never billed). */
  billedInfo(itemId) {
    const r = this.s.get(`SELECT COUNT(*) n FROM bill_lines l JOIN bills b ON b.id=l.bill_id
      WHERE l.item_id=? AND b.status='approved'`, [itemId]);
    return r.n > 0;
  }

  saveItem(it) {
    const contract = this.contract(it.contract_id);
    const struct = two(it.struct || '01'), chapter = two(it.chapter), sub = two(it.sub || '01');
    if (!/^\d{2}$/.test(chapter)) throw new Error('פרק חובה (2 ספרות)');
    const num = Number(it.num);
    if (!Number.isInteger(num) || num < 1 || num > 9999) throw new Error('מספר סעיף 1–9999');
    const kind = ['contract', 'extra', 'note'].includes(it.kind) ? it.kind : (chapter === '99' ? 'extra' : 'contract');
    const f = {
      struct, chapter, sub, num, kind, description: text(it.description, 4000), unit: text(it.unit, 20),
      qty: decStr(it.qty, 'כמות'), price: decStr(it.price, 'מחיר'),
      change_status: ['approved', 'pending', 'rejected'].includes(it.change_status) ? it.change_status : (kind === 'extra' && contract.kind !== 'quote' ? 'pending' : 'approved'),
      dekel_code: it.dekel_code || null, dekel_price: it.dekel_price != null && it.dekel_price !== '' ? decStr(it.dekel_price) : null,
      price_manual: it.price_manual == null ? 1 : it.price_manual ? 1 : 0, notes: text(it.notes, 2000), source_item_id: it.source_item_id ?? null,
    };
    if (kind === 'note') { f.qty = '0'; f.price = '0'; f.unit = ''; }
    if (contract.kind === 'quote' && !f.price_manual && f.dekel_price != null) f.price = this.quoteItemPrice(contract, struct, chapter, f.dekel_price);
    return this.s.tx(() => {
      if (it.id) {
        const old = this.item(it.id);
        if (contract.kind !== 'quote' && this.billedInfo(it.id)) {
          if (old.price !== f.price || old.unit !== f.unit || old.struct !== f.struct || old.chapter !== f.chapter || old.sub !== f.sub || old.num !== f.num)
            throw new Error(`הסעיף ${itemCode(old)} חויב בחשבון מאושר — אין לשנות מחיר/יחידה/מספור. שינוי מחיר נעשה בעמודת המחיר בחשבון או בסעיף שינוי.`);
        }
        const cols = Object.keys(f);
        this.s.run(`UPDATE items SET ${cols.map((k) => `${k}=?`).join(',')} WHERE id=?`, [...cols.map((k) => f[k]), it.id]);
        this.ensureSections(it.contract_id, [f]);
        return it.id;
      }
      const cols = ['contract_id', ...Object.keys(f)];
      const id = this.s.run(`INSERT INTO items (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, [it.contract_id, ...Object.values(f)]).id;
      this.ensureSections(it.contract_id, [f]);
      return id;
    });
  }
  nextNum(contractId, struct, chapter, sub) {
    const r = this.s.get('SELECT MAX(num) m FROM items WHERE contract_id=? AND struct=? AND chapter=? AND sub=?', [contractId, struct, chapter, sub]);
    return Math.min(9999, (Math.ceil(((r?.m ?? 0) + 1) / 10)) * 10);
  }
  deleteItem(id) {
    const it = this.item(id);
    if (this.s.get('SELECT COUNT(*) n FROM bill_lines l JOIN bills b ON b.id=l.bill_id WHERE l.item_id=? AND b.status=\'approved\'', [id]).n)
      throw new Error(`הסעיף ${itemCode(it)} חויב בחשבון מאושר ולא ניתן למחיקה`);
    this.s.tx(() => this.s.run('DELETE FROM items WHERE id=?', [id]), `מחיקת סעיף ${itemCode(it)}`);
  }
  approveChange(id, status = 'approved') {
    this.s.tx(() => this.s.run('UPDATE items SET change_status=? WHERE id=?', [status, id]), status === 'approved' ? 'אישור סעיף חריג' : 'דחיית סעיף חריג');
  }
  ensureSections(contractId, items) {
    for (const it of items) {
      for (const code of [it.struct, `${it.struct}.${it.chapter}`, `${it.struct}.${it.chapter}.${it.sub}`])
        this.s.run('INSERT OR IGNORE INTO sections (contract_id, code, exempt) VALUES (?,?,?)', [contractId, code, code.length === 5 && code.endsWith('.99') ? 1 : 0]);
    }
  }

  /** Atomic import (SKN / Excel / paste). mode: 'append' keeps existing items, 'replace' wipes unbilled ones. */
  importItems(contractId, { title, sections = [], items = [] }, mode = 'append') {
    const contract = this.contract(contractId);
    return this.s.tx(() => {
      if (mode === 'replace') {
        if (this.s.get(`SELECT COUNT(*) n FROM bills WHERE contract_id=?`, [contractId]).n) throw new Error('בחוזה יש חשבונות — אפשר רק להוסיף סעיפים, לא להחליף');
        this.s.run('DELETE FROM items WHERE contract_id=?', [contractId]);
      }
      const exists = new Set(this.items(contractId).filter((i) => i.kind !== 'note').map((i) => `${i.struct}.${i.chapter}.${i.sub}.${i.num}`));
      const errors = [];
      for (const it of items) {
        const k = `${two(it.struct)}.${two(it.chapter)}.${two(it.sub)}.${Number(it.num)}`;
        if (it.kind !== 'note') {
          if (exists.has(k)) { errors.push(`סעיף ${k} כבר קיים`); continue; }
          exists.add(k);
        }
        try { this.saveItem({ ...it, contract_id: contractId, change_status: it.kind === 'extra' && contract.kind !== 'quote' ? 'approved' : it.change_status }); }
        catch (e) { errors.push(`${k}: ${e.message}`); }
      }
      if (errors.length) throw new Error(`הייבוא בוטל (לא נשמר דבר):\n${errors.slice(0, 30).join('\n')}${errors.length > 30 ? `\n…ועוד ${errors.length - 30}` : ''}`);
      for (const s of sections) if (s.name) this.saveSection(contractId, s.code, { name: s.name });
      return items.length;
    }, `ייבוא ${items.length} סעיפים`);
  }

  // ---------------- quotes / Dekel ----------------
  quoteItemPrice(contract, struct, chapter, dekelPrice) {
    const sec = this.s.get('SELECT markup FROM sections WHERE contract_id=? AND code=?', [contract.id, `${struct}.${chapter}`]);
    return quotePrice(dekelPrice, contract.quote_markup, sec?.markup ?? '0');
  }
  repriceQuote(contractId) {
    const c = this.contract(contractId);
    if (c.kind !== 'quote') return;
    for (const it of this.s.all('SELECT * FROM items WHERE contract_id=? AND price_manual=0 AND dekel_price IS NOT NULL', [contractId]))
      this.s.run('UPDATE items SET price=? WHERE id=?', [this.quoteItemPrice(c, it.struct, it.chapter, it.dekel_price), it.id]);
  }
  linkDekel(itemId, dk) {
    const it = this.item(itemId);
    return this.saveItem({ ...it, dekel_code: dk?.code ?? null, dekel_price: dk?.price ?? null,
      price_manual: this.contract(it.contract_id).kind === 'quote' && dk ? 0 : it.price_manual });
  }
  /** Copy a quote or client contract into a new contract (quote→contract, client→subcontract). */
  copyContract(fromId, { kind, name, party, keepPrices = true }) {
    const src = this.contract(fromId);
    return this.s.tx(() => {
      const id = this.saveContract({ ...src, id: null, project_id: src.project_id, kind, name, party: party ?? '',
        parent_id: kind === 'sub' ? fromId : null, opening: '0', advance: '0', index_rule: kind === 'quote' ? 'none' : src.index_rule });
      for (const s of this.sections(fromId))
        this.s.run('INSERT OR REPLACE INTO sections (contract_id, code, name, discount, markup, exempt) VALUES (?,?,?,?,?,?)',
          [id, s.code, s.name, kind === 'sub' ? '0' : s.discount, '0', s.exempt]);
      for (const it of this.items(fromId)) {
        if (it.change_status === 'rejected') continue;
        this.s.run(`INSERT INTO items (contract_id, struct, chapter, sub, num, description, unit, qty, price, kind, change_status, dekel_code, dekel_price, price_manual, source_item_id, notes)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
          [id, it.struct, it.chapter, it.sub, it.num, it.description, it.unit, it.qty, keepPrices ? it.price : '0', it.kind, 'approved', it.dekel_code, it.dekel_price, it.id, it.notes]);
      }
      return id;
    }, `העתקת חוזה ל${name}`);
  }

  // ---------------- bills ----------------
  bills(contractId) {
    return this.s.all('SELECT * FROM bills WHERE contract_id=? ORDER BY number', [contractId]).map((b) => this.decorate(b));
  }
  bill(id) { return this.decorate(must(this.s.get('SELECT * FROM bills WHERE id=?', [id]), 'החשבון לא נמצא')); }
  decorate(b) {
    b.doc = typeof b.doc === 'string' ? JSON.parse(b.doc || '{}') : b.doc;
    b.adj = typeof b.adj === 'string' ? JSON.parse(b.adj || '{}') : b.adj;
    b.snap = b.snapshot ? JSON.parse(b.snapshot) : null;
    b.paid = this.s.get('SELECT COALESCE(SUM(amount_cents),0) s FROM payments WHERE bill_id=?', [b.id]).s;
    return b;
  }
  prevApproved(contractId, number) {
    const b = this.s.get(`SELECT * FROM bills WHERE contract_id=? AND number<? AND status='approved' ORDER BY number DESC LIMIT 1`, [contractId, number]);
    return b ? JSON.parse(b.snapshot) : null;
  }
  lines(billId) { return new Map(this.s.all('SELECT * FROM bill_lines WHERE bill_id=?', [billId]).map((l) => [l.item_id, l])); }
  indexValue = (series, m) => this.s.get('SELECT value FROM indices WHERE series=? AND month=?', [series, m])?.value ?? null;

  calc(billId) {
    const b = this.bill(billId);
    if (b.status === 'approved') return b.snap;
    const contract = this.contract(b.contract_id);
    b.purchasesCents = this.s.get('SELECT COALESCE(SUM(amount_cents),0) s FROM purchases WHERE bill_id=?', [b.id]).s;
    return calcBill({ contract, sections: this.sections(contract.id), items: this.items(contract.id), bill: b,
      lines: this.lines(b.id), prev: this.prevApproved(contract.id, b.number), indexValue: this.indexValue });
  }
  contractValue(contractId) {
    const contract = this.contract(contractId);
    return contractValue({ contract, sections: this.sections(contractId), items: this.items(contractId) });
  }

  createBill(contractId, { month: m, type = 'partial' }) {
    const c = this.contract(contractId);
    if (c.kind === 'quote') throw new Error('להצעת מחיר אין חשבונות — המר אותה לחוזה');
    month(m);
    return this.s.tx(() => {
      const open = this.s.get(`SELECT number FROM bills WHERE contract_id=? AND status!='approved'`, [contractId]);
      if (open) throw new Error(`חשבון ${open.number} עדיין פתוח — יש לאשר אותו לפני פתיחת חשבון חדש`);
      if (this.s.get(`SELECT 1 x FROM bills WHERE contract_id=? AND type='final' AND status='approved'`, [contractId])) throw new Error('החשבון הסופי אושר — החוזה סגור');
      const last = this.s.get('SELECT * FROM bills WHERE contract_id=? ORDER BY number DESC LIMIT 1', [contractId]);
      if (last && m < last.month) throw new Error(`חודש הביצוע לפני חודש החשבון הקודם (${last.month})`);
      const number = (last?.number ?? 0) + 1;
      const basis = c.kind === 'sub' ? 'appr' : 'sub';
      const lastDoc = last ? JSON.parse(last.doc) : {};
      const id = this.s.run('INSERT INTO bills (contract_id, number, month, type, basis, doc, adj, created_at) VALUES (?,?,?,?,?,?,?,?)',
        [contractId, number, m, type === 'final' ? 'final' : 'partial', basis, JSON.stringify({ ...lastDoc, date: today(), displayNumber: String(number) }), '{}', nowIso()]).id;
      // cumulative: start from the previous cumulative quantities
      if (c.mode === 'cumulative' && last) {
        const prev = this.prevApproved(contractId, number);
        for (const r of prev?.rows ?? [])
          this.s.run('INSERT INTO bill_lines (bill_id, item_id, q_calc, q_sub, q_appr, percent, price) VALUES (?,?,?,?,?,?,?)',
            [id, r.itemId, r.cumQ, r.cumQ, r.cumQ, r.percent, r.price === r.contractPrice ? null : r.price]);
      }
      return id;
    }, `פתיחת חשבון`);
  }
  assertEditable(b) { if (b.status !== 'draft') throw new Error('ניתן לערוך רק חשבון בהכנה. החזר אותו להכנה כדי לערוך.'); }
  setLine(billId, itemId, patch) {
    const b = this.bill(billId);
    if (!(b.status === 'draft' || (b.status === 'submitted' && Object.keys(patch).every((k) => k === 'q_appr')))) this.assertEditable(b);
    const cur = this.s.get('SELECT * FROM bill_lines WHERE bill_id=? AND item_id=?', [billId, itemId]) ?? {};
    const v = { ...cur };
    for (const k of ['q_calc', 'q_sub', 'q_appr', 'percent', 'price']) if (k in patch)
      v[k] = patch[k] === '' || patch[k] == null ? (k === 'percent' ? '100' : null) : decStr(patch[k], k);
    if (v.percent && (fixed(v.percent) < 0n || fixed(v.percent) > 1000000n)) throw new Error('אחוז ביצוע 0–100');
    if ('note' in patch) v.note = text(patch.note, 500);
    this.s.tx(() => this.s.run(`INSERT INTO bill_lines (bill_id, item_id, q_calc, q_sub, q_appr, percent, price, note) VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(bill_id, item_id) DO UPDATE SET q_calc=excluded.q_calc, q_sub=excluded.q_sub, q_appr=excluded.q_appr, percent=excluded.percent, price=excluded.price, note=excluded.note`,
      [billId, itemId, v.q_calc ?? null, v.q_sub ?? null, v.q_appr ?? null, v.percent ?? '100', v.price ?? null, v.note ?? '']));
  }
  /** Copy one quantity column into another for all lines (e.g. submitted → approved). */
  copyColumn(billId, from, to) {
    const b = this.bill(billId);
    if (!(b.status === 'draft' || (b.status === 'submitted' && to === 'q_appr'))) this.assertEditable(b);
    if (!['q_calc', 'q_sub', 'q_appr'].includes(from) || !['q_calc', 'q_sub', 'q_appr'].includes(to)) throw new Error('עמודה לא תקינה');
    this.s.tx(() => this.s.run(`UPDATE bill_lines SET ${to}=${from} WHERE bill_id=?`, [billId]), 'העתקת כמויות');
  }
  saveBill(billId, { adj, doc, basis, type, month: m }) {
    const b = this.bill(billId);
    this.assertEditable(b);
    const A = { ...b.adj, ...(adj ?? {}) };
    for (const k of ['indexation', 'materials', 'other', 'retention_release', 'advance']) if (A[k] != null && A[k] !== '') A[k] = decStr(A[k], k);
    for (const k of ['retention_rate', 'vat']) if (A[k] != null && A[k] !== '') A[k] = rate(A[k], k); else delete A[k];
    if (A.other_label != null) A.other_label = text(A.other_label, 80);
    const D = { ...b.doc, ...(doc ?? {}) };
    for (const k of Object.keys(D)) if (typeof D[k] === 'string') D[k] = text(D[k], 400);
    this.s.tx(() => this.s.run('UPDATE bills SET adj=?, doc=?, basis=?, type=?, month=? WHERE id=?',
      [JSON.stringify(A), JSON.stringify(D), ['calc', 'sub', 'appr'].includes(basis) ? basis : b.basis,
        type === 'final' || type === 'partial' ? type : b.type, m ? month(m) : b.month, billId]));
  }
  submitBill(id) {
    const b = this.bill(id); this.assertEditable(b);
    this.s.tx(() => this.s.run(`UPDATE bills SET status='submitted' WHERE id=?`, [id]), `הגשת חשבון ${b.number}`);
  }
  returnBill(id) {
    const b = this.bill(id);
    if (b.status !== 'submitted') throw new Error('רק חשבון שהוגש ניתן להחזיר להכנה');
    this.s.tx(() => this.s.run(`UPDATE bills SET status='draft' WHERE id=?`, [id]), `החזרת חשבון ${b.number} להכנה`);
  }
  approveBill(id) {
    const b = this.bill(id);
    if (b.status === 'approved') throw new Error('החשבון כבר מאושר');
    const earlier = this.s.get(`SELECT number FROM bills WHERE contract_id=? AND number<? AND status!='approved'`, [b.contract_id, b.number]);
    if (earlier) throw new Error(`יש לאשר קודם את חשבון ${earlier.number}`);
    const r = this.calc(id);
    if (r.indexation.missing.length) throw new Error(`לא ניתן לאשר: ${r.warnings.find((w) => w.type === 'index').text}`);
    const contract = this.contract(b.contract_id);
    const company = this.company();
    r.frozen = { at: nowIso(), contract: { name: contract.name, number: contract.number, party: contract.party, kind: contract.kind, general_discount: contract.general_discount },
      company: { name: company.name }, sections: this.sections(contract.id) };
    this.s.tx(() => {
      this.s.run(`UPDATE bills SET status='approved', snapshot=?, approved_at=? WHERE id=?`, [JSON.stringify(r), nowIso(), id]);
      if (b.type === 'final') this.s.run(`UPDATE contracts SET status='closed' WHERE id=?`, [b.contract_id]);
    }, `אישור חשבון ${b.number}`);
  }
  deleteBill(id) {
    const b = this.bill(id);
    if (b.status === 'approved') throw new Error('לא ניתן למחוק חשבון מאושר');
    const later = this.s.get('SELECT 1 x FROM bills WHERE contract_id=? AND number>?', [b.contract_id, b.number]);
    if (later) throw new Error('ניתן למחוק רק את החשבון האחרון');
    this.s.tx(() => this.s.run('DELETE FROM bills WHERE id=?', [id]), `מחיקת חשבון ${b.number}`);
  }

  // ---------------- payments ----------------
  payments(billId) { return this.s.all('SELECT * FROM payments WHERE bill_id=? ORDER BY date', [billId]); }
  addPayment(billId, { amount, date, method, ref, note }) {
    const b = this.bill(billId);
    if (b.status !== 'approved') throw new Error('תשלום נרשם רק לחשבון מאושר');
    const a = cents(amount);
    if (a <= 0) throw new Error('סכום חיובי בלבד');
    if (a > b.snap.due - b.paid) throw new Error(`הסכום חורג מהיתרה לתשלום`);
    this.s.tx(() => this.s.run('INSERT INTO payments (bill_id, amount_cents, date, method, ref, note) VALUES (?,?,?,?,?,?)',
      [billId, a, date || today(), text(method, 40), text(ref, 60), text(note, 300)]), `תשלום לחשבון ${b.number}`);
  }
  deletePayment(id) { this.s.tx(() => this.s.run('DELETE FROM payments WHERE id=?', [id]), 'מחיקת תשלום'); }

  // ---------------- indices ----------------
  indices(series) { return this.s.all('SELECT * FROM indices WHERE series=? ORDER BY month DESC', [series]); }
  setIndex(series, m, value, source = 'manual') {
    month(m);
    const v = decStr(value, 'ערך מדד');
    if (fixed(v) <= 0n) throw new Error('ערך מדד חיובי בלבד');
    this.s.tx(() => this.s.run(`INSERT INTO indices (series, month, value, source) VALUES (?,?,?,?)
      ON CONFLICT(series, month) DO UPDATE SET value=excluded.value, source=excluded.source`, [series, m, v, source]));
  }
  deleteIndex(series, m) { this.s.tx(() => this.s.run('DELETE FROM indices WHERE series=? AND month=?', [series, m])); }

  // ---------------- stage 2: reopen, payment allocation, purchases, cut-off, profit, defects ----------------
  /** Reopen the last approved bill (no later bills, no payments). Requires a reason; audited. */
  reopenBill(id, reason) {
    const b = this.bill(id);
    if (b.status !== 'approved') throw new Error('רק חשבון מאושר ניתן לפתיחה מחדש');
    const why = text(reason, 300);
    if (why.length < 3) throw new Error('חובה לציין סיבה לפתיחה מחדש');
    if (this.s.get('SELECT 1 x FROM bills WHERE contract_id=? AND number>?', [b.contract_id, b.number])) throw new Error('קיימים חשבונות מאוחרים יותר — ניתן לפתוח מחדש רק את החשבון האחרון');
    if (b.paid > 0) throw new Error('לחשבון נרשמו תשלומים — יש למחוק אותם לפני פתיחה מחדש');
    this.s.tx(() => {
      this.s.run(`UPDATE bills SET status='submitted', snapshot=NULL, approved_at=NULL WHERE id=?`, [id]);
      if (b.type === 'final') this.s.run(`UPDATE contracts SET status='active' WHERE id=?`, [b.contract_id]);
      this.s.run('INSERT INTO audit (at, action, detail) VALUES (?,?,?)', [nowIso(), `פתיחה מחדש של חשבון ${b.number}`, why]);
    });
  }

  /** Open balances of approved bills of a contract, oldest first. */
  openBills(contractId) {
    return this.bills(contractId).filter((b) => b.status === 'approved' && b.snap.due - b.paid > 0)
      .map((b) => ({ id: b.id, number: b.number, month: b.month, due: b.snap.due, paid: b.paid, balance: b.snap.due - b.paid }));
  }
  /**
   * One receipt split across bills. allocations: [{bill_id, amount}] — omitted = oldest first.
   * The allocations must add up to the receipt exactly and stay within each bill's balance.
   */
  addReceipt(contractId, { amount, date, method, ref, note, allocations }) {
    const total = cents(amount);
    if (total <= 0) throw new Error('סכום חיובי בלבד');
    const open = this.openBills(contractId);
    let alloc;
    if (allocations?.length) {
      alloc = allocations.map((a) => ({ bill_id: Number(a.bill_id), cents: cents(a.amount) })).filter((a) => a.cents > 0);
    } else {
      let left = total; alloc = [];
      for (const b of open) { if (!left) break; const c = Math.min(left, b.balance); alloc.push({ bill_id: b.id, cents: c }); left -= c; }
      if (left) throw new Error(`הסכום גבוה מהיתרה הפתוחה בכל החשבונות (${(open.reduce((s, b) => s + b.balance, 0) / 100).toFixed(2)})`);
    }
    const sum = alloc.reduce((s, a) => s + a.cents, 0);
    if (sum !== total) throw new Error(`סכום ההקצאות (${(sum / 100).toFixed(2)}) שונה מסכום התשלום (${(total / 100).toFixed(2)})`);
    const bal = new Map(open.map((b) => [b.id, b.balance]));
    for (const a of alloc) {
      if (!bal.has(a.bill_id)) throw new Error('הקצאה לחשבון שאינו מאושר או שאינו פתוח');
      if (a.cents > bal.get(a.bill_id)) throw new Error('ההקצאה חורגת מיתרת החשבון');
    }
    return this.s.tx(() => {
      let group = null;
      for (const a of alloc) {
        const id = this.s.run('INSERT INTO payments (bill_id, amount_cents, date, method, ref, note, group_id) VALUES (?,?,?,?,?,?,?)',
          [a.bill_id, a.cents, date || today(), text(method, 40), text(ref, 60), text(note, 300), group]).id;
        if (group == null) { group = id; this.s.run('UPDATE payments SET group_id=? WHERE id=?', [id, id]); }
      }
      return { group, allocations: alloc };
    }, `קבלת תשלום ${(total / 100).toFixed(2)} ₪`);
  }

  // purchases (קיזוז רכש)
  purchases(contractId) { return this.s.all('SELECT * FROM purchases WHERE contract_id=? ORDER BY date, id', [contractId]); }
  savePurchase(p) {
    const type = ['order', 'delivery', 'invoice'].includes(p.type) ? p.type : 'invoice';
    const f = { type, doc_no: text(p.doc_no, 60), date: p.date || today(), supplier: text(p.supplier, 120), description: text(p.description, 300),
      amount_cents: cents(p.amount ?? (p.amount_cents != null ? p.amount_cents / 100 : '0')), parent_id: p.parent_id ? Number(p.parent_id) : null };
    if (f.amount_cents < 0) throw new Error('סכום שלילי');
    return this.s.tx(() => {
      if (p.id) {
        const old = this.s.get('SELECT * FROM purchases WHERE id=?', [p.id]);
        if (old.bill_id && this.bill(old.bill_id).status === 'approved') throw new Error('המסמך קוזז בחשבון מאושר ואינו ניתן לעריכה');
        this.s.run('UPDATE purchases SET type=?, doc_no=?, date=?, supplier=?, description=?, amount_cents=?, parent_id=? WHERE id=?', [...Object.values(f), p.id]);
        return p.id;
      }
      return this.s.run('INSERT INTO purchases (contract_id, type, doc_no, date, supplier, description, amount_cents, parent_id) VALUES (?,?,?,?,?,?,?,?)', [p.contract_id, ...Object.values(f)]).id;
    }, 'רישום מסמך רכש');
  }
  deletePurchase(id) {
    const p = this.s.get('SELECT * FROM purchases WHERE id=?', [id]);
    if (p?.bill_id && this.bill(p.bill_id).status === 'approved') throw new Error('המסמך קוזז בחשבון מאושר');
    this.s.tx(() => this.s.run('DELETE FROM purchases WHERE id=?', [id]), 'מחיקת מסמך רכש');
  }
  /** Offset a purchase document in a draft bill (billId = null removes it). Blocks double counting along a chain. */
  assignPurchase(id, billId) {
    const p = this.s.get('SELECT * FROM purchases WHERE id=?', [id]);
    if (!p) throw new Error('המסמך לא נמצא');
    if (p.bill_id && this.bill(p.bill_id).status === 'approved') throw new Error('המסמך כבר קוזז בחשבון מאושר');
    if (billId) {
      const b = this.bill(billId);
      if (b.contract_id !== p.contract_id) throw new Error('המסמך שייך לחוזה אחר');
      this.assertEditable(b);
      // walk the chain both ways: none of the linked documents may be offset already
      const chain = new Set([id]);
      for (let cur = p; cur?.parent_id; cur = this.s.get('SELECT * FROM purchases WHERE id=?', [cur.parent_id])) chain.add(cur.parent_id);
      let grew = true;
      while (grew) { grew = false; for (const r of this.purchases(p.contract_id)) if (r.parent_id && chain.has(r.parent_id) && !chain.has(r.id)) { chain.add(r.id); grew = true; } }
      const dup = this.purchases(p.contract_id).find((r) => chain.has(r.id) && r.id !== id && r.bill_id);
      if (dup) throw new Error(`מסמך מקושר (${dup.doc_no || dup.id}) כבר קוזז — קיזוז נוסף יספור את אותו רכש פעמיים`);
    }
    this.s.tx(() => this.s.run('UPDATE purchases SET bill_id=? WHERE id=?', [billId || null, id]), billId ? 'קיזוז מסמך רכש בחשבון' : 'ביטול קיזוז מסמך רכש');
  }

  /** Status of every contract as of a cut-off date (approvals and payments up to that day). */
  statusAsOf(date, projectId = null) {
    const day = date || today();
    const cs = this.s.all(`SELECT c.*, p.name AS project FROM contracts c JOIN projects p ON p.id=c.project_id WHERE c.kind!='quote' ${projectId ? 'AND c.project_id=?' : ''} ORDER BY p.name, c.kind, c.name`, projectId ? [projectId] : []);
    return cs.map((c) => {
      const last = this.s.get(`SELECT * FROM bills WHERE contract_id=? AND status='approved' AND substr(approved_at,1,10)<=? ORDER BY number DESC LIMIT 1`, [c.id, day]);
      const snap = last ? JSON.parse(last.snapshot) : null;
      const billed = this.s.all(`SELECT snapshot FROM bills WHERE contract_id=? AND status='approved' AND substr(approved_at,1,10)<=?`, [c.id, day])
        .reduce((s, r) => s + JSON.parse(r.snapshot).due, 0);
      const paid = this.s.get(`SELECT COALESCE(SUM(p.amount_cents),0) s FROM payments p JOIN bills b ON b.id=p.bill_id WHERE b.contract_id=? AND p.date<=?`, [c.id, day]).s;
      const scope = c.planned_cents || this.contractValue(c.id).net;
      return { contract: c, project: c.project, lastBill: last?.number ?? null, lastMonth: last?.month ?? null, cumNet: snap?.cumNet ?? 0,
        scope, progress: scope ? (snap?.cumNet ?? 0) / scope : 0, billed, paid, balance: billed - paid, retention: snap?.cumRetention ?? 0 };
    });
  }

  /** Margin between the client contract and its subcontracts, per item (planned and executed). */
  profit(clientId) {
    const client = this.contract(clientId);
    if (client.kind !== 'client') throw new Error('דוח רווח מחושב לחוזה מזמין');
    const subs = this.s.all(`SELECT * FROM contracts WHERE parent_id=? AND kind='sub'`, [clientId]);
    const lastSnap = (cid) => { const b = this.s.get(`SELECT snapshot FROM bills WHERE contract_id=? AND status='approved' ORDER BY number DESC LIMIT 1`, [cid]); return b ? JSON.parse(b.snapshot) : null; };
    const cSnap = lastSnap(clientId);
    const cRows = new Map((cSnap?.rows ?? []).map((r) => [r.itemId, r]));
    const lines = [];
    for (const s of subs) {
      const sSnap = lastSnap(s.id);
      const sRows = new Map((sSnap?.rows ?? []).map((r) => [r.itemId, r]));
      for (const si of this.items(s.id)) {
        if (si.kind === 'note' || !si.source_item_id) continue;
        const ci = this.s.get('SELECT * FROM items WHERE id=?', [si.source_item_id]);
        if (!ci) continue;
        const plannedClient = lineCents(ci.qty, ci.price), plannedSub = lineCents(ci.qty, si.price);
        // margin on executed work = client-approved quantity × (client price − sub price); the sub's
        // own billing (execSub) is shown for reference but its timing must not inflate the margin
        const cRow = cRows.get(ci.id);
        const execQ = cRow?.cumQ ?? '0';
        const execClient = cRow?.cumGross ?? 0, execSub = sRows.get(si.id)?.cumGross ?? 0;
        const execMargin = lineCents(execQ, cRow?.price ?? ci.price) - lineCents(execQ, si.price);
        lines.push({ sub: s.name, subId: s.id, item: ci, subPrice: si.price, plannedClient, plannedSub, plannedMargin: plannedClient - plannedSub,
          execQ, execClient, execSub, execMargin, unitMargin: dec(fixed(ci.price) - fixed(si.price)) });
      }
    }
    const sum = (k) => lines.reduce((a, l) => a + l[k], 0);
    return { client, subs, lines, totals: { plannedClient: sum('plannedClient'), plannedSub: sum('plannedSub'), plannedMargin: sum('plannedMargin'),
      execClient: sum('execClient'), execSub: sum('execSub'), execMargin: sum('execMargin') } };
  }

  // defects (ליקויים)
  defects(projectId) { return this.s.all('SELECT * FROM defects WHERE project_id=? ORDER BY status, opened DESC, id DESC', [projectId]); }
  saveDefect(d) {
    const desc = must(text(d.description, 1000), 'תיאור הליקוי חובה');
    const f = { contract_id: d.contract_id ? Number(d.contract_id) : null, item_id: d.item_id ? Number(d.item_id) : null, location: text(d.location, 200), description: desc,
      severity: ['low', 'normal', 'high', 'critical'].includes(d.severity) ? d.severity : 'normal', responsible: text(d.responsible, 120),
      status: ['open', 'in_progress', 'fixed', 'closed'].includes(d.status) ? d.status : 'open', due: d.due || '', notes: text(d.notes, 2000) };
    f.closed = f.status === 'closed' ? (d.closed || today()) : '';
    return this.s.tx(() => {
      if (d.id) { const cols = Object.keys(f); this.s.run(`UPDATE defects SET ${cols.map((k) => `${k}=?`).join(',')} WHERE id=?`, [...Object.values(f), d.id]); return d.id; }
      const cols = ['project_id', 'opened', ...Object.keys(f)];
      return this.s.run(`INSERT INTO defects (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, [d.project_id, d.opened || today(), ...Object.values(f)]).id;
    }, d.id ? 'עדכון ליקוי' : 'ליקוי חדש');
  }
  deleteDefect(id) { this.s.tx(() => this.s.run('DELETE FROM defects WHERE id=?', [id]), 'מחיקת ליקוי'); }

  // ---------------- stage 3: tenders, cash flow, management report ----------------
  tenders(contractId) {
    return this.s.all('SELECT t.*, (SELECT COUNT(*) FROM bidders b WHERE b.tender_id=t.id) bidders, (SELECT COUNT(*) FROM tender_items i WHERE i.tender_id=t.id) items FROM tenders t WHERE contract_id=? ORDER BY id DESC', [contractId]);
  }
  tender(id) {
    const t = must(this.s.get('SELECT * FROM tenders WHERE id=?', [id]), 'המכרז לא נמצא');
    t.items = this.s.all('SELECT i.* FROM tender_items ti JOIN items i ON i.id=ti.item_id WHERE ti.tender_id=? ORDER BY i.struct, i.chapter, i.sub, i.num', [id]);
    t.bidders = this.s.all('SELECT * FROM bidders WHERE tender_id=? ORDER BY id', [id]);
    return t;
  }
  /** scope: '' (all) or a code prefix such as '01', '01.02' or '01.02.01'. */
  createTender(contractId, { name, scope = '', due = '' }) {
    const nm = must(text(name, 200), 'שם המכרז חובה');
    const items = this.items(contractId).filter((i) => isBillable(i) && (!scope || itemCode(i).startsWith(scope + '.')));
    if (!items.length) throw new Error('אין סעיפים בהיקף שנבחר');
    return this.s.tx(() => {
      const id = this.s.run('INSERT INTO tenders (contract_id, name, scope, due, created_at) VALUES (?,?,?,?,?)', [contractId, nm, scope, due || '', nowIso()]).id;
      for (const i of items) this.s.run('INSERT INTO tender_items (tender_id, item_id) VALUES (?,?)', [id, i.id]);
      return id;
    }, `מכרז חדש: ${nm}`);
  }
  deleteTender(id) { this.s.tx(() => this.s.run('DELETE FROM tenders WHERE id=?', [id]), 'מחיקת מכרז'); }
  saveBidder(b) {
    const name = must(text(b.name, 160), 'שם המציע חובה');
    const f = [name, text(b.contact, 200), rate(b.discount ?? '0', 'הנחה'), text(b.note, 500)];
    return this.s.tx(() => (b.id
      ? (this.s.run('UPDATE bidders SET name=?, contact=?, discount=?, note=? WHERE id=?', [...f, b.id]), b.id)
      : this.s.run('INSERT INTO bidders (tender_id, name, contact, discount, note) VALUES (?,?,?,?,?)', [b.tender_id, ...f]).id), 'עדכון מציע');
  }
  deleteBidder(id) { this.s.tx(() => this.s.run('DELETE FROM bidders WHERE id=?', [id]), 'מחיקת מציע'); }
  setBidPrice(bidderId, itemId, price) {
    if (price === '' || price == null) return this.s.tx(() => this.s.run('DELETE FROM bid_prices WHERE bidder_id=? AND item_id=?', [bidderId, itemId]));
    const v = decStr(price, 'מחיר');
    if (fixed(v) < 0n) throw new Error('מחיר שלילי');
    this.s.tx(() => this.s.run('INSERT INTO bid_prices (bidder_id, item_id, price) VALUES (?,?,?) ON CONFLICT(bidder_id, item_id) DO UPDATE SET price=excluded.price', [bidderId, itemId, v]));
  }
  /** rows: [{code, price}] from a filled bid form; matched by item code. Atomic. */
  importBidPrices(bidderId, rows) {
    const b = must(this.s.get('SELECT * FROM bidders WHERE id=?', [bidderId]), 'המציע לא נמצא');
    const items = new Map(this.tender(b.tender_id).items.map((i) => [itemCode(i), i]));
    let matched = 0; const unmatched = [], bad = [];
    this.s.tx(() => {
      for (const r of rows) {
        const it = items.get(String(r.code).trim());
        if (!it) { unmatched.push(r.code); continue; }
        if (r.price === '' || r.price == null) continue;
        try { this.setBidPrice(bidderId, it.id, String(r.price).replace(/[,₪\s]/g, '')); matched++; } catch { bad.push(r.code); }
      }
    }, `קליטת הצעת מחיר: ${b.name}`);
    return { matched, unmatched, bad, missing: items.size - matched };
  }
  /** Side-by-side comparison: estimate (contract price), Dekel, each bidder; totals after bidder discount. */
  compareTender(id) {
    const t = this.tender(id);
    const prices = new Map(t.bidders.map((b) => [b.id, new Map(this.s.all('SELECT item_id, price FROM bid_prices WHERE bidder_id=?', [b.id]).map((r) => [r.item_id, r.price]))]));
    const rows = t.items.map((it) => {
      const bids = {}; let low = null;
      for (const b of t.bidders) {
        const p = prices.get(b.id).get(it.id);
        bids[b.id] = p ?? null;
        if (p != null && (low == null || fixed(p) < fixed(bids[low]))) low = b.id;
      }
      return { item: it, estimate: it.price, dekel: it.dekel_price, bids, low };
    });
    const totals = {};
    for (const b of t.bidders) {
      let gross = 0, missing = 0;
      for (const r of rows) { const p = r.bids[b.id]; if (p == null) missing++; else gross += lineCents(r.item.qty, p); }
      const discount = pct(gross, b.discount);
      totals[b.id] = { gross, discount, net: gross - discount, missing };
    }
    const estimate = rows.reduce((a, r) => a + lineCents(r.item.qty, r.estimate), 0);
    const complete = t.bidders.filter((b) => !totals[b.id].missing);
    const best = complete.sort((a, b) => totals[a.id].net - totals[b.id].net)[0]?.id ?? null;
    return { tender: t, rows, totals, estimate, best };
  }
  /** Award to one bidder: creates a subcontract with the bidder's prices, linked to the source items. */
  awardTender(id, bidderId) {
    const cmp = this.compareTender(id);
    const t = cmp.tender;
    if (t.status === 'awarded') throw new Error('המכרז כבר נסגר');
    const b = must(t.bidders.find((x) => x.id === bidderId), 'המציע לא נמצא');
    if (cmp.totals[b.id].missing) throw new Error(`חסרים מחירים ל-${cmp.totals[b.id].missing} סעיפים בהצעה של ${b.name}`);
    const src = this.contract(t.contract_id);
    return this.s.tx(() => {
      const cid = this.saveContract({ project_id: src.project_id, kind: 'sub', name: `${t.name} — ${b.name}`, party: b.name, parent_id: src.kind === 'client' ? src.id : null,
        mode: src.mode, vat_rate: src.vat_rate, general_discount: b.discount });
      const secs = new Map(this.sections(src.id).map((x) => [x.code, x]));
      for (const it of t.items) {
        for (const code of [it.struct, `${it.struct}.${it.chapter}`, `${it.struct}.${it.chapter}.${it.sub}`]) {
          const sx = secs.get(code);
          this.s.run('INSERT OR IGNORE INTO sections (contract_id, code, name, exempt) VALUES (?,?,?,?)', [cid, code, sx?.name ?? '', sx?.exempt ?? 0]);
        }
        this.s.run(`INSERT INTO items (contract_id, struct, chapter, sub, num, description, unit, qty, price, kind, change_status, dekel_code, dekel_price, price_manual, source_item_id, notes)
          VALUES (?,?,?,?,?,?,?,?,?,?, 'approved', ?,?,1,?, '')`,
          [cid, it.struct, it.chapter, it.sub, it.num, it.description, it.unit, it.qty, cmp.rows.find((r) => r.item.id === it.id).bids[b.id], it.kind, it.dekel_code, it.dekel_price, it.id]);
      }
      this.s.run(`UPDATE tenders SET status='awarded', awarded_bidder=?, awarded_contract=? WHERE id=?`, [b.id, cid, id]);
      return cid;
    }, `זכייה במכרז ${t.name}: ${b.name}`);
  }

  /**
   * Monthly cash flow. In = client contracts, out = subcontracts.
   * actual: payments by date. expected: open balances of approved bills at bill month + payment terms
   * (שוטף + N days), overdue ones in the current month; forecast: remaining scope spread evenly
   * until the contract's end month, invoiced monthly and paid after the same terms.
   */
  cashflow({ projectId = null, from = null, to = null, now = today() } = {}) {
    const cur = now.slice(0, 7);
    const addM = (m, k) => { const [y, mo] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mo - 1 + k, 1)); return d.toISOString().slice(0, 7); };
    const payMonth = (billMonth, terms) => { const [y, mo] = billMonth.split('-').map(Number); const end = new Date(Date.UTC(y, mo, 0)); end.setUTCDate(end.getUTCDate() + terms); return end.toISOString().slice(0, 7); };
    const cs = this.s.all(`SELECT * FROM contracts WHERE kind IN ('client','sub') ${projectId ? 'AND project_id=?' : ''}`, projectId ? [projectId] : []);
    const months = new Map();
    const cell = (m) => { if (!months.has(m)) months.set(m, { month: m, inActual: 0, inExpected: 0, outActual: 0, outExpected: 0 }); return months.get(m); };
    const warnings = [];
    for (const c of cs) {
      const dir = c.kind === 'client' ? 'in' : 'out';
      for (const p of this.s.all('SELECT p.* FROM payments p JOIN bills b ON b.id=p.bill_id WHERE b.contract_id=?', [c.id])) cell(p.date.slice(0, 7))[`${dir}Actual`] += p.amount_cents;
      const bills = this.bills(c.id);
      for (const b of bills.filter((x) => x.status === 'approved')) {
        const bal = b.snap.due - b.paid;
        if (bal <= 0) continue;
        let m = payMonth(b.month, c.pay_terms);
        if (m < cur) m = cur;
        cell(m)[`${dir}Expected`] += bal;
      }
      const last = [...bills].reverse().find((x) => x.status === 'approved');
      const scope = c.planned_cents || this.contractValue(c.id).net;
      const remaining = Math.max(0, scope - (last?.snap.cumNet ?? 0));
      if (remaining > 0 && c.status === 'active') {
        if (!c.end_month) { warnings.push(`${c.name}: לא הוגדר חודש סיום — היתרה לביצוע (${(remaining / 100).toFixed(0)} ₪) לא נכללה בתחזית`); continue; }
        const start = addM(last ? (last.month > cur ? last.month : cur) : cur, last && last.month >= cur ? 1 : 0);
        const ms = []; for (let m = start; m <= c.end_month; m = addM(m, 1)) ms.push(m);
        if (!ms.length) { warnings.push(`${c.name}: חודש הסיום (${c.end_month}) עבר אך נותרה יתרה לביצוע`); continue; }
        const withVat = remaining + pct(remaining, c.vat_rate);
        ms.forEach((m, k) => { const share = k === ms.length - 1 ? withVat - Math.floor(withVat / ms.length) * (ms.length - 1) : Math.floor(withVat / ms.length); cell(payMonth(m, c.pay_terms))[`${dir}Expected`] += share; });
      }
    }
    let list = [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
    if (from) list = list.filter((r) => r.month >= from);
    if (to) list = list.filter((r) => r.month <= to);
    let run = 0;
    for (const r of list) { r.net = r.inActual + r.inExpected - r.outActual - r.outExpected; run += r.net; r.cumulative = run; r.past = r.month < cur; }
    return { months: list, warnings, current: cur };
  }

  /** One row per project with the figures a manager checks first. */
  managementReport() {
    return this.projects().map((p) => {
      const cs = this.contracts(p.id);
      const agg = (kind) => {
        let scope = 0, cumNet = 0, billed = 0, paid = 0;
        for (const c of cs.filter((x) => x.kind === kind)) {
          const bills = this.bills(c.id).filter((b) => b.status === 'approved');
          scope += c.planned_cents || this.contractValue(c.id).net;
          cumNet += bills.at(-1)?.snap.cumNet ?? 0;
          billed += bills.reduce((a, b) => a + b.snap.due, 0);
          paid += bills.reduce((a, b) => a + b.paid, 0);
        }
        return { scope, cumNet, billed, paid, balance: billed - paid };
      };
      const client = agg('client'), sub = agg('sub');
      let plannedMargin = 0, execMargin = 0, overrunItems = 0, overrunCents = 0, extraCents = 0, dekelFlags = 0;
      for (const c of cs.filter((x) => x.kind === 'client')) {
        const pr = this.profit(c.id); plannedMargin += pr.totals.plannedMargin; execMargin += pr.totals.execMargin;
        const snap = this.bills(c.id).filter((b) => b.status === 'approved').at(-1)?.snap;
        for (const r of snap?.rows ?? []) { if (r.cat.over > 0) { overrunItems++; overrunCents += r.cat.over; } extraCents += r.cat.extra; }
      }
      for (const c of cs) for (const it of this.items(c.id)) {
        if (!it.dekel_price || it.kind === 'note' || !Number(it.dekel_price)) continue;
        if (Math.abs(Number(it.price) / Number(it.dekel_price) - 1) * 100 > Number(p.dekel_threshold)) dekelFlags++;
      }
      const defects = this.defects(p.id).filter((d) => d.status !== 'closed');
      return { project: p, client, sub, progress: client.scope ? client.cumNet / client.scope : 0, plannedMargin, execMargin,
        overrunItems, overrunCents, extraCents, dekelFlags, openDefects: defects.length, overdueDefects: defects.filter((d) => d.due && d.due < today()).length };
    });
  }

  audit(limit = 300) { return this.s.all('SELECT * FROM audit ORDER BY id DESC LIMIT ?', [limit]); }
}
