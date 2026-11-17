import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { computeFabrication } from '../src/fab/marks';
import { computeBom } from '../src/fab/bom';
import { buildSheet, drawingCatalog, sheetHash } from '../src/drawing/views';
import { sheetsToPdf } from '../src/drawing/pdf';
import { sheetToDxf } from '../src/drawing/dxf';
import { sheetToSvg } from '../src/drawing/svg';
import { visualOrder } from '../src/drawing/sheet';
import { numberParts, proposeSplicesFor, setPurlinSide } from '../src/commands/commands';

const OUT = path.resolve('e2e-results/files');
fs.mkdirSync(OUT, { recursive: true });
const font = (n: string) => new Uint8Array(fs.readFileSync(path.resolve(`src/drawing/font/${n}`)));
const fonts = { regular: font('KSPSans.ttf'), bold: font('KSPSans-Bold.ttf') };
const has = (cmd: string) => { try { execSync(`command -v ${cmd}`, { stdio: 'ignore' }); return true; } catch { return false; } };
const PY = '/tmp/claude-0/-home-user-construction-app/1a50a160-0b21-5222-a7ee-30b6297ca40e/scratchpad/venv/bin/python';

function setup() {
  let p = newProject('בדיקת שרטוטים', defaultBuilding());
  p.settings.autoSplice = false;
  p.meta.number = 'K-TEST'; p.meta.designer = 'מתכנן';
  p.building.purlins.left.layout = 'fixed'; p.building.purlins.right.layout = 'fixed'; // השוואה למידות 300/1500 + שארית
  p = proposeSplicesFor(['PL.L.03']).run(p);
  p = numberParts().run(p);
  const d = generate(p);
  const fab = computeFabrication(p, d);
  const bom = computeBom(d, fab);
  return { p, d, fab, bom, cat: drawingCatalog(p, d, fab) };
}

const texts = (sh: ReturnType<typeof buildSheet>) => sh.ents.filter((e) => e.k === 'text').map((e) => (e as any).s as string);

