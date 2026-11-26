import { expect, test } from '@playwright/test';
import { boot, shot, openNav } from './helpers';

const openStudio = async (page: import('@playwright/test').Page) => {
  await openNav(page, 'b:knee');
  await page.getByTestId('kb-on').check();
  await page.evaluate(() => (window as any).__ksp.store.select(['KB.F2.L.L.R']));
  await page.getByTestId('ks-sec-conn').click(); // 1.56: חתך ומחברים — קצוות האלכסון
  await page.getByTestId('ks-sec-conn').click(); await page.getByTestId('cb-lib').click(); // 1.63: פרט מהספרייה / סטודיו — בבלוק המחבר
  await page.getByTestId('studio-start').click();
  await expect(page.getByTestId('detail-studio')).toBeVisible();
  // ברירת המחדל מ-1.92: פתקיות על דפנות. בדיקות הסטודיו הקיימות בודקות את מצב "קווי מידה" (DS-03/DS-05) ולכן עוברות אליו; פתקיות — e2e/studio-mates.spec.ts STK-E1
  await page.getByTestId('ds-dimmode').click();
};

test('DS-01: סטודיו פרטים — פרט מוכן, בדיקות ירוקות, החלה על כל הדומים', async ({ page }) => {
  const errors = await boot(page);
  await openStudio(page);
  await page.getByTestId('ds-preset-preset-fin').click();
  await expect(page.getByTestId('ds-op-T1')).toBeVisible();
  await expect(page.getByTestId('ds-checks')).toContainText('אין התנגשויות');
  await page.getByTestId('ds-scope-similar').check();
  await page.getByTestId('ds-apply').click();
  await shot(page, 'DS_01_studio');
  const r = await page.evaluate(() => {
    const s = (window as any).__ksp.store.state;
    return { assign: Object.keys(s.project.detailAssign ?? {}).length, custom: s.derived.connections.filter((c: any) => c.type === 'custom').length,
      clash: s.derived.issues.filter((i: any) => i.code === 'CLASH' || i.code.startsWith('CD_')).filter((i: any) => i.severity === 'error').length };
  });
  expect(r.assign).toBeGreaterThan(4);
  expect(r.custom).toBe(r.assign);
  expect(r.clash).toBe(0);
  await page.getByTestId('ds-close').click();
  await expect(page.getByTestId('end-type-start')).toContainText('סנפיר'); // 1.63: הפרט שנבחר — בבלוק המחבר (מהספרייה)
  expect(errors).toEqual([]);
});

test('DS-02: גרירת פלטה מהמחסן, נוסחה ושגיאה, מישור ניצב, ברגים בגרירה', async ({ page }) => {
  const errors = await boot(page);
  await openStudio(page);
  const cv = (await page.getByTestId('ds-canvas').boundingBox())!;
  const drag = async (tool: string, x: number, y: number) => {
    const t = (await page.getByTestId(`ds-tool-${tool}`).boundingBox())!;
    await page.mouse.move(t.x + 20, t.y + 10); await page.mouse.down();
    await page.mouse.move(x, y, { steps: 8 }); await page.mouse.up();
  };
  // מיקום פני המגע של העמוד על המסך: נקודת האתר
  await drag('plate:rect', cv.x + cv.width / 2, cv.y + cv.height / 2);
  await expect(page.getByTestId('ds-op-P1')).toBeVisible();
  await page.getByTestId('ds-P1-w').fill('mh + 70');
  await expect(page.getByTestId('ds-props')).toContainText('= 150');
  await page.getByTestId('ds-P1-w').fill('mh + zz');
  await expect(page.getByTestId('ds-props')).toContainText('zz');
  await expect(page.getByTestId('ds-apply')).toBeDisabled();
  await page.getByTestId('ds-P1-w').fill('150');
  // ברגים בלחיצה: כלי חמוש ← לחיצה על הפלטה
  const ops = () => page.getByTestId('ds-ops').innerText();
  await page.getByTestId('ds-tool-bolts').click();
  const pt = await page.evaluate(() => { const S = (window as any).__kspStudio; return S.screenOf(S.plate('P1')); });
  await page.mouse.click(pt.x, pt.y);
  await expect.poll(ops).toContain('ברגים');
  await shot(page, 'DS_02_drag');
  expect(errors).toEqual([]);
});

