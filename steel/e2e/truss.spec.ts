import { expect, test } from '@playwright/test';
import { boot, shot } from './helpers';

test('TR-01: מסבכי גג — הפעלה, עריכת שדה וצומת בלחיצה, גובה בלחיצה, ללא שגיאות', async ({ page }) => {
  await boot(page);
  await page.getByTestId('nav-b:truss').click();
  await page.getByTestId('rt-on').check();
  const st = () => page.evaluate(() => { const d = (window as any).__ksp.store.state.derived; return { err: d.issues.filter((i: any) => i.severity === 'error').map((i: any) => i.message), webs: d.members.filter((m: any) => m.id.startsWith('TR.')).length }; });
  let s = await st();
  expect(s.err).toEqual([]);
  expect(s.webs).toBeGreaterThan(30);
  await page.getByTestId('tw-roof-cell-1').click();
  await page.getByTestId('tw-roof-node-2').click();
  await page.getByTestId('tw-roof-sch').getByTestId('tw-roof-depth').click();
  await page.getByTestId('tw-roof-depth-inp').fill('1300'); await page.getByTestId('tw-roof-depth-inp').press('Enter');
  const spec = await page.evaluate(() => (window as any).__ksp.store.state.project.building.roofTruss.spec);
  expect(spec.depth).toBe(1300);
  expect(spec.pattern).toBe('custom');
  s = await st();
  expect(s.err).toEqual([]);
  await shot(page, 'TR_01_roof');
  // לחיצה על מוט מסבך בתלת-ממד — האשף בפאנל המאפיינים
  await page.evaluate(() => { const k = (window as any).__ksp; k.store.select([k.store.state.derived.members.find((m: any) => m.id.startsWith('TR.')).id]); });
  await expect(page.getByTestId('hub-settings')).toContainText('מסבך');
});

test('TR-02: מסבך נושא בדילול עמודים — מעבר "מסבך", חיבור המשך ידני, ללא שגיאות', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => (window as any).__ksp.store.select(['F2.COL.L', 'F3.COL.L', 'F4.COL.L']));
  await page.getByTestId('ctx-omit').click();
  await page.getByTestId('omit-apply').click();
  await page.getByTestId('nav-b:tb').click();
  const id = await page.evaluate(() => (window as any).__ksp.store.state.project.building.transfers[0].id);
  await page.getByTestId(`tb-kind-truss-${id}`).click();
  await expect(page.getByTestId(`tw-${id}`)).toBeVisible();
  const err = () => page.evaluate(() => (window as any).__ksp.store.state.derived.issues.filter((i: any) => i.severity === 'error').map((i: any) => i.message));
  expect(await err()).toEqual([]);
  await page.getByTestId(`tw-${id}-splice`).selectOption('manual');
  await page.getByTestId(`tw-${id}-spl-3`).click();
  expect(await err()).toEqual([]);
  expect(await page.evaluate(() => (window as any).__ksp.store.state.derived.connections.filter((c: any) => c.id.startsWith('C.RS.TB')).length)).toBe(2);
  await shot(page, 'TR_02_tb');
});
