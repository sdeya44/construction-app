import { expect, test } from '@playwright/test';
import { boot, shot, openNav } from './helpers';

test('TR-01: מסבכי גג — הפעלה, עריכת שדה וצומת בלחיצה, גובה בלחיצה, ללא שגיאות', async ({ page }) => {
  await boot(page);
  await openNav(page, 'b:truss');
  await page.getByTestId('rt-on').check();
  const st = () => page.evaluate(() => { const d = (window as any).__ksp.store.state.derived; return { err: d.issues.filter((i: any) => i.severity === 'error').map((i: any) => i.message), webs: d.members.filter((m: any) => m.id.startsWith('TR.')).length }; });
  let s = await st();
  expect(s.err).toEqual([]);
  expect(s.webs).toBeGreaterThan(30);
  await page.getByTestId('tw-roof-cell-1').click();
  await page.getByTestId('tw-roof-node-2').click();
  await page.getByTestId('tw-roof-sch').getByTestId('tw-roof-depth').click();
  await page.getByTestId('tw-roof-depth-inp').fill('1300'); await page.getByTestId('tw-roof-depth-inp').press('Enter');
  const spec = await page.evaluate(() => (window as any).__ksp.store.state.project.building.roofTruss.spec);
  expect(spec.depth).toBe(1300);
  expect(spec.pattern).toBe('custom');
  s = await st();
  expect(s.err).toEqual([]);
  await shot(page, 'TR_01_roof');
  // לחיצה על מוט מסבך בתלת-ממד — האשף בפאנל המאפיינים
  await page.evaluate(() => { const k = (window as any).__ksp; k.store.select([k.store.state.derived.members.find((m: any) => m.id.startsWith('TR.')).id]); });
  await page.getByTestId('pscope-asm').click();
  await expect(page.getByTestId('psec-shape')).toContainText('מסבך גג');
  await expect(page.getByTestId('props-single').getByTestId('tw-roof-pv-diag')).toBeVisible();
});

test('TR-02: מסבך נושא בדילול עמודים — מעבר "מסבך", חיבור המשך ידני, ללא שגיאות', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => (window as any).__ksp.store.select(['F2.COL.L', 'F3.COL.L', 'F4.COL.L']));
  await page.getByTestId('ctx-omit').click();
  await page.getByTestId('omit-apply').click();
  await openNav(page, 'b:tb');
  await page.getByTestId('tb-grp-0-edit').click();
  const id = await page.evaluate(() => (window as any).__ksp.store.state.project.building.transfers[0].id);
  await page.getByTestId(`tb-kind-truss-${id}`).click();
  await expect(page.getByTestId(`tw-${id}`)).toBeVisible();
  const err = () => page.evaluate(() => (window as any).__ksp.store.state.derived.issues.filter((i: any) => i.severity === 'error').map((i: any) => i.message));
  expect(await err()).toEqual([]);
  await page.getByTestId(`tw-${id}-splice`).selectOption('manual');
  await page.getByTestId(`tw-${id}-spl-3`).click();
  expect(await err()).toEqual([]);
  expect(await page.evaluate(() => (window as any).__ksp.store.state.derived.connections.filter((c: any) => c.id.startsWith('C.RS.TB')).length)).toBe(2);
  await shot(page, 'TR_02_tb');
});

