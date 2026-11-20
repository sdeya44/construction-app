import { expect, test } from '@playwright/test';
import { boot, shot, openNav } from './helpers';

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
  await openNav(page, 'b:roof');
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
  await openNav(page, 'b:tb');
  await page.getByTestId('tb-grp-0-edit').click();
  await page.getByTestId('ks-sec-geo').click(); // 1.63: הקורה — גיאומטריה
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

test('V138-01: מפלס ייחוס לגבהים בשרטוט החתך; פירוט אורך חיתוך עמוד', async ({ page }) => {
  const errors = await boot(page);
  await openNav(page, 's:geometry');
  const sec = () => page.evaluate(() => (window as any).__ksp.store.state.project.building.section ?? null);
  // 1.62: הגבהים — בחתך המסגרת (גיאומטריה): ע.ע. קורה בציר לעריכה; "פני עליון הפטות" — מידה נוספת לקריאה
  await page.getByTestId('ks-sec-geo').click();
  await expect(page.getByTestId('isec-datum')).toHaveCount(0);
  await page.getByTestId('fs-tos-0').dispatchEvent('click');
  await page.getByTestId('fs-input').fill('6.3'); await page.getByTestId('fs-input').press('Enter');
  const s1 = await sec();
  const ax = Math.min(...s1.lines.map((l: any) => l.x));
  const pl = s1.planes.find((q: any) => q.x0 - 1 <= ax && ax <= q.x1 + 1);
  const zAx = pl.z0 + ((pl.z1 - pl.z0) * (ax - pl.x0)) / (pl.x1 - pl.x0);
  expect(Math.abs(zAx - 6300)).toBeLessThan(1);
  await expect(page.getByTestId('fs-tos-0')).toContainText('6.30');
  await page.getByTestId('fs-extra').selectOption('purlin');
  const k = Math.sqrt(1 + ((pl.z1 - pl.z0) / (pl.x1 - pl.x0)) ** 2);
  const ph = await page.evaluate((id) => { const d = (window as any).__ksp.store.state.derived; const m = d.members.find((x: any) => x.purlin?.side === id) ?? d.members.find((x: any) => x.purlin); return Number(/^C(\d+)/.exec(m.profile)?.[1] ?? 0); }, pl.id);
  await expect(page.getByTestId('fs-extra-0')).toContainText(((6300 + ph * k) / 1000).toFixed(2));
  await page.getByTestId('fs-extra').selectOption('');
  await shot(page, 'V138_01_datum');
  await page.evaluate(() => (window as any).__ksp.store.select(['F2.COL.L']));
  await expect(page.getByTestId('prop-len-tbl')).toContainText('קורת גג');
  await expect(page.getByTestId('prop-len-tbl')).toContainText('אורך חיתוך מרבי');
  await shot(page, 'V138_01_cut');
  expect(errors).toEqual([]);
});

test('V139-01: סינון חתכים לפי מידה, טבלת פירוט אורך, בקרת אורכים', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => (window as any).__ksp.store.select(['F2.COL.L']));
  await page.getByTestId('prop-profile-open').click();
  await page.getByTestId('prop-profile-fam-RHS').click();
  const all = await page.locator('[data-testid^="prop-profile-opt-"]').count();
  await page.getByTestId('prop-profile-q').fill('100x50');
  const names = await page.locator('[data-testid^="prop-profile-opt-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.replace('prop-profile-opt-', '')));
  expect(names.length).toBeGreaterThan(0); expect(names.length).toBeLessThan(all);
  expect(names.every((n) => /^RHS100x50x/.test(n))).toBe(true);
  await page.getByTestId('prop-profile-q').fill('5');
  const n5 = await page.locator('[data-testid^="prop-profile-opt-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.replace('prop-profile-opt-', '')));
  expect(n5.every((n) => n.replace(/^RHS/, '').split('x').map(Number).includes(5))).toBe(true);
  await shot(page, 'V139_01_filter');
  await page.keyboard.press('Escape');
  // טבלת פירוט לפטה
  const pid = await page.evaluate(() => (window as any).__ksp.store.state.derived.members.find((m: any) => m.purlin).id);
  await page.evaluate((id) => (window as any).__ksp.store.select([id]), pid);
  await expect(page.getByTestId('prop-len-tbl')).toContainText('אורך קו ייחוס');
  await page.getByTestId('mode-production').click();
  await page.getByTestId('audit-run').click();
  await expect(page.getByTestId('audit-ok')).toBeVisible();
  await shot(page, 'V139_01_audit');
  expect(errors).toEqual([]);
});
