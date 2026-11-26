import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { computeFabrication } from '../src/fab/marks';
import { dstvZip, partToNc1 } from '../src/fab/dstv';
import { numberParts } from '../src/commands/commands';

describe('DSTV (NC1)', () => {
  const p0 = newProject('t', defaultBuilding()); p0.settings.autoSplice = false;
  const p = numberParts().run(p0);
  const d = generate(p), fab = computeFabrication(p, d);
  it('פטה: בלוק ST עם סימון, אורך, קוד פרופיל, ובלוק BO עם כל החורים', () => {
    const part = fab.parts.find((x) => x.memberId === 'PL.L.04')!;
    const nc = partToNc1(part, p, d, 14);
    const L = nc.split('\r\n');
    expect(L[0]).toBe('ST');
    expect(L[5].trim()).toBe(part.mark);
    expect(L[7].trim()).toBe('14');
    expect(L[9].trim()).toBe('C');
    expect(Number(L[10])).toBeCloseTo(30100, 2);
    const bo = L.slice(L.indexOf('BO') + 1, L.indexOf('EN')).map((x) => x.trim().split(/\s+/));
    expect(bo.length).toBe(17);
    expect(bo.filter((x) => x[0] === 'v').length).toBe(12); // ווב — ברגי התומכים
    expect(bo.filter((x) => x[0] === 'u').length).toBe(5);  // אגף תחתון — שורת קשירה
    expect(bo.every((x) => Number(x[3]) === 14)).toBe(true);
    // חור ראשון: 25 מ"מ מקצה הפטה, בגובה 100 (אמצע ווב C200)
    const first = bo.filter((x) => x[0] === 'v').sort((a, b) => Number(a[1]) - Number(b[1]))[0];
    expect(Number(first[1])).toBeCloseTo(25, 1);
    expect(Number(first[2])).toBeCloseTo(100, 1);
    expect(L[L.length - 2]).toBe('EN');
  });
  it('קורה: ללא חורים (ראש עמוד בשתי פלטות — הקורה מרותכת לפלטה), חיתוכי קצה בזווית; חורי פלטת הקורה בקובץ הפלטה', () => {
    const part = fab.parts.find((x) => x.memberId === 'F2.RAF.L')!;
    const L = partToNc1(part, p, d, 1).split('\r\n');
    expect(L[9].trim()).toBe('I');
    expect(L.map((x) => x.trim())).not.toContain('BO');
    const pl = fab.parts.find((x) => x.memberId === 'C.EAVE.F2.L.PL2')!;
    expect(pl.holes.length).toBe(4);
    expect(pl.holes.every((h) => h.d === 20)).toBe(true); // M18 + 2
    expect(Number(L[19])).toBeCloseTo(0, 1); // קצה המרזב: חיתוך 90° לציר (החלטת משתמש)
  });
  it('ZIP: קובץ לכל סימון פלטה בלבד (ללא פרופילים וללא מוטות עיגון), נפתח ומכיל ST/EN', () => {
    const { zip, count } = dstvZip(p, d, fab);
    const files = unzipSync(zip);
    const names = Object.keys(files);
    expect(names.length).toBe(count);
    expect(names.length).toBeGreaterThan(0);
    expect(names.length).toBe(new Set(fab.parts.filter((x) => x.kind === 'plate').map((x) => x.mark)).size);
    const profMarks = new Set(fab.parts.filter((x) => x.kind !== 'plate' && x.kind !== 'anchor').map((x) => x.mark));
    expect(profMarks.size).toBeGreaterThan(0);
    expect(names.some((n) => profMarks.has(n.replace(/\.nc1$/, '')))).toBe(false);
    for (const n of names) { const t = strFromU8(files[n]); expect(t.startsWith('ST')).toBe(true); expect(t.trim().endsWith('EN')).toBe(true); }
  });
});
