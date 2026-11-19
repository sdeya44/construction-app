import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { boot, EVIDENCE, shot } from './helpers';

test('V136-01: תוכנית הרכבה ותוויות בשרטוטים; הצעות האחדה בייצור', async ({ page }) => {
  const errors = await boot(page);
  await page.getByTestId('mode-drawings').click();
  await page.getByTestId('dwg-D-ERECT').click();
  await expect(page.locator('svg text', { hasText: 'סימון ← מיקום בהרכבה' }).first()).toBeVisible();
  await shot(page, 'V136_01_erection');
  await page.getByTestId('dwg-D-LBL-1').click();
  await shot(page, 'V136_01_labels');
  await page.getByTestId('mode-production').click();
  await expect(page.getByTestId('unify-bolts')).toBeVisible();
  await page.getByTestId('bolt-unify').check();
  expect(await page.evaluate(() => (window as any).__ksp.store.state.project.settings.boltUnify)).toBe(10);
  await expect(page.getByTestId('unify-bolts')).toHaveCount(0);
  await shot(page, 'V136_01_unify');
  expect(errors).toEqual([]);
});

test('V136-02: תמונה ריאליסטית ללקוח', async ({ page }) => {
  const errors = await boot(page);
  const url: string = await page.evaluate(() => (window as any).__ksp.viewport.presentationShot(1200, 750, true));
  expect(url.startsWith('data:image/png')).toBe(true);
  fs.writeFileSync(path.join(EVIDENCE, 'V136_02_client.png'), Buffer.from(url.split(',')[1], 'base64'));
  const dl = page.waitForEvent('download');
  await page.getByTestId('client-image').click();
  const f = await (await dl).path();
  expect(fs.readFileSync(f).subarray(1, 4).toString()).toBe('PNG');
  await page.getByTestId('tab-clad').click();
  await page.getByTestId('nav-w:walls').click();
  await page.getByText('הוספת חיפוי למבנה').first().click();
  const url2: string = await page.evaluate(() => (window as any).__ksp.viewport.presentationShot(1200, 750, true));
  fs.writeFileSync(path.join(EVIDENCE, 'V136_02_client_clad.png'), Buffer.from(url2.split(',')[1], 'base64'));
  await shot(page, 'V136_02_after');
  expect(errors).toEqual([]);
});

test('V136-03: כל הציר / כל הקו מהסרגל ההקשרי; קושרות גג — צמתים על פטות וקונזולה', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => (window as any).__ksp.store.select(['F1.COL.L']));
  await page.getByTestId('ctx-frame').click();
  const sel1: string[] = await page.evaluate(() => (window as any).__ksp.store.state.selection);
  expect(sel1.every((id) => id.startsWith('F1.'))).toBe(true);
  expect(sel1.length).toBeGreaterThanOrEqual(3);
  await page.evaluate(() => (window as any).__ksp.store.select(['F1.COL.L']));
  await page.getByTestId('ctx-line').click();
  const sel2: string[] = await page.evaluate(() => (window as any).__ksp.store.state.selection);
  const nf = await page.evaluate(() => (window as any).__ksp.store.state.project.building.frames.length);
  expect(sel2.length).toBe(nf);
  await shot(page, 'V136_03_line');
  await page.evaluate(() => (window as any).__ksp.store.select([]));
  await page.getByTestId('nav-b:roof').click();
  const add = page.getByTestId('off-roof'); if (await add.count()) await add.click();
  await page.getByTestId('br-split').selectOption('purlins');
  await page.getByTestId('br-toeave').check();
  const r = await page.evaluate(() => (window as any).__ksp.store.state.project.building.bracing.roof);
  expect(r.split).toBe('purlins'); expect(r.toEave).toBe(true);
  await shot(page, 'V136_03_roofx');
  expect(errors).toEqual([]);
});
