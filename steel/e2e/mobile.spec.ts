import { expect, test } from '@playwright/test';
import { boot, expectInside, screenOf, selection, shot, openNav } from './helpers';

test('MOB-01: טלפון – יחס נכון, בחירה במגע ומחוות סיבוב', async ({ page }) => {
  const errors = await boot(page);
  await shot(page, 'MOB-01_iso');
  await page.getByTestId('proj-ortho').click();
  await page.getByTestId('view-front').click();
  await page.waitForTimeout(300);
  const a = await screenOf(page, { x: 0, y: 0, z: 0 });
  const b = await screenOf(page, { x: 18000, y: 0, z: 0 });
  const r = await screenOf(page, { x: 9000, y: 0, z: 6900 });
  const ratio = (b.x - a.x) / (a.y - r.y);
  expect(ratio).toBeGreaterThan((18000 / 6900) * 0.99);
  expect(ratio).toBeLessThan((18000 / 6900) * 1.01);
  await expectInside(page, [a, b, r]);
  await shot(page, 'MOB-01_front');
  // הקשה על עמוד
  const c = await screenOf(page, { x: 0, y: 0, z: 3000 });
  await page.touchscreen.tap(c.x, c.y);
  await page.waitForTimeout(200);
  expect(await selection(page)).toEqual(['F1.COL.L']);
  await page.getByTestId('m-props').click();
  await expect(page.getByTestId('prop-id')).toHaveText('F1.COL.L');
  await shot(page, 'MOB-01_props');
  await page.getByTestId('m-model').click();
  // גרירת מגע מסובבת ואינה בוחרת
  const cam0 = await page.evaluate(() => (window as any).__ksp.viewport.panes[0].camera.position.toArray());
  const cdp = await page.context().newCDPSession(page);
  const pts = [[200, 400], [230, 400], [260, 405], [300, 410]];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pts[0][0], y: pts[0][1] }] });
  for (const [x, y] of pts.slice(1)) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(200);
  const cam1 = await page.evaluate(() => (window as any).__ksp.viewport.panes[0].camera.position.toArray());
  expect(cam1).not.toEqual(cam0);
  expect(await selection(page)).toEqual(['F1.COL.L']);
  expect(errors).toEqual([]);
});


test('MOB-02: מסבך עד שרטוטים וייצור במסך טלפון צר', async ({ page }) => {
  const errors = await boot(page);
  const width = await page.evaluate(() => document.documentElement.clientWidth);

  await expect(page.getByTestId('m-model')).toBeVisible();
  await page.getByTestId('m-side').click();
  await openNav(page, 'b:truss');
  await page.getByTestId('rt-on').check({ force: true });
  await expect(page.getByTestId('tw-roof')).toBeVisible();
  await page.getByTestId('m-side').click({ force: true });
  await page.evaluate(() => (document.querySelector('[data-testid="m-drawings"]') as HTMLButtonElement).click());
  await page.waitForTimeout(300);
  await expect(page.getByTestId('drawings-view')).toBeVisible();
  await page.getByTestId('dwg-search').fill('T-');
  await page.getByTestId('dwg-D-TRUSS-1').click();
  await expect(page.getByTestId('dwg-title')).toContainText('תוכנית מסבך');
  await expect(page.getByTestId('dwg-svg')).toBeVisible();
  await page.evaluate(() => (document.querySelector('[data-testid="m-production"]') as HTMLButtonElement).click());
  await page.waitForTimeout(300);
  await expect(page.getByTestId('production-view')).toBeVisible();
  const docWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(docWidth, 'the page should not overflow the narrow phone viewport').toBeLessThanOrEqual(width + 1);
  expect(errors).toEqual([]);
});
