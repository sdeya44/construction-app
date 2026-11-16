/**
 * חיפוי (בקשת משתמש 16.11.2026: "גם חיפוי קיר, גם חיפוי גג וגם מזחלה"):
 *  · מסגור קירות: פטות קיר (girts) בין המסגרות בקירות הצד, ובין עמודי הקצה/עמודי רוח בקירות הקצה;
 *    עמודי רוח בקירות הקצה עד תחתית קורת הגג; פטות נקטעות בפתחים, ועמודי פתח (משקופים) בצדי כל פתח.
 *  · כתב כמויות חיפוי: פנלי גג וקיר (כמות ואורכים), פחי רכס/פינה/שוליים/בסיס/פתחים, מזחלות ומרזבים, ברגים.
 * גיאומטריה וכמויות בלבד — חיבורי פטות הקיר (תומכים) אינם ממודלים בגרסה זו.
 */
import { add, norm, scale, sub, v3, type Vec3 } from '../core/vec';
import { tryProfile } from '../profiles/library';
import type { BuildingParams, CladdingParams, DerivedModel, Member, OpeningDef, Project, ValidationIssue, WallId } from '../model/types';
import type { NSection } from '../model/section';

export function defaultCladding(): CladdingParams {
  return {
    roof: { enabled: true, panel: 'פנל מבודד 50 מ"מ', cover: 1000, eaveExt: 100 },
    walls: { enabled: true, sides: { L: true, R: true, F: true, B: true }, panel: 'פנל קיר 40 מ"מ', cover: 1000, bottom: 0 },
    girts: { enabled: true, profile: 'C150x50x20x2.5', first: 300, spacing: 1500 },
    posts: { enabled: true, profile: 'IPE180', maxSpacing: 6000 },
    jambProfile: 'RHS100x100x4',
    openings: [],
    gutter: { enabled: true, downpipeSpacing: 12000 },
    roofScrewsPerM2: 6, wallScrewsPerM2: 4,
  };
}
export const WALL_HE: Record<WallId, string> = { L: 'קיר צד שמאל (ציר א)', R: 'קיר צד ימין', F: 'קיר קצה קדמי', B: 'קיר קצה אחורי' };

const Z = v3(0, 0, 1);

/** גובה פני העליון של מישור הגג (קו הייחוס) ב-x, ומישור מתאים */
function roofAt(sec: NSection, x: number): number | null {
  let best: number | null = null;
  for (const pl of sec.planes) {
    const x0 = Math.min(pl.a.x, pl.b.x), x1 = Math.max(pl.a.x, pl.b.x);
    if (x < x0 - 1 || x > x1 + 1 || x1 - x0 < 1) continue;
    const z = pl.a.z + ((pl.b.z - pl.a.z) * (x - pl.a.x)) / (pl.b.x - pl.a.x);
    if (best === null || z > best) best = z;
  }
  return best;
}

interface Support { x: number; top: number; depth: number }

