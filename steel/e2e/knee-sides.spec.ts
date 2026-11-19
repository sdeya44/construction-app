import { expect, test } from '@playwright/test';
import { boot, shot, pickProfile } from './helpers';

test('KB-02: אלכסוני עמוד-קורה — תוכנית איפה יש: תא, מסגרת, מפתח; מידות לכל מפתח (שורה אחת)', async ({ page }) => {
  const errors = await boot(page);
  await page.getByTestId('nav-b:knee').click();
  await page.getByTestId('kb-on').check();
  await expect(page.getByTestId('kb-grid')).toBeVisible();
  const n = () => page.evaluate(() => (window as any).__ksp.store.state.derived.members.filter((m: any) => m.id.startsWith('KB.')).length);
  const n0 = await n();
  // שורה אחת לכל מפתח — לא שורה לכל צד
  expect(await page.locator('[data-testid^="kb-spanrow-"]').count()).toBe(1);
  // תא בודד: מסגרת 1, ליד עמוד שמאל
  await page.getByTestId('kb-cell-0-L.L.R').click();
  expect(await n()).toBe(n0 - 1);
  // כל מסגרת 2
  await page.getByTestId('kb-frame-1').click();
  expect(await n()).toBe(n0 - 3);
  await shot(page, 'KB_02_grid');
  // כותרת עמוד (שני צדדיו): שני העמודים כבויים בכל המסגרות, ושוב — דלוק בכולן
  await page.getByTestId('kb-col-0').click();
  await page.getByTestId('kb-col-1').click();
  expect(await n()).toBe(0);
  await page.getByTestId('kb-col-0').click();
  await page.getByTestId('kb-col-1').click();
  expect(await n()).toBe(n0);
  // מידה למפתח — חלה על שני הצדדים
  const inp = page.getByTestId('kb-span-drop-0');
  await inp.fill('1200'); await inp.press('Enter');
  const ov = await page.evaluate(() => (window as any).__ksp.store.state.project.building.kneeBraces.sides);
  expect(ov['L.L.R'].drop).toBe(1200);
  expect(ov['R.R.L'].drop).toBe(1200);
  expect(errors).toEqual([]);
});

test('KB-03: קונזולה — עמוד הקצה מופיע עם שני צדדיו; פרט חיבור ניתן לשינוי בעורך החיבור', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => { const k = (window as any).__ksp; k.store.exec({ label: 't', run: (p: any) => ({ ...p, building: { ...p.building, rafterOverhangLeft: 1500, rafterOverhangRight: 1500 } }) }); });
  await page.getByTestId('nav-b:knee').click();
  await page.getByTestId('kb-on').check();
  await expect(page.getByTestId('kb-cell-0-L.L.L')).toBeVisible();
  await expect(page.getByTestId('kb-cell-0-L.L.R')).toBeVisible();
  await expect(page.getByTestId('kb-cell-0-R.R.R')).toBeVisible();
  const n = () => page.evaluate(() => (window as any).__ksp.store.state.derived.members.filter((m: any) => m.id.startsWith('KB.')).length);
  const n0 = await n();
  await page.getByTestId('kb-cell-0-L.L.L').click(); // צד הקונזולה בלבד
  expect(await n()).toBe(n0 - 1);
  await page.getByTestId('kb-cell-0-L.L.L').click();
  expect(await n()).toBe(n0);
  await shot(page, 'KB_03_console');
  // עורך החיבור: פרט חיבור — בחירה (לא קבוע)
  const cid = await page.evaluate(() => (window as any).__ksp.store.state.derived.connections.find((c: any) => c.type === 'knee').id);
  await page.evaluate((i) => (window as any).__ksp.store.set({ activeConn: i }), cid);
  await page.getByTestId('pw-kb-detail').selectOption('flange');
  expect(await page.evaluate(() => (window as any).__ksp.store.state.project.building.kneeBraces.detail)).toBe('flange');
  await expect(page.getByTestId('pw-kb-n')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('HUB-01: לחיצה על עמוד — חתך (סוג ← מידה) עם היקף "כל העמודים" + הגדרות הגיאומטריה באותו פאנל', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => (window as any).__ksp.store.select(['F2.COL.L']));
  await page.getByTestId('psec-general').click(); // הגדרות הגיאומטריה — סעיף מקופל באותו פאנל
  await expect(page.getByTestId('hub-settings')).toBeVisible();
  await page.getByTestId('scope-all').click();
  await pickProfile(page, 'prop-profile', 'HEB200', 'HEB');
  await shot(page, 'HUB_01_column');
  const p = await page.evaluate(() => [...new Set((window as any).__ksp.store.state.derived.members.filter((m: any) => m.kind === 'column').map((m: any) => m.profile))]);
  expect(p).toEqual(['HEB200']);
});

