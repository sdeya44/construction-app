import { expect, test } from '@playwright/test';
import { boot, openNav, shot } from './helpers';

test('MATE-E1: סטודיו — "פלטה זהה מעליה" ו"הצמד את קצה האלמנט אליה" בלחיצה, בלי נוסחאות', async ({ page }) => {
  const errors = await boot(page);
  await openNav(page, 'b:knee'); await page.getByTestId('kb-on').check();
  await page.evaluate(() => (window as any).__ksp.store.select(['KB.F2.L.L.R']));
  await page.getByTestId('ks-sec-conn').click(); await page.getByTestId('ks-sec-conn').click(); await page.getByTestId('cb-lib').click(); await page.getByTestId('studio-start').click();
  await expect(page.getByTestId('detail-studio')).toBeVisible();
  const site = await page.evaluate(() => { const S = (window as any).__kspStudio; return S.screenOf(S.site()); });
  // פלטה על המארח (ברירת מחדל מהחתך: הגדול מבין + 20)
  await page.getByTestId('ds-tool-plate:rect').click();
  await page.mouse.click(site.x - 25, site.y + 40);
  await expect(page.getByTestId('ds-op-P1')).toBeVisible();
  await expect(page.getByTestId('ds-P1-w')).toHaveValue('max(mb, hb) + 20');
  await page.getByTestId('ds-mate-stack').click();
  await expect(page.getByTestId('ds-op-P2')).toBeVisible();
  await expect(page.getByTestId('ds-P2-w')).toHaveValue('P1.w');
  await page.getByTestId('ds-op-P2').click();
  await page.getByTestId('ds-mate-flush').click();
  await expect(page.getByTestId('ds-op-C1')).toBeVisible();
  await expect(page.getByTestId('ds-C1-at')).toHaveValue('P1.t + P2.t');
  await shot(page, 'MATE_E1');
  // הצמדה על פלטה שלא על המארח — הודעה, בלי שינוי
  expect(errors).toEqual([]);
});

test('FIX-E1: סטודיו — אזהרת מרחק שפה עם כפתור "תקן", ו"הפוך לפרמטר" בלחיצה', async ({ page }) => {
  const errors = await boot(page);
  await openNav(page, 'b:knee'); await page.getByTestId('kb-on').check();
  await page.evaluate(() => (window as any).__ksp.store.select(['KB.F2.L.L.R']));
  await page.getByTestId('ks-sec-conn').click(); await page.getByTestId('ks-sec-conn').click(); await page.getByTestId('cb-lib').click(); await page.getByTestId('studio-start').click();
  const site = await page.evaluate(() => { const S = (window as any).__kspStudio; return S.screenOf(S.site()); });
  await page.getByTestId('ds-tool-plate:rect').click(); await page.mouse.click(site.x - 25, site.y + 40);
  await expect(page.getByTestId('ds-op-P1')).toBeVisible();
  const pt = await page.evaluate(() => { const S = (window as any).__kspStudio; return S.screenOf(S.plate('P1')); });
  await page.getByTestId('ds-tool-bolts').click(); await page.mouse.click(pt.x, pt.y);
  await page.getByTestId('ds-op-P1').click();
  for (const f of ['w', 'h']) { await page.getByTestId(`ds-P1-${f}`).fill('70'); await page.getByTestId(`ds-P1-${f}`).press('Enter'); }
  await expect(page.getByTestId('ds-fix')).toBeVisible();
  await expect(page.getByTestId('ds-checks')).toContainText('מרחק שפה');
  // כל לחיצה מתקנת מידה אחת (רוחב או גובה); עד שאין אזהרת שפה
  for (let n = 0; n < 4 && await page.getByTestId('ds-fix').count(); n++) await page.getByTestId('ds-fix').first().click();
  await expect(page.getByTestId('ds-checks')).not.toContainText('מרחק שפה');
  const w = Number(await page.getByTestId('ds-P1-w').inputValue()), h = Number(await page.getByTestId('ds-P1-h').inputValue());
  expect(w + h).toBeGreaterThan(140);
  // הפוך לפרמטר
  await page.getByTestId('ds-P1-w-param').click();
  await expect(page.getByTestId('ds-P1-w')).toHaveValue('P1w');
  await shot(page, 'FIX_E1');
  expect(errors).toEqual([]);
});

test('ANGLE-E1: סטודיו — כלי זוויתן: נוסף בלחיצה על המארח ונערך', async ({ page }) => {
  const errors = await boot(page);
  await openNav(page, 'b:knee'); await page.getByTestId('kb-on').check();
  await page.evaluate(() => (window as any).__ksp.store.select(['KB.F2.L.L.R']));
  await page.getByTestId('ks-sec-conn').click(); await page.getByTestId('ks-sec-conn').click(); await page.getByTestId('cb-lib').click(); await page.getByTestId('studio-start').click();
  const site = await page.evaluate(() => { const S = (window as any).__kspStudio; return S.screenOf(S.site()); });
  await page.getByTestId('ds-tool-angle').click(); await page.mouse.click(site.x - 25, site.y + 40);
  await expect(page.getByTestId('ds-op-L1')).toBeVisible();
  await page.getByTestId('ds-L1-H').fill('80'); await page.getByTestId('ds-L1-H').press('Enter');
  await expect(page.getByTestId('ds-L1-H')).toHaveValue('80');
  await shot(page, 'ANGLE_E1');
  expect(errors).toEqual([]);
});

