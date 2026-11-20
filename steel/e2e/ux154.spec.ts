import { expect, test } from '@playwright/test';
import { boot, openNav } from './helpers';

test('UX154-01: מצב רגיל — פאנל סגור והמודל ברוב המסך; ריבון פותח כלי; ✕ סוגר', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__ksp?.viewport?.model);
  const vpW = () => page.getByTestId('viewport').evaluate((e) => e.getBoundingClientRect().width);
  const wsW = await page.locator('.workspace').evaluate((e) => e.getBoundingClientRect().width);
  await expect(page.getByTestId('props')).toBeHidden();
  expect((await vpW()) / wsW).toBeGreaterThan(0.9);
  // ריבון: לשונית ← כלי ← הפאנל נפתח עם העורך
  await page.getByTestId('tab-brace').click();
  await page.getByTestId('nav-b:walls').click();
  await expect(page.getByTestId('props')).toBeVisible();
  await expect(page.getByTestId('lp-nav-content')).toContainText('קשיחות');
  await page.getByTestId('lp-close').click();
  await expect(page.getByTestId('props')).toBeHidden();
  // בחירה במודל פותחת את הפאנל
  await page.evaluate(() => (window as any).__ksp.store.select(['F2.COL.L']));
  await expect(page.getByTestId('props-single')).toBeVisible();
});

test('UX154-02: כיווץ ריבון; סרגל ההתקדמות — לחיצה על שלב פותחת את הכלי שלו', async ({ page }) => {
  const errors = await boot(page);
  await expect(page.getByTestId('ribbon')).toBeVisible();
  await page.getByTestId('ribbon-toggle').click();
  await expect(page.locator('.rb-tools')).toHaveCount(0);
  await page.getByTestId('ribbon-toggle').click();
  await expect(page.locator('.rb-tools')).toHaveCount(1);
  // שלב 8 = קשיחות קירות
  await page.getByTestId('sr-8').click();
  await expect(page.getByTestId('tab-brace')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('nav-b:walls')).toHaveClass(/on/);
  // רשימת השלבים
  await page.getByTestId('sr-ring').click();
  await expect(page.getByTestId('sr-pop')).toContainText('16');
  await openNav(page, 's:geometry');
  await expect(page.getByTestId('tab-structure')).toHaveAttribute('aria-selected', 'true');
  expect(errors).toEqual([]);
});

test('UX154-03: גובה הריבון קבוע בכל הלשוניות (המודל לא "קופץ")', async ({ page }) => {
  await boot(page);
  const h = () => page.getByTestId('ribbon').evaluate((e) => Math.round(e.getBoundingClientRect().height));
  const hs: number[] = [];
  for (const t of ['tab-structure', 'tab-roof', 'tab-brace', 'tab-clad', 'tab-tree', 'tab-conns', 'tab-issues']) { await page.getByTestId(t).click(); hs.push(await h()); }
  expect(new Set(hs).size).toBe(1);
});
