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
