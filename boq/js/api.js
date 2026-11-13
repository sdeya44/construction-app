// Business operations. Every mutation is one transaction; rules are enforced here, not in the UI.
import { nowIso, today } from './store.js';
import { calcBill, contractValue, isBillable, itemCode } from './engine.js';
import { fixed, dec, cents, norm, lineCents, pct } from './money.js';
import { quotePrice } from './dekel.js';
import { calcRow, approvedRowValue, approvalIsStale, baseVal, itemUnitKind, rowSig } from './meas.js';

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
    const logo = c.logo === undefined ? this.company().logo : (c.logo && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(c.logo) && c.logo.length < 3_000_000 ? c.logo : null);
    this.s.tx(() => this.s.run('UPDATE company SET name=?, address=?, phone=?, email=?, vat_id=?, logo=?, logo_mode=? WHERE id=1',
      [text(c.name, 200), text(c.address), text(c.phone, 60), text(c.email, 120), text(c.vat_id, 30), logo, c.logo_mode === 'corner' ? 'corner' : 'wide']), 'עדכון פרטי חברה');
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
        this.s.run('UPDATE projects SET name=?, client=?, location=?, status=?, dekel_threshold=?, notes=?, supervisor=?, manager=? WHERE id=?',
          [name, text(p.client), text(p.location), p.status === 'closed' ? 'closed' : 'active', thr, text(p.notes, 4000), text(p.supervisor, 120), text(p.manager, 120), p.id]);
        return p.id;
      }
      return this.s.run('INSERT INTO projects (name, client, location, dekel_threshold, notes, created_at, supervisor, manager) VALUES (?,?,?,?,?,?,?,?)',
        [name, text(p.client), text(p.location), thr, text(p.notes, 4000), nowIso(), text(p.supervisor, 120), text(p.manager, 120)]).id;
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
      meas_areas: c.meas_areas ? 1 : 0,
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
    const contract = this.contract(contractId);
    this.s.tx(() => {
      const ex = this.s.get('SELECT * FROM sections WHERE contract_id=? AND code=?', [contractId, code]);
      const v = { name: text(name ?? ex?.name ?? '', 300), discount: rate(discount ?? ex?.discount ?? '0', 'הנחה'),
        markup: rate(markup ?? ex?.markup ?? '0', 'תוספת'), exempt: exempt == null ? (ex?.exempt ?? (code.endsWith('.99') ? 1 : 0)) : (exempt ? 1 : 0) };
      if (contract.kind !== 'quote' && contract.locked && (v.discount !== (ex?.discount ?? '0') || v.exempt !== (ex?.exempt ?? v.exempt)))
        throw new Error('כתב הכמויות החוזי נעול — הנחת פרק ופטור מהנחה כללית הם תנאי חוזה ואינם ניתנים לשינוי');
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
    const locked = contract.kind !== 'quote' && !!contract.locked;
    // a locked contract accepts new lines only as change items awaiting approval (notes are free)
    // (the user may record at once that the client already approved it — explicit 'approved' only)
    if (locked && !it.id && f.kind !== 'note') { f.kind = 'extra'; f.change_status = it.change_status === 'approved' ? 'approved' : 'pending'; }
    try {
    return this.s.tx(() => {
      if (it.id) {
        const old = this.item(it.id);
        if (contract.kind !== 'quote' && this.billedInfo(it.id)) {
          if (old.price !== f.price || old.unit !== f.unit || old.struct !== f.struct || old.chapter !== f.chapter || old.sub !== f.sub || old.num !== f.num)
            throw new Error(`הסעיף ${itemCode(old)} חויב בחשבון מאושר — אין לשנות מחיר/יחידה/מספור. שינוי מחיר נעשה בעמודת המחיר בחשבון או בסעיף שינוי.`);
        }
        if (locked && !this.itemOpen(old)) {
          if (old.qty !== f.qty || old.price !== f.price || old.unit !== f.unit || old.kind !== f.kind || old.change_status !== f.change_status
            || old.struct !== f.struct || old.chapter !== f.chapter || old.sub !== f.sub || old.num !== f.num)
            throw new Error(`כתב הכמויות החוזי נעול — אין לשנות כמות, מחיר, יחידה או מספור של ${itemCode(old)}. שינוי נעשה בסעיף חריג (פקודת שינוי) שמאושר בנפרד.`);
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
    }, '', it.id ? `עריכת סעיף ${struct}.${chapter}.${sub}.${String(num).padStart(4, '0')}` : 'הוספת סעיף');
    } catch (e) {
      if (/UNIQUE constraint failed: items/.test(e.message)) throw new Error(`מספר סעיף ${struct}.${chapter}.${sub}.${String(num).padStart(4, '0')} כבר קיים בתת-פרק — בחר מספר אחר`);
      throw e;
    }
  }
  /**
   * Correct a wrong unit price in a locked / billed contract (an error, not a change order). Approved
   * bills stay frozen; the next bill recalculates the cumulative quantity at the corrected price, so the
   * difference on quantities billed earlier is settled in that bill. Reason required; audited.
   */
  correctItemPrice(itemId, price, reason) {
    const it = this.item(itemId);
    const c = this.contract(it.contract_id);
    const why = text(reason, 300);
    if (why.length < 3) throw new Error('חובה לציין סיבה לתיקון המחיר');
    const p = decStr(price, 'מחיר');
    if (fixed(p) < 0n) throw new Error('מחיר לא תקין');
    if (p === it.price) throw new Error('המחיר זהה למחיר הקיים');
    const open = this.s.get(`SELECT number, status FROM bills WHERE contract_id=? AND status!='approved'`, [c.id]);
    if (open?.status === 'submitted') throw new Error(`חשבון ${open.number} הוגש — החזר אותו לתיקונים לפני תיקון מחיר`);
    const day = today();
    this.s.tx(() => {
      this.s.run('UPDATE items SET price=?, price_manual=1, notes=? WHERE id=?',
        [p, text(`${it.notes ? it.notes + ' · ' : ''}מחיר תוקן ${day}: ${it.price} ← ${p} (${why})`, 2000), itemId]);
      this.s.run('INSERT INTO audit (at, action, detail) VALUES (?,?,?)', [nowIso(), `תיקון מחיר ${itemCode(it)}: ${it.price} ← ${p}`, why]);
    });
  }
  /** A line that may still change in a locked contract: a note, or a change item not yet approved. */
  itemOpen(it) { return it.kind === 'note' || (it.kind === 'extra' && it.change_status !== 'approved'); }
  nextNum(contractId, struct, chapter, sub) {
    const r = this.s.get('SELECT MAX(num) m FROM items WHERE contract_id=? AND struct=? AND chapter=? AND sub=?', [contractId, struct, chapter, sub]);
    return Math.min(9999, (Math.ceil(((r?.m ?? 0) + 1) / 10)) * 10);
  }
  deleteItem(id) {
    const it = this.item(id);
    const c = this.contract(it.contract_id);
    if (c.kind !== 'quote' && c.locked && !this.itemOpen(it)) throw new Error(`כתב הכמויות החוזי נעול — לא ניתן למחוק את ${itemCode(it)}`);
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
    if (contract.kind !== 'quote' && contract.locked) throw new Error('כתב הכמויות החוזי נעול — לא ניתן לייבא אליו. הוסף סעיפים חריגים, או בטל את הנעילה (רק לפני החשבון הראשון).');
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
  /**
   * Copy a BOQ into a new contract / quote. projectId = target project (default: same project);
   * chapters = ['SS.CC', …] to copy part of the BOQ; asVersion = the copy joins the source's version family.
   */
  copyContract(fromId, { kind, name, party, keepPrices = true, projectId = null, chapters = null, asVersion = false, versionLabel = '' }) {
    const src = this.contract(fromId);
    const target = projectId ? this.project(projectId).id : src.project_id;
    const pick = chapters?.length ? new Set(chapters) : null;
    const inScope = (code) => !pick || [...pick].some((c) => code === c.split('.')[0] || code === c || code.startsWith(c + '.'));
    const same = target === src.project_id;
    return this.s.tx(() => {
      const id = this.saveContract({ ...src, id: null, project_id: target, kind, name, party: party ?? '',
        parent_id: kind === 'sub' && same ? fromId : null, opening: '0', advance: '0', index_rule: kind === 'quote' ? 'none' : src.index_rule });
      let group = null;
      if (asVersion) { group = src.version_group ?? src.id; if (!src.version_group) this.s.run('UPDATE contracts SET version_group=? WHERE id=?', [group, src.id]); }
      // a quote converted to a client contract freezes the tender quantities and prices
      this.s.run('UPDATE contracts SET origin_id=?, version_group=?, version_label=?, locked=? WHERE id=?',
        [fromId, group, text(versionLabel, 60), src.kind === 'quote' && kind === 'client' ? 1 : 0, id]);
      for (const s of this.sections(fromId)) {
        if (!inScope(s.code)) continue;
        this.s.run('INSERT OR REPLACE INTO sections (contract_id, code, name, discount, markup, exempt) VALUES (?,?,?,?,?,?)',
          [id, s.code, s.name, kind === 'sub' ? '0' : s.discount, kind === 'quote' ? s.markup : '0', s.exempt]);
      }
      for (const it of this.items(fromId)) {
        if (it.change_status === 'rejected') continue;
        if (!inScope(`${it.struct}.${it.chapter}`)) continue;
        this.s.run(`INSERT INTO items (contract_id, struct, chapter, sub, num, description, unit, qty, price, kind, change_status, dekel_code, dekel_price, price_manual, source_item_id, notes)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
          [id, it.struct, it.chapter, it.sub, it.num, it.description, it.unit, it.qty, keepPrices ? it.price : '0', it.kind, 'approved', it.dekel_code, it.dekel_price, it.id, it.notes]);
      }
      return id;
    }, `העתקת ${src.name} ל${name}`);
  }
  /** Contracts of the same version family (including the contract itself). */
  versions(contractId) {
    const c = this.contract(contractId);
    if (!c.version_group) return [c];
    return this.s.all('SELECT * FROM contracts WHERE version_group=? ORDER BY id', [c.version_group]);
  }
  allContracts() {
    return this.s.all('SELECT c.*, p.name AS project_name FROM contracts c JOIN projects p ON p.id=c.project_id ORDER BY p.name, c.kind, c.id');
  }
  lockContract(id) {
    const c = this.contract(id);
    if (c.kind === 'quote') throw new Error('הצעת מחיר אינה ננעלת — המר אותה לחוזה');
    this.s.tx(() => this.s.run('UPDATE contracts SET locked=1 WHERE id=?', [id]), `נעילת כתב כמויות ${c.name}`);
  }
  unlockContract(id, reason) {
    const c = this.contract(id);
    const why = text(reason, 300);
    if (why.length < 3) throw new Error('חובה לציין סיבה לביטול הנעילה');
    if (this.s.get('SELECT 1 x FROM bills WHERE contract_id=?', [id])) throw new Error('בחוזה יש חשבונות — לא ניתן לבטל נעילה. שינויים נעשים דרך סעיפים חריגים.');
    this.s.tx(() => {
      this.s.run('UPDATE contracts SET locked=0 WHERE id=?', [id]);
      this.s.run('INSERT INTO audit (at, action, detail) VALUES (?,?,?)', [nowIso(), `ביטול נעילת כתב כמויות ${c.name}`, why]);
    });
  }

  /** Compare two BOQs ({contractId} or {revisionId}) item by item. */
  boqSource(spec) {
    if (spec.revisionId) {
      const r = this.revision(spec.revisionId);
      return { label: `${r.snapshot.contract.name} · מהדורה ${r.rev}`, items: r.snapshot.items, sections: r.snapshot.sections, contract: r.snapshot.contract };
    }
    const c = this.contract(spec.contractId);
    return { label: c.name + (c.version_label ? ` (${c.version_label})` : ''), items: this.items(c.id), sections: this.sections(c.id), contract: c };
  }
  compareBoq(aSpec, bSpec) {
    const A = this.boqSource(aSpec), B = this.boqSource(bSpec);
    const key = (i) => `${i.struct}.${i.chapter}.${i.sub}.${String(i.num).padStart(4, '0')}`;
    const live = (list) => new Map(list.filter((i) => i.kind !== 'note' && i.change_status !== 'rejected').map((i) => [key(i), i]));
    const ma = live(A.items), mb = live(B.items);
    const names = new Map([...A.sections, ...B.sections].map((s) => [s.code, s.name]));
    const rows = [];
    const chapters = new Map();
    for (const k of [...new Set([...ma.keys(), ...mb.keys()])].sort()) {
      const a = ma.get(k), b = mb.get(k);
      const ta = a ? lineCents(a.qty, a.price) : 0, tb = b ? lineCents(b.qty, b.price) : 0;
      const status = !a ? 'added' : !b ? 'removed' : (norm(a.qty) !== norm(b.qty) || norm(a.price) !== norm(b.price) || a.unit !== b.unit) ? 'changed' : 'same';
      const it = b ?? a;
      rows.push({ code: k, chapterKey: `${it.struct}.${it.chapter}`, description: it.description, unit: it.unit, status,
        a: a ? { qty: a.qty, price: a.price, total: ta } : null, b: b ? { qty: b.qty, price: b.price, total: tb } : null, diff: tb - ta,
        qtyChanged: !!(a && b && norm(a.qty) !== norm(b.qty)), priceChanged: !!(a && b && norm(a.price) !== norm(b.price)) });
      const ck = `${it.struct}.${it.chapter}`;
      const g = chapters.get(ck) ?? { key: ck, name: names.get(ck) ?? '', a: 0, b: 0 };
      g.a += ta; g.b += tb; chapters.set(ck, g);
    }
    const count = (s) => rows.filter((r) => r.status === s).length;
    // totals after discounts (structure / chapter / subchapter / general) — what negotiation changes
    const va = contractValue({ contract: A.contract, sections: A.sections, items: A.items }), vb = contractValue({ contract: B.contract, sections: B.sections, items: B.items });
    const disc = (v) => ({ net: v.net, discounts: v.gross - v.beforeGeneral, general: v.general, generalRate: v.generalRate });
    const secDiff = [];
    const sa = new Map(A.sections.map((s) => [s.code, s])), sb = new Map(B.sections.map((s) => [s.code, s]));
    for (const code of [...new Set([...sa.keys(), ...sb.keys()])].sort()) {
      const x = sa.get(code)?.discount ?? '0', y = sb.get(code)?.discount ?? '0';
      if (norm(x) !== norm(y)) secDiff.push({ code, name: (sb.get(code) ?? sa.get(code))?.name ?? '', a: x, b: y });
    }
    if (norm(A.contract.general_discount ?? '0') !== norm(B.contract.general_discount ?? '0')) secDiff.push({ code: 'כללי', name: 'הנחה כללית על הפרויקט', a: A.contract.general_discount ?? '0', b: B.contract.general_discount ?? '0' });
    return { a: A.label, b: B.label, rows, chapters: [...chapters.values()], valueA: disc(va), valueB: disc(vb), discountChanges: secDiff,
      totals: { a: rows.reduce((s, r) => s + (r.a?.total ?? 0), 0), b: rows.reduce((s, r) => s + (r.b?.total ?? 0), 0) },
      counts: { added: count('added'), removed: count('removed'), changed: count('changed'), same: count('same') } };
  }

  // ---------------- quote revisions (מהדורות) ----------------
  issueRevision(contractId, { recipient = '', note = '' } = {}) {
    const c = this.contract(contractId);
    const items = this.items(contractId), sections = this.sections(contractId);
    const value = this.contractValue(contractId);
    return this.s.tx(() => {
      const rev = (this.s.get('SELECT MAX(rev) m FROM quote_revisions WHERE contract_id=?', [contractId]).m ?? 0) + 1;
      return this.s.run('INSERT INTO quote_revisions (contract_id, rev, created_at, recipient, note, total_cents, snapshot) VALUES (?,?,?,?,?,?,?)',
        [contractId, rev, nowIso(), text(recipient || c.party, 200), text(note, 500), value.net, JSON.stringify({ contract: c, items, sections, value })]).id;
    }, `הפקת מהדורה ל${c.name}`);
  }
  revisions(contractId) {
    return this.s.all('SELECT id, contract_id, rev, created_at, recipient, note, total_cents FROM quote_revisions WHERE contract_id=? ORDER BY rev DESC', [contractId]);
  }
  revision(id) {
    const r = must(this.s.get('SELECT * FROM quote_revisions WHERE id=?', [id]), 'המהדורה לא נמצאה');
    return { ...r, snapshot: JSON.parse(r.snapshot) };
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
    b.reopened = b.status !== 'approved' && this.s.get('SELECT status FROM bill_events WHERE bill_id=? ORDER BY id DESC LIMIT 1', [b.id])?.status === 'reopened';
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
    const prev = this.prevApproved(contract.id, b.number);
    const lines = this.measuredLines(contract, b, this.lines(b.id), prev);
    const r = calcBill({ contract, sections: this.sections(contract.id), items: this.items(contract.id), bill: b,
      lines, prev, indexValue: this.indexValue });
    const pend = this.measPending(contract.id);
    if (pend) r.warnings.push({ type: 'meas-pending', text: `${pend} שורות מדידה ממתינות לאישור — לא נכללות בכמות המאושרת` });
    return r;
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
      // the first bill freezes the contract BOQ (tender quantities)
      if (!c.locked) this.s.run('UPDATE contracts SET locked=1 WHERE id=?', [contractId]);
      this.billEvent(id, 'draft', 'החשבון נפתח');
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
      [billId, itemId, v.q_calc ?? null, v.q_sub ?? null, v.q_appr ?? null, v.percent ?? '100', v.price ?? null, v.note ?? '']), '', 'עדכון כמות בחשבון');
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
  /** Presentation of a bill: 'cumulative' (Binarit) or 'period' (this month only). Allowed in any status. */
  setBillView(id, view) {
    const b = this.bill(id);
    const doc = { ...b.doc, view: view === 'period' ? 'period' : 'cumulative' };
    this.s.tx(() => this.s.run('UPDATE bills SET doc=? WHERE id=?', [JSON.stringify(doc), id]), '', view === 'period' ? 'הצגת חשבון חודשי' : 'הצגת חשבון מצטבר');
  }
  submitBill(id, note = '') {
    const b = this.bill(id); this.assertEditable(b);
    this.s.tx(() => {
      // what we claimed becomes the starting point of the reviewer's approved quantities; from now on
      // the bill is calculated on the approved column, so no manual "basis" switch is needed
      if (b.basis !== 'appr') {
        this.s.run(`UPDATE bill_lines SET q_appr=${b.basis === 'calc' ? 'q_calc' : 'q_sub'} WHERE bill_id=? AND ${b.basis === 'calc' ? 'q_calc' : 'q_sub'} IS NOT NULL`, [id]);
        this.s.run(`UPDATE bills SET basis='appr' WHERE id=?`, [id]);
      }
      this.s.run(`UPDATE bills SET status='submitted' WHERE id=?`, [id]);
      this.billEvent(id, 'submitted', text(note, 300) || (b.returned ? 'הוגש מחדש לאחר תיקונים' : 'הוגש'));
    }, `הגשת חשבון ${b.number}`);
  }
  /** Returned for corrections (בשינויים): editable again, and marked as returned. */
  returnBill(id, note = '') {
    const b = this.bill(id);
    if (b.status !== 'submitted') throw new Error('רק חשבון שהוגש ניתן להחזיר לתיקונים');
    this.s.tx(() => {
      // back to editing our claim (sub contracts are always entered as approved quantities)
      this.s.run(`UPDATE bills SET status='draft', returned=1, basis=? WHERE id=?`, [this.contract(b.contract_id).kind === 'sub' ? 'appr' : 'sub', id]);
      this.billEvent(id, 'returned', text(note, 300) || 'הוחזר לתיקונים');
    }, `החזרת חשבון ${b.number} לתיקונים`);
  }
  billEvent(billId, status, note = '') { this.s.run('INSERT INTO bill_events (bill_id, at, status, note) VALUES (?,?,?,?)', [billId, nowIso(), status, note]); }
  billEvents(billId) { return this.s.all('SELECT * FROM bill_events WHERE bill_id=? ORDER BY id', [billId]); }
  /** Approved-but-unpaid balance of the bills before this one (what the client still owes). */
  outstandingBefore(contractId, number) {
    return this.bills(contractId).filter((b) => b.number < number && b.status === 'approved').reduce((s, b) => s + (b.snap.due - b.paid), 0);
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
    const v = this.measValidate(contract.id);
    if (v.critical.length) throw new Error(`לא ניתן לאשר — שגיאות בדפי החישוב:\n${v.critical.slice(0, 12).join('\n')}`);
    r.frozen = { at: nowIso(), contract: { name: contract.name, number: contract.number, party: contract.party, kind: contract.kind, general_discount: contract.general_discount },
      company: { name: company.name }, sections: this.sections(contract.id) };
    this.s.tx(() => {
      r.frozen.measurements = this.measStamp(contract.id, b);
      this.s.run(`UPDATE bills SET status='approved', snapshot=?, approved_at=? WHERE id=?`, [JSON.stringify(r), nowIso(), id]);
      this.billEvent(id, 'approved', 'אושר ונעול');
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
  /** Why an approved bill cannot be reopened right now (null = it can). */
  reopenBlock(id) {
    const b = this.bill(id);
    if (b.status !== 'approved') return 'רק חשבון מאושר ניתן לפתיחה מחדש';
    const later = this.s.get('SELECT number FROM bills WHERE contract_id=? AND number>? ORDER BY number LIMIT 1', [b.contract_id, b.number]);
    if (later) return `קיים חשבון ${later.number} אחריו — אפשר לפתוח מחדש רק את החשבון האחרון. תיקון כמויות נעשה בחשבון ${later.number} (המצטבר מתקן את הקודם), או מחק את חשבון ${later.number} אם הוא עדיין בהכנה.`;
    if (b.paid > 0) return 'לחשבון נרשמו תשלומים — מחק אותם בלשונית "תשלומים" לפני פתיחה מחדש';
    return null;
  }
  /** Month after the last bill (default for a new bill). */
  nextBillMonth(contractId) {
    const last = this.s.get('SELECT month FROM bills WHERE contract_id=? ORDER BY number DESC LIMIT 1', [contractId]);
    if (!last) return today().slice(0, 7);
    const [y, m] = last.month.split('-').map(Number);
    return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  }
  /** Everything waiting for the user across all projects (home screen). */
  attention() {
    const out = [];
    const contracts = this.s.all(`SELECT c.*, p.name AS project_name FROM contracts c JOIN projects p ON p.id=c.project_id WHERE p.status='active' AND c.kind!='quote'`);
    for (const c of contracts) {
      for (const b of this.bills(c.id)) {
        const where = `${c.project_name} · ${c.name} · חשבון ${b.number}`;
        if (b.reopened) out.push({ kind: 'returned', text: 'נפתח מחדש לתיקון', where, go: `b/${b.id}` });
        else if (b.status === 'draft') out.push({ kind: b.returned ? 'returned' : 'draft', text: b.returned ? 'הוחזר לתיקונים' : 'בהכנה', where, go: `b/${b.id}` });
        else if (b.status === 'submitted' && !b.reopened) out.push({ kind: 'submitted', text: c.kind === 'sub' ? 'ממתין לאישורנו' : 'הוגש — ממתין לאישור המזמין', where, go: `b/${b.id}`, since: this.s.get(`SELECT at FROM bill_events WHERE bill_id=? AND status='submitted' ORDER BY id DESC LIMIT 1`, [b.id])?.at });
        else if (b.snap && b.snap.due - b.paid > 0) out.push({ kind: c.kind === 'sub' ? 'topay' : 'unpaid', text: c.kind === 'sub' ? 'לתשלום לקבלן' : 'ממתין לתשלום', where, go: `b/${b.id}/pay`, amount: b.snap.due - b.paid });
        if (b.status !== 'approved') {
          try {
            const r = this.calc(b.id);
            if (r.indexation.missing.length) out.push({ kind: 'index', text: `חסר ערך מדד (${r.indexation.missing.join(', ')})`, where, go: 'indices' });
            const pend = r.warnings.find((w) => w.type === 'meas-pending');
            if (pend) out.push({ kind: 'meas', text: pend.text, where, go: `b/${b.id}/sheets` });
          } catch { /* incomplete bill */ }
        }
      }
      const changes = this.s.get(`SELECT COUNT(*) n FROM items WHERE contract_id=? AND kind='extra' AND change_status='pending'`, [c.id]).n;
      if (changes) out.push({ kind: 'change', text: `${changes} סעיפים חריגים ממתינים לאישור`, where: `${c.project_name} · ${c.name}`, go: `c/${c.id}` });
    }
    return out;
  }
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
      this.s.run('DELETE FROM meas_history WHERE bill_id=?', [id]);
      if (b.type === 'final') this.s.run(`UPDATE contracts SET status='active' WHERE id=?`, [b.contract_id]);
      this.s.run('INSERT INTO audit (at, action, detail) VALUES (?,?,?)', [nowIso(), `פתיחה מחדש של חשבון ${b.number}`, why]);
      this.billEvent(id, 'reopened', why);
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

  // ---------------- quantity calculation sheets (דפי חישוב) ----------------
  _measObj(r, hist) {
    return { id: r.id, itemId: r.item_id, contractId: r.contract_id, sort: r.sort, isGroup: !!r.is_group, groupLabel: r.group_label ?? '',
      desc: r.descr ?? '', area: r.area ?? '', shape: r.shape, d1: r.d1 ?? '', d2: r.d2 ?? '', d3: r.d3 ?? '', t: r.t ?? '', qty: r.qty ?? '',
      sign: r.sign === -1 ? -1 : 1, notes: r.notes ?? '', cancelled: !!r.cancelled, approval: r.approval ? JSON.parse(r.approval) : null,
      history: (hist ?? []).map((h) => ({ billId: h.bill_id, accountNumber: String(h.bill_number), action: h.action, value: Number(h.value), prevValue: Number(h.prev_value),
        claimedValue: h.claimed == null ? null : Number(h.claimed), approvalStatus: h.approval_status, approvalNote: h.approval_note ?? '', date: h.date })) };
  }
  /** Measurement rows of a contract (optionally one item), in entry order, with their history. */
  measRows(contractId, itemId = null) {
    const rows = this.s.all(`SELECT * FROM measurements WHERE contract_id=? ${itemId ? 'AND item_id=?' : ''} ORDER BY sort, id`, itemId ? [contractId, itemId] : [contractId]);
    const hist = new Map();
    for (const h of this.s.all(`SELECT h.* FROM meas_history h JOIN measurements m ON m.id=h.meas_id WHERE m.contract_id=? ORDER BY h.bill_number, h.id`, [contractId])) {
      if (!hist.has(h.meas_id)) hist.set(h.meas_id, []);
      hist.get(h.meas_id).push(h);
    }
    return rows.map((r) => this._measObj(r, hist.get(r.id)));
  }
  meas(id) { const r = must(this.s.get('SELECT * FROM measurements WHERE id=?', [id]), 'שורת המדידה לא נמצאה'); return this.measRows(r.contract_id, r.item_id).find((m) => m.id === id); }
  /** Measurement edits follow the open bill: allowed with no open bill or a draft one. */
  assertMeasEditable(contractId, approvalOnly = false) {
    const open = this.s.get(`SELECT status, number FROM bills WHERE contract_id=? AND status!='approved'`, [contractId]);
    if (open && open.status === 'submitted' && !approvalOnly) throw new Error(`חשבון ${open.number} הוגש — עריכת מדידות אפשרית רק בהחלטות אישור, או לאחר החזרה להכנה`);
    if (this.contract(contractId).status === 'closed') throw new Error('החוזה סגור');
  }
  addMeas(contractId, itemId, { isGroup = false, after = null } = {}) {
    this.assertMeasEditable(contractId);
    const it = this.item(itemId);
    if (it.contract_id !== contractId) throw new Error('הסעיף שייך לחוזה אחר');
    if (!isGroup && it.qsrc !== 'meas') this.setQtySource(itemId, 'meas');
    let sort = (this.s.get('SELECT MAX(sort) m FROM measurements WHERE contract_id=? AND item_id=?', [contractId, itemId]).m ?? 0) + 1;
    if (after) { const a = this.s.get('SELECT sort FROM measurements WHERE id=?', [after]); const nx = this.s.get('SELECT MIN(sort) m FROM measurements WHERE item_id=? AND sort>?', [itemId, a.sort]).m; sort = nx == null ? a.sort + 1 : (a.sort + nx) / 2; }
    const shape = itemUnitKind(it) === 'length' ? 'קו' : itemUnitKind(it) === 'count' ? 'יחידה' : 'מלבן';
    return this.s.tx(() => this.s.run('INSERT INTO measurements (contract_id, item_id, sort, is_group, group_label, shape) VALUES (?,?,?,?,?,?)',
      [contractId, itemId, sort, isGroup ? 1 : 0, isGroup ? 'קבוצה חדשה' : '', shape]).id);
  }
  /**
   * Bill quantity source of an item. Switching to the calculation sheet carries what was already
   * billed manually as an opening balance, so the cumulative never drops by surprise.
   */
  setQtySource(itemId, src) {
    const it = this.item(itemId);
    const c = this.contract(it.contract_id);
    if (!['manual', 'meas'].includes(src)) throw new Error('מקור כמות לא תקין');
    if (it.qsrc === src) return;
    if (c.kind !== 'quote') this.assertMeasEditable(c.id);
    this.s.tx(() => {
      let opening = it.meas_opening;
      if (src === 'meas' && opening == null) {
        const last = this.s.get(`SELECT snapshot FROM bills WHERE contract_id=? AND status='approved' ORDER BY number DESC LIMIT 1`, [c.id]);
        const row = last ? JSON.parse(last.snapshot).rows.find((r) => r.itemId === itemId) : null;
        const hasHist = this.s.get('SELECT 1 x FROM meas_history h JOIN measurements m ON m.id=h.meas_id WHERE m.item_id=?', [itemId]);
        if (row && fixed(row.cumQ) !== 0n && !hasHist) opening = row.cumQ;
      }
      this.s.run('UPDATE items SET qsrc=?, meas_opening=? WHERE id=?', [src, opening ?? null, itemId]);
    }, src === 'meas' ? `מקור כמות: דף חישוב (${itemCode(it)})` : `מקור כמות: ידני (${itemCode(it)})`);
  }
  /** Bill number in which this row was approved and frozen, or null while it may still change. */
  measLockedIn(m) {
    const last = m.history?.at(-1);
    if (!last || last.action === 'cancelled' || m.cancelled) return null;
    return last.approvalStatus === 'pending' ? null : last.accountNumber;
  }
  assertMeasRowOpen(m) {
    const n = this.measLockedIn(m);
    if (n) throw new Error(`שורה זו אושרה בחשבון ${n} ונעולה — כמות שאושרה אינה משתנה. לתיקון השתמש ב"תיקון שורה" (נשמרת היסטוריה).`);
  }
  /** Correct an approved row: the original is cancelled (kept in history) and an editable copy replaces it. */
  correctMeas(id, reason) {
    const m = this.meas(id);
    this.assertMeasEditable(m.contractId);
    const why = text(reason, 300);
    if (why.length < 3) throw new Error('חובה לציין סיבה לתיקון');
    const n = this.measLockedIn(m);
    if (!n) throw new Error('השורה אינה נעולה — ניתן לערוך אותה ישירות');
    return this.s.tx(() => {
      const nid = this.addMeas(m.contractId, m.itemId, { after: id });
      this.s.run('UPDATE measurements SET descr=?, area=?, shape=?, d1=?, d2=?, d3=?, t=?, qty=?, sign=?, notes=? WHERE id=?',
        [m.desc, m.area, m.shape, m.d1, m.d2, m.d3, m.t, m.qty, m.sign, `תיקון לשורה שאושרה בחשבון ${n}: ${why}`, nid]);
      this.s.run('UPDATE measurements SET cancelled=1, notes=? WHERE id=?', [text(`${m.notes ? m.notes + ' · ' : ''}בוטלה לתיקון: ${why}`, 1000), id]);
      return nid;
    }, `תיקון שורת מדידה (חשבון ${n})`);
  }
  /** Patch fields of a row; a geometry change re-opens a stale reduce/reject decision as pending. */
  saveMeas(id, patch) {
    const m = this.meas(id);
    this.assertMeasEditable(m.contractId);
    if (Object.keys(patch).some((k) => k !== 'notes')) this.assertMeasRowOpen(m);
    const item = this.item(m.itemId);
    const next = { ...m };
    for (const k of ['desc', 'area', 'shape', 'd1', 'd2', 'd3', 't', 'qty', 'notes', 'groupLabel']) if (k in patch) next[k] = text(String(patch[k] ?? ''), k === 'desc' || k === 'notes' ? 1000 : 120);
    if ('sign' in patch) next.sign = patch.sign === -1 ? -1 : 1;
    // changing the shape clears the old dimensions (as in the source app) — except values sent with it
    if ('shape' in patch && patch.shape !== m.shape) for (const k of ['d1', 'd2', 'd3', ...(itemUnitKind(item) !== 'volume' ? ['t'] : [])]) if (!(k in patch)) next[k] = '';
    if (next.approval && approvalIsStale(next, item)) next.approval = { status: 'pending', value: 0, note: 'התביעה שונתה לאחר ההחלטה הקודמת — ממתינה לבדיקה מחדש', claimedAtDecision: calcRow(next, item) };
    this.s.tx(() => this.s.run('UPDATE measurements SET descr=?, area=?, shape=?, d1=?, d2=?, d3=?, t=?, qty=?, sign=?, notes=?, group_label=?, approval=? WHERE id=?',
      [next.desc, next.area, next.shape, next.d1, next.d2, next.d3, next.t, next.qty, next.sign, next.notes, next.groupLabel, next.approval ? JSON.stringify(next.approval) : null, id]), '', 'עריכת שורת מדידה');
    return this.meas(id);
  }
  duplicateMeas(id) {
    const m = this.meas(id);
    const nid = this.addMeas(m.contractId, m.itemId, { after: id });
    this.s.tx(() => this.s.run('UPDATE measurements SET descr=?, area=?, shape=?, d1=?, d2=?, d3=?, t=?, qty=?, sign=?, notes=?, is_group=?, group_label=? WHERE id=?',
      [m.desc, m.area, m.shape, m.d1, m.d2, m.d3, m.t, m.qty, m.sign, m.notes, m.isGroup ? 1 : 0, m.groupLabel, nid]));
    return nid;
  }
  /** Rows already approved in a bill are never deleted — they are cancelled (kept for the audit trail). */
  deleteMeas(id) {
    const m = this.meas(id);
    this.assertMeasEditable(m.contractId);
    this.assertMeasRowOpen(m);
    this.s.tx(() => (m.history.length ? this.s.run('UPDATE measurements SET cancelled=1 WHERE id=?', [id]) : this.s.run('DELETE FROM measurements WHERE id=?', [id])),
      m.history.length ? 'ביטול שורת מדידה' : 'מחיקת שורת מדידה');
    return m.history.length ? 'cancelled' : 'deleted';
  }
  restoreMeas(id) { const m = this.meas(id); this.assertMeasEditable(m.contractId); this.s.tx(() => this.s.run('UPDATE measurements SET cancelled=0 WHERE id=?', [id])); }
  copyMeas(ids, targetItemId) {
    const target = this.item(targetItemId);
    this.s.tx(() => { for (const id of ids) {
      const m = this.meas(id);
      const nid = this.addMeas(target.contract_id, targetItemId);
      this.s.run('UPDATE measurements SET descr=?, area=?, shape=?, d1=?, d2=?, d3=?, t=?, qty=?, sign=?, notes=? WHERE id=?', [m.desc, m.area, m.shape, m.d1, m.d2, m.d3, m.t, m.qty, m.sign, m.notes, nid]);
    } }, `העתקת ${ids.length} שורות מדידה`);
  }
  /** Reviewer decision on a row: approved-as-claimed (null) / reduced / rejected / pending. */
  setMeasApproval(id, { status, value, note }) {
    const m = this.meas(id);
    this.assertMeasEditable(m.contractId, true);
    this.assertMeasRowOpen(m);
    const item = this.item(m.itemId);
    const a = status === 'approved' || !status ? null
      : { status: ['reduced', 'rejected', 'pending'].includes(status) ? status : 'pending', value: status === 'reduced' ? Number(decStr(value, 'כמות מאושרת')) : 0, note: text(note ?? '', 500), claimedAtDecision: calcRow(m, item) };
    this.s.tx(() => this.s.run('UPDATE measurements SET approval=? WHERE id=?', [a ? JSON.stringify(a) : null, id]), 'החלטת אישור בשורת מדידה');
  }
  /** Σ claimed and Σ approved per item (rows rounded to 4 decimals, summed exactly). */
  measTotals(contractId) {
    // fast path: most contracts / items have no calculation sheets
    if (!this.s.get(`SELECT 1 x FROM measurements WHERE contract_id=? UNION ALL SELECT 1 FROM items WHERE contract_id=? AND qsrc='meas' AND meas_opening IS NOT NULL LIMIT 1`, [contractId, contractId])) return new Map();
    const items = new Map(this.items(contractId).map((i) => [i.id, i]));
    const out = new Map();
    for (const m of this.measRows(contractId)) {
      if (m.isGroup) continue;
      const it = items.get(m.itemId); if (!it) continue;
      const t = out.get(m.itemId) ?? { claimed: 0n, approved: 0n, rows: 0, pending: 0 };
      t.rows++;
      if (!m.cancelled) {
        t.claimed += fixed(calcRow(m, it).toFixed(4));
        t.approved += fixed(approvedRowValue(m, it).toFixed(4));
        if (m.approval?.status === 'pending') t.pending++;
      }
      out.set(m.itemId, t);
    }
    // quantity billed manually before the sheet was opened counts as claimed and approved
    for (const it of items.values()) {
      if (it.qsrc !== 'meas' || it.meas_opening == null) continue;
      const t = out.get(it.id) ?? { claimed: 0n, approved: 0n, rows: 0, pending: 0 };
      t.opening = it.meas_opening; t.claimed += fixed(it.meas_opening); t.approved += fixed(it.meas_opening);
      out.set(it.id, t);
    }
    return out;
  }
  measPending(contractId) { let n = 0; for (const t of this.measTotals(contractId).values()) n += t.pending; return n; }
  /** Bill lines of measured items come from the calculation sheets (cumulative; periodic = minus previous). */
  measuredLines(contract, bill, lines, prev) {
    const totals = this.measTotals(contract.id);
    if (!totals.size) return lines;
    const src = new Map(this.items(contract.id).map((i) => [i.id, i.qsrc]));
    for (const k of [...totals.keys()]) if (src.get(k) !== 'meas') totals.delete(k);
    const prevQ = new Map((prev?.rows ?? []).map((r) => [r.itemId, fixed(r.cumQ)]));
    const out = new Map(lines);
    for (const [itemId, t] of totals) {
      const base = contract.mode === 'periodic' ? (prevQ.get(itemId) ?? 0n) : 0n;
      const L = { ...(out.get(itemId) ?? { bill_id: bill.id, item_id: itemId, percent: '100' }) };
      L.q_calc = dec(t.claimed - base); L.q_sub = dec(t.claimed - base); L.q_appr = dec(t.approved - base); L.fromMeas = true;
      out.set(itemId, L);
    }
    return out;
  }
  /** Blocking errors and warnings for the calculation sheets (same rules as the source app). */
  measValidate(contractId) {
    const critical = [], warnings = [];
    const NUM_RE = /^-?(\d+([.,]\d*)?|[.,]\d+)$/;
    const items = new Map(this.items(contractId).map((i) => [i.id, i]));
    for (const m of this.measRows(contractId)) {
      if (m.isGroup || m.cancelled) continue;
      const it = items.get(m.itemId);
      if (!it) { critical.push('שורת מדידה מקושרת לסעיף שאינו קיים'); continue; }
      const code = itemCode(it), kind = itemUnitKind(it);
      for (const k of ['d1', 'd2', 'd3', 't', 'qty']) { const v = m[k]; if (v !== '' && v != null && !NUM_RE.test(String(v).trim())) critical.push(`סעיף ${code}: ערך לא מספרי בשדה ${k}`); }
      if (!['d1', 'd2', 'd3', 't', 'qty'].some((k) => m[k] !== '' && m[k] != null)) continue;
      const bv = baseVal(m, kind);
      if (kind === 'volume' && !bv.complete) critical.push(`סעיף ${code} (מ"ק): שורת מדידה חסרה עובי/אורך — לא ניתן לחשב נפח`);
      if (kind === 'area' && Number(m.t) > 0) critical.push(`סעיף ${code} (מ"ר): לא ניתן להזין עובי בסעיף שטח`);
      if (bv.complete && Math.abs(calcRow(m, it)) < 1e-9) warnings.push(`סעיף ${code}: שורת מדידה מחושבת ל-0`);
    }
    return { critical, warnings };
  }
  /** At approval: append history for every changed row and return the frozen rows for the snapshot. */
  measStamp(contractId, bill) {
    const items = new Map(this.items(contractId).map((i) => [i.id, i]));
    const day = today();
    const frozen = [];
    for (const m of this.measRows(contractId)) {
      if (m.isGroup) continue;
      const it = items.get(m.itemId);
      const last = m.history.at(-1);
      if (m.cancelled) {
        if (last && last.action !== 'cancelled') this.s.run('INSERT INTO meas_history (meas_id, bill_id, bill_number, action, value, prev_value, claimed, date) VALUES (?,?,?,?,?,?,?,?)', [m.id, bill.id, bill.number, 'cancelled', '0', String(last.value), '0', day]);
        else if (!last) { this.s.run('DELETE FROM measurements WHERE id=?', [m.id]); continue; } // never approved → garbage-collect
      } else if (it) {
        const cur = Number(approvedRowValue(m, it).toFixed(4)), claimed = Number(calcRow(m, it).toFixed(4));
        const st = m.approval?.status ?? null, note = m.approval?.note ?? '';
        if (!last) { if (Math.abs(cur) > 1e-9 || Math.abs(claimed) > 1e-9) this.s.run('INSERT INTO meas_history (meas_id, bill_id, bill_number, action, value, prev_value, claimed, approval_status, approval_note, date) VALUES (?,?,?,?,?,?,?,?,?,?)', [m.id, bill.id, bill.number, 'created', String(cur), '0', String(claimed), st, note, day]); }
        else if (Math.abs(cur - last.value) > 1e-9 || last.action === 'cancelled') this.s.run('INSERT INTO meas_history (meas_id, bill_id, bill_number, action, value, prev_value, claimed, approval_status, approval_note, date) VALUES (?,?,?,?,?,?,?,?,?,?)', [m.id, bill.id, bill.number, 'corrected', String(cur), String(last.value), String(claimed), st, note, day]);
      }
      const after = this.meas(m.id);
      if (!after || !after.history.length) continue;
      const h = after.history.at(-1);
      frozen.push({ id: m.id, itemId: m.itemId, value: h.action === 'cancelled' ? 0 : h.value, cancelled: h.action === 'cancelled', desc: m.desc, area: m.area, shape: m.shape,
        d1: m.d1, d2: m.d2, d3: m.d3, t: m.t, qty: m.qty, sign: m.sign, notes: m.notes, claimedValue: h.claimedValue ?? h.value, approvalStatus: h.approvalStatus ?? null, approvalNote: h.approvalNote ?? '' });
    }
    return frozen;
  }

  audit(limit = 300) { return this.s.all('SELECT * FROM audit ORDER BY id DESC LIMIT ?', [limit]); }
}
