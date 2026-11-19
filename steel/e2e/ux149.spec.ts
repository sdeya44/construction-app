import { expect, test } from '@playwright/test';
import { boot } from './helpers';

test('UX149-01: רמז "לחיצה נוספת" — אלמנט מאחור; סרגל צף בלי כפתורי היקף', async ({ page }) => {
  const errors = await boot(page);
  // נקודה שבה יש שני אלמנטים בקו הראייה
  const pt = await page.evaluate(() => {
    const k = (window as any).__ksp, v = k.viewport, d = k.store.state.derived;
    for (const m of d.members.filter((x: any) => x.purlin).slice(0, 40)) {
      const p = v.screenOf({ x: (m.start.x + m.end.x) / 2, y: (m.start.y + m.end.y) / 2, z: (m.start.z + m.end.z) / 2 });
      if (!p?.visible) continue;
      const r = v.pickAll(v.panes[0], p.x, p.y);
      if (r.ids.length > 1) return { p, ids: r.ids };
    }
    return null;
  });
  expect(pt).toBeTruthy();
  await page.mouse.click(pt!.p.x, pt!.p.y); await page.waitForTimeout(250);
  await expect(page.getByTestId('pick-next')).toBeVisible();
  await expect(page.getByTestId('ctx-frame')).toHaveCount(0);
  await expect(page.getByTestId('ctx-line')).toHaveCount(0);
  await page.mouse.click(pt!.p.x, pt!.p.y); await page.waitForTimeout(250);
  expect(await page.evaluate(() => (window as any).__ksp.store.state.selection[0])).toBe(pt!.ids[1]);
  expect(errors).toEqual([]);
});

test('UX149-02: חיפוש — קבוצה "בחר הכל" לפני פחים; חלון אלמנט: חתך לפני שרטוט (מקופל); הדגשה כתומה', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => { const k = (window as any).__ksp; k.store.exec({ label: 't', run: (p: any) => ({ ...p, building: { ...p.building, bracing: { ...p.building.bracing, walls: { ...p.building.bracing.walls, enabled: true, type: 'portal' } } } }) }); });
  await page.keyboard.press('Control+k');
  await page.getByTestId('cmdk-input').fill('אגד');
  const rows = await page.locator('.cmdk-row').evaluateAll((es) => es.map((e) => (e as HTMLElement).dataset.testid ?? ''));
  const gi = rows.findIndex((r) => r.startsWith('cmdk-grp-'));
  const pi = rows.findIndex((r) => /^cmdk-el-C\./.test(r));
  expect(gi).toBeGreaterThanOrEqual(0);
  if (pi >= 0) expect(gi).toBeLessThan(pi);
  await page.locator('[data-testid^="cmdk-grp-"]').first().click();
  expect((await page.evaluate(() => (window as any).__ksp.store.state.selection)).length).toBeGreaterThan(1);
  // חלון אלמנט: היקף "רק האלמנט הזה" — חתך גלוי, שרטוט מקופל
  await page.evaluate(() => { const k = (window as any).__ksp; k.store.set({ propScope: 'one' }); k.store.select(['F2.COL.L']); });
  await expect(page.getByTestId('prop-profile-open')).toBeVisible();
  await expect(page.getByTestId('part-preview')).toHaveCount(0);
  await page.getByTestId('psec-part').click();
  await expect(page.getByTestId('part-preview')).toBeVisible();
  // היקף רחב — הדגשה כתומה + "יחול על"
  await page.getByTestId('pscope-similar').click();
  await expect(page.getByTestId('pscope-applies')).toContainText('יחול על');
  expect((await page.evaluate(() => (window as any).__ksp.store.state.scopeHi)).length).toBeGreaterThan(1);
  await page.evaluate(() => (window as any).__ksp.store.select([]));
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => (window as any).__ksp.store.state.scopeHi)).toBeNull();
  expect(errors).toEqual([]);
});

