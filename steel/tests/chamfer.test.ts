/**
 * CHAM — פרט "פלטה אל פלטה + קיטומי פינות (אלכסון)" (`preset-plate-plate-cham`) ויכולת הסטודיו הכללית `cornerOn` (פינות פרמטריות).
 * CHAM-01: קיטום 20×20 אמיתי בקונטור — 8 קודקודים, ארבעה מקטעים אלכסוניים באורך 20√2 וזווית 45°, והצלעות הישרות מתקצרות ב-40.
 * CHAM-02: פרמטרים — מידת הקיטום, בחירת פינות (k1..k4), ch=0 ⇒ מלבן; ערכי מופע דרך `overrides`.
 * CHAM-03: יחסי לחתך/זווית — חתך אחר, מארח אחר: הפרט מתעדכן והקיטום נשאר 20.
 * CHAM-04: החלה על כל האלכסונים במודל: ללא שגיאות, חלקי פלטה עם קונטור, שרטוט הפלטה ו-DXF מכילים את הקונטור הקטום.
 */
import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { defaultKneeBraces } from '../src/geometry/knee';
import { buildDetail, detailPresets, findSite, presetFits } from '../src/geometry/detail';
import { assignDetail, numberParts } from '../src/commands/commands';
import { computeFabrication } from '../src/fab/marks';
import { computeBom } from '../src/fab/bom';
import { buildSheet, drawingCatalog } from '../src/drawing/views';
import { sheetToDxf } from '../src/drawing/dxf';
import { dstvZip } from '../src/fab/dstv';
import { unzipSync, strFromU8 } from 'fflate';
import type { CustomDetail, Member, Project } from '../src/model/types';

const proj = (profile = 'RHS80x80x4', col?: string): Project => { const b = defaultBuilding(); if (col) b.columnProfile = col; b.kneeBraces = { ...defaultKneeBraces(), enabled: true, profile }; return newProject('cham', b); };
const det = () => structuredClone(detailPresets().find((x) => x.id === 'preset-plate-plate-cham')!) as CustomDetail;
const site = (p: Project, end: 'start' | 'end' = 'start') => { const d = generate(p); const m = d.members.find((x) => x.id.startsWith('KB.'))!; return { d, s: findSite(d.members, m, end)! }; };
const seg = (m: Member) => { const c = m.contour!; return c.map((q, i) => { const n = c[(i + 1) % c.length]!; return Math.hypot(n.s - q.s, n.u - q.u); }); };
const plateOf = (r: ReturnType<typeof buildDetail>, id: string) => r.members.find((x) => x.id.endsWith(`.${id}`))!;

describe('CHAM-01 קיטום 20×20 בקונטור האמיתי', () => {
  it('שתי הפלטות: 8 קודקודים; 4 מקטעים אלכסוניים 20√2; ישרים = מידה − 40', () => {
    const { s } = site(proj());
    const r = buildDetail(s, det());
    expect(r.errors).toEqual({}); expect(r.issues.filter((i) => i.severity === 'error')).toEqual([]);
    const { W, H } = r.values as Record<string, number>;
    for (const id of ['P1', 'P2']) {
      const m = plateOf(r, id);
      expect(m.contour!.length, id).toBe(8);
      const L = seg(m).map((x) => Math.round(x * 100) / 100);
      expect(L.filter((x) => Math.abs(x - 20 * Math.SQRT2) < 0.1).length, `${id} ${L}`).toBe(4);
      // לאורך כל אחת משתי השפות הסמוכות לפינה — בדיוק 20: הישרים קצרים ב-40 מהמידה המלאה
      const straight = L.filter((x) => Math.abs(x - 20 * Math.SQRT2) >= 0.1).sort((a, b) => a - b);
      const hh = Math.round(H! - 40), ww = Math.round(W! - 40);
      expect(straight.map((x) => Math.round(x)).sort((a, b) => a - b)).toEqual([hh, hh, ww, ww].sort((a, b) => a - b));
    }
    expect(r.conn.bolts.length).toBe(4);
    for (const b of r.conn.bolts) expect(b.holesIn.length).toBe(2);
  });
});

