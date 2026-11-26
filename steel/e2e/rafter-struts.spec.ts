import { expect, test } from '@playwright/test';
import { boot, shot, openNav } from './helpers';

test('RS-01: תמוכות בין הקורות — שורה מציר א לכיוון ב, הקושרות מתחלקות לפיה, חלוקה ידנית מבוטלת עם התראה', async ({ page }) => {
  const errors = await boot(page);
  await openNav(page, 'b:roof');
  const S = () => page.evaluate(() => (window as any).__ksp.store.state);
  await page.getByTestId('ks-sec-geo').click(); // 1.58: תמוכות — בגיאומטריה
  await page.getByTestId('rs-add').click();
  await page.getByTestId('rs-dist-0').fill('4000'); await page.getByTestId('rs-dist-0').press('Enter');
  const st = await page.evaluate(() => (window as any).__ksp.store.state.derived.members.filter((m: any) => /^RS1\.\d+$/.test(m.id)).length);
  const nb = (await S()).project.building.frames.length - 1;
  expect(st).toBe(nb);
  // רק מפתחי קושרות הגג
  await page.getByTestId('rs-bays-0').selectOption('roof');
  const bays = await page.evaluate(() => (window as any).__ksp.store.state.project.building.bracing.rafterStruts.rows[0].bays);
  const roofBays = await page.evaluate(() => (window as any).__ksp.store.state.project.building.bracing.roof.bays);
  expect(bays.length).toBeGreaterThan(0);
  expect(bays.length).toBeLessThan(nb);
  void roofBays;
  // קושרות הגג בקטע עם תמוכה: 2 פנלים; התמוכה מסומנת בתוכנית
  const b0 = bays[0];
  const seg = await page.evaluate(() => (window as any).__ksp.store.state.derived.roofSegments[0].id);
  await page.getByTestId('ks-sec-loc').click();
  expect(await page.getByTestId(`br-grid-rs-${b0}-${seg}`).count()).toBeGreaterThan(0); // קו אופקי — גובה 0, נבדק לפי קיום
  // לחיצה על התא: X → 2X — חלוקה ידנית; עם התמוכה — התראה
  await page.getByTestId(`br-grid-${b0}-${seg}`).click();
  await expect(page.getByTestId('wz-valid')).toContainText('בוטלה'); // תקינות בראש האשף
  await page.getByTestId('ks-sec-geo').click();
  await expect(page.getByTestId('rs-issues')).toContainText('בוטלה');
  const issues = await page.evaluate(() => (window as any).__ksp.store.state.derived.issues.filter((i: any) => i.code === 'CLASH'));
  expect(issues).toEqual([]);
  await shot(page, 'RS_01_struts');
  // פרט חיבור: פח + לשונית בחריץ (כללי), ריתוך בשורה בלבד; ובעורך החיבור — חזרה לפלטת קצה
  await page.getByTestId('rs-detail-fin').first().click();
  const tongues = () => page.evaluate(() => (window as any).__ksp.store.state.derived.members.filter((m: any) => /^C\.RS1\..*\.T$/.test(m.id)).length);
  expect(await tongues()).toBeGreaterThan(0);
  await page.getByTestId('rs-detail-0').selectOption('weld');
  expect(await tongues()).toBe(0);
  expect(await page.evaluate(() => (window as any).__ksp.store.state.derived.connections.filter((c: any) => c.id.startsWith('C.RS1.')).every((c: any) => c.bolts.length === 0))).toBe(true);
  await page.getByTestId('rs-detail-0').selectOption('');
  const cid = await page.evaluate(() => (window as any).__ksp.store.state.derived.connections.find((c: any) => c.id.startsWith('C.RS1.')).id);
  await page.evaluate((i) => (window as any).__ksp.store.set({ activeConn: i }), cid);
  await page.getByTestId('pw-rs').getByTestId('rs-detail-endplate').click();
  expect(await page.evaluate(() => (window as any).__ksp.store.state.project.building.bracing.rafterStruts.detail)).toBe('endplate');
  await shot(page, 'RS_01_conn');
  expect(await page.evaluate(() => (window as any).__ksp.store.state.derived.issues.filter((i: any) => i.code === 'CLASH'))).toEqual([]);
  expect(errors).toEqual([]);
});

test('RS-02: תיבת "בנה ממתכון" — פרט החיבור לווב נבנה ממתכון ובכיבוי חוזר לקוד הישן', async ({ page }) => {
  const errors = await boot(page);
  await openNav(page, 'b:roof');
  await page.getByTestId('ks-sec-geo').click();
  await page.getByTestId('rs-add').click();
  await page.getByTestId('rs-dist-0').fill('4000'); await page.getByTestId('rs-dist-0').press('Enter');
  const custom = () => page.evaluate(() => (window as any).__ksp.store.state.derived.connections.filter((c: any) => c.custom && /^RS1\./.test(c.custom.site)).length);
  expect(await custom()).toBe(0);
  await page.getByTestId('rs-recipe').check();
  expect(await custom()).toBeGreaterThan(2);
  await page.getByTestId('rs-detail-fin').first().click();
  expect(await custom()).toBeGreaterThan(2);
  await page.getByTestId('rs-recipe').uncheck();
  expect(await custom()).toBe(0);
  expect(errors).toEqual([]);
});
