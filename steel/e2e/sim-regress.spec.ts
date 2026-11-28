import { expect, test } from '@playwright/test';
import { boot, openNav, pickProfile } from './helpers';

const kb = (page: import('@playwright/test').Page) => page.evaluate(() => { const k = (window as any).__ksp.store.state.project.building.kneeBraces; return { mode: k.mode, drop: k.drop, reach: k.reach, angle: k.angle }; });

test('SIM-R1: אלכסון עמוד-קורה — אנכי + אופקי קובעות נשמרים כ-reach (1000/1000), בלי reach ישן; ההערה על הזווית', async ({ page }) => {
  const errors = await boot(page);
  await openNav(page, 'b:knee');
  const win = page.getByTestId('cwin-knee');
  await win.getByTestId('ks-type-knee').click();
  await win.getByTestId('pscope-asm').click();
  await win.getByTestId('ks-sec-geo').click();
  await win.getByTestId('kd-lock-h').click(); await win.getByTestId('kd-lock-v').click(); // קובעות: אנכי + אופקי
  await win.getByTestId('kd-v').fill('1000'); await win.getByTestId('kd-v').press('Enter');
  await expect.poll(async () => (await kb(page)).drop, { timeout: 15000 }).toBe(1000);
  await win.getByTestId('kd-h').fill('1000'); await win.getByTestId('kd-h').press('Enter');
  await expect.poll(async () => (await kb(page)).reach, { timeout: 15000 }).toBe(1000);
  const s = await kb(page); expect(s.mode).toBe('reach'); expect(s.drop).toBe(1000);
  await expect(win.getByTestId('kd-v')).toHaveValue('1000'); await expect(win.getByTestId('kd-h')).toHaveValue('1000');
  await expect(win.getByTestId('ks-v-eq-h')).toBeVisible();
  expect(errors).toEqual([]);
});

test('SIM-R2: אשף פרויקט חדש — בוררי חתך עמוד/קורה נגישים ב-1600×900 (מזהי בדיקה ייעודיים)', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  const errors = await boot(page);
  await page.getByTestId('btn-new').click();
  await page.getByTestId('np-gable').click();
  await page.getByTestId('wz-next').click(); await page.getByTestId('wz-next').click();
  await pickProfile(page, 'np-column', 'RHS150x150x5', 'RHS');
  await pickProfile(page, 'np-rafter', 'IPE300', 'IPE');
  await expect(page.getByTestId('np-column')).toHaveValue('RHS150x150x5');
  await expect(page.getByTestId('np-rafter')).toHaveValue('IPE300');
  expect(errors).toEqual([]);
});

test('SIM-R3: קונזולה — מידת הקונזולה מוצגת גם כשהיא 0, ועריכתה שומרת את גובה העמוד', async ({ page }) => {
  const errors = await boot(page);
  await page.getByTestId('sr-2').click();
  const w = page.getByTestId('cwin-frame');
  await expect(w.getByTestId('fs-ovl')).toBeVisible();   // בעבר הוסתר כשהקונזולה 0
  const z0 = await page.evaluate(() => (window as any).__ksp.store.state.derived.byId.get('F2.COL.L').end.z);
  await w.getByTestId('fs-ovl').dispatchEvent('click');
  await w.getByTestId('fs-input').fill('1'); await w.getByTestId('fs-input').press('Enter');
  await expect.poll(async () => page.evaluate(() => { const s = (window as any).__ksp.store.state.project.building.section; return s ? Math.min(...s.planes.map((p: any) => p.x0)) : 0; }), { timeout: 10000 }).toBe(-1000);
  const z1 = await page.evaluate(() => (window as any).__ksp.store.state.derived.byId.get('F2.COL.L').end.z);
  expect(z1).toBeCloseTo(z0, 1);
  expect(errors).toEqual([]);
});

test('SIM-R4: בחירת ציר — אפשרויות עם מזהי בדיקה ותווית קריאה', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => { const k = (window as any).__ksp; k.store.exec({ label: 't', run: (p: any) => ({ ...p, building: { ...p.building, bracing: { ...p.building.bracing, walls: { ...p.building.bracing.walls, enabled: true, type: 'portal' } } } }) }); });
  const id = await page.evaluate(() => (window as any).__ksp.store.state.derived.members.find((m: any) => /^BB\..*\.R\.K1$/.test(m.id)).id);
  await page.evaluate((i) => (window as any).__ksp.store.select([i]), id);
  await page.getByTestId('pscope-asm').click();
  const opt = page.getByTestId('ks-line').locator('option');
  await expect(opt.first()).toHaveAttribute('data-line-label', /.+/);
  expect(await page.getByTestId('ks-line').locator('option[data-testid^="ks-line-opt-"]').count()).toBeGreaterThan(1);
  await expect(page.getByTestId('ks-line-opt-ב')).toHaveText('ציר ב');
  expect(errors).toEqual([]);
});
