import { expect, test } from '@playwright/test';
import { boot, shot } from './helpers';

test('M6: עומס ~10,000 אלמנטים — בנייה, תצוגה ובחירה בדפדפן', async ({ page }) => {
  test.setTimeout(180_000);
  await boot(page);
  const r = await page.evaluate(async () => {
    const k = (window as any).__ksp;
    const p = structuredClone(k.store.state.project);
    const fr = Array.from({ length: 50 }, (_, i) => ({ id: `F${i + 1}`, y: i * 5000 }));
    Object.assign(p.building, { width: 26000, ridgeX: 13000, frames: fr });
    p.building.bracing.roof.bays = [0, 9, 19, 29, -1];
    p.nextFrameNo = 51;
    const t0 = performance.now();
    k.store.loadProject(p, true);
    const t1 = performance.now();
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    const t2 = performance.now();
    k.viewport.fitAll('iso');
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    // זמן רינדור פריים
    const f0 = performance.now();
    for (let i = 0; i < 5; i++) { k.viewport.render(); }
    const f1 = performance.now();
    return { n: k.store.state.derived.members.length, gen: t1 - t0, firstFrame: t2 - t1, frame: (f1 - f0) / 5, tris: k.viewport.model.triOwner.length };
  });
  console.log(JSON.stringify(r));
  expect(r.n).toBeGreaterThan(10000);
  // בחירה בלחיצה: זמן raycast על הגיאומטריה הממוזגת
  await page.getByTestId('proj-ortho').click();
  await page.getByTestId('view-front').click();
  const c = await page.evaluate(() => (window as any).__ksp.viewport.screenOf({ x: 0, y: 0, z: 3000 }));
  const t = await page.evaluate(async (pt) => {
    const k = (window as any).__ksp;
    const p = k.viewport.panes[0];
    const t0 = performance.now();
    const res = k.viewport.pickAll(p, pt.x, pt.y);
    return { ms: performance.now() - t0, id: res.ids[0] };
  }, c);
  console.log(JSON.stringify(t));
  expect(t.id).toBe('F1.COL.L');
  await shot(page, 'PERF_10k');
  expect(r.gen).toBeLessThan(20000);
});
