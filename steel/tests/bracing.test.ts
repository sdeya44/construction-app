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
    expect(d.connections.filter((c) => c.type === 'brace').every((c) => c.label.includes('דורש תכנון'))).toBe(true);
  });
  it('שורת קשירה: באמצע המפתח, צמודה לאגף התחתון של הפטות (מגע 0 מ"מ), מהפטה הראשונה עד האחרונה', () => {
    const d = generate(geo());
    const t = d.byId.get('BR.T2.L')!;
    expect(t.start.y).toBe(9000);
    const s = memberSolid(t);
    const n = norm(v3(-0.1, 0, 1));
    const dists = [...s.startRing, ...s.endRing].map((q) => dot(sub(q, v3(9000, 0, 6900)), n));
    expect(Math.max(...dists)).toBeCloseTo(0, 6);
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
});
