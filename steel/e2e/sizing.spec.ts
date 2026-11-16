import { expect, test } from '@playwright/test';
import { boot, shot } from './helpers';

test('SIZE-01: בדיקת גדלים — צביעה, מקרא, הסבר לאלמנט, בוחר פרופילים צבוע', async ({ page }) => {
  await boot(page);
  await page.getByTestId('tool-sizing').click();
  await expect(page.getByTestId('sizing-box')).toBeVisible();
  // ברירת המחדל: קורה IPE300 במפתח 18 מ' — קטן מדי לפי כללי האצבע
  await page.getByTestId('sz-rafter-small').click();
  const n = await page.evaluate(() => (window as any).__ksp.store.state.selection.length);
  expect(n).toBeGreaterThan(0);
  await page.evaluate(() => { const k = (window as any).__ksp; k.store.select(['F2.RAF.L']); });
  await expect(page.getByTestId('sz-note')).toContainText('מפתח 18.0');
  await shot(page, 'SIZE_01_colors');
  // שינוי סף: עומס שימושי נמוך — הספירה משתנה
  await page.getByTestId('sz-settings').click();
  await expect(page.getByTestId('szc-live')).toBeVisible();
  // בוחר פרופילים: קורות גג עם תגית הערכה
  await page.getByTestId('tool-sizing').click();
  await page.getByTestId('nav-s:profiles').click();
  await expect(page.getByTestId('rafterProfile-sz')).toContainText('קטן');
  await page.getByTestId('rafterProfile-size').selectOption('IPE400');
  await expect(page.getByTestId('rafterProfile-sz')).toContainText('סביר');
  await shot(page, 'SIZE_02_picker');
});

test('QUOTE-01 / ISO-01: הצעת מחיר, בידוד מכלול, סט PDF מלא', async ({ page }) => {
  await boot(page);
  // בידוד מכלול מאלמנט נבחר
  await page.evaluate(() => (window as any).__ksp.store.select(['F2.COL.L']));
  await page.getByTestId('ctx-isolate-asm').click();
  const iso = await page.evaluate(() => (window as any).__ksp.store.state.isolated?.length ?? 0);
  expect(iso).toBeGreaterThan(1);
  // הצעת מחיר
  await page.getByTestId('mode-production').click();
  const tabs = page.locator('[data-testid^="prod-tab-"]');
  await tabs.last().click();
  await expect(page.getByTestId('quote-prices')).toBeVisible();
  for (const [k, v] of [['steelPerKg', '5'], ['galvPerKg', '2'], ['boltPerUnit', '4'], ['fabHoursPerTon', '20'], ['hourRate', '120'], ['erectionPerTon', '1500']]) {
    const el = page.getByTestId(`qp-${k}`); await el.fill(v); await el.press('Enter');
  }
  await expect(page.getByTestId('quote-total')).toContainText('לק"ג');
  await shot(page, 'QUOTE_01');
  // סט PDF מלא עם סימניות
  await page.getByTestId('mode-drawings').click();
  await expect(page.getByTestId('dwg-pdf-all')).toBeEnabled();
});

test('CLAD-01: פרויקט חדש עם חיפוי והתאמת חתכים — פתח, כתב כמויות, IFC והצעת מחיר ללקוח', async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await boot(page);
  await page.getByTestId('btn-new').click();
  await expect(page.getByTestId('np-clad')).toBeChecked();
  await expect(page.getByTestId('np-autosize')).toBeChecked();
  await page.getByTestId('create').click();
  const st = () => page.evaluate(() => { const d = (window as any).__ksp.store.state.derived; return { err: d.issues.filter((i: any) => i.severity === 'error').length, girts: d.members.filter((m: any) => m.kind === 'girt').length }; });
  expect((await st()).err).toBe(0);
  expect((await st()).girts).toBeGreaterThan(40);
  await page.getByTestId('tab-clad').click();
  await page.getByTestId('nav-w:openings').click();
  await page.getByTestId('op-add-door').click();
  await page.getByTestId('nav-w:takeoff').click();
  await expect(page.getByTestId('clad-takeoff')).toContainText('מ"ר');
  expect((await st()).err).toBe(0);
  await shot(page, 'CLAD_01');
  await page.getByTestId('mode-production').click();
  const ifc = page.waitForEvent('download'); await page.getByTestId('export-ifc').click();
  // שם קובץ עברי אינו נמסר ב-Chromium ללא ממשק — בודקים את התוכן
  const fsm = await import('node:fs');
  expect(fsm.readFileSync((await (await ifc).path())!, 'utf8').startsWith('ISO-10303-21;')).toBe(true);
  await page.locator('[data-testid^="prod-tab-"]').last().click();
  const pdf = page.waitForEvent('download'); await page.getByTestId('qc-pdf').click();
  expect(fsm.readFileSync((await (await pdf).path())!).subarray(0, 5).toString()).toBe('%PDF-');
});
