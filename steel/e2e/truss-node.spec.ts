import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import { EVIDENCE, boot, openNav } from './helpers';

/**
 * צמתי מסבך בעורך החיבור (1.112): מצב נוכחי, עריכה, ערכי גבול, שמירה/טעינה, ייבוא קובץ, ומודל גדול.
 * גיאומטריה בלבד — אין כאן בדיקת חוזק ואין אישור ייצור.
 */
const st = (page: Page) => page.evaluate(() => (window as any).__ksp.store.state);
const cheeks = (page: Page) => page.evaluate(() => { const d = (window as any).__ksp.store.state.derived; const m = d.members.filter((x: any) => /\.G\d+[TB][12]$/.test(x.id)); return { n: m.length, prof: [...new Set(m.map((x: any) => x.profile))] as string[], err: d.issues.filter((i: any) => i.severity === 'error').length }; });
const enableRoof = async (page: Page) => { await openNav(page, 'b:truss'); await page.getByTestId('rt-on').check(); };
const openTrussConn = (page: Page) => page.evaluate(() => { const k = (window as any).__ksp; const c = k.store.state.derived.connections.find((x: any) => x.type === 'truss' && x.id.startsWith('C.TR.')); k.store.set({ activeConn: c.id }); return c.id as string; });

test('TNODE-E1: עורך חיבור מסבך — מצב נוכחי, הפעלה, עריכה, ערכי גבול (ריק/לא מספרי/0/שלילי), שמירה אחרי טעינה', async ({ page }) => {
  const errors = await boot(page);
  await enableRoof(page);
  expect((await cheeks(page)).n).toBe(0);
  await openTrussConn(page);
  await expect(page.getByTestId('tn-card')).toBeVisible();
  await expect(page.getByTestId('tn-state')).toContainText('מרותך ישיר');
  await expect(page.getByTestId('tn-scope')).toContainText('כל מסבכי הגג');
  await expect(page.getByTestId('tn-t')).toHaveCount(0); // שדות הלחיות מוצגים רק כשהאפשרות פעילה
  await page.getByTestId('tn-cheeks-on').check();
  await expect(page.getByTestId('tn-state')).toContainText('לחיות צומת — עובי 8 מ"מ, גובה 100 מ"מ');
  await expect(page.getByTestId('tn-min')).toContainText('אינו תכן חוזק');
  let c = await cheeks(page); expect(c.n).toBeGreaterThan(10); expect(c.prof).toEqual(['PL100x8']); expect(c.err).toBe(0);
  const setNum = async (id: string, v: string) => { const f = page.getByTestId(id); await f.fill(v); await f.press('Enter'); };
  await setNum('tn-t', '10'); await expect(page.getByTestId('tn-state')).toContainText('עובי 10');
  expect((await cheeks(page)).prof).toEqual(['PL100x10']);
  // ריק / לא מספרי — מסומן כשגוי ואינו נשמר
  for (const bad of ['', 'abc']) { await setNum('tn-t', bad); await expect(page.getByTestId('tn-t')).toHaveClass(/bad/); expect((await cheeks(page)).prof).toEqual(['PL100x10']); }
  // 0 ושלילי — מוגבלים למינימום הקיים (עובי 4, גובה 30)
  await setNum('tn-t', '0'); await expect(page.getByTestId('tn-t')).toHaveValue('4'); expect((await cheeks(page)).prof).toEqual(['PL100x4']);
  await setNum('tn-t', '-5'); await expect(page.getByTestId('tn-t')).toHaveValue('4');
  await setNum('tn-h', '-1'); await expect(page.getByTestId('tn-h')).toHaveValue('30'); expect((await cheeks(page)).prof).toEqual(['PL30x4']);
  expect((await cheeks(page)).err).toBe(0);
  await setNum('tn-t', '12'); await setNum('tn-h', '120');
  expect((await cheeks(page)).prof).toEqual(['PL120x12']);
  // שמירה: אחרי טעינה מחדש המצב נשמר
  await page.getByTestId('save-state').waitFor();
  await page.waitForFunction(() => (window as any).__ksp.store.state.saveState === 'saved');
  await page.reload();
  await page.waitForFunction(() => !!(window as any).__ksp?.viewport?.model);
  expect((await cheeks(page)).prof).toEqual(['PL120x12']);
  await openTrussConn(page);
  await expect(page.getByTestId('tn-state')).toContainText('עובי 12 מ"מ, גובה 120 מ"מ');
  await expect(page.getByTestId('tn-cheeks-on')).toBeChecked();
  await page.getByTestId('tn-cheeks-on').uncheck();
  await expect(page.getByTestId('tn-state')).toContainText('מרותך ישיר'); expect((await cheeks(page)).n).toBe(0);
  expect(errors).toEqual([]);
});

