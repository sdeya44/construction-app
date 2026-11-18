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

describe('פטות: מרחק ראשון ודירוג', () => {
  it('PU-01: מרחק ראשון 0 — מזערי לפי סוג התושבת; "מרחק מדויק" משאיר 0', () => {
    const dist = (style: 'run' | 'stand' | 'plate', ex: boolean) => {
      const b = defaultBuilding();
      for (const s2 of ['left', 'right'] as const) b.purlins[s2] = { ...b.purlins[s2], first: 0, firstExact: ex, cleat: { ...b.purlins[s2].cleat, style } };
      const d = generate(newProject('x', b));
      return Math.round(d.members.find((m) => m.id.endsWith('RAF.L'))!.end.x - d.members.find((m) => m.id === 'PL.L.01')!.start.x);
    };
    expect(dist('stand', false)).toBeLessThan(dist('run', false));
    expect(dist('run', true)).toBe(0);
  });
  it('PU-02: גג מדורג ושן מסור — פטות ותושבות לא חודרות לעמודים (גם HEB300, שני כיווני פתיחה)', async () => {
    const { SECTION_TEMPLATES } = await import('../src/model/section');
    for (const tid of ['stepped', 'sawtooth']) for (const col of ['HEA200', 'HEB300']) for (const op of ['up', 'down'] as const) {
      const b = defaultBuilding(); b.section = SECTION_TEMPLATES.find((t) => t.id === tid)!.make() as never; b.columnProfile = col;
      for (const s2 of ['left', 'right'] as const) b.purlins[s2] = { ...b.purlins[s2], opening: op };
      const d = generate(newProject('x', b));
      expect(d.issues.filter((i) => i.code === 'CLASH').map((i) => i.message), `${tid}/${col}/${op}`).toEqual([]);
    }
  });
});

describe('מפלס תחתית עמוד לכל ציר', () => {
  it('LB-01: חגורות בגבהים שונים (א 600, ב 300, ג 0) — העמודים מתקצרים, הגג לא זז, שרטוטים נבנים', async () => {
    const { SECTION_TEMPLATES } = await import('../src/model/section');
    const b = defaultBuilding(); b.section = SECTION_TEMPLATES.find((t) => t.id === 'mono-multi')!.make() as never;
    b.kneeBraces = { ...defaultKneeBraces(), enabled: true };
    b.bracing.walls.enabled = true;
    const { defaultCladding, claddingTakeoff } = await import('../src/geometry/cladding');
    b.cladding = defaultCladding(); b.cladding.walls.enabled = true; b.cladding.walls.sides = { L: true, R: true, F: true, B: true }; b.cladding.posts.enabled = true;
    const p0 = newProject('x', structuredClone(b));
    const d0 = generate(p0);
    b.lineBase = { A: 600, B: 300, C: 0 };
    const p = newProject('x', b);
    const d = generate(p);
    expect(bad(d.issues)).toEqual([]);
    for (const [line, z] of [['A', 600], ['B', 300], ['C', 0]] as const) {
      const c = d.byId.get(`F2.COL.${line}`)!, c0 = d0.byId.get(`F2.COL.${line}`)!;
      expect(c.start.z).toBe(z);
      expect(Math.round(c.end.z)).toBe(Math.round(c0.end.z));
    }
    // קושרות קיר בציר א מתחילות מעל החגורה
    const wb = d.members.filter((m) => m.id.startsWith('BR.W') && m.kind === 'brace' && Math.abs(m.start.x) < 300);
    for (const m of wb) expect(Math.min(m.start.z, m.end.z)).toBeGreaterThan(600);
    // פטות קיר בציר א מעל החגורה; עמודי רוח על יסודות ב-±0.00; חיפוי קיר א מפני החגורה
    const girtsA = d.members.filter((m) => m.wall?.id === 'L' && m.wall.role === 'girt');
    expect(girtsA.length).toBeGreaterThan(0);
    for (const m of girtsA) expect(m.start.z).toBeGreaterThan(600);
    const posts = d.members.filter((m) => m.wall?.role === 'post');
    expect(posts.length).toBeGreaterThan(0);
    for (const m of posts) expect(Math.min(m.start.z, m.end.z)).toBe(0);
    const tk = claddingTakeoff(p, d)!, tk0 = claddingTakeoff(p0, d0)!;
    const wL = (t: typeof tk) => t.surfaces.filter((x) => x.kind === 'wall' && Math.abs(x.pts[0].x - Math.min(...t.surfaces.filter((y) => y.kind === 'wall').map((y) => y.pts[0].x))) < 1)[0];
    expect(Math.round(Math.min(...wL(tk).pts.map((q) => q.z)) - Math.min(...wL(tk0).pts.map((q) => q.z)))).toBe(600);
    const fab = computeFabrication(p, d), bom = computeBom(d, fab);
    const cat = drawingCatalog(p, d, fab);
    for (const def of cat.filter((x) => x.type === 'anchor-plan' || x.type === 'frame')) {
      const sh = buildSheet(def, p, d, fab, bom);
      expect(sh.ents.length).toBeGreaterThan(10);
      if (def.type === 'anchor-plan') expect(sh.ents.some((e) => e.k === 'text' && (e as { s: string }).s.includes('ציר א +0.60'))).toBe(true);
    }
  });
});

