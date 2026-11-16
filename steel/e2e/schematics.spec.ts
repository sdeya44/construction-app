import { expect, test } from '@playwright/test';
import { boot, shot } from './helpers';

const st = (page: any) => page.evaluate(() => (window as any).__ksp.store.state.project.building);
async function editDim(page: any, id: string, v: string) {
  await page.getByTestId(id).first().dispatchEvent('click');
  await page.getByTestId(`${id}-inp`).fill(v); await page.getByTestId(`${id}-inp`).press('Enter');
}

test('SCH-01: שרטוטים אינטראקטיביים — פטות, תומך, רכס, קושרות, פח, חיפוי', async ({ page }) => {
  await boot(page);
  // פטות: מרחק ראשון ומרווח
  await page.getByTestId('nav-r:left').click();
  await expect(page.getByTestId('sch-purlins-left')).toBeVisible();
  await editDim(page, 'sch-left-s0', '350');
  expect((await st(page)).purlins.left.first).toBe(350);
  await editDim(page, 'sch-left-cl-base', '90');
  expect((await st(page)).purlins.left.cleat.base).toBe(90);
  await shot(page, 'SCH_01_purlins');
  // רכס
  await page.getByTestId('nav-b:ridge').click();
  await page.getByTestId('ridge-reinf').selectOption('plate');
  await editDim(page, 'sch-rr-depth', '200');
  expect((await st(page)).ridgeReinf.depth).toBe(200);
  await shot(page, 'SCH_02_ridge');
  // קושרות גג — מפתח בלחיצה; פח חיבור
  await page.getByTestId('nav-b:roof').click();
  const before = (await st(page)).bracing.roof.bays.length;
  await page.getByTestId('sch-roof-bays-2').click();
  expect((await st(page)).bracing.roof.bays.length).not.toBe(before);
  await editDim(page, 'sch-brc-end', '35');
  expect((await st(page)).bracing.conn.endDist).toBe(35);
  await shot(page, 'SCH_03_roofX');
  // חיפוי קיר
  await page.getByTestId('tab-clad').click();
  await page.getByTestId('nav-w:walls').click();
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
  await page.getByTestId('nav-b:truss').click();
  await page.getByTestId('rt-on').check();
  await page.getByTestId('rt-shape').selectOption('scissor');
  await editDim(page, 'tw-roof-rise', '800');
  expect((await st(page)).roofTruss.rise).toBe(800);
  const errs = await page.evaluate(() => (window as any).__ksp.store.state.derived.issues.filter((i: any) => i.severity === 'error').map((i: any) => i.message));
  expect(errs).toEqual([]);
  await shot(page, 'SCH_05_scissor');
});
