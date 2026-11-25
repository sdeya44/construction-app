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

test('DIM-01: מידות תלויות-מבט — קו מידה מצויר בכל מבט, המידה בצד הקרוב למצלמה, מעבר עכבר מדגיש', async ({ page }) => {
  await boot(page);
  const rot = (d: number[]) => page.evaluate((v) => {
    const vp = (window as any).__ksp.viewport, pn = vp.panes[0], t = pn.controls.target, dist = pn.camera.position.distanceTo(t), l = Math.hypot(...v);
    pn.camera.position.set(t.x + v[0] / l * dist, t.y + v[1] / l * dist, t.z + v[2] / l * dist); pn.camera.lookAt(t); pn.controls.update(); vp.requestRender();
  }, d);
  for (const v of [[1, -1.3, 0.8], [-1, 1, 0.6], [0.2, -1, 0.15]]) {
    await rot(v); await page.waitForTimeout(300);
    const n = await page.locator('.vp-dims g[data-dim]').count();
    expect(n).toBeGreaterThan(3);
    // כל תווית מידה גלויה מחוברת לקו מידה עם אותו מזהה
    const ids = await page.locator('.vp-label.dim[data-dim]:visible').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.dim));
    for (const id of ids) expect(await page.locator(`.vp-dims g[data-dim="${id}"]`).count()).toBe(1);
  }
  const lab = page.locator('.vp-label.dim[data-dim]:visible').first();
  const id = await lab.getAttribute('data-dim');
  await lab.hover();
  await expect(page.locator(`.vp-dims g[data-dim="${id}"]`)).toHaveClass(/hot/);
});
