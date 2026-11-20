import { expect, test } from '@playwright/test';
import { boot, pickProfile, openNav } from './helpers';

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
  await openNav(page, 's:sheet');
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
  await openNav(page, 's:sheet');
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
  // היקף נבחר לפני השינוי: "כל הדומים" — חל על כל העמודים
  await page.getByTestId('pscope-similar').click();
  await page.getByTestId('grp-profile').fill('HEB200'); await page.getByTestId('grp-profile').press('Enter');
  expect(await prof('F5.COL.R')).toBe('HEB200');
  await page.getByTestId('pscope-one').click();
  // אלכסון: רק אחד
  await openNav(page, 'b:knee'); await page.getByTestId('kb-on').check();
  await page.evaluate(() => (window as any).__ksp.store.select(['KB.F2.L.L.R']));
  await page.getByTestId('pscope-one').click(); await page.getByTestId('ks-sec-conn').click(); // 1.56: האלכסון שנבחר
  await pickProfile(page, 'prop-profile', 'SHS100x5', 'SHS');
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
  await openNav(page, 'b:wing');
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

test('WZ-02: אשף — תבנית חד-שיפועי רב-מפתחי, מפתחי קצה שונים, שמות צירים ומרווחי צירים (1.41)', async ({ page }) => {
  const errors = await boot(page);
  await page.getByTestId('btn-new').click();
  await page.getByTestId('np-mono-multi').click();
  await page.getByTestId('wz-next').click();
  await page.getByTestId('np-length').fill('102.1'); await page.getByTestId('np-length').press('Enter');
  await page.getByTestId('np-count').fill('22'); await page.getByTestId('np-count').press('Enter');
  await page.getByTestId('np-endA').fill('3.5'); await page.getByTestId('np-endA').press('Enter');
  await page.getByTestId('np-endB').fill('3.6'); await page.getByTestId('np-endB').press('Enter');
  await expect(page.getByTestId('np-frames-sum')).toContainText('3500 + 19×5000 + 3600');
  await page.getByTestId('np-labels').fill('C, B, A');
  await page.getByTestId('np-spans').fill('8000, 9000');
  await page.getByTestId('wz-step-2').click();
  await page.getByTestId('np-autosize').uncheck();
  await page.getByTestId('wz-step-5').click();
  await page.getByTestId('create').click();
  const r = await page.evaluate(() => { const s = (window as any).__ksp.store.state; const b = s.project.building; const fy = b.frames.map((f: any) => f.y); return { n: b.frames.length, first: fy[1] - fy[0], mid: fy[2] - fy[1], last: fy[fy.length - 1] - fy[fy.length - 2], labels: s.derived.section.lines.map((l: any) => l.label), xs: s.derived.section.lines.map((l: any) => l.x) }; });
  expect(r).toMatchObject({ n: 22, first: 3500, last: 3600, labels: ['C', 'B', 'A'] });
  expect(Math.round(r.mid)).toBe(5000);
  expect(r.xs[1] - r.xs[0]).toBe(8000); expect(r.xs[2] - r.xs[1]).toBe(9000);
  expect(errors).toEqual([]);
});
