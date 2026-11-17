import { expect, test } from '@playwright/test';
import { boot, shot } from './helpers';

test('KB-02: אלכסוני עמוד-קורה — הגדרה לכל צד: ביטול צד ושינוי ירידה בצד אחר', async ({ page }) => {
  await boot(page);
  await page.getByTestId('nav-b:knee').click();
  await page.getByTestId('kb-on').check();
  await expect(page.getByTestId('kb-sides')).toBeVisible();
  const n = () => page.evaluate(() => (window as any).__ksp.store.state.derived.members.filter((m: any) => m.id.startsWith('KB.')).length);
  const n0 = await n();
  await page.getByTestId('kb-side-on-L.L.R').uncheck();
  expect(await n()).toBe(n0 - n0 / 2);
  const inp = page.getByTestId('kb-side-drop-R.R.L');
  await inp.fill('1200'); await inp.press('Enter');
  const ov = await page.evaluate(() => (window as any).__ksp.store.state.project.building.kneeBraces.sides);
  expect(ov['R.R.L'].drop).toBe(1200);
  await shot(page, 'KB_02_sides');
  await page.getByTestId('kb-side-reset-L.L.R').click();
  expect(await n()).toBe(n0);
});

test('HUB-01: לחיצה על עמוד — חתך (סוג ← מידה) עם היקף "כל העמודים" + הגדרות הגיאומטריה באותו פאנל', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => (window as any).__ksp.store.select(['F2.COL.L']));
  await expect(page.getByTestId('hub-settings')).toBeVisible();
  await page.getByTestId('scope-all').click();
  await page.getByTestId('prop-profile-family').selectOption('HEB');
  await page.getByTestId('prop-profile-size').selectOption('HEB200');
  await shot(page, 'HUB_01_column');
  const p = await page.evaluate(() => [...new Set((window as any).__ksp.store.state.derived.members.filter((m: any) => m.kind === 'column').map((m: any) => m.profile))]);
  expect(p).toEqual(['HEB200']);
});

test('HUB-02: לחיצה על אלכסון אגד B — שרטוט סכמטי עם מידות לעריכה בלחיצה', async ({ page }) => {
  await boot(page);
  await page.getByTestId('nav-b:walls').click();
  await page.getByTestId('br-walls-portal').click();
  await page.getByTestId('nav-b:knee').click(); // תפריט אחר פתוח — ההגדרות של האגד בפאנל האלמנט
  const id = await page.evaluate(() => (window as any).__ksp.store.state.derived.members.find((m: any) => m.id.startsWith('BB.'))?.id);
  await page.evaluate((i) => (window as any).__ksp.store.select([i]), id);
  await expect(page.getByTestId('hub-settings')).toBeVisible();
  await page.getByTestId('hub-settings').getByTestId('sch-pb-drop').click();
  await page.getByTestId('sch-pb-drop-inp').fill('900'); await page.getByTestId('sch-pb-drop-inp').press('Enter');
  expect(await page.evaluate(() => (window as any).__ksp.store.state.project.building.bracing.walls.portal.drop)).toBe(900);
  await page.getByTestId('hub-settings').getByTestId('sch-pb-angle').click();
  await page.getByTestId('sch-pb-angle-inp').fill('40'); await page.getByTestId('sch-pb-angle-inp').press('Enter');
  expect(await page.evaluate(() => (window as any).__ksp.store.state.project.building.bracing.walls.portal.angle)).toBe(40);
  await shot(page, 'HUB_02_portal');
});

test('HUB-03: שינוי חתך מפאנל אלכסון — "רק האלמנט הזה" ו"כל האלכסונים" עובדים; קושרת גג משנה את כל הקושרות', async ({ page }) => {
  const errors = await boot(page);
  await page.getByTestId('nav-b:knee').click();
  await page.getByTestId('kb-on').check();
  const prof = (id: string) => page.evaluate((i) => (window as any).__ksp.store.state.derived.byId.get(i)?.profile, id);
  await page.evaluate(() => (window as any).__ksp.store.select(['KB.F2.L.L.R']));
  await page.getByTestId('scope-one').click();
  await page.getByTestId('prop-profile-family').selectOption('SHS');
  await page.getByTestId('prop-profile-size').selectOption('SHS100x5');
  expect(await prof('KB.F2.L.L.R')).toBe('SHS100x5');
  expect(await prof('KB.F3.L.L.R')).toBe('RHS80x80x4');
  await page.evaluate(() => (window as any).__ksp.store.select(['KB.F3.L.L.R']));
  await page.getByTestId('scope-all').click();
  await page.getByTestId('prop-profile-family').selectOption('SHS');
  await page.getByTestId('prop-profile-size').selectOption('SHS90x4');
  const all = await page.evaluate(() => [...new Set((window as any).__ksp.store.state.derived.members.filter((m: any) => m.id.startsWith('KB.')).map((m: any) => m.profile))]);
  expect(all).toEqual(['SHS90x4']);
  // קושרת גג
  const br = await page.evaluate(() => (window as any).__ksp.store.state.derived.members.find((m: any) => m.id.startsWith('BR.R'))?.id);
  await page.evaluate((i) => (window as any).__ksp.store.select([i]), br);
  await page.getByTestId('prop-profile-family').selectOption('L');
  await page.getByTestId('prop-profile-size').selectOption('L60x6');
  const roof = await page.evaluate(() => [...new Set((window as any).__ksp.store.state.derived.members.filter((m: any) => m.id.startsWith('BR.R')).map((m: any) => m.profile))]);
  expect(roof).toEqual(['L60x6']);
  await shot(page, 'HUB_03_brace_profile');
  expect(errors).toEqual([]);
});
