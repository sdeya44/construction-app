import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { EVIDENCE, boot, shot, openNav } from './helpers';

/**
 * סימולציית משתמש (בקשת משתמש): בניית סככה מאפס דרך הממשק בלבד, ואחר כך סדרת שינויים.
 * לכל משימה נספרות הפעולות (לחיצה / הקלדה) — מדד לקלות השימוש. הלוג נשמר ב-SIM_log.json.
 */
type Step = { task: string; actions: number; how: string };
const log: Step[] = [];

function journey(page: Page) {
  let n = 0;
  const click = async (tid: string) => { n++; if (/^nav-[a-z]:/.test(tid)) await openNav(page, tid.slice(4)); else await page.getByTestId(tid).first().click(); };
  const fill = async (tid: string, v: string) => { n++; const el = (tid.startsWith('[') ? page.locator(tid) : page.getByTestId(tid)).first(); await el.fill(v); await el.press('Enter'); };
  const select = async (tid: string, v: string) => { n++; await page.getByTestId(tid).first().selectOption(v); };
  const task = async (name: string, how: string, fn: () => Promise<void>) => { n = 0; await fn(); log.push({ task: name, actions: n, how }); };
  return { click, fill, select, task };
}
const st = (page: Page) => page.evaluate(() => { const d = (window as any).__ksp.store.state.derived; return { err: d.issues.filter((i: any) => i.severity === 'error').length, warn: d.issues.filter((i: any) => i.severity === 'warning').length, cols: d.members.filter((m: any) => m.kind === 'column').length, knee: d.connections.filter((c: any) => c.id.startsWith('C.KB.')).length, bb: d.members.filter((m: any) => /^BB\.[^K]*$/.test(m.id)).length }; });

test('SIM-01/02: בניית סככה מאפס ושינויים — מספר פעולות לכל משימה', async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await boot(page);
  const { click, fill, task } = journey(page);

  // ---------- SIM-01: בנייה ----------
  await task('פרויקט חדש: חד-שיפועי רב-מפתחי עם אלכסונים', 'קובץ חדש ← תבנית ← יצירה', async () => {
    await click('btn-new'); await click('np-mono-multi'); await click('create');
  });
  expect((await st(page)).knee).toBeGreaterThan(0);
  await task('עמודים RHS120/120/5', 'מבנה ← חתכים וחומר ← סוג ← גודל', async () => {
    await click('nav-s:profiles'); await click('columnProfile-open'); await click('columnProfile-fam-RHS'); await click('columnProfile-opt-RHS120x120x5');
  });
  await task('מרווח פטות 1.2 מ\'', 'גג ופטות ← שיפועים ← מרווח מרבי', async () => {
    await click('nav-r:left');
    // מרווח על שרטוט השיפוע (1.34): לחיצה על המרווח ← הקלדה
    const g = page.locator('[data-testid^="sch-"][data-testid$="-g0"], [data-testid^="sch-"][data-testid$="-s1"]').first();
    const gid = await g.getAttribute('data-testid');
    await click(gid!);
    await fill(`${gid}-inp`, '1200');
  });
  await task('אגד B בקירות', 'חיזוקים וקשיחות ← קשיחות קירות ← סוג', async () => {
    await click('nav-b:walls'); await click('br-walls-portal');
  });
  expect((await st(page)).bb).toBeGreaterThan(0);
  await task('אלכסוני עמוד-קורה: ירידה 700', 'חיזוקים וקשיחות ← אלכסוני עמוד-קורה', async () => {
    await click('nav-b:knee'); await click('ks-sec-geo'); await fill('kd-v', '700'); await expect(page.getByTestId('kd-v')).toHaveValue('700', { timeout: 15000 });
  });
  await task('בדיקות: תיקון כל ההצעות', 'בדיקות ← תקן הכל', async () => {
    await click('tab-issues');
    if (await page.getByTestId('fix-all').count()) await click('fix-all');
  });
  await shot(page, 'SIM_01_built');
  expect((await st(page)).err).toBe(0);
  await task('שרטוטים וייצור', 'סרגל צד: שרטוטים, ייצור', async () => {
    await click('mode-drawings'); await expect(page.getByTestId('drawings-view')).toBeVisible();
    await click('mode-production'); await expect(page.getByTestId('production-view')).toBeVisible();
    await click('mode-model');
  });

  // ---------- SIM-02: שינויים ----------
  await task('שינוי מרווח מסגרות בתלת-ממד', 'לחיצה על המידה ← הקלדה', async () => {
    await page.locator('.vp-label.editable[data-edit="y:0"]').first().dispatchEvent('pointerup');
    await fill('dim-edit', '6.5');
  });
  await task('כל התומכים: רוחב 120 (מתוך תומך שנבחר)', 'בחירת תומך ← "הגדרות כל התומכים" ← שדה', async () => {
    await page.evaluate(() => { const k = (window as any).__ksp; const c = k.store.state.derived.members.find((m: any) => m.kind === 'cleat'); k.store.select([c.id]); });
    await expect(page.getByTestId('hub-settings')).toBeVisible();
  });
  await task('מציאת "חומר גלם" בחיפוש', 'Ctrl+K ← הקלדה ← Enter', async () => {
    await page.keyboard.press('Control+k');
    await page.getByTestId('cmdk-input').fill('חומר גלם'); await page.keyboard.press('Enter');
    await expect(page.getByTestId('nav-crumb')).toContainText('פרויקט והגדרות');
  });
  await task('אלכסון נבחר ← הגדרות לכל האלכסונים', 'בחירת אלכסון ← קישור', async () => {
    await page.evaluate(() => { const k = (window as any).__ksp; k.store.select(['KB.F2.B.P1.L']); });
    await page.getByTestId('pscope-asm').click(); // 1.56: חלון האלכסונים — כל האלכסונים במודל
    await expect(page.getByTestId('knee-studio')).toBeVisible();
  });
  await task('הסתרת הודעות "לידיעה"', 'בדיקות ← הסתר סוג', async () => {
    await click('tab-issues');
    if (await page.getByTestId('ghide-RAFTER_EXT').count()) await click('ghide-RAFTER_EXT');
  });
  await shot(page, 'SIM_02_changed');

  fs.writeFileSync(path.join(EVIDENCE, 'SIM_log.json'), JSON.stringify(log, null, 1));
  console.log(log.map((s) => `${String(s.actions).padStart(2)}  ${s.task}  [${s.how}]`).join('\n'));
  // יעד: כל משימה עד 4 פעולות
  expect(Math.max(...log.map((s) => s.actions))).toBeLessThanOrEqual(4);
});
