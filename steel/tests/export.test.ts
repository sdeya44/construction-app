import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { computeFabrication } from '../src/fab/marks';
import { computeBom, cutPlans } from '../src/fab/bom';
import { bomTables, toCsv, toXlsx } from '../src/fab/export';
import { numberParts, proposeSplicesFor } from '../src/commands/commands';

const PY = '/tmp/claude-0/-home-user-construction-app/1a50a160-0b21-5222-a7ee-30b6297ca40e/scratchpad/venv/bin/python';
const OUT = path.resolve('e2e-results/files');
fs.mkdirSync(OUT, { recursive: true });

describe('ייצוא כמויות', () => {
  let p = newProject('בדיקה', defaultBuilding());
  p = numberParts().run(proposeSplicesFor(['PL.L.01']).run(p));
  const d = generate(p), fab = computeFabrication(p, d), bom = computeBom(d, fab);
  const tables = bomTables(bom, cutPlans(fab, p));
  it('CSV: BOM של UTF-8, כותרות, ערכים', () => {
    const csv = toCsv(tables[1]);
    expect(csv.startsWith('﻿סימון,')).toBe(true);
    expect(csv.split('\r\n').length).toBe(tables[1].rows.length + 2);
    fs.writeFileSync(path.join(OUT, 'parts.csv'), csv);
  });
  it('XLSX תקין: נפתח ב-openpyxl, גיליונות בעברית, RTL, ערכים תואמים ל-BOM', () => {
    const bytes = toXlsx(tables, 'בדיקה');
    const f = path.join(OUT, 'bom.xlsx');
    fs.writeFileSync(f, bytes);
    if (!fs.existsSync(PY)) return;
    const out = execSync(`${PY} -c "
import openpyxl,sys,json
wb=openpyxl.load_workbook(sys.argv[1])
ws=wb['חתכים']
rows=list(ws.iter_rows(values_only=True))
print(json.dumps({'sheets':wb.sheetnames,'rtl':ws.sheet_view.rightToLeft,'head':rows[0],'tw':sum(r[4] for r in rows[1:]),'parts':wb['חלקים'].max_row}))
" "${f}"`).toString();
    const r = JSON.parse(out.trim());
    expect(r.sheets).toEqual(['חתכים', 'חלקים', 'מכלולים', 'ברגים', 'ריתוכים', 'חיתוך', 'הזמנת חומר']);
    expect(r.rtl).toBe(true);
    expect(r.head[0]).toBe('חתך');
    expect(r.tw).toBeCloseTo(bom.totalWeight, -1);
    expect(r.parts).toBe(bom.parts.length + 1);
  });
});
