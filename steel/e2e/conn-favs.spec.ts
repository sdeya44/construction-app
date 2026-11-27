import { expect, test } from '@playwright/test';
import { boot } from './helpers';

test('FAV-E1: אשף חיבורים — חיפוש, מועדפים (נשמרים בין פתיחות), תצוגה מקדימה במעבר עכבר', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => { const k = (window as any).__ksp; k.store.exec({ label: 't', run: (p: any) => ({ ...p, building: { ...p.building, kneeBraces: { ...(p.building.kneeBraces ?? {}), enabled: true, profile: 'L50x5', drop: 800, reach: 800, angle: 45, plateT: 10, plateW: 150, plateL: 250, bolt: { d: 16, grade: '8.8', standard: 'ISO 4017', clearance: 2 }, gauge: 80, pitch: 200, weldSize: 5, exclude: [] } } }) }); });
  const cid = await page.evaluate(() => (window as any).__ksp.store.state.derived.connections.find((c: any) => c.id.startsWith('C.KB.')).id);
  const open = async () => { await page.evaluate((i) => (window as any).__ksp.store.set({ activeConn: i, connWizard: i }), cid); await expect(page.getByTestId('conn-wizard')).toBeVisible(); };
  await open();
  await page.getByTestId('wiz-all').click();
  const ids = await page.locator('[data-testid^="wiz-c-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.slice(6)));
  expect(ids.length).toBeGreaterThan(2);
  // חיפוש שלא מוצא כלום ← הודעה; ניקוי ← הכל חוזר
  await page.getByTestId('wiz-search').fill('zzzzzz-לא-קיים');
  await expect(page.getByTestId('wiz-empty')).toBeVisible();
  await page.getByTestId('wiz-search').fill('');
  await expect(page.locator('[data-testid^="wiz-c-"]')).toHaveCount(ids.length);
  // מועדף: האחרון עולה לראש; נשמר בסגירה ופתיחה מחדש
  const last = ids[ids.length - 1];
  await page.getByTestId(`wiz-fav-${last}`).click();
  await expect(page.getByTestId(`wiz-fav-${last}`)).toHaveAttribute('aria-pressed', 'true');
  expect((await page.locator('[data-testid^="wiz-c-"]').first().getAttribute('data-testid'))).toBe(`wiz-c-${last}`);
  await page.evaluate(() => (window as any).__ksp.store.set({ connWizard: null }));
  await open();
  await page.getByTestId('wiz-all').click();
  expect((await page.locator('[data-testid^="wiz-c-"]').first().getAttribute('data-testid'))).toBe(`wiz-c-${last}`);
  // תצוגה מקדימה: מעבר עכבר על פרט אחר מחליף את הכותרת; הבחירה בפועל לא משתנה
  const other = ids.find((i) => i !== last)!;
  const before = await page.locator('.wiz-card.on').getAttribute('data-testid');
  await page.getByTestId(`wiz-c-${other}`).hover();
  await expect(page.getByTestId('wiz-hover')).toContainText('תצוגה מקדימה');
  expect(await page.locator('.wiz-card.on').getAttribute('data-testid')).toBe(before);
  // הסרה מהמועדפים
  await page.getByTestId(`wiz-fav-${last}`).click();
  await expect(page.getByTestId(`wiz-fav-${last}`)).toHaveAttribute('aria-pressed', 'false');
  expect(errors).toEqual([]);
});
