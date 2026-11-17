import { describe, expect, it } from 'vitest';
import { evalExpr, tryExpr } from '../src/core/expr';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { defaultKneeBraces } from '../src/geometry/knee';
import { blankDetail, buildDetail, detailPresets, findSite, similarSites } from '../src/geometry/detail';
import { computeFabrication } from '../src/fab/marks';
import { computeBom } from '../src/fab/bom';
import { buildSheet, drawingCatalog } from '../src/drawing/views';
import type { CustomDetail } from '../src/model/types';

const kneeProject = () => { const b = defaultBuilding(); b.kneeBraces = { ...defaultKneeBraces(), enabled: true }; return newProject('x', b); };
const bad = (iss: { severity: string; code: string; message: string }[]) => iss.filter((i) => i.severity === 'error').map((i) => `${i.code} ${i.message}`);

describe('נוסחאות', () => {
  it('EX-01: חשבון, פונקציות, משתנים עם נקודה, השוואות', () => {
    expect(evalExpr('r5(1.5*(16+2))', {})).toBe(30);
    expect(evalExpr('max(30, P1.w/2) + 2^3', { 'P1.w': 100 })).toBe(58);
    expect(evalExpr('if(hb >= 150, 2, 1)', { hb: 135 })).toBe(1);
    expect(Math.abs(evalExpr('tan(45)', {}) - 1)).toBeLessThan(1e-9);
    expect(evalExpr('10 × 3 ÷ 2', {})).toBe(15);
    expect(tryExpr('mh + zz', { mh: 80 }).err).toMatch('zz');
    expect(tryExpr('2 +', {}).err).toBeTruthy();
  });
});

describe('פרטי חיבור מותאמים', () => {
  it('CD-01: שני הפרטים המוכנים על שני קצוות אלכסון עמוד-קורה — ללא התנגשות וללא שגיאות נוסחה', () => {
    const d = generate(kneeProject());
    const kb = d.members.filter((m) => m.id.startsWith('KB.'));
    for (const m of kb.slice(0, 4)) for (const end of ['start', 'end'] as const) {
      const s = findSite(d.members, m, end)!;
      expect(s.host).toBeTruthy();
      for (const det of detailPresets().filter((x) => x.family !== 'cleat')) {
        const r = buildDetail(s, det);
        expect(bad(r.issues), `${m.id} ${end} ${det.id}`).toEqual([]);
        expect(r.conn.bolts.length).toBeGreaterThan(0);
        for (const b of r.conn.bolts) expect(b.holesIn.length).toBe(2);
      }
    }
  });
  it('CD-02: החלה במודל — מחליף את החיבור הקיים בקצה, מוסיף חיבור מותאם, ללא שגיאות', () => {
    const p = kneeProject();
    const d0 = generate(p);
    const kb = d0.members.filter((m) => m.id.startsWith('KB.'));
    p.customDetails = detailPresets();
    p.detailAssign = Object.fromEntries(kb.flatMap((m) => [[`${m.id}|start`, 'preset-fin'], [`${m.id}|end`, 'preset-flange']]));
    const d = generate(p);
    expect(bad(d.issues)).toEqual([]);
    expect(d.connections.filter((c) => c.type === 'custom').length).toBe(kb.length * 2);
    // פחי הסנפיר המקוריים הוסרו
    expect(d.members.some((m) => m.id.startsWith('C.KB.') && m.kind === 'plate')).toBe(false);
    // חלקים מקבלים סימון ומשקל; הפלטות מרותכות לאלמנטים (מכלולים)
    const fab = computeFabrication(p, d);
    const pl = fab.parts.filter((x) => x.id.includes('C.CD.'));
    expect(pl.length).toBeGreaterThan(0);
    for (const x of pl) expect(x.weight).toBeGreaterThan(0);
  });
  it('CD-03: פרמטרי — החלפת חתך עמוד ואלכסון, הפרט נשאר תקין', () => {
    for (const [col, kbp] of [['HEB240', 'RHS100x100x5'], ['HEA160', 'SHS60x60x4']] as const) {
      const p = kneeProject();
      p.building.columnProfile = col; p.building.kneeBraces!.profile = kbp;
      const d0 = generate(p);
      const kb = d0.members.filter((m) => m.id.startsWith('KB.'));
      p.customDetails = detailPresets();
      p.detailAssign = Object.fromEntries(kb.map((m) => [`${m.id}|start`, 'preset-fin']));
      const d = generate(p);
      expect(bad(d.issues).filter((x) => /CD_|C\.CD\.|פרט/.test(x)), col).toEqual([]);
    }
  });
  it('CD-04: פלטה בצורה (משולש/קיטום) — מתאר, משקל לפי שטח, התנגשות מזוהה', () => {
    const d = generate(kneeProject());
    const m = d.members.find((x) => x.id.startsWith('KB.'))!;
    const s = findSite(d.members, m, 'start')!;
    const det: CustomDetail = { ...blankDetail('בדיקה'), ops: [
      { k: 'cut', id: 'C1', kind: 'host', at: '150' },
      { k: 'plate', id: 'G1', ref: { on: 'host', face: 'hit', along: '0', across: '20' }, mode: 'stand', spin: '0', off: '0', shape: 'tri', w: '100', h: '200', t: '10', ch: '0', corners: [false, false, false, false] },
    ] };
    const r = buildDetail(s, det);
    const g = r.members.find((x) => x.id.endsWith('.G1'))!;
    expect(g.contour?.length).toBe(3);
    // גוסט שחודר לאלכסון (across 0 — במרכז) ⇒ התנגשות
    const det2: CustomDetail = { ...det, ops: det.ops.map((o) => (o.k === 'plate' ? { ...o, ref: { ...o.ref, across: '0' }, shape: 'rect' as const, w: '300', h: '400' } : o)) };
    expect(buildDetail(s, det2).issues.some((i) => i.code === 'CLASH')).toBe(true);
  });
  it('CD-05: קצה חופשי (בסיס עמוד) ודומים', () => {
    const d = generate(kneeProject());
    const col = d.members.find((x) => x.kind === 'column')!;
    const s = findSite(d.members, col, 'start')!;
    expect(s.host).toBeNull();
    const r = buildDetail(s, detailPresets()[0]);
    expect(bad(r.issues)).toEqual([]);
    const kb = d.members.find((x) => x.id.startsWith('KB.'))!;
    expect(similarSites(d.members, `${kb.id}|start`).length).toBeGreaterThan(4);
  });
  it('CD-06: שרטוטים — גיליון פרט מותאם, גיליונות פלטות (כולל פלטה בצורה) וחלקים נבנים ללא שגיאה', () => {
    const p = kneeProject();
    const d0 = generate(p);
    const kb = d0.members.filter((m) => m.id.startsWith('KB.'));
    const tri: CustomDetail = { ...detailPresets()[1], id: 'cd-tri', name: 'סנפיר משולש', ops: detailPresets()[1].ops.map((o) => (o.k === 'plate' && o.id === 'G1' ? { ...o, shape: 'cham' as const, ch: '30', corners: [true, false, false, true] as [boolean, boolean, boolean, boolean] } : o)) };
    p.customDetails = [...detailPresets(), tri];
    p.detailAssign = Object.fromEntries(kb.flatMap((m) => [[`${m.id}|start`, 'cd-tri'], [`${m.id}|end`, 'preset-flange']]));
    const d = generate(p);
    expect(bad(d.issues)).toEqual([]);
    const fab = computeFabrication(p, d), bom = computeBom(d, fab);
    const cat = drawingCatalog(p, d, fab);
    const cds = cat.filter((x) => x.id.startsWith('D-CONN-cd-'));
    expect(cds.map((x) => x.title)).toEqual(expect.arrayContaining(['פרט סנפיר משולש', 'פרט פלטה מוברגת לפני המארח']));
    for (const def of [...cds, ...cat.filter((x) => x.type === 'plates' || x.type === 'part').slice(0, 30)]) {
      const sh = buildSheet(def, p, d, fab, bom);
      expect(sh.ents.length, def.id).toBeGreaterThan(10);
    }
    // פלטה חופשית: מתאר עם קיטומים (6 קודקודים) ומשקל לפי שטח
    const g = d.members.find((m) => m.id.endsWith('.G1') && m.contour)!;
    expect(g.contour!.length).toBe(6);
  });
});

