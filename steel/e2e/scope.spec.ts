import { expect, test } from '@playwright/test';
import { boot, pickProfile, shot } from './helpers';

test('SCOPE-01: לחיצה על אלמנט — בחירת היקף; האלמנט: שרטוט חלק וחיבור בכל קצה; ציר: שינוי חתך לציר בלבד; מכלול: אגד B שלם', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => { const k = (window as any).__ksp; k.store.set({ propScope: null, scopeIsolate: true }); localStorage.removeItem('ksp-prop-scope'); });
  const S = () => page.evaluate(() => (window as any).__ksp.store.state);
  await page.evaluate(() => (window as any).__ksp.store.select(['F3.COL.L']));
  await expect(page.getByTestId('pscope')).toBeVisible();
  await expect(page.getByTestId('pscope-hint')).toBeVisible(); // לפני בחירה — רק אפשרויות
  await expect(page.getByTestId('psec-prof')).toHaveCount(0);
  // האלמנט הזה: בידוד, שרטוט חלק, כרטיס חיבור בכל קצה
  await page.getByTestId('pscope-one').click();
  expect((await S()).isolated).toContain('F3.COL.L');
  await page.getByTestId('psec-part').click(); // שרטוט החלק מקופל (1.49) — החתך קודם
  await expect(page.getByTestId('part-preview')).toBeVisible();
  await expect(page.getByTestId('end-cards')).toContainText('פלטת בסיס');
  await expect(page.getByTestId('end-cards')).toContainText('עמוד-קורה');
  // כל הציר: שינוי חתך רק לעמודי הציר
  await page.getByTestId('pscope-line').click();
  await pickProfile(page, 'grp-profile', 'HEB200', 'HEB');
  const prof = (id: string) => page.evaluate((i) => (window as any).__ksp.store.state.derived.byId.get(i).profile, id);
  expect(await prof('F5.COL.L')).toBe('HEB200');
  expect(await prof('F5.COL.R')).toBe('HEA200');
  // הבחירה נשמרת: העמוד הבא נפתח ישר ב"כל הציר"
  await page.evaluate(() => (window as any).__ksp.store.select(['F2.COL.R']));
  await expect(page.getByTestId('pscope-line')).toHaveClass(/on/);
  // אגד B: המכלול — כל האגד ומחבריו
  await page.evaluate(() => { const k = (window as any).__ksp; k.store.exec({ label: 't', run: (p: any) => ({ ...p, building: { ...p.building, bracing: { ...p.building.bracing, walls: { ...p.building.bracing.walls, enabled: true, type: 'portal' } } } }) }); });
  const bb = await page.evaluate(() => (window as any).__ksp.store.state.derived.members.find((m: any) => /^BB\..*\.K1$/.test(m.id)).id);
  await page.evaluate((i) => (window as any).__ksp.store.select([i]), bb);
  await page.getByTestId('pscope-asm').click();
  await expect(page.getByTestId('asm-title')).toContainText('אגד B');
  await expect(page.getByTestId('ptab-conns')).toBeVisible();
  expect((await S()).isolated.length).toBeGreaterThan(5);
  await shot(page, 'SCOPE_01_portal');
  // ביטול בחירה — הבידוד מוסר
  await page.evaluate(() => (window as any).__ksp.store.select([]));
  await page.waitForTimeout(100);
  expect((await S()).isolated).toBeNull();
  expect(errors).toEqual([]);
});

test('SCOPE-02 (1.47.1): ברירת מחדל — לחיצה על אלמנט ובחירת היקף לא מעלימה את המודל', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => { const k = (window as any).__ksp; k.store.set({ propScope: null, scopeIsolate: undefined }); localStorage.removeItem('ksp-prop-scope'); });
  await page.evaluate(() => (window as any).__ksp.store.select(['F3.COL.L']));
  await expect(page.getByTestId('pscope-iso')).not.toBeChecked();
  await page.getByTestId('pscope-one').click();
  await page.getByTestId('pscope-line').click();
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => (window as any).__ksp.store.state.isolated)).toBeNull();
  // בידוד — רק לפי בחירה מפורשת
  await page.getByTestId('pscope-iso').check();
  await page.waitForTimeout(100);
  expect((await page.evaluate(() => (window as any).__ksp.store.state.isolated))?.length).toBeGreaterThan(1);
  expect(errors).toEqual([]);
});

