// Pure bill calculation. No I/O: the caller supplies the contract, sections, items, the bill,
// its lines, the previous approved bill's snapshot and an index lookup.
//
// Order of calculation (explicit, matches account 8 "חנתון"):
//   line amount = qty × price × percent/100 (rounded to agorot once per line)
//   chapter discount → general discount (exempt chapters excluded, chapter 99 by default)
//   cumulative contract: period = cumulative net − previous approved cumulative net
//   + indexation (per contract rule, on the period amount)
//   − retention (on positive period+indexation) + retention release − advance recovery
//   − materials/purchase offsets − other deductions = before VAT; + VAT = payable.
import { fixed, lineCents, pct, divRound, dec, cents } from './money.js';

export const isBillable = (it) => it.kind !== 'note' && (it.kind === 'contract' || it.change_status === 'approved');
export const isExtra = (it) => it.kind === 'extra' || it.chapter === '99';
export const itemCode = (it) => `${it.struct}.${it.chapter}.${it.sub}.${String(it.num).padStart(4, '0')}`;

const minQ = (a, b) => (a < b ? a : b);
const maxQ = (a, b) => (a > b ? a : b);

export function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

/** Indexation amount (agorot) for a period amount, by contract rule. */
export function indexation(amount, rule, base, current, { threshold = '0', share = '100' } = {}) {
  if (rule === 'none' || rule === 'manual') return 0;
  const I0 = fixed(base), I = fixed(current);
  if (I0 <= 0n) throw new Error('מדד בסיס לא תקין');
  const c = BigInt(amount);
  if (rule === 'full') return Number(divRound(c * (I - I0), I0));
  if (rule === 'partial') return Number(divRound(c * (I - I0) * fixed(share), I0 * 1000000n));
  if (rule === 'threshold') {
    // only the rise above the threshold is compensated
    const num = (I - I0) * 1000000n - fixed(threshold) * I0;
    return num > 0n ? Number(divRound(c * num, I0 * 1000000n)) : 0;
  }
  throw new Error('כלל הצמדה לא מוכר');
}

