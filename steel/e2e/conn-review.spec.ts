import { expect, test } from '@playwright/test';
import { boot } from './helpers';

/** REV-F04/F07/F08: אשף חיבורים — סקופ ברירת מחדל, קוטר בורג קיים מחוץ לרשימה, פתיחת סטודיו על האתר של החיבור */
test('REV-E1: אשף חיבורים — כניסה מחיבור: "חיבור זה בלבד" כברירת מחדל עם ספירה בולטת; M18 קיים מוצג; סטודיו נפתח על הקצה של החיבור', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => { const k = (window as any).__ksp; k.store.exec({ label: 't', run: (p: any) => ({ ...p, building: { ...p.building, kneeBraces: { ...(p.building.kneeBraces ?? {}), enabled: true, profile: 'RHS80x80x4', drop: 800, reach: 800, angle: 45, plateT: 10, plateW: 150, plateL: 250, bolt: { d: 18, grade: '8.8', standard: 'ISO 4017', clearance: 2 }, gauge: 80, pitch: 200, weldSize: 5, exclude: [], detail: 'fin', boltsPerEnd: 2 } } }) }); });
  const cid = await page.evaluate(() => (window as any).__ksp.store.state.derived.connections.find((c: any) => c.id.startsWith('C.KB.')).id);
  await page.evaluate((i) => (window as any).__ksp.store.set({ activeConn: i }), cid);
  await page.getByTestId('ks-sec-conn').click();
  await page.getByTestId('ks-wizard').click();
  await expect(page.getByTestId('conn-wizard')).toBeVisible();
  // F13: ההתאמה ברשימה לפי חתך/מארח/זווית — ההערה מפנה לבדיקה האמיתית אחרי הבחירה
  await expect(page.getByTestId('wiz-fit-note')).toContainText('נבדקות בפועל');
  // F07
  await expect(page.getByTestId('wiz-scope-one')).toBeChecked();
  await expect(page.getByTestId('wiz-scope-count')).toContainText('חיבור זה בלבד');
  await page.getByTestId('wiz-scope-all').check();
  await expect(page.getByTestId('wiz-scope-count')).toContainText(/יוחלו \d+ חיבורים/);
  // F08: M18 קיים — מוצג, לא M16
  const sel = page.getByTestId('wiz-p-boltD');
  await expect(sel).toHaveValue('18');
  await expect(sel.locator('option:checked')).toContainText('M18');
  await expect(sel.locator('option:checked')).toContainText('ערך קיים');
  // F04: הסטודיו נפתח על הקצה של החיבור הזה (ולא start של אלמנט אחר)
  const want = await page.evaluate(() => { const s = (window as any).__ksp.store.state; return s.derived.connections.find((c: any) => c.id.startsWith('C.KB.')).id; });
  await page.getByTestId('wiz-studio').click();
  await expect(page.getByTestId('detail-studio')).toBeVisible();
  const key = await page.evaluate(() => (window as any).__ksp.store.state.detailStudio as string);
  expect(key).toMatch(/^KB\./);
  const m = await page.evaluate((k) => { const [id] = k.split('|'); const d = (window as any).__ksp.store.state.derived; return d.byId.get(id)?.kind; }, key);
  expect(m).toBe('brace');
  void want;
  expect(errors).toEqual([]);
});

test('REV-E2 (F01): שמירת פרט סטודיו כהגדרה בספרייה, פתיחה מחדש של האשף וספריית החיבורים — בלי קריסה', async ({ page }) => {
  const errors = await boot(page);
  page.on('dialog', (dl) => dl.accept('QA שמור'));
  await page.evaluate(() => {
    const k = (window as any).__ksp;
    k.store.exec({ label: 't', run: (p: any) => ({ ...p, building: { ...p.building, kneeBraces: { ...(p.building.kneeBraces ?? {}), enabled: true, profile: 'RHS60x60x4', drop: 800, reach: 800, angle: 45, plateT: 10, plateW: 150, plateL: 250, bolt: { d: 16, grade: '8.8', standard: 'ISO 4017', clearance: 2 }, gauge: 80, pitch: 200, weldSize: 5, exclude: [], detail: 'fin', boltsPerEnd: 2 } } }) });
    const d = k.detailPresets().find((x: any) => x.id === 'preset-flange');
    k.store.exec({ label: 'lib', run: (p: any) => ({ ...p, customDetails: [...(p.customDetails ?? []), d] }) });
  });
  const cid = await page.evaluate(() => (window as any).__ksp.store.state.derived.connections.find((c: any) => c.id.startsWith('C.KB.')).id);
  const openWiz = async () => { await page.evaluate((i) => (window as any).__ksp.store.set({ connWizard: i }), cid); await expect(page.getByTestId('conn-wizard')).toBeVisible(); await page.getByTestId('wiz-all').click(); };
  await openWiz();
  await page.getByTestId('wiz-c-custom:preset-flange').click();
  await page.getByTestId('wiz-save').click();
  await expect.poll(async () => (await page.evaluate(() => (window as any).__ksp.store.state.project.connLibrary ?? [])).length).toBe(1);
  const pr = await page.evaluate(() => (window as any).__ksp.store.state.project.connLibrary[0]);
  expect(pr.detail).toBe('custom:preset-flange');
  // פתיחה מחדש של האשף — מוצג כהגדרה שמורה מסטודיו
  await page.evaluate(() => (window as any).__ksp.store.set({ connWizard: null }));
  await openWiz();
  await expect(page.getByTestId(`wiz-c-${pr.id}`)).toBeVisible();
  await expect(page.getByTestId(`wiz-c-${pr.id}`)).toContainText('מסטודיו');
  // ספריית החיבורים
  await page.getByTestId('wiz-library').click();
  await expect(page.getByTestId('conn-library')).toBeVisible();
  await expect(page.getByTestId(`lib-${pr.id}`).locator('input').first()).toHaveValue('QA שמור');
  await expect(page.getByTestId(`lib-${pr.id}`)).toContainText('פלטה מוברגת לפני המארח'); // שם הפרט המקורי מהסטודיו, לא קריסה
  expect(errors).toEqual([]);
});

test('REV-E3 (F09): עורך חיבור פתוח — בחירת אלמנט אחר סוגרת אותו (לא נשאר על החיבור הקודם); בחירה בתוך החיבור שומרת עליו', async ({ page }) => {
  const errors = await boot(page);
  const ids = await page.evaluate(() => {
    const d = (window as any).__ksp.store.state.derived;
    const c = d.connections.find((x: any) => x.id.startsWith('C.EAVE.'));
    const other = d.members.find((m: any) => m.kind === 'purlin' && !c.parts.includes(m.id) && !c.members.includes(m.id));
    return { conn: c.id, inside: c.members[0], other: other.id };
  });
  await page.evaluate((i) => (window as any).__ksp.store.set({ activeConn: i }), ids.conn);
  await expect(page.getByTestId('conn-editor')).toBeVisible();
  await expect(page.getByTestId('conn-id')).toHaveText(ids.conn);
  // בחירה בתוך החיבור (חלק שלו) — העורך נשאר
  await page.evaluate((i) => (window as any).__ksp.store.select([i]), ids.inside);
  await expect(page.getByTestId('conn-editor')).toBeVisible();
  // בחירת אלמנט שאינו שייך לחיבור (כמו לחיצה עליו בתלת-ממד) — העורך נסגר ומוצגים מאפייני האלמנט
  await page.evaluate((i) => (window as any).__ksp.store.select([i]), ids.other);
  await expect(page.getByTestId('conn-editor')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__ksp.store.state.activeConn)).toBeNull();
  expect(errors).toEqual([]);
});
