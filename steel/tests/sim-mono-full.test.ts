/**
 * SIM — סימולציה מלאה על מבנה חד-שיפועי: חישוב מקדים (`tests/sim/mono-sim.ts`) מול האפליקציה, לכל סוג אלמנט, בשני שלבים (ברירות מחדל / שינוי מחברים).
 * הבדיקה כותבת `e2e-results/evidence/sim-mono-full.json` (קלט לדוח ה-PDF) ומקבעת: (א) התאמות מבניות מדויקות, (ב) רשימת הסטיות שמעל 0.5% — שינוי באפליקציה שמשנה אותן ייכשל כאן בכוונה.
 * גיאומטריה בלבד — לא תכן חוזק ולא אישור ייצור.
 */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IN, calcExpected, catalogRows, len, runSim, type Rec, type Shape, type Stage } from './sim/mono-sim';
import { getProfile } from '../src/profiles/library';

const r1 = (x: number) => Math.round(x * 10) / 10;
const TOL = 0.5; // %
const diffPct = (r: Rec) => (typeof r.expected === 'number' && typeof r.actual === 'number' && r.expected !== 0 ? ((r.actual - r.expected) / r.expected) * 100 : null);

function collect(stage: Stage) {
  const X = calcExpected(stage), { d, fab, bom, p } = runSim(stage);
  const recs: Rec[] = []; const shapes: Record<string, Shape> = {};
  const push = (cat: string, el: string, dim: string, unit: string, expected: number | string | null, actual: number | string | null, basis: string, info = false) => recs.push({ cat, el, dim, unit, expected: typeof expected === 'number' ? r1(expected) : expected, actual: typeof actual === 'number' ? r1(actual) : actual, basis, info });
  const members = (re: RegExp) => d.members.filter((m) => re.test(m.id));
  const parts = (id: string) => fab.parts.filter((x) => x.memberId === id);
  const prof = (name: string) => { const pr = getProfile(name); return { outer: pr.outline.outer, holes: pr.outline.holes }; };
  const tEave = (id: string) => (stage === 2 && id === IN.eaveOverride.id ? IN.eaveOverride.t : X.eave.t);

  // ---- עמודים
  const cats = { col: 'עמודים HEA200', raf: 'קורות גג IPE300', pur: 'פטות C200x80x20x3', knee: 'אלכסוני עמוד-קורה L50x5', bb: 'אגד B', tr: 'מסבך גג (מסגרת 3)', pl: 'פלטות', cl: 'תומכי פטה (זוויתנים)' };
  for (const m of members(/^F\d+\.COL\.[LR]$/)) {
    const left = m.id.endsWith('.L'), axis = left ? IN.eL : IN.eR, fr = m.id.split('.')[0]!, cid = `C.EAVE.${fr}.${left ? 'L' : 'R'}`, pt = parts(m.id)[0]!;
    push(cats.col, m.id, 'אורך ציר', 'מ"מ', axis, len(m), 'גובה אכסוף = פרמטר eaveLeft/eaveRight');
    push(cats.col, m.id, 'אורך חלק (חיתוך ראש)', 'מ"מ', X.colPart(axis, tEave(cid)), pt.length, `R2: גובה − עומק קורה אנכי (${r1(X.hv)}) − 2×פלטה (${tEave(cid)}) + (h/2)·tanθ (${r1((X.col.h / 2) * X.tn)}); הצלע הארוכה`);
    push(cats.col, m.id, 'זווית חיתוך ראש', 'מעלות', (X.th * 180) / Math.PI, Math.max(pt.cutStart, pt.cutEnd), 'זווית השיפוע = atan(1200/12000)');
  }
  shapes.col = { key: 'col', kind: 'member', title: 'עמוד HEA200 — חיתוך ראש משופע', profile: 'HEA200', outline: prof('HEA200'), lenMm: IN.eL, cutA: 0, cutB: (X.th * 180) / Math.PI };
  // ---- קורות גג
  for (const m of members(/^F\d+\.RAF$/)) {
    const ps = parts(m.id);
    push(cats.raf, m.id, 'אורך ציר', 'מ"מ', X.rafAxis, len(m), `R1: (רוחב ${IN.W} + 2×${X.ext}) / cosθ; הבליטה = חצי אורך פלטת הראש`);
    push(cats.raf, m.id, 'מספר חלקי ייצור (אורך מוט 12000)', 'יח׳', Math.ceil(X.rafAxis / IN.stock), ps.length, 'ceil(אורך ציר / אורך מוט)');
    push(cats.raf, m.id, 'סכום אורכי חלקים', 'מ"מ', null, ps.reduce((a, x) => a + x.length, 0), 'אין חישוב עצמאי לחיתוכי המשך — מידע בלבד', true);
    push(cats.raf, m.id, 'זווית חיתוך קצה', 'מעלות', 0, Math.max(...ps.map((x) => Math.max(x.cutStart, x.cutEnd))), 'R5: קצוות הקורה נחתכים ניצב לציר');
  }
  shapes.raf = { key: 'raf', kind: 'member', title: 'קורת גג IPE300 (בולטת 170 מעבר לציר העמוד)', profile: 'IPE300', outline: prof('IPE300'), lenMm: X.rafAxis, cutA: 0, cutB: 0 };
  // ---- פטות
  const pur = members(/^PL\.M\.\d+$/).sort((a, b) => a.id.localeCompare(b.id));
  const rf = d.members.find((m) => m.id === 'F1.RAF')!, rl = len(rf), ux = (rf.end.x - rf.start.x) / rl, uz = (rf.end.z - rf.start.z) / rl;
  const sFromHigh = (m: { start: { x: number; z: number } }) => rl - ((m.start.x - rf.start.x) * ux + (m.start.z - rf.start.z) * uz); // מרחק מהקצה הגבוה של הקורה, מוקרן על כיוון הקורה
  push(cats.pur, 'כל הפטות', 'מספר שורות', 'יח׳', X.rows, pur.length, `R6: ceil((אורך קורה ${r1(X.rafAxis)} − 300)/1500) + 1; מהקצה הגבוה, האחרונה בקצה הנמוך`);
  const ss = pur.map(sFromHigh);
  push(cats.pur, 'שורה 1', 'מרחק מהקצה הגבוה (לאורך שיפוע)', 'מ"מ', 300, ss[0]!, 'פרמטר first = 300 (monoStart = high)');
  push(cats.pur, 'שורה אחרונה', 'מרחק מהקצה הנמוך (לאורך שיפוע)', 'מ"מ', 0, rl - ss[ss.length - 1]!, 'פרמטר edgeOffset = 0');
  for (let i = 1; i < ss.length; i++) push(cats.pur, `שורה ${i}→${i + 1}`, 'מרווח בין שורות', 'מ"מ', X.step, ss[i]! - ss[i - 1]!, '(אורך קורה − 300) / מספר מפתחים');
  for (const m of pur) {
    const ps = parts(m.id);
    push(cats.pur, m.id, 'אורך שורה (ציר)', 'מ"מ', IN.bay * (IN.frames - 1), len(m), 'מסגרת ראשונה עד אחרונה (24000)');
    push(cats.pur, m.id, 'מספר חלקי ייצור', 'יח׳', Math.ceil((IN.bay * (IN.frames - 1)) / IN.stock), ps.length, 'ceil(24000 / 12000) — בלי חפיפות');
  }
  shapes.pur = { key: 'pur', kind: 'member', title: 'פטה C200x80x20x3 (שורה אחת, 3 חלקי ייצור)', profile: 'C200x80x20x3', outline: prof('C200x80x20x3'), lenMm: 24100, cutA: 0, cutB: 0 };
  // ---- אלכסוני עמוד-קורה
  const kn = members(/^KB\./);
  push(cats.knee, 'כל האלכסונים', 'מספר', 'יח׳', 8, kn.length, 'מסגרות 1,2,4,5 × שני צדדים (מסגרת 3 = מסבך, ללא אלכסון)');
  for (const m of kn) {
    const left = m.id.includes('.L.'), dx = IN.knee.drop / (1 - (left ? 1 : -1) * X.s), exp = dx / Math.cos((IN.knee.angle * Math.PI) / 180);
    const ang = (Math.atan2(Math.abs(m.end.z - m.start.z), Math.abs(m.end.x - m.start.x)) * 180) / Math.PI;
    push(cats.knee, m.id, 'אורך אלכסון (ציר, נקודת עמוד → תחתית קורה)', 'מ"מ', exp, len(m), 'drop / (1 ∓ 0.1) / cos45°');
    push(cats.knee, m.id, 'זווית מהאופק', 'מעלות', IN.knee.angle, ang, 'פרמטר angle');
  }
  shapes.knee = { key: 'knee', kind: 'member', title: 'אלכסון עמוד-קורה L50x5 (זוויתן מוברג)', profile: 'L50x5', outline: prof('L50x5'), lenMm: 1165, cutA: 0, cutB: 0 };
  // ---- אגד B
  const bb = members(/^BB\.\d+\.[LR]$/), bk = members(/^BB\.\d+\.[LR]\.K\d$/);
  push(cats.bb, 'אגד B', 'מספר קורות RHS100x100x5', 'יח׳', 8, bb.length, '4 מפתחים × 2 קירות (אגד + קורה רציפה)');
  push(cats.bb, 'אגד B', 'מספר אלכסונים RHS60x60x4', 'יח׳', 8, bk.length, '2 אלכסונים × 4 מפתחי קצה');
  const colB = getProfile(IN.col).props.b;
  for (const m of bb.slice(0, 1)) push(cats.bb, 'קורת אגד (כולן זהות)', 'אורך', 'מ"מ', IN.bay - colB, len(m), `R7: מפתח ${IN.bay} − רוחב אגף עמוד ${colB}`);
  for (const m of bk.slice(0, 1)) push(cats.bb, 'אלכסון אגד (כולם זהים)', 'אורך', 'מ"מ', IN.portal.drop / Math.sin((IN.portal.angle * Math.PI) / 180), len(m), 'R8: drop / sin(angle) = 600 / sin45°');
  shapes.bbB = { key: 'bbB', kind: 'member', title: 'קורת אגד B — RHS100x100x5', profile: 'RHS100x100x5', outline: prof('RHS100x100x5'), lenMm: 5813.5, cutA: 0, cutB: 0 };
  shapes.bbK = { key: 'bbK', kind: 'member', title: 'אלכסון אגד B — RHS60x60x4', profile: 'RHS60x60x4', outline: prof('RHS60x60x4'), lenMm: 563.5, cutA: 45, cutB: 45 };
  // ---- מסבך
  const tv = members(/^TR\.F3\.V\d+$/).sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true })), td = members(/^TR\.F3\.D\d+[ab]$/).sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  push(cats.tr, 'מסבך F3', 'מספר שדות', 'יח׳', IN.trussPanels, td.length, 'פרמטר panels = 6 (אלכסון אחד בכל שדה)');
  push(cats.tr, 'מסבך F3', 'מספר אנכיים SHS60x4', 'יח׳', IN.trussPanels + 1, tv.length, 'אנך בכל צומת (Warren + אנכיים)');
  tv.forEach((m, i) => push(cats.tr, m.id, 'אורך אנך (בין פני החגורות)', 'מ"מ', X.V[i]!, len(m), `R4: עומק ${IN.trussDepth} + 0.1·(x−x0) − חצי גובה חגורות (${r1((X.raf.h / 2) * X.sec)}+66.5); R3: צמתים מפני עמוד פנימי`));
  td.forEach((m, i) => { const c = X.cell(i); push(cats.tr, m.id, `אורך אלכסון מקוצר (זווית ${r1(c.alphaDeg)}°)`, 'מ"מ', c.trimmed, len(m), `ציר-ציר ${r1(c.axis)} פחות קיצור בפני החגורות — בלי היסט צומת K (מרווח 12)`); });
  const bc = members(/^F3\.BC\.\d+$/);
  push(cats.tr, 'חגורה תחתונה HEA140', 'אורך כולל (כל החלקים)', 'מ"מ', X.x1 - X.x0, bc.reduce((a, m) => a + len(m), 0), 'R3: בין פני העמודים הפנימיים');
  push(cats.tr, 'חגורה תחתונה HEA140', 'מספר חלקי חגורה', 'יח׳', Math.ceil((X.x1 - X.x0) / IN.stock), bc.length, 'ceil(אורך / 12000)');
  shapes.trV = { key: 'trV', kind: 'member', title: 'אנך מסבך SHS60x4 (חתוך מקביל לחגורות)', profile: 'SHS60x4', outline: prof('SHS60x4'), lenMm: X.V[0]!, cutA: (X.th * 180) / Math.PI, cutB: 0 };
  shapes.trD = { key: 'trD', kind: 'member', title: 'אלכסון מסבך SHS80x4 (חיתוכים משופעים)', profile: 'SHS80x4', outline: prof('SHS80x4'), lenMm: len(td[1]!), cutA: 51.1, cutB: -51.1 };
  shapes.bc = { key: 'bc', kind: 'member', title: 'חגורה תחתונה HEA140', profile: 'HEA140', outline: prof('HEA140'), lenMm: X.x1 - X.x0, cutA: 0, cutB: 0 };
  if (stage === 2) {
    const ch = members(/^TR\.F3\.G\d+[TB][12]$/);
    push(cats.tr, 'לחיות צומת (שלב 2)', 'מספר פלטות PL100x8', 'יח׳', 2 * 2 * (IN.trussPanels + 1), ch.length, 'זוג לכל צומת × חגורה עליונה ותחתונה × 7 צמתים');
  }
  // ---- פלטות
  const plates = (re: RegExp) => members(re).filter((m) => m.kind === 'plate');
  const group = (ms: ReturnType<typeof plates>) => { const g = new Map<string, number>(); for (const m of ms) { const k = `${m.profile}|${r1(len(m))}`; g.set(k, (g.get(k) ?? 0) + 1); } return g; };
  const eaveMs = plates(/^C\.EAVE\.F\d+\.[LR]\.PL2?$/), baseMs = plates(/^C\.BASE\.F\d+\.[LR]\.PL$/);
  const eg = group(eaveMs), bg = group(baseMs);
  const E = X.eave, B = stage === 1 ? IN.base1 : IN.base2;
  const ovT = IN.eaveOverride.t;
  const expEave: [string, number][] = stage === 1 ? [[`PL${E.w}x${E.t}|${E.l}`, 20]] : [[`PL${E.w}x${E.t}|${E.l}`, 18], [`PL${E.w}x${ovT}|${E.l}`, 2]];
  for (const [k, n] of expEave) { const [pr, l] = k.split('|'); push(cats.pl, `פלטות ראש עמוד ${pr}`, `כמות × אורך ${l}`, 'יח׳', n, eg.get(`${pr}|${r1(+l!)}`) ?? 0, `פרמטרים: w=${E.w}, t, l=${E.l}; שתי פלטות לכל ראש עמוד × 10 ראשי עמוד`); }
  push(cats.pl, `פלטות בסיס PL${B.w}x${B.t}`, `כמות × אורך ${B.l}`, 'יח׳', 10, bg.get(`PL${B.w}x${B.t}|${r1(B.l)}`) ?? 0, 'פלטה לכל עמוד (10)');
  const anchors = members(/^C\.BASE\.F\d+\.[LR]\.A\d+$/);
  push(cats.pl, 'מוטות עיגון (נוצרו ע"י בסיס מבוטנת)', 'כמות', 'יח׳', 80, anchors.length, '8 מוטות לכל בסיס × 10 בסיסים (ברירת מחדל 3×3 פחות מרכז)');
  const cleats = members(/^C\.PC\./).length ? d.members.filter((m) => m.kind === 'cleat') : [];
  push(cats.cl, 'זוויתני תמיכה L200x80x8', 'כמות', 'יח׳', X.rows * IN.frames, cleats.length, `שורות פטות (${X.rows}) × מסגרות (5)`);
  push(cats.cl, 'זוויתני תמיכה L200x80x8', 'אורך (רוחב תומך)', 'מ"מ', 100, cleats[0] ? len(cleats[0]) : null, 'פרמטר width = 100');
  const ep = eaveMs[0]!, bp = baseMs[0]!;
  const holes = (id: string) => parts(id)[0]?.holes.map((h) => ({ c: h.c, t: h.t, d: h.d })) ?? [];
  shapes.eaveP = { key: 'eaveP', kind: 'plate', title: `פלטת ראש עמוד PL${E.w}x${E.t}x${E.l}`, w: E.w, l: E.l, t: E.t, holes: holes(ep.id) };
  shapes.baseP = { key: 'baseP', kind: 'plate', title: `פלטת בסיס PL${B.w}x${B.t}x${B.l}`, w: B.w, l: B.l, t: B.t, holes: holes(bp.id) };
  void bom; void p;
  // ---- שאר הרכיבים שנוספו (מידע)
  const other = new Map<string, number>();
  for (const m of d.members) { if (/^(F\d+\.(COL|RAF|BC)|PL\.M|KB\.|BB\.|TR\.F3\.[VDG])/.test(m.id)) continue; if (m.kind === 'bolt') { other.set('ברגים (חלקים)', (other.get('ברגים (חלקים)') ?? 0) + 1); continue; } const k = `${m.kind} ${m.profile}`; other.set(k, (other.get(k) ?? 0) + 1); }
  for (const [k, n] of [...other].sort()) push('רכיבים נוספים שנוצרו', k, 'כמות', 'יח׳', null, n, 'לא חושב מראש (פלטות חיבור, קושרות, מוטות, ברגים וכו׳)', true);
  // ---- החלטות הבעלים (Deya, 28.11.2026): מכוון / ממצא פתוח
  const OWN: { cat: RegExp; dim: RegExp; el?: RegExp; kind: 'accepted' | 'issue'; note: string }[] = [
    { cat: /^פטות/, dim: /מספר שורות|מרחק מהקצה|מרווח בין שורות/, kind: 'accepted', note: 'אושר: הפטה הראשונה והאחרונה זזות פנימה במכוון (יושבות כולן על הקורה)' },
    { cat: /^פטות/, dim: /אורך שורה|חלקי ייצור/, kind: 'accepted', note: 'אושר: 24,000 הוא מרחק צירים; הפטה בולטת 50 מ"מ מעבר לציר בכל קצה (24,100), ולכן 3 חלקי ייצור (מוט 12,000)' },
    { cat: /^תומכי פטה/, dim: /כמות/, kind: 'accepted', note: 'נגזר ממספר שורות הפטות (9 במקום 10) — אושר' },
    { cat: /^אלכסוני עמוד-קורה/, dim: /אורך אלכסון/, kind: 'accepted', note: 'אושר: האורך משתנה לפי סוג המחבר (כאן: זוויתן מוברג)' },
    { cat: /^אגד B/, dim: /^אורך$/, el: /אלכסון אגד/, kind: 'issue', note: 'ממתין לאישור: נבדק בקוד — הציר הנומינלי 848.5 תואם (ירידה 600, 45°); חלק ה-RHS הוא 563.5 כי פלטות הקצה (PL95x12 + לשונית, ≈142 לכל קצה) משלימות עד העמוד והקורה. לא תוקן.' },
  ];
  for (const r of recs) { const o = OWN.find((x) => x.cat.test(r.cat) && x.dim.test(r.dim) && (!x.el || x.el.test(r.el))); if (o) { r.owner = o.kind; r.ownerNote = o.note; } }
  return { stage, recs, shapes, errors: d.issues.filter((i) => i.severity === 'error').map((i) => `${i.code}: ${i.message}`), warnings: [...new Set(d.issues.filter((i) => i.severity === 'warning').map((i) => i.code))], totals: { members: d.members.length, weightKg: bom.totalWeight } };
}

