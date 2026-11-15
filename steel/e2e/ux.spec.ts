import { expect, test } from '@playwright/test';
import { boot, selection, setView, shot } from './helpers';

/** חוויה ה׳: סרגל הקשרי, כרטיס פרט חיבור, בחירה מרובה עם "משתנה", תפריט מעגלי, לוח פקודות. */
test('UX-01: סרגל הקשרי וכרטיס חיבור לאלמנט בודד; פתיחת עורך מהכרטיס', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => (window as any).__ksp.store.select(['F3.RAF.L']));
  await expect(page.getByTestId('ctxbar')).toBeVisible();
  await expect(page.getByTestId('ctx-profile')).toContainText('IPE300');
  await expect(page.getByTestId('conncard')).toBeVisible();
  await expect(page.getByTestId('cc-title')).toContainText('שתי פלטות');
  await shot(page, 'UX-01_single');
  // שינוי חתך מהסרגל ההקשרי
  await page.getByTestId('ctx-profile').click();
  await page.getByTestId('ctx-profile-inp').fill('IPE330'); await page.getByTestId('ctx-profile-inp').press('Enter');
  expect(await page.evaluate(() => (window as any).__ksp.store.state.derived.byId.get('F3.RAF.L').profile)).toBe('IPE330');
  await page.getByTestId('btn-undo').click();
  // מעבר בין החיבורים בכרטיס ופתיחה בעורך
  await page.getByTestId('cc-next').click();
  await expect(page.getByTestId('cc-title')).toContainText('רכס');
  await page.getByTestId('cc-open').click();
  await expect(page.getByTestId('conn-id')).toHaveText('C.RIDGE.F3');
  await expect(page.getByTestId('conncard')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('UX-02: בחירה מרובה — "משתנה" אינו משנה דבר; ערך חדש חל על כולם בפקודה אחת', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const s = (window as any).__ksp.store;
    s.exec({ label: 't', run: (p: any) => ({ ...structuredClone(p), memberOverrides: { 'F1.RAF.L': { material: 'S355' } } }) });
    s.select(['F1.RAF.L', 'F2.RAF.L', 'F3.RAF.L']);
  });
  await expect(page.getByTestId('ctx-count')).toHaveText('3 נבחרו');
  await expect(page.getByTestId('multi-material')).toHaveValue('');
  await expect(page.getByTestId('multi-material')).toHaveClass(/varies/);
  // חתך משותף — שינוי חל על שלושתם; ביטול אחד מחזיר
  await page.getByTestId('multi-profile').fill('IPE360'); await page.getByTestId('multi-profile').press('Enter');
  // קורה רחבה יותר ⇒ אום מתנגש באגף — חלון בדיקת הפלטה קופץ
  await expect(page.getByTestId('eave-check')).toBeVisible();
  await page.getByTestId('eave-keep').click();
  const prof = () => page.evaluate(() => ['F1.RAF.L', 'F2.RAF.L', 'F3.RAF.L'].map((id) => (window as any).__ksp.store.state.derived.byId.get(id).profile));
  expect(await prof()).toEqual(['IPE360', 'IPE360', 'IPE360']);
  const mats = await page.evaluate(() => ['F1.RAF.L', 'F2.RAF.L'].map((id) => (window as any).__ksp.store.state.derived.byId.get(id).material));
  expect(mats).toEqual(['S355', 'S235']); // החומר ה"משתנה" לא נדרס
  await page.keyboard.press('Control+z');
  expect(await prof()).toEqual(['IPE300', 'IPE300', 'IPE300']);
  // בחר דומים
  await page.getByTestId('ctx-similar').click();
  expect((await selection(page)).length).toBe(12);
  await shot(page, 'UX-02_multi');
});

test('UX-03: תפריט מעגלי בלחיצה ימנית ולוח פקודות Ctrl+K', async ({ page }) => {
  await boot(page);
  await setView(page, 'front');
  const c = await page.evaluate(() => (window as any).__ksp.viewport.screenOf({ x: 0, y: 0, z: 3000 }, 0));
  await page.mouse.click(c.x, c.y, { button: 'right' });
  await expect(page.getByTestId('marking-menu')).toBeVisible();
  expect(await selection(page)).toEqual(['F1.COL.L']);
  await shot(page, 'UX-03_marking_menu');
  await page.getByTestId('mm-isolate').click();
  expect(await page.evaluate(() => (window as any).__ksp.store.state.isolated)).toEqual(['F1.COL.L']);
  await expect(page.getByTestId('marking-menu')).toHaveCount(0);
  // לוח פקודות: פקודה
  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('cmdk')).toBeVisible();
  await page.getByTestId('cmdk-input').fill('הצג הכל');
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => (window as any).__ksp.store.state.isolated)).toBeNull();
  // לוח פקודות: חיפוש אלמנט
  await page.keyboard.press('Control+k');
  await page.getByTestId('cmdk-input').fill('PL.R.04');
  await page.getByTestId('cmdk-el-PL.R.04').click();
  expect(await selection(page)).toEqual(['PL.R.04']);
  // ניווט למצב
  await page.getByTestId('cmdk-open').click();
  await page.getByTestId('cmdk-input').fill('ייצור');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('prod-tab-1')).toBeVisible();
});

