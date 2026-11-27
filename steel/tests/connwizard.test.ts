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

describe('אשף חיבורים — כל סוגי החיבורים (1.46)', () => {
  it('CW-4: לכל משפחה — מצב, מועמדים, החלה (כולם / חיבור זה) ללא שגיאות', async () => {
    const { familyOf, DETAIL_TYPES } = await import('../src/model/connRegistry');
    const { SECTION_TEMPLATES } = await import('../src/model/section');
    const b = defaultBuilding(); b.width = 30000; b.ridgeX = 15000;
    b.bracing.walls = { ...b.bracing.walls, enabled: true, type: 'x' };
    const p0 = newProject('t', b);
    const bp = defaultBuilding(); bp.bracing.walls = { ...bp.bracing.walls, enabled: true, type: 'portal' };
    const bs = defaultBuilding(); bs.section = SECTION_TEMPLATES.find((t) => t.id === 'stepped')!.make();
    const seen = new Set<string>();
    for (const p of [p0, newProject('p', bp), newProject('s', bs)]) {
      const d = generate(p);
      const byFam = new Map<string, string>();
      for (const c of d.connections) { const f = familyOf(c); if (f && !byFam.has(f)) byFam.set(f, c.id); }
      for (const [f, cid] of byFam) {
        if (seen.has(f)) continue;
        const s = situationOf(p, d, cid)!;
        expect(s, f).toBeTruthy();
        const cs = candidates(p, s);
        expect(cs.length, f).toBeGreaterThan(0);
        const cur = readCurrent(p, s);
        expect(DETAIL_TYPES.some((t) => t.id === cur.detail), `${f}: ${cur.detail}`).toBe(true);
        const alt = cs.find((c) => c.detail !== cur.detail && c.fit.status !== 'no') ?? cs[0];
        for (const scope of (s.oneLabel === null ? ['all'] : ['all', 'one']) as ('all' | 'one')[]) {
          const n = applyDetail(p, s, alt.detail, { ...cur.params }, scope);
          const dn = generate(n);
          expect(dn.issues.filter((i) => i.severity === 'error').map((i) => `${f}/${scope}: ${i.message}`)).toEqual([]);
          expect(readCurrent(n, situationOf(n, dn, dn.connById.has(cid) ? cid : dn.connections.find((x) => familyOf(x) === f)!.id)!).detail, `${f}/${scope}`).toBe(alt.detail);
        }
        seen.add(f);
      }
    }
    expect([...seen].sort()).toEqual(expect.arrayContaining(['base', 'bsplice', 'cleat', 'eave', 'portal', 'psplice', 'ridge', 'roofx', 'side', 'wallx']));
  }, 60000); // ~5.5 שניות תחת עומס: ברירת המחדל של vitest 4 (5 שניות) אינה מספיקה
});

describe('אשף חיבורים — קורה נושאת, נעילה, פרטי סטודיו (1.47)', () => {
  it('CW-5: קורה נושאת (תמיכה / מושב) ונעילה אופקית — מצב, התאמה, החלה לקורה / לציר', async () => {
    const { planOmissions, setTransfers } = await import('../src/commands/commands');
    let p = newProject('t', defaultBuilding());
    p = setTransfers(planOmissions(p, ['F3.COL.L']).defs.map((x) => ({ ...x, profile: 'IPE330' }))).run(p);
    let d = generate(p);
    const cs = d.connections.find((x) => x.type === 'tb-support')!;
    const s = situationOf(p, d, cs.id)!;
    expect(s.family).toBe('tbsup');
    expect(readCurrent(p, s).detail).toBe('tbsup.A1');
    const n = applyDetail(p, s, 'tbsup.A2', {}, 'one');
    expect(n.building.transfers![0].support).toBe('A2');
    expect(generate(n).issues.filter((i) => i.severity === 'error')).toEqual([]);
    const seat = situationOf(n, generate(n), generate(n).connections.find((x) => x.type === 'tb-seat')!.id)!;
    expect(candidates(n, seat).find((c) => c.detail === 'tbseat.B4')!.fit.status).toBe('no'); // B4 רק עם A1
    // נעילה אופקית
    const b = defaultBuilding(); b.bracing.walls = { ...b.bracing.walls, enabled: true, type: 'truss' };
    p = newProject('l', b); d = generate(p);
    const lc = d.connections.find((x) => x.id.startsWith('C.LT.') && x.members.some((m) => m.includes('.COL.')))!;
    const sl = situationOf(p, d, lc.id)!;
    expect(sl.family).toBe('lock');
    const cur = readCurrent(p, sl).detail;
    const alt = cur === 'lock.plate' ? 'lock.tongue' : 'lock.plate';
    const nl = applyDetail(p, sl, alt, readCurrent(p, sl).params, 'one');
    expect(nl.building.bracing.walls.lineTruss?.[sl.local]?.conn).toBe(alt.split('.')[1]);
    expect(generate(nl).issues.filter((i) => i.severity === 'error')).toEqual([]);
  });
  it('CW-6: פרט סטודיו עם תנאי התאמה — מוצע רק במצב מתאים; החלה לקצה / לקצוות הדומים', async () => {
    const { detailPresets } = await import('../src/geometry/detail');
    const p0 = proj('RHS80x80x4'), d0 = generate(p0);
    const det = { ...structuredClone(detailPresets()[0]), id: 'cd-t', name: 'פלטה מוברגת (בדיקה)', match: { member: ['RHS'], angMin: 20, angMax: 70 } };
    const p = { ...p0, customDetails: [det] };
    const cid = d0.connections.find((x) => x.id.startsWith('C.KB.'))!.id;
    const s = situationOf(p, d0, cid)!;
    expect(s.site).toBeTruthy();
    const c = candidates(p, s).find((x) => x.studio)!;
    expect(c.fit.status).toBe('ok');
    const one = applyDetail(p, s, c.detail, {}, 'one');
    expect(Object.keys(one.detailAssign ?? {})).toEqual([s.site!.key]);
    const all = applyDetail(p, s, c.detail, {}, 'all');
    expect(Object.keys(all.detailAssign ?? {}).length).toBe(s.site!.similar.length);
    expect(readCurrent(all, situationOf(all, generate(all), cid) ?? s).detail).toBe('custom:cd-t');
    // אלמנט זוויתן — לא מתאים לתנאי
    const pL = { ...proj('L50x5'), customDetails: [det] }, dL = generate(pL);
    const sL = situationOf(pL, dL, dL.connections.find((x) => x.id.startsWith('C.KB.'))!.id)!;
    expect(candidates(pL, sL).find((x) => x.studio)!.fit.status).toBe('no');
  });
});
