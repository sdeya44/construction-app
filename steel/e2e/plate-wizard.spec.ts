import { expect, test } from '@playwright/test';
import { boot, shot } from './helpers';

test('PW-01: לחיצה על פלטת ראש עמוד — אשף פלטה: שרטוט, מידה בלחיצה משנה את כל הפלטות; סטנדרט מסגריה', async ({ page }) => {
  await boot(page);
  const pid = await page.evaluate(() => (window as any).__ksp.store.state.derived.members.find((m: any) => m.kind === 'plate' && m.connId?.startsWith('C.EAVE.'))?.id);
  await page.evaluate((i) => (window as any).__ksp.store.select([i]), pid);
  await page.getByTestId('open-plate-studio').click(); // אשף הפלטה — בסטודיו
  await expect(page.getByTestId('plate-wizard')).toBeVisible();
  await expect(page.getByTestId('pw-why')).toContainText('רוחב');
  await shot(page, 'PW_01_eave');
  // מרווח בין עמודות הברגים (הקטע האמצעי בשרשרת לרוחב)
  await page.getByTestId('pw-sch').getByTestId('pw-y1').click();
  await page.getByTestId('pw-y1-inp').fill('210'); await page.getByTestId('pw-y1-inp').press('Enter');
  const e = await page.evaluate(() => (window as any).__ksp.store.state.project.connectionDefaults.eave);
  expect(e.gauge).toBe(210);
  expect(e.w).toBe(290);
  await page.getByTestId('pw-save-std').click();
  await expect(page.getByTestId('pw-msg')).toContainText('נשמר');
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem('ksp-shop-standard') ?? 'null'));
  expect(st.connectionDefaults.eave.gauge).toBe(210);
});

test('PW-02: פלטת בסיס ופח אלכסון — אשף עם שרטוט ושדות', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { const k = (window as any).__ksp; const m = k.store.state.derived.members.find((x: any) => x.kind === 'plate' && x.connId?.startsWith('C.BASE.')); k.store.select([m.id]); });
  await page.getByTestId('open-plate-studio').click();
  await expect(page.getByTestId('plate-wizard')).toBeVisible();
  await shot(page, 'PW_02_base');
  await page.getByTestId('ds-close').first().click();
  await page.evaluate(() => { const k = (window as any).__ksp; const m = k.store.state.derived.members.find((x: any) => x.kind === 'plate' && x.connId?.includes('.BR.') ); k.store.select([m.id]); });
  await page.getByTestId('open-plate-studio').click();
  await expect(page.getByTestId('pw-br-t')).toBeVisible();
});
