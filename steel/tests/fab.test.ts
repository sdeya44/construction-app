import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { computeFabrication } from '../src/fab/marks';
import { computeBom, cutPlans } from '../src/fab/bom';
import { History } from '../src/commands/history';
import { approveRevision, numberParts, openNewRevision, proposeSplicesFor, setBuilding, setMemberProps, setPurlinSide } from '../src/commands/commands';
import type { Project } from '../src/model/types';

const geo = () => { const p = newProject('t', defaultBuilding()); p.settings.autoSplice = false; return p; };
const fabOf = (p: Project) => { const d = generate(p); return { d, f: computeFabrication(p, d) }; };
const markOf = (p: Project, partId: string) => fabOf(p).f.byPart.get(partId)!.mark;

describe('מספור, מכלולים, כמויות', () => {
  it('חלקים זהים מקבלים סימון זהה; סימונים זמניים עד מספור', () => {
    const { f } = fabOf(geo());
    const cols = f.parts.filter((x) => x.kind === 'column');
    expect(new Set(cols.map((x) => x.mark)).size).toBe(1);
    const purl = f.parts.filter((x) => x.kind === 'purlin');
    expect(purl.length).toBe(14);
    expect(new Set(purl.map((x) => x.mark)).size).toBe(1);
    expect(f.parts.every((x) => x.provisional)).toBe(true);
    // חורי ברגים בפטה: 2 בכל מסגרת (ווב, תומך) = 12, ועוד חור באגף התחתון בכל מפתח (שורת קשירה) = 5
    expect(purl[0].holes.length).toBe(17);
    expect(purl[0].holes.filter((h) => h.face === 'web').length).toBe(12);
    expect(purl[0].holes.filter((h) => h.face === 'flange').length).toBe(5);
    expect(purl[0].holes.every((h) => h.d === 14)).toBe(true);
  });
  it('מכלול: קורת גג + פלטת קצה + זוויתנים (ריתוך מסגריה); עמוד + פלטת כיפה; פלטה מבוטנת + מוטות (ריתוך העמוד בשטח מפריד)', () => {
    const { f } = fabOf(geo());
    const asOf = (pid: string) => f.assemblies.find((a) => a.parts.includes(pid))!;
    const ra = asOf('F2.RAF.L.P1');
    expect(ra.parts).toContain('C.RIDGE.F2.PL1.P1');
    expect(ra.parts.filter((x) => x.startsWith('CL.')).length).toBe(7);
    const ca = asOf('F2.COL.L.P1');
    expect(ca.parts).toContain('C.EAVE.F2.L.PL.P1');
    expect(ca.parts).not.toContain('C.BASE.F2.L.PL.P1');
    const ba = asOf('C.BASE.F2.L.PL.P1');
    expect(ba.parts.length).toBe(9);
    expect(ba.mark.startsWith('BP')).toBe(true);
  });
  it('מספור יציב: שינוי שאינו משפיע על חלק שומר את הסימון; שינוי חלק — סימון חדש ורישום בהיסטוריה', () => {
    const h = new History(geo());
    h.exec(numberParts());
    const before = markOf(h.current, 'F3.COL.L.P1');
    const raf = markOf(h.current, 'F3.RAF.L.P1');
    expect(fabOf(h.current).f.parts.every((x) => !x.provisional)).toBe(true);
    h.exec(setPurlinSide('left', { spacing: 1400 }));
    expect(markOf(h.current, 'F3.COL.L.P1')).toBe(before);
    expect(markOf(h.current, 'F3.RAF.L.P1')).toBe(raf); // זוויתנים מרותכים — אין חורים בקורה
    h.exec(setMemberProps(['F3.COL.L'], { profile: 'HEB200' }));
    const nf = fabOf(h.current).f;
    expect(nf.byPart.get('F3.COL.L.P1')!.mark).not.toBe(before);
    expect(nf.changed.some((c) => c.id === 'F3.COL.L.P1' && c.from === before)).toBe(true);
    h.exec(numberParts());
    expect(h.current.marks.history.some((x) => x.id === 'F3.COL.L.P1')).toBe(true);
    expect(markOf(h.current, 'F2.COL.L.P1')).toBe(before); // שאר העמודים לא השתנו
  });
  it('BOM-01: שינוי חתך/אורך מעדכן משקל, כמות וחיתוך באופן עקבי', () => {
    const p = proposeSplicesFor(['PL.L.01', 'PL.L.02']).run(geo());
    const { d, f } = fabOf(p);
    const bom = computeBom(d, f);
    const sumParts = bom.parts.reduce((s, r) => s + r.weight, 0);
    const sumProf = bom.profiles.reduce((s, r) => s + r.weight, 0);
    expect(sumParts).toBeCloseTo(sumProf, 6);
    expect(bom.totalWeight).toBeCloseTo(sumProf, 6);
    const c200 = bom.profiles.find((r) => r.profile === 'C200x80x20x3')!;
    expect(c200.count).toBe(12 + 2 * 3); // 12 קווים בחלק אחד + 2 קווים בשלושה חלקים (12/12/6.1)
    expect(c200.length).toBeCloseTo(14 * 30100, 6);
    const cleatBolts = bom.bolts.find((b) => b.d === 12 && b.length === 35)!;
    // 2 קווים × 2 תפרים סמוך לתומך: 2 ברגי תומך בכל תפר עוברים גם בפלטת ההמשך (ארוכים יותר)
    expect(cleatBolts.qty).toBe(84 * 2 - 2 * 2 * 2);
    expect(bom.bolts.filter((b) => b.d === 12).reduce((s, b) => s + b.qty, 0)).toBe(84 * 2 + 5 * 14 + 2 * 2 * 4);
    expect(cleatBolts.location).toBe('site');
    const tieBolts = bom.bolts.find((b) => b.d === 12 && b.length === 30)!;
    expect(tieBolts.qty).toBe(5 * 14 + 2 * 2 * 4); // שורת קשירה: בורג בכל הצטלבות + ברגי פלטות המשך (אותו אורך)
    // שינוי חתך הפטה — משקל, כמות וחיתוך מתעדכנים
    const p2 = setPurlinSide('left', { profile: 'C250x80x20x3' }).run(p);
    const r2 = fabOf(p2), bom2 = computeBom(r2.d, r2.f);
    expect(bom2.profiles.find((r) => r.profile === 'C250x80x20x3')!.length).toBeCloseTo(7 * 30100, 6);
    expect(bom2.totalWeight).toBeGreaterThan(bom.totalWeight);
    const plans = cutPlans(r2.f, p2);
    const c250 = plans.find((x) => x.profile === 'C250x80x20x3')!;
    // חלקים שארוכים מהמלאי מדווחים בנפרד ואינם בתוכנית החיתוך
    expect(c250.partsTotal + c250.tooLong.reduce((s, x) => s + x.length, 0)).toBeCloseTo(7 * 30100, 6);
    expect(c250.tooLong.length).toBe(5);
  });
  it('חיתוך: חלקים של 12/12/6 מ\' על מוטות 12 ו-6 מ\' — ניצולת 100%; חלק ארוך מהמלאי מדווח', () => {
    let p = proposeSplicesFor(['PL.L.03']).run(geo());
    const { f } = fabOf(p);
    const pl = cutPlans(f, p).find((x) => x.profile === 'C200x80x20x3')!;
    expect(pl.tooLong.length).toBe(13); // שאר הפטות 30 מ' ללא חיבורי המשך
    // חלקים 12000/12000/6100: מוט מלא לכל חלק ארוך (החלטת משתמש: ניצול מוט 12 מ')
    expect(pl.bars.reduce((s, b) => s + b.cuts.length, 0)).toBe(3);
    expect(pl.partsTotal).toBeCloseTo(30100, 6);
    expect(pl.bars.every((b) => b.cuts.reduce((s, c) => s + c.length, 0) + (b.cuts.length - 1) * 3 <= b.stock)).toBe(true);
    p = setBuilding({ purlinOverhangEnd: 0 }).run(p);
  });
  it('נעילת מהדורה: אחרי אישור — שינוי נדחה; פתיחת מהדורה B מאפשרת שינוי', () => {
    const h = new History(geo());
    h.exec(approveRevision('הגשה ראשונה'));
    expect(h.current.revision.locked).toBe(true);
    expect(() => h.exec(setBuilding({ width: 20000 }))).toThrow(/נעולה/);
    h.exec(openNewRevision('תיקונים'));
    expect(h.current.revision.current).toBe('B');
    h.exec(setBuilding({ width: 20000 }));
    expect(h.current.building.width).toBe(20000);
    expect(h.current.revision.log.map((x) => `${x.rev}:${x.status}`)).toEqual(['A:approved', 'B:draft']);
  });
});
