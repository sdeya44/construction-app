import { expect, test } from '@playwright/test';
import { boot, openNav, shot } from './helpers';

test('MATE-E1: סטודיו — "פלטה זהה מעליה" ו"הצמד את קצה האלמנט אליה" בלחיצה, בלי נוסחאות', async ({ page }) => {
  const errors = await boot(page);
  await openNav(page, 'b:knee'); await page.getByTestId('kb-on').check();
  await page.evaluate(() => (window as any).__ksp.store.select(['KB.F2.L.L.R']));
  await page.getByTestId('ks-sec-conn').click(); await page.getByTestId('ks-sec-conn').click(); await page.getByTestId('cb-lib').click(); await page.getByTestId('studio-start').click();
  await expect(page.getByTestId('detail-studio')).toBeVisible();
  const site = await page.evaluate(() => { const S = (window as any).__kspStudio; return S.screenOf(S.site()); });
  // פלטה על המארח (ברירת מחדל מהחתך: הגדול מבין + 20)
  await page.getByTestId('ds-tool-plate:rect').click();
  await page.mouse.click(site.x - 25, site.y + 40);
  await expect(page.getByTestId('ds-op-P1')).toBeVisible();
  await expect(page.getByTestId('ds-P1-w')).toHaveValue('max(mb, hb) + 20');
  await page.getByTestId('ds-mate-stack').click();
  await expect(page.getByTestId('ds-op-P2')).toBeVisible();
  await expect(page.getByTestId('ds-P2-w')).toHaveValue('P1.w');
  await page.getByTestId('ds-op-P2').click();
  await page.getByTestId('ds-mate-flush').click();
  await expect(page.getByTestId('ds-op-C1')).toBeVisible();
  await expect(page.getByTestId('ds-C1-at')).toHaveValue('P1.t + P2.t');
  await shot(page, 'MATE_E1');
  // הצמדה על פלטה שלא על המארח — הודעה, בלי שינוי
  expect(errors).toEqual([]);
});
