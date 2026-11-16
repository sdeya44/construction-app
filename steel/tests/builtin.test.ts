import { describe, expect, it } from 'vitest';
import { builtinRow, catalogNames, getProfile } from '../src/profiles/library';

describe('קטלוג פרופילים מובנה (מקובץ הנתונים של המשתמש)', () => {
  it('חתכים חמים: מידות, שטח ומשקל מהטבלה, מאומת', () => {
    const p = getProfile('HEA200');
    expect(p.verified).toBe(true);
    expect(p.catalogMass).toBeCloseTo(42.3, 1);
    expect(p.props.area).toBeCloseTo(5380, 0);
    expect(p.dims.tf).toBe(10);
    expect(getProfile('HE 200 A').name).toBe('HEA200');
    expect(getProfile('IPN 140').family).toBe('INP');
  });
  it('RHS ריבועי בשמות התוכנה = SHS בקטלוג; RHS מלבני; זוויתן', () => {
    const r = getProfile('RHS80x80x4');
    expect(r.family).toBe('RHS');
    expect(r.name).toBe('RHS80x80x4');
    expect(r.verified).toBe(true);
    expect(r.catalogMass).toBeGreaterThan(9); expect(r.catalogMass).toBeLessThan(10);
    expect(getProfile('SHS80x80x4').name).toBe('SHS80x4');
    expect(getProfile('L50x5').catalogMass).toBeCloseTo(3.77, 2);
    expect(builtinRow('RHS 200x100x5 CF')).toBeTruthy();
  });
  it('פרופילים מכופפים: C ו-Z לפי מידות, וקודי יצרן (Z14015, סיגמה B140150); שורות "דורש בדיקה" לא מאומתות', () => {
    expect(getProfile('C60x40x13x2').verified).toBe(true);
    const z = getProfile('Z14015');
    expect(z.family).toBe('Z');
    expect(z.verified).toBe(false); // דורש בדיקה בקובץ המקור
    const s = getProfile('B140150');
    expect(s.family).toBe('C');
    expect(s.note).toContain('סיגמה');
  });
  it('רשימות הבחירה כוללות את כל הגדלים מהקטלוג', () => {
    const g = new Map(catalogNames().map((x) => [x.family, x.names.length]));
    expect(g.get('RHS')!).toBeGreaterThan(300);
    // C/Z: רק שמות מקובלים בני 4 חלקים (גובה×רוחב×שפה×עובי) — קודי יצרן הוסרו מהבחירה
    expect(g.get('C')!).toBeGreaterThan(150);
    const cz = catalogNames().filter((x) => x.family === 'C' || x.family === 'Z').flatMap((x) => x.names);
    expect(cz.every((n) => /^[CZ]\d+(\.\d+)?(x\d+(\.\d+)?){3}$/.test(n))).toBe(true);
    expect(g.get('L')!).toBeGreaterThan(100);
    expect(g.get('HEB')).toBe(24);
  });
});
