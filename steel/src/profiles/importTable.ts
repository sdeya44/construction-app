import { unzipSync, strFromU8 } from 'fflate';
import { normalizeName } from './library';
import type { CatalogRow } from './userCatalog';

export type Cell = string | number | null;

/** קריאת הגיליון הראשון מקובץ XLSX (ללא ספרייה חיצונית): מחרוזות משותפות, מספרים, מחרוזות מוטבעות. */
export function readXlsx(bytes: Uint8Array): Cell[][] {
  const z = unzipSync(bytes);
  const get = (p: string) => (z[p] ? strFromU8(z[p]) : '');
  const shared: string[] = [];
  const ss = get('xl/sharedStrings.xml');
  for (const si of ss.match(/<si>[\s\S]*?<\/si>/g) ?? []) shared.push((si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) ?? []).map((t) => decode(t.replace(/<[^>]+>/g, ''))).join(''));
  const wb = get('xl/workbook.xml');
  const rels = get('xl/_rels/workbook.xml.rels');
  const firstId = /<sheet [^>]*r:id="([^"]+)"/.exec(wb)?.[1];
  const target = firstId ? new RegExp(`Id="${firstId}"[^>]*Target="([^"]+)"`).exec(rels)?.[1] ?? new RegExp(`Target="([^"]+)"[^>]*Id="${firstId}"`).exec(rels)?.[1] : null;
  const path = target ? (target.startsWith('/') ? target.slice(1) : `xl/${target}`) : 'xl/worksheets/sheet1.xml';
  const sheet = get(path);
  if (!sheet) throw new Error('לא נמצא גיליון בקובץ');
  const rows: Cell[][] = [];
  for (const row of sheet.match(/<row[^>]*>[\s\S]*?<\/row>/g) ?? []) {
    const r: Cell[] = [];
    for (const c of row.match(/<c [^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) ?? []) {
      const ref = /r="([A-Z]+)\d+"/.exec(c)?.[1] ?? '';
      const col = [...ref].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
      const t = /t="([^"]+)"/.exec(c)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(c)?.[1];
      let val: Cell = null;
      if (t === 's' && v !== undefined) val = shared[Number(v)] ?? '';
      else if (t === 'inlineStr') val = decode((c.match(/<t[^>]*>([\s\S]*?)<\/t>/g) ?? []).map((x) => x.replace(/<[^>]+>/g, '')).join(''));
      else if (t === 'str' && v !== undefined) val = decode(v);
      else if (v !== undefined) val = Number(v);
      if (col >= 0) r[col] = val;
    }
    rows.push(Array.from({ length: r.length }, (_, i) => r[i] ?? null));
  }
  return rows;
}
const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** CSV: מפריד אוטומטי (פסיק / נקודה-פסיק / טאב), מרכאות. */
export function readCsv(text: string): Cell[][] {
  const t = text.replace(/^﻿/, '');
  const first = t.split(/\r?\n/)[0] ?? '';
  const sep = [';', '\t', ','].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows: string[][] = [];
  let row: string[] = [], cur = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"' && t[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === sep) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== '')).map((r) => r.map((c) => { const s = c.trim(); const n = Number(s.replace(',', '.')); return s !== '' && Number.isFinite(n) ? n : s || null; }));
}

export type Field = 'name' | 'h' | 'b' | 'tw' | 'tf' | 'r' | 't' | 'A' | 'mass' | 'Iy' | 'Iz' | 'Wy' | 'Wz' | 'iy' | 'iz';
export const FIELDS: { k: Field; label: string; unitOpts?: string[] }[] = [
  { k: 'name', label: 'שם חתך' }, { k: 'h', label: 'גובה h (מ"מ)' }, { k: 'b', label: 'רוחב b (מ"מ)' },
  { k: 'tw', label: 'עובי ווב tw (מ"מ)' }, { k: 'tf', label: 'עובי אגף tf (מ"מ)' }, { k: 'r', label: 'רדיוס r (מ"מ)' }, { k: 't', label: 'עובי דופן t (מ"מ)' },
  { k: 'A', label: 'שטח A', unitOpts: ['cm²', 'mm²'] }, { k: 'mass', label: 'משקל (ק"ג/מ\')' },
  { k: 'Iy', label: 'Iy', unitOpts: ['cm⁴', 'mm⁴'] }, { k: 'Iz', label: 'Iz', unitOpts: ['cm⁴', 'mm⁴'] },
  { k: 'Wy', label: 'Wy', unitOpts: ['cm³', 'mm³'] }, { k: 'Wz', label: 'Wz', unitOpts: ['cm³', 'mm³'] },
  { k: 'iy', label: 'iy', unitOpts: ['cm', 'mm'] }, { k: 'iz', label: 'iz', unitOpts: ['cm', 'mm'] },
];