export function buildWallFraming(_project: Project, b: BuildingParams, sec: NSection, members: Member[]): { members: Member[]; issues: ValidationIssue[] } {
  const out: Member[] = [], issues: ValidationIssue[] = [];
  const cl = b.cladding;
  if (!cl || !cl.walls.enabled) return { members: out, issues };
  const base = b.baseElevation;
  const fr = [...b.frames].sort((a1, a2) => a1.y - a2.y);
  if (fr.length < 2 || !sec.lines.length) return { members: out, issues };
  const lines = [...sec.lines].sort((a1, a2) => a1.x - a2.x);
  const colOf = (lineId: string, frameId: string) => members.find((m) => m.kind === 'column' && m.lineId === lineId && m.frameId === frameId)
    ?? members.find((m) => m.kind === 'column' && m.frameId === frameId && Math.abs(m.start.x - (lines.find((l) => l.id === lineId)?.x ?? 1e9)) < 1);
  const raf = tryProfile(b.rafterProfile);
  const rafDepth = raf?.props.h ?? 300;
  const underRoof = (x: number) => { const z = roofAt(sec, x); return z === null ? null : z - (b.heightRef === 'TOS' ? rafDepth : rafDepth / 2); };
  const gp = cl.girts;
  const levelsTo = (top: number) => {
    const zs: number[] = [];
    for (let z = base + gp.first; z <= top - 120; z += gp.spacing) zs.push(z);
    if (zs.length && top - 150 - zs[zs.length - 1] > gp.spacing * 0.45) zs.push(top - 150);
    return zs;
  };
  const opsOf = (w: WallId) => cl.openings.filter((o) => o.wall === w);
  /** קטעי פטה לאחר הורדת פתחים: [a,b] לאורך הקיר בגובה z */
  const cutByOpenings = (w: WallId, a: number, bEnd: number, z: number, toPos: (t: number) => number): [number, number][] => {
    let segs: [number, number][] = [[a, bEnd]];
    for (const o of opsOf(w)) {
      const z0 = base + o.sill, z1 = z0 + o.height;
      if (z < z0 - 50 || z > z1 + 50) continue;
      const p0 = toPos(o.pos), p1 = toPos(o.pos + o.width);
      const lo = Math.min(p0, p1), hi = Math.max(p0, p1);
      segs = segs.flatMap(([s0, s1]) => (hi <= s0 || lo >= s1 ? [[s0, s1]] : [[s0, Math.max(s0, lo)], [Math.min(s1, hi), s1]]) as [number, number][]).filter(([s0, s1]) => s1 - s0 > 250);
    }
    return segs;
  };
  const gProf = gp.profile, mat = b.material;
  const mk = (id: string, label: string, s: Vec3, e: Vec3, profile: string, refUp: Vec3, anchor: Member['anchor'], wall: Member['wall'], frameId?: string): Member => ({
    id, kind: 'girt', label, start: s, end: e, profile, material: mat, rollDeg: 0, mirror: false, anchor, refUp, source: 'generated', manualPlacement: false, wall, frameId,
  });

  // ---- קירות צד (L/R): פטות בין מסגרות סמוכות, צמודות לפני העמוד החיצוניים
  for (const w of ['L', 'R'] as const) {
    if (!cl.walls.sides[w]) continue;
    const ln = w === 'L' ? lines[0] : lines[lines.length - 1];
    const sgn = w === 'L' ? -1 : 1;
    const cols = fr.map((f) => colOf(ln.id, f.id));
    if (cols.some((c) => !c)) continue;
    const ch = (tryProfile(cols[0]!.profile)?.props.h ?? 200) / 2;
    const xF = ln.x + sgn * ch;
    const eaveZ = Math.min(...cols.map((c) => Math.max(c!.start.z, c!.end.z)));
    const zs = gp.enabled ? levelsTo(eaveZ) : [];
    const y0 = fr[0].y;
    zs.forEach((z, li) => {
      for (let k = 0; k < fr.length - 1; k++) {
        const segs = cutByOpenings(w, fr[k].y, fr[k + 1].y, z, (t) => y0 + t);
        segs.forEach(([a, bb], si) => out.push(mk(`GT.${w}.${String(li + 1).padStart(2, '0')}.${k + 1}${segs.length > 1 ? String.fromCharCode(97 + si) : ''}`, `פטת קיר ${w === 'L' ? 'שמאל' : 'ימין'} ${li + 1} · מפתח ${k + 1}`,
          v3(xF, a, z), v3(xF, bb, z), gProf, v3(sgn, 0, 0), 'purlin', { id: w, role: 'girt', level: li + 1 })));
      }
    });
    // עמודי פתח
    for (const o of opsOf(w)) jambs(o, (t) => v3(xF + sgn * 0, y0 + t, 0), eaveZ, zs, v3(sgn, 0, 0));
  }

  // ---- קירות קצה (F/B): עמודי רוח בין עמודי המסגרת, פטות ביניהם עד קו הגג
  for (const w of ['F', 'B'] as const) {
    if (!cl.walls.sides[w]) continue;
    const f = w === 'F' ? fr[0] : fr[fr.length - 1];
    const sgn = w === 'F' ? -1 : 1;
    const sup: Support[] = [];
    for (const ln of lines) {
      const c = colOf(ln.id, f.id); if (!c) continue;
      sup.push({ x: ln.x, top: Math.max(c.start.z, c.end.z), depth: tryProfile(c.profile)?.props.b ?? 200 });
    }
    if (sup.length < 2) continue;
    // עמודי רוח
    if (cl.posts.enabled) {
      const add2: Support[] = [];
      for (let i = 0; i < sup.length - 1; i++) {
        const gap = sup[i + 1].x - sup[i].x, n = Math.ceil(gap / cl.posts.maxSpacing) - 1;
        for (let k = 1; k <= n; k++) {
          const x = sup[i].x + (gap * k) / (n + 1);
          const top = underRoof(x); if (top === null) continue;
          const pp = tryProfile(cl.posts.profile);
          const id = `WP.${w}.${add2.length + 1}`;
          out.push({ ...mk(id, `עמוד רוח ${w === 'F' ? 'קדמי' : 'אחורי'} ${add2.length + 1}`, v3(x, f.y, base), v3(x, f.y, top - 10), cl.posts.profile, v3(0, 1, 0), 'center', { id: w, role: 'post' }, f.id), refUp: v3(1, 0, 0) });
          add2.push({ x, top: top - 10, depth: pp?.props.b ?? 100 });
        }
      }
      sup.push(...add2); sup.sort((a1, a2) => a1.x - a2.x);
    }
    const yF = f.y + sgn * (Math.max(...sup.map((q) => q.depth)) / 2);
    const xL = lines[0].x;
    const topMax = Math.max(...sup.map((q) => q.top));
    const zs = gp.enabled ? levelsTo(topMax) : [];
    zs.forEach((z, li) => {
      for (let i = 0; i < sup.length - 1; i++) {
        const A = sup[i], B = sup[i + 1];
        // הפטה חייבת להישען על שני התומכים ולהישאר מתחת לגג לכל אורכה
        const rA = underRoof(A.x), rB = underRoof(B.x);
        if (z > Math.min(A.top, B.top) - 100 || (rA !== null && z > rA - 150) || (rB !== null && z > rB - 150)) continue;
        const segs = cutByOpenings(w, A.x, B.x, z, (t) => xL + t);
        segs.forEach(([a, bb], si) => out.push(mk(`GT.${w}.${String(li + 1).padStart(2, '0')}.${i + 1}${segs.length > 1 ? String.fromCharCode(97 + si) : ''}`, `פטת קיר ${w === 'F' ? 'קדמי' : 'אחורי'} ${li + 1} · שדה ${i + 1}`,
          v3(a, yF, z), v3(bb, yF, z), gProf, v3(0, sgn, 0), 'purlin', { id: w, role: 'girt', level: li + 1 })));
      }
    });
    for (const o of opsOf(w)) jambs(o, (t) => v3(xL + t, yF, 0), Math.min(...sup.map((q) => q.top)), zs, v3(0, sgn, 0));
  }

  function jambs(o: OpeningDef, at: (t: number) => Vec3, topZ: number, zs: number[], n: Vec3) {
    const zTop = base + o.sill + o.height;
    const above = zs.find((z) => z > zTop + 50) ?? topZ;
    if (zTop > topZ - 100) issues.push({ code: 'OPENING_HIGH', severity: 'warning', message: `פתח ${o.label ?? o.id}: גבוה מקו הקיר` });
    for (const [k, t] of [[1, o.pos], [2, o.pos + o.width]] as const) {
      const p = at(t);
      out.push({ ...mk(`JB.${o.id}.${k}`, `עמוד פתח ${o.label ?? o.id} ${k === 1 ? 'ימין' : 'שמאל'}`, v3(p.x, p.y, base), v3(p.x, p.y, above), cl!.jambProfile, n, 'center', { id: o.wall, role: 'jamb' }), refUp: norm(add(n, scale(Z, 0))) });
    }
    if (o.sill > 0) {
      // אדן תחתון לחלון
      const pa = at(o.pos), pb = at(o.pos + o.width);
      out.push(mk(`JB.${o.id}.S`, `אדן פתח ${o.label ?? o.id}`, v3(pa.x, pa.y, base + o.sill), v3(pb.x, pb.y, base + o.sill), gProf, n, 'purlin', { id: o.wall, role: 'jamb' }));
    }
  }
  void sub;
  if (out.length) issues.push({ code: 'GIRT_CONN', severity: 'info', message: `מסגור קירות: ${out.filter((m) => m.wall?.role === 'girt').length} פטות קיר, ${out.filter((m) => m.wall?.role === 'post').length} עמודי רוח — התומכים והברגים של פטות הקיר אינם ממודלים; פרט לפי סטנדרט המסגריה` });
  return { members: out, issues };
}