test('STK-E1: סטודיו — פתקיות מידה על דפנות (ברירת מחדל): שם, משתנה וערך; בלי חפיפה; מעבר לקווי מידה', async ({ page }) => {
  const errors = await boot(page);
  await openNav(page, 'b:knee'); await page.getByTestId('kb-on').check();
  await page.evaluate(() => (window as any).__ksp.store.select(['KB.F2.L.L.R']));
  await page.getByTestId('ks-sec-conn').click(); await page.getByTestId('ks-sec-conn').click(); await page.getByTestId('cb-lib').click(); await page.getByTestId('studio-start').click();
  await expect(page.getByTestId('detail-studio')).toBeVisible();
  await page.waitForTimeout(900);
  const vis = () => page.evaluate(() => [...document.querySelectorAll<HTMLElement>('button.dim-tag.sticker')].filter((e) => e.style.display !== 'none' && e.style.visibility === 'visible').map((e) => { const r = e.getBoundingClientRect(); return { t: e.innerText.replace(/\s+/g, ' '), x0: r.left, x1: r.right, y0: r.top, y1: r.bottom }; }));
  const a = await vis();
  expect(a.length).toBeGreaterThanOrEqual(2);
  // כל פתקית: שם בעברית + ערך + שם המשתנה (mb / mh / hb ...)
  for (const x of a) { expect(x.t).toMatch(/=\s*\d/); expect(x.t).toMatch(/\b(mb|mh|mt|mtf|hb|[A-Z]\d+\.[whkt])\b/); }
  const hasMb = a.some((x) => /\bmb\b/.test(x.t)), hasMh = a.some((x) => /\bmh\b/.test(x.t));
  expect(hasMb || hasMh).toBe(true);
  for (let i = 0; i < a.length; i++) for (let j = 0; j < i; j++) { const p = a[i]!, q = a[j]!; expect(p.x0 < q.x1 && p.x1 > q.x0 && p.y0 < q.y1 && p.y1 > q.y0, `${p.t} ↔ ${q.t}`).toBe(false); }
  await shot(page, 'STK_E1');
  // סיבוב המצלמה: הקבוצה הגלויה משתנה (דופן שהסתובבה לאחור מאבדת את הפתקית)
  const box = (await page.getByTestId('ds-canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.8); await page.mouse.down(); await page.mouse.move(box.x + box.width * 0.5 + 420, box.y + box.height * 0.8, { steps: 12 }); await page.mouse.up();
  await page.waitForTimeout(500);
  const b = await vis();
  expect(b.map((x) => x.t).sort().join('|')).not.toBe(a.map((x) => x.t).sort().join('|'));
  // קווי מידה
  await page.getByTestId('ds-dimmode').click();
  await page.waitForTimeout(500);
  expect(await page.locator('button.dim-tag.sticker:visible').count()).toBe(0);
  expect(errors).toEqual([]);
});

test('SEC-E1: סטודיו — כרטיסי חתך עם שם המשתנה והערך על כל מידה (תמיד נראים), לחיצה על תגית, וקיפול', async ({ page }) => {
  const errors = await boot(page);
  await openNav(page, 'b:knee'); await page.getByTestId('kb-on').check();
  await page.evaluate(() => (window as any).__ksp.store.select(['KB.F2.L.L.R']));
  await page.getByTestId('ks-sec-conn').click(); await page.getByTestId('ks-sec-conn').click(); await page.getByTestId('cb-lib').click(); await page.getByTestId('studio-start').click();
  await expect(page.getByTestId('sec-cards')).toBeVisible();
  const main = page.getByTestId('sec-card-main'), host = page.getByTestId('sec-card-host');
  await expect(main).toContainText('RHS80x80x4');
  for (const k of ['mb', 'mh', 'mt']) await expect(main).toContainText(k);
  await expect(main).toContainText('80'); await expect(main).toContainText('4');
  for (const k of ['hb', 'hh', 'htf', 'htw']) await expect(host).toContainText(k);
  await expect(host).toContainText('200'); // HEA200: רוחב 200
  // מקרא בעברית לכל משתנה
  await expect(main).toContainText('רוחב חתך האלמנט');
  await expect(host).toContainText('עובי אגף המארח');
  await page.getByTestId('sec-tag-m-mb').click();
  await expect(page.getByTestId('ds-status')).toContainText('mb');
  await shot(page, 'SEC_E1');
  await page.getByTestId('sec-toggle').click();
  await expect(page.getByTestId('sec-card-main')).toHaveCount(0);
  expect(errors).toEqual([]);
});
