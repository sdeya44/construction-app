// Excel import/export (ExcelJS, loaded on demand). Exports keep live formulas so the sheet
// stays checkable in Excel; cached results are written too, so totals show without recalculation.
import { itemCode, isBillable, discountLines } from './engine.js';
import { lineCents } from './money.js';

let loading = null;
export function loadExcel() {
  if (globalThis.ExcelJS) return Promise.resolve(globalThis.ExcelJS);
  loading ??= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'vendor/exceljs.min.js';
    s.onload = () => res(globalThis.ExcelJS);
    s.onerror = () => rej(new Error('טעינת רכיב Excel נכשלה'));
    document.head.append(s);
  });
  return loading;
}

const MONEY = '#,##0.00';
const QTY = '#,##0.00##';
const n = (v) => Number(v || 0);

function sheetSetup(ws, widths) {
  ws.views = [{ rightToLeft: true, state: 'frozen', ySplit: 1 }];
  ws.columns = widths.map((w) => ({ width: w }));
  ws.pageSetup = { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
}
function header(ws, labels) {
  const r = ws.addRow(labels);
  r.font = { bold: true };
  r.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  r.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE9ECEF' } }; c.border = { bottom: { style: 'thin' } }; });
}
const bold = (row) => { row.font = { bold: true }; return row; };

/** BOQ / quote → xlsx bytes. Columns: code, description, unit, qty, price, total(=qty*price). */
export async function exportBoq(ExcelJS, { contract, sections, items }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'KAYAN BOQ';
  const ws = wb.addWorksheet('כתב כמויות');
  sheetSetup(ws, [16, 70, 9, 12, 13, 16]);
  header(ws, ['סעיף', 'תאור', 'יחידה', 'כמות', 'מחיר יחידה', 'סה"כ']);
  const sec = new Map(sections.map((s) => [s.code, s.name]));
  const chapterTotals = [];
  let i = 0;
  const list = items.filter((it) => it.kind === 'note' || it.change_status !== 'rejected');
  let lastStruct = null;
  while (i < list.length) {
    const st = list[i].struct, ch = list[i].chapter;
    if (st !== lastStruct) { lastStruct = st; const r = bold(ws.addRow([st, sec.get(st) ?? `מבנה ${st}`])); r.getCell(2).font = { bold: true, size: 12 }; }
    bold(ws.addRow([`${st}.${ch}`, sec.get(`${st}.${ch}`) ?? ''])).getCell(2).font = { bold: true, color: { argb: 'FF0F4C5C' } };
    const subTotals = [];
    while (i < list.length && list[i].struct === st && list[i].chapter === ch) {
      const sub = list[i].sub;
      bold(ws.addRow([`${st}.${ch}.${sub}`, sec.get(`${st}.${ch}.${sub}`) ?? '']));
      const first = ws.rowCount + 1;
      while (i < list.length && list[i].struct === st && list[i].chapter === ch && list[i].sub === sub) {
        const it = list[i++];
        if (it.kind === 'note') { const r = ws.addRow(['', it.description]); r.font = { italic: true }; r.getCell(2).alignment = { wrapText: true }; continue; }
        const r = ws.addRow([itemCode(it), it.description, it.unit, n(it.qty), n(it.price)]);
        const rn = r.number;
        r.getCell(6).value = { formula: `D${rn}*E${rn}`, result: isBillable(it) ? lineCents(it.qty, it.price) / 100 : 0 };
        r.getCell(2).alignment = { wrapText: true, vertical: 'top' };
        r.getCell(4).numFmt = QTY; r.getCell(5).numFmt = MONEY; r.getCell(6).numFmt = MONEY;
      }
      const last = ws.rowCount;
      const t = bold(ws.addRow(['', `סה"כ ${st}.${ch}.${sub}`]));
      t.getCell(6).value = { formula: `SUM(F${first}:F${last})` }; t.getCell(6).numFmt = MONEY;
      subTotals.push(t.number);
    }
    const ct = bold(ws.addRow(['', `סה"כ פרק ${ch} ${sec.get(`${st}.${ch}`) ?? ''}`]));
    ct.getCell(6).value = { formula: subTotals.map((x) => `F${x}`).join('+') }; ct.getCell(6).numFmt = MONEY;
    ct.eachCell((c) => { c.border = { top: { style: 'thin' } }; });
    chapterTotals.push(ct.number);
    ws.addRow([]);
  }
  const g = bold(ws.addRow(['', 'סה"כ כתב כמויות (לפני הנחות ומע"מ)']));
  g.getCell(6).value = { formula: chapterTotals.map((x) => `F${x}`).join('+') || '0' }; g.getCell(6).numFmt = MONEY;
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

/** Bill → xlsx bytes: detail sheet in the Binarit column order + summary sheet. */
// ---------------------------------------------------------------------------------------------
// Bill workbook laid out like the printed bill: document head (issuer, project, title, date),
// a bordered table with column rules running the full height, structure / chapter / subchapter
// heading rows, subchapter and chapter totals, discount lines, a concentration (ריכוז) sheet and
// a payment-summary sheet. Live formulas stay in the item rows so the sheet remains checkable.
const BLK = { argb: 'FF000000' };
const THIN = { style: 'thin', color: BLK }, MED = { style: 'medium', color: BLK }, DBL = { style: 'double', color: BLK };
const BLUE = { argb: 'FF0B3CD6' };
const FILL = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const HEAD_FILL = 'FFE9ECEF', SUM_FILL = 'FFF3F4F6', CHAP_FILL = 'FFE2E6EA';
const colLetter = (i) => String.fromCharCode(64 + i);

function billDoc(ws, ncols, D, { landscape }) {
  ws.views = [{ rightToLeft: true, state: 'frozen', ySplit: 5 }];
  ws.pageSetup = { paperSize: 9, orientation: landscape ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    margins: { left: 0.35, right: 0.35, top: 0.45, bottom: 0.55, header: 0.2, footer: 0.25 }, printTitlesRow: '5:5', horizontalCentered: true };
  ws.headerFooter = { oddFooter: `&R&8${(D.company || '').replace(/&/g, '&&')}&L&8&P / &N` };
  const last = colLetter(ncols);
  if (ncols < 4) {
    // narrow sheet (payment summary): every head line spans the full width
    const line = (r, v, font, align = 'right') => { ws.mergeCells(`A${r}:${last}${r}`); const c = ws.getCell(`A${r}`); c.value = v; c.font = font; c.alignment = { horizontal: align, vertical: 'middle' }; };
    line(1, D.issuer, { bold: true, italic: true, size: 12 });
    line(2, `${D.project}    ·    ${D.date}`, { bold: true, color: BLUE });
    line(3, D.title, { size: 16, color: BLUE }, 'center'); ws.getRow(3).height = 26;
    line(4, D.sub || '', { size: 10, italic: true }, 'center');
    return;
  }
  const half = Math.max(2, Math.floor(ncols / 2));
  ws.mergeCells(`A1:${colLetter(half)}1`); ws.mergeCells(`${colLetter(half + 1)}1:${last}1`);
  ws.getCell('A1').value = D.issuer; ws.getCell('A1').font = { bold: true, italic: true, size: 12 };
  ws.getCell(`${colLetter(half + 1)}1`).value = D.date; ws.getCell(`${colLetter(half + 1)}1`).alignment = { horizontal: 'left' };
  ws.mergeCells(`A2:${colLetter(half)}2`); ws.mergeCells(`${colLetter(half + 1)}2:${last}2`);
  ws.getCell('A2').value = D.contact || ''; ws.getCell('A2').font = { size: 9, color: { argb: 'FF444444' } };
  ws.getCell(`${colLetter(half + 1)}2`).value = D.project; ws.getCell(`${colLetter(half + 1)}2`).font = { color: BLUE, bold: true };
  ws.getCell(`${colLetter(half + 1)}2`).alignment = { horizontal: 'left' };
  ws.mergeCells(`A3:${last}3`);
  ws.getCell('A3').value = D.title; ws.getCell('A3').font = { size: 16, color: BLUE };
  ws.getCell('A3').alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(3).height = 26;
  ws.mergeCells(`A4:${last}4`);
  ws.getCell('A4').value = D.sub || ''; ws.getCell('A4').font = { size: 10, italic: true }; ws.getCell('A4').alignment = { horizontal: 'center' };
}
function billHeader(ws, labels) {
  const r = ws.getRow(5);
  r.values = labels;
  r.height = 30;
  r.eachCell((c) => {
    c.font = { bold: true, italic: true, size: 10 };
    c.alignment = { horizontal: 'center', vertical: 'bottom', wrapText: true };
    c.fill = FILL(HEAD_FILL);
    c.border = { top: THIN, bottom: MED, left: THIN, right: THIN };
  });
}
/** Every table row: vertical rules on all columns; code / description top, numbers bottom. */
function tableRow(ws, values, ncols, { kind = 'item', top, bottom, fill, numFmts = {} } = {}) {
  const r = ws.addRow(values);
  for (let i = 1; i <= ncols; i++) {
    const c = r.getCell(i);
    c.border = { left: THIN, right: THIN, ...(top ? { top } : {}), ...(bottom ? { bottom } : {}) };
    if (fill) c.fill = FILL(fill);
    c.alignment = i === 2 ? { wrapText: true, vertical: 'top', horizontal: 'right' } : i === 1 ? { vertical: 'top', horizontal: 'right' } : { vertical: 'bottom' };
    if (numFmts[i]) c.numFmt = numFmts[i];
    if (kind === 'head') c.font = { bold: true, underline: i === 2 };
    else if (kind === 'sum') c.font = { bold: true };
    else if (kind === 'note') c.font = { italic: true, color: { argb: 'FF333333' } };
  }
  return r;
}
function closeTable(ws, ncols) { const r = ws.lastRow; for (let i = 1; i <= ncols; i++) r.getCell(i).border = { ...r.getCell(i).border, bottom: MED }; }

function docInfo({ contract, bill, company, project, period }) {
  const title = `${bill.type === 'final' ? 'חשבון סופי' : 'חשבון חלקי'} מס. ${bill.doc?.displayNumber || bill.number}`;
  return {
    issuer: bill.doc?.issuer || (contract.kind === 'sub' ? contract.party : company?.name) || '',
    contact: bill.doc?.contact || [company?.email, company?.phone].filter(Boolean).join('  '),
    company: company?.name || '',
    project: bill.doc?.projectTitle || project?.name || contract.name,
    date: bill.doc?.date || (bill.created_at || '').slice(0, 10),
    title, period,
    sub: [contract.name, contract.party && `לכבוד: ${contract.party}`, bill.month && `חודש ${bill.month.slice(5, 7)}/${bill.month.slice(0, 4)}`].filter(Boolean).join('   ·   '),
  };
}

export async function exportBill(ExcelJS, { contract, bill, calc, sections, period = null, company = null, project = null }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'KAYAN BOQ';
  const D = docInfo({ contract, bill, company, project, period });
  const sec = new Map(sections.map((s) => [s.code, s.name]));
  if (period) monthlySheet(wb, { sec, period, D });
  const ws = wb.addWorksheet(period ? 'פירוט מצטבר' : 'פירוט');
  const NC = 10;
  ws.columns = [10, 52, 8, 11, 8, 12, 12, 12, 12, 15].map((w) => ({ width: w }));
  billDoc(ws, NC, { ...D, title: period ? `${D.title} — פירוט מצטבר` : D.title }, { landscape: true });
  billHeader(ws, ['סעיף', 'תאור', 'יחידה', 'כמות חוזה', '% ביצוע', 'מצטבר קודם', 'כמות נוכחית', 'כמות\nמצטברת', 'מחיר יחידה', calc.mode === 'periodic' ? 'סה"כ לתקופה' : 'סה"כ מצטבר']);
  const FM = { 4: QTY, 5: '0.00%', 6: QTY, 7: QTY, 8: QTY, 9: MONEY, 10: MONEY };
  let lastStruct = null;
  for (const g of calc.totals.groups) {
    const rows = calc.rows.filter((r) => `${r.struct}.${r.chapter}` === g.key && (r.amount || r.cumQ !== '0' || r.prevQ !== '0'));
    if (!rows.length) continue;
    if (g.struct !== lastStruct) { lastStruct = g.struct; tableRow(ws, ['', `מבנה ${+g.struct} ${sec.get(g.struct) ?? ''}`], NC, { kind: 'head', top: MED, fill: SUM_FILL }); }
    tableRow(ws, [g.chapter, `פרק ${g.chapter} ${g.name}`], NC, { kind: 'head' });
    const subRows = [];
    let cur = null, first = 0;
    const closeSub = () => {
      if (cur == null) return;
      const t = tableRow(ws, ['', `סה"כ ${g.chapter}.${+cur} ${sec.get(`${g.key}.${cur}`) ?? ''}`], NC, { kind: 'sum', top: THIN, bottom: THIN, fill: SUM_FILL, numFmts: FM });
      t.getCell(10).value = { formula: `SUM(J${first}:J${t.number - 1})`, result: (g.subs?.[cur] ?? 0) / 100 };
      subRows.push(t.number);
    };
    for (const r of rows) {
      if (r.sub !== cur) {
        closeSub(); cur = r.sub;
        tableRow(ws, [`${g.chapter}.${+cur}`, `תת פרק ${g.chapter}.${+cur} ${sec.get(`${g.key}.${cur}`) ?? ''}`], NC, { kind: 'head' });
        first = ws.rowCount + 1;
      }
      const row = tableRow(ws, [`${r.chapter}.${+r.sub}.${String(r.num).padStart(3, '0')}`, r.description, r.unit, n(r.contractQty), null, n(r.prevQ), null, n(r.cumQ), n(r.price)], NC, { numFmts: FM });
      const k = row.number;
      row.getCell(5).value = { formula: `IF(D${k}=0,"",H${k}/D${k})`, result: n(r.contractQty) ? n(r.cumQ) / n(r.contractQty) : '' };
      row.getCell(7).value = { formula: `H${k}-F${k}`, result: n(r.curQ) };
      row.getCell(10).value = { formula: calc.mode === 'periodic' ? `G${k}*I${k}` : `H${k}*I${k}`, result: r.amount / 100 };
    }
    closeSub();
    const t = tableRow(ws, ['', `סה"כ ${g.chapter} ${g.name}`], NC, { kind: 'sum', top: MED, fill: CHAP_FILL, numFmts: FM });
    t.getCell(10).value = { formula: subRows.map((x) => `J${x}`).join('+') || '0', result: g.gross / 100 };
    if (g.discount) {
      const lines = discountLines(g, (c) => (c / 100).toFixed(2));
      const dFirst = ws.rowCount + 1;
      for (const L of lines) {
        const d = tableRow(ws, ['', L.label], NC, { kind: 'sum', fill: CHAP_FILL, numFmts: FM });
        // a lone chapter discount keeps its live formula; layered discounts are written as values
        d.getCell(10).value = lines.length === 1 && L.kind === 'chapter' ? { formula: `-ROUND(J${t.number}*${n(g.rate) / 100},2)`, result: -L.amount / 100 } : -L.amount / 100;
      }
      const a = tableRow(ws, ['', `סה"כ ${g.chapter} לאחר הנחה`], NC, { kind: 'sum', fill: CHAP_FILL, numFmts: FM });
      a.getCell(10).value = { formula: `J${t.number}+SUM(J${dFirst}:J${a.number - 1})`, result: g.net / 100 };
    }
    closeTable(ws, NC);
  }
  concentrationSheet(wb, { sec, T: period ? period.T : calc.totals, D, period });
  summarySheet(wb, { calc, D, period });
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

/** Monthly (non-cumulative) detail: only this month's quantities and amounts — portrait, as printed. */
function monthlySheet(wb, { sec, period, D }) {
  const ws = wb.addWorksheet('פירוט חודשי');
  const NC = 7;
  ws.columns = [10, 56, 8, 12, 12, 12, 15].map((w) => ({ width: w }));
  billDoc(ws, NC, { ...D, title: `${D.title} — חודשי` }, { landscape: false });
  billHeader(ws, ['סעיף', 'תאור', 'יחידה', 'כמות חוזה', 'כמות החודש', 'מחיר יחידה', 'סה"כ לחודש']);
  const FM = { 4: QTY, 5: QTY, 6: MONEY, 7: MONEY };
  let lastStruct = null;
  for (const g of period.groups) {
    const rows = period.rows.filter((r) => `${r.struct}.${r.chapter}` === g.key && r.curQ !== '0');
    if (!rows.length) continue;
    if (g.struct !== lastStruct) { lastStruct = g.struct; tableRow(ws, ['', `מבנה ${+g.struct} ${sec.get(g.struct) ?? ''}`], NC, { kind: 'head', top: MED, fill: SUM_FILL }); }
    tableRow(ws, [g.chapter, `פרק ${g.chapter} ${g.name}`], NC, { kind: 'head' });
    let cur = null;
    for (const r of rows) {
      if (r.sub !== cur) { cur = r.sub; tableRow(ws, [`${g.chapter}.${+cur}`, `תת פרק ${g.chapter}.${+cur} ${sec.get(`${g.key}.${cur}`) ?? ''}`], NC, { kind: 'head' }); }
      const row = tableRow(ws, [`${r.chapter}.${+r.sub}.${String(r.num).padStart(3, '0')}`, r.description, r.unit, n(r.contractQty), n(r.curQ), n(r.price), r.pAmount / 100], NC, { numFmts: FM });
      if (String(r.percent ?? '100') === '100') row.getCell(7).value = { formula: `ROUND(E${row.number}*F${row.number},2)`, result: r.pAmount / 100 };
    }
    tableRow(ws, ['', `סה"כ ${g.chapter} ${g.name} — לחודש`, '', '', '', '', g.gross / 100], NC, { kind: 'sum', top: MED, fill: CHAP_FILL, numFmts: FM });
    if (g.discount) {
      for (const L of discountLines(g, (c) => (c / 100).toFixed(2))) tableRow(ws, ['', L.label, '', '', '', '', -L.amount / 100], NC, { kind: 'sum', fill: CHAP_FILL, numFmts: FM });
      tableRow(ws, ['', `סה"כ ${g.chapter} לאחר הנחה — לחודש`, '', '', '', '', g.net / 100], NC, { kind: 'sum', fill: CHAP_FILL, numFmts: FM });
    }
    closeTable(ws, NC);
  }
}

/** ריכוז: subchapter / chapter / structure amounts in their own columns, then the general discount. */
function concentrationSheet(wb, { sec, T, D, period }) {
  const ws = wb.addWorksheet('ריכוז');
  const NC = 4;
  ws.columns = [56, 18, 18, 18].map((w) => ({ width: w }));
  billDoc(ws, NC, { ...D, title: `${D.title}  (ריכוז)` }, { landscape: false });
  const w = period ? 'לחודש' : 'מצטבר';
  billHeader(ws, ['', `סכום ${w}\nתת פרק`, `סכום ${w}\nפרק`, `סכום ${w}\nמבנה`]);
  const FM = { 2: MONEY, 3: MONEY, 4: MONEY };
  const put = (label, col, amount, o = {}) => { const v = ['', null, null, null]; v[0] = label; if (col) v[col] = amount / 100; return tableRow(ws, v, NC, { numFmts: FM, ...o }); };
  for (const s of [...new Set(T.groups.map((g) => g.struct))]) {
    const gs = T.groups.filter((g) => g.struct === s && g.gross !== 0);
    if (!gs.length) continue;
    put(`מבנה ${+s} ${sec.get(s) ?? ''}`, 0, 0, { kind: 'head' });
    let total = 0;
    for (const g of gs) {
      put(`פרק ${g.chapter} ${g.name}`, 0, 0, { kind: 'head' });
      for (const [sub, amt] of Object.entries(g.subs ?? {}).sort()) if (amt) put(`   תת פרק ${g.chapter}.${+sub} ${sec.get(`${g.key}.${sub}`) ?? ''}`, 1, amt);
      put(g.discount ? `סה"כ ${g.chapter} לאחר הנחות מסך ${(g.gross / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : `סה"כ ${g.chapter} ${g.name}`, 2, g.net, { kind: 'sum', top: THIN, bottom: MED });
      total += g.net;
    }
    put(`סה"כ מבנה ${+s} ${sec.get(s) ?? ''}`, 3, total, { kind: 'sum', top: THIN, bottom: MED, fill: SUM_FILL });
  }
  closeTable(ws, NC);
  ws.addRow([]);
  const G = (label, v, o = {}) => { const r = ws.addRow([label, null, null, v / 100]); r.getCell(4).numFmt = MONEY; [1, 4].forEach((i) => { r.getCell(i).border = { top: THIN, bottom: o.bottom ?? THIN, left: THIN, right: THIN }; r.getCell(i).font = { bold: !!o.bold }; if (o.fill) r.getCell(i).fill = FILL(o.fill); }); return r; };
  if (T.exempt) {
    G('סכום לחישוב הנחה כללית', T.eligible); if (T.general) G(`הנחה כללית ${n(T.generalRate)}%`, -T.general); G('ועוד סכום ללא הנחה', T.exempt);
  } else { G('סכום לחישוב הנחה / תוספת', T.beforeGeneral); if (T.general) G(`הנחה כללית ${n(T.generalRate)}%`, -T.general); }
  G(period ? 'סה"כ כללי לחודש' : 'סה"כ כללי', T.net, { bold: true, bottom: DBL, fill: CHAP_FILL });
}

/** Payment summary, laid out like the printed one: label · amount · sign, the payable amount boxed. */
function summarySheet(wb, { calc, D, period }) {
  const sm = wb.addWorksheet('סיכום');
  sm.columns = [46, 18, 6].map((w) => ({ width: w }));
  billDoc(sm, 3, D, { landscape: false });
  billHeader(sm, ['', 'סכום ₪', '']);
  const T = calc.totals;
  const L = (label, v, sign = '', o = {}) => ({ label, v, sign, ...o });
  const lines = [
    T.cat?.extra || T.cat?.over ? L('עבודות לפי כמות חוזה', T.cat.contract) : null,
    T.cat?.over ? L('עבודות מעל כמות חוזה', T.cat.over) : null,
    T.cat?.extra ? L('עבודות נוספות', T.cat.extra) : null,
    L('סה"כ ברוטו', T.gross), T.chapterDiscount ? L('הנחות מבנים / פרקים / תתי-פרקים', -T.chapterDiscount, '(-)') : null,
    T.general ? L(`הנחה כללית ${n(T.generalRate)}%`, -T.general, '(-)') : null,
    L('מצטבר מחושב במחירי בסיס', calc.cumNet, '', { bold: true }), L('פחות חשבון קודם', -calc.prevNet, '(-)', { rule: true }),
    L(period ? 'ביצוע בחודש זה' : 'ביצוע לתקופה', calc.periodNet, '', { bold: true }),
    calc.indexation.amount ? L('התייקרות', calc.indexation.amount, '(+)') : null, calc.retention ? L('עיכבון', -calc.retention, '(-)') : null,
    calc.release ? L('שחרור עיכבון', calc.release, '(+)') : null, calc.advance ? L('קיזוז מקדמה', -calc.advance, '(-)') : null,
    calc.materials ? L('קיזוז חומרים / רכש', -calc.materials, '(-)') : null, calc.other ? L(calc.otherLabel, -calc.other, '(-)') : null,
    L('סה"כ לפני מע"מ', calc.beforeVat, '', { bold: true }), L(`מע"מ ${calc.vatRate}%`, calc.vat, '(+)', { rule: true }),
    L('סכום לתשלום בחשבון זה', calc.due, '', { bold: true, due: true }),
  ].filter(Boolean);
  for (const x of lines) {
    const r = sm.addRow([x.label, x.v / 100, x.sign]);
    r.getCell(2).numFmt = MONEY;
    r.height = x.due ? 22 : 18;
    for (let i = 1; i <= 3; i++) {
      const c = r.getCell(i);
      c.border = { left: THIN, right: THIN, bottom: x.due ? DBL : x.rule ? THIN : { style: 'hair', color: { argb: 'FF999999' } }, ...(x.due ? { top: MED } : {}) };
      c.font = { bold: !!x.bold, size: x.due ? 13 : 11 };
      c.alignment = { vertical: 'middle', horizontal: i === 3 ? 'center' : undefined };
      if (x.due) c.fill = FILL(CHAP_FILL);
    }
  }
  const nb = sm.addRow([]); nb.height = 30;
  sm.addRow(['שם, חתימה וחותמת הקבלן', 'תאריך']).eachCell((c) => { c.border = { top: THIN }; c.alignment = { horizontal: 'center' }; });
}

/** First (or chosen) worksheet → rows of trimmed strings, for the column-mapping dialog. */
export async function readSheetRows(ExcelJS, bytes) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const sheets = wb.worksheets.map((ws) => {
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const vals = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        let v = cell.value;
        if (v && typeof v === 'object') v = v.result ?? v.text ?? (v.richText ? v.richText.map((t) => t.text).join('') : '');
        vals[col - 1] = v == null ? '' : String(v).replace(/[\t\r\n]+/g, ' ').trim();
      });
      if (vals.some((x) => x)) rows.push(Array.from(vals, (x) => x ?? ''));
    });
    return { name: ws.name, rows };
  });
  return sheets.filter((s) => s.rows.length);
}

