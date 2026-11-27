/**
 * REV — תיקוני ביקורת 1.93 (Codex): `docs/review-193.md`.
 * REV-F01: הגדרה שמורה בספריית החיבורים של פרט מהסטודיו (`custom:<id>`) לא מפילה את האשף; פרט שנמחק — "לא מתאים" עם סיבה.
 */
import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { defaultKneeBraces } from '../src/geometry/knee';
import { detailPresets } from '../src/geometry/detail';
import { applyDetail, candidates, detailInfo, readCurrent, situationOf, type ConnPreset } from '../src/model/connRegistry';
import type { CustomDetail, Project } from '../src/model/types';

const proj = (profile = 'RHS80x80x4'): Project => { const b = defaultBuilding(); b.kneeBraces = { ...defaultKneeBraces(), enabled: true, profile }; return newProject('rev', b); };

describe('REV-F01 הגדרה שמורה של פרט מהסטודיו', () => {
  it('candidates / detailInfo לא קורסים; פרט מותאם מזוהה כ"מסטודיו"; פרט שנמחק — לא מתאים עם סיבה', () => {
    const p = proj(), d = generate(p);
    const c = d.connections.find((x) => x.id.startsWith('C.KB.'))!;
    const det = structuredClone(detailPresets().find((x) => x.id === 'preset-flange')!) as CustomDetail; det.id = 'QA-CUSTOM'; det.name = 'QA פרט';
    p.customDetails = [det];
    const presets: ConnPreset[] = [{ id: 'CP-ok', family: 'knee', detail: 'custom:QA-CUSTOM', name: 'שמור QA', params: {} }, { id: 'CP-gone', family: 'knee', detail: 'custom:NOPE', name: 'פרט שנמחק', params: {} }];
    p.connLibrary = presets;
    const s = situationOf(p, d, c.id)!;
    let cs: ReturnType<typeof candidates> = [];
    expect(() => { cs = candidates(p, s); }).not.toThrow();
    const ok = cs.find((x) => x.id === 'CP-ok')!, gone = cs.find((x) => x.id === 'CP-gone')!;
    expect(ok).toMatchObject({ studio: true, preset: { id: 'CP-ok' }, detail: 'custom:QA-CUSTOM' });
    expect(['ok', 'warn']).toContain(ok.fit.status);
    expect(gone.fit.status).toBe('no'); expect(gone.fit.reason).toMatch(/נמחק|לא נטען/);
    expect(detailInfo(p, 'custom:QA-CUSTOM')?.title).toBe('QA פרט'); expect(detailInfo(p, 'custom:NOPE')).toBeUndefined(); expect(detailInfo(p, 'knee.fin')?.builtin).toBe(true);
    // החלה של ההגדרה השמורה — אותו מסלול כמו פרט סטודיו, ללא שגיאות
    const n = applyDetail(p, s, ok.detail, {}, 'one');
    expect(Object.values(n.detailAssign ?? {})).toContain('QA-CUSTOM');
    expect(generate(n).issues.filter((i) => i.severity === 'error').map((i) => i.message)).toEqual([]);
    expect(readCurrent(n, s).detail).toBe('custom:QA-CUSTOM');
  });
  it('ברירת מחדל מבוססת הגדרה של פרט סטודיו נשמרת ב-connDefaults ולא קורסת', () => {
    const p = proj(), d = generate(p);
    const det = structuredClone(detailPresets().find((x) => x.id === 'preset-flange')!) as CustomDetail; det.id = 'QA2';
    p.customDetails = [det]; p.connLibrary = [{ id: 'CP2', family: 'knee', detail: 'custom:QA2', name: 'D', params: {} }]; p.connDefaults = { knee: 'CP2' } as never;
    const s = situationOf(p, d, d.connections.find((x) => x.id.startsWith('C.KB.'))!.id)!;
    expect(candidates(p, s).find((x) => x.id === 'CP2')!.isDefault).toBe(true);
  });
});


import { defaultLockTruss } from '../src/geometry/lockTruss';
import { defaultPortal } from '../src/geometry/portal';

