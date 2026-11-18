import { expect, test } from '@playwright/test';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { boot, shot } from './helpers';

const PY = '/tmp/claude-0/-home-user-construction-app/1a50a160-0b21-5222-a7ee-30b6297ca40e/scratchpad/venv/bin/python';
const save = async (page: any, testId: string, name: string) => {
  const dl = page.waitForEvent('download');
  await page.getByTestId(testId).click();
  const f = await dl;
  const path = `e2e-results/evidence/${name}`;
  await f.saveAs(path);
  return path;
};

test.describe('M4/M5 – שרטוטים, ייצור, מהדורות', () => {
  test('DRAW-01: שרטוטים — תצוגה, PDF ו-DXF תקינים, אישור וזיהוי שינוי', async ({ page }) => {
    const errors = await boot(page);
    page.on('dialog', (d) => d.accept());
    await page.getByTestId('mode-drawings').click();
    if (await page.getByTestId('dwg-number').count()) await page.getByTestId('dwg-number').click(); // המספור רץ אוטומטית בכניסה
    await page.getByTestId('dwg-D-ROOF').click();
    await expect(page.getByTestId('dwg-title')).toContainText('R-01');
    await expect(page.getByTestId('dwg-scale')).toContainText('1:');
    expect(await page.locator('[data-testid=dwg-svg] svg text').count()).toBeGreaterThan(30);
    await shot(page, 'DRAW_roof_preview');
    const pdf = await save(page, 'dwg-pdf', 'R-01.pdf');
    const info = execSync(`pdfinfo "${pdf}"`).toString();
    expect(info).toMatch(/Pages:\s+1/);
    expect(info).toMatch(/841\.89 x 595\.276/); // A4 לרוחב — ברירת מחדל (מדפסת ביתית)
    expect(execSync(`pdftotext "${pdf}" -`).toString()).toContain('30000');
    // שרטוט חלק של פטה
    await page.getByTestId('dwg-search').fill('P-p');
    await page.locator('[data-testid^="dwg-D-PART-p"]').first().click();
    await expect(page.getByTestId('dwg-title')).toContainText('P-p');
    await shot(page, 'DRAW_part_preview');
    const dxf = await save(page, 'dwg-dxf', 'part.dxf');
    if (fs.existsSync(PY)) {
      const n = execSync(`${PY} -c "import ezdxf,sys; d=ezdxf.readfile(sys.argv[1]); print(len(d.modelspace()))" "${dxf}"`).toString().trim();
      expect(Number(n)).toBeGreaterThan(50);
    }
    // אישור, ואז שינוי במודל ⇒ "השתנה מאז האישור"
    await page.getByTestId('dwg-search').fill('');
    await page.getByTestId('dwg-D-ROOF').click();
    await page.getByTestId('dwg-set-status').selectOption('approved');
    await expect(page.getByTestId('dwg-status')).toContainText('מאושר');
    await expect(page.getByTestId('dwg-changed')).toHaveCount(0);
    await page.getByTestId('mode-model').click();
    await page.getByTestId('tab-roof').click();
    await page.getByTestId('sch-left-g0').first().dispatchEvent('click');
    await page.getByTestId('sch-left-g0-inp').fill('1400'); await page.getByTestId('sch-left-g0-inp').press('Enter');
    await page.getByTestId('mode-drawings').click();
    await page.getByTestId('dwg-D-ROOF').click();
    await expect(page.getByTestId('dwg-changed')).toBeVisible();
    // סט PDF למסומנים
    for (const id of ['D-GA', 'D-FRAME-F1', 'D-CONN-eave']) await page.getByTestId(`dwg-${id}`).locator('input').check();
    const set = await save(page, 'dwg-pdf-batch', 'set.pdf');
    expect(execSync(`pdfinfo "${set}"`).toString()).toMatch(/Pages:\s+3/);
    expect(errors).toEqual([]);
  });

  test('BOM-01 + מהדורות: מספור, Excel תקין, נעילה ופתיחת מהדורה', async ({ page }) => {
    await boot(page);
    page.on('dialog', (d) => d.accept());
    await page.getByTestId('mode-production').click();
    await page.getByTestId('run-numbering').click();
    await expect(page.getByTestId('prov-count')).toHaveText('0');
    const w0 = await page.getByTestId('total-weight').textContent();
    await page.getByTestId('prod-tab-1').click();
    expect(await page.locator('[data-testid=prod-table] tbody tr').count()).toBeGreaterThan(5);
    await shot(page, 'BOM_parts');
    const x = await save(page, 'export-xlsx', 'bom.xlsx');
    if (fs.existsSync(PY)) {
      const s = execSync(`${PY} -c "import openpyxl,sys; wb=openpyxl.load_workbook(sys.argv[1]); print('|'.join(wb.sheetnames))" "${x}"`).toString().trim();
      expect(s).toBe('חתכים|חלקים|מכלולים|ברגים|ריתוכים|חיתוך|הצעת מחיר');
    }
    // שינוי חתך מעדכן משקל
    await page.getByTestId('mode-model').click();
    await page.getByTestId('tab-structure').click();
    await page.getByTestId('columnProfile').fill('HEB200'); await page.getByTestId('columnProfile').press('Enter');
    await page.getByTestId('mode-production').click();
    expect(await page.getByTestId('total-weight').textContent()).not.toBe(w0);
    // נעילת מהדורה
    await page.getByTestId('rev-approve').click();
    await expect(page.getByTestId('rev-locked')).toContainText('נעולה');
    await expect(page.getByTestId('locked-badge')).toBeVisible();
    await page.getByTestId('mode-model').click();
    await page.getByTestId('columnProfile').fill('HEA200'); await page.getByTestId('columnProfile').press('Enter');
    await expect(page.getByTestId('toasts')).toContainText('נעולה');
    expect(await page.evaluate(() => (window as any).__ksp.store.state.project.building.columnProfile)).toBe('HEB200');
    await page.getByTestId('mode-production').click();
    await page.getByTestId('rev-new').click();
    await expect(page.getByTestId('rev-current')).toHaveText('B');
    await shot(page, 'REV_new');
  });
});
