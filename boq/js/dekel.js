// Dekel price book. Loaded from a separate .db file the user supplies (licensed data is never
// bundled with the app or published). All searching happens in memory.
import { fixed, divRound, dec } from './money.js';

export const normText = (s) => String(s ?? '')
  .toLowerCase()
  .replace(/[״"׳'`\-–—.,()\/\\]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

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

  /** AND search over words; optional chapter/unit filters. */
  search(query, { chapter = '', unit = '', limit = 200 } = {}) {
    const words = normText(query).split(' ').filter(Boolean);
    const out = [];
    for (const it of this.items) {
      if (chapter && it.chapter !== chapter) continue;
      if (unit && normText(it.unit) !== normText(unit)) continue;
      if (words.every((w) => it.norm.includes(w))) { out.push(it); if (out.length >= limit) break; }
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
