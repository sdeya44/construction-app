import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { defaultTrussSpec, panelLocks, setPanelLen, unlockPanel, panelsOnFrames, patternCells, resizeSpec, trussNodes, trussUtil } from '../src/geometry/truss';
import { SECTION_TEMPLATES } from '../src/model/section';
import type { TrussSpec } from '../src/model/types';
import { computeFabrication } from '../src/fab/marks';

const errs = (d: ReturnType<typeof generate>) => d.issues.filter((i) => i.severity === 'error').map((i) => i.message);

describe('מסבכים', () => {
  it('TR-U1: מסבכי גג — תבניות וצורות, דו-שיפועי וחד-שיפועי, 18/30 מ\' — ללא שגיאות', () => {
    for (const [w, shape, pat, mono] of [[18000, 'flat', 'warren-v', false], [18000, 'parallel', 'pratt', false], [30000, 'flat', 'howe', false], [18000, 'flat', 'warren', true]] as const) {
      const b = defaultBuilding(); b.width = w;
      if (mono) b.section = SECTION_TEMPLATES.find((t) => t.id === 'mono-2')!.make() as never;
      const spec = defaultTrussSpec(w / 1500, 1200, { top: b.rafterProfile });
      Object.assign(spec, patternCells(pat, spec.panels), { pattern: pat });
      b.roofTruss = { enabled: true, frames: 'all', shape, spec };
      const d = generate(newProject('x', b));
      expect(errs(d)).toEqual([]);
      expect(d.members.filter((m) => m.id.startsWith('TR.')).length).toBeGreaterThan(b.frames.length * 8);
      expect(d.members.some((m) => m.id.startsWith('KB.'))).toBe(false);
      // כל החלקים קצרים מאורך המוט
      expect(d.parts.every((p) => p.length <= 12000 + 1)).toBe(true);
    }
  });
  it('TR-U2: מסבך גג — מכלול אחד לכל חצי מסבך (קורת גג + חגורה + מילוי), לא מכלול ענק', () => {
    const b = defaultBuilding();
    b.roofTruss = { enabled: true, frames: 'all', shape: 'flat', spec: defaultTrussSpec(12, 1200, { top: b.rafterProfile }) };
    const p = newProject('x', b); const d = generate(p); const fab = computeFabrication(p, d);
    const asm = fab.assemblies.filter((a) => a.main.includes('.RAF.'));
    expect(asm.length).toBe(b.frames.length * 2);
    expect(asm.every((a) => a.parts.length > 8)).toBe(true);
  });
  it('TR-U3: מסבך נושא בדילול עמודים — X, ריק, חיבור המשך ידני — ללא שגיאות', () => {
    const b = defaultBuilding(); const f = [...b.frames].sort((x, y) => x.y - y.y);
    const spec = defaultTrussSpec(8, 1200);
    spec.cells[3] = 'X'; spec.cells[4] = 'X'; spec.cells[6] = ''; spec.splice = [3];
    b.transfers = [{ id: 'T1', lineId: 'L', from: f[0].id, to: f[4].id, removed: [f[1].id, f[2].id, f[3].id], profile: 'HEA160', support: 'A2', seat: 'B1', kind: 'truss', truss: spec }];
    const d = generate(newProject('x', b));
    expect(errs(d)).toEqual([]);
    expect(d.connections.filter((c) => c.id.startsWith('C.RS.TB.T1')).length).toBe(2);
    expect(d.members.filter((m) => m.id.startsWith('TB.T1.TR')).length).toBeGreaterThan(10);
  });
  it('TR-U5: מסבך נושא בחגורות RHS — פלטת תמיכה מרותכת, ברגים מחוץ לצינור, B2→B1, חיבור המשך פלנץ', () => {
    const b = defaultBuilding(); const f = [...b.frames].sort((x, y) => x.y - y.y);
    const spec = defaultTrussSpec(8, 1200, { top: 'RHS200x100x8', bottom: 'RHS200x100x8' });
    spec.splice = [3];
    b.transfers = [{ id: 'T1', lineId: 'L', from: f[0].id, to: f[4].id, removed: [f[1].id, f[2].id, f[3].id], profile: 'HEA160', support: 'A1', seat: 'B2', kind: 'truss', truss: spec }];
    const d = generate(newProject('x', b));
    expect(errs(d)).toEqual([]);
    const sup = d.connections.find((c) => c.id === `C.TBS.T1.${f[0].id}`)!;
    expect(sup.parts.some((id) => id.endsWith('.SP'))).toBe(true);
    expect(sup.parts.some((id) => id.endsWith('.STR'))).toBe(false);
    // ברגים מחוץ לדפנות הצינור (b=100)
    const line = d.members.find((m) => m.id === 'TB.T1')!.start.x;
    expect(sup.bolts.every((q) => Math.abs(q.p.x - line) > 50 + 20)).toBe(true);
    // מושב B2 הוחלף ב-B1 (פלטה א מרותכת לצינור)
    expect(d.members.some((m) => m.id.startsWith('C.TBR.T1.') && m.id.endsWith('.PA'))).toBe(true);
    // חיבור המשך פלנץ בשתי החגורות
    const rs = d.connections.filter((c) => c.id.startsWith('C.RS.TB.T1'));
    expect(rs.length).toBe(2);
    expect(rs.every((c) => c.label.includes('פלנץ'))).toBe(true);
  });
  it('TR-U6: שדות לא אחידים — צמתים לפי panelLens, צמתים על המסגרות, איפוס בשינוי מספר', () => {
    const s = { ...defaultTrussSpec(4, 1000), panelLens: [1000, 3000, 3000, 1000] };
    expect(trussNodes(s, 0, 16000)).toEqual([0, 2000, 8000, 14000, 16000]);
    expect(resizeSpec(s, 5).panelLens).toBeUndefined();
    const s2 = panelsOnFrames(defaultTrussSpec(5, 1000), 18000, [6000, 12000]);
    const nodes = trussNodes(s2, 0, 18000);
    expect(nodes.some((x) => Math.abs(x - 6000) < 2) && nodes.some((x) => Math.abs(x - 12000) < 2)).toBe(true);
    // מודל: מסבך נושא עם שדות לא שווים — צמתים במסגרות, ללא אזהרת "לא על צומת"
    const b = defaultBuilding(); const f = [...b.frames].sort((x, y) => x.y - y.y);
    const span = f[4].y - f[0].y;
    const sp = panelsOnFrames(defaultTrussSpec(6, 1200), span, [f[1].y, f[2].y, f[3].y].map((y) => y - f[0].y));
    sp.panelLens = sp.panelLens!.map((L, i) => (i % 2 ? L * 1.4 : L * 0.6));
    const fixed = panelsOnFrames(sp, span, [f[1].y, f[2].y, f[3].y].map((y) => y - f[0].y));
    b.transfers = [{ id: 'T1', lineId: 'L', from: f[0].id, to: f[4].id, removed: [f[1].id, f[2].id, f[3].id], profile: 'HEA160', support: 'A1', seat: 'B1', kind: 'truss', truss: { ...sp, panelLens: fixed.panelLens!.map((L, i) => (i % 2 ? L * 1.4 : L * 0.6)) } }];
    const d = generate(newProject('x', b));
    expect(errs(d)).toEqual([]);
    expect(d.issues.some((i) => i.code === 'TB_TRUSS' && i.message.includes('אינה על צומת'))).toBe(false);
  });
  it('TR-U4: הערכת ניצול — גובה כפול ⇒ כוח בחגורה חצי', () => {
    const s1 = defaultTrussSpec(8, 1000), s2 = { ...s1, depth: 2000 };
    const u1 = trussUtil(s1, 24000, { q: 10 }), u2 = trussUtil(s2, 24000, { q: 10 });
    expect(u2[1].force).toBeCloseTo(u1[1].force / 2, 3);
  });
  it('TR-U7: שדות קבועים — שדה שנקבע נשמר, החופשיים מתחלקים שווה, הסכום = מפתח', () => {
    const span = 12000;
    let s: TrussSpec = { ...defaultTrussSpec(6, 1000), symmetric: false };
    s = setPanelLen(s, span, 0, 1500);
    expect(s.panelLens).toEqual([1500, 2100, 2100, 2100, 2100, 2100]);
    s = setPanelLen(s, span, 2, 3000);
    // שדה 0 שנקבע קודם — לא זז; החופשיים שווים
    expect(s.panelLens![0]).toBe(1500); expect(s.panelLens![2]).toBe(3000);
    expect(s.panelLens!.filter((_, j) => j !== 0 && j !== 2).every((L) => L === 1875)).toBe(true);
    expect(s.panelLens!.reduce((a, b) => a + b, 0)).toBe(span);
    expect(panelLocks(s)).toEqual([true, false, true, false, false, false]);
    // שינוי חוזר של שדה 0 — שדה 2 נשאר
    s = setPanelLen(s, span, 0, 1000);
    expect(s.panelLens![2]).toBe(3000); expect(s.panelLens![0]).toBe(1000);
    expect(s.panelLens!.reduce((a, b) => a + b, 0)).toBe(span);
    // שחרור
    s = unlockPanel(s, span, 2);
    expect(panelLocks(s)).toEqual([true, false, false, false, false, false]);
    expect(s.panelLens!.slice(1).every((L) => L === 2200)).toBe(true);
    s = unlockPanel(s, span, 0);
    expect(s.panelLens).toBeUndefined();
    // סימטרי: השדה והמראה שלו
    let t = defaultTrussSpec(6, 1000);
    t = setPanelLen(t, span, 0, 1500);
    expect(t.panelLens).toEqual([1500, 2250, 2250, 2250, 2250, 1500]);
    expect(panelLocks(t)).toEqual([true, false, false, false, false, true]);
    // כל השדות נעולים ⇒ השאר משתחררים
    let u: TrussSpec = { ...defaultTrussSpec(3, 1000), symmetric: false };
    u = setPanelLen(u, 9000, 0, 2000); u = setPanelLen(u, 9000, 1, 3000); u = setPanelLen(u, 9000, 2, 2000);
    expect(u.panelLens!.reduce((a, b) => a + b, 0)).toBe(9000);
    expect(u.panelLens![2]).toBe(2000);
    // שינוי מספר שדות / צמתים על המסגרות — מבטל קביעות
    expect(resizeSpec(t, 4).lockedLens).toBeUndefined();
    expect(panelsOnFrames(t, span, [6000]).lockedLens).toBeUndefined();
  });
  it('TR-U8: מסבך נושא בין העמודים — העמודים לא מתקצרים, החגורות בין פלטות הקצה, ללא שגיאות והתנגשויות', () => {
    for (const prof of [['HEA160', 'HEA160'], ['RHS200x100x8', 'RHS200x100x8']]) {
      const b = defaultBuilding(); const f = [...b.frames].sort((x, y) => x.y - y.y);
      const spec = { ...defaultTrussSpec(6, 1000), profiles: { ...defaultTrussSpec(6, 1000).profiles, top: prof[0], bottom: prof[1] } };
      const mk = (fit?: 'top' | 'between') => { const bb = structuredClone(b); bb.transfers = [{ id: 'T1', lineId: 'L', from: f[0].id, to: f[3].id, removed: [f[1].id, f[2].id], profile: 'HEA160', support: 'A1', seat: 'B1', kind: 'truss', truss: spec, trussFit: fit }]; return generate(newProject('x', bb)); };
      const dTop = mk(), dBw = mk('between');
      expect(errs(dBw)).toEqual([]);
      expect(dBw.issues.filter((i) => i.code === 'CLASH')).toEqual([]);
      expect(dBw.issues.some((i) => i.message.includes('אינה על צומת'))).toBe(false);
      const col = (d: any) => d.members.find((m: any) => m.id === `${f[0].id}.COL.L`);
      // על ראשי העמודים — העמוד מקוצר; בין העמודים — העמוד בגובה המלא (כמו עמוד רגיל)
      const full = generate(newProject('x', structuredClone(b))).members.find((m: any) => m.id === `${f[0].id}.COL.L`)!;
      expect(col(dTop).end.z).toBeLessThan(full.end.z - 500);
      expect(col(dBw).end.z).toBeCloseTo(full.end.z, 3);
      const tb = dBw.members.find((m: any) => m.id === 'TB.T1')!, bc = dBw.members.find((m: any) => m.id === 'TB.T1.BC')!;
      // החגורות מתחילות אחרי פני העמוד (לא מעל הציר)
      expect(Math.min(tb.start.y, tb.end.y)).toBeGreaterThan(f[0].y + 100);
      expect(Math.max(bc.start.y, bc.end.y)).toBeLessThan(f[3].y - 100);
      // ראש החגורה העליונה מתחת לראש העמוד
      expect(tb.start.z).toBeLessThan(full.end.z);
      const sup = dBw.connections.filter((c) => c.id.startsWith('C.TBS.T1.'));
      expect(sup.length).toBe(2);
      for (const c of sup) {
        expect(c.welds.some((w) => w.between.includes('TB.T1')) && c.welds.some((w) => w.between.includes('TB.T1.BC'))).toBe(true);
        expect(c.bolts.length).toBeGreaterThanOrEqual(4);
      }
    }
  });
});
