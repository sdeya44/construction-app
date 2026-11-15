import { describe, expect, it } from 'vitest';
import { getProfile, normalizeName, tryProfile } from '../src/profiles/library';
import { kgPerMeter } from '../src/core/units';

describe('ספריית חתכים', () => {
  it('IPE200: שטח ומומנט התמד מחושבים מהגיאומטריה בקירוב לערכים המקובלים', () => {
    const p = getProfile('IPE 200');
    expect(p.props.h).toBeCloseTo(200, 6);
    expect(p.props.b).toBeCloseTo(100, 6);
    // ערך מקובל ~28.5 ס"מ² ו-Iy ~1943 ס"מ⁴; רדיוסי השורש מקורבים בקשתות
    expect(p.props.area / 100).toBeCloseTo(28.48, 0);
    expect(p.props.Iy / 1e4).toBeGreaterThan(1900);
    expect(p.props.Iy / 1e4).toBeLessThan(1960);
    expect(kgPerMeter(p.props.area, 7850)).toBeCloseTo(22.4, 0);
    expect(p.verified).toBe(true); // קטלוג פרופילים מובנה (CSV המשתמש)
    expect(p.catalogMass).toBeCloseTo(22.4, 0);
  });
  it('SHS160x6 ו-SHS160x160x6 הם אותו חתך', () => {
    expect(getProfile('SHS160x160x6').name).toBe('SHS160x6');
    const p = getProfile('shs 160*6');
    expect(p.props.area).toBeGreaterThan(3400);
    expect(p.props.area).toBeLessThan(3700);
    expect(p.outline.holes.length).toBe(1);
  });
  it('Z: אגפים לכיוונים מנוגדים; C: שני האגפים לאותו צד', () => {
    const z = getProfile('Z200x70x20x2.5');
    const top = z.outline.outer.filter((p) => p.v > 99);
    const bot = z.outline.outer.filter((p) => p.v < -99);
    const cuTop = top.reduce((s, p) => s + p.u, 0) / top.length;
    const cuBot = bot.reduce((s, p) => s + p.u, 0) / bot.length;
    expect(Math.sign(cuTop)).toBe(-Math.sign(cuBot));
    const c = getProfile('C200x70x20x2.5');
    const ctop = c.outline.outer.filter((p) => p.v > 99);
    const cbot = c.outline.outer.filter((p) => p.v < -99);
    const maxTop = Math.max(...ctop.map((p) => p.u)), maxBot = Math.max(...cbot.map((p) => p.u));
    expect(maxTop).toBeCloseTo(maxBot, 6);
    expect(c.props.area).toBeGreaterThan(0);
    expect(z.props.area).toBeCloseTo(c.props.area, 0);
  });
  it('דוחה חתכים לא קיימים ומידות לא תקינות', () => {
    expect(tryProfile('IPE210')).toBeNull();
    expect(tryProfile('SHS100x60')).toBeNull();
    expect(tryProfile('XYZ')).toBeNull();
    expect(normalizeName(' hea 160 ')).toBe('HEA160');
  });
});