describe('REV-F03 פרמטר מקומי (קוטר בורג) נכבד בהיקף "המיקום הזה בלבד"', () => {
  const boltD = (d: ReturnType<typeof generate>, id: string) => [...new Set(d.connections.find((c) => c.id === id)!.bolts.map((b) => b.d))];
  it('אגד B: M20 לציר אחד — רק לציר הזה; הערך האפקטיבי נקרא חזרה; הכללי לא משתנה', () => {
    const b = defaultBuilding(); b.bracing.walls = { ...b.bracing.walls, enabled: true, type: 'portal', portal: { ...defaultPortal() } };
    const p = newProject('f3p', b), d = generate(p);
    const conns = d.connections.filter((c) => c.type === 'knee' && c.id.startsWith('C.BB.'));
    expect(conns.length).toBeGreaterThan(4);
    const s = situationOf(p, d, conns[0]!.id)!;
    expect(s.family).toBe('portal');
    const dflt = readCurrent(p, s).params.boltD;
    expect(dflt).toBe(16);
    const n = applyDetail(p, s, 'portal.finH', { ...readCurrent(p, s).params, boltD: 20 }, 'one');
    const d1 = generate(n);
    expect(n.building.bracing.walls.portal!.bolt.d).toBe(16); // הכללי לא דלף
    for (const c of conns) {
      const sc = situationOf(n, d1, c.id)!;
      const want = sc.local === s.local ? [20] : [16];
      expect(boltD(d1, c.id), `${c.id} (ציר ${sc.local})`).toEqual(want);
    }
    expect(conns.some((c) => situationOf(n, d1, c.id)!.local !== s.local)).toBe(true); // יש ציר נוסף שנבדק
    expect(readCurrent(n, situationOf(n, d1, conns[0]!.id)!).params.boltD).toBe(20);
  });
  it('מסבך נעילה: M20 לציר אחד בלבד', () => {
    const b = defaultBuilding(); b.bracing.walls = { ...b.bracing.walls, enabled: true, type: 'truss', truss: { ...defaultLockTruss(), conn: 'tongue' } };
    const p = newProject('f3l', b), d = generate(p);
    const conns = d.connections.filter((c) => c.type === 'knee' && c.id.startsWith('C.LT.') && c.bolts.length);
    const s = situationOf(p, d, conns[0]!.id)!;
    expect(s.family).toBe('lock');
    const n = applyDetail(p, s, 'lock.tongue', { ...readCurrent(p, s).params, boltD: 20 }, 'one');
    const d1 = generate(n);
    expect(n.building.bracing.walls.truss!.bolt.d).toBe(16);
    const mine = conns.filter((c) => situationOf(n, d1, c.id)!.local === s.local), others = conns.filter((c) => situationOf(n, d1, c.id)!.local !== s.local);
    expect(mine.length).toBeGreaterThan(0); expect(others.length).toBeGreaterThan(0);
    for (const c of mine) expect(boltD(d1, c.id), c.id).toEqual([20]);
    for (const c of others) expect(boltD(d1, c.id), c.id).toEqual([16]);
  });
  it('אלכסון עמוד-קורה: עובי/ברגים/בורג בהיקף "מיקום זה" לא דולפים להגדרות הכלליות ולצדדים אחרים', () => {
    const p = proj(), d = generate(p);
    const conns = d.connections.filter((c) => c.id.startsWith('C.KB.'));
    const s = situationOf(p, d, conns[0]!.id)!;
    const cur = readCurrent(p, s).params;
    const n = applyDetail(p, s, 'knee.fin', { ...cur, plateT: 14, boltD: 20, boltsPerEnd: 4 }, 'one');
    const kb0 = p.building.kneeBraces!, kb1 = n.building.kneeBraces!;
    expect([kb1.plateT, kb1.boltsPerEnd, kb1.bolt.d]).toEqual([kb0.plateT, kb0.boltsPerEnd, kb0.bolt.d]);
    expect(kb1.sides![s.local]).toMatchObject({ plateT: 14, boltsPerEnd: 4, bolt: { d: 20 } });
    const d1 = generate(n);
    const mine = d1.connections.filter((c) => c.id.startsWith('C.KB.') && situationOf(n, d1, c.id)!.local === s.local), others = d1.connections.filter((c) => c.id.startsWith('C.KB.') && situationOf(n, d1, c.id)!.local !== s.local);
    expect(mine.length).toBeGreaterThan(0); expect(others.length).toBeGreaterThan(0);
    for (const c of mine) for (const bo of c.bolts) expect(bo.d, c.id).toBe(20);
    for (const c of others) for (const bo of c.bolts) expect(bo.d, c.id).toBe(kb0.bolt.d);
    expect(readCurrent(n, s).params).toMatchObject({ plateT: 14, boltD: 20, boltsPerEnd: 4 });
    expect(d1.issues.filter((i) => i.severity === 'error').map((i) => i.message)).toEqual([]);
  });
});

