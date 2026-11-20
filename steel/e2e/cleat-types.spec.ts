import { expect, test } from '@playwright/test';
import { boot, shot, openNav } from './helpers';

const st = (page: import('@playwright/test').Page) => page.evaluate(() => {
  const s = (window as any).__ksp.store.state, d = s.derived;
  const cl = d.connections.filter((c: any) => c.type === 'purlin-cleat');
  return { cleats: cl.length, profiles: [...new Set(cl.map((c: any) => d.byId.get(c.parts[0])?.profile))], splices: d.connections.filter((c: any) => c.type === 'purlin-splice').length,
    custom: d.connections.filter((c: any) => c.type === 'custom').length, err: d.issues.filter((i: any) => i.severity === 'error').length, lib: (s.project.customDetails ?? []).length };
});

test('CT-01: תושבת פטה — בחירת סוג בכרטיסים (זוויתן עומד / פלטה + משולש), תושבת תפר, פרט מוכן וסטודיו', async ({ page }) => {
  const errors = await boot(page);
  const cl = await page.evaluate(() => (window as any).__ksp.store.state.derived.connections.find((c: any) => c.type === 'purlin-cleat').parts[0]);
  await page.evaluate((i) => (window as any).__ksp.store.select([i]), cl);
  await expect(page.getByTestId('cleat-type')).toBeVisible();
  await page.getByTestId('ct-scope-all').click();
  await page.getByTestId('ct-stand').click();
  let s = await st(page);
  expect(s.profiles).toEqual(['L40x4']);
  expect(s.err).toBe(0);
  await page.getByTestId('ct-splice').check();
  s = await st(page);
  expect(s.splices).toBe(0);
  expect(s.err).toBe(0);
  await shot(page, 'CT_01_stand');
  // פרט מוכן מהספרייה על כל התושבות ← הופך לפרט מותאם; ואז פתיחה בסטודיו
  const cl2 = await page.evaluate(() => (window as any).__ksp.store.state.derived.connections.find((c: any) => c.type === 'purlin-cleat').parts[0]);
  await page.evaluate((i) => (window as any).__ksp.store.select([i]), cl2);
  await page.getByTestId('ct-scope-all').click();
  await page.getByTestId('ct-preset-preset-cleat-plate').click();
  s = await st(page);
  expect(s.custom).toBeGreaterThan(0);
  if (s.err) console.log('ERRS', await page.evaluate(() => (window as any).__ksp.store.state.derived.issues.filter((i: any) => i.severity === 'error').slice(0, 3).map((i: any) => i.message)));
  expect(s.err).toBe(0);
  expect(s.lib).toBe(1);
  // חזרה לסוג מובנה מבטלת את הפרט המותאם
  const part = await page.evaluate(() => (window as any).__ksp.store.state.derived.members.find((m: any) => m.connId?.startsWith('C.CD.') && m.kind === 'plate').id);
  await page.evaluate((i) => (window as any).__ksp.store.select([i]), part);
  await page.getByTestId('ct-scope-all').click();
  await page.getByTestId('ct-plate').click();
  s = await st(page);
  expect(s.custom).toBe(0);
  expect(s.cleats).toBeGreaterThan(0);
  const cl3 = await page.evaluate(() => (window as any).__ksp.store.state.derived.connections.find((c: any) => c.type === 'purlin-cleat').parts[0]);
  await page.evaluate((i) => (window as any).__ksp.store.select([i]), cl3);
  await page.getByTestId('ct-studio').click();
  await expect(page.getByTestId('detail-studio')).toBeVisible();
  await shot(page, 'CT_01_studio');
  expect(errors).toEqual([]);
});

test('ET-01: קצה אלמנט — בחירת פרט מוכן בכרטיס, ושמירה כפרט חדש בסטודיו לא דורסת את הקיים', async ({ page }) => {
  const errors = await boot(page);
  await openNav(page, 'b:knee');
  await page.getByTestId('kb-on').check();
  await page.evaluate(() => (window as any).__ksp.store.select(['KB.F2.L.L.R']));
  await page.getByTestId('ks-sec-conn').click();
  await page.getByTestId('cb-lib').click(); // 1.63: מהספרייה / פרט מוכן — בבלוק המחבר
  await page.getByTestId('et-start-open').click();
  await page.getByTestId('et-start-all').check();
  await page.getByTestId('et-start-preset-preset-fin').click();
  const lib = () => page.evaluate(() => (window as any).__ksp.store.state.project.customDetails.map((x: any) => x.name));
  expect(await lib()).toEqual(['סנפיר על המארח + לשונית בחריץ']);
  // עריכה בסטודיו: שינוי משתנה ושמירה כפרט חדש — הישן נשאר
  await page.getByTestId('studio-start').click();
  await expect(page.getByTestId('detail-studio')).toBeVisible();
  await page.getByTestId('ds-name').fill('סנפיר 12');
  await page.getByTestId('ds-apply').click();
  expect(await lib()).toEqual(['סנפיר על המארח + לשונית בחריץ', 'סנפיר 12']);
  await page.getByTestId('ds-close').click();
  expect(errors).toEqual([]);
});

test('STEP-01: גג מדורג — זיז לקורה העליונה מעבר לעמוד בדירוג', async ({ page }) => {
  const errors = await boot(page);
  page.on('dialog', (d) => d.accept());
  await openNav(page, 's:geometry');
  await page.getByTestId('tpl-toggle').click();
  await page.getByTestId('tpl-stepped').click();
  await page.getByTestId('ks-sec-geo').click(); await page.locator('[data-testid="fs-adv"] > summary').click(); // 1.62: מישורי גג — מתקדם בגיאומטריה
  const inp = page.getByTestId('ovh-step-1');
  await expect(inp).toBeVisible();
  await inp.fill('0.6'); await inp.press('Enter');
  const r = await page.evaluate(() => { const s = (window as any).__ksp.store.state; return { x0: s.project.building.section.planes.find((p: any) => p.id === 'P2').x0, err: s.derived.issues.filter((i: any) => i.severity === 'error').length }; });
  expect(r).toEqual({ x0: 9400, err: 0 });
  await shot(page, 'STEP_01');
  expect(errors).toEqual([]);
});
