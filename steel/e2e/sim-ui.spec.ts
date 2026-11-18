import { expect, test, type Page } from '@playwright/test';
import { boot, screenOf, selection, setView, pickProfile, profileSizes } from './helpers';

/**
 * סימולציית משתמש בממשק — כל תבנית: אשף ← לחיצה על עמוד במודל ← שינוי חתך לכולם ← קורה אחת בחתך אחר ←
 * מחיקת פטה ו-Ctrl+Z ← גיליון פרמטרים ← שרטוטים ← ייצור. בכל שלב: אין חריגות בדף ואין שגיאות במודל.
 */
const TEMPLATES = ['gable', 'mono', 'mono-multi', 'gable-inner', 'gable-cant', 'stepped', 'gable-center', 'twin-gable', 'butterfly', 'sawtooth', 't-canopy', 'cantilever'];

const st = (page: Page) => page.evaluate(() => {
  const s = (window as any).__ksp.store.state;
  return { err: s.derived.issues.filter((i: any) => i.severity === 'error').map((i: any) => `${i.code}: ${i.message.slice(0, 80)}`), members: s.derived.members.length };
});
/** לחיצה במודל על אמצע אלמנט מהסוג המבוקש (בחירה אמיתית בעכבר) */
async function clickMember(page: Page, pick: (m: any) => boolean): Promise<string | null> {
  const ms = await page.evaluate((src) => {
    const f = new Function('m', `return (${src})(m)`);
    return (window as any).__ksp.store.state.derived.members.filter((m: any) => f(m)).slice(0, 6).map((m: any) => ({ id: m.id, p: { x: (m.start.x + m.end.x) / 2, y: (m.start.y + m.end.y) / 2, z: (m.start.z + m.end.z) / 2 } }));
  }, pick.toString());
  for (const m of ms) {
    const c = await screenOf(page, m.p);
    if (!c) continue;
    await page.mouse.click(c.x, c.y);
    await page.waitForTimeout(150);
    const sel = await selection(page);
    if (sel.length === 1) return sel[0]!;
  }
  // לא נבחר בלחיצה (מוסתר מאחורי אלמנט אחר) — בחירה דרך החיפוש
  if (ms[0]) { await page.evaluate((id) => (window as any).__ksp.store.select([id]), ms[0].id); return ms[0].id; }
  return null;
}
async function nextSize(page: Page) {
  const opts = await profileSizes(page, 'prop-profile');
  const cur = await page.getByTestId('prop-profile').inputValue();
  const i = opts.indexOf(cur);
  return opts[Math.min(opts.length - 1, i + 1)] === cur ? opts[Math.max(0, i - 1)]! : opts[Math.min(opts.length - 1, i + 1)]!;
}
async function acceptEave(page: Page) {
  for (let k = 0; k < 3; k++) {
    if (!(await page.getByTestId('eave-check').count())) return;
    await page.getByTestId('eave-apply-default').click();
    await page.waitForTimeout(200);
  }
}

for (const t of TEMPLATES) {
  test(`SIM-UI ${t}: אשף ← עריכות במודל ← שרטוטים ← ייצור`, async ({ page }) => {
    test.setTimeout(150000);
    const errors = await boot(page);
    const problems: string[] = [];
    const check = async (stage: string) => { const s = await st(page); if (s.err.length) problems.push(`${stage}: ${s.err.slice(0, 3).join(' | ')}`); return s; };

    await page.getByTestId('btn-new').click();
    await page.getByTestId(`np-${t}`).click();
    await page.getByTestId('wz-step-4').click();
    if (!(await page.getByTestId('np-knee').isChecked())) await page.getByTestId('np-knee').check();
    await page.getByTestId('wz-step-5').click();
    await page.getByTestId('np-clad-walls').click();
    await page.getByTestId('create').click();
    await page.waitForTimeout(400);
    await check('יצירה');

    // עמוד: לחיצה במודל, חתך גדול יותר — לכל העמודים
    await setView(page, 'front');
    const col = await clickMember(page, (m) => m.kind === 'column');
    expect(col, 'נבחר עמוד').toBeTruthy();
    await pickProfile(page, 'prop-profile', await nextSize(page));
    if (await page.getByTestId('scope-ask').count()) await page.getByTestId('scope-ask-all').click();
    await acceptEave(page);
    await check('חתך עמודים');

    // קורה אחת בחתך אחר (חריג)
    const raf = await clickMember(page, (m) => m.kind === 'rafter');
    expect(raf, 'נבחרה קורה').toBeTruthy();
    await pickProfile(page, 'prop-profile', await nextSize(page));
    if (await page.getByTestId('scope-ask').count()) await page.getByTestId('scope-ask-one').click();
    await acceptEave(page);
    await check('חריג לקורה');

    // מחיקת פטה וביטול
    await page.keyboard.press('Escape');
    await setView(page, 'top');
    const before = (await st(page)).members;
    const pl = await clickMember(page, (m) => m.kind === 'purlin');
    expect(pl, 'נבחרה פטה').toBeTruthy();
    await page.keyboard.press('Delete');
    expect((await st(page)).members).toBeLessThan(before);
    await page.keyboard.press('Control+z');
    expect((await st(page)).members).toBe(before);
    await page.keyboard.press('Escape');

    // גיליון פרמטרים: מסגרת נוספת
    await page.getByTestId('nav-s:sheet').click();
    const n = Number(await page.getByTestId('ps-מספר מסגרות').inputValue());
    await page.getByTestId('ps-מספר מסגרות').fill(String(n + 1)); await page.getByTestId('ps-מספר מסגרות').press('Enter');
    await acceptEave(page);
    await page.keyboard.press('Escape');
    await check('מסגרת נוספת');

    // שרטוטים וייצור
    await page.getByTestId('mode-drawings').click();
    await expect(page.getByTestId('dwg-sheet')).toBeVisible({ timeout: 20000 });
    await page.getByTestId('mode-production').click();
    await expect(page.getByTestId('production-view')).toBeVisible();
    if (await page.getByTestId('run-numbering').count()) await page.getByTestId('run-numbering').click();
    await page.getByRole('button', { name: 'מודל' }).first().click();

    expect(problems, problems.join('\n')).toEqual([]);
    expect(errors).toEqual([]);
  });
}
