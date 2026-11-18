import { expect, test } from '@playwright/test';
import { boot, shot } from './helpers';

test('DEL-E1: מחיקת שני אלכסונים והחזרת אחד מהם מהרשימה — עם הפלטות שלו', async ({ page }) => {
  const errors = await boot(page);
  await page.getByTestId('nav-b:knee').click(); await page.getByTestId('kb-on').check();
  await page.waitForTimeout(500);
  const st = () => page.evaluate(() => { const d = (window as any).__ksp.store.state.derived; return { kb: d.members.filter((m: any) => m.id.startsWith('KB.')).map((m: any) => m.id), kbPl: d.members.filter((m: any) => m.id.startsWith('C.KB.')).length, del: (window as any).__ksp.store.state.project.deleted }; });
  const s0 = await st();
  const [a, b] = s0.kb;
  await page.evaluate((ids) => (window as any).__ksp.store.select(ids), [a, b]);
  await page.keyboard.press('Delete');
  let s = await st();
  expect(s.kb.length).toBe(s0.kb.length - 2);
  expect(s.kbPl).toBeLessThan(s0.kbPl);
  await page.getByTestId('tool-restore').click();
  await expect(page.getByTestId('deleted-panel')).toBeVisible();
  await shot(page, 'del-e1-list');
  await page.getByTestId(`restore-${a}`).click();
  s = await st();
  expect(s.kb).toContain(a);
  expect(s.kb).not.toContain(b);
  expect(s.del).toEqual([b]);
  await page.getByTestId('restore-all').click();
  s = await st();
  expect(s.kb.length).toBe(s0.kb.length);
  expect(s.kbPl).toBe(s0.kbPl);
  expect(errors).toEqual([]);
});