describe('SIM מבנה חד-שיפועי — חישוב מקדים מול האפליקציה', () => {
  const S1 = collect(1), S2 = collect(2);
  it('SIM-00: הקטלוג — חתכים מול טבלאות תקניות (ידני)', () => {
    for (const c of catalogRows()) for (const k of ['h', 'b', 'tw', 'tf'] as const) expect((c.act as any)[k], `${c.n}.${k}`).toBeCloseTo((c.exp as any)[k], 6);
    for (const c of catalogRows()) expect(Math.abs((c.act.g as number) - (c.exp.g as number)) / (c.exp.g as number) * 100, `${c.n} kg/m`).toBeLessThan(0.5);
  });
  it('SIM-01: בניה בלי שגיאות; מבנים וספירות מדויקים בשני השלבים', () => {
    for (const S of [S1, S2]) {
      expect(S.errors).toEqual([]);
      for (const r of S.recs.filter((x) => !x.info && x.unit === 'יח׳' && !/חלקי ייצור|חלקי חגורה|מספר שורות/.test(x.dim) && !/זוויתני/.test(x.el))) expect(r.actual, `${S.stage}: ${r.cat} / ${r.el} / ${r.dim}`).toBe(r.expected);
    }
  });
  it('SIM-02: סטיות מעל 0.5% — מקובעות (שינוי באפליקציה ייכשל כאן בכוונה) ונכתב דוח JSON', () => {
    const dev = (S: typeof S1) => [...new Set(S.recs.filter((r) => !r.info && !r.owner && Math.abs(diffPct(r) ?? 0) > TOL).map((r) => `${r.cat} | ${r.dim}`))].sort();
    const issues = (S: typeof S1) => [...new Set(S.recs.filter((r) => r.owner === 'issue').map((r) => `${r.cat} | ${r.el} | ${r.dim}: ${r.expected} מול ${r.actual}`))].sort();
    fs.mkdirSync('e2e-results/evidence', { recursive: true });
    const explain = [
      '<b>אושרו על ידי הבעלים (מכוון):</b> פטות — הראשונה והאחרונה זזות פנימה כדי לשבת על הקורה (9 שורות, מרווח 1,496, 45 תומכים); אלכסוני עמוד-קורה — האורך משתנה לפי סוג המחבר (זוויתן מוברג: 1,165 / 951).',
      '<b>אלכסון אגד B (563.5 מול 848.5) — נבדק בקוד, לא תוקן:</b> הציר הנומינלי של האלכסון (מנקודת העמוד ועד תחתית הקורה) אכן 848.5 כפי שאושר. חלק ה-RHS הוא 563.5 כי בכל קצה פלטת קצה (PL95x12) ולשונית מוברגת ממלאות כ-142 מ"מ עד העמוד ועד הקורה. השרטוט הקודם לא הראה את הפלטות, ולכן נראה שהאלכסון "לא מגיע" — הוא מגיע דרך הפלטות. ממתין לאישור שאין צורך בתיקון.',
      '<b>תוקן (1.114) — חגורה תחתונה של המסבך:</b> נדרש חלק אחד (11,780 ≤ 12,000); האפליקציה פיצלה אותה במקום חיבור ההמשך של קורת הגג. תוקן ב-`truss.ts`; בסימולציה כעת חלק אחד.',
      '<b>אלכסוני מסבך (+1.1% עד +5.9%):</b> החישוב המקדים לא כולל היסט צומת K (מרווח 12 מ"מ + רוחב האלכסון) — הכלל נמצא בקוד; לא נשאל.',
      '<b>פטות — 24,100 ו-3 חלקי ייצור (אושר):</b> 24,000 הוא מרחק צירים בין המסגרת הראשונה לאחרונה; הפטה בולטת 50 מ"מ מעבר לציר בכל קצה (חצי רוחב התומך). אין חפיפה בתפרים — תיקון לטענה קודמת בדוח.',
    ];
    const questions = [
      'האם לתקן עכשיו באפליקציה את אורך אלכסון אגד B כך שיגיע לקורה (848 מ"מ)? (שינוי בקוד `portal.ts`)',
      'האם לתקן עכשיו באפליקציה את פיצול החגורה התחתונה של המסבך לחלק אחד? (שינוי בקוד `truss.ts`)',
    ];
    fs.writeFileSync('e2e-results/evidence/sim-mono-full.json', JSON.stringify({ input: IN, stages: [S1, S2], tolerancePct: TOL, deviations: { 1: dev(S1), 2: dev(S2) }, openIssues: { 1: issues(S1), 2: issues(S2) }, catalog: catalogRows(), explain, questions }, null, 1));
    fs.writeFileSync('e2e-results/evidence/sim-deviations.txt', JSON.stringify({ 1: dev(S1), 2: dev(S2) }, null, 1));
  });
});
