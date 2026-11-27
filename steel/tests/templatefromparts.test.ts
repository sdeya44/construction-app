/**
 * TFP — "הפוך לתבנית" (גישה ב', שלב 1): היסק פרט (פלטות + חורים) מפלטות חופשיות במודל, `geometry/templateFromParts.ts`.
 * TFP-01: פלטה אל פלטה (פרט מוכן) על אלכסון: הסקה ← הפרט שהוסק, כשהוא מוחל על אותו אתר, מייצר פלטות זהות (מתאר, עובי) ואותם חורים.
 * TFP-02: צורות (קיטום פינות) וזווית סיבוב: נשמרות בהלוך-חזור.
 * TFP-03: קלט לא תקין/לא נתמך — הודעה ברורה, בלי פרט.
 * TFP-04: קיבוץ חורים (רשת, היקף, שורות, יחידים).
 */
import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { defaultKneeBraces } from '../src/geometry/knee';
import { buildDetail, detailPresets, findSite, parseSiteKey } from '../src/geometry/detail';
import { groupHoles, plateOutline, polyDev, templateFromParts } from '../src/geometry/templateFromParts';
import type { CustomDetail, DetailOp, Project } from '../src/model/types';

const proj = (): Project => { const b = defaultBuilding(); b.kneeBraces = { ...defaultKneeBraces(), enabled: true }; return newProject('tfp', b); };
const preset = (id: string): CustomDetail => structuredClone(detailPresets().find((x) => x.id === id)!) as CustomDetail;
const withDetail = (p: Project, key: string, det: CustomDetail): Project => ({ ...p, customDetails: [...(p.customDetails ?? []), det], detailAssign: { ...(p.detailAssign ?? {}), [key]: det.id } });
const kbKey = () => { const d = generate(proj()); return `${d.members.find((x) => x.id.startsWith('KB.'))!.id}|start`; };

describe('TFP הפוך לתבנית (שלב 1)', () => {
  it('TFP-01: פלטה אל פלטה — הלוך-חזור של פלטות וחורים על אותו אתר', () => {
    const key = kbKey();
    const src = generate(withDetail(proj(), key, preset('preset-plate-plate')));
    const plates = src.members.filter((m) => m.kind === 'plate' && m.connId?.startsWith('C.CD.'));
    expect(plates.length).toBe(2);
    const r = templateFromParts(src, plates.map((m) => m.id), { siteKey: key, id: 'cd-t1', siteMembers: generate(proj()).members });
    expect(r.errors).toEqual([]);
    const det = r.detail!;
    expect(det.ops.filter((o) => o.k === 'plate').length).toBe(2);
    // P1 על המארח (מגע), P2 מוערמת על P1
    expect(r.infos.map((i) => i.ref)).toEqual(['host.hit', 'P1.z+']);
    expect(r.infos.every((i) => i.contact)).toBe(true);
    expect(r.dev!.plates).toBeLessThanOrEqual(0.3);
    expect(r.dev!.holes).toBeLessThanOrEqual(0.3);
    // החלה על אותו אתר (בלי הפרט המקורי) ← פלטות זהות
    const clean = generate({ ...proj(), customDetails: [det], detailAssign: { [key]: det.id } });
    const got = clean.members.filter((m) => m.kind === 'plate' && m.connId?.startsWith('C.CD.'));
    expect(got.length).toBe(2);
    for (const s of plates) {
      const a = plateOutline(s) as Exclude<ReturnType<typeof plateOutline>, string>;
      const best = Math.min(...got.map((g) => polyDev((plateOutline(g) as typeof a).poly, a.poly)));
      expect(best).toBeLessThanOrEqual(0.3);
    }
    // ברגים (שלב 2): הפרט שהוסק כולל bolts — אותם 4 ברגים (קוטר, דרגה, מקום), בלי אזהרות
    const holesOps = det.ops.filter((o) => o.k === 'holes'), boltOps = det.ops.filter((o) => o.k === 'bolts');
    expect(holesOps.length).toBe(1);
    expect(boltOps).toEqual([expect.objectContaining({ holes: holesOps[0].id, d: '16', grade: '8.8', site: true, noMain: true, noHost: true })]);
    expect(r.warnings).toEqual([]);
    expect(r.dev!.bolts).toBeLessThanOrEqual(0.3);
    const mm = generate(proj()), m0 = mm.byId.get(parseSiteKey(key).id)!, site = findSite(mm.members, m0, 'start')!;
    const out = buildDetail(site, det);
    const srcBolts = src.connections.flatMap((c) => c.bolts).filter((b) => b.connId.startsWith('C.CD.'));
    expect(srcBolts.length).toBe(4);
    expect(out.conn.bolts.length).toBe(4);
    for (const sb of srcBolts) expect(Math.min(...out.conn.bolts.map((b) => Math.hypot(b.p.x - sb.p.x, b.p.y - sb.p.y, b.p.z - sb.p.z)))).toBeLessThanOrEqual(0.3);
    for (const b of out.conn.bolts) { expect(b.holesIn.length).toBe(2); expect(b.length).toBe(srcBolts[0].length); }
    // מצב "חורים בלבד" (bolts:false): בלי פעולת bolts, והאימות עדיין מכסה את החורים
    const ho = templateFromParts(src, plates.map((m) => m.id), { siteKey: key, siteMembers: generate(proj()).members, bolts: false });
    expect(ho.detail!.ops.some((o) => o.k === 'bolts')).toBe(false);
    expect(ho.dev!.holes).toBeLessThanOrEqual(0.3);
  });
});

