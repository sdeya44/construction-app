import { expect, test } from '@playwright/test';
import { boot, openNav, shot } from './helpers';

/** 1.56: חלונות במבנה אחיד — סוג → "השינויים יחולו על" → 1 מיקום · 2 גיאומטריה · 3 חתך ומחברים */
const st = (page: import('@playwright/test').Page) => page.evaluate(() => (window as any).__ksp.store.state.project.building);

test('KS-02: חלון אלכסונים — אלכסון או מכפל (לא שניהם), שתי מידות קובעות, מחברים', async ({ page }) => {
  const errors = await boot(page);
  await openNav(page, 'b:knee');
  const win = page.getByTestId('cwin-knee');
  await expect(win.getByTestId('knee-studio')).toBeVisible();
  // סוג: אלכסון ⇒ פעיל, מכפל כבוי; מכפל ⇒ ההפך
  await win.getByTestId('ks-type-knee').click();
  expect((await st(page)).kneeBraces.enabled).toBe(true);
  await win.getByTestId('ks-type-haunch').click();
  let b = await st(page); expect(b.kneeBraces.enabled).toBe(false); expect(b.haunch.enabled).toBe(true);
  await win.getByTestId('ks-type-knee').click();
  b = await st(page); expect(b.kneeBraces.enabled).toBe(true); expect(b.haunch.enabled).toBe(false);
  // גיאומטריה — כל המודל: אופקי חדש כשהזווית קובעת
  await win.getByTestId('pscope-asm').click();
  await win.getByTestId('ks-sec-geo').click();
  await expect(win.getByTestId('kd-lock-ang')).toHaveClass(/on/);
  const h0 = Number(await win.getByTestId('kd-h').inputValue());
  await win.getByTestId('kd-h').fill(String(h0 + 200)); await win.getByTestId('kd-h').press('Enter');
  await expect(win.getByTestId('kd-h')).toHaveValue(String(h0 + 200), { timeout: 15000 });
  await expect(win.getByTestId('kd-lock-h')).toHaveClass(/on/);
  expect(Math.abs(Number(await win.getByTestId('kd-ang').inputValue()) - 45)).toBeLessThan(0.6);
  // במיקום אחד: חריג רק לצד הזה
  await page.evaluate(() => (window as any).__ksp.store.select(['KB.F2.L.L.R']));
  await expect(win.getByTestId('pscope-loc')).toHaveClass(/on/);
  await win.getByTestId('ks-sec-geo').click();
  const v0 = Number(await win.getByTestId('kd-v').inputValue());
  await win.getByTestId('kd-v').fill(String(v0 + 100)); await win.getByTestId('kd-v').press('Enter');
  await expect.poll(async () => (await st(page)).kneeBraces.sides?.['L.L.R']?.drop, { timeout: 15000 }).toBeTruthy();
  await shot(page, 'KS_02_geo');
  // חתך ומחברים
  await win.getByTestId('ks-sec-conn').click();
  await win.getByTestId('ks-end-R').click();
  await expect(win.getByTestId('ks-end-R')).toHaveClass(/on/);
  await win.getByTestId('ks-wizard').click();
  expect(await page.evaluate(() => (window as any).__ksp.store.state.connWizard)).toBe('C.KB.F2.L.L.R');
  expect(errors).toEqual([]);
});

test('WS-01: חלון קשיחות קירות — סוג, ציר / כל המודל, שלושה כפתורים', async ({ page }) => {
  const errors = await boot(page);
  await openNav(page, 'b:walls');
  const win = page.getByTestId('cwin-walls');
  await expect(win.getByTestId('walls-studio')).toBeVisible();
  await win.getByTestId('br-walls-portal').click();
  expect((await st(page)).bracing.walls.type).toBe('portal');
  // ציר אחד בלבד: מסבך נעילה בציר הזה
  await win.getByTestId('pscope-asm').click();
  await win.getByTestId('br-walls-truss').click();
  { const w = (await st(page)).bracing.walls; expect(w.type).toBe('portal'); expect(Object.values(w.lineType ?? {})).toContain('truss'); }
  await win.getByTestId('ks-sec-geo').click(); await expect(win.getByTestId('ks-geo')).toBeVisible();
  await win.getByTestId('ks-sec-conn').click(); await expect(win.getByTestId('lt-chord')).toBeVisible();
  await win.getByTestId('ks-sec-loc').click(); await expect(win.getByTestId('ks-loc')).toBeVisible();
  expect(errors).toEqual([]);
});