const SYN: Record<Field, RegExp> = {
  name: /^(name|profile|section|designation|חתך|פרופיל|שם|סוג)/i,
  h: /^(h|d|גובה|height)\b/i, b: /^(b|bf|רוחב|width)\b/i, tw: /^(tw|s|עובי ?ווב|web)/i, tf: /^(tf|עובי ?אגף|flange)/i,
  r: /^(r|r1|רדיוס)\b/i, t: /^(t|עובי)$/i, A: /^(a|area|שטח)\b/i, mass: /^(g|m|mass|weight|משקל|kg\/m)/i,
  // רגישות לאותיות: Iy/Ix = מומנט התמד, iy/ix = רדיוס התמד
  Iy: /^(Iy|Ix|I_y|Iyy|Ixx)\b/, Iz: /^(Iz|I_z|Izz)\b/, Wy: /^(Wy|Wx|Wel\.?y|Wel,y)\b/, Wz: /^(Wz|Wel\.?z|Wel,z)\b/,
  iy: /^(iy|ix|i_y)\b/, iz: /^(iz|i_z)\b/,
};

/** זיהוי שורת הכותרת ומיפוי עמודות אוטומטי לפי שמות נפוצים (עברית/אנגלית). */
export function detectMapping(rows: Cell[][]): { header: number; map: Partial<Record<Field, number>> } {
  let best = { header: 0, map: {} as Partial<Record<Field, number>>, score: -1 };
  for (let h = 0; h < Math.min(rows.length, 15); h++) {
    const map: Partial<Record<Field, number>> = {};
    rows[h].forEach((c, i) => {
      if (typeof c !== 'string') return;
      const s = c.trim();
      for (const f of Object.keys(SYN) as Field[]) if (map[f] === undefined && SYN[f].test(s)) { map[f] = i; break; }
    });
    const score = Object.keys(map).length;
    if (score > best.score) best = { header: h, map, score };
  }
  return { header: best.header, map: best.map };
}

const UNIT: Record<string, number> = { 'cm²': 100, 'mm²': 1, 'cm⁴': 1e4, 'mm⁴': 1, 'cm³': 1e3, 'mm³': 1, cm: 10, mm: 1 };

/** בניית שורות קטלוג מהטבלה לפי מיפוי ויחידות. שורות ללא שם חתך מזוהה נדחות. */
export function buildRows(rows: Cell[][], header: number, map: Partial<Record<Field, number>>, units: Partial<Record<Field, string>>): { rows: CatalogRow[]; skipped: number } {
  const out: CatalogRow[] = [];
  let skipped = 0;
  let family = '';
  for (const r of rows.slice(header + 1)) {
    const raw = map.name !== undefined ? r[map.name] : null;
    if (raw === null || raw === undefined || raw === '') { skipped++; continue; }
    let name = normalizeName(String(raw));
    // טבלאות שבהן שם הסדרה מופיע פעם אחת ואחריו רק מספרים ("IPE" ואז "200")
    if (/^[A-Z]+$/.test(name)) { family = name; skipped++; continue; }
    if (/^\d/.test(name) && family) name = family + name;
    const row: CatalogRow = { name };
    for (const f of FIELDS) {
      if (f.k === 'name' || map[f.k] === undefined) continue;
      const v = r[map[f.k]!];
      const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.'));
      if (!Number.isFinite(n) || v === null || v === '') continue;
      const k = f.unitOpts ? UNIT[units[f.k] ?? f.unitOpts[0]] : 1;
      (row as unknown as Record<string, number>)[f.k] = n * k;
    }
    out.push(row);
  }
  return { rows: out, skipped };
}
