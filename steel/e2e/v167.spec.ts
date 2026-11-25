import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { boot, openNav } from './helpers';

test('LIB-E1: ספריית מחברים — הוספת 7 המחברים המוכנים, ייצוא לקובץ וייבוא חזרה', async ({ page }) => {
  await boot(page);
  await openNav(page, 'c:library');
  await expect(page.getByTestId('detail-library')).toBeVisible();
  await page.getByTestId('lib-add-builtin').click();
  await expect(page.getByTestId('lib-msg')).toContainText('נוספו 7');
  await expect(page.locator('[data-testid^="lib-row-"]')).toHaveCount(7);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('lib-export').click()]);
  const txt = readFileSync((await dl.path())!, 'utf8');
  expect(JSON.parse(txt).details.length).toBe(7);
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('lib-import').click()]);
  await fc.setFiles({ name: 'lib.json', mimeType: 'application/json', buffer: Buffer.from(txt) });
  await expect(page.getByTestId('lib-msg')).toContainText('יובאו 7');
  await expect(page.locator('[data-testid^="lib-row-"]')).toHaveCount(14);
  // קובץ פגום — הודעה ברורה, הספרייה לא משתנה
  const [fc2] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('lib-import').click()]);
  await fc2.setFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"a":1}') });
  await expect(page.getByTestId('lib-msg')).toContainText('אינו ספריית מחברים');
  await expect(page.locator('[data-testid^="lib-row-"]')).toHaveCount(14);
});
