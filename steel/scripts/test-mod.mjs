#!/usr/bin/env node
/**
 * הרצת בדיקות לפי מודול — רק מה שרלוונטי לשינוי.
 *
 *   npm run test:mod -- wing fab        מודולים בשם
 *   npm run test:mod -- --changed       לפי הקבצים ששונו מול HEAD (כולל קבצים חדשים)
 *   npm run test:mod -- --changed main  לפי השינויים מול ענף/commit
 *   npm run test:mod -- --list          רשימת המודולים
 *   ... --smoke   מוסיף את בדיקת העשן
 *   ... --e2e     מריץ גם את בדיקות הדפדפן של המודולים (בונה ומפעיל preview)
 *   ... --dry     מציג מה ירוץ בלי להריץ
 *
 * מודול גיאומטריה ממופה ידנית (tests/modules.mjs) — כי כמעט כל בדיקה עוברת דרך generate().
 * קובץ מקור שלא שייך לאף מודול — הבחירה לפי גרף הייבוא (בלי הבדיקות הכבדות).
 */
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HEAVY, MODULES, SMOKE } from '../tests/modules.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const names = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--changed');

if (flag('--list')) {
  for (const [k, m] of Object.entries(MODULES)) console.log(`${k.padEnd(12)} ${m.title}`);
  process.exit(0);
}

const modules = new Set(names);
for (const n of names) if (!MODULES[n]) { console.error(`מודול לא מוכר: ${n}. רשימה: npm run test:mod -- --list`); process.exit(2); }
const extraFiles = new Set();

/** גרף ייבוא: אילו קבצי בדיקה תלויים בקובץ */
function importGraph() {
  const deps = new Map();
  const resolve = (from, spec) => {
    if (!spec.startsWith('.')) return null;
    const b = path.resolve(path.dirname(from), spec);
    for (const c of [b, `${b}.ts`, `${b}.tsx`, `${b}/index.ts`]) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
    return null;
  };
  const of = (f) => {
    if (deps.has(f)) return deps.get(f);
    const out = new Set();
    deps.set(f, out);
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) { const r = resolve(f, m[1]); if (r) out.add(r); }
    return out;
  };
  const tests = fs.readdirSync(path.join(ROOT, 'tests')).filter((f) => f.endsWith('.test.ts')).map((f) => path.join(ROOT, 'tests', f));
  const closure = new Map(tests.map((t) => {
    const seen = new Set(); const st = [t];
    while (st.length) for (const d of of(st.pop())) if (!seen.has(d)) { seen.add(d); st.push(d); }
    return [t, seen];
  }));
  return (abs) => tests.filter((t) => closure.get(t).has(abs)).map((t) => path.relative(ROOT, t));
}

if (flag('--changed')) {
  const i = args.indexOf('--changed');
  const base = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : 'HEAD';
  const git = (c) => execSync(c, { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  const top = execSync('git rev-parse --show-toplevel', { cwd: ROOT, encoding: 'utf8' }).trim();
  const files = [...git(`git diff --name-only ${base}`), ...git('git ls-files --others --exclude-standard --full-name')]
    .map((f) => path.relative(ROOT, path.join(top, f))).filter((f) => !f.startsWith('..'));
  const graph = importGraph();
  for (const f of new Set(files)) {
    if (/^tests\/.*\.test\.ts$/.test(f)) { if (HEAVY.includes(f)) console.log(`  ${f}: בדיקה כבדה — רק דרך המודולים או בהרצה מלאה`); else extraFiles.add(f); continue; }
    if (!/^src\//.test(f)) continue;
    const hit = Object.entries(MODULES).filter(([, m]) => m.src.some((p) => (p.endsWith('/') ? f.startsWith(p) : f === p)));
    // מודול ספציפי קודם ל-ui הכללי (למשל src/ui/LiveView3D.tsx → view)
    const specific = hit.filter(([k]) => k !== 'ui');
    for (const [k] of specific.length ? specific : hit) modules.add(k);
    if (!hit.length) {
      const ts = graph(path.join(ROOT, f)).filter((t) => !HEAVY.includes(t));
      console.log(`  ${f}: לא ממופה — לפי גרף הייבוא ${ts.length} קבצים${ts.length > 12 ? ' (רבים מדי → עשן)' : ''}`);
      if (ts.length > 12) SMOKE.forEach((t) => extraFiles.add(t)); else ts.forEach((t) => extraFiles.add(t));
    }
  }
  console.log(`שינויים מול ${base}: ${files.length} קבצים → מודולים: ${[...modules].join(', ') || '—'}`);
}

if (flag('--smoke')) SMOKE.forEach((t) => extraFiles.add(t));
if (!modules.size && !extraFiles.size) { console.log('אין מה להריץ. ציין מודול, --changed או --smoke.'); process.exit(0); }

const whole = new Set(extraFiles);
const filtered = new Map(); // file -> Set(t)
for (const k of modules) for (const e of MODULES[k].tests) {
  if (typeof e === 'string') { if (!HEAVY.includes(e)) whole.add(e); }
  else { const s = filtered.get(e.file) ?? new Set(); s.add(e.t); filtered.set(e.file, s); }
}
for (const f of whole) filtered.delete(f);

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('\\^', '^');
const runs = [];
if (whole.size) runs.push(['vitest', 'run', ...whole]);
for (const [file, ts] of filtered) runs.push(['vitest', 'run', file, '-t', [...ts].map(esc).join('|')]);

const e2e = flag('--e2e') ? [...new Set([...modules].flatMap((k) => MODULES[k].e2e))] : [];
console.log(`מודולים: ${[...modules].join(', ') || '—'}`);
for (const r of runs) console.log('  npx ' + r.map((a) => (/\s|\|/.test(a) ? JSON.stringify(a) : a)).join(' '));
if (e2e.length) console.log(`  e2e: ${e2e.join(' ')}`);
if (flag('--dry')) process.exit(0);

let fail = 0;
const t0 = Date.now();
for (const r of runs) fail |= spawnSync('npx', r, { cwd: ROOT, stdio: 'inherit' }).status !== 0;
if (e2e.length) {
  fail |= spawnSync('npx', ['vite', 'build'], { cwd: ROOT, stdio: 'inherit' }).status !== 0;
  fail |= spawnSync('npx', ['playwright', 'test', '--trace', 'off', ...e2e], { cwd: ROOT, stdio: 'inherit' }).status !== 0;
}
console.log(`\n${fail ? '✗ נכשל' : '✓ עבר'} · ${((Date.now() - t0) / 1000).toFixed(0)} שניות`);
process.exit(fail ? 1 : 0);
