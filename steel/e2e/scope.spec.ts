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
