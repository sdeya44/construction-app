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
  await expect(page.getByTestId('br-roof-grid')).toBeVisible();
  // תא קיים (מפתח 1, שיפוע שמאל): X אחד → שניים — יותר מוטות; עוד שתי לחיצות → ללא
  await page.getByTestId('br-grid-0-L').click();
  await page.waitForTimeout(400);
  s = await state(page);
  expect(s.err).toEqual([]);
  expect(s.ids.filter((id) => id.endsWith('.ROD')).length).toBeGreaterThan(rods);
  await page.getByTestId('br-grid-0-L').click();
  await page.getByTestId('br-grid-0-L').click();
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

test('V129-05 חלון מכלול: נעילה אופקית — צורה לציר אחד, תמונה; אשף פלטה בסטודיו', async ({ page }) => {
  const errors = await boot(page);
  await page.getByTestId('nav-b:walls').click();
  if (!(await page.getByTestId('br-walls').isChecked())) await page.getByTestId('br-walls').check();
  await page.getByTestId('br-walls-truss').click();
  await page.waitForTimeout(400);
  const chord = await page.evaluate(() => (window as any).__ksp.store.state.derived.members.find((m: any) => /^LT\.\d+\.L\.S$/.test(m.id))?.id);
  expect(chord).toBeTruthy();
  await page.evaluate((id) => (window as any).__ksp.store.select([id]), chord);
  await expect(page.getByTestId('asm-card')).toBeVisible();
  await expect(page.getByTestId('asm-title')).toContainText('נעילה');
  await expect(page.getByTestId('asm-pic')).toBeVisible();
  await shot(page, 'v129-asm-lock');
  await page.getByTestId('asm-scope-line').check();
  await page.getByTestId('asm-type-portal').click();
  await page.waitForTimeout(400);
  const s = await page.evaluate(() => { const d = (window as any).__ksp.store.state.derived; return { bbL: d.members.some((m: any) => /^BB\..*\.L$/.test(m.id)), ltR: d.members.some((m: any) => /^LT\..*\.R\./.test(m.id)), err: d.issues.filter((i: any) => i.severity === 'error').length }; });
  expect(s).toEqual({ bbL: true, ltR: true, err: 0 });
  // פלטה: עריכה בסטודיו (אשף הפלטה הוא חלק מהסטודיו)
  const plate = await page.evaluate(() => (window as any).__ksp.store.state.derived.members.find((m: any) => /^C\.EAVE\..*\.PL$/.test(m.id))?.id);
  await page.evaluate((id) => (window as any).__ksp.store.select([id]), plate);
  await page.getByTestId('open-plate-studio').click();
  await expect(page.getByTestId('ds-plate-wizard')).toBeVisible();
  await shot(page, 'v129-studio-plate');
  await page.getByTestId('ds-close').first().click();
  expect(errors).toEqual([]);
});

test('V130-01 לחיצה על המזחלה בתלת־ממד פותחת את אשף המזחלה; מידה בשרטוט משנה את החתך', async ({ page }) => {
  const errors = await boot(page);
  await page.getByTestId('tab-clad').click().catch(() => {});
  await page.getByTestId('nav-w:roof').click();
  if (await page.getByTestId('clad-enable').count()) await page.getByTestId('clad-enable').click();
  await page.waitForTimeout(500);
  await page.evaluate(() => (window as any).__ksp.viewport.fitAll('iso'));
  await page.waitForTimeout(400);
  const pt = await page.evaluate(() => {
    const vp = (window as any).__ksp.viewport;
    const m = vp.gutterMeshes.find((x: any) => x.geometry.attributes.position.count >= 6);
    const a = m.geometry.attributes.position;
    const c = { x: (a.getX(0) + a.getX(2)) / 2, y: (a.getY(0) + a.getY(2)) / 2, z: (a.getZ(0) + a.getZ(2)) / 2 };
    return vp.screenOf(c, 0);
  });
  await page.mouse.click(pt.x, pt.y);
  await expect(page.getByTestId('gutter-wizard')).toBeVisible();
  await shot(page, 'v130-gutter-wizard');
  await page.getByTestId('gsch-bottom').click();
  await page.getByTestId('gsch-bottom-inp').fill('400'); await page.getByTestId('gsch-bottom-inp').press('Enter');
  expect(await page.evaluate(() => (window as any).__ksp.store.state.project.building.cladding.gutter.spec.bottom)).toBe(400);
  expect(errors).toEqual([]);
});
