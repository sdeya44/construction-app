import { expect, test } from '@playwright/test';
import { boot, openNav } from './helpers';

/**
 * F12 (1.113): שמות וכפתורים בספריות — ספריית פרטים (פרטים מהסטודיו/ייבוא) מול הגדרות שמורות לחיבורים (פרט + ערכי פרמטרים).
 * שינוי בממשק בלבד: מבנה הנתונים (`customDetails`, `connLibrary`) לא השתנה.
 */
test('LIBN-E1: שמות עקביים — "ספריית פרטים" מול "הגדרות שמורות לחיבורים", הסבר ביניהן, ומזהי בדיקה ייחודיים בשתי הספריות', async ({ page }) => {
  const errors = await boot(page);
  await openNav(page, 'c:library');
  await expect(page.getByTestId('detail-library')).toBeVisible();
  await expect(page.getByTestId('lib-explain')).toContainText('הגדרות שמורות לחיבורים');
  await expect(page.getByTestId('open-conn-library')).toContainText('הגדרות שמורות לחיבורים');
  await expect(page.getByTestId('lib-export')).toHaveText('ייצוא פרטים');
  await expect(page.getByTestId('lib-import')).toHaveText('ייבוא פרטים');
  await expect(page.getByTestId('lib-add-builtin')).toContainText('פרטים מוכנים');
  await expect(page.getByTestId('lib-add-builtin')).not.toContainText('מחברים');
  // שתי הספריות פתוחות יחד: כל מזהה בדיקה מופיע פעם אחת (בעבר lib-import/lib-export היו כפולים)
  await page.getByTestId('open-conn-library').click();
  await expect(page.getByTestId('conn-library')).toBeVisible();
  await expect(page.getByTestId('conn-library')).toContainText('הגדרות שמורות לחיבורים — הפרויקט הפתוח');
  await expect(page.getByTestId('cp-explain')).toContainText('הגדרה שמורה = פרט');
  await expect(page.getByTestId('lib-import')).toHaveCount(1); await expect(page.getByTestId('lib-export')).toHaveCount(1);
  await expect(page.getByTestId('cp-import')).toHaveCount(1); await expect(page.getByTestId('cp-export')).toHaveCount(1);
  await expect(page.getByTestId('cp-import')).toHaveText('ייבוא סטנדרט חברה');
  // הנתונים לא השתנו: אין שדה חדש בפרויקט
  const keys = await page.evaluate(() => Object.keys((window as any).__ksp.store.state.project).filter((k) => /lib|detail/i.test(k)).sort());
  expect(keys.every((k) => ['customDetails', 'connLibrary', 'connDefaults', 'detailAssign', 'detailParams'].includes(k))).toBe(true);
  expect(errors).toEqual([]);
});

test('LIBN-E2: באשף החיבורים — "הגדרות שמורות לחיבורים" ו"שמור כהגדרה שמורה" (המזהים והתנהגות השמירה ללא שינוי)', async ({ page }) => {
  const errors = await boot(page);
  page.on('dialog', (d) => d.accept('זוויתן בדיקה'));
  await page.evaluate(() => { const k = (window as any).__ksp; k.store.exec({ label: 't', run: (p: any) => ({ ...p, building: { ...p.building, kneeBraces: { ...(p.building.kneeBraces ?? {}), enabled: true, profile: 'L50x5', drop: 800, reach: 800, angle: 45, plateT: 10, plateW: 150, plateL: 250, bolt: { d: 16, grade: '8.8', standard: 'ISO 4017', clearance: 2 }, gauge: 80, pitch: 200, weldSize: 5, exclude: [] } } }) }); });
  const cid = await page.evaluate(() => (window as any).__ksp.store.state.derived.connections.find((c: any) => c.id.startsWith('C.KB.')).id);
  await page.evaluate((i) => (window as any).__ksp.store.set({ activeConn: i }), cid);
  await page.getByTestId('ks-sec-conn').click();
  await page.getByTestId('ks-wizard').click();
  await expect(page.getByTestId('wiz-library')).toHaveText('הגדרות שמורות לחיבורים');
  await expect(page.getByTestId('wiz-save')).toHaveText('שמור כהגדרה שמורה');
  await page.getByTestId('wiz-save').click();
  const n = await page.evaluate(() => ((window as any).__ksp.store.state.project.connLibrary ?? []).length);
  expect(n).toBe(1);
  await page.getByTestId('wiz-library').click();
  const lib = await page.evaluate(() => (window as any).__ksp.store.state.project.connLibrary);
  expect(lib[0].name).toBe('זוויתן בדיקה');
  await expect(page.getByTestId(`lib-${lib[0].id}`)).toBeVisible();
  expect(errors).toEqual([]);
});
