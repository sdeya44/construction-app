import { expect, test } from '@playwright/test';
import { boot, shot, openNav } from './helpers';

const S = (page: import('@playwright/test').Page) => page.evaluate(() => (window as any).__ksp.store.state);
const count = (page: import('@playwright/test').Page, re: string) => page.evaluate((r) => (window as any).__ksp.store.state.derived.members.filter((m: any) => new RegExp(r).test(m.id)).length, re);

test('V141-01: מוטות תלייה, תמיכה צידית, סיב רציף, בסיס בכלונס, שם ציר — מהממשק, ללא שגיאות', async ({ page }) => {
  const errors = await boot(page);
  // שם ציר
  await openNav(page, 's:geometry');
  await page.getByTestId('fs-bub-0').dispatchEvent('click'); // 1.62: שם ציר — בלחיצה על הבועה בחתך
  await page.getByTestId('fs-ax-name').fill('E'); await page.getByTestId('fs-ax-name').press('Enter');
  expect((await S(page)).derived.section.lines[0].label).toBe('E');
  // מוטות תלייה ותמיכה צידית
  await openNav(page, 'b:ties');
  await page.getByTestId('fam-sub-sag').click(); // 1.58: אשף הפטות — בחירת רכיב
  await page.getByTestId('sr-on').check();
  expect(await count(page, '^SR\\.')).toBeGreaterThan(0);
  await page.getByTestId('fam-sub-fly').click();
  await page.getByTestId('fb-on').check();
  expect(await count(page, '^FB\\.')).toBeGreaterThan(0);
  // סיב רציף
  await openNav(page, 'b:walls');
  await page.getByTestId('ks-sec-loc').click(); // 1.56: סיב רציף — במיקום במבנה
  await page.getByTestId('lt-on').check();
  expect(await count(page, '^LTIE\\.')).toBeGreaterThan(0);
  // בסיס בכלונס
  await page.evaluate(() => (window as any).__ksp.store.set({ activeConn: 'C.BASE.F1.L' }));
  await page.getByTestId('cp-mode-pile').click();
  expect((await S(page)).project.building ? (await S(page)).derived.members.some((m: any) => m.kind === 'anchor') : true).toBe(false);
  await shot(page, 'V141_01');
  expect((await S(page)).derived.issues.filter((i: any) => i.severity === 'error')).toEqual([]);
  expect(errors).toEqual([]);
});

test('V141-02: דילול עמודים — אלכסוני Y והחלה על כל הקורות בציר', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => { const k = (window as any).__ksp; k.store.exec({ label: 't', run: (p: any) => ({ ...p, building: { ...p.building, transfers: [
    { id: 'T1', lineId: 'L', from: 'F1', to: 'F3', removed: ['F2'], profile: 'IPE300', support: 'A1', seat: 'B1' },
    { id: 'T2', lineId: 'L', from: 'F3', to: 'F5', removed: ['F4'], profile: 'IPE300', support: 'A1', seat: 'B1' }] } }) }); });
  await openNav(page, 'b:tb');
  // שתי קורות זהות — קבוצה אחת; "ערוך את כולן" ← לשונית אלכסוני Y
  await expect(page.getByTestId('tb-grp-1')).toHaveCount(0);
  await page.getByTestId('tb-grp-0-edit').click();
  await page.getByTestId('ks-sec-geo').click(); // 1.63: אלכסוני Y — גיאומטריה
  await page.getByTestId('tb-knee-T1').check();
  const t = (await S(page)).project.building.transfers;
  expect(t.every((x: any) => x.knee?.enabled)).toBe(true);
  expect(await count(page, '^KT\\.')).toBe(4);
  expect((await S(page)).derived.issues.filter((i: any) => i.severity === 'error')).toEqual([]);
  // קורה אחת מהרשימה — הופכת לחריג (קבוצה שנייה); "החל על כל הקורות בציר" מחזיר לקבוצה אחת
  await page.getByTestId('ks-sec-loc').click();
  await page.getByTestId('tb-row-T2').click();
  await page.evaluate(() => { const k = (window as any).__ksp; k.store.exec({ label: 't', run: (p: any) => ({ ...p, building: { ...p.building, transfers: p.building.transfers.map((x: any) => (x.id === 'T2' ? { ...x, profile: 'IPE330' } : x)) } }) }); });
  await page.getByTestId('ks-sec-loc').click();
  await expect(page.getByTestId('tb-grp-1')).toBeVisible();
  await page.getByTestId('tb-grp-0-edit').click();
  await page.getByTestId('ks-sec-geo').click();
  await page.getByTestId('tb-apply-line-T1').click();
  await page.getByTestId('ks-sec-loc').click();
  await expect(page.getByTestId('tb-grp-1')).toHaveCount(0);
  await shot(page, 'V141_02_groups');
  expect(errors).toEqual([]);
});
