import { expect, test } from '@playwright/test';
import { boot, shot } from './helpers';

test('TB-01: דילול עמודים — בחירת עמודים, חלון הצעה, קורה נושאת, החלפת סוג תמיכה, החזרת עמודים', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => (window as any).__ksp.store.select(['F2.COL.L', 'F3.COL.L', 'F4.COL.L']));
  await page.getByTestId('ctx-omit').click();
  await expect(page.getByTestId('omit-dialog')).toBeVisible();
  await expect(page.getByTestId('omit-dialog')).toContainText('מפתח 24.00');
  await shot(page, 'TB_01_dialog');
  await page.getByTestId('omit-apply').click();
  const st = () => page.evaluate(() => { const d = (window as any).__ksp.store.state.derived; return { err: d.issues.filter((i: any) => i.severity === 'error').length, tb: d.members.filter((m: any) => m.id.startsWith('TB.')).length, cols: d.members.filter((m: any) => m.kind === 'column').length, seats: d.connections.filter((c: any) => c.type === 'tb-seat').length }; });
  expect(await st()).toEqual({ err: 0, tb: 1, cols: 9, seats: 5 });
  await page.evaluate(() => { const k = (window as any).__ksp; k.store.select(['TB.' + k.store.state.project.building.transfers[0].id]); k.viewport.zoomToSelection?.(); });
  await shot(page, 'TB_02_model');
  await page.getByTestId('nav-b:tb').click();
  const id = await page.evaluate(() => (window as any).__ksp.store.state.project.building.transfers[0].id);
  await page.getByTestId('tb-grp-0-edit').click();
  await page.getByTestId('tb-ed-tab-support').click();
  await page.getByTestId(`tb-sup-tile-${id}-A2`).click();
  expect((await st()).err).toBe(0);
  expect((await st()).seats).toBe(3);
  await page.getByTestId('tb-ed-back').click();
  await page.getByTestId(`tb-restore-${id}`).click();
  expect((await st()).cols).toBe(12);
});