describe('חיבורי המשך אוטומטיים בפטות', () => {
  it('SP-36: מבנה 36 מ\' (מסגרות כל 6 מ\', מוט 12 מ\') — אין חלק ארוך מהמוט ואין חיבור מחוץ לפטה', async () => {
    const { uniformFrames } = await import('../src/model/defaults');
    for (const [L, bay] of [[36000, 6000], [24000, 6000], [48000, 6000], [30000, 5000], [36000, 4000]] as const) {
      const b = { ...defaultBuilding(), frames: uniformFrames(L / bay + 1, L) };
      const d = generate(newProject('t', b));
      const bad = d.issues.filter((i) => (i.code === 'PART_STOCK' || i.code === 'SPLICE_RANGE') && i.elementId?.startsWith('PL.'));
      expect(bad.map((i) => `${L}/${bay}: ${i.message}`)).toEqual([]);
    }
  });
});

describe('חריגים ושילובים מסימולציית הממשק', () => {
  it('MX-01: קורה עמוקה יותר ברכס (חריג) — פלטת האלכסון לא נכנסת לפלטת החיזוק של הרכס; ללא שגיאות', async () => {
    const { SECTION_TEMPLATES } = await import('../src/model/section');
    const { applySizingSuggestion, setMemberProps } = await import('../src/commands/commands');
    const b = { ...defaultBuilding(), section: SECTION_TEMPLATES.find((t) => t.id === 'gable-cant')!.make() as never, kneeBraces: { ...defaultKneeBraces(), enabled: true } };
    const p = applySizingSuggestion().run(newProject('x', b));
    for (const sz of ['IPE330', 'IPE360', 'IPE400']) {
      const d = generate(setMemberProps(['F1.RAF.P2'], { profile: sz }).run(p));
      expect(d.issues.filter((i) => i.severity === 'error' && i.code !== 'EAVE_FIT').map((i) => `${sz}: ${i.message}`)).toEqual([]);
    }
  });
  it('MX-02: חריג חתך לקורה — העמוד יורד לפי עומק הקורה, פח הקושרת לפי עובי הווב שלה (ללא התנגשות)', async () => {
    const { setMemberProps } = await import('../src/commands/commands');
    const d = generate(setMemberProps(['F1.RAF.L'], { profile: 'IPE400' }).run(newProject('x', defaultBuilding())));
    expect(d.issues.filter((i) => i.code === 'CLASH').map((i) => i.message)).toEqual([]);
    const c = d.byId.get('F1.COL.L')!, c2 = d.byId.get('F2.COL.L')!;
    expect(c.end.z).toBeLessThan(c2.end.z - 50); // IPE400 עמוקה ב-100 מ"מ מ-IPE300
  });
});

describe('חיבור המשך מרותך במסגריה', () => {
  it('WS-01: קורה 15 מ\' ועמוד גבוה — פלטות כיסוי/ווב מרותכות, ללא ברגים וללא התנגשויות, שני החלקים במכלול אחד', async () => {
    const b = { ...defaultBuilding(), width: 30000, ridgeX: 15000, eaveLeft: 13000, eaveRight: 13000 };
    const p = newProject('x', b);
    p.settings.spliceJoint = { beams: 'welded', columns: 'welded' };
    const d = generate(p);
    expect(d.issues.filter((i) => i.severity === 'error').map((i) => i.message)).toEqual([]);
    const ws = d.connections.filter((c) => c.id.startsWith('C.WS.'));
    expect(ws.some((c) => c.members[0]!.includes('RAF'))).toBe(true);
    expect(ws.some((c) => c.members[0]!.includes('COL'))).toBe(true);
    expect(ws.every((c) => c.bolts.length === 0 && c.welds.length >= 4)).toBe(true);
    const fab = computeFabrication(p, d);
    const raf = d.parts.filter((x) => x.memberId === 'F2.RAF.L');
    expect(raf.length).toBe(2);
    expect(fab.byPart.get(raf[0]!.id)!.assembly).toBe(fab.byPart.get(raf[1]!.id)!.assembly);
    // בורג: ברירת מחדל מוברגת — כל חלק מכלול נפרד
    const p2 = newProject('y', b); const d2 = generate(p2); const f2 = computeFabrication(p2, d2);
    const r2 = d2.parts.filter((x) => x.memberId === 'F2.RAF.L');
    expect(f2.byPart.get(r2[0]!.id)!.assembly).not.toBe(f2.byPart.get(r2[1]!.id)!.assembly);
  });
});

