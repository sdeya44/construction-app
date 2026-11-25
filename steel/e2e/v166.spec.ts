import { expect, test } from '@playwright/test';
import { boot } from './helpers';

test('ZOOM-01: מהירות זום — ברירת מחדל 3×, שינוי חל מיד על החלון ונשמר אחרי טעינה', async ({ page }) => {
  await boot(page);
  const speed = () => page.evaluate(() => (window as any).__ksp.viewport.panes[0].controls.zoomSpeed as number);
  expect(await speed()).toBe(3);
  await page.getByTestId('layers-btn').click();
  await expect(page.getByTestId('zoom-speed-val')).toHaveText('3×');
  await page.getByTestId('zoom-speed').fill('6');
  await expect(page.getByTestId('zoom-speed-val')).toHaveText('6×');
  expect(await speed()).toBe(6);
  await page.reload();
  await page.waitForFunction(() => !!(window as any).__ksp?.viewport);
  expect(await speed()).toBe(6);
});
