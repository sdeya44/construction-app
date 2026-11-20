import { expect, test } from '@playwright/test';
import { boot, setView, shot, pickProfile, openNav } from './helpers';

const st = (page: any) => page.evaluate(() => (window as any).__ksp.store.state);

test('USE-01: פרויקט חדש מתבנית מודולרית עם אלכסונים; בחירת פרופיל לפי סוג וגודל', async ({ page }) => {
  const errors = await boot(page);
  await page.getByTestId('btn-new').click();
  await page.getByTestId('np-gable-inner').click();
  await page.getByTestId('wz-step-4').click();
  await expect(page.getByTestId('np-knee')).toBeChecked();
  await page.getByTestId('create').click();
  const b = await page.evaluate(() => { const s = (window as any).__ksp.store.state; return { lines: s.project.building.section?.lines.length, knee: s.derived.connections.filter((c: any) => c.type === 'knee').length, err: s.derived.issues.filter((i: any) => i.severity === 'error').length }; });
  expect(b.lines).toBe(3);
  expect(b.knee).toBeGreaterThan(0);
  expect(b.err).toBe(0);
  // בחירת פרופיל: סוג ואז גודל
  await openNav(page, 's:profiles');
  await pickProfile(page, 'columnProfile', 'HEA300', 'HEA');
  expect((await st(page)).project.building.columnProfile).toBe('HEA300');
  expect(errors).toEqual([]);
});

