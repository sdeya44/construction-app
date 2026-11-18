import { zipSync, strToU8 } from 'fflate';
import type { Bom, CutPlan } from './bom';

export interface Table { name: string; headers: string[]; rows: (string | number)[][] }

/** טבלאות כתב כמויות לייצוא. */
export function bomTables(bom: Bom, plans: CutPlan[]): Table[] {
  const f1 = (n: number) => Math.round(n * 10) / 10;
  return [
    { name: 'חתכים', headers: ['חתך', 'חומר', 'חלקים', 'אורך כולל (מ\')', 'משקל (ק"ג)'], rows: bom.profiles.map((r) => [r.profile, r.material, r.count, f1(r.length / 1000), f1(r.weight)]) },
    { name: 'חלקים', headers: ['סימון', 'תיאור', 'חתך', 'חומר', 'אורך (מ"מ)', 'כמות', 'משקל יח\' (ק"ג)', 'משקל (ק"ג)', 'חורים', 'סטטוס סימון'], rows: bom.parts.map((r) => [r.mark, r.desc, r.profile, r.material, Math.round(r.length), r.qty, f1(r.unitWeight), f1(r.weight), r.holes, r.provisional ? 'זמני' : 'ממוספר']) },
    { name: 'מכלולים', headers: ['סימון', 'חלק ראשי', 'כמות', 'חלקים במכלול', 'משקל יח\' (ק"ג)', 'משקל (ק"ג)'], rows: bom.assemblies.map((r) => [r.mark, r.main, r.qty, r.parts, f1(r.unitWeight), f1(r.weight)]) },
    { name: 'ברגים', headers: ['תיאור', 'קוטר', 'אורך', 'דרגה', 'תקן', 'מקום', 'כמות', 'אומים', 'דיסקיות'], rows: bom.bolts.map((r) => [r.desc, r.d, r.length, r.grade, r.standard, r.location === 'site' ? 'שטח' : 'מסגריה', r.qty, r.nuts, r.washers]) },
    { name: 'ריתוכים', headers: ['a (מ"מ)', 'מקום', 'מספר', 'אורך כולל (מ\')'], rows: bom.welds.map((r) => [r.a, r.location === 'site' ? 'שטח' : 'מסגריה', r.count, f1(r.length / 1000)]) },
    {
      name: 'חיתוך', headers: ['חתך', 'חומר', 'מוט', 'אורך מוט', 'חלקים', 'שארית (מ"מ)'],
      rows: plans.flatMap((p) => [
        ...p.bars.map((b, i) => [p.profile, p.material, i + 1, b.stock, b.cuts.map((c) => `${c.mark}:${Math.round(c.length)}`).join(' + '), Math.round(b.waste)]),
        ...p.tooLong.map((t) => [p.profile, p.material, '—', 'ארוך מהמלאי', `${t.mark}:${Math.round(t.length)}`, '']),
        [p.profile, p.material, 'סיכום', `${p.bars.length} מוטות`, `ניצולת ${(p.utilization * 100).toFixed(1)}%`, Math.round(p.waste)],
      ]),
    },
    orderTable(bom, plans),
  ];
}

/**
 * הזמנת חומר גלם: מספר מוטות לכל חתך ולכל אורך מלאי (מתוכנית החיתוך), משקל רכש;
 * פחים לפי עובי — שטח ומשקל נטו (ללא קינון בגיליון — להוסיף פחת לפי המסגריה).
 */