describe('TFP — כיסוי על חיבורים מובנים, צורות, שגיאות', () => {
  it('TFP-02: חיבורים מובנים (eave/base/knee/purlin-splice/brace-*): לכל סוג פלטה מוסקת, ואחרי החלה על האתר המתאר זהה', () => {
    const p0 = proj();
    const d = generate(p0), seen = new Set<string>();
    let n = 0;
    for (const c of d.connections) {
      if (seen.has(c.type)) continue;
      const plate = c.parts.map((x) => d.byId.get(x)).find((m) => m?.kind === 'plate');
      if (!plate) continue;
      const r = templateFromParts(d, [plate.id], { siteMembers: d.members, id: 'cd-s' });
      if (!r.detail) { expect(r.errors[0], `${c.type}`).toMatch(/חיתוך|לא נתמך/); continue; }   // מותר רק כשל מוצהר (פלטה עם חיתוך בשני קצוות)
      seen.add(c.type); n++;
      // החלה על המודל הנקי באותו אתר ← אותה פלטה (מתאר+עובי)
      const out = generate({ ...p0, customDetails: [r.detail], detailAssign: { [r.siteKey!]: r.detail.id } });
      const got = out.members.filter((m) => m.kind === 'plate' && m.connId?.startsWith('C.CD.'));
      const a = plateOutline(plate) as Exclude<ReturnType<typeof plateOutline>, string>;
      const dev = Math.min(...got.map((g) => { const o = plateOutline(g); return typeof o === 'string' ? Infinity : polyDev(o.poly, a.poly) + Math.abs(o.t - a.t); }));
      expect(dev, `${c.type} ${plate.id}`).toBeLessThanOrEqual(0.3);
      // ברגים: כל בורג מקורי דרך הפלטה מופיע גם אחרי ההחלה (אותו מספר ברגים דרך הפלטה המשוחזרת)
      const nSrc = d.connections.flatMap((x) => x.bolts).filter((b) => b.holesIn.includes(plate.id)).length;
      const gotPl = got.find((g) => { const o = plateOutline(g); return typeof o !== 'string' && polyDev(o.poly, a.poly) <= 0.3; })!;
      const nGot = out.connections.flatMap((x) => x.bolts).filter((b) => b.holesIn.includes(gotPl.id)).length;
      expect(nGot, `${c.type} ברגים דרך ${plate.id}`).toBe(nSrc);
    }
    expect(n).toBeGreaterThanOrEqual(5);
  });

  it('TFP-03: צורה מקוצצת (cham) וזווית סיבוב לא ישרה נשמרות; פלטה בעמידה (stand)', () => {
    const key = kbKey();
    const base = generate(proj());
    const site = findSite(base.members, base.byId.get(parseSiteKey(key).id)!, 'start')!;
    const o = (x: Partial<Extract<DetailOp, { k: 'plate' }>> & { id: string }): DetailOp => ({ k: 'plate', name: 'פלטה', ref: { on: 'host', face: 'hit', along: '0', across: '0' }, mode: 'flat', spin: '0', off: '0', shape: 'rect', w: '120', h: '90', t: '10', ch: '0', corners: [false, false, false, false], ...x } as DetailOp);
    const cases: [string, DetailOp[]][] = [
      ['cham', [o({ id: 'P1', shape: 'cham', ch: '15', corners: [true, false, true, false], w: '140', h: '100' })]],
      ['spin', [o({ id: 'P1', spin: '23', w: '140', h: '100', ref: { on: 'host', face: 'hit', along: '20', across: '-30' } })]],
      ['stand', [o({ id: 'P1', mode: 'stand', ref: { on: 'host', face: 'hit', along: '10', across: '40' }, w: '80', h: '120', off: '5' })]],
      ['tri', [o({ id: 'P1', shape: 'tri', w: '100', h: '60' })]],
    ];
    for (const [nm, ops] of cases) {
      const det: CustomDetail = { id: 'src', name: nm, vars: [], ops };
      const src = generate(withDetail(proj(), key, det));
      const pl = src.members.filter((m) => m.kind === 'plate' && m.connId?.startsWith('C.CD.')).map((m) => m.id);
      expect(pl.length, nm).toBe(1);
      const r = templateFromParts(src, pl, { siteKey: key, siteMembers: base.members, id: 'cd-r' });
      expect(r.errors, nm).toEqual([]);
      expect(r.dev!.plates, nm).toBeLessThanOrEqual(0.3);
      expect(buildDetail(site, r.detail!).errors, nm).toEqual({});
      if (nm === 'cham') expect(r.detail!.ops[0]).toMatchObject({ shape: 'cham', ch: '15' });
      if (nm === 'stand') expect(r.infos[0]).toMatchObject({ mode: 'stand', off: 5 });
    }
  });

  it('TFP-04: שגיאות ברורות — חלק לא קיים/לא פלטה/בלי בחירה/ריבוי קצוות', () => {
    const d = generate(proj());
    expect(templateFromParts(d, []).errors).toEqual(['לא נבחרה אף פלטה']);
    expect(templateFromParts(d, ['NOPE']).errors[0]).toMatch(/לא קיים/);
    const col = d.members.find((m) => m.kind === 'column')!;
    const r = templateFromParts(d, [col.id]);
    expect(r.detail).toBeNull(); expect(r.warnings.join()).toMatch(/אינו פלטה/);
    // פלטות משני קצוות האלכסון (אתרים שונים) — אין אתר אחד שמתאר את שתיהן
    const c = d.connections.find((x) => x.type === 'knee')!;
    const both = c.parts.filter((id) => d.byId.get(id)?.kind === 'plate' && /\.(C|R)\.PL$/.test(id));
    expect(both.length).toBe(2);
    const rr = templateFromParts(d, both, { siteMembers: d.members });
    expect(rr.detail).toBeNull(); expect(rr.errors[0]).toMatch(/הלוך-חזור לא עבר/);
  });

  it('TFP-05: קיבוץ חורים — רשת, היקף, שורות, יחידים', () => {
    const grid = (a: number[], b: number[]) => a.flatMap((x) => b.map((y) => [x, y] as [number, number]));
    expect(groupHoles(grid([-30, 30], [-100, 100]))).toEqual([{ rows: 2, cols: 2, py: 60, px: 200, along: 0, across: 0 }]);
    expect(groupHoles(grid([0], [-50, 0, 50]))).toEqual([{ rows: 1, cols: 3, py: 0, px: 50, along: 0, across: 0 }]);
    const ring = grid([-60, 0, 60], [-60, 0, 60]).filter(([a, b]) => !(a === 0 && b === 0));
    expect(groupHoles(ring)).toEqual([{ rows: 3, cols: 3, py: 60, px: 60, along: 0, across: 0, ring: true }]);
    // לא סדיר: שורה אחת אחידה + שורה עם מרווחים לא שווים ← קבוצות נפרדות, ללא אובדן חורים
    const irr: [number, number][] = [[0, -40], [0, 0], [0, 40], [50, -40], [50, 0], [50, 70]];
    const g = groupHoles(irr);
    expect(g.reduce((s, x) => s + x.rows * x.cols, 0)).toBe(6);
    expect(groupHoles([])).toEqual([]);
  });

  it('TFP-06: מפרט הבורג נשמר (M20, 10.9, מסגריה) ודגלי noMain/noHost נגזרים; בורג דרך פלטה שלא נבחרה ← הערה', () => {
    const key = kbKey(), base = generate(proj());
    const pre = preset('preset-plate-plate');
    pre.vars.find((v) => v.name === 'd')!.expr = '20';
    const bo = pre.ops.find((o) => o.k === 'bolts') as Extract<DetailOp, { k: 'bolts' }>; bo.grade = '10.9'; bo.site = false;
    const src = generate(withDetail(proj(), key, pre));
    const plates = src.members.filter((m) => m.kind === 'plate' && m.connId?.startsWith('C.CD.')).map((m) => m.id);
    const r = templateFromParts(src, plates, { siteKey: key, siteMembers: base.members, id: 'cd-m20' });
    expect(r.errors).toEqual([]);
    expect(r.detail!.ops.find((o) => o.k === 'bolts')).toMatchObject({ d: '20', grade: '10.9', site: false, noMain: true, noHost: true });
    const out = buildDetail(findSite(base.members, base.byId.get(parseSiteKey(key).id)!, 'start')!, r.detail!);
    const sb = src.connections.flatMap((c) => c.bolts).filter((b) => b.connId.startsWith('C.CD.'));
    expect(out.conn.bolts.map((b) => [b.d, b.grade, b.location, b.length]).sort()).toEqual(sb.map((b) => [b.d, b.grade, b.location, b.length]).sort());
    // רק P1 נבחרת: הברגים עוברים גם ב-P2 ← הערה שברור מה הושמט
    const one = templateFromParts(src, [plates.find((id) => id.endsWith('.P1'))!], { siteKey: key, siteMembers: base.members });
    expect(one.errors).toEqual([]);
    expect(one.warnings.join(' ')).toMatch(/לא נבחרו/);
    expect(one.detail!.note).toMatch(/הערות הסקה/);
  });
});
