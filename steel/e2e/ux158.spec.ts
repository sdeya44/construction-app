import { expect, test } from '@playwright/test';
import { boot, openNav, shot } from './helpers';

/** 1.58 — מערכת האשפים האחידה בכל התוכנה: כל משפחת רכיבים באותו חלון ובאותו מבנה */
const FAMS: [string, string][] = [
  ['b:roof', 'roofx'], ['b:ties', 'ties'], ['b:ridge', 'ridge'], ['r:left', 'purlins'], ['r:right', 'purlins'], ['r:splices', 'purlins'],
  ['w:roof', 'clad'], ['w:walls', 'clad'], ['w:openings', 'clad'], ['b:tb', 'tb'], ['b:wing', 'wing'], ['b:truss', 'truss'], ['s:geometry', 'frame'], ['s:profiles', 'frame'],
];

test('FW-01: כל כלי בריבון פותח את האשף האחיד של המשפחה — סוג/היקף/3 קבוצות/פעולות', async ({ page }) => {
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