/** Bid form for one bidder: items with an empty, unlocked price column; total = qty × price. */
export async function exportBidForm(ExcelJS, { tender, bidder, sections, company }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'KAYAN BOQ';
  const ws = wb.addWorksheet('הצעת מחיר');
  sheetSetup(ws, [16, 70, 9, 12, 14, 16]);
  ws.views = [{ rightToLeft: true, state: 'frozen', ySplit: 4 }];
  ws.addRow([`${company ?? ''} — מכרז: ${tender.name}`]).font = { bold: true, size: 13 };
  ws.addRow([`מציע: ${bidder?.name ?? ''}`, tender.due ? `מועד הגשה: ${tender.due}` : '']);
  ws.addRow(['יש למלא מחיר יחידה בעמודה E בלבד (לפני מע"מ). אין לשנות את מספרי הסעיפים.']).font = { italic: true, color: { argb: 'FF8A5A00' } };
  header(ws, ['סעיף', 'תאור', 'יחידה', 'כמות', 'מחיר יחידה', 'סה"כ']);
  const sec = new Map(sections.map((s) => [s.code, s.name]));
  let lastSub = null; const totals = [];
  for (const it of tender.items) {
    const subKey = `${it.struct}.${it.chapter}.${it.sub}`;
    if (subKey !== lastSub) { lastSub = subKey; bold(ws.addRow([subKey, `${sec.get(`${it.struct}.${it.chapter}`) ?? ''} · ${sec.get(subKey) ?? ''}`])); }
    const r = ws.addRow([itemCode(it), it.description, it.unit, n(it.qty), null]);
    r.getCell(6).value = { formula: `IF(E${r.number}="","",D${r.number}*E${r.number})` };
    r.getCell(2).alignment = { wrapText: true, vertical: 'top' };
    r.getCell(4).numFmt = QTY; r.getCell(5).numFmt = MONEY; r.getCell(6).numFmt = MONEY;
    r.getCell(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF8DC' } };
    r.getCell(5).protection = { locked: false };
    totals.push(r.number);
  }
  const t = bold(ws.addRow(['', 'סה"כ הצעה (לפני מע"מ)']));
  t.getCell(6).value = { formula: `SUM(F${totals[0] ?? 5}:F${totals.at(-1) ?? 5})` }; t.getCell(6).numFmt = MONEY;
  await ws.protect('', { selectLockedCells: true, selectUnlockedCells: true, formatColumns: true });
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

/** Filled bid form → [{code, price}] (code in column A, price in column E). */
export async function readBidForm(ExcelJS, bytes) {
  const [sheet] = await readSheetRows(ExcelJS, bytes);
  if (!sheet) return [];
  return sheet.rows.filter((r) => /^\d{2}\.\d{2}\.\d{2}\.\d{4}$/.test(r[0] ?? '')).map((r) => ({ code: r[0], price: (r[4] ?? '').trim() }));
}