import { buildSheet, drawingCatalog } from '../src/drawing/views';
import { computeFabrication } from '../src/fab/marks';
import { computeBom } from '../src/fab/bom';
import { assignDetail, numberParts } from '../src/commands/commands';

describe('REV-F02 גיליון פרט לכל וריאנט', () => {
  const run = (which: 'first' | 'last') => {
    const p0 = proj(), d0 = generate(p0);
    const eaves = d0.connections.filter((c) => c.type === 'eave');
    const target = which === 'first' ? eaves[0]! : eaves[eaves.length - 1]!;
    const t0 = p0.connectionDefaults.eave.t;
    p0.connectionOverrides = { ...p0.connectionOverrides, [target.id]: { t: t0 + 2 } } as never;
    const p = numberParts().run(p0), d = generate(p), fab = computeFabrication(p, d), bom = computeBom(d, fab);
    const cat = drawingCatalog(p, d, fab).filter((x) => x.type === 'connection' && x.id.startsWith('D-CONN-eave'));
    return { p, d, fab, bom, cat, target, t0 };
  };
  it('שני עוביים באותה משפחה (כרכוב) ⇒ שני גיליונות, הראשון שומר את המזהה; הרשימה מכסה את כל החיבורים; לא תלוי בסדר', () => {
    for (const which of ['first', 'last'] as const) {
      const { d, cat, target } = run(which);
      const all = d.connections.filter((c) => c.type === 'eave').map((c) => c.id).sort();
      expect(cat.length, which).toBe(2);
      expect(cat[0]!.id).toBe('D-CONN-eave');
      expect(cat[1]!.id).toBe('D-CONN-eave~2');
      expect(cat[1]!.number).toMatch(/^D-\d\d\.2$/);
      expect(cat.flatMap((x) => x.refs ?? []).sort()).toEqual(all);
      expect(cat.some((x) => x.refs!.length === 1 && x.refs![0] === target.id)).toBe(true);
      expect(new Set(cat.map((x) => x.number)).size).toBe(2);
    }
  });
  it('כל וריאנט מציג את הפלטות שלו (PL12 / PL14) ואת רשימת המופעים', () => {
    const { p, d, fab, bom, cat, t0 } = run('first');
    const texts = cat.map((df) => buildSheet(df, p, d, fab, bom).ents.filter((e) => e.k === 'text').map((e) => (e as { s: string }).s).join('\n'));
    const small = texts.find((t) => t.includes(`PL${t0}`) && !t.includes(`PL${t0 + 2}`)), big = texts.find((t) => t.includes(`PL${t0 + 2}`));
    expect(small).toBeTruthy(); expect(big).toBeTruthy(); expect(small).not.toBe(big);
    expect(small).toMatch(/חל על \d+ חיבורים/);
  });
  it('בלי וריאנטים — הקטלוג זהה לקודם (מזהה אחד, בלי סיומת)', () => {
    const p = numberParts().run(proj()), d = generate(p), fab = computeFabrication(p, d);
    const cat = drawingCatalog(p, d, fab).filter((x) => x.id.startsWith('D-CONN-eave'));
    expect(cat.map((x) => x.id)).toEqual(['D-CONN-eave']);
    expect(cat[0]!.title).toBe('פרט חיבור קורה-עמוד');
  });
});

