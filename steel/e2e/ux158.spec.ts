import { expect, test } from '@playwright/test';
import { boot, openNav, shot } from './helpers';

/** 1.58 — מערכת האשפים האחידה בכל התוכנה: כל משפחת רכיבים באותו חלון ובאותו מבנה */
const FAMS: [string, string][] = [
  ['b:roof', 'roofx'], ['b:ties', 'ties'], ['b:ridge', 'ridge'], ['r:left', 'purlins'], ['r:right', 'purlins'], ['r:splices', 'purlins'],
  ['w:roof', 'clad'], ['w:walls', 'clad'], ['w:openings', 'clad'], ['b:tb', 'tb'], ['b:wing', 'wing'], ['b:truss', 'truss'], ['s:geometry', 'frame'], ['s:profiles', 'frame'],
];

test('FW-01: כל כלי פותח את האשף האחיד של המשפחה — סוג/היקף/3 קבוצות/פעולות', async ({ page }) => {
  test.setTimeout(180000); // 14 אשפים עם תלת-ממד
  const errors = await boot(page);
  for (const [nav, fam] of FAMS) {
    await openNav(page, nav);
    const win = page.getByTestId(`cwin-${fam}`);
    await expect(win, nav).toBeVisible();
    await expect(win.getByTestId('wz-actions')).toBeVisible();
    // רכיב לא פעיל (חיפוי / כנף / מסבך / חיזוק רכס / שורות קשירה) — מוצעת הוספה; פעיל — היקף ושלוש קבוצות
    if (await win.getByTestId('ks-scope').count()) {
      for (const s of ['loc', 'geo', 'conn']) {
        await win.getByTestId(`ks-sec-${s}`).click();
        await expect(win.getByTestId(`ks-${s}`), `${nav} ${s}`).toBeVisible();
      }
    }
  }
  expect(errors).toEqual([]);
});

test('FW-02: קושרות גג — שינוי חי, ביטול מחזיר, אישור = Undo אחד; העתקה בין שיפועי הפטות', async ({ page }) => {
  const errors = await boot(page);
  const R = () => page.evaluate(() => (window as any).__ksp.store.state.project.building.bracing.roof);
  const t0 = (await R()).type ?? 'x';
  await openNav(page, 'b:roof');
  const win = page.getByTestId('cwin-roofx');
  await win.getByTestId('br-roof-type-rhs').click();
  expect((await R()).type).toBe('rhs');
  expect(await page.evaluate(() => (window as any).__ksp.store.state.derived.members.some((m: any) => /^HB\./.test(m.id)))).toBe(true);
  await win.getByTestId('wz-cancel').click();
  await expect(page.getByTestId('cwin-roofx')).toHaveCount(0);
  expect((await R()).type ?? 'x').toBe(t0);
  // אישור: שני שינויים = פעולה אחת בהיסטוריה
  await openNav(page, 'b:roof');
  await win.getByTestId('br-roof-type-rhs').click();
  await win.getByTestId('ks-sec-geo').click();
  await win.getByTestId('br-samegap').locator('input').or(win.getByTestId('br-samegap')).first().fill('260');
  await win.getByTestId('br-samegap').locator('input').or(win.getByTestId('br-samegap')).first().press('Enter');
  await expect.poll(async () => (await R()).sameGap).toBe(260);
  await win.getByTestId('wz-ok').click();
  expect(await page.evaluate(() => (window as any).__ksp.store.state.undoLabel)).toBe('אשף: קושרות גג');
  await page.evaluate(() => (window as any).__ksp.store.undo());
  const r2 = await R();
  expect(r2.type ?? 'x').toBe(t0); expect(r2.sameGap ?? 200).toBe(200);
  // פטות: היקף = שיפוע; העתקה משמאל והדבקה לימין
  await openNav(page, 'r:left');
  const pw = page.getByTestId('cwin-purlins');
  await expect(pw.getByTestId('pscope-L')).toHaveClass(/on/);
  await page.evaluate(() => { const s = (window as any).__ksp.store; const pu = s.state.project.building.purlins; s.exec({ label: 'x', run: (p: any) => ({ ...structuredClone(p), building: { ...p.building, purlins: { ...pu, left: { ...pu.left, spacing: 1250 } } } }) }); });
  await pw.getByTestId('wz-copy').click();
  await pw.getByTestId('pscope-R').click();
  await pw.getByTestId('wz-paste').click();
  expect(await page.evaluate(() => (window as any).__ksp.store.state.project.building.purlins.right.spacing)).toBe(1250);
  await shot(page, 'fw-02-purlins');
  expect(errors).toEqual([]);
});

