import { expect, test } from '@playwright/test';
import { boot } from './helpers';

test('CRPT-E1: ייצור — לשונית "דוח התאמה לחיבורים": שורות, הערת "אינו תכן מאושר", וייצוא CSV', async ({ page }) => {
  const errors = await boot(page);
  await page.getByTestId('mode-production').click();
  await page.getByRole('button', { name: 'דוח התאמה לחיבורים' }).click();
  const rows = page.locator('[data-testid=prod-table] tbody tr');
  expect(await rows.count()).toBeGreaterThan(5);
  await expect(page.locator('[data-testid=prod-table]')).toContainText('אינו תכן מאושר');
  await expect(page.locator('[data-testid=prod-table]')).toContainText('אין ממצאים בבדיקות הגיאומטריה');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-csv').click()]);
  const fs = await import('node:fs');
  const txt = fs.readFileSync(await dl.path()!, 'utf8');
  expect(txt.startsWith('﻿')).toBe(true);
  expect(txt).toContain('אינו תכן מאושר');
  expect(errors).toEqual([]);
});
