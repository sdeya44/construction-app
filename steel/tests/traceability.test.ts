/**
 * TRACE — עקיבות חומר (`fab/traceability.ts`): מפתח התאמה, שורות עקיבות, הקצאה אוטומטית (רק כשיש ליט מתאים אחד), דוח, פקודה.
 */
import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { computeFabrication } from '../src/fab/marks';
import { numberParts, setTraceability } from '../src/commands/commands';
import { autoAssign, compatibleLots, LOT_CSV_MAX_ROWS, LOT_CSV_TEMPLATE, lotKey, parseLotsCsv, traceRows, traceTable } from '../src/fab/traceability';
import { toCsv } from '../src/fab/export';
import type { StockLot } from '../src/model/types';

const setup = () => { const p = numberParts().run(newProject('tr', defaultBuilding())); const d = generate(p); const fab = computeFabrication(p, d); return { p, d, fab }; };
const lot = (id: string, heat: string, profile: string, material: string): StockLot => ({ id, heat, cert: `C-${heat}`, profile, material });

describe('TRACE עקיבות חומר', () => {
  it('TRACE-01: lotKey — פלטה לפי עובי, פרופיל לפי שם', () => {
    expect(lotKey('PL15x200')).toBe('PL15'); expect(lotKey('PL 15')).toBe('PL15'); expect(lotKey('pl8.5x100')).toBe('PL8.5');
    expect(lotKey('ipe200')).toBe('IPE200'); expect(lotKey('HEA140')).toBe('HEA140');
  });
  it('TRACE-02: בלי ליטים — כל הסימונים "לא מוקצה"; דוח עם שורת סיכום והערה', () => {
    const { p, d, fab } = setup();
    const rows = traceRows(p, d, fab);
    expect(rows.length).toBeGreaterThan(5);
    expect(rows.every((r) => r.status === 'unassigned')).toBe(true);
    const t = traceTable(p, d, fab);
    expect(t.headers).toEqual(['סימון', 'תיאור', 'חתך', 'חומר', 'כמות', 'היתך', 'תעודה', 'סטטוס']);
    expect(t.rows.at(-2)![7]).toContain(`0 מתוך ${rows.length}`);
    expect(toCsv(t)).toContain('אינו אימות תעודות');
  });
  it('TRACE-03: הקצאה אוטומטית — ליט מתאים אחד מוקצה; כמה ליטים — לא מנחשים; בלי ליט — נשאר', () => {
    const { p, d, fab } = setup();
    const rows = traceRows(p, d, fab);
    const col = rows.find((r) => r.profile === p.building.columnProfile)!;
    const beam = rows.find((r) => r.profile === p.building.rafterProfile)!;
    const p1 = setTraceability({ lots: [lot('L1', 'H100', col.profile, col.material), lot('L2', 'H200', beam.profile, beam.material), lot('L3', 'H201', beam.profile, beam.material)], assign: {} }).run(p);
    const r = autoAssign(p1, d, fab);
    expect(r.added).toBeGreaterThan(0);
    expect(r.assign[col.mark]).toBe('L1');
    expect(r.assign[beam.mark]).toBeUndefined();
    expect(r.ambiguous).toContain(beam.mark);
    expect(r.none.length).toBeGreaterThan(0);
    const p2 = setTraceability({ lots: p1.traceability!.lots, assign: r.assign }).run(p1);
    const again = traceRows(p2, d, fab).find((x) => x.mark === col.mark)!;
    expect(again.status).toBe('ok'); expect(again.lot?.heat).toBe('H100');
    expect(compatibleLots(p2, beam).map((l) => l.id)).toEqual(['L2', 'L3']);
  });
  it('TRACE-04: ליט לא תואם (חתך/חומר אחר) מסומן; מחיקת ליט מנקה הקצאה; הדוח מציג היתך ותעודה', () => {
    const { p, d, fab } = setup();
    const col = traceRows(p, d, fab).find((r) => r.profile === p.building.columnProfile)!;
    const lots = [lot('L1', 'H1', 'IPE999', col.material)];
    const bad = setTraceability({ lots, assign: { [col.mark]: 'L1' } }).run(p);
    expect(traceRows(bad, d, fab).find((r) => r.mark === col.mark)!.status).toBe('mismatch');
    const good = setTraceability({ lots: [lot('L2', 'H77', col.profile, col.material)], assign: { [col.mark]: 'L2' } }).run(p);
    expect(traceTable(good, d, fab).rows.find((r) => r[0] === col.mark)!.slice(5, 8)).toEqual(['H77', 'C-H77', 'מוקצה']);
    const del = setTraceability({ lots: [], assign: good.traceability!.assign }).run(good);
    expect(del.traceability!.assign).toEqual({});
    expect(newProject('x', defaultBuilding()).traceability).toBeUndefined(); // אופציונלי — אין מיגרציה
  });
  it('TRACE-05: הפקודה אינה משנה את המודל הנגזר (גיאומטריה זהה)', () => {
    const { p, d } = setup();
    const p2 = setTraceability({ lots: [lot('L1', 'H1', 'HEA140', 'S235')], assign: {} }).run(p);
    const d2 = generate(p2);
    expect(d2.members.length).toBe(d.members.length);
    expect(d2.members.map((m) => `${m.id}${m.start.x}${m.end.z}`).join()).toBe(d.members.map((m) => `${m.id}${m.start.x}${m.end.z}`).join());
  });
  it('TRACE-06: ייבוא CSV — מפרידים (פסיק/נקודה-פסיק/טאב), BOM, CRLF, כותרות בעברית ובאנגלית, מירכאות, שורות ריקות', () => {
    const base = 'היתך,תעודה,חתך,חומר,הערה\nH1,C1,HEA140,S235,"הערה, עם פסיק"\nH2,,PL15,S355,\n';
    const a = parseLotsCsv(base, []);
    expect(a.errors).toEqual([]); expect(a.delimiter).toBe(',');
    expect(a.added.map((l) => [l.id, l.heat, l.cert, l.profile, l.material, l.note])).toEqual([['L1', 'H1', 'C1', 'HEA140', 'S235', 'הערה, עם פסיק'], ['L2', 'H2', undefined, 'PL15', 'S355', undefined]]);
    const b = parseLotsCsv('\uFEFFHeat No;Cert;Section;Grade\r\nH3;C3;IPE200;S355\r\n\r\nH4;;RHS100x5;S235\r\n', []);
    expect(b.errors).toEqual([]); expect(b.delimiter).toBe(';'); expect(b.added.map((l) => l.heat)).toEqual(['H3', 'H4']);
    const c = parseLotsCsv('heat\tprofile\tmaterial\nH5\tHEB200\tS235', []);
    expect(c.delimiter).toBe('\t'); expect(c.added).toHaveLength(1);
    expect(parseLotsCsv(LOT_CSV_TEMPLATE, []).added).toEqual([]); expect(parseLotsCsv(LOT_CSV_TEMPLATE, []).errors).toEqual([]); // תבנית בלי שורות — תקינה וריקה
  });
  it('TRACE-07: ייבוא CSV — שורות לא תקינות מדווחות עם מספר שורה ולא נוספות; חומר חסר אינו מושלם; כפולים (בקובץ ומול קיימים, פלטה לפי עובי) לא נוספים', () => {
    const ex: StockLot[] = [lot('L1', 'H1', 'PL15', 'S235'), lot('L7', 'H9', 'HEA140', 'S235')];
    const r = parseLotsCsv('היתך,חתך,חומר\nH1,PL15x200,s235\n,HEA140,S235\nH2,HEA140,\nH3,,S235\nH4,IPE200,S355\nH4,ipe200,s355\n', ex);
    expect(r.duplicates).toBe(2); // H1 מול קיים (PL15x200≡PL15, חומר ללא רגישות לאותיות) + H4 כפול בקובץ
    expect(r.errors).toEqual([{ line: 3, reason: 'חסר היתך' }, { line: 4, reason: 'חסר חומר' }, { line: 5, reason: 'חסר חתך' }]);
    expect(r.added.map((l) => [l.id, l.heat])).toEqual([['L3', 'H4']]); // מזהה חדש בלי התנגשות עם L1/L7
    // כותרת בלי עמודת חובה / קובץ ריק / גדול מדי / יותר מדי שורות
    expect(parseLotsCsv('היתך,חתך\nH1,HEA140\n', []).errors[0]).toMatchObject({ line: 1, reason: expect.stringContaining('חומר') });
    expect(parseLotsCsv('  \n\n', []).errors[0]!.reason).toBe('הקובץ ריק');
    expect(parseLotsCsv('x'.repeat(1_000_001), []).errors[0]!.reason).toContain('גדול מדי');
    const many = parseLotsCsv(`heat,profile,material\n${Array.from({ length: LOT_CSV_MAX_ROWS + 3 }, (_, i) => `H${i},HEA140,S235`).join('\n')}`, []);
    expect(many.added).toHaveLength(LOT_CSV_MAX_ROWS); expect(many.errors.at(-1)!.reason).toContain('הייבוא נעצר');
    expect(parseLotsCsv(`heat,profile,material\n${'H'.repeat(61)},HEA140,S235`, []).errors).toEqual([{ line: 2, reason: 'ערך ארוך מדי' }]);
  });
  it('TRACE-08: ליטים מיובאים משתתפים בהקצאה האוטומטית; ייבוא חוזר של אותו קובץ אינו מוסיף דבר', () => {
    const { p, d, fab } = setup();
    const col = traceRows(p, d, fab).find((r) => r.profile === p.building.columnProfile)!;
    const csv = `heat,cert,profile,material\nHX-1,CX-1,${col.profile},${col.material}\n`;
    const r1 = parseLotsCsv(csv, []);
    const p1 = setTraceability({ lots: r1.added, assign: {} }).run(p);
    const a = autoAssign(p1, d, fab); expect(a.assign[col.mark]).toBe('L1');
    const r2 = parseLotsCsv(csv, p1.traceability!.lots); expect(r2.added).toEqual([]); expect(r2.duplicates).toBe(1);
  });
});