test('FW-03: לחיצה על קושרת גג במודל פותחת את אותו אשף, עם "האלמנט שנבחר"; מכפל — שלוש קבוצות', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => { const s = (window as any).__ksp.store; const br = s.state.project.building.bracing; s.exec({ label: 'x', run: (p: any) => ({ ...structuredClone(p), building: { ...p.building, bracing: { ...br, roof: { ...br.roof, enabled: true } } } }) }); });
  const id = await page.evaluate(() => (window as any).__ksp.store.state.derived.members.find((m: any) => /^BR\.R/.test(m.id) && m.kind === 'brace').id);
  await page.evaluate((id) => { (window as any).__ksp.store.select([id]); }, id);
  const win = page.getByTestId('cwin-roofx');
  await expect(win).toBeVisible();
  await expect(win.getByTestId('pscope-one')).toHaveClass(/on/);
  await win.getByTestId('ks-sec-conn').click();
  await expect(win.getByTestId('prop-profile')).toBeVisible();
  // מכפל: אותו מבנה (מיקום · גיאומטריה · חתך ומחברים)
  await openNav(page, 'b:knee');
  const kw = page.getByTestId('cwin-knee');
  await kw.getByTestId('ks-type-haunch').click();
  for (const s of ['loc', 'geo', 'conn']) { await kw.getByTestId(`ks-sec-${s}`).click(); await expect(kw.getByTestId(`ks-${s}`)).toBeVisible(); }
  await kw.getByTestId('ks-sec-geo').click();
  await expect(kw.getByTestId('hn-length')).toBeVisible();
  expect(await page.evaluate(() => ((window as any).__ksp.store.state.scopeHi ?? []).length)).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('ST-02 (1.59): פרויקט חדש — רכיבים כבויים, "להוסיף?" בסרגל, הושלם רק אחרי אישור; "לא נדרש" נשמר', async ({ page }) => {
  const errors = await boot(page);
  await page.getByTestId('btn-new').click();
  await page.getByTestId('create').click();
  const B = () => page.evaluate(() => (window as any).__ksp.store.state.project);
  const p0 = await B();
  expect(p0.building.bracing.roof.enabled).toBe(false);
  expect(p0.building.bracing.walls.enabled).toBe(false);
  expect(p0.meta.steps).toEqual({});
  // קושרות גג (שלב 7): לא קיים — שאלה; ביטול לא משנה דבר
  await expect(page.getByTestId('sr-7')).toHaveAttribute('data-state', 'todo');
  await page.getByTestId('sr-7').click();
  await expect(page.getByTestId('sr-ask')).toBeVisible();
  await page.getByTestId('sr-ask-cancel').click();
  await expect(page.getByTestId('sr-ask')).toHaveCount(0);
  // הוספה → האשף; בחירת סוג בלי אישור (✕) — הרכיב נוסף אבל השלב עדיין לא הושלם
  await page.getByTestId('sr-7').click();
  await page.getByTestId('sr-ask-add').click();
  const win = page.getByTestId('cwin-roofx');
  await win.getByTestId('br-roof-type-x').click();
  await win.getByTestId('cwin-close').click();
  expect((await B()).building.bracing.roof.enabled).toBe(true);
  await expect(page.getByTestId('sr-7')).toHaveAttribute('data-state', 'todo');
  // פתיחה שוב (קיים — ישר לאשף) ואישור → הושלם
  await page.getByTestId('sr-7').click();
  await page.getByTestId('cwin-roofx').getByTestId('wz-ok').click();
  await expect(page.getByTestId('sr-7')).toHaveAttribute('data-state', /ok|warn/);
  expect((await B()).meta.steps['b:roof']).toBe('done');
  // "לא נדרש" לקשיחות קירות — נספר, נשמר בפרויקט
  await page.getByTestId('sr-8').click();
  await page.getByTestId('sr-ask-skip').click();
  await expect(page.getByTestId('sr-8')).toHaveAttribute('data-state', 'skip');
  expect((await B()).meta.steps['b:walls']).toBe('skip');
  // שלב בלי אשף (פרויקט) — "סיום השלב"
  await page.getByTestId('sr-1').click();
  await page.getByTestId('step-done').click();
  await expect(page.getByTestId('sr-1')).toHaveAttribute('data-state', /ok|warn/);
  expect(errors).toEqual([]);
});

