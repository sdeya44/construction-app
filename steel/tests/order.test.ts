import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { computeFabrication } from '../src/fab/marks';
import { computeBom, cutPlans } from '../src/fab/bom';
import { orderTable } from '../src/fab/export';

describe('הזמנת חומר גלם', () => {
  it('ORD-01: מספר מוטות לכל חתך ואורך מלאי = תוכנית החיתוך; פחים לפי עובי', () => {
    const p = newProject('x', defaultBuilding());
    p.settings.stockLengths = [6000, 12000];
    const d = generate(p), fab = computeFabrication(p, d), bom = computeBom(d, fab), plans = cutPlans(fab, p);
    const t = orderTable(bom, plans);
    const bars = t.rows.filter((r) => typeof r[2] === 'number');
    expect(bars.reduce((a, r) => a + (r[3] as number), 0)).toBe(plans.reduce((a, pl) => a + pl.bars.length, 0));
    expect(bars.every((r) => r[2] === 6 || r[2] === 12)).toBe(true);
    expect(t.rows.some((r) => String(r[0]).startsWith('פח '))).toBe(true);
    expect(t.rows.filter((r) => String(r[0]).startsWith('פח ')).every((r) => Number(String(r[0]).match(/[\d.]+/)![0]) <= 40)).toBe(true);
  });
});
