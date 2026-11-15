import { afterAll, describe, expect, it } from 'vitest';
import { toXlsx } from '../src/fab/export';
import { buildRows, detectMapping, readCsv, readXlsx } from '../src/profiles/importTable';
import { clearProfileCache, getProfile, massPerMeter } from '../src/profiles/library';
import { setUserCatalog } from '../src/profiles/userCatalog';
import { compareRowPure } from './catalogCompare';

// ערכים מקובלים מטבלאות EN לדוגמה (לבדיקת הייבוא וההשוואה בלבד)
const TABLE = [
  ['חתך', 'h', 'b', 'tw', 'tf', 'r', 'A', 'G', 'Iy', 'Iz', 'Wy', 'Wz', 'iy', 'iz'],
  ['IPE 200', 200, 100, 5.6, 8.5, 12, 28.48, 22.4, 1943, 142.4, 194.3, 28.47, 8.26, 2.24],
  ['IPE 300', 300, 150, 7.1, 10.7, 15, 53.81, 42.2, 8356, 603.8, 557.1, 80.5, 12.46, 3.35],
  ['HEA 200', 190, 200, 6.5, 10, 18, 53.83, 42.3, 3692, 1336, 388.6, 133.6, 8.28, 4.98],
];

afterAll(() => { setUserCatalog(null); clearProfileCache(); });

describe('ייבוא קטלוג חתכים', () => {
  it('XLSX: זיהוי כותרות ועמודות אוטומטי (Iy מומנט מול iy רדיוס), יחידות, שורות', () => {
    const bytes = toXlsx([{ name: 'פרופילים', headers: TABLE[0] as string[], rows: TABLE.slice(1) as (string | number)[][] }], 'ספק');
    const rows = readXlsx(bytes);
    expect(rows[1][0]).toBe('IPE 200');
    const { header, map } = detectMapping(rows);
    expect(header).toBe(0);
    expect(map).toMatchObject({ name: 0, h: 1, b: 2, tw: 3, tf: 4, r: 5, A: 6, mass: 7, Iy: 8, Iz: 9, Wy: 10, Wz: 11, iy: 12, iz: 13 });
    const { rows: cat } = buildRows(rows, header, map, {});
    expect(cat.map((r) => r.name)).toEqual(['IPE200', 'IPE300', 'HEA200']);
    expect(cat[0].A).toBeCloseTo(2848, 6);        // cm² → mm²
    expect(cat[0].Iy).toBeCloseTo(1943e4, 0);     // cm⁴ → mm⁴
    expect(cat[0].iy).toBeCloseTo(82.6, 6);       // cm → mm
  });
  it('החישוב הגיאומטרי של התוכנה קרוב לטבלה (A, משקל, Iy, Iz, Wy — עד 2%)', () => {
    const rows = TABLE.slice(1).map((r) => ({ name: String(r[0]).replace(' ', ''), A: (r[6] as number) * 100, mass: r[7] as number, Iy: (r[8] as number) * 1e4, Iz: (r[9] as number) * 1e4, Wy: (r[10] as number) * 1e3 }));
    for (const r of rows) {
      const c = compareRowPure(r);
      for (const k of ['A', 'mass', 'Iy', 'Iz', 'Wy'] as const) expect(Math.abs(c[k]!)).toBeLessThan(2);
    }
  });
  it('אחרי שמירה: החתך מאומת, התכונות והמשקל מהטבלה', () => {
    const rows = buildRows(readXlsx(toXlsx([{ name: 'p', headers: TABLE[0] as string[], rows: TABLE.slice(1) as (string | number)[][] }], 'x')), 0, detectMapping(TABLE as any).map, {}).rows;
    setUserCatalog({ source: 'ספק.xlsx', importedAt: new Date().toISOString(), rows });
    clearProfileCache();
    const p = getProfile('IPE200');
    expect(p.verified).toBe(true);
    expect(p.source).toContain('ספק.xlsx');
    expect(p.props.area).toBeCloseTo(2848, 6);
    expect(p.props.Iy).toBeCloseTo(1943e4, 0);
    expect(massPerMeter(p, 7850)).toBe(22.4);
    expect(getProfile('IPE240').verified).toBe(false); // לא בטבלה
  });
  it('CSV עם נקודה-פסיק, ושם סדרה בשורה נפרדת ("IPE" ואז "200")', () => {
    const csv = '﻿פרופיל;h;b;A\nIPE;;;\n200;200;100;28,48\n220;220;110;33,37\n';
    const rows = readCsv(csv);
    const { header, map } = detectMapping(rows);
    const { rows: cat } = buildRows(rows, header, map, {});
    expect(cat.map((r) => r.name)).toEqual(['IPE200', 'IPE220']);
    expect(cat[1].A).toBeCloseTo(3337, 6);
  });
});
