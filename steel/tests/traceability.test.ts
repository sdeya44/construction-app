/**
 * TRACE — עקיבות חומר (`fab/traceability.ts`): מפתח התאמה, שורות עקיבות, הקצאה אוטומטית (רק כשיש ליט מתאים אחד), דוח, פקודה.
 */
import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { computeFabrication } from '../src/fab/marks';
import { numberParts, setTraceability } from '../src/commands/commands';
import { autoAssign, compatibleLots, lotKey, traceRows, traceTable } from '../src/fab/traceability';
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
});
