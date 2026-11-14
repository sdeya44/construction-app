import { expect, test } from '@playwright/test';
import { boot, screenOf, selection, setView, shot } from './helpers';

const purl = (page: any, side: string) => page.evaluate((sd: string) => (window as any).__ksp.store.state.derived.members
  .filter((m: any) => m.purlin?.side === sd).map((m: any) => [m.id, m.start.x, m.start.z, m.purlin.sSlope]), side);

test.describe('M2 – פטות, מכלולים וחלקים', () => {
  test('ROOF-01/02/03/04 דרך הממשק: פריסה, שארית, עצמאות צדדים', async ({ page }) => {
    await boot(page);
    await page.getByTestId('tab-roof').click();
    const L = await purl(page, 'L'), R = await purl(page, 'R');
    expect(L[0][0]).toBe('PL.L.01'); expect(R[0][0]).toBe('PL.R.01');
    expect(L.map((x: any) => Math.round(x[3]))).toEqual([300, 1800, 3300, 4800, 6300, 7800, 9045]);
    await expect(page.getByTestId('left-layout')).toContainText('שארית');
    await shot(page, 'ROOF_panel_iso');
    await page.getByTestId('left-spacing').fill('1.2'); await page.getByTestId('left-spacing').press('Enter');
    const L2 = await purl(page, 'L');
    expect(L2.slice(0, 3).map((x: any) => Math.round(x[3]))).toEqual([300, 1500, 2700]);
    expect(await purl(page, 'R')).toEqual(R); // ROOF-03
    await setView(page, 'front');
    await shot(page, 'ROOF_front_layout');
    await setView(page, 'top');
    await shot(page, 'ROOF_plan');
  });

  test('בחירת פטה בתלת־ממד, היפוך חתך, חתך רוחב עם מגע לקורה', async ({ page }) => {
    await boot(page);
    await setView(page, 'front');
    const [, x, z] = (await purl(page, 'L'))[0];
    // מרכז חתך C בפתיחה לכיוון הרכס: כ-40 מ"מ לכיוון הרכס, 100 מ"מ מעל הקורה
    const pt = await screenOf(page, { x: x + 40, y: 0, z: z + 100 });
    await page.evaluate(() => { const k = (window as any).__ksp; k.store.select(['PL.L.01']); k.viewport.fitSelection(); k.store.select([]); });
    const k = 100 / Math.sqrt(1.01); // 100 מ"מ לאורך הנורמל למישור הגג (-0.1, 1)
    const pt2 = await screenOf(page, { x: x - 0.1 * k, y: 0, z: z + k }); // אמצע הווב
    void pt;
    await page.mouse.click(pt2.x, pt2.y);
    expect(await selection(page)).toEqual(['PL.L.01']);
    await expect(page.getByTestId('purlin-s')).toHaveText("0.300 מ'");
    await expect(page.getByTestId('purlin-supports')).toHaveText('6');
    await shot(page, 'PURL_select_section');
    // היפוך הפטה הזו: הקו לא זז
    const before = await page.evaluate(() => (window as any).__ksp.store.state.derived.byId.get('PL.L.01').start);
    await page.getByTestId('prop-flip').selectOption('1');
    const after = await page.evaluate(() => { const m = (window as any).__ksp.store.state.derived.byId.get('PL.L.01'); return { s: m.start, o: m.purlin.opening }; });
    expect(after.s).toEqual(before);
    expect(after.o).toBe('down');
    await shot(page, 'PURL_flipped');
  });

  test('SPL-01/02: הצעת חיבורים לפטה 30 מ\', הזזת חיבור, BOM מתעדכן', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => (window as any).__ksp.store.select(['PL.L.03']));
    await expect(page.getByTestId('part-len-1')).toContainText('30.000');
    await page.getByTestId('splice-propose').click();
    await expect(page.getByTestId('part-len-1')).toHaveText('12.000');
    await expect(page.getByTestId('part-len-3')).toHaveText('6.000');
    const line = await page.evaluate(() => (window as any).__ksp.store.state.derived.byId.get('PL.L.03'));
    expect(line.start.y).toBe(0); expect(line.end.y).toBe(30000);
    await page.getByTestId('splice-0').fill('9'); await page.getByTestId('splice-0').press('Enter');
    await expect(page.getByTestId('part-len-1')).toHaveText('9.000');
    await expect(page.getByTestId('part-len-2')).toContainText('15.000');
    // רק לפטה זו
    const others = await page.evaluate(() => (window as any).__ksp.store.state.derived.parts.filter((p: any) => p.memberId === 'PL.L.04').length);
    expect(others).toBe(1);
    await shot(page, 'SPL_parts');
    // הצעה לכל הפטות מכפתור לשונית הגג
    await page.getByTestId('tab-roof').click();
    await page.getByTestId('propose-purlin-splices').click();
    await expect(page.getByTestId('purlin-splice-count')).toHaveText('28');
    await page.keyboard.press('Escape');
    await setView(page, 'iso', 'persp');
    await shot(page, 'SPL_markers');
  });

  test('BEAM-01: קורת גג ארוכה – מכלול אחד, חלקים וחיבורי המשך ניתנים לעריכה', async ({ page }) => {
    await boot(page);
    await page.getByTestId('roofType').selectOption('mono');
    await page.getByTestId('width').fill('14'); await page.getByTestId('width').press('Enter');
    await page.evaluate(() => (window as any).__ksp.store.select(['F1.RAF']));
    await expect(page.getByTestId('parts-table')).toContainText('ארוך');
    await page.getByTestId('splice-add').click();
    await page.getByTestId('splice-new').fill('6'); await page.getByTestId('splice-new').press('Tab');
    await page.getByTestId('splice-add-ok').click();
    const parts = await page.evaluate(() => (window as any).__ksp.store.state.derived.parts.filter((p: any) => p.memberId === 'F1.RAF').map((p: any) => Math.round(p.length)));
    expect(parts.length).toBe(2);
    expect(parts.every((l: number) => l <= 12000)).toBe(true);
    const rafters = await page.evaluate(() => (window as any).__ksp.store.state.derived.members.filter((m: any) => m.kind === 'rafter' && m.frameId === 'F1').length);
    expect(rafters).toBe(1);
    await page.getByTestId('splice-del-0').click();
    expect(await page.evaluate(() => (window as any).__ksp.store.state.derived.parts.filter((p: any) => p.memberId === 'F1.RAF').length)).toBe(1);
    // ROOF-05 בממשק: גג חד־שיפועי, שני צדי התחלה
    await page.getByTestId('tab-roof').click();
    const M1 = await purl(page, 'M');
    await page.getByTestId('monoStart').selectOption('low');
    const M2 = await purl(page, 'M');
    expect(M1[0][1]).not.toBe(M2[0][1]);
    expect(Math.round(M2[0][3])).toBe(0);
    await setView(page, 'front');
    await shot(page, 'ROOF05_mono');
  });
});
