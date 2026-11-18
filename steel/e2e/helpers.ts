import { expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

export const EVIDENCE = path.resolve('e2e-results/evidence');
fs.mkdirSync(EVIDENCE, { recursive: true });

export async function boot(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  // בבדיקות: קטעי "מתקדם" פתוחים (השדות נבדקים ישירות; אצל המשתמש — סגורים כברירת מחדל)
  await page.addInitScript(() => { const g = Storage.prototype.getItem; Storage.prototype.getItem = function (k: string) { return k.startsWith('ksp-adv-') ? '1' : g.call(this, k); }; });
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__ksp?.viewport?.model);
  await page.waitForTimeout(300);
  return errors;
}

export async function shot(page: Page, name: string) {
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(EVIDENCE, `${name}.png`) });
}

/** מיקום מסך של נקודת עולם (mm) בחלונית 0. */
export function screenOf(page: Page, p: { x: number; y: number; z: number }, pane = 0) {
  return page.evaluate(([pt, pn]) => (window as any).__ksp.viewport.screenOf(pt, pn), [p, pane] as const);
}

export async function setView(page: Page, view: string, projection: 'ortho' | 'persp' = 'ortho') {
  await page.getByTestId(`proj-${projection}`).click();
  await page.getByTestId(`view-${view}`).click();
  await page.waitForTimeout(200);
}

export const selection = (page: Page) => page.evaluate(() => (window as any).__ksp.store.state.selection as string[]);
export const paneRect = (page: Page, i = 0) => page.evaluate((n) => {
  const r = (window as any).__ksp.viewport.panes[n].el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
}, i);

export async function expectInside(page: Page, pts: { x: number; y: number }[]) {
  const r = await paneRect(page);
  for (const p of pts) {
    expect(p.x).toBeGreaterThan(r.left); expect(p.x).toBeLessThan(r.right);
    expect(p.y).toBeGreaterThan(r.top); expect(p.y).toBeLessThan(r.bottom);
  }
}

/** בחירת חתך בחלונית בורר הפרופיל (1.34): פתיחה ← סוג ← גודל */
export async function pickProfile(page: Page, testId: string, name: string, family?: string) {
  await page.getByTestId(`${testId}-open`).click();
  const fam = family ?? name.match(/^[A-Z]+/)![0];
  await page.getByTestId(`${testId}-fam-${fam}`).click();
  await page.getByTestId(`${testId}-opt-${name}`).click();
  await page.waitForTimeout(150);
}

/** רשימת הגדלים במשפחה הנוכחית של בורר הפרופיל */
export async function profileSizes(page: Page, testId: string): Promise<string[]> {
  await page.getByTestId(`${testId}-open`).click();
  const ids = await page.getByTestId(`${testId}-pop`).locator('.pp-opt').evaluateAll((os) => os.map((o) => (o as HTMLElement).dataset.testid ?? ''));
  await page.getByTestId(`${testId}-open`).click();
  return ids.map((x) => x.replace(/^.*-opt-/, ''));
}
