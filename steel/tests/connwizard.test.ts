import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { defaultKneeBraces } from '../src/geometry/knee';
import { defaultRafterStruts } from '../src/geometry/rafterStruts';
import { applyDetail, candidates, readCurrent, situationOf } from '../src/model/connRegistry';

const proj = (profile = 'L50x5') => { const b = defaultBuilding(); b.kneeBraces = { ...defaultKneeBraces(), enabled: true, profile }; b.bracing.rafterStruts = { ...defaultRafterStruts(), rows: [{ id: 'r1', from: 'L', toward: 'R', dist: 4000 }] }; return newProject('t', b); };

describe('אשף חיבורים — רישום סוגי פרט (1.42)', () => {
  it('CW-1: זיהוי מצב — אלכסון זוויתן: "לשונית בחריץ" לא מתאים עם סיבה, "זוויתן מוברג לפח" ראשון ונוכחי', () => {
    const p = proj(), d = generate(p);
    const c = d.connections.find((x) => x.id.startsWith('C.KB.'))!;
    const s = situationOf(p, d, c.id)!;
    expect(s.family).toBe('knee'); expect(s.memberFamily).toBe('L');
    expect(s.sameCount).toBe(d.connections.filter((x) => x.id.startsWith('C.KB.')).length);
    const cs = candidates(p, s);
    expect(cs[0].detail).toBe('knee.angle');
    expect(cs.find((x) => x.detail === 'knee.fin')!.fit).toMatchObject({ status: 'no' });
    expect(readCurrent(p, s).detail).toBe('knee.angle');
  });
  it('CW-2: החלה — "המיקום הזה" כותב חריג למפתח-צד; "כל החיבורים" משנה את הכללי', () => {
    const p = proj('RHS80x80x4'), d = generate(p);
    const c = d.connections.find((x) => x.id.startsWith('C.KB.'))!;
    const s = situationOf(p, d, c.id)!;
    const one = applyDetail(p, s, 'knee.flange', { plateT: 12 }, 'one');
    expect(one.building.kneeBraces!.sides![s.local].detail).toBe('flange');
    expect(one.building.kneeBraces!.detail).not.toBe('flange');
    const d1 = generate(one);
    expect(d1.connections.filter((x) => x.id.startsWith('C.KB.') && x.id.endsWith(s.local) && x.parts.some((q) => q.endsWith('.T'))).length).toBe(0);
    const all = applyDetail(p, s, 'knee.flange', { plateT: 12 }, 'all');
    expect(all.building.kneeBraces!.detail).toBe('flange'); expect(all.building.kneeBraces!.plateT).toBe(12);
    expect(generate(all).issues.filter((i) => i.severity === 'error')).toEqual([]);
  });
  it('CW-3: תמוכה ובסיס — זיהוי, החלה, והגדרה שמורה מופיעה כמועמד', () => {
    const p = proj(), d = generate(p);
    const cs = d.connections.find((x) => /^C\.RS1\./.test(x.id))!;
    const s = situationOf(p, d, cs.id)!;
    expect(s.family).toBe('strut');
    const n = applyDetail(p, s, 'strut.fin', { plateT: 10, bolts: 2, boltD: 16 }, 'one');
    expect(n.building.bracing.rafterStruts!.rows[0].detail).toBe('fin');
    const cb = d.connections.find((x) => x.type === 'base')!;
    const sb = situationOf(p, d, cb.id)!;
    const nb = applyDetail(p, sb, 'base.pile', { pileEmbed: 700 }, 'all');
    expect(generate(nb).members.some((m) => m.kind === 'anchor')).toBe(false);
    const withLib = { ...p, connLibrary: [{ id: 'CP1', family: 'knee' as const, detail: 'knee.angle', name: 'זוויתן 2 ברגים', params: { boltsPerEnd: 4 } }], connDefaults: { knee: 'CP1' } };
    const sk = situationOf(withLib, d, d.connections.find((x) => x.id.startsWith('C.KB.'))!.id)!;
    expect(candidates(withLib, sk).some((x) => x.preset?.id === 'CP1' && x.isDefault)).toBe(true);
  });
});
