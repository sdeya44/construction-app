import { expect, test } from '@playwright/test';
import { boot, pickProfile, shot, openNav } from './helpers';

const B = (page: any) => page.evaluate(() => (window as any).__ksp.store.state.project.building);
async function editDim(page: any, id: string, v: string) {
  await page.getByTestId(id).first().dispatchEvent('click');
  await page.getByTestId(`${id}-inp`).fill(v); await page.getByTestId(`${id}-inp`).press('Enter');
}

test('V134-01: עורך חיבור עמוד-קורה — קוטר הבורג זהה באשף, בשדה ובטבלת הברגים', async ({ page }) => {
  const errors = await boot(page);
  await page.getByTestId('tab-conns').click();
  await openNav(page, 'c:eave');
  await page.getByTestId('cvar-open-eave-0').click();
  const d = await page.evaluate(() => { const k = (window as any).__ksp.store.state; return k.derived.connById.get(k.activeConn).bolts[0].d; });
  await expect(page.getByTestId('pw-bolt')).toHaveValue(String(d));
  await expect(page.getByTestId('cp-d')).toHaveValue(String(d));
  expect(errors).toEqual([]);
});

test('V134-02: בורר פרופיל — חלונית עם סוגים וגדלים ומשקל למטר', async ({ page }) => {
  await boot(page);
  await openNav(page, 's:profiles');
  await page.getByTestId('columnProfile-open').click();
  await expect(page.getByTestId('columnProfile-pop')).toBeVisible();
  await expect(page.getByTestId('columnProfile-opt-HEA240')).toContainText('ק"ג');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('columnProfile-pop')).toHaveCount(0);
  await pickProfile(page, 'columnProfile', 'HEB240');
  expect((await B(page)).columnProfile).toBe('HEB240');
  await expect(page.getByTestId('columnProfile')).toHaveValue('HEB240');
});

test('V134-03: תוכנית מסגרות ומרווחי פטות — עריכה על השרטוט', async ({ page }) => {
  await boot(page);
  await openNav(page, 's:geometry');
  await page.getByTestId('geo-ed-tab-frames').click();
  await editDim(page, 'fs-bay-1', '5000');
  const fr = [...(await B(page)).frames].sort((a: any, b: any) => a.y - b.y);
  expect(fr[2].y - fr[1].y).toBe(5000);
  expect(fr[3].y - fr[2].y).toBe(6000); // המסגרות שאחרי זזות יחד
  await editDim(page, 'fs-total', '36000');
  const fr2 = [...(await B(page)).frames].sort((a: any, b: any) => a.y - b.y);
  expect(fr2[fr2.length - 1].y - fr2[0].y).toBe(36000);
  await openNav(page, 'r:left');
  await expect(page.getByTestId('sch-left-g2')).toBeVisible();
  await editDim(page, 'sch-left-g2', '1300');
  expect((await B(page)).purlins.left.spacing).toBe(1300);
  await shot(page, 'V134_03_purlins');
});

test('V134-04: חיבורים מקובצים, קשיחות קירות בתוכנית אחת, לשוניות חיפוי, מזחלה בתוכנית', async ({ page }) => {
  const errors = await boot(page);
  await page.getByTestId('tab-conns').click();
  await openNav(page, 'c:purlin-cleat');
  const nv = await page.getByTestId('cvariants-purlin-cleat').locator('.conn-var').count();
  expect(nv).toBeGreaterThan(0); expect(nv).toBeLessThan(10);
  // קשיחות קירות
  await openNav(page, 'b:walls');
  if (!(await page.getByTestId('br-walls').isChecked())) await page.getByTestId('off-walls-add').click();
  await page.getByTestId('ks-sec-loc').click(); // 1.56: מיקום במבנה
  await expect(page.getByTestId('walls-plan')).toBeVisible();
  const lines = await page.evaluate(() => (window as any).__ksp.store.state.derived.section.lines.map((l: any) => l.id));
  const before = await page.evaluate(() => (window as any).__ksp.store.state.derived.members.filter((m: any) => m.id.startsWith('BR.W')).length);
  await page.getByTestId(`sch-wall-${lines[0]}-2`).click();
  const after = await page.evaluate(() => (window as any).__ksp.store.state.derived.members.filter((m: any) => m.id.startsWith('BR.W')).length);
  expect(after).toBeGreaterThan(before);
  await shot(page, 'V134_04_walls_plan');
  // חיפוי: לשוניות וזמזחלה
  await page.getByTestId('tab-clad').click();
  await openNav(page, 'w:walls');
  await page.getByText('הוספת חיפוי למבנה').first().click();
  await page.getByTestId('clad-tab-F').click();
  await expect(page.getByTestId('clad-wall-F')).toBeVisible();
  await expect(page.getByTestId('clad-wall-L')).toHaveCount(0);
  await openNav(page, 'w:roof');
  await expect(page.getByTestId('gsch-c-sch')).toBeVisible();
  const pid = await page.locator('[data-testid^="gut-strip-"]').first().getAttribute('data-testid');
  const id = pid!.replace('gut-strip-', '');
  await page.getByTestId(`gut-bay-${id}-1`).click();
  expect((await B(page)).cladding.gutter.perRun[id].bays[1]).toBe(false);
  await editDim(page, 'gsch-c-lip', '25');
  expect((await B(page)).cladding.gutter.spec.lip).toBe(25);
  await shot(page, 'V134_04_gutter');
  expect(errors).toEqual([]);
});

test('V134-05: תבניות מקופלות, הסבר מאחורי ?, נעילה אופקית בשרטוט', async ({ page }) => {
  await boot(page);
  await openNav(page, 's:geometry');
  await expect(page.getByTestId('tpl-gable-2')).toHaveCount(0);
  await page.getByTestId('tpl-toggle').click();
  await expect(page.getByTestId('tpl-gable-2')).toBeVisible();
  // אפשרות כבויה: כרטיס עם ציור וכפתור הוספה
  // 1.56: חלון האלכסונים — בחירת סוג במקום כרטיס כבוי
  await openNav(page, 'b:knee');
  await expect(page.getByTestId('ks-type-knee')).toHaveAttribute('aria-checked', 'false');
  await page.getByTestId('ks-type-knee').click();
  expect((await B(page)).kneeBraces.enabled).toBe(true);
  await expect(page.getByTestId('ks-type-knee')).toHaveAttribute('aria-checked', 'true');
  await openNav(page, 'b:walls');
  if (!(await page.getByTestId('br-walls').isChecked())) await page.getByTestId('br-walls').check();
  await page.getByTestId('br-walls-truss').click();
  await page.getByTestId('ks-sec-geo').click();
  await editDim(page, 'sch-lt-height', '1200');
  expect((await B(page)).bracing.walls.truss.height).toBe(1200);
  await expect(page.getByTestId('walls-studio').locator('details.help[open]')).toHaveCount(0);
});
