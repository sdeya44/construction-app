import { expect, test } from '@playwright/test';
import { boot, shot } from './helpers';

test('V137-01: סדר הקמה, סבולת מספור, חלוקת מפתח לאורך המבנה', async ({ page }) => {
  const errors = await boot(page);
  await page.getByTestId('mode-drawings').click();
  await page.getByTestId('dwg-D-SEQ').click();
  await expect(page.locator('svg text', { hasText: 'סדר הקמה' }).first()).toBeVisible();
  await shot(page, 'V137_01_sequence');
  await page.getByTestId('mode-production').click();
  await page.getByTestId('mark-tol').check();
  expect(await page.evaluate(() => (window as any).__ksp.store.state.project.settings.markTol)).toBe(5);
  await expect(page.getByRole('button', { name: 'סדר הקמה' })).toBeVisible();
  await page.getByRole('button', { name: 'מודל' }).first().click();
  await page.getByTestId('nav-b:roof').click();
  const add = page.getByTestId('off-roof'); if (await add.count()) await add.click();
  await page.getByTestId('br-ysplit').selectOption('3');
  expect(await page.evaluate(() => (window as any).__ksp.store.state.derived.members.filter((m: any) => m.id.startsWith('BR.S')).length)).toBeGreaterThan(0);
  await expect(page.getByTestId('br-strut')).toBeVisible();
  await shot(page, 'V137_01_ysplit');
  expect(errors).toEqual([]);
});
