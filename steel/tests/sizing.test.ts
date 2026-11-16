import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { assessCandidate, sizingAll } from '../src/model/sizing';
import { computeFabrication } from '../src/fab/marks';
import { computeBom, cutPlans } from '../src/fab/bom';
import { computeQuote, DEFAULT_PRICING } from '../src/fab/quote';

describe('הערכת גדלים (כללי אצבע) והצעת מחיר', () => {
  const p = newProject('x', defaultBuilding());
  const d = generate(p);
  it('SZ-01: קורה במפתח 18 מ\' — IPE200 קטן, IPE400 סביר; עמוד HEA500 גדול מדי', () => {
    expect(assessCandidate(p, d, 'rafter', 'IPE200').status).toBe('small');
    expect(assessCandidate(p, d, 'rafter', 'IPE400').status).toBe('ok');
    expect(assessCandidate(p, d, 'column', 'HEA160').status).toBe('small');
    expect(assessCandidate(p, d, 'column', 'HEA500').status).toBe('big');
  });
  it('SZ-02: הספים ניתנים לעריכה — עומק מינימלי L/30 הופך IPE400 לקטן; עומס נמוך מוריד ניצולת', () => {
    const p2 = { ...p, settings: { ...p.settings, sizing: { rafterMinDepth: 30 } } };
    expect(assessCandidate(p2, d, 'rafter', 'IPE400').status).toBe('small');
    const p3 = { ...p, settings: { ...p.settings, sizing: { live: 0.1 } } };
    expect(assessCandidate(p3, d, 'rafter', 'IPE600').util!).toBeLessThan(assessCandidate(p, d, 'rafter', 'IPE600').util!);
  });
  it('SZ-03: פטות C200 במפתח 6 מ\' סבירות; כל אלמנט ראשי מקבל הערכה עם הסבר', () => {
    expect(assessCandidate(p, d, 'purlin', 'C200x80x20x3').status).toBe('ok');
    const r = sizingAll(p, d);
    for (const m of d.members.filter((x) => x.kind === 'column' || x.kind === 'rafter')) expect(r.get(m.id)?.text.length).toBeGreaterThan(10);
  });
  it('Q-01: הצעת מחיר — סכום שורות, תקורה, רווח, מע"מ', () => {
    const fab = computeFabrication(p, d), bom = computeBom(d, fab), plans = cutPlans(fab, p);
    const q = computeQuote({ ...DEFAULT_PRICING, steelPerKg: 5, galvPerKg: 2, overheadPct: 10, marginPct: 10, vatPct: 18 }, d, fab, bom, plans);
    expect(q.buyKg).toBeGreaterThan(q.netKg * 0.98);
    expect(q.subtotal).toBeCloseTo(q.lines.reduce((a, l) => a + l.total, 0), 6);
    expect(q.beforeVat).toBeCloseTo(q.subtotal * 1.1 * 1.1, 6);
    expect(q.total).toBeCloseTo(q.beforeVat * 1.18, 6);
  });
});
