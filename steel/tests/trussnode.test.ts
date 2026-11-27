/**
 * TNODE — צמתי מסבך בעורך החיבור (`geometry/trussNode.ts`, פקודה `setTrussNodeCheeks`): זיהוי המסבך מחיבורו, מצב נוכחי, עריכה,
 * ערכי גבול (ריק/לא מספרי/0/שלילי — לפי המינימום הקיים `CHEEK_MIN`), שקילות סדר עריכות, ומיגרציה/טעינה של קובץ עם לחיות.
 * גיאומטריה בלבד — אין כאן בדיקת חוזק.
 */
import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { CHEEK_MIN, cheekMins, defaultTrussSpec, resizeSpec } from '../src/geometry/truss';
import { applyCheeks, nodeSignature, nodeStateText, nodeTypeOf, trussOwner } from '../src/geometry/trussNode';
import { setTrussNodeCheeks } from '../src/commands/commands';
import { fromFileJson, toFileJson } from '../src/model/migrate';
import type { Project } from '../src/model/types';

const roofP = (frames: 'all' | number = 'all'): Project => { const b = defaultBuilding(); b.roofTruss = { enabled: true, frames: frames === 'all' ? 'all' : [b.frames[0]!.id], shape: 'flat', spec: defaultTrussSpec(8, 1000, { top: b.rafterProfile }) }; return newProject('tn', b); };
const carryP = (): Project => { const b = defaultBuilding(); const f = [...b.frames].sort((x, y) => x.y - y.y); const spec = defaultTrussSpec(8, 1200); b.transfers = [{ id: 'T1', lineId: 'L', from: f[0]!.id, to: f[4]!.id, removed: [f[1]!.id, f[2]!.id, f[3]!.id], profile: 'HEA160', support: 'A2', seat: 'B1', kind: 'truss', truss: spec }]; return newProject('tn2', b); };
const specOf = (p: Project) => p.building.roofTruss!.spec;
const cheekMembers = (p: Project) => generate(p).members.filter((m) => /\.G\d+[TB][12]$/.test(m.id));
const connOf = (p: Project, prefix: string) => generate(p).connections.find((c) => c.id.startsWith(prefix) && c.type === 'truss')!.id;

