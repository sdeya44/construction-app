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
