import { expect, test } from '@playwright/test';
import { boot } from './helpers';

test('NEST-E1: ייצור — ניסטינג ללייזר: חישוב, סיכום ניצולת, תצוגת לוח, הערת "אינו מאומת מול מכונה", הורדת DXF (ZIP) ו-Excel', async ({ page }) => {
  const errors = await boot(page);
  // שם ASCII: Chromium headless מחזיר "download" לשם קובץ עברי בהורדת blob (גם בייצוא DSTV) — תופעת בדיקה, לא תוכנה
  await page.evaluate(() => { const st = (window as any).__ksp.store; st.set({ project: { ...st.state.project, meta: { ...st.state.project.meta, name: 'NestProj' } } }); });
  await page.getByTestId('mode-production').click();
  await page.getByTestId('export-nest').click();
  await expect(page.getByTestId('nest-dialog')).toBeVisible();
  await expect(page.getByTestId('nest-note')).toContainText('אינו מאומת מול מכונה');
  await expect(page.getByTestId('nest-count')).toContainText('סימוני פלטות');
  await page.getByTestId('nest-run').click();
  await expect(page.getByTestId('nest-result')).toBeVisible();
  await expect(page.getByTestId('nest-sheets')).toContainText('לוחות');
  await expect(page.getByTestId('nest-util')).toContainText('%');
  await expect(page.getByTestId('nest-unplaced')).toHaveCount(0);
  expect(await page.locator('[data-testid=nest-table] tbody tr').count()).toBeGreaterThan(1);
  expect(await page.locator('[data-testid=nest-svg] polygon').count()).toBeGreaterThan(0);
  const [zip] = await Promise.all([page.waitForEvent('download'), page.getByTestId('nest-zip').click()]);
  expect(zip.suggestedFilename()).toMatch(/\.zip$/);
  const fs = await import('node:fs');
  const buf = fs.readFileSync(await zip.path()!);
  expect(buf.subarray(0, 2).toString()).toBe('PK');
  const [xl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('nest-xlsx').click()]);
  expect(xl.suggestedFilename()).toMatch(/\.xlsx$/);
  // לוח קטן מדי לחלק ⇒ "לא הונחו" עם סיבה
  await page.getByTestId('nest-w').fill('150'); await page.getByTestId('nest-h').fill('150');
  await page.getByTestId('nest-run').click();
  await expect(page.getByTestId('nest-unplaced')).toBeVisible();
  await expect(page.getByTestId('nest-unplaced-row').first()).toContainText('גדול מהלוח');
  expect(errors).toEqual([]);
});