/** Chapter discount, then general discount on non-exempt chapters. */
export function discountTotals(rows, sectionOf, generalRate, key = 'amount') {
  const groups = new Map();
  for (const r of rows) {
    const k = `${r.struct}.${r.chapter}`;
    let g = groups.get(k);
    if (!g) {
      const s = sectionOf(k);
      g = { key: k, struct: r.struct, chapter: r.chapter, name: s?.name ?? '', rate: s?.discount ?? '0',
            // extras (ch. 99) never take the general discount, whatever the section flag says
            exempt: r.chapter === '99' || !!s?.exempt, gross: 0, cat: { contract: 0, over: 0, extra: 0 }, subs: {} };
      groups.set(k, g);
    }
    g.gross += r[key];
    g.cat.contract += r.cat.contract; g.cat.over += r.cat.over; g.cat.extra += r.cat.extra;
    g.subs[r.sub] = (g.subs[r.sub] ?? 0) + r[key]; // plain object: survives the JSON snapshot
  }
  const list = [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
  // Discounts on amounts (never on unit prices), compounding from the inside out:
  // subchapter → chapter → structure → general. A chapter-only discount gives exactly the old figures.
  for (const g of list) {
    g.subDiscs = [];
    for (const [sub, amt] of Object.entries(g.subs).sort()) {
      const rate = sectionOf(`${g.key}.${sub}`)?.discount ?? '0';
      const d = pct(amt, rate);
      if (d) g.subDiscs.push({ sub, rate, base: amt, amount: d });
    }
    g.subDiscount = g.subDiscs.reduce((a, x) => a + x.amount, 0);
    g.chapterBase = g.gross - g.subDiscount;
    g.chapterDisc = pct(g.chapterBase, g.rate);
    g.structDisc = 0; g.structRate = '0';
    g.discount = g.subDiscount + g.chapterDisc;
    g.net = g.gross - g.discount;
  }
  for (const st of [...new Set(list.map((g) => g.struct))]) {
    const rate = sectionOf(st)?.discount ?? '0';
    // a structure discount covers the contract work of the structure, not its extras (ch. 99)
    const gs = list.filter((g) => g.struct === st && g.chapter !== '99');
    const base = gs.reduce((a, g) => a + g.net, 0);
    const total = pct(base, rate);
    if (!total) continue;
    // allocate the structure discount to its chapters in proportion to their net; remainder to the last
    let left = total;
    gs.forEach((g, i) => {
      const share = i === gs.length - 1 ? left : (base ? Number(divRound(BigInt(total) * BigInt(g.net), BigInt(base))) : 0);
      left -= share;
      Object.assign(g, { structDisc: share, structRate: rate, structBase: base });
      g.discount += share; g.net -= share;
    });
  }
  const beforeGeneral = list.reduce((s, g) => s + g.net, 0);
  const eligibleGroups = list.filter((g) => !g.exempt);
  const eligible = eligibleGroups.reduce((s, g) => s + g.net, 0);
  const general = pct(eligible, generalRate);
  // allocate the general discount to groups proportionally; remainder to the last one
  let left = general;
  eligibleGroups.forEach((g, i) => {
    const share = i === eligibleGroups.length - 1 ? left : (eligible ? Number(divRound(BigInt(general) * BigInt(g.net), BigInt(eligible))) : 0);
    g.general = share; left -= share;
  });
  for (const g of list) {
    g.general ??= 0;
    g.final = g.net - g.general;
    // split the group's final amount into categories in proportion to gross
    const { contract, extra } = g.cat;
    const part = (x) => (g.gross ? Number(divRound(BigInt(g.final) * BigInt(x), BigInt(g.gross))) : 0);
    g.catNet = { contract: part(contract), extra: part(extra) };
    g.catNet.over = g.final - g.catNet.contract - g.catNet.extra;
  }
  const sum = (f) => list.reduce((s, g) => s + f(g), 0);
  const structs = [...new Set(list.map((g) => g.struct))].map((st) => {
    const gs = list.filter((g) => g.struct === st && g.chapter !== '99');
    if (!gs.length) return { struct: st, rate: '0', base: 0, amount: 0 };
    return { struct: st, rate: gs[0].structRate, base: gs[0].structBase ?? 0, amount: gs.reduce((a, g) => a + g.structDisc, 0) };
  }).filter((x) => x.amount);
  return { structs,
    groups: list, gross: sum((g) => g.gross), chapterDiscount: sum((g) => g.discount), beforeGeneral,
    eligible, exempt: beforeGeneral - eligible, generalRate, general, net: beforeGeneral - general,
    cat: { contract: sum((g) => g.catNet.contract), over: sum((g) => g.catNet.over), extra: sum((g) => g.catNet.extra) },
  };
}

/**
 * @param {object} p
 * @param {object} p.contract  contracts row
 * @param {Array}  p.sections  sections rows
 * @param {Array}  p.items     items rows of the contract
 * @param {object} p.bill      bills row (adj parsed)
 * @param {Map}    p.lines     item_id → bill_lines row
 * @param {object|null} p.prev previous approved snapshot
 * @param {(series:string, month:string)=>string|null} p.indexValue
 */
export function calcBill({ contract, sections, items, bill, lines, prev, indexValue = () => null }) {
  const periodic = contract.mode === 'periodic';
  const secMap = new Map(sections.map((s) => [s.code, s]));
  const prevRows = new Map((prev?.rows ?? []).map((r) => [r.itemId, r]));
  const col = { calc: 'q_calc', sub: 'q_sub', appr: 'q_appr' }[bill.basis] ?? 'q_sub';
  const warnings = [];

  const rows = [];
  for (const it of items) {
    if (!isBillable(it)) continue;
    const L = lines.get(it.id) ?? {};
    const p = prevRows.get(it.id);
    const prevQ = fixed(p?.cumQ ?? '0');
    const prevGross = p?.cumGross ?? 0;
    const price = L.price ?? it.price;
    const percent = L.percent ?? '100';
    const entered = L[col];
    // an untouched line keeps its previous cumulative quantity (never silently credited)
    const q = entered == null || entered === '' ? (periodic ? 0n : prevQ) : fixed(entered);
    const cumQ = periodic ? prevQ + q : q;
    const curQ = periodic ? q : q - prevQ;
    const lineAmt = lineCents(dec(periodic ? q : cumQ), price, percent);
    const cumGross = periodic ? prevGross + lineAmt : lineAmt;
    const periodGross = cumGross - prevGross;
    const amount = periodic ? periodGross : cumGross; // basis for discounts
    const cq = fixed(it.qty);
    let cat;
    if (isExtra(it)) cat = { contract: 0, over: 0, extra: amount };
    else {
      const inContract = periodic ? maxQ(0n, minQ(cumQ, cq) - minQ(prevQ, cq)) : minQ(cumQ, cq);
      const c = amount > 0 ? Math.min(amount, lineCents(dec(maxQ(0n, inContract)), price, percent)) : amount;
      cat = { contract: c, over: amount - c, extra: 0 };
    }
    if (cumQ > cq && !isExtra(it) && cq > 0n) warnings.push({ type: 'overrun', itemId: it.id, text: `${itemCode(it)}: כמות מצטברת ${dec(cumQ)} חורגת מכמות חוזה ${dec(cq)}` });
    if (cumQ < 0n) warnings.push({ type: 'negative', itemId: it.id, text: `${itemCode(it)}: כמות מצטברת שלילית` });
    if (p && p.price !== price && fixed(p.cumQ ?? '0') !== 0n)
      warnings.push({ type: 'price-change', itemId: it.id, text: `${itemCode(it)}: מחיר היחידה שונה מ-${p.price} ל-${price} — החשבון כולל את ההפרש על ${dec(prevQ)} ${it.unit} שחויבו קודם` });
    if (cumQ < 0n) { /* reported above */ }
    else if (curQ < 0n) warnings.push({ type: 'decrease', itemId: it.id, text: `${itemCode(it)}: כמות נוכחית שלילית ${dec(curQ)} — המצטבר ירד מ-${dec(prevQ)} ל-${dec(cumQ)}` });
    rows.push({
      itemId: it.id, struct: it.struct, chapter: it.chapter, sub: it.sub, num: it.num, code: itemCode(it),
      description: it.description, unit: it.unit, kind: it.kind, contractQty: it.qty, contractPrice: it.price,
      price, percent, prevQ: dec(prevQ), curQ: dec(curQ), cumQ: dec(cumQ),
      prevGross, periodGross, cumGross, amount, cat,
      q_calc: L.q_calc ?? null, q_sub: L.q_sub ?? null, q_appr: L.q_appr ?? null,
    });
  }

  const T = discountTotals(rows, (k) => secMap.get(k), contract.general_discount ?? '0');
  const prevNet = prev ? prev.cumNet : contract.opening_cents ?? 0;
  const periodNet = periodic ? T.net : T.net - prevNet;
  const cumNet = periodic ? prevNet + T.net : T.net;

  const adj = bill.adj ?? {};
  // indexation
  const ix = { rule: contract.index_rule, amount: 0, base: null, current: null, month: null, missing: [] };
  if (contract.index_rule === 'manual') ix.amount = cents(adj.indexation || '0');
  else if (contract.index_rule !== 'none') {
    ix.month = shiftMonth(bill.month, -(contract.index_lag ?? 0));
    ix.base = indexValue(contract.index_series, contract.index_base_month);
    ix.current = indexValue(contract.index_series, ix.month);
    if (!contract.index_base_month || ix.base == null) ix.missing.push(contract.index_base_month || 'בסיס');
    if (ix.current == null) ix.missing.push(ix.month);
    if (ix.missing.length) warnings.push({ type: 'index', text: `חסר ערך מדד ל: ${ix.missing.join(', ')}` });
    else ix.amount = indexation(periodNet, contract.index_rule, ix.base, ix.current,
      { threshold: contract.index_threshold, share: contract.index_share });
  }

  const retentionRate = adj.retention_rate ?? contract.retention_rate ?? '0';
  const retention = pct(Math.max(0, periodNet + ix.amount), retentionRate);
  const release = cents(adj.retention_release || '0');
  const advanceLeft = Math.max(0, (contract.advance_cents ?? 0) - (prev?.cumAdvance ?? 0));
  const advance = adj.advance != null && adj.advance !== ''
    ? cents(adj.advance)
    : Math.min(advanceLeft, pct(Math.max(0, periodNet), contract.advance_rate ?? '0'));
  // manual materials offset + purchases assigned to this bill (frozen with the snapshot)
  const materials = cents(adj.materials || '0') + (bill.purchasesCents ?? 0);
  const other = cents(adj.other || '0');
  const beforeVat = periodNet + ix.amount - retention + release - advance - materials - other;
  const vatRate = adj.vat ?? contract.vat_rate ?? '18';
  const vat = pct(beforeVat, vatRate);
  const due = beforeVat + vat;

  return {
    version: 1, mode: contract.mode, basis: bill.basis, rows, totals: T, warnings,
    prevNet, periodNet, cumNet, indexation: ix, retentionRate, retention, release, advance, materials, purchases: bill.purchasesCents ?? 0,
    otherLabel: adj.other_label || 'הפחתות אחרות', other, beforeVat, vatRate, vat, due,
    cumIndex: (prev?.cumIndex ?? 0) + ix.amount,
    cumRetention: (prev?.cumRetention ?? 0) + retention - release,
    cumAdvance: (prev?.cumAdvance ?? 0) + advance,
    cumDue: (prev?.cumDue ?? 0) + due,
  };
}

/** Contract value: quantities × prices after chapter and general discounts. */
export function contractValue({ contract, sections, items }) {
  const secMap = new Map(sections.map((s) => [s.code, s]));
  const rows = items.filter(isBillable).map((it) => {
    const amount = lineCents(it.qty, it.price);
    return { struct: it.struct, chapter: it.chapter, sub: it.sub, amount,
      cat: isExtra(it) ? { contract: 0, over: 0, extra: amount } : { contract: amount, over: 0, extra: 0 } };
  });
  return discountTotals(rows, (k) => secMap.get(k), contract.general_discount ?? '0');
}

/**
 * The bill seen as "this month only" (non-cumulative view): each row's period amount, and chapter /
 * discount / total figures as the difference from the previous approved bill. Same money as the
 * cumulative bill — Σ period nets = cumNet − prevNet — only presented per month.
 */
export function periodTotals(r, prevSnap, periodic) {
  const rows = r.rows.map((x) => ({ ...x, pAmount: x.periodGross }));
  if (periodic) return { rows, groups: r.totals.groups, T: r.totals, cat: r.totals.cat };
  const P = prevSnap?.totals;
  const prevG = new Map((P?.groups ?? []).map((g) => [g.key, g]));
  const groups = r.totals.groups.map((g) => {
    const p = prevG.get(g.key);
    const subs = { ...g.subs };
    for (const [k, v] of Object.entries(p?.subs ?? {})) subs[k] = (subs[k] ?? 0) - v;
    return { ...g, gross: g.gross - (p?.gross ?? 0), discount: g.discount - (p?.discount ?? 0), net: g.net - (p?.net ?? 0),
      general: (g.general ?? 0) - (p?.general ?? 0), final: g.final - (p?.final ?? 0), subs };
  });
  const T = r.totals, d = (k) => (T[k] ?? 0) - (P?.[k] ?? 0);
  return { rows, groups,
    T: { ...T, groups, gross: d('gross'), chapterDiscount: d('chapterDiscount'), beforeGeneral: d('beforeGeneral'), eligible: d('eligible'), exempt: d('exempt'), general: d('general'), net: d('net') },
    cat: { contract: T.cat.contract - (P?.cat.contract ?? 0), over: T.cat.over - (P?.cat.over ?? 0), extra: T.cat.extra - (P?.cat.extra ?? 0) } };
}

/**
 * Display lines for a chapter's discounts, in the order they were applied. Each: {kind, label, amount}
 * (amount = positive discount in agorot). `fmt` formats money for the label.
 */
export function discountLines(g, fmt = (c) => (c / 100).toFixed(2)) {
  const r = (x) => String(x).replace(/\.0+$/, '');
  const out = [];
  for (const d of g.subDiscs ?? []) out.push({ kind: 'sub', label: `הנחה ${r(d.rate)}% לתת פרק ${g.chapter}.${+d.sub} מסך ${fmt(d.base)}`, amount: d.amount });
  if (g.chapterDisc ?? g.discount) out.push({ kind: 'chapter', label: `הנחה ${r(g.rate)}% מסך ${fmt(g.chapterBase ?? g.gross)}`, amount: g.chapterDisc ?? g.discount });
  if (g.structDisc) out.push({ kind: 'struct', label: `חלק הפרק בהנחת מבנה ${+g.struct} (${r(g.structRate)}%)`, amount: g.structDisc });
  return out;
}
