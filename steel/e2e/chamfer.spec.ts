import { expect, test } from '@playwright/test';
import { boot, openNav, shot } from './helpers';

/** CHAM-E: רצף משתמש — סטודיו (פרט "פלטה אל פלטה + קיטומי פינות") ← תצוגה/בדיקות ← שמירה והחלה על דומים ← אשף: שינוי קיטום/פינות ← שכפול/עריכה ← שמירה וטעינה */
test('CHAM-E1: רצף מלא בממשק — יצירה, החלה, שינוי פרמטרים באשף, עריכה בסטודיו, שמירה וטעינה', async ({ page }) => {
  const errors = await boot(page);
  const S = () => page.evaluate(() => (window as any).__ksp.store.state);
  await openNav(page, 'b:knee'); await page.getByTestId('kb-on').check();
  await page.evaluate(() => (window as any).__ksp.store.select(['KB.F2.L.L.R']));
  await page.getByTestId('ks-sec-conn').click(); await page.getByTestId('ks-sec-conn').click(); await page.getByTestId('cb-lib').click(); await page.getByTestId('studio-start').click();
  await expect(page.getByTestId('detail-studio')).toBeVisible();
  // 1. בחירת הפרט המוכן, תצוגה ובדיקות
  await page.getByTestId('ds-preset-preset-plate-plate-cham').click();
  await expect(page.getByTestId('ds-op-P1')).toBeVisible(); await expect(page.getByTestId('ds-op-P2')).toBeVisible();
  await expect(page.getByTestId('ds-checks')).toContainText('אין התנגשויות');
  await page.getByTestId('ds-op-P1').click();
  for (const i of [1, 2, 3, 4]) await expect(page.getByTestId(`ds-P1-c${i}`)).toHaveValue(`k${i}`); // פינות לפי פרמטר
  await expect(page.getByTestId('ds-params')).toBeVisible();
  await shot(page, 'CHAM_E1_studio');
  // 2. החלה על כל הדומים
  await page.getByTestId('ds-scope-similar').check();
  await page.getByTestId('ds-apply').click();
  await page.getByTestId('ds-close').click();
  let st = await S();
  const assigned = Object.keys(st.project.detailAssign ?? {}).length;
  expect(assigned).toBeGreaterThan(4);
  const chamPlates = () => S().then((s: any) => s.derived.members.filter((m: any) => m.kind === 'plate' && m.contour?.length === 8 && m.id.endsWith('.P2')).length);
  expect(await chamPlates()).toBe(assigned);
  expect(st.derived.issues.filter((i: any) => i.severity === 'error' && i.code !== 'CLASH').length).toBe(0);
  // 3. אשף חיבורים: שינוי קיטום ל-30 וכיבוי פינה אחת — רק למיקום הזה
  const conn = st.derived.connections.find((c: any) => c.custom); const cid = conn.id; const detId = conn.custom.detailId;
  await page.evaluate((i) => (window as any).__ksp.store.set({ activeConn: i }), cid);
  await page.evaluate((i) => (window as any).__ksp.store.set({ connWizard: i }), cid);
  await expect(page.getByTestId('conn-wizard')).toBeVisible();
  await page.getByTestId('wiz-all').click();
  await page.getByTestId(`wiz-c-custom:${detId}`).click();
  await expect(page.getByTestId('wiz-cf-ch')).toBeVisible();
  await expect(page.getByTestId('wiz-cf-k2')).toBeVisible();
  await page.getByTestId('wiz-scope-one').check();
  const chInput = page.getByTestId('wiz-p-ch');
  await chInput.fill('30'); await chInput.blur();
  await page.getByTestId('wiz-p-k2').uncheck();
  await page.getByTestId('wiz-apply').click();
  st = await S();
  const own = st.project.detailParams;
  const ownKeys = Object.keys(own).filter((k) => own[k].ch === 30);
  expect(ownKeys.length).toBe(1); // רק האתר הזה קיבל ערך מופע
  expect(own[ownKeys[0]!].k2).toBe(0);
  const oneSite = ownKeys[0]!.split('|')[0];
  const sev = await page.evaluate((id) => { const d = (window as any).__ksp.store.state.derived; return d.members.filter((m: any) => m.kind === 'plate' && m.id.endsWith('.P2') && m.id.includes(id)).map((m: any) => m.contour?.length ?? 0); }, oneSite);
  expect(sev.length).toBeGreaterThan(0); expect(sev.every((n: number) => n === 7)).toBe(true); // ch=30, 3 פינות קטומות = 7 קודקודים
  // האתרים האחרים — ללא שינוי (8)
  expect(await chamPlates()).toBe(assigned - 1);
  await shot(page, 'CHAM_E1_after_wizard');
  // 4. שמירה וטעינה (JSON → loadProject)
  const before = await page.evaluate(() => { const d = (window as any).__ksp.store.state.derived; return d.members.map((m: any) => `${m.id}:${m.contour?.length ?? 0}`).sort().join('|'); });
  await page.evaluate(() => { const k = (window as any).__ksp; const raw = JSON.parse(JSON.stringify(k.store.state.project)); k.store.loadProject(raw); });
  const after = await page.evaluate(() => { const d = (window as any).__ksp.store.state.derived; return d.members.map((m: any) => `${m.id}:${m.contour?.length ?? 0}`).sort().join('|'); });
  expect(after).toBe(before);
  // 5. ביטול ושחזור
  await page.evaluate(() => { const k = (window as any).__ksp; k.store.undo(); });
  expect(errors).toEqual([]);
});