export function orderTable(bom: Bom, plans: CutPlan[]): Table {
  const f1 = (n: number) => Math.round(n * 10) / 10;
  const kgm = new Map(bom.profiles.map((r) => [`${r.profile}|${r.material}`, r.length > 0 ? (r.weight / r.length) * 1000 : 0]));
  const rows: (string | number)[][] = [];
  let totKg = 0;
  for (const p of plans) {
    const by = new Map<number, number>();
    for (const b of p.bars) by.set(b.stock, (by.get(b.stock) ?? 0) + 1);
    const w = kgm.get(`${p.profile}|${p.material}`) ?? 0;
    for (const [st, n] of [...by.entries()].sort((a, b) => b[0] - a[0])) {
      const kg = (n * st * w) / 1000; totKg += kg;
      rows.push([p.profile, p.material, st / 1000, n, f1((n * st) / 1000), Math.round(kg), `${(p.utilization * 100).toFixed(0)}%`]);
    }
    if (p.tooLong.length) rows.push([p.profile, p.material, 'ארוך מהמלאי', p.tooLong.length, f1(p.tooLong.reduce((a, t) => a + t.length, 0) / 1000), Math.round((p.tooLong.reduce((a, t) => a + t.length, 0) * w) / 1000), 'הזמנה מיוחדת']);
  }
  // פחים: לפי עובי
  const plates = new Map<string, { kg: number; m2: number }>();
  // עובי אמיתי = המידה הקטנה מבין רוחב, "עובי" בשם וחלק האורך (פלטות קצה מוגדרות לפעמים לאורך העובי)
  for (const r of bom.parts) {
    const m = /^PL(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/i.exec(r.profile);
    if (!m) continue;
    const t = Math.round(Math.min(Number(m[1]), Number(m[2]), r.length) * 10) / 10, k = `${t}|${r.material}`;
    const e = plates.get(k) ?? { kg: 0, m2: 0 };
    e.kg += r.weight; e.m2 += r.weight / (7.85 * t); plates.set(k, e);
  }
  for (const [k, e] of [...plates.entries()].sort((a, b) => Number(a[0].split('|')[0]) - Number(b[0].split('|')[0]))) {
    const [t, mat] = k.split('|'); totKg += e.kg;
    rows.push([`פח ${t} מ"מ`, mat, 'גיליון', '', `${f1(e.m2)} מ"ר`, Math.round(e.kg), 'נטו — להוסיף פחת']);
  }
  rows.push(['סה"כ', '', '', '', '', Math.round(totKg), '']);
  return { name: 'הזמנת חומר', headers: ['חתך', 'חומר', 'אורך מוט (מ\')', 'כמות מוטות', 'אורך כולל (מ\')', 'משקל רכש (ק"ג)', 'ניצולת / הערה'], rows };
}

const csvCell = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
/** CSV עם BOM של UTF-8 כדי ש-Excel יציג עברית נכון. */
export function toCsv(t: Table): string {
  return '﻿' + [t.headers, ...t.rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

const xml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!)).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const colName = (i: number) => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

/**
 * קובץ XLSX (Office Open XML) מינימלי ותקני: גיליון לכל טבלה, כיוון ימין לשמאל, כותרת מודגשת וקפואה.
 * נכתב ידנית ונדחס עם fflate — ללא ספריית Excel חיצונית.
 */
export function toXlsx(tables: Table[], title: string): Uint8Array {
  const sheetXml = (t: Table) => {
    const rows = [t.headers, ...t.rows].map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
      const ref = `${colName(ci)}${ri + 1}`;
      const st = ri === 0 ? ' s="1"' : '';
      return typeof v === 'number' && Number.isFinite(v) ? `<c r="${ref}"${st}><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"${st}><is><t xml:space="preserve">${xml(String(v))}</t></is></c>`;
    }).join('')}</row>`).join('');
    const widths = t.headers.map((h, i) => Math.min(60, Math.max(h.length, ...t.rows.map((r) => String(r[i] ?? '').length)) + 2));
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView rightToLeft="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>
<sheetData>${rows}</sheetData></worksheet>`;
  };
  const names = tables.map((t, i) => xml(t.name.slice(0, 31)) || `Sheet${i + 1}`);
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>${tables.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`),
    'docProps/core.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xml(title)}</dc:title><dc:creator>KAYAN STEEL PRO</dc:creator></cp:coreProperties>`),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${names.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${tables.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${tables.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    'xl/styles.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE7F0FB"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`),
  };
  tables.forEach((t, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(t)); });
  return zipSync(files, { level: 6 });
}
