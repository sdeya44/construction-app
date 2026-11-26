/**
 * PP — "פלטה אל פלטה" (4 ברגים): פרט מוכן `preset-plate-plate` + דגל `noHost` בפעולת הברגים.
 * PP-01: בניה על אתרי האלכסון — 4 ברגים, כל בורג מהדק בדיוק שתי פלטות (לא המארח), בלי שגיאות/התנגשות, שתי הפלטות באותו גודל.
 * PP-02: הרוחב = הגדול מבין רוחב האלמנט והמארח + תוספת (כלל המשתמש), ולפחות מה שמוציא את הברגים מחוץ לאגף המארח.
 * PP-03: הכלל הגולמי (גדול מבין + 20 בלבד) מפיק התנגשות — הבדיקות מזהות; בלי `noHost` הבורג מצטרף למארח (מוכיח שהדגל נחוץ).
 * PP-04: החלה במודל: פלטות עם 4 חורים ב-NC1, והן — ורק הן — בייצוא ה-DSTV.
 */
import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { defaultKneeBraces } from '../src/geometry/knee';
import { buildDetail, detailPresets, findSite, needsHost, presetFits } from '../src/geometry/detail';
import { computeFabrication } from '../src/fab/marks';
import { dstvZip, partToNc1 } from '../src/fab/dstv';
import type { CustomDetail } from '../src/model/types';

const proj = () => { const b = defaultBuilding(); b.kneeBraces = { ...defaultKneeBraces(), enabled: true }; return newProject('pp', b); };
const preset = () => structuredClone(detailPresets().find((x) => x.id === 'preset-plate-plate')!) as CustomDetail;
const sites = (d: ReturnType<typeof generate>) => d.members.filter((m) => m.id.startsWith('KB.')).slice(0, 4).flatMap((m) => (['start', 'end'] as const).map((e) => findSite(d.members, m, e)!));
const errs = (iss: { severity: string; code: string; message: string }[]) => iss.filter((i) => i.severity === 'error' || i.code === 'CD_BOLT' || i.code === 'CD_EDGE').map((i) => `${i.code} ${i.message}`);

describe('PP-01/02 פלטה אל פלטה', () => {
  it('PP-01: 4 ברגים, כל אחד מהדק שתי פלטות בדיוק, בלי שגיאות', () => {
    const d = generate(proj());
    for (const s of sites(d)) {
      const r = buildDetail(s, preset());
      expect(errs(r.issues), `${s.key}`).toEqual([]);
      expect(r.conn.bolts.length).toBe(4);
      const p1 = r.members.find((m) => m.id.endsWith('.P1'))!, p2 = r.members.find((m) => m.id.endsWith('.P2'))!;
      expect(p1.profile).toBe(p2.profile); // אותו רוחב, גובה ועובי
      for (const b of r.conn.bolts) expect([...b.holesIn].sort()).toEqual([p1.id, p2.id].sort());
      expect(r.errors).toEqual({});
    }
  });
  it('PP-02: רוחב ≥ הגדול מבין רוחב האלמנט והמארח + 20, והגובה = היטל האלמנט על המארח', () => {
    const d = generate(proj());
    for (const s of sites(d)) {
      const r = buildDetail(s, preset());
      const { W, H, mb, hb, mh } = r.values as Record<string, number>;
      expect(W).toBeGreaterThanOrEqual(Math.max(mb!, hb!) + 20 - 1e-9);
      expect(H).toBeCloseTo(mh! / Math.sin((s.ang * Math.PI) / 180), 6);
      // פרופיל הפלטה PL{רוחב החתך}x{עובי}; אורך החלק = הרוחב W (לאורך מישור הפלטה)
      const m1 = r.members.find((m) => m.id.endsWith('.P1'))!;
      expect(m1.profile).toBe(`PL${Math.round(H!)}x12`);
      expect(Math.hypot(m1.end.x - m1.start.x, m1.end.y - m1.start.y, m1.end.z - m1.start.z)).toBeCloseTo(W!, 3);
    }
    // תוספת גדולה מספיק: הכלל של המשתמש הוא המכריע (רוחב = הגדול מבין + תוספת)
    const det = preset(); det.vars.find((v) => v.name === 'ex')!.expr = '120';
    for (const s of sites(d)) { const r = buildDetail(s, det); const { W, mb, hb } = r.values as Record<string, number>; expect(W).toBe(Math.max(mb!, hb!) + 120); expect(errs(r.issues)).toEqual([]); }
  });
  it('PP-03: כלל גולמי (+20 בלבד) — התנגשות מזוהה; בלי noHost הבורג מצטרף למארח', () => {
    const d = generate(proj());
    const s = sites(d)[0]!;
    const raw = preset(); raw.vars.find((v) => v.name === 'W')!.expr = 'max(mb, hb) + 20';
    const rr = buildDetail(s, raw);
    expect(rr.issues.some((i) => i.code === 'CLASH')).toBe(true);
    for (const b of rr.conn.bolts) expect(b.holesIn.length).toBe(2); // noHost: הבורג לא מצטרף למארח גם כשהוא נופל על גופו
    const noFlag = preset(); noFlag.vars.find((v) => v.name === 'W')!.expr = 'max(mb, hb) + 20'; delete (noFlag.ops.find((o) => o.k === 'bolts') as { noHost?: boolean }).noHost;
    const r = buildDetail(s, noFlag);
    expect(r.conn.bolts.some((b) => b.holesIn.length > 2) || r.issues.some((i) => i.code === 'CLASH')).toBe(true);
  });
  it('PP-04: החלה במודל — 4 חורים בכל פלטה ב-NC1; ה-ZIP פלטות בלבד', () => {
    const p = proj(); const d0 = generate(p);
    p.customDetails = detailPresets();
    p.detailAssign = Object.fromEntries(d0.members.filter((m) => m.id.startsWith('KB.')).flatMap((m) => [[`${m.id}|start`, 'preset-plate-plate'], [`${m.id}|end`, 'preset-plate-plate']]));
    const d = generate(p);
    expect(d.issues.filter((i) => i.severity === 'error').map((i) => `${i.code} ${i.message}`)).toEqual([]);
    const fab = computeFabrication(p, d);
    const pl = fab.parts.filter((x) => x.kind === 'plate' && /\.P[12]$/.test(x.memberId));
    expect(pl.length).toBeGreaterThan(8);
    for (const x of pl) {
      expect(x.holes.length).toBe(4);
      const nc = partToNc1(x, p, d, 1).split('\r\n');
      const bo = nc.indexOf('BO');
      expect(nc.slice(bo + 1, nc.indexOf('EN')).filter((l) => /^\s*v/.test(l)).length).toBe(4);
    }
    const names = Object.keys(unzipSync(dstvZip(p, d, fab).zip));
    const marks = new Set(pl.map((x) => x.mark));
    for (const m of marks) expect(names).toContain(`${m}.nc1`);
  });
});