test('UX150-01: פאנל בלי לשוניות — שביל מהאלמנט לרכיב וחזרה', async ({ page }) => {
  const errors = await boot(page);
  await expect(page.getByTestId('lp-nav')).toHaveCount(0);
  await expect(page.getByTestId('lp-sel')).toHaveCount(0);
  await page.evaluate(() => (window as any).__ksp.store.select(['F2.COL.L']));
  await expect(page.getByTestId('props-single')).toBeVisible();
  await expect(page.getByTestId('lp-crumb')).toContainText('חתכים');
  await expect(page.getByTestId('lp-here')).toContainText('עמוד');
  // שביל ← הגדרות הרכיב כולו; "חזרה לאלמנט" ← חלון האלמנט
  await page.getByTestId('lp-crumb').click();
  await expect(page.getByTestId('lp-nav-content')).toBeVisible();
  await expect(page.getByTestId('sel-strip')).toContainText('הגדרות הרכיב כולו');
  await page.getByTestId('sel-strip-props').click();
  await expect(page.getByTestId('props-single')).toBeVisible();
  // ביטול בחירה ← חזרה להגדרות הרכיב
  await page.evaluate(() => (window as any).__ksp.store.select([]));
  await expect(page.getByTestId('lp-nav-content')).toBeVisible();
  await expect(page.getByTestId('lp-crumb')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('UX151-01: עריכת חיבור — המבט מתקרב לצומת; "חזרה למודל המלא" מחזיר את המבט', async ({ page }) => {
  const errors = await boot(page);
  const cam = () => page.evaluate(() => { const p = (window as any).__ksp.viewport.panes[0]; return p.camera.position.toArray().map((v: number) => Math.round(v)); });
  const before = await cam();
  const cid = await page.evaluate(() => (window as any).__ksp.store.state.derived.connections.find((c: any) => c.type === 'eave')?.id);
  await page.evaluate((c) => (window as any).__ksp.store.set({ activeConn: c }), cid);
  await expect(page.getByTestId('view-restore')).toBeVisible();
  const near = await cam();
  expect(near).not.toEqual(before);
  await page.getByTestId('view-restore').click();
  await expect(page.getByTestId('view-restore')).toHaveCount(0);
  expect(await cam()).toEqual(before);
  // אריחי סוג גדולים: קשיחות קירות וקושרות גג
  await page.evaluate(() => (window as any).__ksp.store.set({ activeConn: null }));
  await page.getByTestId('nav-b:roof').click();
  const add = page.getByTestId('off-roof'); if (await add.count()) await add.click();
  await page.getByTestId('br-roof-ed-tab-sec').click();
  await page.getByTestId('br-roof-type-rhs').click();
  expect(await page.evaluate(() => (window as any).__ksp.store.state.project.building.bracing.roof.type)).toBe('rhs');
  expect(errors).toEqual([]);
});

test('UX152-01: פרט טיפוסי בכרטיס החיבור / בעורך / באשף; בחירה מהירה של מסגרות לאלכסונים', async ({ page }) => {
  const errors = await boot(page);
  // פרט טיפוסי: כרטיס קצה של עמוד
  await page.evaluate(() => { const k = (window as any).__ksp; k.store.set({ propScope: 'one' }); k.store.select(['F2.COL.L']); });
  const cid = await page.evaluate(() => (window as any).__ksp.store.state.derived.connections.find((c: any) => c.type === 'base' && c.members.includes('F2.COL.L'))?.id);
  await page.getByTestId(`endc-draw-${cid}`).click();
  await expect(page.getByTestId(`conn-prev-${cid}`).locator('svg')).toBeVisible();
  // עורך החיבור
  await page.getByTestId(`endc-open-${cid}`).click();
  await expect(page.getByTestId('conn-editor').getByTestId(`conn-prev-${cid}`)).toBeVisible();
  await page.evaluate(() => (window as any).__ksp.store.set({ activeConn: null }));
  // אלכסונים: רק במסגרות הקצה, ואז טווח 2–3
  await page.evaluate(() => (window as any).__ksp.store.select([]));
  await page.getByTestId('nav-b:knee').click();
  if (await page.getByTestId('kb-on').count()) await page.getByTestId('kb-on').check();
  await page.getByTestId('kb-ed-tab-plan').click();
  await page.getByTestId('kb-ends').click();
  const frs = () => page.evaluate(() => [...new Set((window as any).__ksp.store.state.derived.members.filter((m: any) => m.id.startsWith('KB.')).map((m: any) => m.id.split('.')[1]))].sort());
  const nf = await page.evaluate(() => (window as any).__ksp.store.state.project.building.frames.length);
  expect(await frs()).toEqual(['F1', `F${nf}`].sort());
  await page.getByTestId('kb-from').fill('2'); await page.getByTestId('kb-to').fill('3');
  await page.getByTestId('kb-range').click();
  expect(await frs()).toEqual(['F2', 'F3']);
  await page.getByTestId('kb-all').click();
  expect((await frs()).length).toBe(nf);
  expect(errors).toEqual([]);
});
