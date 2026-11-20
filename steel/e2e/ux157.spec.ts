import { expect, test } from '@playwright/test';
import { boot, openNav, shot } from './helpers';

/** 1.57 — אב-טיפוס מערכת האשפים האחידה (קשיחות קירות): טרנזקציה, תחולה מודגשת, העתקת הגדרות, תקינות, כניסה מתפריט הקשר */
const W = (page: import('@playwright/test').Page) => page.evaluate(() => (window as any).__ksp.store.state.project.building.bracing.walls);

test('WZ-01: ביטול מחזיר את המודל למצב שלפני פתיחת האשף; אישור = צעד Undo אחד', async ({ page }) => {
  const errors = await boot(page);
  const t0 = (await W(page)).type ?? 'x';
  await openNav(page, 'b:walls');
  const win = page.getByTestId('cwin-walls');
  await expect(win.getByTestId('wz-actions')).toBeVisible();
  await expect(win.getByTestId('wz-undo')).toBeDisabled();
  // שינוי חי: אגד B — המודל משתנה מיד
  await win.getByTestId('br-walls-portal').click();
  expect((await W(page)).type).toBe('portal');
  expect(await page.evaluate(() => (window as any).__ksp.store.state.derived.members.some((m: any) => /^BB\./.test(m.id)))).toBe(true);
  await expect(win.getByTestId('wz-undo')).toBeEnabled();
  // ביטול — חזרה למצב שלפני, החלון נסגר
  await win.getByTestId('wz-cancel').click();
  await expect(page.getByTestId('cwin-walls')).toHaveCount(0);
  expect((await W(page)).type ?? 'x').toBe(t0);
  expect(await page.evaluate(() => (window as any).__ksp.store.state.derived.members.some((m: any) => /^BB\./.test(m.id)))).toBe(false);
  // שוב: שני שינויים ואישור — Undo אחד מחזיר את שניהם
  await openNav(page, 'b:walls');
  await win.getByTestId('br-walls-portal').click();
  await win.getByTestId('pscope-asm').click();
  await win.getByTestId('br-walls-truss').click();
  const w1 = await W(page);
  expect(w1.type).toBe('portal'); expect(Object.values(w1.lineType ?? {})).toContain('truss');
  await win.getByTestId('wz-ok').click();
  await expect(page.getByTestId('cwin-walls')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__ksp.store.state.undoLabel)).toBe('אשף: קשיחות קירות');
  await page.evaluate(() => (window as any).__ksp.store.undo());
  const w2 = await W(page);
  expect(w2.type ?? 'x').toBe(t0); expect(w2.lineType).toBeFalsy();
  expect(errors).toEqual([]);
});

test('WZ-02: תחולה מודגשת במודל, שחזור בתוך האשף, העתקת הגדרות לציר אחר, תקינות', async ({ page }) => {
  const errors = await boot(page);
  await openNav(page, 'b:walls');
  const win = page.getByTestId('cwin-walls');
  await win.getByTestId('br-walls-portal').click();
  // כל המודל — ההדגשה כוללת את כל אלמנטי הקשיחות; ציר אחד — פחות
  await win.getByTestId('pscope-asmall').click();
  const hiAll = await page.evaluate(() => (window as any).__ksp.store.state.scopeHi?.length ?? 0);
  await win.getByTestId('pscope-asm').click();
  const hiLine = await page.evaluate(() => (window as any).__ksp.store.state.scopeHi?.length ?? 0);
  expect(hiAll).toBeGreaterThan(hiLine); expect(hiLine).toBeGreaterThan(0);
  await expect(win.getByTestId('wz-scope-note')).toContainText(String(hiLine));
  // שחזור בתוך האשף
  await win.getByTestId('br-walls-truss').click();
  await win.getByTestId('wz-undo').click();
  expect(Object.values((await W(page)).lineType ?? {})).not.toContain('truss');
  // העתקה: ציר ראשון — מסבך נעילה; הדבקה לציר השני
  await win.getByTestId('br-walls-truss').click();
  const lines: string[] = await page.evaluate(() => (window as any).__ksp.store.state.derived.section.lines.map((l: any) => l.id));
  await win.getByTestId('ks-line').selectOption(lines[0]);
  await win.getByTestId('br-walls-truss').click();
  await win.getByTestId('wz-copy').click();
  await win.getByTestId('ks-line').selectOption(lines[lines.length - 1]);
  await win.getByTestId('wz-paste').click();
  const w = await W(page);
  expect(w.lineType?.[lines[0]]).toBe('truss'); expect(w.lineType?.[lines[lines.length - 1]]).toBe('truss');
  await expect(win.getByTestId('wz-valid')).toBeVisible();
  await shot(page, 'WZ_02_walls');
  // סגירה ב-✕ שומרת
  await win.getByTestId('cwin-close').click();
  expect((await W(page)).lineType?.[lines[0]]).toBe('truss');
  expect(errors).toEqual([]);
});

test('WZ-03: תפריט ההקשר — "עריכה" פותח את חלון העריכה של האלמנט', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => (window as any).__ksp.store.select(['F2.COL.L']));
  await page.getByTestId('cwin-close').click(); // 1.64: האלמנט — באותו חלון
  const pt = await page.evaluate(() => { const k = (window as any).__ksp; k.viewport.fitAll(); const m = k.store.state.derived.byId.get('F2.COL.L'); return k.viewport.screenOf({ x: m.start.x, y: m.start.y, z: (m.start.z + m.end.z) / 2 }); });
  await page.mouse.click(pt.x, pt.y, { button: 'right' });
  await page.getByTestId('mm-edit').click();
  await expect(page.getByTestId('props-single')).toBeVisible();
  expect(errors).toEqual([]);
});

test('WZ-04: אשף האלכסונים על הרכיבים המשותפים — זוג מידות תלוי מסומן "לא תקין"; ביטול מחזיר', async ({ page }) => {
  const errors = await boot(page);
  await openNav(page, 'b:knee');
  const win = page.getByTestId('cwin-knee');
  await win.getByTestId('ks-type-knee').click();
  await win.getByTestId('pscope-asm').click();
  // הדגשה במודל: כל האלכסונים + החלקים שלהם
  expect(await page.evaluate(() => (window as any).__ksp.store.state.scopeHi?.length ?? 0)).toBeGreaterThan(12);
  await win.getByTestId('ks-sec-geo').click();
  await expect(win.getByTestId('kd-row-v')).toHaveAttribute('data-state', 'locked');
  await expect(win.getByTestId('kd-row-h')).toHaveAttribute('data-state', 'computed');
  // מידה צירית + בין נקודות המגע — כמעט מקבילות: לא תקין
  await win.getByTestId('kd-lock-ax').click();
  await win.getByTestId('kd-lock-face').click();
  await expect(win.getByTestId('ks-pair-bad')).toBeVisible({ timeout: 10000 });
  await expect(win.getByTestId('kd-row-face')).toHaveAttribute('data-state', 'invalid');
  // חזרה לזוג תקין
  await win.getByTestId('kd-lock-v').click();
  await expect(win.getByTestId('ks-pair-bad')).toHaveCount(0, { timeout: 10000 });
  // ביטול — האלכסונים חוזרים למצב שלפני (כבויים)
  await win.getByTestId('wz-cancel').click();
  expect(await page.evaluate(() => (window as any).__ksp.store.state.project.building.kneeBraces?.enabled ?? false)).toBe(false);
  expect(errors).toEqual([]);
});
