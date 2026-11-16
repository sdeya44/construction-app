import { expect, test } from '@playwright/test';
import { boot, shot } from './helpers';

test('KB-02: אלכסוני עמוד-קורה — הגדרה לכל צד: ביטול צד ושינוי ירידה בצד אחר', async ({ page }) => {
  await boot(page);
  await page.getByTestId('nav-b:knee').click();
  await page.getByTestId('kb-on').check();
  await expect(page.getByTestId('kb-sides')).toBeVisible();
  const n = () => page.evaluate(() => (window as any).__ksp.store.state.derived.members.filter((m: any) => m.id.startsWith('KB.')).length);
  const n0 = await n();
  await page.getByTestId('kb-side-on-L.L.R').uncheck();
  expect(await n()).toBe(n0 - n0 / 2);
  const inp = page.getByTestId('kb-side-drop-R.R.L');
  await inp.fill('1200'); await inp.press('Enter');
  const ov = await page.evaluate(() => (window as any).__ksp.store.state.project.building.kneeBraces.sides);
  expect(ov['R.R.L'].drop).toBe(1200);
  await shot(page, 'KB_02_sides');
  await page.getByTestId('kb-side-reset-L.L.R').click();
  expect(await n()).toBe(n0);
});
