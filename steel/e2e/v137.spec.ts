import { expect, test } from '@playwright/test';
import { boot, shot } from './helpers';

test('V137-01: סדר הקמה, סבולת מספור, חלוקת מפתח לאורך המבנה', async ({ page }) => {
  const errors = await boot(page);
  await page.getByTestId('mode-drawings').click();
  await page.getByTestId('dwg-D-SEQ').click();
  await expect(page.locator('svg text', { hasText: 'סדר הקמה' }).first()).toBeVisible();
  await shot(page, 'V137_01_sequence');
  await page.getByTestId('mode-production').click();
  await page.getByTestId('mark-tol').check();
  expect(await page.evaluate(() => (window as any).__ksp.store.state.project.settings.markTol)).toBe(5);
  await expect(page.getByRole('button', { name: 'סדר הקמה' })).toBeVisible();
  await page.getByRole('button', { name: 'מודל' }).first().click();
  await page.getByTestId('nav-b:roof').click();
  const add = page.getByTestId('off-roof'); if (await add.count()) await add.click();
  await page.getByTestId('br-ysplit').selectOption('3');
  expect(await page.evaluate(() => (window as any).__ksp.store.state.derived.members.filter((m: any) => m.id.startsWith('BR.S')).length)).toBeGreaterThan(0);
  await expect(page.getByTestId('br-strut')).toBeVisible();
  await shot(page, 'V137_01_ysplit');
  expect(errors).toEqual([]);
});

test('V137-02: מסבך נושא בין העמודים — סנפיר שוכב/עומד, פלטה אל פלטה, ללא אנך בקצה', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => (window as any).__ksp.store.select(['F2.COL.L', 'F3.COL.L', 'F4.COL.L']));
  await page.getByTestId('ctx-omit').click();
  await page.getByTestId('omit-apply').click();
  await page.getByTestId('nav-b:tb').click();
  const id = await page.evaluate(() => (window as any).__ksp.store.state.project.building.transfers[0].id);
  await page.getByTestId(`tb-kind-truss-${id}`).click();
  for (const g of ['top', 'bottom']) { await page.getByTestId(`tw-${id}-p-${g}`).fill('RHS120x80x5'); await page.getByTestId(`tw-${id}-p-${g}`).press('Enter'); }
  await page.getByTestId(`tb-fit-between-${id}`).click();
  const st = () => page.evaluate(() => { const d = (window as any).__ksp.store.state.derived; return {
    err: d.issues.filter((i: any) => i.severity === 'error').map((i: any) => i.message),
    fin: d.members.filter((m: any) => /^C\.TBS\..*\.T\.PL$/.test(m.id)).map((m: any) => m.refUp),
    v0: d.members.some((m: any) => /^TB\..*\.TR\.V0$/.test(m.id)), close: d.members.some((m: any) => /^C\.TBS\..*\.CL$/.test(m.id)) }; });
  let s = await st();
  expect(s.err).toEqual([]); expect(s.v0).toBe(false);
  expect(s.fin.length).toBe(2); expect(Math.abs(s.fin[0].z)).toBeCloseTo(1, 5);
  await expect(page.getByTestId('tb-conn-pic')).toBeVisible();
  await page.getByTestId(`tb-orient-vertical-${id}`).click();
  s = await st(); expect(Math.abs(s.fin[0].x)).toBeCloseTo(1, 5);
  await page.getByTestId(`tb-conn-plate-${id}`).click();
  s = await st(); expect(s.fin.length).toBe(0); expect(s.close).toBe(true); expect(s.err).toEqual([]);
  await page.getByTestId(`tb-conn-auto-${id}`).click();
  await page.evaluate(() => (window as any).__ksp.store.select(['F1.COL.L']));
  await page.evaluate(() => (window as any).__ksp.viewport.fitSelection());
  await shot(page, 'V137_02_fin');
  expect(errors).toEqual([]);
});