describe('REV-F02b פרט מותאם: וריאנט לפי ערכי המופע', () => {
  it('אותו פרט עם ערכי מופע שונים (עובי פח) ⇒ שני גיליונות; אותם ערכים ⇒ גיליון אחד', async () => {
    const { detailPresets } = await import('../src/geometry/detail');
    const { assignDetail, setDetailParam } = await import('../src/commands/commands');
    const p0 = proj(), d0 = generate(p0);
    const keys = d0.members.filter((m) => m.id.startsWith('KB.')).flatMap((m) => [`${m.id}|start`, `${m.id}|end`]);
    const det = structuredClone(detailPresets().find((x) => x.id === 'preset-plate-plate')!);
    let p = assignDetail(keys, det).run(p0);
    const one = (q: Project) => { const d = generate(q), fab = computeFabrication(numberParts().run(q), d); return drawingCatalog(q, d, fab).filter((x) => x.id.startsWith(`D-CONN-cd-${det.id}`)); };
    expect(one(p).length).toBe(1);
    p = setDetailParam([keys[0]!], 't', 16).run(p);
    const cat = one(p);
    expect(cat.length).toBe(2);
    expect(cat[1]!.id).toBe(`D-CONN-cd-${det.id}~2`);
    expect(cat.flatMap((x) => x.refs ?? []).length).toBe(generate(p).connections.filter((c) => c.custom?.detailId === det.id).length);
  });
});

describe('REV-F06 תושבת: פרט סטודיו/ספרייה שהוחל מוצג כנוכחי, ופרט מובנה מבטל אותו', () => {
  it('אחרי שיוך lib-purlin-single: האשף קורא את הפרט (לא cleat.run), הוא ברשימה; בחירת מובנה מבטלת את השיוך ומחזירה חיבור מובנה', () => {
    const p0 = numberParts().run(newProject('f06', defaultBuilding())), d0 = generate(p0);
    const c0 = d0.connections.find((c) => c.type === 'purlin-cleat')!;
    const lib = detailPresets().find((x) => x.id === 'lib-purlin-single')!;
    const key = `${c0.id.split('.').slice(2, -1).join('.')}|x:${c0.id.split('.').pop()}`;
    const p1 = assignDetail([key], lib).run({ ...p0, customDetails: [structuredClone(lib)] });
    const d1 = generate(p1);
    const cc = d1.connections.find((c) => c.custom?.site === key)!;
    expect(cc, 'החיבור הומר לפרט מותאם').toBeTruthy();
    const s1 = situationOf(p1, d1, cc.id)!;
    expect(s1.family).toBe('cleat');
    expect(readCurrent(p1, s1).detail).toBe(`custom:${lib.id}`);
    expect(candidates(p1, s1).some((c) => c.detail === `custom:${lib.id}`)).toBe(true);
    // בחירת פרט מובנה: השיוך מתבטל והחיבור חוזר להיות מובנה עם הסגנון שנבחר
    const p2 = applyDetail(p1, s1, 'cleat.stand', {}, 'one');
    expect(p2.detailAssign?.[key]).toBeUndefined();
    const d2 = generate(p2), c2 = d2.connections.find((c) => c.id === c0.id)!;
    expect(c2.type).toBe('purlin-cleat');
    expect(readCurrent(p2, situationOf(p2, d2, c2.id)!).detail).toBe('cleat.stand');
  });
});

describe('REV-F05 קושרת גג עם מוט: האלמנט הוא הזוויתן, לא המוט', () => {
  const roof = (prof: string) => { const b = defaultBuilding(); b.bracing.roof.endDetail = 'rod'; b.bracing.roof.profile = prof; const p = numberParts().run(newProject('f05', b)), d = generate(p); const c = d.connections.find((x) => x.id.startsWith('C.BR.R'))!; return { p, d, s: situationOf(p, d, c.id)! }; };
  it('L: משפחת האלמנט L (לא RD), "מוט הברגה" מתאים ונוכחי', () => {
    const { p, s } = roof('L50x5');
    expect(s.memberFamily).toBe('L');
    expect(readCurrent(p, s).detail).toBe('roofx.rod');
    expect(candidates(p, s).find((c) => c.detail === 'roofx.rod')!.fit.status).toBe('ok');
  });
  it('חתך שאינו L (RHS): המנוע בונה פח (בלי מוטות) והאשף מציג פח חיבור כנוכחי; מוט — לא מתאים', () => {
    const { p, d, s } = roof('RHS50x50x4');
    expect(d.connections.filter((c) => c.id.startsWith('C.BR.R')).some((c) => c.bolts.some((b) => b.rod))).toBe(false);
    expect(readCurrent(p, s).detail).toBe('roofx.gusset');
    expect(candidates(p, s).find((c) => c.detail === 'roofx.rod')!.fit.status).toBe('no');
  });
});
