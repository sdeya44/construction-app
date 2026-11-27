import { expect, test } from '@playwright/test';
import { boot } from './helpers';

test('TRACE-E1: ייצור — לשונית עקיבות חומר: הוספת ליט, הקצאה אוטומטית והיתך בדוח', async ({ page }) => {
  const errors = await boot(page);
  const col = await page.evaluate(() => { const b = (window as any).__ksp.store.state.project.building; return { prof: b.columnProfile as string, mat: b.material as string }; });
  await page.getByTestId('mode-production').click();
  await page.getByRole('button', { name: 'עקיבות חומר' }).click();
  await expect(page.getByTestId('trace-panel')).toBeVisible();
  await expect(page.getByTestId('tr-auto')).toBeDisabled();
  await page.getByTestId('tr-heat').fill('H-4471');
  await page.getByTestId('tr-cert').fill('CERT-31-0099');
  await page.getByTestId('tr-profile').fill(col.prof);
  await page.getByTestId('tr-material').fill(col.mat);
  await page.getByTestId('tr-add').click();
  await expect(page.getByTestId('tr-lots')).toContainText('H-4471');
  await page.getByTestId('tr-auto').click();
  await expect(page.getByTestId('prod-table')).toContainText('H-4471');
  await expect(page.getByTestId('prod-table')).toContainText('CERT-31-0099');
  await expect(page.getByTestId('prod-table')).toContainText('לא מוקצה'); // שאר הסימונים — בלי ליט מתאים
  await page.getByTestId('tr-del-L1').click();
  await expect(page.getByTestId('prod-table')).not.toContainText('H-4471');
  expect(errors).toEqual([]);
});

test('TRACE-E2: ייבוא ליטים מקובץ CSV — כפולים ושורות לא תקינות מדווחים, הקצאה אוטומטית, ייבוא חוזר אינו מוסיף', async ({ page }) => {
  const errors = await boot(page);
  const col = await page.evaluate(() => { const b = (window as any).__ksp.store.state.project.building; return { prof: b.columnProfile as string, mat: b.material as string }; });
  await page.getByTestId('mode-production').click();
  await page.getByRole('button', { name: 'עקיבות חומר' }).click();
  const csv = `היתך,תעודה,חתך,חומר\nH-1001,CERT-A,${col.prof},${col.mat}\n,CERT-B,${col.prof},${col.mat}\nH-1002,,IPE999,${col.mat}\nH-1001,CERT-A,${col.prof},${col.mat}\n`;
  const pick = async () => { const fc = page.waitForEvent('filechooser'); await page.getByTestId('tr-csv').click(); await (await fc).setFiles({ name: 'lots.csv', mimeType: 'text/csv', buffer: Buffer.from('\uFEFF' + csv) }); };
  await pick();
  await expect(page.getByTestId('tr-csv-msg')).toContainText('נוספו 2 ליטים');
  await expect(page.getByTestId('tr-csv-msg')).toContainText('כפולים שלא נוספו: 1');
  await expect(page.getByTestId('tr-csv-msg')).toContainText('שורות לא תקינות: 1');
  await expect(page.getByTestId('tr-csv-msg')).toContainText('שורה 3: חסר היתך');
  await expect(page.getByTestId('tr-lots')).toContainText('H-1001'); await expect(page.getByTestId('tr-lots')).toContainText('IPE999');
  await page.getByTestId('tr-auto').click();
  await expect(page.getByTestId('prod-table')).toContainText('H-1001'); await expect(page.getByTestId('prod-table')).toContainText('CERT-A');
  await pick(); // ייבוא חוזר: הכל כפול
  await expect(page.getByTestId('tr-csv-msg')).toContainText('נוספו 0 ליטים');
  expect(await page.locator('[data-testid=tr-lots] tbody tr').count()).toBe(2);
  // קובץ בלי עמודת חובה — הודעה, בלי שינוי
  const fc = page.waitForEvent('filechooser'); await page.getByTestId('tr-csv').click();
  await (await fc).setFiles({ name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from('היתך,חתך\nH1,HEA140\n') });
  await expect(page.getByTestId('tr-csv-msg')).toContainText('חסרות עמודות חובה');
  expect(await page.locator('[data-testid=tr-lots] tbody tr').count()).toBe(2);
  // תבנית CSV
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('tr-csv-template').click()]);
  expect(dl.suggestedFilename()).toBe('lots-template.csv');
  expect(errors).toEqual([]);
});

