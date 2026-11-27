import { expect, test, type Page } from '@playwright/test';
import { boot } from './helpers';

/**
 * CPAR-E1: ערכי גבול בשדות עורך החיבור (חיבור ראש עמוד) לפי הכללים הקיימים ב-`checkPlate`: ריק/לא מספרי — מסומן כשגוי ואינו נשמר;
 * 0 / שלילי / מספר ברגים מחוץ ל-1–8 — הפקודה נדחית עם הסבר, המודל אינו משתנה, והשדה חוזר לערך השמור. גיאומטריה בלבד — לא תכן חוזק.
 */
const eaveT = (page: Page) => page.evaluate(() => { const p = (window as any).__ksp.store.state.project; return { t: p.connectionOverrides['C.EAVE.F2.L']?.t ?? null, cols: p.connectionOverrides['C.EAVE.F2.L']?.cols ?? null }; });
const toast = (page: Page) => page.getByTestId('toasts');

test('CPAR-E1: עורך חיבור — ערכי גבול בעובי/ברגים: הסבר, בלי שינוי במודל, והשדה חוזר לערך השמור', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => (window as any).__ksp.store.select(['F2.RAF.L']));
  if (!(await page.getByTestId('endc-open-C.EAVE.F2.L').count())) await page.getByTestId('el-end-end').click();
  await page.getByTestId('endc-open-C.EAVE.F2.L').click();
  await expect(page.getByTestId('conn-id')).toHaveText('C.EAVE.F2.L');
  const set = async (id: string, v: string) => { const f = page.getByTestId(id); await f.fill(v); await f.press('Enter'); };
  await set('cp-t', '25'); await expect.poll(() => eaveT(page).then((x) => x.t)).toBe(25);
  // ריק / לא מספרי: מסומן כשגוי, לא נשמר
  for (const bad of ['', 'abc']) { await set('cp-t', bad); await expect(page.getByTestId('cp-t')).toHaveClass(/bad/); expect((await eaveT(page)).t).toBe(25); }
  // 0 ושלילי: נדחים עם הסבר, והשדה חוזר ל-25
  await set('cp-t', '0'); await expect(toast(page)).toContainText('עובי פלטה חייב להיות חיובי'); await expect(page.getByTestId('cp-t')).toHaveValue('25'); expect((await eaveT(page)).t).toBe(25);
  await set('cp-t', '-5'); await expect(toast(page)).toContainText('ערך לא תקין'); await expect(page.getByTestId('cp-t')).toHaveValue('25'); expect((await eaveT(page)).t).toBe(25);
  // מספר ברגים: 0 ו-9 נדחים, 2.5 מעוגל (לפי הקוד הקיים) לערך תקין
  const cols0 = (await eaveT(page)).cols;
  for (const bad of ['0', '9']) { await set('cp-cols', bad); await expect(toast(page)).toContainText('מספר ברגים 1–8'); expect((await eaveT(page)).cols).toBe(cols0); }
  expect(errors).toEqual([]);
});
