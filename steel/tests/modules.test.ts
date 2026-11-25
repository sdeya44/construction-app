/** MOD-01: מפת המודולים שלמה — כל קובץ בדיקה משויך, כל נתיב קיים. */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — מודול JS ללא טיפוסים
import { HEAVY, MODULES, SMOKE } from './modules.mjs';

type Entry = string | { file: string; t: string };
const mods = MODULES as Record<string, { src: string[]; tests: Entry[]; e2e: string[] }>;
describe('MOD-01 מפת מודולים', () => {
  it('כל קובץ בדיקה במודול, בעשן או בכבדות', () => {
    const covered = new Set<string>([...HEAVY, ...SMOKE, ...Object.values(mods).flatMap((m) => m.tests.map((e) => (typeof e === 'string' ? e : e.file)))]);
    const all = fs.readdirSync('tests').filter((f) => f.endsWith('.test.ts')).map((f) => `tests/${f}`);
    expect(all.filter((f) => !covered.has(f))).toEqual([]);
  });
  it('כל הנתיבים קיימים', () => {
    const missing = Object.entries(mods).flatMap(([k, m]) => [...m.src, ...m.tests.map((e) => (typeof e === 'string' ? e : e.file)), ...m.e2e].filter((p) => !fs.existsSync(p)).map((p) => `${k}: ${p}`));
    expect(missing).toEqual([]);
  });
});