describe('חתך אלכסונים מפאנל האלמנט', () => {
  it('KB-PROF: "רק האלמנט הזה" משנה אלכסון עמוד-קורה בודד; הפרט מותאם לחתך החדש, ללא שגיאות', async () => {
    const { setMemberProps } = await import('../src/commands/commands');
    const p = kneeProject();
    const d0 = generate(p);
    const kb = d0.members.filter((m) => m.id.startsWith('KB.'));
    const p2 = setMemberProps([kb[0].id], { profile: 'SHS100x5' }).run(p);
    const d = generate(p2);
    expect(d.byId.get(kb[0].id)!.profile).toBe('SHS100x5');
    expect(d.byId.get(kb[1].id)!.profile).toBe(kb[1].profile);
    expect(bad(d.issues)).toEqual([]);
  });
});

describe('תושבות פטה', () => {
  it('CL-01: שלושה סוגי תושבת + תושבת תפר (4 חורים) — ללא שגיאות והתנגשויות', () => {
    for (const style of ['run', 'stand', 'plate'] as const) for (const sc of [false, true]) {
      const b = defaultBuilding();
      for (const s2 of ['left', 'right'] as const) b.purlins[s2].cleat = { ...b.purlins[s2].cleat, style, spliceCleat: sc };
      const d = generate(newProject('x', b));
      expect(d.issues.filter((i) => i.severity !== 'info').map((i) => i.code), `${style}/${sc}`).toEqual([]);
      const cl = d.connections.filter((c) => c.type === 'purlin-cleat');
      expect(cl.length).toBeGreaterThan(0);
      if (sc) {
        expect(d.connections.filter((c) => c.type === 'purlin-splice').length).toBe(0);
        const sp = cl.filter((c) => c.parts.some((p) => p.endsWith('.ST')) && c.bolts.length === 4);
        expect(sp.length).toBeGreaterThan(0);
      }
      if (style === 'stand') expect(d.byId.get(cl[0].parts[0])!.profile).toBe('L40x4');
    }
  });
  it('CL-02: תושבת פטה בסטודיו (חציה) — פרט מוכן על כל התושבות, ללא שגיאות', () => {
    const p = newProject('x', defaultBuilding());
    const d0 = generate(p);
    const c = d0.connections.find((x) => x.type === 'purlin-cleat')!;
    const key = `${c.members[0]}|x:${c.id.split('.').pop()}`;
    const keys = similarSites(d0.members, key, false, d0.connections);
    expect(keys.length).toBe(d0.connections.filter((x) => x.type === 'purlin-cleat').length);
    p.customDetails = detailPresets();
    p.detailAssign = Object.fromEntries(keys.map((k) => [k, 'preset-cleat-plate']));
    const d = generate(p);
    expect(bad(d.issues)).toEqual([]);
    expect(d.connections.filter((x) => x.type === 'purlin-cleat').length).toBe(0);
    expect(d.connections.filter((x) => x.type === 'custom').length).toBe(keys.length);
  });
});
