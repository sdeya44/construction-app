import { expect, test } from '@playwright/test';
import { boot, shot, openNav, openGroup } from './helpers';

const st = (page: any) => page.evaluate(() => (window as any).__ksp.store.state.project.building);
async function editDim(page: any, id: string, v: string) {
  await page.getByTestId(id).first().dispatchEvent('click');
  await page.getByTestId(`${id}-inp`).fill(v); await page.getByTestId(`${id}-inp`).press('Enter');
}

test('SCH-01: שרטוטים אינטראקטיביים — פטות, תומך, רכס, קושרות, פח, חיפוי', async ({ page }) => {
  await boot(page);
  // פטות: מרחק ראשון ומרווח
  await openNav(page, 'r:left');
  await expect(page.getByTestId('sch-purlins-left')).toBeVisible();
  await editDim(page, 'sch-left-s0', '350');
  expect((await st(page)).purlins.left.first).toBe(350);
  await page.getByTestId('ks-sec-conn').click(); // 1.58: תושבות — בחתך ומחברים
  await editDim(page, 'sch-left-cl-base', '90');
  expect((await st(page)).purlins.left.cleat.base).toBe(90);
  await shot(page, 'SCH_01_purlins');
  // רכס
  await openNav(page, 'b:ridge');
  await page.getByTestId('ridge-type-plate').click(); await page.getByTestId('ks-sec-geo').click(); // 1.58
  await editDim(page, 'sch-rr-depth', '200');
  expect((await st(page)).ridgeReinf.depth).toBe(200);
  await shot(page, 'SCH_02_ridge');
  // קושרות גג — מפתח בלחיצה; פח חיבור
  await openNav(page, 'b:roof');
  const before = (await st(page)).bracing.roof.bays.length;
  await page.getByTestId('br-grid-2-L').click();
  expect((await st(page)).bracing.roof.bays.length).not.toBe(before);
  await page.getByTestId('ks-sec-conn').click();
  await editDim(page, 'sch-brc-end', '35');
  expect((await st(page)).bracing.conn.endDist).toBe(35);
  await shot(page, 'SCH_03_roofX');
  // חיפוי קיר
  await openGroup(page, 'tab-clad');
  await openNav(page, 'w:walls');
  if (await page.getByTestId('clad-enable').count()) await page.getByTestId('clad-enable').click();
  if (!(await page.getByTestId('clad-walls').isChecked())) await page.getByTestId('clad-walls').check();
  if (!(await page.getByTestId('clad-side-L').isChecked())) await page.getByTestId('clad-side-L').check();
  await page.getByTestId('sch-clad-L-bay-1').click();
  expect((await st(page)).cladding.walls.per.L.bays[1]).toBe(false);
  await editDim(page, 'sch-clad-L-bottom', '300');
  expect((await st(page)).cladding.walls.per.L.bottom).toBe(300);
  await shot(page, 'SCH_04_clad');
  const errs = await page.evaluate(() => (window as any).__ksp.store.state.derived.issues.filter((i: any) => i.severity === 'error').length);
  expect(errs).toBe(0);
});

test('SCH-02: מסבך "מספריים" — הגבהה בלחיצה; גיליון מכלול שני לרשימת חלקים', async ({ page }) => {
  await boot(page);
  await openNav(page, 'b:truss');
  await page.getByTestId('rt-on').check();
  await page.getByTestId('ks-sec-geo').click(); // 1.58: צורה ואשף המסבך — בגיאומטריה
  await page.getByTestId('rt-shape').selectOption('scissor');
  await editDim(page, 'tw-roof-rise', '800');
  expect((await st(page)).roofTruss.rise).toBe(800);
  const errs = await page.evaluate(() => (window as any).__ksp.store.state.derived.issues.filter((i: any) => i.severity === 'error').map((i: any) => i.message));
  expect(errs).toEqual([]);
  await shot(page, 'SCH_05_scissor');
});

test('SCH-03: הגדלת שרטוט, עריכה בחלון המוגדל; פתחים בקיר על השרטוט', async ({ page }) => {
  await boot(page);
  await openNav(page, 'r:left');
  await page.getByTestId('sch-purlins-left-zoom').click();
  await expect(page.getByTestId('sch-purlins-left-big')).toBeVisible();
  await page.getByTestId('sch-purlins-left-L').getByTestId('sch-left-s0').dispatchEvent('click');
  await page.getByTestId('sch-purlins-left-L').getByTestId('sch-left-s0-inp').fill('420');
  await page.getByTestId('sch-purlins-left-L').getByTestId('sch-left-s0-inp').press('Enter');
  expect((await st(page)).purlins.left.first).toBe(420);
  await shot(page, 'SCH_06_zoom');
  await page.getByTestId('sch-purlins-left-close').click();
  // פתחים
  await openGroup(page, 'tab-clad');
  await openNav(page, 'w:openings');
  if (await page.getByTestId('clad-enable').count()) await page.getByTestId('clad-enable').click();
  await page.getByTestId('op-add-door').click();
  await expect(page.getByTestId('sch-op-F')).toBeVisible();
  await page.getByTestId('sch-op-F').getByTestId('sch-op-F-w').dispatchEvent('click');
  await page.getByTestId('sch-op-F-w-inp').fill('5000'); await page.getByTestId('sch-op-F-w-inp').press('Enter');
  expect((await st(page)).cladding.openings[0].width).toBe(5000);
  await shot(page, 'SCH_07_openings');
});
