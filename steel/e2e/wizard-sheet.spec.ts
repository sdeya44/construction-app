import { expect, test } from '@playwright/test';
import { boot } from './helpers';

const st = (page: import('@playwright/test').Page) => page.evaluate(() => {
  const s = (window as any).__ksp.store.state; const b = s.project.building;
  return { frames: b.frames.length, width: b.width, style: b.purlins.left.cleat.style, spacing: b.purlins.left.spacing, roofX: b.bracing.roof.enabled, walls: b.cladding?.walls.enabled, roofClad: b.cladding?.roof.enabled, err: s.derived.issues.filter((i: any) => i.severity === 'error').length, rafter: b.rafterProfile, ov: Object.keys(s.project.memberOverrides).length };
});

test('WZ-01: אשף פרויקט חדש — שלבים, תצוגה חיה, תושבת עומדת, חיפוי גג בלבד', async ({ page }) => {
  const errors = await boot(page);
  await page.getByTestId('btn-new').click();
  await expect(page.getByTestId('wz-view')).toBeVisible();
  await expect(page.getByTestId('wz-check')).toContainText('ללא שגיאות');
  await page.getByTestId('wz-next').click();
  await page.getByTestId('np-width').fill('20'); await page.getByTestId('np-width').press('Enter');
  await page.getByTestId('np-bay').fill('5'); await page.getByTestId('np-bay').press('Enter');
  await expect(page.getByTestId('np-count')).toHaveValue('7');
  await page.getByTestId('wz-step-2').click();
  await page.getByTestId('np-autosize').uncheck();
  await page.getByTestId('wz-step-3').click();
  await page.getByTestId('np-cleat-stand').click();
  await page.getByTestId('np-pspacing').fill('1.2'); await page.getByTestId('np-pspacing').press('Enter');
  await page.getByTestId('wz-step-4').click();
  await page.getByTestId('np-roofx').click();
  await page.getByTestId('wz-step-5').click();
  await page.getByTestId('np-clad-roof').click();
  await expect(page.getByTestId('wz-summary')).toContainText('7 מסגרות');
  await expect(page.getByTestId('wz-summary')).toContainText('זוויתן עומד');
  await page.getByTestId('create').click();
  expect(await st(page)).toMatchObject({ frames: 7, width: 20000, style: 'stand', spacing: 1200, roofX: false, walls: false, roofClad: true, err: 0 });
  expect(errors).toEqual([]);
});

test('PS-01: גיליון פרמטרים — עריכה בטבלה, חריגים והחזרה לכללי, השוואה למהדורה', async ({ page }) => {
  const errors = await boot(page);
  await page.getByTestId('nav-s:sheet').click();
  await expect(page.getByTestId('param-sheet')).toBeVisible();
  await page.getByTestId('ps-מספר מסגרות').fill('8'); await page.getByTestId('ps-מספר מסגרות').press('Enter');
  expect((await st(page)).frames).toBe(8);
  // חריג: קורה אחת עם חתך משלה
  await page.evaluate(() => { const k = (window as any).__ksp; k.store.exec({ label: 't', run: (p: any) => { const n = structuredClone(p); n.memberOverrides['PL.L.04'] = { profile: 'C250x75x20x3' }; return n; } }); });
  await page.getByTestId('ps-ov-פטות — חתך').click();
  await page.getByTestId('ps-ovclear-פטות — חתך').click();
  expect((await st(page)).ov).toBe(0);
  // אישור מהדורה ושינוי — השורה מסומנת כשונתה
  await page.evaluate(() => { const k = (window as any).__ksp; const n = structuredClone(k.store.state.project); n.revision.log.push({ rev: 'A', date: '', note: '', status: 'approved', snapshot: JSON.stringify(n) }); k.store.loadProject(n, false); });
  await page.getByTestId('nav-s:sheet').click();
  await page.getByTestId('ps-only').check();
  await expect(page.locator('[data-testid^="ps-row-"]')).toHaveCount(0);
  await page.getByTestId('ps-only').uncheck();
  await page.getByTestId('ps-שיפוע גג').fill('12'); await page.getByTestId('ps-שיפוע גג').press('Enter');
  await page.getByTestId('ps-only').check();
  await expect(page.getByTestId('ps-row-שיפוע גג')).toBeVisible();
  await expect(page.getByTestId('ps-row-שיפוע גג')).toContainText('10%');
  expect(errors).toEqual([]);
});

