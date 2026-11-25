/**
 * LIB-01..03: ספריית המחברים (1.67) — 7 פרטים מיובאים: נבנים בלי שגיאות על אתר מתאים, ברגים דרך שני חלקים,
 * ייבוא/ייצוא קובץ ספרייה. בדיקת CAD של הפרטים — tests/cad-oracle.test.ts ("ספריית מחברים").
 */
import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { buildDetail, detailPresets, findSite, presetFits } from '../src/geometry/detail';
import { exportLibrary, importLibrary } from '../src/geometry/detailLibrary';
import { libSites } from './libSites';

const bad = (iss: { severity: string; code: string; message: string }[]) => iss.filter((i) => i.severity === 'error').map((i) => `${i.code} ${i.message}`);
const LIB = detailPresets().filter((x) => x.id.startsWith('lib-'));

describe('LIB ספריית מחברים', () => {
  it('LIB-01: 7 פרטים בספרייה, עם מקור וקטגוריה', () => {
    expect(LIB.map((x) => x.id)).toEqual(['lib-fin-web', 'lib-double-fin', 'lib-flush-end', 'lib-extended-end', 'lib-seat', 'lib-purlin-single', 'lib-purlin-double']);
    for (const x of LIB) { expect(x.provenance?.url).toMatch(/^https:/); expect(x.category).toBeTruthy(); }
  });
  for (const [label, make] of libSites) it(`LIB-02: כל פרט על אתר מתאים — ${label}`, () => {
    const { sites } = make();
    for (const det of LIB) {
      const s = sites.find((x) => presetFits(det, x));
      expect(s, `${det.id}: אין אתר מתאים`).toBeTruthy();
      const r = buildDetail(s!, det);
      expect(bad(r.issues), det.id).toEqual([]);
      expect(Object.keys(r.errors), det.id).toEqual([]);
      expect(r.conn.bolts.length, det.id).toBeGreaterThan(0);
      // לפחות שני חלקים (שני סנפירים + ווב = 3)
      for (const b of r.conn.bolts) expect(b.holesIn.length, `${det.id} ${b.id}`).toBeGreaterThanOrEqual(2);
    }
  });
  it('LIB-02b: פרט קורה לא מוצע לאלכסון RHS', () => {
    const d = generate(newProject('a', { ...defaultBuilding(), kneeBraces: { ...(defaultBuilding().kneeBraces ?? {}), enabled: true } as never }));
    const kb = d.members.find((m) => m.id.startsWith('KB.'));
    if (!kb) return;
    const s = findSite(d.members, kb, 'start');
    for (const det of LIB.filter((x) => x.category === 'beam')) expect(presetFits(det, s)).toBe(false);
  });
  it('LIB-03: ייצוא וייבוא קובץ ספרייה — הלוך-חזור, מזהים כפולים מקבלים מזהה חדש, קובץ פגום נדחה', () => {
    const p = newProject('x', defaultBuilding());
    p.customDetails = [LIB[0]!];
    const txt = exportLibrary(p.customDetails);
    const back = importLibrary(txt, p.customDetails);
    expect(back.added.length).toBe(1);
    expect(back.added[0]!.id).not.toBe(LIB[0]!.id);
    expect(back.added[0]!.ops).toEqual(LIB[0]!.ops);
    expect(importLibrary(txt, []).added[0]!.id).toBe(LIB[0]!.id);
    expect(() => importLibrary('{"x":1}', [])).toThrow();
    expect(() => importLibrary(JSON.stringify({ format: 'kayan-connection-library', details: [{ id: 'a', name: 'b', vars: [], ops: [{ k: 'zzz' }] }] }), [])).toThrow(/zzz/);
    // ייבוא מערך גולמי (קובץ ספרייה חיצוני באותו פורמט)
    expect(importLibrary(JSON.stringify(LIB), []).added.length).toBe(7);
  });
});
