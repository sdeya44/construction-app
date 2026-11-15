import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { resolveBays } from '../src/geometry/bracing';
import { setBuilding } from '../src/commands/commands';
import { memberSolid } from '../src/geometry/solid';
import { dot, norm, sub, v3 } from '../src/core/vec';

const geo = () => newProject('t', defaultBuilding());

describe('קושרות ושורות קשירה', () => {
  it('ברירת מחדל: X בגג ובקירות במפתחים הקיצוניים, שורת קשירה בכל מפתח, ללא התנגשויות', () => {
    const d = generate(geo());
    const ids = d.members.filter((m) => m.kind === 'brace').map((m) => m.id);
    expect(ids.filter((i) => i.startsWith('BR.R')).length).toBe(2 * 2 * 2); // 2 מפתחים × 2 שיפועים × 2 אלכסונים
    expect(ids.filter((i) => i.startsWith('BR.W')).length).toBe(2 * 2 * 2); // 2 מפתחים × 2 קירות × 2
    expect(ids.filter((i) => i.startsWith('BR.T')).length).toBe(5 * 2); // 5 מפתחים × 2 שיפועים
    expect(d.issues.filter((i) => i.code === 'CLASH')).toEqual([]);
    // פח חיבור בכל קצה של כל אלכסון + הצטלבות: 8 X × (4 קצוות + 1)
    expect(d.connections.filter((c) => c.type === 'brace-end').length).toBe(8 * 4);
    expect(d.connections.filter((c) => c.type === 'brace-cross').length).toBe(8);
    const tie = d.connById.get('C.BR.TIE.L.2')!;
    expect(tie.bolts.length).toBe(7);
    expect(tie.bolts.every((b) => b.location === 'site' && b.d === 12)).toBe(true);
  });
  it('שורת קשירה: באמצע המפתח, צמודה לאגף התחתון של הפטות (מגע 0 מ"מ), מהפטה הראשונה עד האחרונה', () => {
    const d = generate(geo());
    const t = d.byId.get('BR.T2.L')!;
    expect(t.start.y).toBe(9000);
    const s = memberSolid(t);
    const n = norm(v3(-0.1, 0, 1));
    const dists = [...s.startRing, ...s.endRing].map((q) => dot(sub(q, v3(9000, 0, 6900)), n));
    expect(Math.max(...dists)).toBeCloseTo(0, 6); // הרגל האופקית צמודה לאגף התחתון של הפטות
    expect(Math.min(...dists)).toBeCloseTo(-40, 6);
    // הרגל האופקית למעלה: יותר מקודקוד אחד במישור הגג
    expect(dists.filter((x) => Math.abs(x) < 1e-6).length).toBeGreaterThanOrEqual(4);
  });
  it('בחירת מפתחים, כולל אינדקס שלילי מהסוף; ביטול מערכת', () => {
    expect(resolveBays([0, -1], 5)).toEqual([0, 4]);
    expect(resolveBays([2, 7, -9], 5)).toEqual([2]);
    const p = setBuilding({ bracing: { ...defaultBuilding().bracing, roof: { enabled: true, profile: 'L60x6', bays: [2] }, walls: { enabled: false, profile: 'L50x5', left: [], right: [] } } }).run(geo());
    const d = generate(p);
    expect(d.members.filter((m) => m.id.startsWith('BR.R')).map((m) => m.id).every((i) => i.startsWith('BR.R3'))).toBe(true);
    expect(d.members.some((m) => m.id.startsWith('BR.W'))).toBe(false);
    expect(d.issues.filter((i) => i.code === 'CLASH')).toEqual([]);
  });

  it('פח חיבור: מרותך במסגריה לווב הקורה, 2×M16 בשטח דרך הזוויתן והפח; הצטלבות עם פח מילוי ובורג אחד', () => {
    const d = generate(geo());
    const c = d.connById.get('C.BR.R1.L.1S')!;
    expect(c.members).toEqual(['F1.RAF.L', 'BR.R1.L.1']);
    expect(c.welds.every((w) => w.location === 'shop' && w.between[0] === 'F1.RAF.L')).toBe(true);
    expect(c.bolts.length).toBe(2);
    expect(c.bolts.every((b) => b.d === 16 && b.location === 'site' && b.grip === 5 + 8 && b.holesIn.includes('C.BR.R1.L.1S.PL'))).toBe(true);
    const x = d.connById.get('C.BR.R1.L.X')!;
    expect(x.bolts.length).toBe(1);
    expect(x.bolts[0].holesIn).toEqual(['BR.R1.L.1', 'C.BR.R1.L.X.PL', 'BR.R1.L.2']);
    expect(x.bolts[0].grip).toBe(5 + 8 + 5);
    // הבורג בהצטלבות במרכז המפתח
    expect(x.bolts[0].p.y).toBeCloseTo(3000, 3);
    // קצה הזוויתן לפחות 15 מ"מ מפני הווב, והבורג הראשון 30 מ"מ מקצה הזוויתן
    const br = d.byId.get('BR.R1.L.1')!;
    const s = memberSolid(br);
    expect(Math.min(...s.startRing.map((q) => q.y))).toBeGreaterThanOrEqual(0 + 7.1 / 2 + 15 - 1e-6);
    expect(d.issues.filter((i) => i.code === 'BOLT_EDGE' && /קושרת/.test(i.message))).toEqual([]);
  });
  it('ביטול בורג הצטלבות ושינוי מספר ברגים', () => {
    const b = defaultBuilding();
    const p = setBuilding({ bracing: { ...b.bracing, conn: { ...b.bracing.conn, crossBolt: false, boltsPerEnd: 3 } } }).run(geo());
    const d = generate(p);
    expect(d.connections.some((c) => c.type === 'brace-cross')).toBe(false);
    expect(d.connById.get('C.BR.W1.L.2E')!.bolts.length).toBe(3);
    expect(d.issues.filter((i) => i.code === 'CLASH')).toEqual([]);
  });
});
