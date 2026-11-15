import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { applyIssueFixes, dismissIssues, setCleat } from '../src/commands/commands';
import { issueKey } from '../src/model/issues';

describe('ניהול הודעות', () => {
  it('הסתרת סוג שלם / הודעה בודדת, שחזור; שגיאה לעולם אינה מוסתרת', () => {
    const p = newProject('t', defaultBuilding());
    const d = generate(p);
    const info = d.issues.find((i) => i.code === 'RAFTER_EXT')!;
    expect(info).toBeDefined();
    let p2 = dismissIssues(['RAFTER_EXT|*'], true).run(p);
    let d2 = generate(p2);
    expect(d2.issues.some((i) => i.code === 'RAFTER_EXT')).toBe(false);
    expect(d2.hiddenIssues!.some((i) => i.code === 'RAFTER_EXT')).toBe(true);
    p2 = dismissIssues(['RAFTER_EXT|*'], false).run(p2);
    expect(generate(p2).issues.some((i) => i.code === 'RAFTER_EXT')).toBe(true);
    p2 = dismissIssues([issueKey(info)], true).run(p);
    expect(generate(p2).issues.some((i) => i.code === 'RAFTER_EXT')).toBe(false);
    // שגיאה: לא מוסתרת גם כשהסוג סומן
    const pe = dismissIssues(['CLASH|*'], true).run(setCleat('left', { height: 400 }).run(p));
    d2 = generate(pe);
    expect(d2.issues.filter((i) => i.severity === 'error').length).toBeGreaterThan(0);
  });
  it('ריתוך פלטה מבוטנת: הודעה אחת בלבד', () => {
    const d = generate(newProject('t', defaultBuilding()));
    expect(d.issues.filter((i) => i.code === 'SITE_WELD_OK').length).toBe(1);
  });
  it('מרחק קצה בתומך: הצעת תיקון (הרחבת הזוויתן), "תקן הכל" בפקודה אחת מתקן את כל התומכים', () => {
    const p = setCleat('left', { width: 80 }).run(newProject('t', defaultBuilding())); // e = 80/2 − 25 = 15 < 16.8
    const d = generate(p);
    const iss = d.issues.filter((i) => i.code === 'BOLT_EDGE' && i.cleatFix);
    expect(iss.length).toBeGreaterThan(10);
    expect(iss[0].cleatFix!.patch).toEqual({ width: 90 }); // 50 + 2×20
    const p2 = applyIssueFixes(iss).run(p);
    expect(generate(p2).issues.filter((i) => i.code === 'BOLT_EDGE' && i.elementId?.startsWith('CL.PL.L')).length).toBe(0);
  });
});
