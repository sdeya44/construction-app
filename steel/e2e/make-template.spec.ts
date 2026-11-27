import { expect, test } from '@playwright/test';
import { boot } from './helpers';

/** MT — "הפוך לתבנית" מהמודל (שלב 1–2): פלטה נבחרת ← פרט חדש בסטודיו (פלטות + חורים), שגיאה ברורה בלי בחירה */
test('MT-E1: פלטת ראש עמוד נבחרת ← הפוך לתבנית ← הסטודיו נפתח עם פרט (פלטה + חורים + ברגים) ושורת סטטוס', async ({ page }) => {
  const errors = await boot(page);
  const pid = await page.evaluate(() => (window as any).__ksp.store.state.derived.members.find((m: any) => m.kind === 'plate' && m.connId?.startsWith('C.EAVE.'))?.id);
  await page.evaluate((i) => (window as any).__ksp.store.select([i]), pid);
  await expect(page.getByTestId('make-template')).toBeVisible();
  await page.getByTestId('make-template').click();
  await expect(page.getByTestId('detail-studio')).toBeVisible();
  await expect(page.getByTestId('ds-status')).toContainText('נוצר פרט מפלטות שנבחרו במודל');
  const ops = page.getByTestId('ds-ops').locator('li');
  expect(await ops.count()).toBeGreaterThanOrEqual(2); // פלטה + קבוצת חורים
  await expect(ops.first()).toContainText('פלטה');
  await expect(page.getByTestId('ds-ops')).toContainText('חורים');
  await expect(page.getByTestId('ds-ops')).toContainText('ברגים'); // שלב 2: bolts מתוך החורים
  // הטיוטה נוקתה מה-store (לא נטענת שוב בפתיחה הבאה)
  expect(await page.evaluate(() => (window as any).__ksp.store.state.studioDraft ?? null)).toBeNull();
  expect(errors.filter((e) => !/WebGL|GPU|swiftshader/i.test(e))).toEqual([]);
});
