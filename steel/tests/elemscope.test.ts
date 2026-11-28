/**
 * EO — חתך אישי לכל אלמנט שנוצר מהגדרה כללית (קושרות, שורות קשירה, אגד B, נעילה, מסבכים, סבכה אופקית):
 * דריסה ב-`memberOverrides` משנה רק את האלמנט הזה, החיבור נבנה לפי החתך החדש, ושאר המודל (אלמנטים, חיבורים, שגיאות) לא משתנה.
 * גיאומטריה בלבד — לא בדיקת חוזק.
 */
import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject, framesFromSpacings } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { defaultKneeBraces } from '../src/geometry/knee';
import { defaultLockTruss } from '../src/geometry/lockTruss';
import { defaultPortal } from '../src/geometry/portal';
import { defaultTrussSpec } from '../src/geometry/truss';
import { defaultRhsTruss } from '../src/geometry/hbrace';
import { setMemberProps } from '../src/commands/commands';
import type { BuildingParams } from '../src/model/types';

const mk = (f: (b: BuildingParams) => void) => { const b = defaultBuilding(); b.frames = framesFromSpacings([6000, 6000, 6000, 6000]); f(b); return b; };
interface Case { name: string; b: BuildingParams; ids: RegExp[]; to: string }
const CASES: Case[] = [
  { name: 'knee', b: mk((b) => { b.kneeBraces = { ...defaultKneeBraces(), enabled: true }; }), ids: [/^KB\./], to: 'RHS100x100x5' },
  { name: 'portal', b: mk((b) => { b.bracing.walls = { ...b.bracing.walls, enabled: true, type: 'portal', portal: defaultPortal() }; }), ids: [/^BB\.\d+\.L$/, /^BB\.\d+\.L\.K1$/], to: 'RHS80x80x4' },
  { name: 'lock', b: mk((b) => { b.bracing.walls = { ...b.bracing.walls, enabled: true, type: 'truss', truss: defaultLockTruss() }; }), ids: [/^LT\.\d+\.L\.D2$/], to: 'RHS60x60x4' },
  { name: 'wallx', b: mk((b) => { b.bracing.walls = { ...b.bracing.walls, enabled: true, type: 'x' }; }), ids: [/^BR\.W\d+\.L\.1$/], to: 'L70x7' },
  { name: 'roofx', b: mk((b) => { b.bracing.roof.enabled = true; }), ids: [/^BR\.R\d+\.L\.1$/, /^BR\.R\d+\.R\.2$/], to: 'L70x7' },
  { name: 'ties', b: mk((b) => { b.bracing.purlinTies = { ...b.bracing.purlinTies, enabled: true }; }), ids: [/^BR\.T\d+\.L$/], to: 'L50x5' },
  { name: 'rooftruss', b: mk((b) => { b.roofTruss = { enabled: true, frames: b.frames.map((f) => f.id).slice(1, 3), shape: 'flat', spec: defaultTrussSpec(6, 1000) } as never; }), ids: [/^TR\.F\w+\.V\d+$/, /^TR\.F\w+\.D2a$/], to: 'SHS70x4' },
  { name: 'transfer-truss', b: mk((b) => { const f = b.frames; b.transfers = [{ id: 'T1', lineId: 'L', from: f[0].id, to: f[3].id, removed: [f[1].id, f[2].id], profile: 'HEA160', support: 'A1', seat: 'B1', kind: 'truss', truss: defaultTrussSpec(6, 1000) } as never]; }), ids: [/^TB\.T1\.TR\.V\d+$/, /^TB\.T1\.TR\.D2a$/], to: 'SHS70x4' },
  { name: 'hbrace', b: mk((b) => { b.bracing.roof = { ...b.bracing.roof, enabled: true, type: 'rhs', rhs: defaultRhsTruss() } as never; }), ids: [/^HB\..*\.S2$/, /^HB\..*\.D1$/], to: 'RHS70x70x4' },
];
const errs = (d: ReturnType<typeof generate>) => d.issues.filter((i) => i.severity === 'error').map((i) => `${i.code}:${i.elementId ?? ''}`).sort();

describe('EO — חתך אישי לאלמנט בהגדרות כלליות', () => {
  for (const c of CASES) for (const rx of c.ids) {
    it(`EO-${c.name} ${rx.source}`, () => {
      const p0 = newProject(c.name, c.b), d0 = generate(p0);
      const m0 = d0.members.find((m) => rx.test(m.id));
      expect(m0, `אלמנט ${rx} קיים`).toBeTruthy();
      const p1 = setMemberProps([m0!.id], { profile: c.to }).run(p0), d1 = generate(p1);
      const m1 = d1.byId.get(m0!.id)!;
      expect(m1.profile).toBe(c.to);                                              // החתך האישי חל
      expect(d1.members.length).toBe(d0.members.length);                          // לא נוספו/נעלמו אלמנטים
      expect(d1.connections.length).toBe(d0.connections.length);
      expect(errs(d1)).toEqual(errs(d0));                                         // אין שגיאות חדשות
      // שאר אלמנטים מאותה הגדרה — חתך ללא שינוי
      const same = d0.members.filter((m) => m.id !== m0!.id && m.profile === m0!.profile && m.kind === m0!.kind && m.id.replace(/\d+/g, '#') === m0!.id.replace(/\d+/g, '#'));
      const pre = (id: string) => id.slice(0, id.lastIndexOf('.'));
      // קושרת X: שני האלכסונים חולקים פח חיבור ובורג הצטלבות — החתך חל על הזוג (תיעוד בממשק)
      const xp = ['wallx', 'roofx'].includes(c.name) ? d1.byId.get(same.find((x) => pre(x.id) === pre(m0!.id))!.id)?.profile : undefined;
      if (xp) expect(xp).toBe(c.to);
      for (const o of same.filter((x) => !(['wallx', 'roofx'].includes(c.name) && pre(x.id) === pre(m0!.id)))) expect(d1.byId.get(o.id)?.profile, o.id).toBe(o.profile);
    }, 60000);
  }
});
