import { expect, test } from '@playwright/test';
import { boot } from './helpers';

test('UX154-01: מצב רגיל — פאנל סגור והמודל ברוב המסך; שלב פותח כלי; ✕ סוגר', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__ksp?.viewport?.model);
  const vpW = () => page.getByTestId('viewport').evaluate((e) => e.getBoundingClientRect().width);
  const wsW = await page.locator('.workspace').evaluate((e) => e.getBoundingClientRect().width);
  await expect(page.getByTestId('props')).toBeHidden();
  expect((await vpW()) / wsW).toBeGreaterThan(0.85); // 1.59: סרגל השלבים עם שמות (188px) — מכווץ: מעל 0.95
  // כלי ← הפאנל נפתח עם העורך (1.61: מסרגל השלבים)
  await page.getByTestId('sr-8').click();
  await expect(page.getByTestId('props')).toBeVisible();
  await expect(page.getByTestId('walls-studio')).toBeVisible();
  // 1.55: קשיחות קירות נפתחת בחלון רכיב — ה-✕ שלו סוגר
  await page.getByTestId('cwin-close').click();
  await expect(page.getByTestId('props')).toBeHidden();
  // בחירה במודל פותחת את הפאנל
  await page.evaluate(() => (window as any).__ksp.store.select(['F2.COL.L']));
  await expect(page.getByTestId('cwin-element')).toBeVisible(); // 1.64: אלמנט — אותו חלון צף
  await expect(page.getByTestId('pscope-hint')).toBeVisible(); // בלי היקף שמור — קודם בוחרים על מה לעבוד
});

test('UX154-02 (1.61): אין ריבון — סרגל השלבים: שלב פותח את האשף שלו, "כלים" פותחים רשימות/גיליון/ספרייה; 16 שלבים, כיווץ', async ({ page }) => {
  const errors = await boot(page);
  await expect(page.getByTestId('ribbon')).toHaveCount(0);
  await expect(page.locator('.rb-tools, .rb-tabs')).toHaveCount(0);
  // שלב 8 = קשיחות קירות — האשף
  await page.getByTestId('sr-8').click();
  await expect(page.getByTestId('cwin-walls')).toBeVisible();
  await expect(page.getByTestId('sr-8')).toHaveClass(/on/);
  await expect(page.getByTestId('steps-rail').locator('.sr-item:not(.tool)')).toHaveCount(16);
  await expect(page.getByTestId('sr-8')).toContainText('קשיחות קירות');
  await page.getByTestId('sr-fold').click();
  await expect(page.getByTestId('sr-8')).not.toContainText('קשיחות קירות');
  await page.getByTestId('sr-fold').click();
  // כלים: רשימות — אלמנטים (בחירה במודל), חיבורים (פתיחת עורך), בדיקות
  await page.getByTestId('sr-tool-lists').click();
  await expect(page.getByTestId('lists-panel')).toBeVisible();
  await page.getByTestId('lists-kind-column').click();
  await page.getByTestId('table-column').getByText('F2.COL.L', { exact: true }).click();
  expect(await page.evaluate(() => (window as any).__ksp.store.state.selection)).toEqual(['F2.COL.L']);
  await page.getByTestId('sr-tool-lists').click();
  await page.getByTestId('lists-tab-conn').click();
  await page.getByTestId('lists-ctype-eave').click();
  await page.getByTestId('ctable-eave').locator('tr[title="C.EAVE.F2.L"]').click();
  await expect(page.getByTestId('conn-id')).toHaveText('C.EAVE.F2.L');
  await page.getByTestId('sr-tool-lists').click();
  await page.getByTestId('lists-tab-iss').click();
  // גיליון פרמטרים וספריית פרטים
  await page.getByTestId('sr-tool-s:sheet').click();
  await expect(page.getByTestId('lp-nav-content')).toBeVisible();
  await page.getByTestId('sr-tool-c:library').click();
  await expect(page.getByTestId('lp-nav-content')).toBeVisible();
  expect(errors).toEqual([]);
});

test('UX154-03 (1.61): בלי ריבון — המודל מתחיל מתחת לפס העליון בלבד (יותר גובה)', async ({ page }) => {
  await boot(page);
  const top = await page.getByTestId('viewport').evaluate((e) => Math.round(e.getBoundingClientRect().top));
  const bar = await page.locator('.topbar').evaluate((e) => Math.round(e.getBoundingClientRect().bottom));
  expect(top - bar).toBeLessThan(4);
});