test('TNODE-E2: פתיחת קובץ פרויקט מהממשק (ייבוא JSON) — קובץ בסכמה ישנה (v7) עם לחיות צומת, וקובץ מגרסה עתידית נדחה', async ({ page }) => {
  const errors = await boot(page);
  await enableRoof(page);
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const mk = async (patch: (env: any) => void, name: string) => {
    const env = await page.evaluate(() => { const p = JSON.parse(JSON.stringify((window as any).__ksp.store.state.project)); return { format: 'kayan-steel-pro', schemaVersion: p.schemaVersion, savedAt: '2026-01-01T00:00:00.000Z', project: p }; });
    patch(env); const f = `${EVIDENCE}/${name}.json`; fs.writeFileSync(f, JSON.stringify(env)); return f;
  };
  const importFile = async (f: string) => { await page.getByTestId('btn-open').click(); await expect(page.getByTestId('open-dialog')).toBeVisible(); const fc = page.waitForEvent('filechooser'); await page.getByRole('button', { name: 'ייבוא קובץ JSON' }).click(); await (await fc).setFiles(f); };
  const old = await mk((env) => {
    env.schemaVersion = 7; env.project.schemaVersion = 7; env.project.meta.name = 'ImportedTrussV7';
    delete env.project.building.purlins.left.layout; delete env.project.building.purlins.right.layout;
    env.project.building.roofTruss.spec.nodeCheeks = { enabled: true, t: 10, h: 120 };
  }, 'truss-v7');
  await importFile(old);
  await expect(page.getByTestId('toasts')).toContainText('הפרויקט יובא');
  await expect(page.getByTestId('proj-name')).toHaveText('ImportedTrussV7');
  const s = await st(page);
  expect(s.project.schemaVersion).toBe(8);
  expect(s.project.building.purlins.left.layout).toBe('even');
  expect((await cheeks(page)).prof).toEqual(['PL120x10']);
  await openTrussConn(page);
  await expect(page.getByTestId('tn-state')).toContainText('עובי 10 מ"מ, גובה 120 מ"מ');
  // קובץ מגרסה חדשה יותר — נדחה, והפרויקט הנוכחי נשאר
  const future = await mk((env) => { env.schemaVersion = 99; env.project.schemaVersion = 99; env.project.meta.name = 'ShouldNotLoad'; }, 'truss-v99');
  await importFile(future);
  await expect(page.getByTestId('toasts')).toContainText('חדשה יותר');
  await expect(page.getByTestId('proj-name')).toHaveText('ImportedTrussV7');
  expect(errors.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
});

test('TNODE-E3: מודל גדול (30 מסגרות, מסבכי גג עם לחיות, ~15 אלף חלקים) — פתיחה, בחירה, סיבוב וזום; זמנים כאבחון בלבד', async ({ page }) => {
  test.setTimeout(180000);
  const errors = await boot(page);
  await enableRoof(page);
  const t0 = Date.now();
  await page.evaluate(() => {
    const k = (window as any).__ksp;
    k.store.exec({ label: 'big', run: (p: any) => ({ ...p, building: { ...p.building, frames: Array.from({ length: 30 }, (_, i) => ({ id: `F${i + 1}`, y: i * 6000 })), roofTruss: { ...p.building.roofTruss, frames: 'all', spec: { ...p.building.roofTruss.spec, nodeCheeks: { enabled: true, t: 8, h: 100 } } } } }) });
  });
  await page.waitForFunction(() => (window as any).__ksp.store.state.derived.members.length > 10000, null, { timeout: 120000 });
  const tModel = Date.now() - t0;
  const n = await page.evaluate(() => (window as any).__ksp.store.state.derived.members.length);
  expect((await cheeks(page)).err).toBe(0);
  const t1 = Date.now();
  await page.evaluate(() => (window as any).__ksp.viewport.fitAll('iso'));
  await page.waitForFunction(() => !!(window as any).__ksp.viewport.panes[0].camera);
  const tFit = Date.now() - t1;
  // בחירה: אלמנט מהמודל; סיבוב וזום בעכבר
  const id = await page.evaluate(() => (window as any).__ksp.store.state.derived.members.find((m: any) => /^F15\.COL\./.test(m.id)).id as string);
  await page.evaluate((i) => (window as any).__ksp.store.select([i]), id);
  expect(await page.evaluate(() => (window as any).__ksp.store.state.selection)).toEqual([id]);
  const r = await page.evaluate(() => { const b = (window as any).__ksp.viewport.panes[0].el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
  const cam = () => page.evaluate(() => (window as any).__ksp.viewport.panes[0].camera.position.toArray() as number[]);
  const c0 = await cam();
  const t2 = Date.now();
  await page.mouse.move(r.x, r.y); await page.mouse.down(); await page.mouse.move(r.x + 120, r.y + 40, { steps: 6 }); await page.mouse.up();
  await expect.poll(async () => JSON.stringify(await cam()) !== JSON.stringify(c0), { timeout: 20000 }).toBe(true);
  const tOrbit = Date.now() - t2;
  const c1 = await cam();
  const t3 = Date.now();
  await page.mouse.move(r.x, r.y); await page.mouse.wheel(0, -400);
  await expect.poll(async () => JSON.stringify(await cam()) !== JSON.stringify(c1), { timeout: 20000 }).toBe(true);
  const tZoom = Date.now() - t3;
  test.info().annotations.push({ type: 'diagnostic', description: `members=${n}; model ${tModel}ms; fitAll ${tFit}ms; orbit ${tOrbit}ms; zoom ${tZoom}ms (אבחון בלבד — לא סף קבלה)` });
  console.log(`TNODE-E3 diagnostics: members=${n}; model ${tModel}ms; fitAll ${tFit}ms; orbit ${tOrbit}ms; zoom ${tZoom}ms`);
  expect(errors).toEqual([]);
});
