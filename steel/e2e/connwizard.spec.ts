import { expect, test } from '@playwright/test';
import { boot, shot } from './helpers';

const S = (page: import('@playwright/test').Page) => page.evaluate(() => (window as any).__ksp.store.state);

test('CW-01: אשף חיבורים — מעורך החיבור: מצב, הצעות מדורגות עם סיבה, בדיקה, החלה למיקום / לכולם, שמירה לספרייה וברירת מחדל', async ({ page }) => {
  const errors = await boot(page);
  page.on('dialog', (d) => d.accept('זוויתן 2 ברגים'));
  await page.evaluate(() => { const k = (window as any).__ksp; k.store.exec({ label: 't', run: (p: any) => ({ ...p, building: { ...p.building, kneeBraces: { ...(p.building.kneeBraces ?? {}), enabled: true, profile: 'L50x5', drop: 800, reach: 800, angle: 45, plateT: 10, plateW: 150, plateL: 250, bolt: { d: 16, grade: '8.8', standard: 'ISO 4017', clearance: 2 }, gauge: 80, pitch: 200, weldSize: 5, exclude: [] } } }) }); });
  const cid = await page.evaluate(() => (window as any).__ksp.store.state.derived.connections.find((c: any) => c.id.startsWith('C.KB.')).id);
  await page.evaluate((i) => (window as any).__ksp.store.set({ activeConn: i }), cid);
  await page.getByTestId('conn-wizard-open').click();
  await expect(page.getByTestId('conn-wizard')).toBeVisible();
  await expect(page.getByTestId('wiz-c-knee.angle')).toContainText('נוכחי');
  await expect(page.getByTestId('wiz-c-knee.fin')).toHaveCount(0); // לא מתאים — מוסתר כברירת מחדל
  await page.getByTestId('wiz-all').click();
  await expect(page.getByTestId('wiz-c-knee.fin')).toContainText('דורש פרופיל חלול');
  await expect(page.getByTestId('wiz-check')).toContainText('התנגשויות: 0');
  await shot(page, 'CW_01_wizard');
  // פלטת קצה — רק למיקום הזה
  await page.getByTestId('wiz-c-knee.flange').click();
  await page.getByTestId('wiz-scope-one').check();
  await page.getByTestId('wiz-apply').click();
  let kb = (await S(page)).project.building.kneeBraces;
  expect(Object.values(kb.sides ?? {}).some((o: any) => o.detail === 'flange')).toBe(true);
  expect(kb.detail ?? 'fin').not.toBe('flange');
  // שוב: זוויתן, 2 ברגים לקצה — לכולם + שמירה לספרייה
  await page.getByTestId('conn-wizard-open').click();
  await page.getByTestId('wiz-c-knee.angle').click();
  await page.getByTestId('wiz-p-boltsPerEnd').selectOption('4');
  await page.getByTestId('wiz-save').click();
  await page.getByTestId('wiz-scope-all').check();
  await page.getByTestId('wiz-apply').click();
  kb = (await S(page)).project.building.kneeBraces;
  expect(kb.boltsPerEnd).toBe(4);
  const lib = (await S(page)).project.connLibrary;
  expect(lib.length).toBe(1);
  // ספרייה: ברירת מחדל ומחיקה
  await page.evaluate(() => (window as any).__ksp.store.set({ connLibraryOpen: true }));
  await page.getByTestId(`lib-def-${lib[0].id}`).click();
  expect((await S(page)).project.connDefaults.knee).toBe(lib[0].id);
  await shot(page, 'CW_02_library');
  expect((await S(page)).derived.issues.filter((i: any) => i.severity === 'error')).toEqual([]);
  expect(errors).toEqual([]);
});

test('CW-02: מכרטיס הקצה של עמוד — "החלף פרט" לעמוד-קורה: פלטה אחת לחיבור הזה בלבד; קושרת גג — רק "כולם"', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => (window as any).__ksp.store.select(['F3.COL.L']));
  await page.getByTestId('endc-wiz-C.EAVE.F3.L').click();
  await expect(page.getByTestId('conn-wizard')).toBeVisible();
  await expect(page.getByTestId('wiz-c-eave.split')).toContainText('נוכחי');
  await page.getByTestId('wiz-c-eave.single').click();
  await page.getByTestId('wiz-scope-one').check();
  await page.getByTestId('wiz-apply').click();
  const ov = await page.evaluate(() => (window as any).__ksp.store.state.project.connectionOverrides['C.EAVE.F3.L']);
  expect(ov.split).toBe(false);
  expect(await page.evaluate(() => (window as any).__ksp.store.state.project.connectionDefaults.eave.split)).not.toBe(false);
  // קושרת גג: הגדרה כללית אחת — אין "החיבור הזה"
  const rc = await page.evaluate(() => (window as any).__ksp.store.state.derived.connections.find((c: any) => c.id.startsWith('C.BR.R')).id);
  await page.evaluate((i) => (window as any).__ksp.store.set({ connWizard: i }), rc);
  await expect(page.getByTestId('wiz-scope-one')).toHaveCount(0);
  await expect(page.getByTestId('wiz-c-roofx.rod')).toBeVisible();
  await page.getByTestId('wiz-c-roofx.rod').click();
  await page.getByTestId('wiz-apply').click();
  expect(await page.evaluate(() => (window as any).__ksp.store.state.project.building.bracing.roof.endDetail)).toBe('rod');
  expect(await page.evaluate(() => (window as any).__ksp.store.state.derived.issues.filter((i: any) => i.severity === 'error'))).toEqual([]);
  expect(errors).toEqual([]);
});
