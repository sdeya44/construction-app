/**
 * CPAR — פרמטרי חיבור (`setConnection` / `setConnectionDefault`): כללי התקינות הקיימים (`checkPlate`) וסדר עריכות.
 * CPAR-01: ערכים לא תקינים נדחים בפקודה ובלי שינוי בפרויקט. CPAR-02: עריכות שונות במפתחות שונים — שקילות בכל סדר; אותו מפתח פעמיים — האחרון קובע.
 * גיאומטריה בלבד — לא תכן חוזק.
 */
import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { CommandError, setConnection, setConnectionDefault } from '../src/commands/commands';
import type { Project } from '../src/model/types';

const P = (): Project => newProject('cp', defaultBuilding());
const ID = 'C.EAVE.F2.L';
const rejects = (patch: Parameters<typeof setConnection>[1], msg: RegExp | string) => { const p = P(); expect(() => setConnection(ID, patch).run(p)).toThrow(CommandError); expect(() => setConnection(ID, patch).run(p)).toThrow(msg); expect(p.connectionOverrides[ID]).toBeUndefined(); };

describe('CPAR פרמטרי חיבור', () => {
  it('CPAR-01: כללי תקינות קיימים — עובי חיובי, ערכים סופיים ולא שליליים, ברגים 1–8 שלמים, קוטר מרשימה; הפרויקט אינו משתנה', () => {
    rejects({ t: 0 }, 'עובי פלטה חייב להיות חיובי');
    rejects({ t: -5 }, 'ערך לא תקין');
    rejects({ t: NaN }, 'ערך לא תקין'); rejects({ t: Infinity }, 'ערך לא תקין');
    for (const k of ['w', 'l', 'gauge', 'pitch', 'weldSize'] as const) rejects({ [k]: -1 }, 'ערך לא תקין');
    for (const v of [0, 9, 2.5, -1, NaN]) { rejects({ cols: v }, 'מספר ברגים 1–8'); rejects({ rows: v }, 'מספר ברגים 1–8'); }
    rejects({ bolt: { d: 18 } as never }, 'קוטר בורג');
    expect(() => setConnectionDefault('eave', { t: 0 }).run(P())).toThrow(CommandError);
    // גבולות תקינים מתקבלים: 1 ו-8 ברגים, עובי קטן חיובי, קוטר מהרשימה
    const ok = setConnection(ID, { cols: 1, rows: 8, t: 0.5, bolt: { d: 12 } as never }).run(P());
    expect(ok.connectionOverrides[ID]).toMatchObject({ cols: 1, rows: 8, t: 0.5 });
    // ערך 0 לרוחב/אורך/מרווח: הפקודה אינה אוסרת אותו (כלל קיים: ≥ 0) — מתועד כאן כאפיון, לא כהחלטה הנדסית
    expect(() => setConnection(ID, { w: 0 }).run(P())).not.toThrow();
  });
  it('CPAR-02: אותן עריכות בסדרים שונים — אותו override ואותה גיאומטריה נגזרת; אותו מפתח פעמיים — האחרון קובע', () => {
    const steps: Parameters<typeof setConnection>[1][] = [{ t: 25 }, { w: 260 }, { cols: 3 }, { gauge: 90 }];
    const run = (order: number[]) => order.reduce((p, i) => setConnection(ID, steps[i]!).run(p), P());
    const sig = (p: Project) => { const d = generate(p); const c = d.connections.find((x) => x.id === ID)!; return JSON.stringify([c.bolts.length, c.parts.map((id) => d.byId.get(id)?.profile).sort(), d.members.length]); };
    const A = run([0, 1, 2, 3]);
    for (const order of [[3, 2, 1, 0], [1, 3, 0, 2], [2, 0, 3, 1]]) { const B = run(order); expect(B.connectionOverrides[ID]).toEqual(A.connectionOverrides[ID]); expect(sig(B)).toBe(sig(A)); }
    expect(A.connectionOverrides[ID]).toMatchObject({ t: 25, w: 260, cols: 3, gauge: 90 });
    const twice = setConnection(ID, { t: 30 }).run(setConnection(ID, { t: 20 }).run(P())); expect(twice.connectionOverrides[ID]!.t).toBe(30);
    const other = setConnection(ID, { t: 20 }).run(setConnection(ID, { t: 30 }).run(P())); expect(other.connectionOverrides[ID]!.t).toBe(20); // סדר חשוב רק לאותו מפתח
    // ברירת מחדל + חריג: החריג גובר בכל סדר
    const d1 = setConnection(ID, { t: 25 }).run(setConnectionDefault('eave', { t: 18 }).run(P()));
    const d2 = setConnectionDefault('eave', { t: 18 }).run(setConnection(ID, { t: 25 }).run(P()));
    expect(d1.connectionOverrides[ID]!.t).toBe(25); expect(d2.connectionOverrides[ID]!.t).toBe(25); expect(d1.connectionDefaults.eave.t).toBe(18); expect(d2.connectionDefaults.eave.t).toBe(18);
    expect(sig(d1)).toBe(sig(d2));
  });
});