test('UX-04: לשונית חיבורים — חיבורי המשך ופחי קושרות ברשימה; פתיחה בעורך', async ({ page }) => {
  await boot(page);
  await page.getByTestId('rail-conns').click();
  await expect(page.getByTestId('conns-panel')).toBeVisible();
  await expect(page.getByTestId('conns-brace-end')).toContainText('32');
  await expect(page.getByTestId('conns-brace-cross')).toContainText('8');
  await page.getByTestId('conns-brace-cross').click();
  await page.getByText('C.BR.R1.L.X', { exact: true }).click();
  await expect(page.getByTestId('conn-id')).toHaveText('C.BR.R1.L.X');
  await shot(page, 'UX-04_brace_cross');
});

test('UX-05: עץ תפריטים — בחירת צומת מציגה טבלה; שורה בוחרת אלמנט / פותחת חיבור', async ({ page }) => {
  await boot(page);
  await page.getByTestId('tab-tree').click();
  await page.getByTestId('nav-k:column').click();
  await expect(page.getByTestId('table-column')).toContainText('F1.COL.L');
  await page.getByTestId('table-column').getByText('F3.COL.R', { exact: true }).click();
  expect(await selection(page)).toEqual(['F3.COL.R']);
  await page.getByTestId('tab-conns').click();
  await page.getByTestId('nav-c:eave').click();
  await page.getByTestId('ctable-eave').getByText('EAVE.F2.L', { exact: true }).click();
  await expect(page.getByTestId('conn-id')).toHaveText('C.EAVE.F2.L');
  await expect(page.getByTestId('cp-split')).toHaveValue('1');
  await page.getByTestId('nav-s:frames').click();
  await expect(page.getByTestId('frames-table')).toBeVisible();
  await expect(page.getByTestId('width')).toHaveCount(0); // צומת משני מציג רק את החלק שלו
  await shot(page, 'UX-05_tree');
});

test('UX-06: שינוי פרופיל עמוד/קורה — חלון בדיקת פלטת ראש עמוד עם התנגשות והצעה; החלה מתקנת', async ({ page }) => {
  await boot(page);
  await page.getByTestId('tab-structure').click();
  await page.getByTestId('columnProfile').fill('HEA300'); await page.getByTestId('columnProfile').press('Enter');
  await expect(page.getByTestId('eave-check')).toBeVisible();
  await expect(page.getByTestId('eave-cur')).toContainText('התנגשות');
  await expect(page.getByTestId('eave-sug')).toContainText('תקין');
  await shot(page, 'UX-06_eave_check');
  await page.getByTestId('eave-apply-default').click();
  await expect(page.getByTestId('eave-check')).toHaveCount(0);
  const n = await page.evaluate(() => (window as any).__ksp.store.state.derived.issues.filter((i: any) => i.code === 'EAVE_FIT').length);
  expect(n).toBe(0);
});

test('SEC-01: חתך מודולרי — תבנית גג מדורג, הוספת ציר, אלכסונים; שגיאה כשמישור עובר דרך עמוד גבוה', async ({ page }) => {
  await boot(page);
  page.on('dialog', (d) => d.accept());
  await page.getByTestId('nav-s:geometry').click();
  await page.getByTestId('tpl-stepped').click();
  const n = () => page.evaluate(() => { const d = (window as any).__ksp.store.state.derived; return { cols: d.members.filter((m: any) => m.kind === 'column').length, side: d.connections.filter((c: any) => c.type === 'rafter-side').length, err: d.issues.filter((i: any) => i.severity === 'error').length, knee: d.connections.filter((c: any) => c.type === 'knee').length }; });
  expect(await n()).toEqual({ cols: 18, side: 6, err: 0, knee: 0 });
  await page.getByTestId('kb-on').check();
  expect((await n()).knee).toBe(24);
  // ציר חדש ב-26 מ' — מחוץ לכל מישור גג: שגיאת טופולוגיה מדווחת (ואין גיאומטריה עד לתיקון)
  await page.getByTestId('sec-add-line').click();
  expect((await n()).err).toBeGreaterThan(0);
  await expect(page.getByTestId('chip-errors')).toBeVisible();
  await page.getByTestId('btn-undo').click();
  expect((await n()).err).toBe(0);
  await setView(page, 'front');
  await shot(page, 'SEC-01_stepped');
});