describe('מזחלה וירידות מרזב', () => {
  it('GU-01: דו-שיפועי עם חיפוי — 2 תומכים מרותכים בכל קצה קורה, פריסה 1130, ירידות בעמודים, גיליון K-02', async () => {
    const { defaultCladding, claddingTakeoff } = await import('../src/geometry/cladding');
    const b = defaultBuilding(); b.cladding = defaultCladding();
    const p = newProject('x', b); const d = generate(p);
    expect(d.issues.filter((i) => i.severity === 'error').map((i) => i.message)).toEqual([]);
    const gb = d.connections.filter((c) => c.type === 'gutter');
    expect(gb.length).toBe(12); // 6 מסגרות × 2 קצוות
    expect(gb.every((c) => c.parts.length >= 1 && c.welds.every((w) => w.location === 'shop'))).toBe(true); // ברירת מחדל: זוויתן בחפיפה על הווב
    const t = claddingTakeoff(p, d)!;
    expect(t.gutters.length).toBe(2);
    expect(t.gutters[0]!.dev).toBe(1130);
    expect(t.gutters[0]!.downpipes).toBeGreaterThanOrEqual(3);
    expect(t.surfaces.some((s) => s.kind === 'gutter')).toBe(true);
    // התומך במכלול של הקורה (מגולוון יחד)
    const fab = computeFabrication(p, d);
    const raf = fab.parts.find((x) => x.memberId === 'F1.RAF.L')!;
    const br = fab.parts.find((x) => x.memberId === gb[0]!.parts[0])!;
    expect(fab.assemblies.find((a) => a.id === raf.assembly)!.parts).toContain(br.id);
    const def = drawingCatalog(p, d, fab).find((c) => c.type === 'gutter')!;
    expect(def.number).toBe('K-02');
    const sh = buildSheet(def, p, d, fab, computeBom(d, fab));
    expect(sh.ents.some((e) => e.k === 'text' && e.s.includes('1130'))).toBe(true);
  });
});

describe('סככת L — כנף', () => {
  it('LW-01: כנף דו-שיפועית וחד-שיפועית בשני הצדדים — ללא שגיאות, כיסאות בעמודי הראשית, חיפוי הקיר הוסר במפתחי הכנף', async () => {
    const { defaultWing } = await import('../src/geometry/wing');
    const { defaultCladding, claddingTakeoff } = await import('../src/geometry/cladding');
    for (const rt of ['gable', 'mono'] as const) for (const side of ['L', 'R'] as const) {
      const b = defaultBuilding(); b.cladding = defaultCladding(); b.kneeBraces = { ...defaultKneeBraces(), enabled: true };
      b.wing = { ...defaultWing(b, rt), side };
      const p = newProject('x', b); const d = generate(p);
      expect(d.issues.filter((i) => i.severity === 'error').map((i) => `${rt}/${side}: ${i.message}`)).toEqual([]);
      const seats = d.connections.filter((c) => c.id.startsWith('C.WS.F'));
      expect(seats.length).toBe(3);
      expect(seats.every((c) => c.bolts.length === 2 && c.welds.every((w) => w.location === 'shop'))).toBe(true);
      expect(d.members.some((m) => m.id.startsWith('W.') && m.kind === 'rafter')).toBe(true);
      // אין עמודי כנף בצד הקיר הראשי
      const xl = side === 'R' ? 18000 : 0;
      expect(d.members.filter((m) => m.id.startsWith('W.') && m.kind === 'column' && Math.abs(m.start.x - xl) < 600)).toEqual([]);
      // חיפוי: אין חיפוי קיר ראשי במפתחי הכנף; גג הכנף ומזחלותיה נספרים
      const t = claddingTakeoff(p, d)!;
      expect(t.roofSheets.some((r) => r.where.startsWith('כנף'))).toBe(true);
      expect(t.gutters.some((g) => g.name.startsWith('כנף'))).toBe(true);
      const fab = computeFabrication(p, d);
      const seatPl = fab.parts.find((x) => x.memberId === seats[0]!.parts[0])!;
      const col = fab.parts.find((x) => x.memberId === seats[0]!.members[0])!;
      expect(seatPl.assembly).toBe(col.assembly); // הכיסא מרותך לעמוד הראשי במסגריה
    }
  });
  it('LW-02: כנף גבוהה מדי — שגיאה ברורה', async () => {
    const { defaultWing } = await import('../src/geometry/wing');
    const b = defaultBuilding(); b.wing = { ...defaultWing(b, 'gable'), eave: 5800 };
    const d = generate(newProject('x', b));
    expect(d.issues.some((i) => i.code === 'WING_HIGH')).toBe(true);
  });
});
