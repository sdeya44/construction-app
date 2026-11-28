import { expect, test } from '@playwright/test';
import { boot, pickProfile } from './helpers';

test('ELEM-E1: אגד B — חתך לאלמנט בודד / לציר / לכל המודל מחלון הרכיב', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => { const k = (window as any).__ksp; k.store.set({ propScope: null }); localStorage.removeItem('ksp-prop-scope'); k.store.exec({ label: 't', run: (p: any) => ({ ...p, building: { ...p.building, bracing: { ...p.building.bracing, walls: { ...p.building.bracing.walls, enabled: true, type: 'portal' } } } }) }); });
  const ks: string[] = await page.evaluate(() => (window as any).__ksp.store.state.derived.members.filter((m: any) => /^BB\..*\.K1$/.test(m.id)).map((m: any) => m.id));
  expect(ks.length).toBeGreaterThan(2);
  const prof = (id: string) => page.evaluate((i) => (window as any).__ksp.store.state.derived.byId.get(i).profile, id);
  const before = await prof(ks[1]);
  await page.evaluate((i) => (window as any).__ksp.store.select([i]), ks[0]);
  // האלמנט הזה בלבד
  await page.getByTestId('pscope-one').click();
  await expect(page.getByTestId('scope-profile')).toBeVisible();
  await pickProfile(page, 'sp-profile', 'SHS100x5', 'SHS');
  expect(await prof(ks[0])).toBe('SHS100x5');
  expect(await prof(ks[1])).toBe(before);
  // כל המודל
  await page.getByTestId('pscope-asmall').click();
  await pickProfile(page, 'sp-profile', 'SHS90x4', 'SHS');
  for (const k of ks) expect(await prof(k)).toBe('SHS90x4');
  expect(errors).toEqual([]);
});

test('ELEM-E2: שורת קשירה לפטות — חתך לאלמנט בודד מחלון הרכיב', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => { const k = (window as any).__ksp; k.store.set({ propScope: null }); localStorage.removeItem('ksp-prop-scope'); k.store.exec({ label: 't', run: (p: any) => ({ ...p, building: { ...p.building, bracing: { ...p.building.bracing, purlinTies: { ...p.building.bracing.purlinTies, enabled: true } } } }) }); });
  const ties: string[] = await page.evaluate(() => (window as any).__ksp.store.state.derived.members.filter((m: any) => /^BR\.T\d+\./.test(m.id)).map((m: any) => m.id));
  test.skip(ties.length < 2, 'אין שורות קשירה במודל ברירת המחדל');
  const prof = (id: string) => page.evaluate((i) => (window as any).__ksp.store.state.derived.byId.get(i).profile, id);
  const other = await prof(ties[1]);
  await page.evaluate((i) => (window as any).__ksp.store.select([i]), ties[0]);
  await page.getByTestId('pscope-one').click();
  await pickProfile(page, 'sp-profile', 'L60x6', 'L');
  expect(await prof(ties[0])).toBe('L60x6');
  expect(await prof(ties[1])).toBe(other);
  expect(errors).toEqual([]);
});
