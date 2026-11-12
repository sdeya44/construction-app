// Excel import/export (ExcelJS, loaded on demand). Exports keep live formulas so the sheet
// stays checkable in Excel; cached results are written too, so totals show without recalculation.
import { itemCode, isBillable } from './engine.js';
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
export async function exportBill(ExcelJS, { contract, bill, calc, sections }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'KAYAN BOQ';
  const ws = wb.addWorksheet('פירוט');
  sheetSetup(ws, [12, 60, 8, 12, 9, 12, 12, 12, 12, 15]);
  ws.pageSetup.orientation = 'landscape';
  header(ws, ['סעיף', 'תאור', 'יחידה', 'כמות חוזה', '% ביצוע', 'מצטבר קודם', 'כמות נוכחית', 'כמות מצטברת', 'מחיר יחידה', calc.mode === 'periodic' ? 'סה"כ לתקופה' : 'סה"כ מצטבר']);
  const sec = new Map(sections.map((s) => [s.code, s.name]));
  for (const g of calc.totals.groups) {
    const rows = calc.rows.filter((r) => `${r.struct}.${r.chapter}` === g.key && (r.amount || r.cumQ !== '0' || r.prevQ !== '0'));
    if (!rows.length) continue;
    bold(ws.addRow([g.key, `מבנה ${+g.struct} ${sec.get(g.struct) ?? ''} · פרק ${g.chapter} ${g.name}`]));
    const first = ws.rowCount + 1;
    for (const r of rows) {
      const row = ws.addRow([`${r.chapter}.${+r.sub}.${String(r.num).padStart(3, '0')}`, r.description, r.unit, n(r.contractQty), null, n(r.prevQ), null, n(r.cumQ), n(r.price)]);
      const k = row.number;
      row.getCell(5).value = { formula: `IF(D${k}=0,"",H${k}/D${k})`, result: n(r.contractQty) ? n(r.cumQ) / n(r.contractQty) : '' };
      row.getCell(7).value = { formula: `H${k}-F${k}`, result: n(r.curQ) };
      row.getCell(10).value = { formula: calc.mode === 'periodic' ? `G${k}*I${k}` : `H${k}*I${k}`, result: r.amount / 100 };
      row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
      [4, 6, 7, 8].forEach((c) => { row.getCell(c).numFmt = QTY; });
      row.getCell(5).numFmt = '0.00%'; row.getCell(9).numFmt = MONEY; row.getCell(10).numFmt = MONEY;
    }
    const last = ws.rowCount;
    const t = bold(ws.addRow(['', `סה"כ פרק ${g.chapter} ${g.name}`]));
    t.getCell(10).value = { formula: `SUM(J${first}:J${last})`, result: g.gross / 100 }; t.getCell(10).numFmt = MONEY;
    if (g.discount) {
      const d = ws.addRow(['', `הנחה ${g.rate}%`]);
      d.getCell(10).value = { formula: `-ROUND(J${t.number}*${n(g.rate) / 100},2)`, result: -g.discount / 100 }; d.getCell(10).numFmt = MONEY;
      const a = bold(ws.addRow(['', `סה"כ פרק ${g.chapter} לאחר הנחה`]));
      a.getCell(10).value = { formula: `J${t.number}+J${d.number}`, result: g.net / 100 }; a.getCell(10).numFmt = MONEY;
    }
    ws.addRow([]);
  }
  const sm = wb.addWorksheet('סיכום');
  sheetSetup(sm, [42, 18]);
  header(sm, [`${bill.type === 'final' ? 'חשבון סופי' : 'חשבון חלקי'} ${bill.doc?.displayNumber || bill.number} — ${contract.name}`, '₪']);
  const T = calc.totals;
  const lines = [
    ['סה"כ ברוטו', T.gross], ['הנחות פרקים', -T.chapterDiscount], [`הנחה כללית ${T.generalRate}%`, -T.general],
    ['מצטבר מחושב במחירי בסיס', calc.cumNet], ['פחות חשבון קודם', -calc.prevNet], ['ביצוע לתקופה', calc.periodNet],
    ['התייקרות', calc.indexation.amount], ['עיכבון', -calc.retention], ['שחרור עיכבון', calc.release], ['קיזוז מקדמה', -calc.advance],
    ['קיזוז חומרים / רכש', -calc.materials], [calc.otherLabel, -calc.other], ['סה"כ לפני מע"מ', calc.beforeVat], [`מע"מ ${calc.vatRate}%`, calc.vat],
    ['סכום לתשלום בחשבון זה', calc.due],
  ];
  for (const [l, v] of lines) {
    if (!v && !['מצטבר מחושב במחירי בסיס', 'סה"כ לפני מע"מ', 'סכום לתשלום בחשבון זה'].includes(l)) continue;
    const r = sm.addRow([l, v / 100]);
    r.getCell(2).numFmt = MONEY;
    if (/מצטבר מחושב|לפני מע"מ|לתשלום/.test(l)) r.font = { bold: true };
  }
  return new Uint8Array(await wb.xlsx.writeBuffer());
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