test('HUB-02: לחיצה על אלכסון אגד B — שרטוט סכמטי עם מידות לעריכה בלחיצה', async ({ page }) => {
  await boot(page);
  await page.getByTestId('nav-b:walls').click();
  await page.getByTestId('br-walls-portal').click();
  await page.getByTestId('nav-b:knee').click(); // תפריט אחר פתוח — ההגדרות של האגד בפאנל האלמנט
  const id = await page.evaluate(() => (window as any).__ksp.store.state.derived.members.find((m: any) => m.id.startsWith('BB.'))?.id);
  await page.evaluate((i) => (window as any).__ksp.store.select([i]), id);
  await expect(page.getByTestId('hub-settings')).toBeVisible();
  await page.getByTestId('asm-scope-all').check(); // חלון המכלול: שינוי לכל הצירים
  await page.getByTestId('hub-settings').getByTestId('sch-pb-drop').click();
  await page.getByTestId('sch-pb-drop-inp').fill('900'); await page.getByTestId('sch-pb-drop-inp').press('Enter');
  expect(await page.evaluate(() => (window as any).__ksp.store.state.project.building.bracing.walls.portal.drop)).toBe(900);
  await page.getByTestId('hub-settings').getByTestId('sch-pb-angle').click();
  await page.getByTestId('sch-pb-angle-inp').fill('40'); await page.getByTestId('sch-pb-angle-inp').press('Enter');
  expect(await page.evaluate(() => (window as any).__ksp.store.state.project.building.bracing.walls.portal.angle)).toBe(40);
  await shot(page, 'HUB_02_portal');
});

test('HUB-03: שינוי חתך מפאנל אלכסון — "רק האלמנט הזה" ו"כל האלכסונים" עובדים; קושרת גג משנה את כל הקושרות', async ({ page }) => {
  const errors = await boot(page);
  await page.getByTestId('nav-b:knee').click();
  await page.getByTestId('kb-on').check();
  const prof = (id: string) => page.evaluate((i) => (window as any).__ksp.store.state.derived.byId.get(i)?.profile, id);
  await page.evaluate(() => (window as any).__ksp.store.select(['KB.F2.L.L.R']));
  await page.getByTestId('scope-one').click();
  await pickProfile(page, 'prop-profile', 'SHS100x5', 'SHS');
  expect(await prof('KB.F2.L.L.R')).toBe('SHS100x5');
  expect(await prof('KB.F3.L.L.R')).toBe('RHS80x80x4');
  await page.evaluate(() => (window as any).__ksp.store.select(['KB.F3.L.L.R']));
  await page.getByTestId('scope-all').click();
  await pickProfile(page, 'prop-profile', 'SHS90x4', 'SHS');
  const all = await page.evaluate(() => [...new Set((window as any).__ksp.store.state.derived.members.filter((m: any) => m.id.startsWith('KB.')).map((m: any) => m.profile))]);
  expect(all).toEqual(['SHS90x4']);
  // קושרת גג
  const br = await page.evaluate(() => (window as any).__ksp.store.state.derived.members.find((m: any) => m.id.startsWith('BR.R'))?.id);
  await page.evaluate((i) => (window as any).__ksp.store.select([i]), br);
  await pickProfile(page, 'prop-profile', 'L60x6', 'L');
  const roof = await page.evaluate(() => [...new Set((window as any).__ksp.store.state.derived.members.filter((m: any) => m.id.startsWith('BR.R')).map((m: any) => m.profile))]);
  expect(roof).toEqual(['L60x6']);
  await shot(page, 'HUB_03_brace_profile');
  expect(errors).toEqual([]);
});