test('SCOPE-03 (1.48): אלמנט במכלול קשיחות — רק "המכלולים בציר" / "כל המכלולים"; סוג וחתך לפי ההיקף', async ({ page }) => {
  const errors = await boot(page);
  const S = () => page.evaluate(() => (window as any).__ksp.store.state);
  await page.evaluate(() => { const k = (window as any).__ksp; k.store.set({ propScope: null }); k.store.exec({ label: 't', run: (p: any) => ({ ...p, building: { ...p.building, bracing: { ...p.building.bracing, walls: { ...p.building.bracing.walls, enabled: true, type: 'portal' } } } }) }); });
  const lines: string[] = await page.evaluate(() => [...new Set((window as any).__ksp.store.state.derived.members.filter((m: any) => /^BB\./.test(m.id)).map((m: any) => m.id.split('.')[2]))] as string[]);
  expect(lines.length).toBeGreaterThan(1);
  const [a, b] = lines;
  const bbK = (l: string) => page.evaluate((ll) => (window as any).__ksp.store.state.derived.members.find((m: any) => m.id.startsWith(`BB.`) && m.id.split('.')[2] === ll && /\.K1$/.test(m.id)).id, l);
  await page.evaluate((i) => (window as any).__ksp.store.select([i]), await bbK(a));
  // אין "רק האלמנט הזה" / "כל הדומים" — רק מכלולים
  await expect(page.getByTestId('pscope-one')).toHaveCount(0);
  await expect(page.getByTestId('pscope-similar')).toHaveCount(0);
  await page.getByTestId('pscope-asm').click();
  await expect(page.getByTestId('asm-applies')).toContainText('המכלולים בציר');
  await expect(page.getByTestId('asm-scope-line')).toHaveCount(0); // ההיקף נקבע למעלה
  // חתך האלכסונים — לציר הזה בלבד
  await pickProfile(page, 'prop-profile', 'SHS100x5', 'SHS');
  const prof = (l: string) => page.evaluate((ll) => (window as any).__ksp.store.state.derived.members.find((m: any) => m.id.startsWith('BB.') && m.id.split('.')[2] === ll && /\.K1$/.test(m.id)).profile, l);
  expect(await prof(a)).toBe('SHS100x5');
  expect(await prof(b)).not.toBe('SHS100x5');
  // סוג — לציר הזה בלבד
  await page.getByTestId('asm-type-truss').click();
  let w = (await S()).project.building.bracing.walls;
  expect(w.lineType[a]).toBe('truss');
  expect(w.lineType[b] ?? w.type).toBe('portal');
  // מכלול בציר השני → כל המכלולים במודל → X לכולם
  await page.evaluate((i) => (window as any).__ksp.store.select([i]), await bbK(b));
  await page.getByTestId('pscope-asmall').click();
  await expect(page.getByTestId('asm-applies')).toContainText('כל המכלולים במודל');
  // כל המכלולים = העורך המלא כמו בתפריט הימני (סוג, צירים ומפתחים, סיב רציף)
  const full = page.getByTestId('hub-settings');
  await expect(full.getByTestId('br-walls-ed-tab-lines')).toBeVisible();
  await full.getByTestId('br-walls-x').click();
  w = (await S()).project.building.bracing.walls;
  expect(w.type).toBe('x');
  expect(w.lineType).toBeUndefined();
  expect(errors).toEqual([]);
});

test('SCOPE-04 (1.48.1): "כל המכלולים במודל" — העורך המלא; גובר על הגדרה קודמת לציר', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => { const k = (window as any).__ksp; k.store.set({ propScope: null }); k.store.exec({ label: 't', run: (p: any) => ({ ...p, building: { ...p.building, bracing: { ...p.building.bracing, walls: { ...p.building.bracing.walls, enabled: true, type: 'portal' } } } }) }); });
  const lines: string[] = await page.evaluate(() => [...new Set((window as any).__ksp.store.state.derived.members.filter((m: any) => /^BB\./.test(m.id)).map((m: any) => m.id.split('.')[2]))] as string[]);
  const [a, b] = lines;
  const bbK = (l: string) => page.evaluate((ll) => (window as any).__ksp.store.state.derived.members.find((m: any) => m.id.startsWith('BB.') && m.id.split('.')[2] === ll && /\.K1$/.test(m.id)), l);
  // ציר a: חתך אלכסון לציר בלבד
  await page.evaluate(async (i) => (window as any).__ksp.store.select([i]), (await bbK(a)).id);
  await page.getByTestId('pscope-asm').click();
  await pickProfile(page, 'prop-profile', 'SHS100x5', 'SHS');
  expect((await bbK(a)).profile).toBe('SHS100x5');
  // מציר b: כל המכלולים — גם ציר a מתעדכן
  await page.evaluate(async (i) => (window as any).__ksp.store.select([i]), (await bbK(b)).id);
  await page.getByTestId('pscope-asmall').click();
  const full = page.getByTestId('hub-settings');
  await full.getByTestId('pb-brace-open').click();
  await full.getByTestId('pb-brace-fam-SHS').click();
  await full.getByTestId('pb-brace-opt-SHS120x5').click();
  await page.waitForTimeout(150);
  expect((await bbK(a)).profile).toBe('SHS120x5');
  expect((await bbK(b)).profile).toBe('SHS120x5');
  expect(errors).toEqual([]);
});
