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
  await page.getByTestId('ks-sec-geo').click(); // 1.64: שרטוט החלק — גיאומטריה
  await expect(page.getByTestId('part-preview')).toBeVisible();
  await page.getByTestId('ks-sec-conn').click(); // חיבור בכל קצה — בלוק המחבר
  await expect(page.getByTestId('end-cards')).toContainText('פלטת בסיס');
  await page.getByTestId('el-end-end').click();
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
  // 1.56: אלמנט של קשיחות הקירות — חלון קשיחות הקירות (היקף: הציר שלו)
  await expect(page.getByTestId('walls-studio')).toBeVisible();
  await expect(page.getByTestId('pscope-asm')).toHaveClass(/on/);
  await expect(page.getByTestId('br-walls-portal')).toHaveAttribute('aria-checked', 'true');
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
  // 1.115: גם "האלמנט שנבחר" (חתך וחומר לאלמנט בודד); אין "כל הדומים" (1.56: חלון קשיחות הקירות)
  await expect(page.getByTestId('pscope-one')).toHaveCount(1);
  await expect(page.getByTestId('pscope-similar')).toHaveCount(0);
  await page.getByTestId('pscope-asm').click();
  await expect(page.getByTestId('ks-line')).toHaveValue(a);
  // חתך האלכסונים — לציר הזה בלבד
  await page.getByTestId('ks-sec-conn').click();
  await pickProfile(page, 'pb-brace', 'SHS100x5', 'SHS');
  const prof = (l: string) => page.evaluate((ll) => (window as any).__ksp.store.state.derived.members.find((m: any) => m.id.startsWith('BB.') && m.id.split('.')[2] === ll && /\.K1$/.test(m.id)).profile, l);
  expect(await prof(a)).toBe('SHS100x5');
  expect(await prof(b)).not.toBe('SHS100x5');
  // סוג — לציר הזה בלבד
  await page.getByTestId('br-walls-truss').click();
  let w = (await S()).project.building.bracing.walls;
  expect(w.lineType[a]).toBe('truss');
  expect(w.lineType[b] ?? w.type).toBe('portal');
  // מכלול בציר השני → כל המודל → X לכולם
  await page.evaluate((i) => (window as any).__ksp.store.select([i]), await bbK(b));
  await page.getByTestId('pscope-asmall').click();
  await page.getByTestId('ks-sec-loc').click();
  await expect(page.getByTestId('ks-loc')).toBeVisible();
  await page.getByTestId('br-walls-x').click();
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
  await page.getByTestId('ks-sec-conn').click();
  await pickProfile(page, 'pb-brace', 'SHS100x5', 'SHS');
  expect((await bbK(a)).profile).toBe('SHS100x5');
  // מציר b: כל המכלולים — גם ציר a מתעדכן
  await page.evaluate(async (i) => (window as any).__ksp.store.select([i]), (await bbK(b)).id);
  await page.getByTestId('pscope-asmall').click();
  await page.getByTestId('ks-sec-conn').click();
  await pickProfile(page, 'pb-brace', 'SHS120x5', 'SHS');
  await page.waitForTimeout(150);
  expect((await bbK(a)).profile).toBe('SHS120x5');
  expect((await bbK(b)).profile).toBe('SHS120x5');
  expect(errors).toEqual([]);
});
