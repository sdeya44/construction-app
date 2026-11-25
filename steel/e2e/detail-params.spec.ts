import { expect, test } from '@playwright/test';
import { boot, shot } from './helpers';

const S = (page: import('@playwright/test').Page) => page.evaluate(() => (window as any).__ksp.store.state);

/** DPAR-E1: אשף דינמי לפרט מהספרייה (מתכון v2) — שדות מ-params, ערך למופע בלבד, איפוס, ועדכון תבנית */
test('DPAR-E1: אשף החיבורים בונה שדות מהפרמטרים של פרט סטודיו; ערך נשמר לקצה בלבד ולא משנה את התבנית', async ({ page }) => {
  const errors = await boot(page);
  // אלכסוני עמוד-קורה (RHS) + פרט מוכן "פלטה מוברגת לפני המארח" בספרייה (הוא כולל params: קוטר בורג, מרחק שפה, מרווח שורות)
  await page.evaluate(() => {
    const k = (window as any).__ksp;
    k.store.exec({ label: 't', run: (p: any) => ({ ...p, building: { ...p.building, kneeBraces: { ...(p.building.kneeBraces ?? {}), enabled: true, profile: 'RHS60x60x4', drop: 800, reach: 800, angle: 45, plateT: 10, plateW: 150, plateL: 250, bolt: { d: 16, grade: '8.8', standard: 'ISO 4017', clearance: 2 }, gauge: 80, pitch: 200, weldSize: 5, exclude: [] } } }) });
  });
  const det = await page.evaluate(async () => {
    const k = (window as any).__ksp;
    const d = k.detailPresets().find((x: any) => x.id === 'preset-flange');
    k.store.exec({ label: 'lib', run: (p: any) => ({ ...p, customDetails: [...(p.customDetails ?? []), d] }) });
    return d.id;
  });
  const cid = await page.evaluate(() => (window as any).__ksp.store.state.derived.connections.find((c: any) => c.id.startsWith('C.KB.')).id);
  await page.evaluate((i) => (window as any).__ksp.store.set({ connWizard: i }), cid);
  await expect(page.getByTestId('conn-wizard')).toBeVisible();
  await page.getByTestId('wiz-all').click();
  await page.getByTestId(`wiz-c-custom:${det}`).click();
  // שדות דינמיים מה-params
  await expect(page.getByTestId('wiz-cf-d')).toBeVisible();
  await expect(page.getByTestId('wiz-cf-e')).toBeVisible();
  await expect(page.getByTestId('wiz-p-d')).toHaveValue('16');
  await page.getByTestId('wiz-p-d').selectOption('20');
  await shot(page, 'DPAR_01_wizard');
  await page.getByTestId('wiz-scope-one').check();
  await page.getByTestId('wiz-apply').click();
  const st = await S(page);
  const keys = Object.keys(st.project.detailAssign ?? {});
  expect(keys.length).toBe(1);
  expect(st.project.detailParams[keys[0]!]).toEqual({ d: 20 });
  // התבנית בספרייה לא השתנתה (ברירת המחדל נשארת 16)
  expect(st.project.customDetails.find((x: any) => x.id === det).vars.find((v: any) => v.name === 'd').expr).toBe('16');
  // הבורג במודל בקוטר החדש
  const bolts = st.derived.connections.find((c: any) => c.custom?.site === keys[0]).bolts;
  expect(bolts.length).toBeGreaterThan(0);
  expect(bolts.every((b: any) => b.d === 20)).toBe(true);
  expect(st.derived.issues.filter((i: any) => i.severity === 'error' && i.code !== 'CLASH')).toEqual([]);
  // (פתיחת האשף מחיבור שכבר הוחלף בפרט מותאם אינה נתמכת עדיין — ההתאמה החיה נעשית בבלוק המחבר, ראו DPAR-E2)
  expect(errors).toEqual([]);
});

/** DPAR-E2: מכוונן חי בבלוק המחבר (ללא אשף): ערך נשמר לקצה, "עדכן תבנית" משנה ברירת מחדל, איפוס */
test('DPAR-E2: טופס פרמטרים חי — רק בקצה הזה / עדכן תבנית / איפוס', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => {
    const k = (window as any).__ksp;
    k.store.exec({ label: 't', run: (p: any) => ({ ...p, building: { ...p.building, kneeBraces: { ...(p.building.kneeBraces ?? {}), enabled: true, profile: 'RHS60x60x4', drop: 800, reach: 800, angle: 45, plateT: 10, plateW: 150, plateL: 250, bolt: { d: 16, grade: '8.8', standard: 'ISO 4017', clearance: 2 }, gauge: 80, pitch: 200, weldSize: 5, exclude: [] } } }) });
  });
  const det = await page.evaluate(() => {
    const k = (window as any).__ksp;
    const d = k.detailPresets().find((x: any) => x.id === 'preset-flange');
    k.store.exec({ label: 'lib', run: (p: any) => ({ ...p, customDetails: [...(p.customDetails ?? []), d] }) });
    const br = k.store.state.derived.members.find((m: any) => m.id.startsWith('KB.'));
    k.store.exec(k.assignDetail([`${br.id}|start`], d));
    return { id: d.id, key: `${br.id}|start`, br: br.id };
  });
  await page.evaluate((id) => (window as any).__ksp.store.select([id]), det.br);
  // הטופס מוטמע בבלוק המחבר של הרכיב הנבחר
  const form = page.getByTestId('dpf');
  if (!(await form.count())) {
    await page.getByTestId('ks-sec-conn').click().catch(() => {});
    await page.getByTestId('cb-lib').click().catch(() => {});
  }
  await expect(form).toBeVisible();
  await form.getByTestId('dpf-d').selectOption('24');
  let st = await S(page);
  expect(st.project.detailParams[det.key]).toEqual({ d: 24 });
  await expect(form.getByTestId('dpf-reset')).toBeVisible();
  await form.getByTestId('dpf-reset').click();
  st = await S(page);
  expect(st.project.detailParams).toBeUndefined();
  // עדכון תבנית
  await form.getByTestId('dpf-scope-tpl').click();
  await form.getByTestId('dpf-d').selectOption('20');
  st = await S(page);
  expect(st.project.customDetails.find((x: any) => x.id === det.id).vars.find((v: any) => v.name === 'd').expr).toBe('20');
  expect(st.project.detailParams).toBeUndefined();
  await shot(page, 'DPAR_02_live_form');
  expect(errors).toEqual([]);
});
