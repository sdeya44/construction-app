import { expect, test } from '@playwright/test';
import { boot, expectInside, paneRect, screenOf, selection, setView, shot } from './helpers';

const RIDGE = 6900;

test.describe('M1 – ליבת מידול', () => {
  test('GEO-01: מבנה 18×30, 6 מסגרות, 6 מ\', 10% – כל המבטים בפרופורציה נכונה', async ({ page }) => {
    const errors = await boot(page);
    const info = await page.evaluate(() => {
      const s = (window as any).__ksp.store.state;
      return { n: s.derived.members.filter((m: any) => m.kind === 'column' || m.kind === 'rafter').length, ridge: s.derived.roof.ridgeZ, frames: s.project.building.frames.map((f: any) => f.y) };
    });
    expect(info).toEqual({ n: 24, ridge: RIDGE, frames: [0, 6000, 12000, 18000, 24000, 30000] });
    await setView(page, 'iso', 'persp');
    await shot(page, 'GEO-01_iso');

    // חזית אורתוגרפית: יחס רוחב/גובה רכס במסך = 18000/6900, עמודים מתחת לגג
    await setView(page, 'front');
    const a = await screenOf(page, { x: 0, y: 0, z: 0 });
    const b = await screenOf(page, { x: 18000, y: 0, z: 0 });
    const r = await screenOf(page, { x: 9000, y: 0, z: RIDGE });
    const e = await screenOf(page, { x: 0, y: 0, z: 6000 });
    expect(Math.abs(a.y - b.y)).toBeLessThan(0.5); // בסיסים באותו גובה
    const ratio = (b.x - a.x) / (a.y - r.y);
    expect(ratio).toBeGreaterThan((18000 / RIDGE) * 0.995);
    expect(ratio).toBeLessThan((18000 / RIDGE) * 1.005);
    expect(r.y).toBeLessThan(e.y); // רכס מעל ראש עמוד
    expect(e.y).toBeLessThan(a.y); // ראש עמוד מעל הבסיס
    expect(b.x).toBeGreaterThan(a.x); // X ימינה בחזית
    await expectInside(page, [a, b, r]);
    await shot(page, 'GEO-01_front');

    // צד (ימין): ציר Y אופקי, Z למעלה, אורך 30 מול גובה 6.9
    await setView(page, 'right');
    const s0 = await screenOf(page, { x: 18000, y: 0, z: 0 });
    const s1 = await screenOf(page, { x: 18000, y: 30000, z: 0 });
    const s2 = await screenOf(page, { x: 18000, y: 0, z: 6000 });
    const rs = Math.abs(s1.x - s0.x) / (s0.y - s2.y);
    expect(rs).toBeGreaterThan((30000 / 6000) * 0.995);
    expect(rs).toBeLessThan((30000 / 6000) * 1.005);
    await expectInside(page, [s0, s1]);
    await shot(page, 'GEO-01_right');

    // תוכנית: יחס X:Y אמיתי 18:30, Y כלפי מעלה במסך
    await setView(page, 'top');
    const t0 = await screenOf(page, { x: 0, y: 0, z: 6000 });
    const tx = await screenOf(page, { x: 18000, y: 0, z: 6000 });
    const ty = await screenOf(page, { x: 0, y: 30000, z: 6000 });
    const pr = (tx.x - t0.x) / (t0.y - ty.y);
    expect(pr).toBeGreaterThan(0.6 * 0.995);
    expect(pr).toBeLessThan(0.6 * 1.005);
    expect(Math.abs(tx.y - t0.y)).toBeLessThan(1);
    await expectInside(page, [t0, tx, ty]);
    await shot(page, 'GEO-01_top');

    // Fit: שומר יחס ממדים גם כשהחלון משנה צורה
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.waitForTimeout(300);
    await page.getByTestId('fit').click();
    const u0 = await screenOf(page, { x: 0, y: 0, z: 6000 });
    const ux = await screenOf(page, { x: 18000, y: 0, z: 6000 });
    const uy = await screenOf(page, { x: 0, y: 30000, z: 6000 });
    expect((ux.x - u0.x) / (u0.y - uy.y)).toBeCloseTo(0.6, 2);
    await expectInside(page, [u0, ux, uy]);
    await shot(page, 'GEO-01_top_resized');
    expect(errors).toEqual([]);
  });

  test('GEO-02: סיבוב מודל – Z חיובי למעלה, הגג מעל העמודים, גרירה אינה בוחרת', async ({ page }) => {
    await boot(page);
    await setView(page, 'iso', 'persp');
    const rect = await paneRect(page);
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    for (const [dx, dy] of [[250, 0], [-120, 80], [0, -150], [400, 60]]) {
      const before = await page.evaluate(() => (window as any).__ksp.viewport.panes[0].camera.position.toArray());
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx + dx / 2, cy + dy / 2, { steps: 5 });
      await page.mouse.move(cx + dx, cy + dy, { steps: 5 });
      await page.mouse.up();
      const after = await page.evaluate(() => (window as any).__ksp.viewport.panes[0].camera.position.toArray());
      expect(after).not.toEqual(before); // המצלמה זזה
      expect(await selection(page)).toEqual([]); // הגרירה לא בחרה
      const up = await page.evaluate(() => (window as any).__ksp.viewport.panes[0].camera.up.toArray());
      expect(up).toEqual([0, 0, 1]);
      // נקודה גבוהה יותר בעולם מוצגת גבוה יותר במסך (בציר העמוד)
      const base = await screenOf(page, { x: 0, y: 0, z: 0 });
      const top = await screenOf(page, { x: 0, y: 0, z: 6000 });
      const ridge = await screenOf(page, { x: 9000, y: 0, z: RIDGE });
      const ridgeBase = await screenOf(page, { x: 9000, y: 0, z: 0 });
      expect(top.y).toBeLessThan(base.y);
      expect(ridge.y).toBeLessThan(ridgeBase.y);
    }
    await shot(page, 'GEO-02_orbit');
  });

  test('GEO-03: בחירת עמוד וקורה, Properties מתעדכן, לחיצה חוזרת בוחרת מאחור', async ({ page }) => {
    await boot(page);
    await setView(page, 'front');
    // עמוד שמאל במסגרת 1 (הקרוב לצופה במבט חזית)
    const c = await screenOf(page, { x: 0, y: 0, z: 3000 });
    await page.mouse.click(c.x, c.y);
    expect(await selection(page)).toEqual(['F1.COL.L']);
    await expect(page.getByTestId('prop-id')).toHaveText('F1.COL.L');
    await expect(page.getByTestId('status-sel')).toHaveText('1');
    await shot(page, 'GEO-03_column');
    // לחיצה חוזרת באותה נקודה: האלמנט שמאחור (מסגרת 2)
    await page.waitForTimeout(400);
    await page.mouse.click(c.x, c.y);
    expect(await selection(page)).toEqual(['F2.COL.L']);
    // קורת גג שמאל, מסגרת 1: נקודה באמצע גובה הקורה
    const slope = 0.1, xm = 4500, zTop = 6000 + slope * xm;
    const rp = await screenOf(page, { x: xm, y: 0, z: zTop - 150 });
    await page.waitForTimeout(400);
    await page.mouse.click(rp.x, rp.y);
    expect(await selection(page)).toEqual(['F1.RAF.L']);
    await expect(page.getByTestId('prop-id')).toHaveText('F1.RAF.L');
    await expect(page.getByTestId('prop-profile')).toHaveValue('IPE300');
    await shot(page, 'GEO-03_rafter');
    // Ctrl מוסיף לבחירה
    await page.keyboard.down('Control');
    await page.mouse.click(c.x, c.y);
    await page.keyboard.up('Control');
    expect((await selection(page)).sort()).toEqual(['F1.COL.L', 'F1.RAF.L']);
    // גרירה על אלמנט אינה משנה בחירה
    await page.mouse.move(c.x, c.y); await page.mouse.down();
    await page.mouse.move(c.x + 120, c.y + 40, { steps: 6 }); await page.mouse.up();
    expect((await selection(page)).sort()).toEqual(['F1.COL.L', 'F1.RAF.L']);
    // לחיצה בשטח ריק מנקה (אחרי שהגרירה סובבה את המצלמה — חוזרים למבט חזית)
    await setView(page, 'front');
    const r = await paneRect(page);
    // נקודה ריקה בפינה התחתונה (מחוץ לסרגלים הצפים)
    await page.mouse.click(r.left + 12, r.bottom - 40);
    expect(await selection(page)).toEqual([]);
  });

  test('עריכה: שינוי חתך, הזזה, Undo/Redo, מחיקה – משנים את המודל', async ({ page }) => {
    await boot(page);
    await setView(page, 'front');
    const c = await screenOf(page, { x: 0, y: 0, z: 3000 });
    await page.mouse.click(c.x, c.y);
    await page.getByTestId('prop-profile').fill('HEB200');
    await page.getByTestId('prop-profile').press('Enter');
    const prof = () => page.evaluate(() => (window as any).__ksp.store.state.derived.byId.get('F1.COL.L').profile);
    expect(await prof()).toBe('HEB200');
    await page.getByTestId('btn-undo').click();
    expect(await prof()).toBe('HEA200');
    await page.getByTestId('btn-redo').click();
    expect(await prof()).toBe('HEB200');
    // הזזה מספרית
    await page.getByTestId('tool-move').click();
    await page.getByTestId('dx').fill('0.5'); await page.getByTestId('dx').press('Tab');
    await page.getByTestId('dy').fill('0'); await page.getByTestId('dy').press('Tab');
    await page.getByTestId('xform-ok').click();
    const pos = await page.evaluate(() => (window as any).__ksp.store.state.derived.byId.get('F1.COL.L').start);
    expect(pos).toEqual({ x: 500, y: 0, z: 0 });
    // שינוי פרמטרי אחרי הזזה ידנית מדווח כהתאמה לא תקפה
    await page.getByTestId('slopeLeft').fill('12'); await page.getByTestId('slopeLeft').press('Enter');
    const stale = await page.evaluate(() => (window as any).__ksp.store.state.derived.issues.filter((i: any) => i.code === 'STALE_OVERRIDE').map((i: any) => i.elementId));
    expect(stale).toEqual([]); // שינוי שיפוע אינו משנה את מיקום בסיס/ראש העמוד בציר א
    await page.getByTestId('eaveLeft').fill('6.5'); await page.getByTestId('eaveLeft').press('Enter');
    const stale2 = await page.evaluate(() => (window as any).__ksp.store.state.derived.issues.filter((i: any) => i.code === 'STALE_OVERRIDE').map((i: any) => i.elementId));
    expect(stale2).toEqual(['F1.COL.L']);
    // מחיקה
    await page.keyboard.press('Delete');
    const n = await page.evaluate(() => (window as any).__ksp.store.state.derived.members.filter((m: any) => m.kind === 'column' || m.kind === 'rafter').length);
    expect(n).toBe(23);
    // ערך לא חוקי נדחה והמודל לא משתנה
    await page.getByTestId('ridgeX').fill('25'); await page.getByTestId('ridgeX').press('Enter');
    expect(await page.evaluate(() => (window as any).__ksp.store.state.project.building.ridgeX)).toBe(9000);
    await expect(page.getByTestId('toasts')).toContainText('מיקום הרכס');
  });

  test('SAVE-01: שמירה, סגירה ופתיחה – הגיאומטריה וההתאמות נשמרות', async ({ page }) => {
    await boot(page);
    await page.getByTestId('width').fill('20'); await page.getByTestId('width').press('Enter');
    await page.getByTestId('add-frame').click();
    await setView(page, 'front');
    const c = await screenOf(page, { x: 0, y: 0, z: 3000 });
    await page.mouse.click(c.x, c.y);
    await page.getByTestId('prop-profile').fill('SHS160x6'); await page.getByTestId('prop-profile').press('Enter');
    await expect(page.getByTestId('save-state')).toHaveText('נשמר במחשב', { timeout: 5000 });
    const before = await page.evaluate(() => JSON.stringify((window as any).__ksp.store.state.derived.members));
    const proj = await page.evaluate(() => JSON.stringify((window as any).__ksp.store.state.project));
    await page.reload();
    await page.waitForFunction(() => !!(window as any).__ksp?.viewport?.model);
    const after = await page.evaluate(() => JSON.stringify((window as any).__ksp.store.state.derived.members));
    const proj2 = await page.evaluate(() => JSON.stringify((window as any).__ksp.store.state.project));
    expect(after).toBe(before);
    expect(proj2).toBe(proj);
    const n = await page.evaluate(() => (window as any).__ksp.store.state.derived.members.filter((m: any) => m.kind === 'column' || m.kind === 'rafter').length);
    expect(n).toBe(28);
    // ייצוא JSON
    const dl = page.waitForEvent('download');
    await page.getByTestId('btn-export').click();
    const file = await dl;
    const txt = await (await import('node:fs')).promises.readFile((await file.path())!, 'utf8');
    const j = JSON.parse(txt);
    expect(j.format).toBe('kayan-steel-pro');
    expect(j.schemaVersion).toBe(7);
    expect(j.project.building.width).toBe(20000);
    await shot(page, 'SAVE-01_after_reload');
  });

  test('תצוגה: ארבעה מבטים, חתך מישורי, מדידה עם הצמדה, הסתרה ובידוד', async ({ page }) => {
    await boot(page);
    await page.getByTestId('toggle-split').click();
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => (window as any).__ksp.viewport.panes.map((p: any) => p.view))).toEqual(['iso', 'front', 'right', 'top']);
    await shot(page, 'VIEW_split');
    await page.getByTestId('toggle-split').click();
    await setView(page, 'front');
    // מדידה: רוחב חיצוני בין בסיסי העמודים. התקרבות לכל קצה (כמו משתמש), הצמדה לפינה המדויקת
    // מבט שמאל: הפאה החיצונית של אגף העמוד השמאלי גלויה; מבט ימין: של העמוד הימני
    await setView(page, 'left');
    await page.evaluate(() => { const k = (window as any).__ksp; k.store.select(['F1.COL.L']); k.viewport.fitSelection(); });
    await page.getByTestId('tool-measure').click();
    const p1 = await screenOf(page, { x: -95, y: -100, z: 0 }); // פני הפלטה המבוטנת = מפלס הבסיס
    await page.mouse.click(p1.x - 3, p1.y - 3);
    await setView(page, 'right');
    await page.evaluate(() => { const k = (window as any).__ksp; k.store.select(['F1.COL.R']); k.viewport.fitSelection(); });
    const p2 = await screenOf(page, { x: 18095, y: -100, z: 0 });
    await page.mouse.click(p2.x + 3, p2.y - 3);
    const m = await page.evaluate(() => (window as any).__ksp.store.state.measure);
    expect(m.a).toEqual({ x: -95, y: -100, z: 0 });
    expect(m.b).toEqual({ x: 18095, y: -100, z: 0 });
    await expect(page.getByTestId('measure-d')).toHaveText("18.190 מ'");
    await page.getByTestId('fit').click();
    await shot(page, 'VIEW_measure');
    await page.keyboard.press('Escape');
    // חתך מישורי
    await page.getByTestId('toggle-clip').click();
    await expect(page.getByTestId('clip-box')).toBeVisible();
    await shot(page, 'VIEW_clip');
    await page.getByTestId('toggle-clip').click();
    // הסתרה ובידוד
    await setView(page, 'front');
    const c = await screenOf(page, { x: 0, y: 0, z: 3000 });
    await page.mouse.click(c.x, c.y);
    await page.getByTestId('isolate').click();
    expect(await page.evaluate(() => (window as any).__ksp.viewport.model.ids)).toEqual(['F1.COL.L']);
    await page.getByTestId('show-all').click();
    expect(await page.evaluate(() => (window as any).__ksp.viewport.model.ids.length)).toBe(await page.evaluate(() => (window as any).__ksp.store.state.derived.members.length));
  });
});