test('TR-03: מסבך נושא — חגורות RHS ושינוי אורך שדה בלחיצה על המידה, צמתים על המסגרות', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => (window as any).__ksp.store.select(['F2.COL.L', 'F3.COL.L', 'F4.COL.L']));
  await page.getByTestId('ctx-omit').click();
  await page.getByTestId('omit-apply').click();
  await openNav(page, 'b:tb');
  await page.getByTestId('tb-grp-0-edit').click();
  const id = await page.evaluate(() => (window as any).__ksp.store.state.project.building.transfers[0].id);
  await page.getByTestId(`tb-kind-truss-${id}`).click();
  const st = () => page.evaluate(() => {
    const d = (window as any).__ksp.store.state.derived, t = (window as any).__ksp.store.state.project.building.transfers[0];
    return { err: d.issues.filter((i: any) => i.severity === 'error').map((i: any) => i.message), spec: t.truss, sp: d.members.some((m: any) => /^C\.TBS\..*\.SP$/.test(m.id)) };
  });
  // חגורות RHS
  for (const g of ['top', 'bottom']) {
    await page.getByTestId(`tw-${id}-p-${g}`).fill('RHS200x100x8'); await page.getByTestId(`tw-${id}-p-${g}`).press('Enter');
    await page.waitForTimeout(200);
  }
  let s = await st();
  expect(s.spec.profiles.top).toMatch(/^RHS/);
  expect(s.spec.profiles.bottom).toMatch(/^RHS/);
  expect(s.err).toEqual([]);
  expect(s.sp).toBe(true);
  // אורך שדה 0 → 1500: השאר מתאימים, סכום = מפתח
  await page.getByTestId(`tw-${id}-sch`).getByTestId(`tw-${id}-pl-0`).click();
  await page.getByTestId(`tw-${id}-pl-0-inp`).fill('1500'); await page.getByTestId(`tw-${id}-pl-0-inp`).press('Enter');
  s = await st();
  expect(s.spec.panelLens[0]).toBe(1500);
  expect(s.err).toEqual([]);
  await shot(page, 'TR_03_rhs_panels');
  await page.getByTestId(`tw-${id}-onframes`).click();
  s = await st();
  expect(s.err).toEqual([]);
  expect(await page.evaluate(() => (window as any).__ksp.store.state.derived.issues.some((i: any) => i.message.includes('אינה על צומת')))).toBe(false);
  await page.getByTestId(`tw-${id}-eq`).click();
  s = await st();
  expect(s.spec.panelLens).toBeUndefined();
});

test('TR-04: מסבך נושא — שדות קבועים (שדה שנקבע נשמר, השאר מתחלקים שווה) ומסבך בין העמודים', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => (window as any).__ksp.store.select(['F2.COL.L', 'F3.COL.L']));
  await page.getByTestId('ctx-omit').click();
  await page.getByTestId('omit-apply').click();
  await openNav(page, 'b:tb');
  await page.getByTestId('tb-grp-0-edit').click();
  const id = await page.evaluate(() => (window as any).__ksp.store.state.project.building.transfers[0].id);
  await page.getByTestId(`tb-kind-truss-${id}`).click();
  const st = () => page.evaluate(() => {
    const k = (window as any).__ksp.store.state;
    return { spec: k.project.building.transfers[0].truss, err: k.derived.issues.filter((i: any) => i.severity === 'error').map((i: any) => i.message), d: k.derived };
  });
  // ביטול סימטריה, קביעת שדה 0 ושדה 2
  await page.getByTestId(`tw-${id}-sym`).click();
  const setPl = async (i: number, v: string) => {
    await page.getByTestId(`tw-${id}-sch`).getByTestId(`tw-${id}-pl-${i}`).click();
    await page.getByTestId(`tw-${id}-pl-${i}-inp`).fill(v); await page.getByTestId(`tw-${id}-pl-${i}-inp`).press('Enter');
  };
  await setPl(0, '1500');
  await setPl(2, '3500');
  let s = await st();
  expect(s.spec.panelLens[0]).toBe(1500);
  expect(s.spec.panelLens[2]).toBe(3500);
  const free = s.spec.panelLens.filter((_: number, j: number) => j !== 0 && j !== 2);
  expect(Math.max(...free) - Math.min(...free)).toBeLessThanOrEqual(1);
  await expect(page.getByTestId(`tw-${id}-lock-0`)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId(`tw-${id}-lock-1`)).toHaveAttribute('aria-pressed', 'false');
  // שינוי חוזר של שדה 0 — שדה 2 לא זז
  await setPl(0, '2000');
  s = await st();
  expect(s.spec.panelLens[2]).toBe(3500);
  // שחרור שדה 2
  await page.getByTestId(`tw-${id}-lock-2`).click();
  await expect(page.getByTestId(`tw-${id}-lock-2`)).toHaveAttribute('aria-pressed', 'false');
  // מסבך בין העמודים: העמודים התומכים לא מתקצרים
  const colTop = () => page.evaluate(() => (window as any).__ksp.store.state.derived.byId.get('F1.COL.L').end.z);
  const zShort = await colTop();
  await page.getByTestId(`tb-fit-between-${id}`).click();
  s = await st();
  expect(s.err).toEqual([]);
  expect(await colTop()).toBeGreaterThan(zShort + 500);
  expect(await page.evaluate(() => (window as any).__ksp.store.state.derived.issues.filter((i: any) => i.code === 'CLASH').length)).toBe(0);
  await shot(page, 'TR_04_between');
});