describe('TNODE צמתי מסבך', () => {
  it('TNODE-01: זיהוי מסבך גג / נושא מחיבורו, מצב נוכחי, וחיבור שאינו מסבך ⇒ null', () => {
    const r = roofP(), rc = connOf(r, 'C.TR.');
    const o = trussOwner(r, rc)!;
    expect(o.owner).toBe('roof'); expect(o.count).toBe(r.building.frames.length);
    expect(nodeTypeOf(o.spec)).toBe('direct'); expect(nodeStateText(o.spec)).toContain('מרותך ישיר');
    const c = carryP(), cc = connOf(c, 'C.TBT.');
    expect(trussOwner(c, cc)).toMatchObject({ owner: 'transfer', transferId: 'T1', count: 1 });
    expect(trussOwner(r, 'C.BASE.F1.L')).toBeNull(); expect(trussOwner(c, 'C.TBT.NOPE')).toBeNull(); expect(trussOwner(newProject('x', defaultBuilding()), 'C.TR.F1')).toBeNull();
    expect(trussOwner(roofP(1), connOf(roofP(1), 'C.TR.'))!.count).toBe(1);
  });
  it('TNODE-02: הפעלה/עריכה/כיבוי דרך הפקודה — המסבך הנכון בלבד, והמודל הנגזר משתנה בהתאם', () => {
    const r0 = roofP(), id = connOf(r0, 'C.TR.');
    expect(cheekMembers(r0).length).toBe(0);
    const r1 = setTrussNodeCheeks(id, { enabled: true }).run(r0);
    expect(specOf(r1).nodeCheeks).toEqual({ enabled: true, t: 8, h: 100 });
    expect(nodeStateText(specOf(r1))).toBe('לחיות צומת — עובי 8 מ"מ, גובה 100 מ"מ');
    const cm1 = cheekMembers(r1); expect(cm1.length).toBeGreaterThan(20); expect(new Set(cm1.map((m) => m.profile))).toEqual(new Set(['PL100x8']));
    const r2 = setTrussNodeCheeks(id, { t: 12, h: 90 }).run(r1);
    expect(new Set(cheekMembers(r2).map((m) => m.profile))).toEqual(new Set(['PL90x12']));
    const r3 = setTrussNodeCheeks(id, { enabled: false }).run(r2);
    expect(cheekMembers(r3).length).toBe(0); expect(nodeTypeOf(specOf(r3))).toBe('direct'); expect(specOf(r3).nodeCheeks).toMatchObject({ t: 12, h: 90 }); // הערכים נשמרים לשימוש חוזר
    const c0 = carryP(), cid = connOf(c0, 'C.TBT.');
    const c1 = setTrussNodeCheeks(cid, { enabled: true, t: 10 }).run(c0);
    expect(c1.building.transfers![0]!.truss!.nodeCheeks).toEqual({ enabled: true, t: 10, h: 100 });
    expect(c1.building.roofTruss).toBeUndefined();
    expect(setTrussNodeCheeks('C.TR.NOPE', { enabled: true }).run(newProject('x', defaultBuilding())).building.roofTruss).toBeUndefined();
    expect(r0.building.roofTruss!.spec.nodeCheeks).toBeUndefined(); // הפקודה לא משנה את המקור
  });
  it('TNODE-03: ערכי גבול — 0 / שלילי מוגבלים למינימום הקיים; ריק / NaN / ∞ אינם נשמרים; אין מקסימום', () => {
    const base = specOf(roofP());
    const on = applyCheeks(base, { enabled: true });
    for (const bad of [0, -5, -0.5]) { const s = applyCheeks(on, { t: bad, h: bad }); expect(s.nodeCheeks).toEqual({ enabled: true, t: CHEEK_MIN.t, h: CHEEK_MIN.h }); }
    const keep = applyCheeks(on, { t: 15, h: 150 });
    for (const bad of [NaN, Infinity, -Infinity, undefined as unknown as number]) expect(applyCheeks(keep, { t: bad, h: bad }).nodeCheeks).toEqual({ enabled: true, t: 15, h: 150 });
    expect(applyCheeks(on, { t: 500, h: 5000 }).nodeCheeks).toMatchObject({ t: 500, h: 5000 });
    // ערכים מוגבלים גם כשנטענו מקובץ (המנוע משתמש באותו מינימום): בלי שגיאה ובלי חלקים לא תקינים
    const p = roofP(1); p.building.roofTruss!.spec.nodeCheeks = { enabled: true, t: 0, h: -3 };
    const d = generate(p); expect(d.issues.filter((i) => i.severity === 'error').map((i) => i.code)).toEqual([]);
    expect(new Set(d.members.filter((m) => /\.G\d+[TB][12]$/.test(m.id)).map((m) => m.profile))).toEqual(new Set([`PL${CHEEK_MIN.h}x${CHEEK_MIN.t}`]));
  });
  it('TNODE-04: אותן עריכות בסדרים שונים — אותו מצב מנורמל, אותה חתימה, אותו מודל נגזר', () => {
    const r0 = roofP(1), id = connOf(r0, 'C.TR.');
    const apply = (steps: Parameters<typeof setTrussNodeCheeks>[1][], p0 = r0) => steps.reduce((p, s) => setTrussNodeCheeks(id, s).run(p), p0);
    const A = apply([{ enabled: true }, { t: 10 }, { h: 120 }]);
    const B = apply([{ h: 120 }, { t: 10 }, { enabled: true }]);
    const C = apply([{ t: 10 }, { enabled: true }, { h: 120 }]);
    const D = apply([{ t: 6 }, { enabled: true }, { h: 120 }, { t: 10 }]); // ערך ביניים שנדרס
    for (const x of [B, C, D]) { expect(specOf(x).nodeCheeks).toEqual(specOf(A).nodeCheeks); expect(nodeSignature(specOf(x))).toBe(nodeSignature(specOf(A))); }
    expect(nodeSignature(specOf(A))).toBe('cheek:10x120');
    const sig = (p: Project) => { const d = generate(p); const c = d.connections.find((q) => q.id === id)!; return JSON.stringify([d.members.length, [...new Set(d.members.filter((m) => /\.G\d+[TB][12]$/.test(m.id)).map((m) => m.profile))], c.parts.length, c.welds.length]); };
    expect(sig(B)).toBe(sig(A)); expect(sig(C)).toBe(sig(A)); expect(sig(D)).toBe(sig(A));
    // שינוי מספר שדות לפני / אחרי הלחיות — אותו מצב לחיות
    const rs = (p: Project) => ({ ...p, building: { ...p.building, roofTruss: { ...p.building.roofTruss!, spec: resizeSpec(p.building.roofTruss!.spec, 10) } } }) as Project;
    expect(nodeSignature(specOf(rs(A)))).toBe(nodeSignature(specOf(A)));
    expect(specOf(rs(A)).nodeCheeks).toEqual(specOf(A).nodeCheeks);
    expect(specOf(apply([{ enabled: true }, { t: 10 }, { h: 120 }], rs(r0))).nodeCheeks).toEqual(specOf(A).nodeCheeks);
  });
  it('TNODE-05: שמירה לקובץ וטעינה — לחיות נשמרות; קובץ בסכמה ישנה (v7, בלי layout בפטות) עובר מיגרציה ושומר את הלחיות', () => {
    const p = setTrussNodeCheeks(connOf(roofP(1), 'C.TR.'), { enabled: true, t: 10, h: 120 }).run(roofP(1));
    const back = fromFileJson(toFileJson(p));
    expect(specOf(back).nodeCheeks).toEqual({ enabled: true, t: 10, h: 120 });
    const env = JSON.parse(toFileJson(p));
    env.schemaVersion = 7; env.project.schemaVersion = 7;
    delete env.project.building.purlins.left.layout; delete env.project.building.purlins.right.layout;
    const mig = fromFileJson(JSON.stringify(env));
    expect(mig.schemaVersion).toBe(8);
    expect(mig.building.purlins.left.layout).toBe('even'); expect(mig.building.purlins.right.layout).toBe('even');
    expect(specOf(mig).nodeCheeks).toEqual({ enabled: true, t: 10, h: 120 });
    expect(cheekMembers(mig).length).toBe(cheekMembers(p).length);
    expect(() => fromFileJson(JSON.stringify({ ...env, schemaVersion: 99, project: { ...env.project, schemaVersion: 99 } }))).toThrow(/חדשה יותר/);
  });
  it('TNODE-06: מינימום עובי/גובה ניתנים לשינוי — מספר ≥ 1 בלבד נשמר; העובי/הגובה מוגבלים למינימום הנוכחי; המנוע והקובץ משתמשים בו', () => {
    const on = applyCheeks(specOf(roofP()), { enabled: true });
    expect(cheekMins(on.nodeCheeks)).toEqual({ t: CHEEK_MIN.t, h: CHEEK_MIN.h });
    // העלאת מינימום מעל הערך הקיים מעלה גם אותו; הורדת מינימום אינה משנה ערך קיים אבל מאפשרת ערך נמוך יותר
    const hi = applyCheeks(on, { minT: 10, minH: 150 });
    expect(hi.nodeCheeks).toEqual({ enabled: true, t: 10, h: 150, minT: 10, minH: 150 });
    expect(applyCheeks(hi, { t: 7, h: 100 }).nodeCheeks).toMatchObject({ t: 10, h: 150 });
    const lo = applyCheeks(hi, { minT: 2, minH: 20 });
    expect(lo.nodeCheeks).toMatchObject({ t: 10, h: 150, minT: 2, minH: 20 });
    expect(applyCheeks(lo, { t: 3, h: 25 }).nodeCheeks).toMatchObject({ t: 3, h: 25 });
    expect(applyCheeks(lo, { t: 0, h: -9 }).nodeCheeks).toMatchObject({ t: 2, h: 20 }); // מוגבל למינימום החדש, לא לברירת המחדל
    // מינימום לא חוקי (קטן מ-1, שלילי, NaN, ∞, לא מספר) אינו נשמר
    for (const bad of [0, 0.5, -3, NaN, Infinity, undefined as unknown as number, '5' as unknown as number]) expect(applyCheeks(hi, { minT: bad, minH: bad }).nodeCheeks).toMatchObject({ minT: 10, minH: 150 });
    expect(applyCheeks(on, { minT: 1, minH: 1 }).nodeCheeks).toMatchObject({ minT: 1, minH: 1 });
    // ערכים פגומים בקובץ ⇒ ברירת המחדל
    expect(cheekMins({ minT: -1, minH: NaN })).toEqual({ t: CHEEK_MIN.t, h: CHEEK_MIN.h });
    expect(cheekMins({ minT: 0.2 })).toEqual({ t: CHEEK_MIN.t, h: CHEEK_MIN.h });
    // מנוע: מינימום נמוך מברירת המחדל מאפשר פלטה דקה; מינימום גבוה מעלה אותה
    const p = roofP(1), id = connOf(p, 'C.TR.');
    const thin = setTrussNodeCheeks(id, { enabled: true, minT: 2, minH: 20 }).run(p);
    const thin2 = setTrussNodeCheeks(id, { t: 3, h: 25 }).run(thin);
    expect(new Set(cheekMembers(thin2).map((m) => m.profile))).toEqual(new Set(['PL25x3']));
    expect(generate(thin2).issues.filter((i) => i.severity === 'error')).toEqual([]);
    const thick = setTrussNodeCheeks(id, { minT: 14 }).run(thin2);
    expect(new Set(cheekMembers(thick).map((m) => m.profile))).toEqual(new Set(['PL25x14']));
    // קובץ בלי minT/minH שנטען — ברירת המחדל; עם ערכים — נשמרים אחרי שמירה/טעינה
    expect(cheekMins(fromFileJson(toFileJson(p)).building.roofTruss!.spec.nodeCheeks)).toEqual({ t: CHEEK_MIN.t, h: CHEEK_MIN.h });
    expect(specOf(fromFileJson(toFileJson(thick))).nodeCheeks).toEqual({ enabled: true, t: 14, h: 25, minT: 14, minH: 20 });
    expect(nodeSignature(specOf(thick))).toBe('cheek:14x25');
  });
});