test('USE-02: אגד B בקירות דרך הממשק — קורה + 2 אלכסונים, ללא התנגשויות', async ({ page }) => {
  await boot(page);
  await openNav(page, 'b:walls');
  await page.getByTestId('br-walls-portal').click();
  await page.getByTestId('ks-sec-geo').click(); // 1.56: גיאומטריה
  const q = () => page.evaluate(() => { const d = (window as any).__ksp.store.state.derived; return { beams: d.members.filter((m: any) => /^BB\.[^K]*$/.test(m.id)).length, k: d.members.filter((m: any) => /^BB\..*\.K\d$/.test(m.id)).length, x: d.members.filter((m: any) => m.id.startsWith('BR.W')).length, clash: d.issues.filter((i: any) => i.code === 'CLASH').length }; });
  expect(await q()).toEqual({ beams: 10, k: 8, x: 0, clash: 0 }); // קורת אגד רציפה בכל המפתחים, אלכסונים רק במפתחי האגד
  await page.getByTestId('pb-cont').uncheck();
  expect(await q()).toEqual({ beams: 4, k: 8, x: 0, clash: 0 });
  await page.getByTestId('pb-cont').check();
  await page.getByTestId('sch-pb-drop').click(); await page.getByTestId('sch-pb-drop-inp').fill('800'); await page.getByTestId('sch-pb-drop-inp').press('Enter');
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
  await openNav(page, 's:geometry');
  await page.getByTestId('tpl-toggle').click();
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
  await page.getByTestId('open-conn-C.PC.PL.L.02.F2').click();
  await expect(page.getByTestId('cleat-face')).toBeVisible();
  await shot(page, 'USE-05_cleat_face');
  await page.evaluate(() => { const k = (window as any).__ksp; k.store.exec({ label: 't', run: (p: any) => { const n = structuredClone(p); n.building.purlins.left.cleat.width = 80; return n; } }); });
  await page.getByTestId('tab-issues').click();
  await expect(page.getByTestId('igroup-BOLT_EDGE')).toBeVisible();
  await page.getByTestId('info-toggle').click(); // "לידיעה" מקופל כברירת מחדל (1.44)
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

test('USE-06: חתך אינטראקטיבי — מספר צירים, בחירת מישור; גובה עמוד / רכס / שיפוע — שניים מוזנים, השלישי מחושב', async ({ page }) => {
  await boot(page);
  page.on('dialog', (d) => d.accept());
  await openNav(page, 's:geometry');
  await page.getByTestId('tpl-toggle').click();
  await page.getByTestId('tpl-mono-multi').click();
  await page.getByTestId('axis-n').fill('4'); await page.getByTestId('axis-n').press('Enter');
  const sec = () => page.evaluate(() => (window as any).__ksp.store.state.project.building.section);
  expect((await sec()).lines.length).toBe(4);
  const pid = (await sec()).planes[0].id;
  // גובה ב-x (פני עליון) של המישור
  const zAt = (pl: any, x: number) => pl.z0 + ((pl.z1 - pl.z0) * (x - pl.x0)) / (pl.x1 - pl.x0);
  const xs = async () => (await sec()).lines.map((l: any) => l.x).sort((a: number, b: number) => a - b);
  await page.getByTestId(`isec-pl-${pid}`).click();
  await expect(page.getByTestId('pl-card')).toBeVisible();
  await expect(page.locator('[data-testid="pl-card"] .lock-btn')).toHaveCount(0);
  // ברירת מחדל: הגובה הגבוה מחושב — שינוי שיפוע שומר את גובה העמוד הנמוך
  await expect(page.getByTestId('plc-calc-top')).toHaveAttribute('aria-checked', 'true');
  const [xa] = await xs(); const xd = (await xs())[3];
  const zA = zAt((await sec()).planes[0], xa);
  await page.getByTestId('plc-slope').fill('8'); await page.getByTestId('plc-slope').press('Enter');
  let p0 = (await sec()).planes[0];
  expect(Math.abs(zAt(p0, xa) - zA)).toBeLessThan(0.5);
  expect(Math.abs(((p0.z1 - p0.z0) / (p0.x1 - p0.x0)) * 100 - 8)).toBeLessThan(0.01);
  // גובה עמוד + גובה עמוד גבוה ⇒ שיפוע מחושב
  await page.getByTestId('plc-calc-slope').click();
  await page.getByTestId('plc-col').fill('5'); await page.getByTestId('plc-col').press('Enter');
  await page.getByTestId('plc-top').fill('6.6'); await page.getByTestId('plc-top').press('Enter');
  p0 = (await sec()).planes[0];
  expect(Math.abs(zAt(p0, xa) - 5000)).toBeLessThan(0.5);
  expect(Math.abs(zAt(p0, xd) - 6600)).toBeLessThan(0.5);
  await expect(page.getByTestId('plc-slope-out')).toContainText(((1600 / (xd - xa)) * 100).toFixed(2));
  // גובה עמוד מחושב: שיפוע + גובה גבוה
  await page.getByTestId('plc-calc-col').click();
  await page.getByTestId('plc-slope').fill('5'); await page.getByTestId('plc-slope').press('Enter');
  p0 = (await sec()).planes[0];
  expect(Math.abs(zAt(p0, xd) - 6600)).toBeLessThan(0.5);
  expect(Math.abs(zAt(p0, xa) - (6600 - 0.05 * (xd - xa)))).toBeLessThan(0.5);
  await shot(page, 'USE-06_roof_dims');
});

test('USE-06b: דו-שיפועי סימטרי — גובה עמודים וגובה רכס בכרטיס אחד, שני הצדדים זהים', async ({ page }) => {
  await boot(page);
  page.on('dialog', (d) => d.accept());
  await openNav(page, 's:geometry');
  await page.getByTestId('tpl-toggle').click();
  await page.getByTestId('tpl-gable-2').click();
  await page.getByTestId('geo-ed-tab-planes').click();
  await expect(page.getByTestId('sec-plane-gable')).toBeVisible();
  await page.getByTestId('tri-gable-calc-slope').click();
  await page.getByTestId('tri-gable-col').fill('5.5'); await page.getByTestId('tri-gable-col').press('Enter');
  await page.getByTestId('tri-gable-top').fill('7'); await page.getByTestId('tri-gable-top').press('Enter');
  const s = await page.evaluate(() => (window as any).__ksp.store.state.project.building.section);
  const xs = s.lines.map((l: any) => l.x).sort((a: number, b: number) => a - b);
  const zAt = (pl: any, x: number) => pl.z0 + ((pl.z1 - pl.z0) * (x - pl.x0)) / (pl.x1 - pl.x0);
  const [L, R] = [...s.planes].sort((a: any, b: any) => a.x0 - b.x0);
  expect(Math.abs(zAt(L, xs[0]) - 5500)).toBeLessThan(0.5);
  expect(Math.abs(zAt(R, xs[xs.length - 1]) - 5500)).toBeLessThan(0.5);
  expect(Math.abs(L.z1 - 7000)).toBeLessThan(0.5); expect(Math.abs(R.z0 - 7000)).toBeLessThan(0.5);
  const err = await page.evaluate(() => (window as any).__ksp.store.state.derived.issues.filter((i: any) => i.severity === 'error').length);
  expect(err).toBe(0);
  await shot(page, 'USE-06b_gable_dims');
});

test('USE-07: עריכה על המודל — שיפוע, גובה עמודים ומרווח פטות בלחיצה על המידה; חלונית הגדרות מאלמנט', async ({ page }) => {
  await boot(page);
  const st0 = () => page.evaluate(() => (window as any).__ksp.store.state);
  // שיפוע: לחיצה על תווית האחוז של המישור השמאלי ← 12%
  await page.locator('.vp-label.editable[data-edit="sl:L"]').first().dispatchEvent('pointerup');
  await page.getByTestId('dim-edit').fill('12'); await page.getByTestId('dim-edit').press('Enter');
  const sec = (await st0()).project.building.section;
  const L = sec.planes.find((p: any) => p.id === 'L'), R = sec.planes.find((p: any) => p.id === 'R');
  expect(Math.abs(((L.z1 - L.z0) / (L.x1 - L.x0)) * 100 - 12)).toBeLessThan(0.05);
  expect(Math.abs(L.z1 - R.z0)).toBeLessThan(1); // הרכס נשאר מחובר
  expect((await st0()).derived.issues.filter((i: any) => i.severity === 'error').length).toBe(0);
  // גובה עמודים: +500
  const h0 = await page.evaluate(() => (window as any).__ksp.store.state.derived.byId.get('F1.COL.L').end.z);
  await page.locator('.vp-label.editable[data-edit="hz"]').first().dispatchEvent('pointerup');
  const cur = Number(await page.getByTestId('dim-edit').inputValue());
  await page.getByTestId('dim-edit').fill(String(cur + 0.5)); await page.getByTestId('dim-edit').press('Enter');
  const h1 = await page.evaluate(() => (window as any).__ksp.store.state.derived.byId.get('F1.COL.L').end.z);
  expect(Math.round(h1 - h0)).toBe(500);
  // מרווח פטות
  await page.locator('.vp-label.editable[data-edit^="ps:"]').first().dispatchEvent('pointerup');
  await page.getByTestId('dim-edit').fill('1.2'); await page.getByTestId('dim-edit').press('Enter');
  const pu = (await st0()).project.building.purlins;
  expect([pu.left.spacing, pu.right.spacing, ...Object.values(pu.planes ?? {}).map((x: any) => x.spacing)]).toContain(1200);
  // חלונית הגדרות מתוך תומך שנבחר
  await page.evaluate(() => { const k = (window as any).__ksp; const c = k.store.state.derived.members.find((m: any) => m.kind === 'cleat'); k.store.select([c.id]); });
  await expect(page.getByTestId('hub-settings')).toBeVisible();
  await shot(page, 'USE-07_quick');
});

test('USE-19: אגד B הפוך — האלכסונים עולים מקורת האגד אל העמוד', async ({ page }) => {
  await boot(page);
  await openNav(page, 'b:walls');
  await page.getByTestId('br-walls-portal').click();
  await page.getByTestId('ks-sec-geo').click();
  await page.getByTestId('pb-dir-up').click();
  const r = await page.evaluate(() => {
    const k = (window as any).__ksp.store.state;
    const ks = k.derived.members.filter((m: any) => /^BB\..*\.K[12]$/.test(m.id));
    return { inv: k.project.building.bracing.walls.portal.invert, n: ks.length, up: ks.every((m: any) => m.start.z > m.end.z), err: k.derived.issues.filter((i: any) => i.severity === 'error').length };
  });
  expect(r.inv).toBe(true);
  expect(r.n).toBeGreaterThan(0);
  expect(r.up).toBe(true);
  expect(r.err).toBe(0);
  await expect(page.getByTestId('sch-pb-up')).toBeVisible();
  await shot(page, 'USE-19_portal_up');
});
