/**
 * PERF-C1: עלות החלת פרטים מותאמים (`applyCustomDetails`) לא גדלה ריבועית במספר האתרים.
 * לפני התיקון (1.72.0): 160 אתרים ≈ 33 מ"ש לאתר מעל הקוד הישן (כמעט הכול ב-`findSite` — חישוב תיבת חתך לכל אלמנט לכל אתר);
 * אחרי: ≈ 7 מ"ש לאתר. הסף נבחר ב-3× מרווח מהמדידה כדי לא להיות תלוי רעש מכונה.
 */
import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject, uniformFrames } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';

function proj(recipe: boolean) {
  const b = defaultBuilding(); b.frames = uniformFrames(40, 6000 * 39);
  b.kneeBraces = { ...(b.kneeBraces as object), enabled: true, profile: 'RHS60x60x4', drop: 800, reach: 800, angle: 45, plateT: 10, plateW: 150, plateL: 250, bolt: { d: 16, grade: '8.8', standard: 'ISO 4017', clearance: 2 }, gauge: 80, pitch: 200, weldSize: 5, exclude: [], detail: 'fin', boltsPerEnd: 2, ...(recipe ? { finEngine: 'recipe' } : {}) } as never;
  return newProject('perf', b);
}
const time = (p: ReturnType<typeof proj>) => { generate(p); const a = performance.now(); for (let i = 0; i < 2; i++) generate(p); return (performance.now() - a) / 2; };

describe('PERF-C1 פרטים מותאמים בהיקף גדול', () => {
  it('160 אתרים: תוספת לאתר מעל הקוד הישן < 20 מ"ש', () => {
    const pr = proj(true), pl = proj(false);
    const sites = generate(pr).connections.filter((c) => c.type === 'custom').length;
    expect(sites).toBe(160);
    const per = (time(pr) - time(pl)) / sites;
    console.log(`PERF-C1: ${sites} אתרים, תוספת ${per.toFixed(1)} מ"ש לאתר`);
    expect(per).toBeLessThan(20);
  }, 60000);
});