// ------------------------------------------------------------------ כתב כמויות חיפוי
export interface SheetRow { where: string; panel: string; count: number; length: number }
export interface CladdingTakeoff {
  roofArea: number; wallArea: number; openingArea: number;
  roofSheets: SheetRow[]; wallSheets: SheetRow[];
  flashings: { name: string; length: number }[];
  gutters: { name: string; length: number; downpipes: number }[];
  screws: number;
  /** משטחים להצגה בתלת־ממד (מצולעים במ"מ) */
  surfaces: { kind: 'roof' | 'wall'; pts: Vec3[] }[];
}

export function claddingTakeoff(p: Project, d: DerivedModel): CladdingTakeoff | null {
  const b = p.building, cl = b.cladding, sec = d.section;
  if (!cl || !sec) return null;
  const fr = [...b.frames].sort((a1, a2) => a1.y - a2.y);
  const y0 = fr[0].y - b.purlinOverhangStart, y1 = fr[fr.length - 1].y + b.purlinOverhangEnd;
  const Wy = y1 - y0;
  const base = b.baseElevation;
  const res: CladdingTakeoff = { roofArea: 0, wallArea: 0, openingArea: 0, roofSheets: [], wallSheets: [], flashings: [], gutters: [], screws: 0, surfaces: [] };
  const lines = [...sec.lines].sort((a1, a2) => a1.x - a2.x);
  const pu = tryProfile(b.purlins.left.profile)?.props.h ?? 200;
  const lift = b.heightRef === 'TOS' ? pu : (tryProfile(b.rafterProfile)?.props.h ?? 300) / 2 + pu;
  // ---- גג
  const key = (q: { x: number; z: number }) => `${Math.round(q.x)}|${Math.round(q.z)}`;
  const ends = new Map<string, number>();
  for (const pl of sec.planes) for (const q of [pl.a, pl.b]) ends.set(key(q), (ends.get(key(q)) ?? 0) + 1);
  if (cl.roof.enabled) {
    const counts = new Map<string, number>();
    for (const pl of sec.planes) {
      const L = Math.hypot(pl.b.x - pl.a.x, pl.b.z - pl.a.z);
      const lowIsA = pl.a.z <= pl.b.z, low = lowIsA ? pl.a : pl.b, high = lowIsA ? pl.b : pl.a;
      const lowFree = (ends.get(key(low)) ?? 0) < 2;
      const len = Math.round(L + (lowFree ? cl.roof.eaveExt : 0));
      const n = Math.ceil(Wy / cl.roof.cover);
      res.roofArea += (len / 1000) * (Wy / 1000);
      res.roofSheets.push({ where: `מישור ${pl.label}`, panel: cl.roof.panel, count: n, length: len });
      counts.set(key(high), (counts.get(key(high)) ?? 0));
      const nn = norm(v3(-(pl.b.z - pl.a.z), 0, pl.b.x - pl.a.x)); const up = nn.z < 0 ? scale(nn, -1) : nn;
      const off = scale(up, lift);
      const A = add(v3(pl.a.x, y0, pl.a.z), off), B = add(v3(pl.b.x, y0, pl.b.z), off);
      res.surfaces.push({ kind: 'roof', pts: [A, B, add(B, v3(0, Wy, 0)), add(A, v3(0, Wy, 0))] });
      // מזחלה בקצה נמוך חופשי; מזחלה פנימית בשקע בין שני מישורים
      if (cl.gutter.enabled) {
        const lowShared = (ends.get(key(low)) ?? 0) >= 2;
        const highOther = sec.planes.some((q) => q !== pl && [q.a, q.b].some((e) => key(e) === key(low)) && Math.min(q.a.z, q.b.z) >= low.z - 1);
        if (!lowShared) res.gutters.push({ name: `מזחלה — קצה תחתון ${pl.label}`, length: Wy, downpipes: Math.max(1, Math.ceil(Wy / cl.gutter.downpipeSpacing)) });
        else if (highOther && !res.gutters.some((g) => g.name.includes(`${Math.round(low.x)}`))) res.gutters.push({ name: `מזחלה פנימית (שקע) x=${Math.round(low.x)}`, length: Wy, downpipes: Math.max(2, Math.ceil(Wy / cl.gutter.downpipeSpacing)) });
      }
      // קצה עליון חופשי (חד־שיפועי) — פח קצה עליון
      if ((ends.get(key(high)) ?? 0) < 2) res.flashings.push({ name: `פח קצה עליון ${pl.label}`, length: Wy });
    }
    // רכסים: נקודה גבוהה משותפת לשני מישורים
    for (const [k, n] of ends) if (n >= 2) {
      const [x, z] = k.split('|').map(Number);
      const isRidge = sec.planes.filter((q) => [q.a, q.b].some((e) => key(e) === k)).every((q) => Math.max(q.a.z, q.b.z) <= z + 1);
      if (isRidge) res.flashings.push({ name: `כיסוי רכס x=${x}`, length: Wy });
    }
    res.flashings.push({ name: 'פחי שוליים (גמלונים)', length: 2 * sec.planes.reduce((a1, pl) => a1 + Math.hypot(pl.b.x - pl.a.x, pl.b.z - pl.a.z), 0) });
    res.screws += res.roofArea * cl.roofScrewsPerM2;
  }
  // ---- קירות
  if (cl.walls.enabled) {
    const xs = lines.map((l) => l.x), xL = xs[0], xR = xs[xs.length - 1];
    const colTop = (x: number) => Math.max(...d.members.filter((m) => m.kind === 'column' && Math.abs(m.start.x - x) < 1).map((m) => Math.max(m.start.z, m.end.z)), base);
    const ops = (w: WallId) => cl.openings.filter((o) => o.wall === w);
    const opArea = (w: WallId) => ops(w).reduce((a1, o) => a1 + (o.width / 1000) * (o.height / 1000), 0);
    const bottom = base + cl.walls.bottom;
    let hMax = 0;
    for (const w of ['L', 'R'] as const) {
      if (!cl.walls.sides[w]) continue;
      const x = w === 'L' ? xL : xR, H = colTop(x) - bottom;
      hMax = Math.max(hMax, H);
      const n = Math.ceil(Wy / cl.walls.cover);
      res.wallSheets.push({ where: WALL_HE[w], panel: cl.walls.panel, count: n, length: Math.round(H) });
      res.wallArea += (Wy / 1000) * (H / 1000) - opArea(w);
      res.openingArea += opArea(w);
      res.surfaces.push({ kind: 'wall', pts: [v3(x, y0, bottom), v3(x, y1, bottom), v3(x, y1, bottom + H), v3(x, y0, bottom + H)] });
    }
    for (const w of ['F', 'B'] as const) {
      if (!cl.walls.sides[w]) continue;
      const y = w === 'F' ? fr[0].y : fr[fr.length - 1].y;
      // פנלים אנכיים ברוחב כיסוי: אורך כל פנל עד קו הגג (הנקודה הגבוהה ברוחב הפנל)
      const lens = new Map<number, number>();
      let area = 0;
      for (let x = xL; x < xR - 1; x += cl.walls.cover) {
        const xe = Math.min(xR, x + cl.walls.cover);
        const top = Math.max(roofAt(sec, x) ?? 0, roofAt(sec, xe) ?? 0) + lift;
        const L = Math.round(top - bottom);
        lens.set(L, (lens.get(L) ?? 0) + 1);
        area += ((xe - x) / 1000) * (((roofAt(sec, x) ?? 0) + (roofAt(sec, xe) ?? 0)) / 2 + lift - bottom) / 1000;
      }
      for (const [L, n] of [...lens].sort((a1, a2) => a2[0] - a1[0])) res.wallSheets.push({ where: WALL_HE[w], panel: cl.walls.panel, count: n, length: L });
      res.wallArea += area - opArea(w);
      res.openingArea += opArea(w);
      const pts: Vec3[] = [v3(xR, y, bottom), v3(xL, y, bottom)];
      const knots = [...new Set([xL, ...sec.planes.flatMap((pl) => [pl.a.x, pl.b.x]), xR])].filter((x) => x >= xL - 1 && x <= xR + 1).sort((a1, a2) => a1 - a2);
      for (const x of knots) pts.push(v3(x, y, (roofAt(sec, x) ?? bottom) + lift));
      res.surfaces.push({ kind: 'wall', pts });
    }
    if (hMax) res.flashings.push({ name: 'פחי פינה', length: 4 * hMax });
    const perim = 2 * (Wy + (xR - xL));
    const doors = cl.openings.filter((o) => o.sill === 0).reduce((a1, o) => a1 + o.width, 0);
    res.flashings.push({ name: 'פח בסיס (סף קיר)', length: Math.max(0, perim - doors) });
    const opPer = cl.openings.reduce((a1, o) => a1 + o.width * (o.sill > 0 ? 2 : 1) + 2 * o.height, 0);
    if (opPer) res.flashings.push({ name: 'פחי פתחים (משקוף, צדדים, אדן)', length: opPer });
    res.screws += res.wallArea * cl.wallScrewsPerM2;
  }
  res.screws = Math.ceil(res.screws / 50) * 50;
  return res;
}
