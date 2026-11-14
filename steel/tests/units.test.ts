import { describe, expect, it } from 'vitest';
import { formatLength, fromMm, kgPerMeter, toMm } from '../src/core/units';

describe('יחידות', () => {
  it('המרה מטר ↔ מילימטר בשכבה אחת', () => {
    expect(toMm(1.5, 'm')).toBe(1500);
    expect(fromMm(1500, 'm')).toBe(1.5);
    expect(toMm(300, 'mm')).toBe(300);
    expect(formatLength(18000, 'm')).toBe('18.000');
  });
  it('דוחה ערך לא מספרי', () => {
    expect(() => toMm(NaN, 'm')).toThrow();
  });
  it('משקל למטר משטח', () => {
    expect(kgPerMeter(2848, 7850)).toBeCloseTo(22.36, 2);
  });
});
