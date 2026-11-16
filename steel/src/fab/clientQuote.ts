/**
 * הצעת מחיר ללקוח (PDF, A4 לאורך): כותרת החברה, פרטי לקוח ופרויקט, תמונת תלת־ממד של המבנה, מפרט עיקרי,
 * טבלת מחירים בקטגוריות (תקורה ורווח מגולמים במחירים — לא מוצגים ללקוח), מע"מ, תנאים וחתימה.
 */
import type { Sheet } from '../drawing/sheet';
import type { DerivedModel, Project } from '../model/types';
import type { CladdingTakeoff } from '../geometry/cladding';
import type { Quote } from './quote';

export const DEFAULT_TERMS = [
  'תוקף ההצעה: 30 יום מתאריך ההוצאה.',
  'תנאי תשלום: 30% במעמד ההזמנה, 50% באספקת השלד, 20% בסיום ההרכבה.',
  'לוח זמנים: ייצור ואספקה כ-6 שבועות מאישור תוכניות ומקדמה.',
  'אינו כולל: עבודות עפר ויסודות, היתרים, חשמל ואינסטלציה, אלא אם צוין אחרת.',
  'פלדה מגולוונת בחם לפי ת"י 918 / EN ISO 1461; ייצור לפי EN 1090-2.',
  'המחירים אינם כוללים מע"מ אלא אם צוין "כולל מע"מ".',
];

const CAT: [string, string[]][] = [
  ['שלד פלדה מגולוון — ייצור, גלוון וברגים', ['steel', 'plate', 'galv', 'bolts', 'anchors', 'fab']],
  ['הרכבת השלד בשטח', ['erect']],
  ['חיפוי גג', ['roofPanel']],
  ['חיפוי קירות', ['wallPanel']],
  ['פחים, מזחלות ומרזבים', ['flashing', 'gutter', 'downpipe']],
  ['ברגי חיפוי והתקנת חיפוי', ['cscrew', 'cinstall']],
  ['הובלה', ['transport']],
];