test('DS-03: בונה נוסחה בלחצנים — "הגדול מבין" עם מידות מהשרטוט; אותיות גדולות; Delete לא מוחק מהמודל; כלי חמוש — גרירה מסובבת', async ({ page }) => {
  const errors = await boot(page);
  await openStudio(page);
  const cv = (await page.getByTestId('ds-canvas').boundingBox())!;
  // כלי חמוש: גרירה על הקנבס = סיבוב, לא מוסיף פלטה
  await page.getByTestId('ds-tool-plate:rect').click();
  await page.mouse.move(cv.x + cv.width / 2, cv.y + cv.height / 2); await page.mouse.down();
  await page.mouse.move(cv.x + cv.width / 2 + 120, cv.y + cv.height / 2 + 40, { steps: 6 }); await page.mouse.up();
  await expect(page.getByTestId('ds-op-P1')).toHaveCount(0);
  // לחיצה = הנחה, והכלי משתחרר — לחיצה נוספת לא מוסיפה
  const pt = await page.evaluate(() => { const S = (window as any).__kspStudio; return S.screenOf(S.site()); });
  await page.mouse.click(pt.x, pt.y);
  await expect(page.getByTestId('ds-op-P1')).toBeVisible();
  await page.mouse.click(pt.x, pt.y);
  await expect(page.getByTestId('ds-op-P2')).toHaveCount(0);
  // אות גדולה = קטנה
  await page.getByTestId('ds-op-P1').click();
  await page.getByTestId('ds-P1-w').fill('MB + 70');
  await expect(page.getByTestId('ds-props')).toContainText('= 150');
  // בונה נוסחה: הגדול מבין (רוחב האלמנט + 40) ובין (רוחב המארח)
  await page.getByTestId('ds-P1-w-fx').click();
  await expect(page.getByTestId('fx-builder')).toBeVisible();
  await page.getByTestId('fx-back').click(); await page.getByTestId('fx-back').click(); await page.getByTestId('fx-back').click();
  await page.getByTestId('fx-max').click();
  await page.getByTestId('tag-mb').click();
  await page.getByTestId('fx-op-+').click();
  await page.getByTestId('fx-num').fill('40'); await page.getByTestId('fx-num-add').click();
  await page.getByTestId('tag-hb').click();
  await expect(page.getByTestId('fx-res')).toContainText('= 200');
  await shot(page, 'DS_03_builder');
  await page.getByTestId('fx-ok').click();
  await expect(page.getByTestId('ds-P1-w')).toHaveValue('max(mb + 40, hb)');
  await expect(page.getByTestId('ds-props')).toContainText('הגדול מבין');
  // Delete בסטודיו מוחק את הפעולה בלבד
  await page.getByTestId('ds-op-P1').click();
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('ds-op-P1')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__ksp.store.state.project.deleted.length)).toBe(0);
  expect(errors).toEqual([]);
});

test('DS-05 (1.70): מידות בסטודיו לפי המבט — כל תגית על קו המידה שלה, בלי חפיפה; בחירת פלטה מצמצמת; מעבר עכבר מדגיש', async ({ page }) => {
  await boot(page);
  await openStudio(page);
  await page.getByTestId('ds-preset-preset-fin').click();
  await page.waitForTimeout(500);
  const check = async () => {
    const r = await page.evaluate(() => {
      const pills = [...document.querySelectorAll<HTMLElement>('button.dim-tag')].filter((e) => e.style.display !== 'none' && e.style.visibility === 'visible');
      const boxes = pills.map((e) => e.getBoundingClientRect());
      const overlap = boxes.some((a, i) => boxes.some((b, j) => j < i && a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1));
      const missing = pills.filter((e) => !document.querySelector(`.dim-svg g[data-k="${e.dataset.k}"]`)).length;
      return { n: pills.length, overlap, missing };
    });
    expect(r.n).toBeGreaterThan(2); expect(r.overlap).toBe(false); expect(r.missing).toBe(0);
  };
  await check();
  const st = (await page.locator('.studio-stage').boundingBox())!;
  await page.mouse.move(st.x + 60, st.y + st.height - 80); await page.mouse.down(); await page.mouse.move(st.x + 320, st.y + st.height - 200, { steps: 8 }); await page.mouse.up();
  await page.waitForTimeout(300);
  await check();
  await page.getByTestId('ds-op-T1').click(); await page.waitForTimeout(300);
  const ks = await page.locator('button.dim-tag').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.k!));
  expect(ks.every((k) => k.startsWith('T1.') || !k.includes('.'))).toBe(true);
  const t = page.locator('button.dim-tag[data-k^="T1."]:visible').first();
  const k = await t.getAttribute('data-k');
  await t.hover();
  await expect(page.locator(`.dim-svg g[data-k="${k}"]`)).toHaveClass(/hot/);
});
