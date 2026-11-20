import { expect, test } from '@playwright/test';
import { boot, shot, openNav, openGroup } from './helpers';

const B = (page: any) => page.evaluate(() => (window as any).__ksp.store.state.project.building);
async function editDim(page: any, id: string, v: string) {
  await page.getByTestId(id).first().dispatchEvent('click');
  await page.getByTestId(`${id}-inp`).fill(v); await page.getByTestId(`${id}-inp`).press('Enter');
}

test('V135-01: חיבור המשך פטות בשרטוט; קונזולות, מפלס בסיס וקונזולות פטות על השרטוטים', async ({ page }) => {
  const errors = await boot(page);
  await openNav(page, 'r:splices');
  await editDim(page, 'sch-ps-off', '80');
  expect((await B(page)).purlins.splice.jointOffset).toBe(80);
  await openNav(page, 's:geometry');
  await expect(page.getByTestId('ovh-left')).toHaveCount(0);
  await page.getByTestId('isec-base').dispatchEvent('click');
  await page.getByTestId('isec-input').fill('0.15'); await page.getByTestId('isec-input').press('Enter');
  expect((await B(page)).baseElevation).toBe(150);
  await page.getByTestId('geo-ed-tab-frames').click();
  await editDim(page, 'fs-po-start', '400');
  expect((await B(page)).purlinOverhangStart).toBe(400);
  await page.getByTestId('fs-po-end').first().dispatchEvent('click');
  await expect(page.locator('.schem-unit')).toHaveText('מ"מ');
  await page.keyboard.press('Escape');
  await shot(page, 'V135_01_geometry');
  expect(errors).toEqual([]);
});

test('V135-02: פטות קיר ועמודי רוח בחזית; פנל גג בחתך; כתב כמויות מקובץ', async ({ page }) => {
  const errors = await boot(page);
  await openGroup(page, 'tab-clad');
  await openNav(page, 'w:walls');
  await page.getByText('הוספת חיפוי למבנה').first().click();
  await editDim(page, 'sch-clad-L-g-sp', '1200');
  expect((await B(page)).cladding.girts.spacing).toBe(1200);
  await page.getByTestId('clad-tab-F').click();
  await editDim(page, 'sch-clad-F-p-max', '4000');
  expect((await B(page)).cladding.posts.maxSpacing).toBe(4000);
  await shot(page, 'V135_02_wall');
  await openNav(page, 'w:roof');
  await editDim(page, 'sch-rp-ext', '120');
  expect((await B(page)).cladding.roof.eaveExt).toBe(120);
  await openNav(page, 'w:takeoff');
  const rows = await page.getByTestId('clad-sheets').locator('tbody tr').count();
  expect(rows).toBeLessThanOrEqual(6);
  expect(errors).toEqual([]);
});

test('V135-03: מסבכי גג — בחירה ברצועה וקביעת שדה על השרטוט; עורך חיבור בלשוניות; כנף בציור', async ({ page }) => {
  const errors = await boot(page);
  await openNav(page, 'b:truss');
  if (await page.getByTestId('off-rt-add').count()) await page.getByTestId('off-rt-add').click();
  await expect(page.getByTestId('rt-f-strip')).toBeVisible();
  await page.getByTestId('rt-f-3').click();
  const rt = (await B(page)).roofTruss;
  expect(rt.frames === 'all' || rt.frames.length > 0).toBe(true);
  await page.getByTestId('ks-sec-geo').click(); // 1.58: השרטוט — בגיאומטריה
  const lock = page.locator('[data-testid$="-lock-0"]').first();
  await lock.click();
  await expect(lock).toHaveAttribute('aria-pressed', 'true');
  await openGroup(page, 'tab-conns');
  await openNav(page, 'c:eave');
  await page.getByTestId('cvar-open-eave-0').click();
  await expect(page.getByTestId('pw-bolt')).toBeVisible();
  await page.getByTestId('conn-tab-bolts').click();
  await expect(page.getByTestId('conn-bolts')).toBeVisible();
  await expect(page.getByTestId('pw-bolt')).toHaveCount(0);
  await openNav(page, 'b:wing');
  await expect(page.getByTestId('wing-add-gable').locator('svg')).toBeVisible();
  expect(errors).toEqual([]);
});