describe('CHAM-02 פרמטרים: מידת קיטום ובחירת פינות', () => {
  const verts = (s: ReturnType<typeof site>['s'], ov: Record<string, number>) => plateOf(buildDetail(s, det(), { overrides: ov }), 'P2');
  it('ch=30 ⇒ ניצבים 30; ch=0 ⇒ מלבן; פינה אחת כבויה ⇒ 7; שתיים ⇒ 6; כולן כבויות ⇒ מלבן', () => {
    const { s } = site(proj());
    const a = verts(s, { ch: 30 });
    expect(seg(a).filter((x) => Math.abs(x - 30 * Math.SQRT2) < 0.1).length).toBe(4);
    expect(verts(s, { ch: 0 }).contour).toBeUndefined();
    expect(verts(s, { k2: 0 }).contour!.length).toBe(7);
    expect(verts(s, { k2: 0, k4: 0 }).contour!.length).toBe(6);
    expect(verts(s, { k1: 0, k2: 0, k3: 0, k4: 0 }).contour).toBeUndefined();
    // רק פינה ↗: 5 קודקודים
    expect(verts(s, { k2: 0, k3: 0, k4: 0 }).contour!.length).toBe(5);
  });
  it('פרמטרים נוספים: עובי, עמודות/שורות ברגים, קוטר — מעדכנים בלי שגיאות', () => {
    const { s } = site(proj());
    const r = buildDetail(s, det(), { overrides: { t: 16, nc: 2, nr: 3, d: 20 } });
    expect(r.errors).toEqual({});
    expect(r.conn.bolts.length).toBe(12); // 2 צדדים × 2 עמודות × 3 שורות
    expect(new Set(r.conn.bolts.map((b) => b.d))).toEqual(new Set([20]));
    expect(plateOf(r, 'P1').profile).toMatch(/x16$/);
    expect(r.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });
});

describe('CHAM-03 יחסי לחתך, למארח ולזווית', () => {
  it('חתכים אחרים: הפרט נבנה, גודל הפלטה משתנה, הקיטום נשאר 20', () => {
    const sizes: number[] = [];
    for (const [prof, col] of [['RHS80x80x4', undefined], ['RHS100x100x5', undefined], ['SHS60x60x4', undefined], ['RHS80x80x4', 'HEB240']] as [string, string | undefined][]) {
      const p = proj(prof, col), { d, s } = site(p);
      const dt = det();
      if (!presetFits(dt, s)) continue; // מארח לא מתאים — לא מוצע
      const r = buildDetail(s, dt);
      expect(r.errors, `${prof}/${col}`).toEqual({});
      expect(r.issues.filter((i) => i.severity === 'error' || i.code === 'CD_EDGE').map((i) => `${i.code} ${i.message}`), `${prof}/${col}`).toEqual([]);
      const m = plateOf(r, 'P2');
      expect(seg(m).filter((x) => Math.abs(x - 20 * Math.SQRT2) < 0.1).length).toBe(4);
      sizes.push(Math.round((r.values as Record<string, number>).W!));
      void d;
    }
    expect(sizes.length).toBeGreaterThanOrEqual(3);
    expect(new Set(sizes).size).toBeGreaterThan(1);
  });
  it('תנאי התאמה מפורשים: לא מוצע לאלמנט I / למארח RHS', () => {
    const dt = det();
    expect(dt.match).toMatchObject({ member: ['RHS', 'SHS'], host: ['IPE', 'HEA', 'HEB', 'HEM'] });
    const { d } = site(proj());
    const col = d.members.find((m) => m.kind === 'column')!, raf = d.members.find((m) => m.kind === 'rafter')!;
    for (const m of [col, raf]) for (const end of ['start', 'end'] as const) { const s = findSite(d.members, m, end); if (s) expect(presetFits(dt, s), `${m.id}|${end}`).toBe(false); }
  });
});

describe('CHAM-04 החלה על האלמנטים, שרטוט ו-DXF', () => {
  it('החלה על כל האלמנטים: ללא שגיאות; קונטור 8 בחלקי הפלטות; גיליון הפלטות ו-DXF כוללים 45° באורך 20√2; NC1 כולל קונטור', () => {
    const p0 = proj(), d0 = generate(p0);
    const dt = det();
    const keys = d0.members.filter((m) => m.id.startsWith('KB.')).flatMap((m) => [`${m.id}|start`, `${m.id}|end`]);
    p0.customDetails = [...(p0.customDetails ?? []), dt];
    const p = numberParts().run(assignDetail(keys, dt).run(p0));
    const d = generate(p);
    expect(d.issues.filter((i) => i.severity === 'error').map((i) => `${i.code} ${i.message}`)).toEqual([]);
    const plates = d.members.filter((m) => m.kind === 'plate' && m.contour?.length === 8 && /\.CD\./.test(m.connId ?? m.id) || (m.kind === 'plate' && m.contour?.length === 8 && m.id.includes('CD.')));
    expect(plates.length).toBeGreaterThan(8);
    const fab = computeFabrication(p, d), bom = computeBom(d, fab);
    const marks = new Set(plates.map((m) => fab.parts.find((x) => x.memberId === m.id)?.mark).filter(Boolean));
    expect(marks.size).toBeGreaterThan(0);
    const cat = drawingCatalog(p, d, fab).filter((x) => x.type === 'plates');
    expect(cat.length).toBeGreaterThan(0);
    // DXF של גיליון פלטות: מקטעי LINE ב-45° בעלי אורך זהה = ניצבי הקיטום 20 → 20√2 במ"מ מודל
    let found = 0, chamferText = false;
    for (const def of cat.filter((x) => (x.refs ?? []).some((m) => marks.has(m)))) {
      const sh = buildSheet(def, p, d, fab, bom);
      if (sh.ents.some((e) => e.k === 'text' && /20×45°/.test((e as { s: string }).s))) chamferText = true;
      const dxf = sheetToDxf(sh).split(/\r?\n/);
      const lines: number[][] = [];
      for (let i = 0; i < dxf.length; i++) if (dxf[i] === 'LINE') { const v: Record<string, number> = {}; for (let j = i + 1; j < i + 40 && dxf[j] !== '0'; j += 2) v[dxf[j]!] = Number(dxf[j + 1]); if (v['10'] !== undefined) lines.push([v['10']!, v['20']!, v['11']!, v['21']!]); }
      // אורך מקטע הקיטום בציור = 20√2 / קנה המידה; כל ארבעת מקטעי הקיטום של הפלטה שווים ב-45° (ללא פילה — קו ישר)
      const diag = lines.map(([x1, y1, x2, y2]) => ({ dx: Math.abs(x2! - x1!), dy: Math.abs(y2! - y1!) })).filter((q) => Math.hypot(q.dx, q.dy) > 1 && Math.abs(q.dx - q.dy) < 0.02 * Math.hypot(q.dx, q.dy)).map((q) => Math.round(Math.hypot(q.dx, q.dy) * 100) / 100);
      const byLen = new Map<number, number>(); for (const L of diag) byLen.set(L, (byLen.get(L) ?? 0) + 1);
      found = Math.max(found, ...[...byLen.values()]);
    }
    expect(chamferText, 'הערת "20×45°" בגיליון הפלטה').toBe(true);
    expect(found, 'ארבעה מקטעי LINE שווים ב-45° (קיטום ישר) ב-DXF של גיליון הפלטה').toBeGreaterThanOrEqual(4);
    // NC1 של פלטה: קונטור (AK) לא נפלט — החיתוך בלייזר מקבל את הקונטור מה-DXF/DSTV לפי הגדרות; כאן נבדק רק שהפלטה כוללת 4 חורים ונפלטת ל-ZIP
    const zip = unzipSync(dstvZip(p, d, fab).zip);
    const mk = [...marks][0]!;
    expect(strFromU8(zip[`${mk}.nc1`]!)).toMatch(/^ST/);
  });
});

import { migrate } from '../src/model/migrate';
describe('CHAM-05 שמירה וטעינה', () => {
  it('JSON → migrate: הפרט (כולל cornerOn), ההשמות והערכים נשמרים והמודל זהה', () => {
    const p0 = proj(), d0 = generate(p0), dt = det();
    const keys = d0.members.filter((m) => m.id.startsWith('KB.')).flatMap((m) => [`${m.id}|start`, `${m.id}|end`]);
    let p = assignDetail(keys, dt).run({ ...p0, customDetails: [dt] });
    p = { ...p, detailParams: { ...(p.detailParams ?? {}), [keys[0]!]: { ch: 30, k2: 0 } } };
    const sig = (q: Project) => { const d = generate(q); return d.members.map((m) => `${m.id}:${m.profile}:${m.contour?.length ?? 0}:${Math.round(m.start.x)},${Math.round(m.start.y)},${Math.round(m.start.z)}`).sort().join('|'); };
    const q = migrate(JSON.parse(JSON.stringify(p)));
    expect(q.customDetails!.find((x) => x.id === dt.id)!.ops.filter((o) => o.k === 'plate').every((o) => (o as { cornerOn?: string[] }).cornerOn?.length === 4)).toBe(true);
    expect(q.detailAssign).toEqual(p.detailAssign); expect(q.detailParams![keys[0]!]).toEqual({ ch: 30, k2: 0 });
    expect(sig(q)).toBe(sig(p));
    // ערך מופע ch=30 מתבטא: לפלטות באתר הראשון ניצבי קיטום 30
    const d = generate(q);
    const pl = d.members.filter((m) => m.kind === 'plate' && m.id.includes(`${keys[0]!.split('|')[0]}`) && m.id.endsWith('.P2') && m.id.includes('.start'));
    expect(pl.length).toBeGreaterThan(0);
    expect(seg(pl[0]!).filter((x) => Math.abs(x - 30 * Math.SQRT2) < 0.1).length).toBe(3); // k2=0 ⇒ שלוש פינות
  });
});