describe('שרטוטים', () => {
  const { p, d, fab, bom, cat } = setup();
  it('קטלוג: GA, תוכנית גג, חתכי מסגרת מקובצים (מסגרות זהות), גיליון חזיתות אחד, 7 פרטי חיבור (כולל המשך פטה ופחי קושרות), מכלולים וחלקים', () => {
    const t = (x: string) => cat.filter((c) => c.type === x).length;
    expect([t('ga'), t('roof-plan'), t('side'), t('connection')]).toEqual([1, 1, 1, 7]);
    // מסגרות: כל ציר מופיע בדיוק בגיליון אחד
    const fr = cat.filter((c) => c.type === 'frame').flatMap((c) => c.refs ?? []);
    expect(fr.sort()).toEqual(p.building.frames.map((f) => f.id).sort());
    expect(t('frame')).toBeLessThan(p.building.frames.length);
    // חלקים: פרופילים — גיליון לכל סימון; פלטות — בגיליונות פלטות משולבים, כל סימון פעם אחת
    const plateMarks = new Set(fab.parts.filter((x) => d.byId.get(x.memberId)?.kind === 'plate').map((x) => x.mark));
    const anchorMarks = new Set(fab.parts.filter((x) => d.byId.get(x.memberId)?.kind === 'anchor').map((x) => x.mark));
    expect(t('part')).toBe(new Set(fab.parts.map((x) => x.mark)).size - plateMarks.size - anchorMarks.size);
    expect(cat.filter((c) => c.type === 'plates').flatMap((c) => c.refs ?? []).sort()).toEqual([...plateMarks].sort());
    expect(t('assembly')).toBe(new Set(fab.assemblies.map((x) => x.mark)).size);
    expect(new Set(cat.map((c) => c.id)).size).toBe(cat.length);
  });
  it('תוכנית גג: מידות נגזרות מהמודל — מרווחי מסגרות 6000, סה"כ 30000, רוחב 18000, פטות 300/1500, שארית מסומנת', () => {
    const sh = buildSheet(cat.find((c) => c.type === 'roof-plan')!, p, d, fab, bom);
    const ts = texts(sh);
    expect(ts.filter((x) => x === '6000').length).toBe(5);
    expect(ts).toContain('30000');
    expect(ts).toContain('18000');
    expect(ts.filter((x) => x === '300').length).toBe(2); // שתי פטות נפרדות ליד הרכס
    // מרווחים צפופים בדף מאוחדים למידה אחת "n×1500"
    const n1500 = ts.filter((x) => x === '1500').length + ts.filter((x) => /^\d+×1500$/.test(x)).reduce((s0, x) => s0 + Number(x.split('×')[0]), 0);
    expect(n1500).toBeGreaterThanOrEqual(10);
    expect(ts.some((x) => /^\d+\*$/.test(x))).toBe(true); // שארית
    expect(sh.size).toBe('A4'); // ברירת מחדל: A4 כשהקנ"מ סביר
    expect(sh.title.scale).toMatch(/^1:\d+$/);
  });
  it('חתך מסגרת: גבהים 6000 ו-6900 מהמודל, רוחב 18000, חתכי פטות ממולאים', () => {
    const sh = buildSheet(cat.find((c) => c.id === 'D-FRAME-F2')!, p, d, fab, bom);
    const ts = texts(sh);
    expect(ts).toContain('6000'); expect(ts).toContain('6900'); expect(ts).toContain('18000');
    expect(sh.ents.filter((e) => e.k === 'poly' && e.fill).length).toBeGreaterThanOrEqual(28); // 14 פטות + 14 זוויתנים
  });
  it('DRAW-01: שרטוט חלק — אורך ומיקומי חורים מהמודל', () => {
    const purl = fab.parts.find((x) => x.memberId === 'PL.L.04')!;
    const sh = buildSheet(cat.find((c) => c.id === `D-PART-${purl.mark}`)!, p, d, fab, bom);
    const ts = texts(sh);
    expect(ts).toContain(String(Math.round(purl.length)));
    expect(purl.holes.length).toBe(17);
    expect(sh.ents.filter((e) => e.k === 'circle' && e.layer === 'HOLE').length).toBe(17);
    // מרחק חור ראשון מקצה הפטה (25 מ"מ = 50 הארכה − 25 חצי מרווח) ומרווח 50 בין שני ברגי התומך
    expect(ts).toContain('25'); expect(ts).toContain('50');
    expect(ts.some((x) => x.includes(`סימון: ${purl.mark}`))).toBe(true);
  });
  it('שרטוט מכלול וחיבור נבנים, חתימה משתנה עם שינוי במודל', () => {
    const a = cat.find((c) => c.type === 'assembly' && c.ref!.startsWith('R'))!;
    const sh = buildSheet(a, p, d, fab, bom);
    expect(texts(sh).some((x) => x.startsWith('מכלול'))).toBe(true);
    const roof = cat.find((c) => c.type === 'roof-plan')!;
    const h1 = sheetHash(buildSheet(roof, p, d, fab, bom));
    const p2 = setPurlinSide('left', { spacing: 1400 }).run(p);
    const d2 = generate(p2); const f2 = computeFabrication(p2, d2);
    const h2 = sheetHash(buildSheet(roof, p2, d2, f2, computeBom(d2, f2)));
    expect(h1).not.toBe(h2);
    expect(sheetHash(buildSheet(roof, p, d, fab, bom))).toBe(h1);
  });
  it('סדר חזותי לעברית ב-PDF/DXF', () => {
    expect(visualOrder('חתך IPE300')).toBe('IPE300 ךתח');
    expect(visualOrder('IPE300')).toBe('IPE300');
    expect(visualOrder('מרווח (1500)')).toBe('(1500) חווריימ'.replace('חווריימ', 'חוורמ'));
  });
  it('PDF תקין: A3, עמוד לכל גיליון, טקסט ומספרים ניתנים לחילוץ', async () => {
    const sheets = cat.filter((c) => ['ga', 'roof-plan', 'frame', 'side', 'connection'].includes(c.type) || c.id === `D-PART-${fab.parts[0].mark}`).map((c) => buildSheet(c, p, d, fab, bom));
    const bytes = await sheetsToPdf(sheets, { title: 'בדיקה' }, fonts);
    const f = path.join(OUT, 'drawings.pdf');
    fs.writeFileSync(f, bytes);
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-');
    if (!has('pdfinfo')) return;
    const info = execSync(`pdfinfo "${f}"`).toString();
    expect(info).toMatch(new RegExp(`Pages:\\s+${sheets.length}`));
    expect(info).toMatch(/Page size:\s+1190\.55 x 841\.89/);
    const txt = execSync(`pdftotext -layout "${f}" -`).toString();
    expect(txt).toContain('KAYAN STEEL PRO');
    expect(txt).toContain('18000');
    expect(txt).toMatch(/[א-ת]/); // עברית מוטמעת
  });
  it('DXF תקין: נפתח ב-ezdxf, שכבות, ישויות, טקסט עברי מפוענח, קנה מידה אמיתי', () => {
    const sh = buildSheet(cat.find((c) => c.id === 'D-FRAME-F2')!, p, d, fab, bom);
    const f = path.join(OUT, 'frame.dxf');
    fs.writeFileSync(f, sheetToDxf(sh), 'latin1');
    fs.writeFileSync(path.join(OUT, 'frame.svg'), sheetToSvg(sh));
    if (!fs.existsSync(PY)) return;
    const out = execSync(`${PY} -c "
import ezdxf,sys,json
doc=ezdxf.readfile(sys.argv[1])
msp=doc.modelspace()
ents=list(msp)
tx=[e.dxf.text for e in msp.query('TEXT')]
from ezdxf.tools.text import plain_text
print(json.dumps({'n':len(ents),'layers':sorted(l.dxf.name for l in doc.layers),'lines':len(msp.query('LINE')),'heb':any('\\\\\\\\U+05' in t or any('\\u0590'<=c<='\\u05ff' for c in t) for t in tx),'ver':doc.dxfversion,'hasdim':'18000' in tx}))
" "${f}"`).toString();
    const r = JSON.parse(out.trim().split('\n').pop()!);
    expect(r.ver).toBe('AC1009');
    expect(r.n).toBeGreaterThan(200);
    expect(r.layers).toEqual(expect.arrayContaining(['OUTLINE', 'DIM', 'AXIS', 'TITLE']));
    expect(r.heb).toBe(true);
    expect(r.hasdim).toBe(true);
  });
});

