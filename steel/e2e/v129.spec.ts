import { expect, test, type Page } from '@playwright/test';
import { boot, shot } from './helpers';

/** v1.29: קושרת גג במוט הברגה + כיסוי חלקי, נעילה אופקית, מזחלה בפלטה, מכפל, תבניות חדשות, צורת תוכנית */
const state = (page: Page) => page.evaluate(() => {
  const d = (window as any).__ksp.store.state.derived;
  return {
    err: d.issues.filter((i: any) => i.severity === 'error').map((i: any) => i.message) as string[],
    ids: d.members.map((m: any) => m.id) as string[],
    conns: d.connections.map((c: any) => c.id) as string[],
    plan: !!d.plan,
  };
});

test('V129-01 קושרת גג: פרט מוט הברגה + טבלת קטעים', async ({ page }) => {
  const errors = await boot(page);
  await page.getByTestId('nav-b:roof').click();
  await page.getByTestId('br-roof-end').selectOption('rod');
  await page.waitForTimeout(400);
  let s = await state(page);
  expect(s.err).toEqual([]);
  const rods = s.ids.filter((id) => id.endsWith('.ROD')).length;
  expect(rods).toBeGreaterThan(0);
  await expect(page.getByTestId('br-seg-table')).toBeVisible();
  // ביטול קטע אחד במפתח הראשון — פחות מוטות
  await page.locator('[data-testid^="br-seg-0-"]').first().uncheck();
  await page.waitForTimeout(400);
  s = await state(page);
  expect(s.ids.filter((id) => id.endsWith('.ROD')).length).toBeLessThan(rods);
  await shot(page, 'v129-rod');
  expect(errors).toEqual([]);
});

test('V129-02 נעילה אופקית — מסבך + סיב רציף', async ({ page }) => {
  const errors = await boot(page);
  await page.getByTestId('nav-b:walls').click();
  if (!(await page.getByTestId('br-walls').isChecked())) await page.getByTestId('br-walls').check();
  await page.getByTestId('br-walls-truss').click();
  await page.waitForTimeout(400);
  let s = await state(page);
  expect(s.err).toEqual([]);
  expect(s.ids.some((id) => /^LT\..*\.D\d+$/.test(id))).toBe(true);
  await page.getByTestId('lt-pos').selectOption('below');
  await page.getByTestId('lt-conn').selectOption('tongue');
  await page.waitForTimeout(400);
  s = await state(page);
  expect(s.err).toEqual([]);
  expect(errors).toEqual([]);
});

test('V129-03 מכפל ומזחלה בפלטה', async ({ page }) => {
  const errors = await boot(page);
  await page.getByTestId('nav-b:knee').click();
  await page.getByTestId('hn-on').check();
  await page.waitForTimeout(400);
  let s = await state(page);
  expect(s.err).toEqual([]);
  expect(s.conns.some((id) => id.startsWith('C.HN.'))).toBe(true);
  if (!(await page.getByTestId('nav-w:roof').count())) await page.getByTestId('tab-clad').click();
  await page.getByTestId('nav-w:roof').click();
  if (await page.getByTestId('clad-enable').count()) await page.getByTestId('clad-enable').click();
  const g = page.getByTestId('clad-gutter');
  if (!(await g.isChecked())) await g.check();
  await page.getByTestId('gut-support').selectOption('plate');
  await page.getByTestId('gut-dev').selectOption('750');
  await page.waitForTimeout(400);
  s = await state(page);
  expect(s.err).toEqual([]);
  expect(s.ids.some((id) => id.startsWith('C.GB.') && id.endsWith('.PL'))).toBe(true);
  expect(errors).toEqual([]);
});

test('V129-04 צורת תוכנית: מקבילית וטרפז', async ({ page }) => {
  const errors = await boot(page);
  await page.getByTestId('nav-s:geometry').click();
  await page.getByTestId('plan-shape').selectOption('skew');
  await page.waitForTimeout(500);
  let s = await state(page);
  expect(s.plan).toBe(true);
  expect(s.err).toEqual([]);
  await page.getByTestId('plan-shape').selectOption('taper');
  await page.waitForTimeout(500);
  s = await state(page);
  expect(s.plan).toBe(true);
  expect(s.err).toEqual([]);
  await page.evaluate(() => (window as any).__ksp.viewport.fitAll('top'));
  await shot(page, 'v129-taper');
  expect(errors).toEqual([]);
});
