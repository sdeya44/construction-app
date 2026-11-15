import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { boot, shot } from './helpers';

test('קטלוג חתכים: ייבוא CSV, מיפוי, השוואה, שמירה — החתך מסומן "מאומת"; ייצוא DSTV', async ({ page }) => {
  await boot(page);
  page.on('dialog', (d) => d.accept());
  const csv = 'e2e-results/evidence/catalog.csv';
  fs.writeFileSync(csv, '﻿חתך,h,b,tw,tf,r,A,G,Iy,Iz,Wy\nIPE 300,300,150,7.1,10.7,15,53.81,42.2,8356,603.8,557.1\nHEA 200,190,200,6.5,10,18,53.83,42.3,3692,1336,388.6\n');
  await page.getByTestId('btn-catalog').click();
  const fc = page.waitForEvent('filechooser');
  await page.getByTestId('cat-load').click();
  await (await fc).setFiles(csv);
  await expect(page.getByTestId('map-name')).toHaveValue('0');
  await page.getByTestId('cat-build').click();
  await expect(page.getByTestId('cat-compare')).toContainText('IPE300');
  await shot(page, 'CATALOG_compare');
  await page.getByTestId('cat-save').click();
  await page.evaluate(() => (window as any).__ksp.store.select(['F2.RAF.L']));
  await expect(page.getByTestId('prof-verified')).toBeVisible();
  const w = await page.evaluate(() => (window as any).__ksp.store.state.derived.byId.get('F2.RAF.L').profile);
  expect(w).toBe('IPE300');
  // נשמר אחרי טעינה מחדש
  await page.reload();
  await page.waitForFunction(() => !!(window as any).__ksp?.viewport?.model);
  await page.evaluate(() => (window as any).__ksp.store.select(['F2.COL.L']));
  await expect(page.getByTestId('prof-verified')).toBeVisible();
  // DSTV
  await page.getByTestId('mode-production').click();
  await page.getByTestId('run-numbering').click();
  const dl = page.waitForEvent('download');
  await page.getByTestId('export-dstv').click();
  const f = await dl;
  await f.saveAs('e2e-results/evidence/dstv.zip');
  const files = unzipSync(new Uint8Array(fs.readFileSync('e2e-results/evidence/dstv.zip')));
  expect(Object.keys(files).length).toBeGreaterThan(5);
  expect(Object.values(files).every((b) => strFromU8(b).startsWith('ST'))).toBe(true);
});