describe('מספור וחלקים', () => {
  it('MK-01: קושרות גג זהות (גם הפוכות קצה-לקצה) מקבלות סימון אחד', async () => {
    const { numberParts } = await import('../src/commands/commands');
    let p = newProject('x', defaultBuilding()); p = numberParts().run(p);
    const d = generate(p); const fab = computeFabrication(p, d);
    const roof = new Set(fab.parts.filter((x) => x.memberId.startsWith('BR.R')).map((x) => x.mark));
    const wall = new Set(fab.parts.filter((x) => x.memberId.startsWith('BR.W')).map((x) => x.mark));
    expect(roof.size).toBe(1);
    expect(wall.size).toBe(1);
  });
  it('ST-01: מקשח TB עם קיטום פינות — מתאר משושה בגיליון הפלטה', async () => {
    const b = defaultBuilding(); const f = [...b.frames].sort((x, y) => x.y - y.y);
    b.transfers = [{ id: 'T1', lineId: 'L', from: f[1].id, to: f[3].id, removed: [f[2].id], profile: 'IPE600', support: 'A1', seat: 'B1' }];
    const d = generate(newProject('x', b));
    const st = d.members.find((m) => m.id.endsWith('.STR'))!;
    expect(st.snip?.c).toBeGreaterThan(20);
    const { memberSolid } = await import('../src/geometry/solid');
    expect(memberSolid(st).startRing.length).toBe(6);
  });
});
