import { expect, test } from '@playwright/test';
import { boot, setView, shot } from './helpers';

const st = (page: any) => page.evaluate(() => (window as any).__ksp.store.state);

test('USE-01: פרויקט חדש מתבנית מודולרית עם אלכסונים; בחירת פרופיל לפי סוג וגודל', async ({ page }) => {
  const errors = await boot(page);
  await page.getByTestId('btn-new').click();
  await page.getByTestId('np-gable-inner').click();
  await expect(page.getByTestId('np-knee')).toBeChecked();
  await page.getByTestId('create').click();
  const b = await page.evaluate(() => { const s = (window as any).__ksp.store.state; return { lines: s.project.building.section?.lines.length, knee: s.derived.connections.filter((c: any) => c.type === 'knee').length, err: s.derived.issues.filter((i: any) => i.severity === 'error').length }; });
  expect(b.lines).toBe(3);
  expect(b.knee).toBeGreaterThan(0);
  expect(b.err).toBe(0);
  // בחירת פרופיל: סוג ואז גודל
  await page.getByTestId('nav-s:profiles').click();
  await page.getByTestId('columnProfile-family').selectOption('HEA');
  await page.getByTestId('columnProfile-size').selectOption('HEA300');
  expect((await st(page)).project.building.columnProfile).toBe('HEA300');
  expect(errors).toEqual([]);
});

test('USE-02: אגד B בקירות דרך הממשק — קורה + 2 אלכסונים, ללא התנגשויות', async ({ page }) => {
  await boot(page);
  await page.getByTestId('nav-b:walls').click();
  await page.getByTestId('br-walls-type').selectOption('portal');
  const q = () => page.evaluate(() => { const d = (window as any).__ksp.store.state.derived; return { beams: d.members.filter((m: any) => /^BB\.[^K]*$/.test(m.id)).length, k: d.members.filter((m: any) => /^BB\..*\.K\d$/.test(m.id)).length, x: d.members.filter((m: any) => m.id.startsWith('BR.W')).length, clash: d.issues.filter((i: any) => i.code === 'CLASH').length }; });
  expect(await q()).toEqual({ beams: 10, k: 8, x: 0, clash: 0 }); // קורת אגד רציפה בכל המפתחים, אלכסונים רק במפתחי האגד
  await page.getByTestId('pb-cont').uncheck();
  expect(await q()).toEqual({ beams: 4, k: 8, x: 0, clash: 0 });
  await page.getByTestId('pb-cont').check();
  await page.getByTestId('pb-drop').fill('800'); await page.getByTestId('pb-drop').press('Enter');
  expect((await st(page)).project.building.bracing.walls.portal.drop).toBe(800);
  await setView(page, 'left');
  await shot(page, 'USE-02_portal');
});

test('USE-03: מידות בתלת-ממד — לחיצה על מרווח מסגרות ושינוי בכתב; עריכת מידה בחתך האינטראקטיבי', async ({ page }) => {
  await boot(page);
  await setView(page, 'top');
  const lab = page.locator('.vp-label.editable[data-edit="y:0"]').first();
  await expect(lab).toBeVisible();
  await lab.dispatchEvent('pointerup');
  await page.getByTestId('dim-edit').fill('5.5'); await page.getByTestId('dim-edit').press('Enter');
  const fr = (await st(page)).project.building.frames.map((f: any) => f.y).sort((a: number, b: number) => a - b);
  expect(fr[1] - fr[0]).toBe(5500);
  // חתך מודולרי: לחיצה על מידת מפתח ושינוי
  await page.getByTestId('nav-s:geometry').click();
  await page.getByTestId('tpl-gable-inner').click();
  await page.getByTestId('isec-span-1').click();
  await page.getByTestId('isec-input').fill('8'); await page.getByTestId('isec-input').press('Enter');
  const ls = (await st(page)).project.building.section.lines.map((l: any) => l.x).sort((a: number, b: number) => a - b);
  expect(ls[2] - ls[1]).toBe(8000);
  await shot(page, 'USE-03_isec');
});

test('USE-04: שינוי מידות כל תומכי הפטות בבת אחת מעורך החיבור', async ({ page }) => {
  await boot(page);
  page.on('dialog', (d) => d.accept());
  await page.evaluate(() => (window as any).__ksp.store.select(['CL.PL.L.02.F2']));
  await page.getByTestId('ptab-conns').click();
  await page.getByTestId('open-conn-C.PC.PL.L.02.F2').click();
  const n = await page.evaluate(() => (window as any).__ksp.store.state.derived.connections.filter((c: any) => c.type === 'purlin-cleat').length);
  await expect(page.getByTestId('cl-apply-all')).toContainText(String(n));
  await page.getByTestId('cl-apply-all').click();
  const pu = (await st(page)).project.building.purlins;
  expect(Object.keys(pu.cleatOverrides ?? {}).length).toBe(0);
  expect(pu.left.cleat).toEqual(pu.right.cleat);
});

test('USE-05: הודעות מקובצות — הסתרת סוג, תקן הכל, שרטוט תומך עם מידות', async ({ page }) => {
  await boot(page);
  page.on('dialog', (d) => d.accept());
  // רוחב זוויתן 80 ⇒ מרחק קצה 15 < 16.8 בכל תומכי השיפוע השמאלי
  await page.evaluate(() => (window as any).__ksp.store.select(['CL.PL.L.02.F2']));
  await page.getByTestId('ptab-conns').click();
  await page.getByTestId('open-conn-C.PC.PL.L.02.F2').click();
  await expect(page.getByTestId('cleat-face')).toBeVisible();
  await shot(page, 'USE-05_cleat_face');
  await page.evaluate(() => { const k = (window as any).__ksp; k.store.exec({ label: 't', run: (p: any) => { const n = structuredClone(p); n.building.purlins.left.cleat.width = 80; return n; } }); });
  await page.getByTestId('tab-issues').click();
  await expect(page.getByTestId('igroup-BOLT_EDGE')).toBeVisible();
  await page.getByTestId('igroup-RAFTER_EXT').getByTestId('ghide-RAFTER_EXT').click();
  await expect(page.getByTestId('igroup-RAFTER_EXT')).toHaveCount(0);
  await expect(page.getByTestId('hidden-toggle')).toBeVisible();
  await page.getByTestId('gfix-BOLT_EDGE').click();
  const left = await page.evaluate(() => (window as any).__ksp.store.state.derived.issues.filter((i: any) => i.code === 'BOLT_EDGE' && i.elementId?.startsWith('CL.PL.L')).length);
  expect(left).toBe(0);
  expect(await page.evaluate(() => (window as any).__ksp.store.state.project.building.purlins.left.cleat.width)).toBe(90);
  await shot(page, 'USE-05_issues');
  await page.getByTestId('restore-all').click();
  await expect(page.getByTestId('igroup-RAFTER_EXT')).toBeVisible();
});
