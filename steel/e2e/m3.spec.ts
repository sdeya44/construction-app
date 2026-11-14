import { expect, test } from '@playwright/test';
import { boot, shot } from './helpers';

const conn = (page: any, id: string) => page.evaluate((i: string) => { const c = (window as any).__ksp.store.state.derived.connById.get(i); return c && { bolts: c.bolts.length, status: c.status, overridden: c.overridden, parts: c.parts }; }, id);

test.describe('M3 – תומכים וחיבורים', () => {
  test('CLEAT: תומך בכל מפגש, עורך חיבור עם חתך, שינוי גובה ידני נשמר ומדווח', async ({ page }) => {
    const errors = await boot(page);
    const n = await page.evaluate(() => { const d = (window as any).__ksp.store.state.derived; return { cleats: d.members.filter((m: any) => m.kind === 'cleat').length, sup: d.supports.length, clash: d.issues.filter((i: any) => i.code === 'CLASH').length }; });
    expect(n).toEqual({ cleats: 84, sup: 84, clash: 0 });
    await page.evaluate(() => (window as any).__ksp.store.select(['CL.PL.L.02.F2']));
    await page.getByTestId('open-conn-C.PC.PL.L.02.F2').click();
    await expect(page.getByTestId('conn-type')).toContainText('זוויתן');
    // החתך נגזר מהמודל: חתך ממולא לפטה ולזוויתן
    expect(await page.locator('[data-testid=conn-section] polygon').count()).toBeGreaterThanOrEqual(2);
    await expect(page.getByTestId('conn-bolts')).toContainText('2× M12×35 8.8');
    await expect(page.getByTestId('conn-no-issues')).toBeVisible();
    await page.getByTestId('conn-show3d').click();
    await page.waitForTimeout(500);
    await shot(page, 'CLEAT_editor_3d');
    // גובה ידני לתומך זה בלבד
    await page.getByTestId('cl-h').fill('150'); await page.getByTestId('cl-h').press('Enter');
    const issues = await page.evaluate(() => (window as any).__ksp.store.state.derived.issues.filter((i: any) => i.code === 'CLEAT_MANUAL').map((i: any) => i.elementId));
    expect(issues).toEqual(['CL.PL.L.02.F2']);
    expect((await conn(page, 'C.PC.PL.L.02.F2')).overridden).toBe(true);
    expect(errors).toEqual([]);
  });

  test('CLEAT-03/04: שינוי חתך פטה ושיפוע — התומכים מתעדכנים, אין התנגשות לא מדווחת', async ({ page }) => {
    await boot(page);
    await page.getByTestId('tab-roof').click();
    await page.getByTestId('left-profile').fill('C250x80x20x3'); await page.getByTestId('left-profile').press('Enter');
    const h = await page.evaluate(() => { const m = (window as any).__ksp.store.state.derived.byId.get('CL.PL.L.03.F3'); return m.profile; });
    expect(h).toBe('L250x80x8');
    await page.getByTestId('tab-structure').click();
    await page.getByTestId('slopeLeft').fill('25'); await page.getByTestId('slopeLeft').press('Enter');
    const res = await page.evaluate(() => { const d = (window as any).__ksp.store.state.derived; return { clash: d.issues.filter((i: any) => i.code === 'CLASH').length, err: d.issues.filter((i: any) => i.severity === 'error').length }; });
    expect(res).toEqual({ clash: 0, err: 0 });
    await page.getByTestId('tab-roof').click();
    await page.getByTestId('left-profile').fill('Z200x70x20x2.5'); await page.getByTestId('left-profile').press('Enter');
    const zc = await page.evaluate(() => (window as any).__ksp.store.state.derived.issues.filter((i: any) => i.code === 'CLASH').length);
    expect(zc).toBeGreaterThan(0); // Z: התנגשות התומך באגף העליון מדווחת
    await page.getByTestId('tab-issues').click();
    await expect(page.getByTestId('issues-panel')).toContainText('התנגשות');
    await shot(page, 'CLEAT_Z_clash_reported');
  });

  test('CONN-01: בחירת קורה ← חיבורים ← עריכה; שינוי פלטה/ברגים נשמר לאלמנט גם אחרי טעינה מחדש', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => (window as any).__ksp.store.select(['F2.RAF.L']));
    await page.getByTestId('open-conn-C.EAVE.F2.L').click();
    await expect(page.getByTestId('conn-id')).toHaveText('C.EAVE.F2.L');
    await page.getByTestId('cp-t').fill('25'); await page.getByTestId('cp-t').press('Enter');
    await page.getByTestId('cp-cols').fill('3'); await page.getByTestId('cp-cols').press('Enter');
    await page.getByTestId('cp-w').fill('260'); await page.getByTestId('cp-w').press('Enter');
    await page.getByTestId('conn-status').selectOption('for-review');
    let c = await conn(page, 'C.EAVE.F2.L');
    expect(c.bolts).toBe(6); expect(c.status).toBe('for-review'); expect(c.overridden).toBe(true);
    expect((await conn(page, 'C.EAVE.F3.L')).bolts).toBe(4);
    await page.getByTestId('conn-show3d').click();
    await page.waitForTimeout(500);
    await shot(page, 'CONN_eave_edited');
    await expect(page.getByTestId('save-state')).toHaveText('נשמר במחשב', { timeout: 5000 });
    await page.reload();
    await page.waitForFunction(() => !!(window as any).__ksp?.viewport?.model);
    c = await conn(page, 'C.EAVE.F2.L');
    expect(c.bolts).toBe(6); expect(c.status).toBe('for-review');
    const t = await page.evaluate(() => (window as any).__ksp.store.state.project.connectionOverrides['C.EAVE.F2.L'].t);
    expect(t).toBe(25);
  });

  test('חיבורי רכס ובסיס: עורך, תבנית שמורה ומוחלת', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => (window as any).__ksp.store.set({ activeConn: 'C.RIDGE.F3' }));
    await expect(page.getByTestId('conn-type')).toContainText('רכס');
    await page.getByTestId('conn-show3d').click();
    await page.waitForTimeout(400);
    await shot(page, 'CONN_ridge');
    await page.evaluate(() => (window as any).__ksp.store.set({ activeConn: 'C.BASE.F1.L', isolated: null }));
    await page.getByTestId('cp-t').fill('30'); await page.getByTestId('cp-t').press('Enter');
    await page.getByTestId('tpl-name').fill('בסיס 30');
    await page.getByTestId('tpl-save').click();
    await page.evaluate(() => (window as any).__ksp.store.set({ activeConn: 'C.BASE.F6.R' }));
    await page.getByRole('button', { name: 'החל כאן' }).click();
    const prof = await page.evaluate(() => (window as any).__ksp.store.state.derived.byId.get('C.BASE.F6.R.PL').profile);
    expect(prof).toBe('PL320x30');
    await page.getByTestId('conn-show3d').click();
    await page.waitForTimeout(400);
    await shot(page, 'CONN_base');
  });
});
