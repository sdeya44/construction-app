// SKN (משהב"ש) codec — layout verified against a real Binarit export and Binarit import errors.
// Record = 2 physical lines of exactly 183 chars (line 2 empty when description ≤ 150 chars).
// Line 1: code(10) unit(2) qty(%09.2f) price(%012.2f) description[0..150]
// Line 2: 33 spaces + description[150..300]. CRLF everywhere. Encoding cp1255.
import { fixed, dec } from './money.js';

export const UNIT_CODES = {
  '00': 'הערה', '01': "יח'", '02': 'מ"א', '03': 'מ"ר', '04': 'מ"ק', '05': 'טון', '06': "נק'",
  '07': 'י"ע', '08': 'ש"ע', '09': "קומפ'", '10': 'פאושל', '11': 'ק"ג', '12': 'ליטר', '13': 'דונם',
};
const LABEL_TO_CODE = (() => {
  const m = {};
  for (const [k, v] of Object.entries(UNIT_CODES)) m[normUnit(v)] = k;
  Object.assign(m, {
    [normUnit("יח")]: '01', [normUnit('יחידה')]: '01', [normUnit("מ'")]: '02', [normUnit('מטר')]: '02', [normUnit('מ"ט')]: '02',
    [normUnit('מא')]: '02', [normUnit('קומפלט')]: '09', [normUnit('קומפ')]: '09', [normUnit('פאושלי')]: '10',
    [normUnit('נקודה')]: '06', [normUnit('יום עבודה')]: '07', [normUnit('שעת עבודה')]: '08', [normUnit('קג')]: '11',
  });
  return m;
})();
export function normUnit(u) {
  return String(u ?? '').replace(/[״"]/g, '"').replace(/[׳'`]/g, "'").replace(/\s+/g, '').replace(/\.$/, '');
}
export function unitCode(label) {
  const n = normUnit(label);
  return LABEL_TO_CODE[n] ?? LABEL_TO_CODE[n.replace(/['"]/g, '')] ?? null;
}

// ---- cp1255 -------------------------------------------------------------------------------
let ENC = null;
function encTable() {
  if (ENC) return ENC;
  ENC = new Map();
  const dec1255 = new TextDecoder('windows-1255');
  for (let b = 0x80; b <= 0xff; b++) {
    const ch = dec1255.decode(new Uint8Array([b]));
    if (ch !== '�' && !ENC.has(ch)) ENC.set(ch, b);
  }
  return ENC;
}
const FALLBACK = { '–': '-', '—': '-', '‘': "'", '’': "'", '“': '"', '”': '"', ' ': ' ', '‏': '', '‎': '' };
export function encodeCp1255(str) {
  const t = encTable();
  const out = [];
  const bad = new Set();
  for (const ch0 of str) {
    const ch = ch0 in FALLBACK ? FALLBACK[ch0] : ch0;
    for (const ch2 of ch) {
      const c = ch2.charCodeAt(0);
      if (c < 0x80) out.push(c);
      else if (t.has(ch2)) out.push(t.get(ch2));
      else { out.push(0x3f); bad.add(ch2); }
    }
  }
  return { bytes: Uint8Array.from(out), bad: [...bad] };
}
/** Prepare text so that its length in characters equals its length in cp1255 bytes. */
export const sknText = (s) => [...String(s ?? '')].map((c) => (c in FALLBACK ? FALLBACK[c] : c)).join('').replace(/[\r\n\t]+/g, ' ');

export function decodeSkn(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) return new TextDecoder('utf-8').decode(u8.subarray(3));
  const w = new TextDecoder('windows-1255').decode(u8);
  if (/[א-ת]/.test(w)) return w;
  // cp862 (DOS Hebrew): 0x80–0x9A → א–ת
  return Array.from(u8, (b) => (b >= 0x80 && b <= 0x9a ? String.fromCharCode(0x5d0 + b - 0x80) : String.fromCharCode(b))).join('');
}

// ---- import -------------------------------------------------------------------------------
/**
 * @returns {{title:string, sections:{code:string,name:string}[], items:object[], warnings:string[]}}
 */
export function parseSkn(input, { mergeContinuations = true } = {}) {
  const text = typeof input === 'string' ? input : decodeSkn(input);
  const lines = text.split(/\r?\n/);
  const recs = [];
  const warnings = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) continue;
    if (/^\d{10}/.test(l)) {
      const part1 = l.slice(33);
      const next = lines[i + 1] ?? '';
      let desc;
      if (next.length > 33 && /^ {33}/.test(next) && next.trim()) { desc = part1.padEnd(150, ' ').slice(0, 150) + next.slice(33).trimEnd(); i++; }
      else desc = part1.trimEnd();
      recs.push({ line: i + 1, code: l.slice(0, 10), unit: l.slice(10, 12), qty: l.slice(12, 21).trim(), price: l.slice(21, 33).trim(), desc: desc.trim() });
    } else if (/^ {33}/.test(l)) {
      if (recs.length) recs[recs.length - 1].desc = (recs[recs.length - 1].desc + ' ' + l.slice(33).trim()).trim();
    } else warnings.push(`שורה ${i + 1}: מבנה לא מזוהה, דולגה`);
  }
  let title = '';
  const sections = new Map();
  const items = [];
  let last = null;
  for (const r of recs) {
    const s = r.code.slice(0, 2), c = r.code.slice(2, 4), t = r.code.slice(4, 6), n = Number(r.code.slice(6, 10));
    const toDec = (v, what) => {
      try { return dec(fixed(v || '0')); } catch { warnings.push(`שורה ${r.line}: ${what} לא תקין "${v}"`); return '0'; }
    };
    if (r.code === '0000000000') { title = r.desc; last = null; continue; }
    if (c === '00' && t === '00' && n === 0) { sections.set(s, r.desc); last = null; continue; }
    if (t === '00' && n === 0) {
      // chapter title (unit 00) and subchapter-00 title (blank unit) share the code
      if (r.unit === '00' || !sections.has(`${s}.${c}`)) sections.set(`${s}.${c}`, r.desc);
      else sections.set(`${s}.${c}.00`, r.desc);
      last = null; continue;
    }
    if (n === 0) { sections.set(`${s}.${c}.${t}`, r.desc); last = null; continue; }
    const isZero = fixed(r.qty || '0') === 0n && fixed(r.price || '0') === 0n;
    if (r.unit === '00' && isZero) {
      if (mergeContinuations && last && last.struct === s && last.chapter === c && last.sub === t && n === last._lastNum + 1) {
        last.description = `${last.description} ${r.desc}`.trim();
        last._lastNum = n;
        continue;
      }
      items.push({ struct: s, chapter: c, sub: t, num: n, unit: '', qty: '0', price: '0', description: r.desc, kind: 'note' });
      last = null; continue;
    }
    const unit = UNIT_CODES[r.unit];
    if (!unit) warnings.push(`שורה ${r.line}: קוד יחידה לא מוכר "${r.unit}" (סעיף ${r.code})`);
    const it = { struct: s, chapter: c, sub: t, num: n, unit: unit ?? r.unit.trim(), qty: toDec(r.qty, 'כמות'), price: toDec(r.price, 'מחיר'),
      description: r.desc, kind: c === '99' ? 'extra' : 'contract', _lastNum: n };
    items.push(it);
    last = it;
  }
  for (const it of items) delete it._lastNum;
  // ensure titles exist for every level used
  for (const it of items) {
    for (const k of [it.struct, `${it.struct}.${it.chapter}`, `${it.struct}.${it.chapter}.${it.sub}`])
      if (!sections.has(k)) sections.set(k, '');
  }
  const seen = new Set();
  for (const it of items) {
    const k = `${it.struct}.${it.chapter}.${it.sub}.${it.num}`;
    if (seen.has(k)) warnings.push(`מספור כפול: ${k}`);
    seen.add(k);
  }
  return { title, sections: [...sections].map(([code, name]) => ({ code, name })), items, warnings };
}

// ---- export -------------------------------------------------------------------------------
const SEG = 150, PRE = 33, MAXD = 300;

function wsplit(t, n = MAXD) {
  const out = [];
  let cur = '';
  for (const w of t.split(' ')) {
    const c = cur ? `${cur} ${w}` : w;
    if (c.length > n) {
      if (cur) out.push(cur);
      cur = w;
      while (cur.length > n) { out.push(cur.slice(0, n)); cur = cur.slice(n); }
    } else cur = c;
  }
  if (cur) out.push(cur);
  return out.length ? out : [''];
}

function fmtNum(v, width, maxInt, what, code) {
  const f = fixed(v);
  if (f < 0n) throw new Error(`${code}: ${what} שלילי אינו נתמך ב-SKN`);
  const r2 = (f + 50n) / 100n; // round to 2 decimals
  const s = `${r2 / 100n}.${String(r2 % 100n).padStart(2, '0')}`;
  if (r2 / 100n >= 10n ** BigInt(maxInt)) throw new Error(`${code}: ${what} ${dec(f)} חורג ממגבלת SKN (${maxInt} ספרות שלמות)`);
  return { s: s.padStart(width, '0'), rounded: f % 100n !== 0n };
}

/**
 * @param {string} title
 * @param {{code:string,name:string}[]} sections
 * @param {object[]} items  {struct,chapter,sub,num,unit,qty,price,description,kind}
 * @returns {{bytes:Uint8Array, text:string, warnings:string[], records:number}}
 */
export function buildSkn(title, sections, items) {
  const warnings = [];
  const sec = new Map(sections.map((s) => [s.code, s.name]));
  const R = [['0000000000', '00', '0', '0', sknText(title)]];
  const sorted = [...items].sort((a, b) => `${a.struct}${a.chapter}${a.sub}`.localeCompare(`${b.struct}${b.chapter}${b.sub}`)
    || (a.kind === 'note' ? 0 : 1) - (b.kind === 'note' ? 0 : 1) || a.num - b.num);
  const tree = new Map();
  for (const it of sorted) {
    for (const [k, v] of [['struct', it.struct], ['chapter', it.chapter], ['sub', it.sub]])
      if (!/^\d{2}$/.test(v)) throw new Error(`מספור לא תקין (${k}="${v}") בסעיף ${it.description.slice(0, 40)}`);
    if (!(it.num >= 1 && it.num <= 9999)) throw new Error(`מספר סעיף לא תקין: ${it.num}`);
    const s = tree.get(it.struct) ?? new Map(); tree.set(it.struct, s);
    const c = s.get(it.chapter) ?? new Map(); s.set(it.chapter, c);
    const t = c.get(it.sub) ?? []; c.set(it.sub, t);
    t.push(it);
  }
  for (const [s, chs] of tree) {
    R.push([`${s}00000000`, '  ', '0', '0', sknText(sec.get(s) || `מבנה ${s}`)]);
    for (const [c, subs] of chs) {
      R.push([`${s}${c}000000`, '00', '0', '0', sknText(sec.get(`${s}.${c}`) || `פרק ${c}`)]);
      for (const [t, its] of subs) {
        if (t !== '00' || sec.get(`${s}.${c}.00`)) R.push([`${s}${c}${t}0000`, '  ', '0', '0', sknText(sec.get(`${s}.${c}.${t}`) || sec.get(`${s}.${c}`) || '')]);
        const used = new Set(its.map((i) => i.num));
        for (const it of its) {
          const code = `${s}${c}${t}${String(it.num).padStart(4, '0')}`;
          const parts = wsplit(sknText(it.description));
          let u = '00', q = '0', p = '0';
          if (it.kind !== 'note') {
            u = unitCode(it.unit);
            if (!u || u === '00') throw new Error(`${code}: יחידה "${it.unit}" אינה ניתנת למיפוי לקוד SKN`);
            if (normUnit(it.unit) !== normUnit(UNIT_CODES[u])) warnings.push(`${code}: היחידה "${it.unit}" תופיע בבנארית כ-${UNIT_CODES[u]}`);
            q = it.qty; p = it.price;
          }
          R.push([code, u, q, p, parts[0]]);
          let k = it.num;
          for (const part of parts.slice(1)) {
            k++;
            if (used.has(k) || k > 9999) throw new Error(`${code}: אין מספר פנוי להמשך תיאור (${k}) — קצר את התיאור או שנה מספור`);
            used.add(k);
            warnings.push(`${code}: תיאור מעל 300 תווים פוצל להמשך בסעיף ${String(k).padStart(4, '0')}`);
            R.push([`${s}${c}${t}${String(k).padStart(4, '0')}`, '00', '0', '0', part]);
          }
        }
      }
    }
  }
  const lines = [];
  for (const [code, u, q, p, d] of R) {
    const fq = fmtNum(q, 9, 6, 'כמות', code), fp = fmtNum(p, 12, 9, 'מחיר', code);
    if (fq.rounded) warnings.push(`${code}: כמות עוגלה ל-2 ספרות (${fq.s})`);
    if (fp.rounded) warnings.push(`${code}: מחיר עוגל ל-2 ספרות (${fp.s})`);
    const head = code + u + fq.s + fp.s;
    if (head.length !== PRE) throw new Error(`שגיאה פנימית: אורך כותרת ${head.length}`);
    lines.push(head + d.slice(0, SEG).padEnd(SEG, ' '));
    lines.push(d.length > SEG ? ' '.repeat(PRE) + d.slice(SEG).padEnd(SEG, ' ') : '');
  }
  const text = lines.join('\r\n') + '\r\n';
  const { bytes, bad } = encodeCp1255(text);
  if (bad.length) warnings.push(`תווים שאינם נתמכים ב-cp1255 הוחלפו ב-"?": ${bad.join(' ')}`);
  // self-check
  for (const l of lines) if (l.length !== 0 && l.length !== 183) throw new Error(`שגיאה פנימית: אורך שורה ${l.length}`);
  return { bytes, text, warnings, records: R.length };
}