export function clientQuoteSheet(p: Project, d: DerivedModel, q: Quote, clad: CladdingTakeoff | null, vatPct: number, terms: string[], company: string): { sheet: Sheet; imageBox: { x: number; y: number; w: number; h: number } } {
  const W = 210, H = 297;
  const sh: Sheet = { size: 'A4', w: W, h: H, ents: [], title: { company, project: p.meta.name, projectNo: p.meta.number, client: p.meta.client, title: 'הצעת מחיר', number: '', rev: '', scale: '', date: '', status: '', drawnBy: '', checkedBy: '', approvedBy: '', note: '' }, scale: 1, mono: true };
  const E = sh.ents;
  const T = (x: number, y: number, s: string, h = 3, align: 'left' | 'center' | 'right' = 'right', bold = false) => E.push({ k: 'text', p: { x, y }, s, h, align, layer: 'TEXT', bold });
  const L = (x0: number, y0: number, x1: number, y1: number, layer: 'THIN' | 'TITLE' | 'FRAME' = 'THIN') => E.push({ k: 'line', a: { x: x0, y: y0 }, b: { x: x1, y: y1 }, layer });
  const R = 190, Lm = 20;
  const today = new Date().toLocaleDateString('he-IL');
  // כותרת
  T(R, 280, company, 7, 'right', true);
  T(Lm, 281, 'KAYAN STEEL PRO', 2.6, 'left');
  L(Lm, 275, R, 275, 'FRAME');
  T(R, 266, `הצעת מחיר${p.meta.number ? ` מס' ${p.meta.number}` : ''}`, 5.5, 'right', true);
  T(Lm, 266, `תאריך: ${today}`, 3.2, 'left');
  T(R, 258, `לכבוד: ${p.meta.client || '—'}`, 3.6);
  T(R, 252, `הנדון: ${p.meta.name}`, 3.6, 'right', true);
  // תמונה
  const imageBox = { x: Lm, y: 192, w: R - Lm, h: 54 };
  E.push({ k: 'poly', pts: [{ x: imageBox.x, y: imageBox.y }, { x: imageBox.x + imageBox.w, y: imageBox.y }, { x: imageBox.x + imageBox.w, y: imageBox.y + imageBox.h }, { x: imageBox.x, y: imageBox.y + imageBox.h }], closed: true, layer: 'THIN' });
  // מפרט
  const b = p.building, xs = (d.section?.lines ?? []).map((l) => l.x), width = xs.length ? Math.max(...xs) - Math.min(...xs) : b.width;
  const fr = [...b.frames].sort((a1, a2) => a1.y - a2.y), len = fr.length ? fr[fr.length - 1].y - fr[0].y : 0;
  const zs = d.members.filter((m) => m.kind === 'column').map((m) => Math.max(m.start.z, m.end.z)), eave = zs.length ? Math.min(...zs) - b.baseElevation : 0;
  const top = Math.max(...(d.section?.planes ?? []).flatMap((pl) => [pl.a.z, pl.b.z]), eave) - b.baseElevation;
  const m = (x: number) => (x / 1000).toFixed(2);
  const spec = [
    `מידות: רוחב ${m(width)} מ' × אורך ${m(len)} מ' · גובה מרזב ${m(eave)} מ' · גובה רכס ${m(top)} מ' · ${fr.length} מסגרות`,
    `שלד: עמודים ${b.columnProfile}, קורות גג ${b.rafterProfile}, פטות ${b.purlins.left.profile}, קושרות גג וקירות`,
    `משקל פלדה משוער: ${(q.netKg / 1000).toFixed(2)} טון, מגולוון בחם; חיבורי שטח בברגים בלבד`,
    ...(clad ? [`חיפוי: גג ${clad.roofArea.toFixed(0)} מ"ר${b.cladding?.roof.panel ? ` — ${b.cladding.roof.panel}` : ''} · קירות ${clad.wallArea.toFixed(0)} מ"ר${b.cladding?.walls.panel ? ` — ${b.cladding.walls.panel}` : ''}`,
      `מזחלות ${(clad.gutters.reduce((a1, g) => a1 + g.length, 0) / 1000).toFixed(0)} מ' · מרזבים ${clad.gutters.reduce((a1, g) => a1 + g.downpipes, 0)} · פתחים ${b.cladding?.openings.length ?? 0}`] : []),
  ];
  let y = 185;
  T(R, y, 'תיאור העבודה', 3.6, 'right', true); y -= 6;
  for (const s of spec) { T(R, y, `• ${s}`, 2.9); y -= 4.8; }
  // טבלת מחירים
  y -= 4;
  const factor = q.subtotal > 0 ? q.beforeVat / q.subtotal : 1;
  const rows = CAT.map(([name, keys]) => [name, q.lines.filter((l) => keys.includes(l.key)).reduce((a1, l) => a1 + l.total, 0) * factor] as [string, number]).filter(([, v]) => v > 0.5);
  const money = (v: number) => `${Math.round(v).toLocaleString('en-US')} ש"ח`;
  const rowH = 6.4, tx0 = Lm, tx1 = R, xc = Lm + 45;
  L(tx0, y, tx1, y, 'TITLE'); T(R - 2, y - 5, 'סעיף', 3.2, 'right', true); T(Lm + 2, y - 5, 'סכום', 3.2, 'left', true); y -= rowH; L(tx0, y, tx1, y, 'TITLE');
  const top0 = y + rowH;
  for (const [name, v] of rows) { T(R - 2, y - 5, name, 3.1); T(Lm + 2, y - 5, money(v), 3.1, 'left'); y -= rowH; L(tx0, y, tx1, y); }
  const vat = q.beforeVat * vatPct / 100;
  for (const [name, v, bold] of [['סה"כ לפני מע"מ', q.beforeVat, true], [`מע"מ ${vatPct}%`, vat, false], ['סה"כ כולל מע"מ', q.beforeVat + vat, true]] as [string, number, boolean][]) {
    T(R - 2, y - 5, name, 3.3, 'right', bold); T(Lm + 2, y - 5, money(v), 3.3, 'left', bold); y -= rowH; L(tx0, y, tx1, y, bold ? 'TITLE' : 'THIN');
  }
  E.push({ k: 'poly', pts: [{ x: tx0, y: top0 }, { x: tx1, y: top0 }, { x: tx1, y }, { x: tx0, y }], closed: true, layer: 'TITLE' });
  L(xc, top0, xc, y);
  // תנאים
  y -= 7;
  T(R, y, 'תנאים והערות', 3.4, 'right', true); y -= 5;
  for (const t of terms.filter(Boolean)) { if (y < 38) break; T(R, y, `• ${t}`, 2.7); y -= 4.4; }
  // חתימות
  L(R - 60, 30, R, 30); T(R, 25, `בכבוד רב, ${company}`, 2.9);
  L(Lm, 30, Lm + 60, 30); T(Lm + 60, 25, 'אישור הלקוח — שם, חתימה ותאריך', 2.9);
  T(W / 2, 12, 'הצעה זו הופקה ב-KAYAN STEEL PRO · הכמויות נגזרות מהמודל · אינה מהווה תכן הנדסי', 2.2, 'center');
  return { sheet: sh, imageBox };
}