test('FW-04 (1.60): מצב הוספה לעומת עריכה; עורך המחבר בתלת-ממד מוגדל; מידות נעולות באגד B', async ({ page }) => {
  const errors = await boot(page);
  // הוספה: חיזוק רכס לא קיים בפרויקט חדש
  await page.getByTestId('btn-new').click();
  await page.getByTestId('create').click();
  await page.getByTestId('sr-10').click();
  await page.getByTestId('sr-ask-add').click();
  const rw = page.getByTestId('cwin-ridge');
  await expect(rw.getByTestId('cwin-count')).toHaveAttribute('data-mode', 'create');
  await expect(rw.getByTestId('wz-ok')).toHaveText('הוספה למבנה');
  await rw.getByTestId('ridge-type-tie').click();
  await rw.getByTestId('wz-cancel').click(); // ביטול ההוספה — הרכס לא מחוזק
  expect(await page.evaluate(() => (window as any).__ksp.store.state.project.building.ridgeReinf.type)).toBe('none');
  // עריכה: קשיחות קירות (נוספה) — אגד B, מידות נעולות: זווית + אנכי → השאר נגזרות
  await page.getByTestId('sr-8').click(); await page.getByTestId('sr-ask-add').click();
  const w = page.getByTestId('cwin-walls');
  await w.getByTestId('br-walls-portal').click();
  await w.getByTestId('ks-sec-geo').click();
  await expect(w.getByTestId('pb-ld-dims')).toBeVisible();
  await w.getByTestId('pb-ld-lock-h').click(); // אופקי + זווית קובעות
  await w.getByTestId('pb-ld-h').fill('900'); await w.getByTestId('pb-ld-h').press('Enter');
  const pb = await page.evaluate(() => (window as any).__ksp.store.state.project.building.bracing.walls.portal);
  expect(Math.round(pb.drop / Math.tan(pb.angle * Math.PI / 180))).toBeGreaterThan(890);
  await expect(w.getByTestId('pb-ld-h')).toHaveValue(/^(89\d|90\d)$/);
  // צמד בלי פתרון: אורך קטן מהאופקי — לא נשמר
  await w.getByTestId('pb-ld-L').fill('300'); await w.getByTestId('pb-ld-L').press('Enter');
  await expect(w.getByTestId('pb-ld-bad')).toBeVisible();
  // עורך המחבר: תלת-ממד של המחבר, הגדלה
  await w.getByTestId('ks-sec-conn').click();
  await expect(w.getByTestId('conn-view')).toBeVisible();
  await w.getByTestId('conn-view-big').click();
  await expect(w.getByTestId('conn-view')).toHaveClass(/big/);
  await w.getByTestId('wz-ok').click();
  expect(errors).toEqual([]);
});

test('FS-02 (1.62): חתך המסגרת — ראש עמוד וע.ע. קורה בכל ציר, עריכה במקום, מידות אנכיות', async ({ page }) => {
  const errors = await boot(page);
  await page.getByTestId('sr-2').click();
  const w = page.getByTestId('cwin-frame');
  await expect(w.getByTestId('ks-geo')).toBeVisible(); // 1.62: נפתח ישר בחתך המסגרת
  await expect(w.getByTestId('sec-lines')).toHaveCount(0); // אין טבלת צירים — הכל על השרטוט
  await expect(w.getByTestId('frame-section')).toBeVisible();
  await expect(w.getByTestId('fs-tos-0')).toContainText('ע.ע. קורה');
  await expect(w.getByTestId('fs-col-0')).toContainText('ראש עמוד');
  await expect(w.getByTestId('fs-tos-0')).toContainText('6.00');
  await expect(w.getByTestId('fs-col-0')).toContainText('5.67');
  await expect(w.getByTestId('fs-vdim-0')).toContainText('5674');
  // כל הגג: ע.ע. בציר א 6.50 → גם ציר ב והרכס עולים
  await w.getByTestId('fs-mode-all').click();
  await w.getByTestId('fs-tos-0').dispatchEvent('click');
  await page.getByTestId('fs-input').fill('6.5'); await page.getByTestId('fs-input').press('Enter');
  await expect(w.getByTestId('fs-tos-1')).toContainText('6.50');
  await expect(w.getByTestId('fs-col-0')).toContainText('6.17');
  await expect(w.getByTestId('fs-ridge')).toContainText('7.40');
  expect(errors).toEqual([]);
});
