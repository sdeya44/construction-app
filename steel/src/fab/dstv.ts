import { zipSync, strToU8 } from 'fflate';
import { dot, sub } from '../core/vec';
import { localFrame } from '../geometry/frame';
import { cachedSolidPure } from '../drawing/solidCache';
import { getProfile, massPerMeter, type Family } from '../profiles/library';
import { getMaterial } from '../profiles/materials';
import type { DerivedModel, Project } from '../model/types';
import type { Fabrication, MarkedPart } from './marks';

/** קוד סוג פרופיל לפי DSTV. */
const CODE: Partial<Record<Family, string>> = {
  IPE: 'I', HEA: 'I', HEB: 'I', HEM: 'I', INP: 'I', UPN: 'U', UPE: 'U', L: 'L', SHS: 'M', RHS: 'M', CHS: 'RO', RD: 'RU', PL: 'B', C: 'C', Z: 'SO',
};

const f2 = (n: number) => n.toFixed(2).padStart(10);

/**
 * קובץ DSTV (NC1) לחלק: בלוק ST (נתוני חלק), BO (חורים) ו-EN.
 * פאות: v = ווב/פני פלטה, o = אגף עליון, u = אגף תחתון. קואורדינטות: x לאורך החלק מתחילתו, y מהשפה התחתונה/השמאלית של הפאה.
 * ⚠ גרסת בטא — יש לאמת מול תוכנת המכונה לפני ייצור (מוסכמות הייחוס משתנות בין יצרנים).
 */
export function partToNc1(p: MarkedPart, project: Project, d: DerivedModel, qty: number): string {
  const m = d.byId.get(p.memberId)!;
  const prof = getProfile(p.profile);
  const f = localFrame(m);
  const s = cachedSolidPure(m);
  const loc = [...s.startRing, ...s.endRing].map((q) => { const r = sub(q, m.start); return { u: dot(r, f.u), v: dot(r, f.v) }; });
  const umin = Math.min(...loc.map((q) => q.u)), vmin = Math.min(...loc.map((q) => q.v)), vmax = Math.max(...loc.map((q) => q.v));
  const dm = prof.dims;
  const isPlate = prof.family === 'PL';
  const h = isPlate ? dm.t : prof.props.h, b = isPlate ? dm.b : prof.props.b;
  const tf = dm.tf ?? dm.t ?? 0, tw = dm.tw ?? dm.t ?? 0, r = dm.r ?? 0;
  const per = (() => { const o = prof.outline.outer; let L = 0; for (let i = 0; i < o.length; i++) { const a = o[i], c = o[(i + 1) % o.length]; L += Math.hypot(c.u - a.u, c.v - a.v); } return L / 1000; })();
  const kgm = massPerMeter(prof, getMaterial(p.material).density);
  const lines: string[] = ['ST', `** KAYAN STEEL PRO — ${p.mark}`,
    `  ${project.meta.number || project.meta.name}`, `  P-${p.mark}`, `  ${project.revision.current}`, `  ${p.mark}`, `  ${p.material}`, `  ${qty}`,
    `  ${p.profile}`, `  ${CODE[prof.family] ?? 'SO'}`,
    `  ${f2(p.length)}`, `  ${f2(p.length)}`, `  ${f2(isPlate ? b : h)}`, `  ${f2(isPlate ? h : b)}`, `  ${f2(tf)}`, `  ${f2(tw)}`, `  ${f2(r)}`,
    `  ${f2(kgm)}`, `  ${f2(per)}`, `  ${f2(p.cutStart)}`, `  ${f2(p.cutEnd)}`, `  ${f2(0)}`, `  ${f2(0)}`,
    `  ${p.desc.replace(/[^\x20-\x7E]/g, '').trim() || '-'}`, '  -', '  -', '  -'];
  if (p.holes.length) {
    lines.push('BO');
    const mid = (vmin + vmax) / 2;
    for (const hl of p.holes) {
      if (hl.face === 'section') continue;
      if (isPlate) lines.push(`  v ${f2(hl.t)} ${f2(hl.c - umin)} ${f2(hl.d)}`);
      else if (hl.face === 'web') lines.push(`  v ${f2(hl.t)} ${f2(hl.c - vmin)} ${f2(hl.d)}${hl.slot ? ` ${f2(0)}l ${f2(hl.slot - hl.d)} ${f2(0)} ${f2(0)}` : ''}`);
      else lines.push(`  ${(hl.c2 ?? 0) > mid ? 'o' : 'u'} ${f2(hl.t)} ${f2(hl.c - umin)} ${f2(hl.d)}`);
    }
  }
  lines.push('EN');
  return lines.join('\r\n') + '\r\n';
}

/** קובץ ZIP עם NC1 לכל סימון חלק (חלקים ליניאריים ופלטות; ללא מוטות עיגון). */
export function dstvZip(project: Project, d: DerivedModel, fab: Fabrication): { zip: Uint8Array; count: number } {
  const byMark = new Map<string, MarkedPart[]>();
  for (const p of fab.parts) byMark.set(p.mark, [...(byMark.get(p.mark) ?? []), p]);
  const files: Record<string, Uint8Array> = {};
  for (const [mark, ps] of byMark) {
    if (ps[0].kind === 'anchor') continue;
    files[`${mark}.nc1`] = strToU8(partToNc1(ps[0], project, d, ps.length));
  }
  return { zip: zipSync(files, { level: 6 }), count: Object.keys(files).length };
}