test('SC-01: שינוי חתך לאלמנט אחד — התוכנה שואלת "רק זה / כולם"; Enter לא מחיל בטעות על כולם', async ({ page }) => {
  const errors = await boot(page);
  const prof = (id: string) => page.evaluate((i) => (window as any).__ksp.store.state.derived.byId.get(i).profile, id);
  await page.evaluate(() => (window as any).__ksp.store.select(['F2.COL.L']));
  await page.getByTestId('prop-profile').fill('HEB200'); await page.getByTestId('prop-profile').press('Enter');
  await expect(page.getByTestId('scope-ask')).toBeVisible();
  expect(await prof('F2.COL.L')).toBe('HEA200'); // עדיין לא הוחל
  await page.getByTestId('scope-ask-all').click();
  expect(await prof('F5.COL.R')).toBe('HEB200');
  // אלכסון: רק אחד
  await page.getByTestId('nav-b:knee').click(); await page.getByTestId('kb-on').check();
  await page.evaluate(() => (window as any).__ksp.store.select(['KB.F2.L.L.R']));
  await page.getByTestId('prop-profile-family').selectOption('SHS');
  await page.getByTestId('prop-profile-size').selectOption('SHS100x5');
  await page.getByTestId('scope-ask-one').click();
  expect(await prof('KB.F2.L.L.R')).toBe('SHS100x5');
  expect(await prof('KB.F3.L.L.R')).toBe('RHS80x80x4');
  // כרטיס החיבור מקופל לתג; לחיצה פותחת
  await expect(page.getByTestId('conncard')).toHaveCount(0);
  await page.getByTestId('conncard-tag').click();
  await expect(page.getByTestId('conncard')).toBeVisible();
  await page.getByTestId('cc-min').click();
  await expect(page.getByTestId('conncard-tag')).toBeVisible();
  expect(errors).toEqual([]);
});

test('LW-UI: סככת L מהאשף — דו-שיפועי וחד-שיפועי; עריכת הכנף מהפאנל; גיליון מזחלה', async ({ page }) => {
  const errors = await boot(page);
  const s = () => page.evaluate(() => { const d = (window as any).__ksp.store.state.derived; return { err: d.issues.filter((i: any) => i.severity === 'error').map((i: any) => i.message), wing: d.members.filter((m: any) => m.id.startsWith('W.')).length, seats: d.connections.filter((c: any) => c.id.startsWith('C.WS.F')).length }; });
  for (const t of ['L-gable', 'L-mono']) {
    await page.getByTestId('btn-new').click();
    await page.getByTestId(`np-${t}`).click();
    await expect(page.getByTestId('wz-check')).toContainText('ללא שגיאות');
    await page.getByTestId('create').click();
    const r = await s();
    expect(r.err).toEqual([]);
    expect(r.wing).toBeGreaterThan(100);
    expect(r.seats).toBe(3);
  }
  // עריכה: צד שמאל, 3 מפתחים
  await page.getByTestId('nav-b:wing').click();
  await page.getByTestId('wing-side').selectOption('L');
  await page.getByTestId('wing-bays').fill('3'); await page.getByTestId('wing-bays').press('Enter');
  const r2 = await s();
  expect(r2.err).toEqual([]);
  expect(r2.seats).toBe(4);
  // גיליון מזחלה קיים בשרטוטים
  await page.getByTestId('mode-drawings').click();
  await expect(page.getByText('פרט מזחלה וירידת מרזב').first()).toBeVisible();
  expect(errors).toEqual([]);
});
