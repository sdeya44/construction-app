import { expect, test } from '@playwright/test';
import { boot, openNav, shot } from './helpers';

/** 1.55: חלון רכיב — קשיחות קירות ואלכסוני עמוד-קורה: אותו חלון מהריבון ומלחיצה במודל, תלת-ממד ריאליסטי חי, מחברים */
async function gable(page: import('@playwright/test').Page) {
  await page.getByTestId('btn-new').click();
  await page.getByTestId('np-gable').click();
  await page.getByTestId('wz-step-4').click();
  if (!(await page.getByTestId('np-knee').isChecked())) await page.getByTestId('np-knee').check();
  await page.getByTestId('create').click();
  await page.waitForTimeout(600);
}

test('CW-01: כלי "קשיחות קירות" פותח חלון רכיב צף, אריחי סוג עם תמונה מרונדרת ומחברים', async ({ page }) => {
  const errors = await boot(page);
  await gable(page);
  await openNav(page, 'b:walls');
  const win = page.getByTestId('cwin-walls');
  await expect(win).toBeVisible();
  await win.getByTestId('br-walls-portal').click();
  await win.getByTestId('ks-sec-geo').click();
  await expect(win.getByTestId('live3d-canvas')).toHaveCount(0); // 1.63: בלי תלת-ממד באשף — המודל הראשי מציג ומדגיש
  await expect(win.getByTestId('ks-geo')).toBeVisible();
  // 1.55.1: המודל נשאר במסך מלא — החלון צף מעליו
  const w = await page.evaluate(() => (window as any).__ksp.viewport.panes[0].el.getBoundingClientRect().width);
  expect(w).toBeGreaterThan(1600 * 0.8); // 1.59: סרגל השלבים עם שמות
  // מזעור: החלון הופך לפס, והמודל גלוי; לחיצה נוספת מחזירה
  await win.getByTestId('cwin-min').click();
  await expect(win.getByTestId('ks-geo')).toBeHidden();
  await win.getByTestId('cwin-min').click();
  await expect(win.getByTestId('ks-geo')).toBeVisible();
  // גרירת הכותרת מזיזה את החלון
  const b0 = (await win.boundingBox())!;
  await page.mouse.move(b0.x + b0.width / 2, b0.y + 20); await page.mouse.down(); await page.mouse.move(b0.x + b0.width / 2 - 200, b0.y + 60, { steps: 5 }); await page.mouse.up();
  const b1 = (await win.boundingBox())!;
  expect(b0.x - b1.x).toBeGreaterThan(150);
  await win.getByTestId('br-walls-portal').click();
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => (window as any).__ksp.store.state.derived.members.some((m: any) => /^BB\./.test(m.id)))).toBe(true);
  // אריחי הסוג: תמונה מרונדרת מהמודל (מחליפה את הציור כשמוכנה)
  await expect(win.locator('img[data-real]').first()).toBeVisible({ timeout: 15000 });
  await win.getByTestId('ks-sec-conn').click();
  await expect(win.getByTestId('ks-cg-0')).toBeVisible();
  await win.getByTestId('ks-wizard').click();
  expect(await page.evaluate(() => (window as any).__ksp.store.state.connWizard)).toMatch(/^C\.BB\./);
  await shot(page, 'CW_01_walls');
  expect(errors).toEqual([]);
});

test('CW-02: לחיצה על אלכסון עמוד-קורה במודל פותחת את אותו חלון רכיב, עם ההגדרות של המכלול', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => { localStorage.removeItem('ksp-prop-scope'); (window as any).__ksp.store.set({ propScope: null }); });
  await gable(page);
  await page.evaluate(() => { const k = (window as any).__ksp; const id = k.store.state.derived.members.find((m: any) => m.id.startsWith('KB.') && m.kind !== 'plate' && m.kind !== 'bolt').id; k.store.select([id]); });
  const win = page.getByTestId('cwin-knee');
  await expect(win).toBeVisible();
  await expect(win.getByTestId('knee-studio')).toBeVisible();
  // 1.56: היקף ברירת מחדל מאלמנט — המיקום שלו (בכל המסגרות)
  await expect(win.getByTestId('pscope-loc')).toHaveClass(/on/);
  await win.getByTestId('ks-sec-conn').click();
  await expect(win.getByTestId('kb-detail')).toBeVisible();
  await shot(page, 'CW_02_knee');
  // סגירה — המודל במסך מלא
  await win.getByTestId('cwin-close').click();
  await expect(page.getByTestId('cwin-knee')).toBeHidden();
  expect(errors).toEqual([]);
});

test('CW-03 (1.55.2): מקום אחד לכל נושא — חיבור של הרכיב, שורת הגיליון ופאנל צף; מזעור נשמר בלחיצה על שטח ריק', async ({ page }) => {
  const errors = await boot(page);
  const vpW = () => page.evaluate(() => (window as any).__ksp.viewport.panes[0].el.getBoundingClientRect().width);
  // פאנל המאפיינים צף — המודל לא מצטמצם
  await page.evaluate(() => (window as any).__ksp.store.select(['F2.COL.L']));
  await expect(page.getByTestId('fpanel')).toBeVisible();
  expect(await vpW()).toBeGreaterThan(1600 * 0.8);
  // עורך חיבור של קשיחות קירות נפתח בתוך חלון הרכיב (לא בפאנל נפרד)
  const cid = await page.evaluate(() => (window as any).__ksp.store.state.derived.connections.find((c: any) => /^C\.BR\.W/.test(c.id))?.id);
  expect(cid).toBeTruthy();
  await page.evaluate((c) => (window as any).__ksp.store.set({ activeConn: c }), cid);
  await expect(page.getByTestId('cwin-walls')).toBeVisible();
  await page.evaluate(() => (window as any).__ksp.store.set({ activeConn: null }));
  // גיליון הפרמטרים: שורת קשיחות קירות אינה עורכת — פותחת את החלון
  await openNav(page, 's:sheet');
  await page.getByTestId('ps-קשיחות קירות — חתך').click();
  await expect(page.getByTestId('cwin-walls')).toBeVisible();
  // מזעור, ולחיצה על שטח ריק במודל — החלון נשאר ממוזער
  await page.getByTestId('cwin-min').click();
  await expect(page.getByTestId('cwin-walls')).toHaveClass(/min/);
  const pr = (await page.getByTestId('viewport').boundingBox())!;
  await page.mouse.click(pr.x + 40, pr.y + pr.height - 120);
  await page.waitForTimeout(300);
  await expect(page.getByTestId('cwin-walls')).toHaveClass(/min/);
  // חלון פתוח — לחיצה במודל מעדיפה את אלמנטי הרכיב
  expect(await page.evaluate(() => (window as any).__ksp.store.state.pickPrefer)).toContain('BR');
  expect(errors).toEqual([]);
});