describe('FIT הצעת פרטים מוכנים לפי האתר', () => {
  it('FIT-01: פרט שמרתך אל המארח לא מוצע בקצה חופשי; "פלטה אל פלטה" רק לאלמנט חלול/זוויתן על מארח I', () => {
    const d = generate(proj());
    const pp = detailPresets().find((x) => x.id === 'preset-plate-plate')!, fin = detailPresets().find((x) => x.id === 'preset-fin')!, fl = detailPresets().find((x) => x.id === 'preset-flange')!;
    expect(needsHost(pp)).toBe(true); expect(needsHost(fin)).toBe(true); expect(needsHost(fl)).toBe(false);
    const free = d.members.filter((m) => m.kind === 'column').map((m) => findSite(d.members, m, 'start')!).find((s) => !s.host)!;
    expect(free).toBeTruthy();
    expect(presetFits(pp, free)).toBe(false); expect(presetFits(fin, free)).toBe(false);
    const brace = d.members.find((m) => m.id.startsWith('KB.'))!;
    expect(presetFits(pp, findSite(d.members, brace, 'start')!)).toBe(true);
    const rafter = d.members.find((m) => m.kind === 'rafter')!; // IPE על עמוד C — לא נבדק לפרט הזה
    expect(presetFits(pp, findSite(d.members, rafter, 'start')!)).toBe(false);
  });
  it('FIT-02: כל פרט מוכן (בסיס) שמוצע לאתר — נבנה בלי שגיאות נוסחה/ריתוך ובלי חריגה, בכל אתרי הפרויקט', () => {
    const d = generate(proj());
    const base = detailPresets().filter((x) => ['preset-flange', 'preset-fin', 'preset-plate-plate', 'preset-cleat-plate'].includes(x.id));
    let n = 0; const bad: string[] = [];
    for (const m of d.members.filter((x) => ['column', 'rafter', 'brace', 'beam', 'purlin'].includes(x.kind))) for (const end of ['start', 'end'] as const) {
      let s; try { s = findSite(d.members, m, end); } catch { continue; } if (!s) continue;
      for (const det of base) { if (!presetFits(det, s)) continue; n++; try { const r = buildDetail(s, det); if (Object.keys(r.errors).length) bad.push(`${det.id} ${m.id}|${end}: ${JSON.stringify(r.errors)}`); } catch (e) { bad.push(`${det.id} ${m.id}|${end}: EXC ${String(e).slice(0, 80)}`); } }
    }
    expect(n).toBeGreaterThan(40);
    expect(bad).toEqual([]);
  });
});
