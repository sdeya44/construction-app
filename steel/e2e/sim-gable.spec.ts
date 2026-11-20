import { expect, test, type Page } from '@playwright/test';
import { boot, shot } from './helpers';

/**
 * SIM-03 (1.48.2, בקשת משתמש): בניית דו-שיפועי 18 מ' × 3 מסגרות @6 מ' דרך האשף, ואחר כך כל השינויים
 * רק בלחיצת עכבר אמיתית על אלמנט בתלת-ממד + בחירה בחלון האלמנט. נספרות הפעולות לכל משימה.
 */
async function clickMember(page: Page, id: string) {
  // הפאנל נפתח/נסגר ומשנה את רוחב המודל — כמו משתמש: "התאמה למסך" לפני שמכוונים
  await page.evaluate(() => (window as any).__ksp.viewport.fitAll()); await page.waitForTimeout(250);
  const pre = id.split('.').slice(0, 2).join('.');
  let clicks = 0, got = '';
  // נקודה על האלמנט: באמצע, ואם שם רווח (הצטלבות X) — ב-70% מאורכו
  for (const t of [0.5, 0.7, 0.3]) {
    const p = await page.evaluate(([i, tt]) => {
      const k = (window as any).__ksp; const m = k.store.state.derived.byId.get(i);
      return m ? k.viewport.screenOf({ x: m.start.x + (m.end.x - m.start.x) * tt, y: m.start.y + (m.end.y - m.start.y) * tt, z: m.start.z + (m.end.z - m.start.z) * tt }) : null;
    }, [id, t] as const);
    expect(p, id).toBeTruthy();
    // לחיצה חוזרת באותה נקודה = האלמנט הבא מאחור (פטה / חגורת קיר / מזחלה שלפניו)
    for (let k = 0; k < 5 && !got.startsWith(pre); k++, clicks++) {
      await page.mouse.click(p!.x, p!.y); await page.waitForTimeout(200);
      got = (await page.evaluate(() => (window as any).__ksp.store.state.selection[0])) ?? '';
    }
    if (got.startsWith(pre)) break;
  }
  expect(got.startsWith(pre), `${id} ← ${got}`).toBe(true);
  return clicks;
}
const W = <T,>(page: Page, f: string) => page.evaluate(`(() => { const b = window.__ksp.store.state.project.building, d = window.__ksp.store.state.derived; return ${f}; })()`) as Promise<T>;

test('SIM-03: דו-שיפועי 18×12 — אגד B, נעילה, חלוקת קושרות גג, אלכסונים רק במסגרות הקצה — הכל מלחיצה על המודל', async ({ page }) => {
  test.setTimeout(90000);
  const errors = await boot(page);
  await page.evaluate(() => { localStorage.removeItem('ksp-prop-scope'); (window as any).__ksp.store.set({ propScope: null }); });
  const act = async (t: string) => { const l = page.getByTestId('props-single').getByTestId(t); await (await l.count() ? l.first() : page.getByTestId(t).first()).click(); await page.waitForTimeout(150); };
  // בנייה באשף: דו-שיפועי, רוחב 18, אורך 12, 3 מסגרות, חתכים אוטומטיים, אלכסוני עמוד-קורה
  await page.getByTestId('btn-new').click();
  await page.getByTestId('np-gable').click();
  await page.getByTestId('wz-next').click();
  for (const [t, v] of [['np-width', '18'], ['np-length', '12'], ['np-count', '3']]) { await page.getByTestId(t).fill(v); await page.getByTestId(t).press('Enter'); }
  await page.getByTestId('wz-step-4').click();
  if (!(await page.getByTestId('np-knee').isChecked())) await page.getByTestId('np-knee').check();
  await page.getByTestId('create').click();
  await page.waitForTimeout(600);
  expect(await W(page, `({ w: b.width, f: b.frames.map(f => f.y), kb: d.members.filter(m => m.id.startsWith('KB.')).length, roof: b.bracing.roof.enabled, walls: b.bracing.walls.enabled, err: d.issues.filter(i => i.severity === 'error').length })`))
    .toEqual({ w: 18000, f: [0, 6000, 12000], kb: 6, roof: true, walls: true, err: 0 });

  // 1. קשיחות קירות X → אגד B: לחיצה על קושרת קיר → "כל המכלולים במודל" → אגד B
  let n = await clickMember(page, 'BR.W1.L.1');
  await act('pscope-asmall'); await act('br-walls-portal'); n += 2;
  expect(await W(page, `d.members.filter(m => /^BB\\./.test(m.id)).length`)).toBeGreaterThan(0);
  console.log('SIM-03 X→אגד B: פעולות', n);
  // 2. אגד B → מסבך נעילה: לחיצה על קורת האגד (המזחלה שלפניה — לחיצה חוזרת) → נעילה (ההיקף נשמר)
  n = await clickMember(page, 'BB.1.L');
  await expect(page.getByTestId('pscope-asmall')).toHaveClass(/on/);
  await act('br-walls-truss'); n += 1;
  expect(await W(page, `({ lt: d.members.some(m => /^LT\\./.test(m.id)), bb: d.members.some(m => /^BB\\./.test(m.id)) })`)).toEqual({ lt: true, bb: false });
  console.log('SIM-03 אגד B→נעילה: פעולות', n);
  // 3. קושרות גג: מפתח 1 — שני פנלי X בכל שיפוע
  n = await clickMember(page, 'BR.R1.L.1');
  await act('pscope-asmall'); await act('br-roof-ed-tab-plan'); await act('br-grid-0-L'); await act('br-grid-0-R'); n += 4;
  expect(await W(page, `d.members.filter(m => /^BR\\.R1\\.L\\./.test(m.id)).length`)).toBe(4);
  expect(await W(page, `d.members.filter(m => /^BR\\.R2\\.L\\./.test(m.id)).length`)).toBe(2);
  console.log('SIM-03 חלוקת קושרות: פעולות', n);
  // 4. אלכסוני עמוד-קורה רק במסגרות הקצה: לחיצה על אלכסון במסגרת 2 → המכלול → כיבוי מסגרת 2
  n = await clickMember(page, 'KB.F2.L.L.R');
  await act('pscope-asm'); await act('kb-frame-1'); n += 2;
  expect(await W(page, `d.members.filter(m => m.id.startsWith('KB.')).map(m => m.id.split('.')[1]).sort()`)).toEqual(['F1', 'F1', 'F3', 'F3']);
  console.log('SIM-03 אלכסונים בקצוות: פעולות', n);
  await page.evaluate(() => (window as any).__ksp.store.select([]));
  expect(await W(page, `d.issues.filter(i => i.severity !== 'info').length`)).toBe(0);
  await shot(page, 'SIM_03_final');
  expect(errors).toEqual([]);
});

