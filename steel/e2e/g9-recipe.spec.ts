import { expect, test } from '@playwright/test';
import { boot, openNav } from './helpers';

const stats = (page: import('@playwright/test').Page) => page.evaluate(() => {
  const d = (window as any).__ksp.store.state.derived;
  const custom = (re: RegExp) => d.connections.filter((c: any) => c.type === 'custom' && re.test(c.id)).length;
  const old = (t: string) => d.connections.filter((c: any) => c.type === t).length;
  return { ps: custom(/^C\.PS\./), rs: custom(/^C\.(RS|WS)\./), x: custom(/^C\.BR\.[RW].*\.X$/), oldPs: old('purlin-splice'), oldRs: old('beam-splice'), oldX: old('brace-cross'),
    err: d.issues.filter((i: any) => i.severity === 'error').length };
});

/** פותח את הלוח רק אם התיבה לא מוצגת (הניווט הוא מתג — פתיחה חוזרת סוגרת) */
const ensure = async (page: import('@playwright/test').Page, nav: string, id: string) => {
  if (!(await page.getByTestId(id).count())) { await openNav(page, nav); if (nav === 'b:roof') await page.getByTestId('ks-sec-conn').click(); }
  return page.getByTestId(id);
};

test('G9-E2E: תיבות "בנה ממתכון" — חיבור המשך פטה, חיבור המשך קורה/עמוד, הצטלבות קושרות', async ({ page }) => {
  const errors = await boot(page);
  // תפרים ידניים: פטה, קורה ועמוד
  await page.evaluate(() => {
    (window as any).__ksp.store.exec({ label: 't', run: (p: any) => ({ ...p, settings: { ...p.settings, autoSplice: false }, splices: { 'PL.L.03': [7000], 'F1.RAF.L': [3500], 'F3.COL.R': [3000] } }) });
  });
  const base = await stats(page);
  expect(base.oldPs + base.oldRs).toBeGreaterThan(0);
  expect(base.ps + base.rs + base.x).toBe(0);

  await (await ensure(page, 's:project', 'beam-splice-recipe')).check();
  let s = await stats(page);
  expect(s.rs).toBe(base.oldRs); expect(s.oldRs).toBe(0); expect(s.err).toBe(base.err);

  await (await ensure(page, 'r:splices', 'splice-recipe')).check();
  s = await stats(page);
  expect(s.ps).toBe(base.oldPs); expect(s.oldPs).toBe(0); expect(s.err).toBe(base.err);

  await (await ensure(page, 'b:roof', 'brc-cross-recipe')).check();
  s = await stats(page);
  expect(s.x).toBe(base.oldX); expect(s.oldX).toBe(0); expect(s.err).toBe(base.err);

  // כיבוי — חזרה לקוד הישן
  await (await ensure(page, 'b:roof', 'brc-cross-recipe')).uncheck();
  await (await ensure(page, 's:project', 'beam-splice-recipe')).uncheck();
  await (await ensure(page, 'r:splices', 'splice-recipe')).uncheck();
  s = await stats(page);
  expect(s).toMatchObject({ ps: 0, rs: 0, x: 0, oldPs: base.oldPs, oldRs: base.oldRs, oldX: base.oldX });
  expect(errors).toEqual([]);
});
