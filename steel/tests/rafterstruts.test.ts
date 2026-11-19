import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { defaultRafterStruts } from '../src/geometry/rafterStruts';
import { clash } from '../src/geometry/clash';

const withStruts = (dist: number, bays?: number[], segCount?: Record<string, number>) => {
  const b = defaultBuilding();
  b.bracing.roof = { ...b.bracing.roof, enabled: true, bays: [0], ...(segCount ? { segCount } : {}) };
  b.bracing.rafterStruts = { ...defaultRafterStruts(), rows: [{ id: 'r1', from: 'L', toward: 'R', dist, bays }] };
  return generate(newProject('t', b));
};

describe('תמוכות בין הקורות (1.40)', () => {
  it('RS-1: שורה מציר א לכיוון ב — RHS בכל מפתח, פלטות קצה מוברגות לווב, ללא התנגשויות', () => {
    const d = withStruts(4000);
    const nb = defaultBuilding().frames.length - 1;
    const st = d.members.filter((m) => m.id.startsWith('RS1.') && m.kind === 'beam');
    expect(st.length).toBe(nb);
    expect(st.every((m) => Math.abs(m.start.x - 4000) < 30 && Math.abs(m.end.x - 4000) < 30)).toBe(true);
    // קורה פנימית: תמוכה משני הצדדים — אותם 2 ברגים דרך שתי הפלטות והווב
    const c = d.connections.find((x) => x.id.startsWith('C.RS1.') && x.members.length === 3)!;
    expect(c.bolts.length).toBe(2);
    expect(c.parts.filter((p) => p.endsWith('.PL')).length).toBe(2);
    expect(d.issues.filter((i) => i.code === 'CLASH')).toEqual([]);
    expect(d.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });
  it('RS-2: קושרות הגג נעצרות לפני התמוכה — המפתח מחולק לפנלים לפי התמוכות', () => {
    const d = withStruts(4000);
    const r = d.members.filter((m) => m.id.startsWith('BR.R1.L') && m.kind === 'brace');
    expect(r.length).toBe(4); // 2 פנלים × 2 אלכסונים
    // אף אלכסון לא חוצה את x=4000 (± חצי פלטה)
    // התמוכה עצמה מול אלכסונים, פחים, פטות ותומכים
    const st = d.members.filter((m) => m.id.startsWith('RS1.') && m.kind === 'beam');
    const near = d.members.filter((m) => ['brace', 'plate', 'purlin', 'cleat', 'column'].includes(m.kind) && !m.connId?.startsWith('C.RS1.'));
    const hits = st.flatMap((a) => near.filter((o) => Math.abs((o.start.x + o.end.x) / 2 - 4000) < 2000).map((o) => [a.id, o.id, clash(a, o)?.depth ?? 0] as const)).filter((h) => h[2] > 0.5);
    expect(hits).toEqual([]);
    for (const m of r) { const lo = Math.min(m.start.x, m.end.x), hi = Math.max(m.start.x, m.end.x); expect(hi < 3900 || lo > 4100).toBe(true); }
    expect(d.issues.filter((i) => i.code === 'CLASH')).toEqual([]);
  });
  it('RS-3: חלוקה ידנית לפנלים + תמוכה — התראה והחלוקה בוטלה', () => {
    const d = withStruts(4000, undefined, { '0|L': 3 });
    expect(d.issues.some((i) => i.code === 'X_STRUT' && i.severity === 'warning')).toBe(true);
    expect(d.members.filter((m) => m.id.startsWith('BR.R1.L') && m.kind === 'brace').length).toBe(4);
    expect(d.issues.filter((i) => i.code === 'CLASH')).toEqual([]);
  });
  it('RS-4: מפתחים נבחרים בלבד; מיקום מחוץ לגג — התראה', () => {
    const d = withStruts(4000, [1, 2]);
    expect(d.members.filter((m) => m.id.startsWith('RS1.') && m.kind === 'beam').map((m) => m.id).sort()).toEqual(['RS1.2', 'RS1.3']);
    expect(d.members.filter((m) => m.id.startsWith('BR.R1.L') && m.kind === 'brace').length).toBe(2); // מפתח 1 ללא תמוכה — X אחד
    const d2 = withStruts(40000);
    expect(d2.issues.some((i) => i.code === 'RS_OUT')).toBe(true);
  });
});