test('PICK-01 (1.48.2): מזחלה שלפני אלמנט — לחיצה ראשונה פותחת את המזחלה, לחיצה חוזרת בוחרת את האלמנט שמאחור', async ({ page }) => {
  const errors = await boot(page);
  await page.getByTestId('btn-new').click();
  await page.getByTestId('np-gable').click();
  await page.getByTestId('wz-next').click();
  for (const [t, v] of [['np-width', '18'], ['np-length', '12'], ['np-count', '3']]) { await page.getByTestId(t).fill(v); await page.getByTestId(t).press('Enter'); }
  await page.getByTestId('create').click();
  await page.waitForTimeout(600);
  await page.evaluate(() => { const k = (window as any).__ksp; k.store.exec({ label: 't', run: (p: any) => ({ ...p, building: { ...p.building, bracing: { ...p.building.bracing, walls: { ...p.building.bracing.walls, enabled: true, type: 'portal' } } } }) }); });
  await page.waitForTimeout(400);
  const hit = await page.evaluate(() => {
    const k = (window as any).__ksp, v = k.viewport, m = k.store.state.derived.byId.get('BB.1.L');
    const p = v.screenOf({ x: (m.start.x + m.end.x) / 2, y: (m.start.y + m.end.y) / 2, z: (m.start.z + m.end.z) / 2 });
    return { p, g: !!v.pickGutter(v.panes[0], p.x, p.y) };
  });
  test.skip(!hit.g, 'בזווית הזו המזחלה לא מסתירה את הקורה');
  await page.mouse.click(hit.p.x, hit.p.y); await page.waitForTimeout(200);
  expect(await page.evaluate(() => (window as any).__ksp.store.state.activeGutter)).toBeTruthy();
  // לחיצות חוזרות: כל אלמנט בקו הראייה בתורו (חגורת קיר שלפני הקורה — לפי זווית המבט), עד קורת האגד; אחריה — חזרה למזחלה
  const seen: string[] = [];
  for (let i = 0; i < 4; i++) { await page.mouse.click(hit.p.x, hit.p.y); await page.waitForTimeout(200); const sel = await page.evaluate(() => (window as any).__ksp.store.state.selection[0] ?? 'gutter'); seen.push(sel); if (sel === 'BB.1.L') break; }
  expect(seen).toContain('BB.1.L');
  expect(seen.filter((x) => x === 'gutter')).toEqual([]);
  expect(errors).toEqual([]);
});
