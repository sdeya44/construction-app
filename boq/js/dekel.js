// Dekel price book. Loaded from a separate .db file the user supplies (licensed data is never
// bundled with the app or published). All searching happens in memory.
import { fixed, divRound, dec } from './money.js';

export const normText = (s) => collapseLatin(String(s ?? '')
  .toLowerCase()
  .replace(/[״"׳'`\-–—.,()\/\\]/g, ' ')
  .replace(/[ךםןףץ]/g, (c) => ({ 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' }[c])) // final letters match inside words (אבן ↔ אבנים)
  .replace(/\s+/g, ' ')
  .trim());

/** "h d p e" / "h.d.p.e" → "hdpe": spelled-out Latin abbreviations become one token. */
function collapseLatin(t) {
  return t.replace(/(^| )((?:[a-z] )+[a-z])(?= |$)/g, (m, pre, run) => pre + run.replace(/ /g, ''));
}

// ---- Hebrew word roots (light, rule based) ----
// מרצפים / מרצפות / רצפה / רצפת / ריצוף → "רצפ". Each word yields a few keys (with/without a
// prefix letter); a query word matches an item word when they share a key.
const HE = /^[\u05d0-\u05ea]+$/;
const PREFIX = 'ומשהבלכ';
const SUFFIXES = ['יות', 'ות', 'ימ', 'ים', 'ית', 'ה', 'ת', 'י']; // words arrive with final letters normalized (ם→מ)
function skeleton(w) {
  let x = w;
  for (const suf of SUFFIXES) if (x.length - suf.length >= 3 && x.endsWith(suf)) { x = x.slice(0, -suf.length); break; }
  const core = x[0] + x.slice(1).replace(/[וי]/g, '');   // drop vowel letters (matres lectionis) after the first letter
  return core.length >= 2 ? core : x;
}
export function rootKeys(word) {
  if (!HE.test(word) || word.length < 3) return [];
  const keys = new Set([skeleton(word)]);
  let w = word;
  for (let i = 0; i < 2 && w.length > 3 && PREFIX.includes(w[0]); i++) { w = w.slice(1); const k = skeleton(w); if (k.length >= 3) keys.add(k); }
  return [...keys];
}

// ---- item families: lines that differ only in a number (depth, diameter, grade, thickness, quantity range) ----
const NUM = /\d+(?:[.,]\d+)?(?:\s*[-/x×]\s*\d+(?:[.,]\d+)?)*/g;
const PARAMS = [[/עובי/, 'עובי'], [/קוטר|Ø/, 'קוטר'], [/עומק/, 'עומק'], [/גובה/, 'גובה'], [/רוחב/, 'רוחב'], [/אורך/, 'אורך'], [/מידות/, 'מידות'],
  [/דרג/, 'דרג'], [/sdr/i, 'SDR'], [/כמות|כמויות/, 'כמות'], [/שטח/, 'שטח'], [/תפוקת|הספק/, 'תפוקה'], [/לחץ/, 'לחץ'], [/מפתח/, 'מפתח'], [/משקל/, 'משקל'],
  [/נפח/, 'נפח'], [/שיפוע/, 'שיפוע'], [/מרווח|פסיעה/, 'מרווח'], [/(^|\s)ב-?$/, 'סוג בטון'], [/(^|\s|-)pe-?$/i, 'PE'], [/ת"?י$/, 'ת"י']];
function slotLabel(seg) {
  const tail = seg.replace(/[(),:;+]/g, ' ').trim().split(/\s+/).slice(-4);
  const text = tail.join(' ');
  let label = '';
  for (const [re, name] of PARAMS) if (re.test(name === 'סוג בטון' || name === 'PE' || name === 'ת"י' ? text : text)) { label = name; if (re.source.endsWith('$')) break; }
  const last = tail.at(-1)?.replace(/^ו/, '') ?? '';
  if (['עד', 'מעל', 'מ-', 'מ'].includes(last) && label !== last) label = label ? `${label} ${last === 'מ-' || last === 'מ' ? 'מ' : last}` : last;
  return label || tail.at(-1)?.replace(/["״׳']/g, '') || '';
}

export class Dekel {
  /** @param SQL sql.js module, @param bytes Uint8Array of dekel_pricelist.db */
  constructor(SQL, bytes, label = '') {
    const db = new SQL.Database(bytes);
    try {
      const q = (sql) => { const r = db.exec(sql)[0]; return r ? r.values : []; };
      this.chapters = new Map(q('SELECT code, name FROM chapters'));
      this.subchapters = new Map(q('SELECT code, name FROM subchapters'));
      this.items = q('SELECT code, chapter_code, subchapter_code, description, unit, price FROM items ORDER BY code').map(
        ([code, chapter, sub, description, unit, price]) => ({ code, chapter, sub, description, unit, price: String(price), norm: ` ${normText(`${code} ${description} ${unit}`)} ` }));
    } catch (e) {
      throw new Error('הקובץ אינו מחירון דקל תקין (חסרות טבלאות items/chapters/subchapters)');
    } finally { db.close(); }
    if (!this.items.length) throw new Error('המחירון ריק');
    this.byCode = new Map(this.items.map((i) => [i.code, i]));
    this.label = label;
  }

  get(code) { return this.byCode.get(String(code ?? '').trim()) ?? null; }

  /** Root keys of each item's description, built on first use. */
  _roots() {
    if (this._rootsBuilt) return;
    for (const it of this.items) {
      const keys = new Set();
      for (const w of normText(it.description).split(' ')) for (const k of rootKeys(w)) keys.add(k);
      it.roots = ` ${[...keys].join(' ')} `;
    }
    this._rootsBuilt = true;
  }

  /** Families of near-identical lines in the same subchapter and unit; built on first use. */
  _families() {
    if (this.famOf) return;
    const groups = new Map();
    for (const it of this.items) {
      const template = it.description.replace(NUM, '#');
      const key = `${it.chapter}.${it.sub}|${it.unit}|${template}`;
      if (!groups.has(key)) groups.set(key, { template, items: [] });
      groups.get(key).items.push(it);
    }
    this.famOf = new Map();
    let id = 0;
    for (const g of groups.values()) {
      if (g.items.length < 2) continue;
      const vals = g.items.map((it) => it.description.match(NUM) ?? []);
      const n = vals[0].length;
      if (!vals.every((v) => v.length === n)) continue;
      const segs = g.template.split('#');
      const slots = [];
      for (let i = 0; i < n; i++) {
        const distinct = [...new Set(vals.map((v) => v[i]))];
        if (distinct.length > 1) slots.push({ index: i, label: slotLabel(segs[i]) || `ערך ${slots.length + 1}`, values: distinct.sort((a, b) => parseFloat(a) - parseFloat(b) || a.localeCompare(b)) });
      }
      if (!slots.length) continue;                       // identical text — keep them apart
      const fam = { id: ++id, template: g.template, slots, items: g.items.map((it, k) => ({ it, vals: vals[k] })) };
      for (const it of g.items) this.famOf.set(it.code, fam);
    }
  }
  /** The family of a Dekel line (null when it has no variants). */
  family(code) { this._families(); return this.famOf.get(code) ?? null; }
  /** Variant label of an item inside its family, e.g. "קוטר 110 · בעומק עד 2". */
  variantLabel(fam, it) {
    const v = fam.items.find((x) => x.it === it)?.vals ?? [];
    return fam.slots.map((s) => `${s.label} ${v[s.index]}`).join(' · ');
  }

  /**
   * Smart AND search: every query word must match — as text (also a shortened form), or by Hebrew
   * root (מרצפים ↔ רצפה/ריצוף), with Latin abbreviations written any way (HDPE / H.D.P.E / h d p e).
   * Ranked: exact / leading code, the phrase as typed, words at the start, whole words, then shorter
   * (more specific) lines; demolition / material-only / repair lines drop unless asked for.
   */
  search(query, { chapter = '', unit = '', limit = 200 } = {}) {
    const q = normText(query);
    const words = q.split(' ').filter(Boolean);
    if (!words.length) return [];
    this._roots();
    const stems = words.map((w) => (w.length > 4 && !/^\d/.test(w) ? w.slice(0, -1) : w));
    const keys = words.map((w) => rootKeys(w));
    const scored = [];
    for (const it of this.items) {
      if (chapter && it.chapter !== chapter) continue;
      if (unit && normText(it.unit) !== normText(unit)) continue;
      let s = 0, ok = true;
      for (let i = 0; i < words.length; i++) {
        if (it.norm.includes(stems[i])) continue;
        if (keys[i].some((k) => it.roots.includes(` ${k} `))) { s -= 3; continue; }   // root-only match ranks a bit lower
        ok = false; break;
      }
      if (!ok) continue;
      const code = String(it.code);
      if (code === query.trim()) s += 1000; else if (code.startsWith(query.trim())) s += 200;
      if (words.length > 1 && it.norm.includes(` ${q}`)) s += 40;
      const desc = ` ${normText(it.description)} `;
      words.forEach((w, i) => {
        if (desc.includes(` ${w} `)) s += 8;
        else if (desc.includes(` ${w}`)) s += 5;
        const at = desc.indexOf(stems[i]);
        if (at >= 0 && at < 30) s += i === 0 ? 10 : 4;
      });
      if (desc.startsWith(` ${q}`)) s += 30;
      for (const [w, pen] of SIDE) if (desc.includes(w) && !q.includes(w.trim())) s -= pen;
      s -= Math.min(10, desc.length / 40);
      scored.push([s, it]);
    }
    scored.sort((a, b) => b[0] - a[0] || a[1].code.localeCompare(b[1].code));
    return scored.slice(0, limit).map(([, it]) => it);
  }

  /** Search results with variant families collapsed to one entry (the best-ranked member first). */
  searchGrouped(query, opts = {}) {
    const limit = opts.limit ?? 80;
    const all = this.search(query, { ...opts, limit: 2000 });
    this._families();
    const out = [], seen = new Set();
    for (const it of all) {
      const fam = this.famOf.get(it.code);
      if (fam) { if (seen.has(fam.id)) continue; seen.add(fam.id); }
      out.push({ item: it, family: fam ?? null });
      if (out.length >= limit) break;
    }
    return out;
  }

  /**
   * Candidates for a BOQ line by description similarity. Never auto-selected:
   * many Dekel items differ only by quantity range/depth/thickness.
   */
  suggest(description, unit = '', limit = 15) {
    // light Hebrew stemming: drop a final letter of long words (רצפת→רצפ matches רצפה/רצפות)
    const words = [...new Set(normText(description).split(' ').filter((w) => w.length > 1 && !STOP.has(w))
      .map((w) => (/^\d+$/.test(w) ? ` ${w} ` : w.length > 4 ? w.slice(0, -1) : w)))];
    if (!words.length) return [];
    const un = normText(unit);
    // weight each word by rarity (IDF) so "בטון" counts less than "רצפת"
    const N = this.items.length;
    const df = words.map((w) => { let n = 0; for (const it of this.items) if (it.norm.includes(w)) n++; return n; });
    const idf = df.map((n) => (n ? Math.log(N / n) : 0));
    const total = idf.reduce((a, b) => a + b, 0) || 1;
    const scored = [];
    for (const it of this.items) {
      let s = 0;
      words.forEach((w, i) => { if (it.norm.includes(w)) s += idf[i]; });
      if (!s) continue;
      s = s / total;
      if (un && normText(it.unit) === un) s += 0.15;
      scored.push([s, it]);
    }
    scored.sort((a, b) => b[0] - a[0]);
    return scored.slice(0, limit).map(([score, it]) => ({ ...it, score }));
  }
}

const SIDE = [['פירוק', 25], ['הריסת', 25], ['הריסה', 25], ['תיקון', 15], ['חומר בלבד', 15], ['תוספת', 10], ['עבודה בלבד', 8]].map(([w, p]) => [` ${normText(w)} `, p]);
const STOP = new Set(['של', 'עם', 'או', 'על', 'לפי', 'כולל', 'לרבות', 'עד', 'כל', 'את', 'מכל', 'סוג', 'שהוא', 'ס', 'מ', 'בעובי']);

/** Deviation of a price from the Dekel reference, in percent (decimal string, 2dp). */
export function deviation(price, dekelPrice) {
  const p = fixed(price), d = fixed(dekelPrice);
  if (d === 0n) return null;
  return dec(divRound((p - d) * 10000n, d) * 100n); // percent with 2 decimals (scaled)
}
export function deviationFlag(devPct, threshold) {
  if (devPct == null) return 'none';
  const v = Math.abs(Number(devPct));
  if (v > Number(threshold)) return Number(devPct) > 0 ? 'high' : 'low';
  return 'ok';
}

/**
 * Quote price: Dekel × (1 + general%) × (1 + chapter%), rounded to agorot.
 * Positive = markup, negative = discount from Dekel.
 */
export function quotePrice(dekelPrice, generalPct = '0', chapterPct = '0') {
  const d = fixed(dekelPrice); // ×1e4
  const g = 1000000n + fixed(generalPct); // (100 + g%) ×1e4
  const c = 1000000n + fixed(chapterPct);
  const v = divRound(d * g * c, 10n ** 12n * 100n); // → agorot
  return dec(v * 100n);
}
