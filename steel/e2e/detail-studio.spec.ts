import { expect, test } from '@playwright/test';
import { boot, shot } from './helpers';

const openStudio = async (page: import('@playwright/test').Page) => {
  await page.getByTestId('nav-b:knee').click();
  await page.getByTestId('kb-on').check();
  await page.evaluate(() => (window as any).__ksp.store.select(['KB.F2.L.L.R']));
  await page.getByTestId('studio-start').click();
  await expect(page.getByTestId('detail-studio')).toBeVisible();
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
  await expect(page.getByTestId('detail-ends')).toContainText('סנפיר');
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
