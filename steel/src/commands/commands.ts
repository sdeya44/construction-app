import { add, rotateAxis, sub, v3, type Vec3 } from '../core/vec';
import { degToRad } from '../core/units';
import { generate, placementBasis } from '../geometry/generate';
import type { BuildingParams, FrameDef, ManualMember, Member, MemberOverride, Project } from '../model/types';
import { hasErrors, validateBuilding } from '../model/validate';
import { tryProfile } from '../profiles/library';
import { MATERIALS } from '../profiles/materials';

export class CommandError extends Error {}

/**
 * כל פקודה היא פונקציה טהורה: Project ⇒ Project חדש. פקודה שאינה חוקית זורקת CommandError
 * והמודל אינו משתנה. ההיסטוריה (Undo/Redo) נשמרת ב-store כרצף מצבים.
 */
export interface Command { label: string; run: (p: Project) => Project }

const clone = <T,>(x: T): T => structuredClone(x);

export function setBuilding(patch: Partial<BuildingParams>): Command {
  return {
    label: 'עדכון פרמטרי מבנה',
    run: (p) => {
      const n = clone(p);
      n.building = { ...n.building, ...clone(patch) };
      n.building.frames = [...n.building.frames].sort((a, b) => a.y - b.y);
      const errs = validateBuilding(n.building).filter((i) => i.severity === 'error');
      if (errs.length) throw new CommandError(errs.map((e) => e.message).join('\n'));
      return n;
    },
  };
}

export function setMeta(patch: Partial<Project['meta']>): Command {
  return { label: 'עדכון פרטי פרויקט', run: (p) => ({ ...clone(p), meta: { ...p.meta, ...patch } }) };
}

export function setSettings(patch: Partial<Project['settings']> & { displayUnit?: 'm' | 'mm' }): Command {
  return {
    label: 'עדכון הגדרות',
    run: (p) => {
      const n = clone(p);
      const { displayUnit, ...rest } = patch;
      if (displayUnit) n.displayUnit = displayUnit;
      n.settings = { ...n.settings, ...rest };
      if (!(n.settings.stockLength > 0)) throw new CommandError('אורך חומר גלם חייב להיות חיובי');
      return n;
    },
  };
}

/** הוספת מסגרת במיקום y. מקבלת מזהה יציב חדש שאינו ממוחזר. */
export function addFrame(y: number): Command {
  return {
    label: 'הוספת מסגרת',
    run: (p) => {
      const n = clone(p);
      if (n.building.frames.some((f) => Math.abs(f.y - y) < 1)) throw new CommandError('כבר קיימת מסגרת במיקום זה');
      const f: FrameDef = { id: `F${n.nextFrameNo++}`, y };
      n.building.frames = [...n.building.frames, f].sort((a, b) => a.y - b.y);
      const errs = validateBuilding(n.building).filter((i) => i.severity === 'error');
      if (errs.length) throw new CommandError(errs.map((e) => e.message).join('\n'));
      return n;
    },
  };
}

export function removeFrame(id: string): Command {
  return {
    label: 'מחיקת מסגרת',
    run: (p) => {
      const n = clone(p);
      if (n.building.frames.length <= 2) throw new CommandError('נדרשות לפחות 2 מסגרות');
      n.building.frames = n.building.frames.filter((f) => f.id !== id);
      for (const k of Object.keys(n.memberOverrides)) if (k.startsWith(`${id}.`)) delete n.memberOverrides[k];
      n.deleted = n.deleted.filter((d) => !d.startsWith(`${id}.`));
      return n;
    },
  };
}

export function setFrameY(id: string, y: number): Command {
  return {
    label: 'הזזת מסגרת',
    run: (p) => {
      const frames = p.building.frames.map((f) => (f.id === id ? { ...f, y } : f));
      return setBuilding({ frames }).run(p);
    },
  };
}

function checkPatch(patch: MemberOverride) {
  if (patch.profile !== undefined && !tryProfile(patch.profile)) throw new CommandError(`חתך לא מוכר: ${patch.profile}`);
  if (patch.material !== undefined && !MATERIALS.some((m) => m.id === patch.material)) throw new CommandError('חומר לא מוכר');
  if (patch.rollDeg !== undefined && !Number.isFinite(patch.rollDeg)) throw new CommandError('זווית לא תקינה');
}

/** עדכון מאפייני אלמנטים (חתך, חומר, סיבוב, היפוך). */
export function setMemberProps(ids: string[], patch: Omit<MemberOverride, 'placement'>): Command {
  return {
    label: 'עדכון מאפייני אלמנט',
    run: (p) => {
      checkPatch(patch);
      const n = clone(p);
      for (const id of ids) {
        const mm = n.manualMembers.find((x) => x.id === id);
        if (mm) { Object.assign(mm, stripUndef(patch)); continue; }
        n.memberOverrides[id] = { ...(n.memberOverrides[id] ?? {}), ...stripUndef(patch) };
      }
      return n;
    },
  };
}

/** החזרת אלמנט נגזר לערכי הפרמטרים (ביטול התאמות ידניות). */
export function resetOverrides(ids: string[]): Command {
  return {
    label: 'איפוס התאמות ידניות',
    run: (p) => {
      const n = clone(p);
      for (const id of ids) delete n.memberOverrides[id];
      return n;
    },
  };
}

function stripUndef<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

type Xform = (pt: Vec3) => Vec3;

/** מחיל טרנספורמציה על אלמנטים: נגזרים מקבלים מיקום ידני (עם חתימה), ידניים מתעדכנים. */
function transformMembers(p: Project, ids: string[], fn: Xform, label: string): Project {
  if (!ids.length) throw new CommandError('לא נבחרו אלמנטים');
  const d = generate(p);
  const n = clone(p);
  for (const id of ids) {
    const mm = n.manualMembers.find((x) => x.id === id);
    if (mm) { mm.start = fn(mm.start); mm.end = fn(mm.end); continue; }
    const m = d.byId.get(id);
    if (!m) throw new CommandError(`אלמנט לא נמצא: ${id}`);
    const orig = generatedBasis(p, id) ?? placementBasis(m.start, m.end);
    n.memberOverrides[id] = {
      ...(n.memberOverrides[id] ?? {}),
      placement: { start: fn(m.start), end: fn(m.end), basis: orig },
    };
  }
  void label;
  return n;
}

/** חתימת המיקום הנגזר הפרמטרי (ללא התאמות) של אלמנט. */
function generatedBasis(p: Project, id: string): string | null {
  const bare = clone(p);
  delete bare.memberOverrides[id];
  const m = generate(bare).byId.get(id);
  return m ? placementBasis(m.start, m.end) : null;
}

export function moveMembers(ids: string[], delta: Vec3): Command {
  return { label: 'הזזה', run: (p) => transformMembers(p, ids, (q) => add(q, delta), 'הזזה') };
}

export function rotateMembers(ids: string[], angleDeg: number, center: Vec3): Command {
  const a = degToRad(angleDeg);
  const k = v3(0, 0, 1);
  return {
    label: 'סיבוב',
    run: (p) => transformMembers(p, ids, (q) => add(center, rotateAxis(sub(q, center), k, a)), 'סיבוב'),
  };
}

/** שיקוף ביחס למישור x=pos או y=pos. */
export function mirrorMembers(ids: string[], axis: 'X' | 'Y', pos: number): Command {
  return {
    label: 'שיקוף',
    run: (p) => transformMembers(p, ids, (q) => (axis === 'X' ? { ...q, x: 2 * pos - q.x } : { ...q, y: 2 * pos - q.y }), 'שיקוף'),
  };
}

/** העתקה: יוצרת אלמנטים ידניים חדשים, count פעמים בהיסט מצטבר. */
export function copyMembers(ids: string[], delta: Vec3, count = 1): Command {
  return {
    label: 'העתקה',
    run: (p) => {
      if (!ids.length) throw new CommandError('לא נבחרו אלמנטים');
      if (!(count >= 1 && count <= 500)) throw new CommandError('מספר העתקים 1–500');
      const d = generate(p);
      const n = clone(p);
      for (let c = 1; c <= count; c++) {
        const off = { x: delta.x * c, y: delta.y * c, z: delta.z * c };
        for (const id of ids) {
          const m = d.byId.get(id);
          if (!m) throw new CommandError(`אלמנט לא נמצא: ${id}`);
          n.manualMembers.push(toManual(m, `M${n.nextMemberNo++}`, off));
        }
      }
      return n;
    },
  };
}

function toManual(m: Member, id: string, off: Vec3): ManualMember {
  return {
    id, kind: m.kind, start: add(m.start, off), end: add(m.end, off), profile: m.profile,
    material: m.material, rollDeg: m.rollDeg, mirror: m.mirror, refUp: m.refUp, anchor: m.anchor,
    copiedFrom: m.id,
  };
}

export function deleteMembers(ids: string[]): Command {
  return {
    label: 'מחיקה',
    run: (p) => {
      if (!ids.length) throw new CommandError('לא נבחרו אלמנטים');
      const n = clone(p);
      const manual = new Set(n.manualMembers.map((m) => m.id));
      n.manualMembers = n.manualMembers.filter((m) => !ids.includes(m.id));
      n.deleted = [...new Set([...n.deleted, ...ids.filter((i) => !manual.has(i))])];
      return n;
    },
  };
}

export function restoreDeleted(): Command {
  return { label: 'שחזור אלמנטים שנמחקו', run: (p) => ({ ...clone(p), deleted: [] }) };
}

export function guardNoErrors(p: Project) {
  if (hasErrors(validateBuilding(p.building))) throw new CommandError('פרמטרי המבנה אינם תקינים');
}

/**
 * חלוקה אחידה מחדש: count מסגרות במרווח spacing. מסגרות קיימות שומרות על מזהה לפי הסדר;
 * מסגרות חדשות מקבלות מזהה חדש שאינו ממוחזר.
 */
export function respaceFrames(count: number, spacing: number): Command {
  return {
    label: 'חלוקת מסגרות אחידה',
    run: (p) => {
      if (!(Number.isInteger(count) && count >= 2 && count <= 200)) throw new CommandError('מספר מסגרות 2–200');
      if (!(spacing > 0)) throw new CommandError('מרווח חייב להיות חיובי');
      const n = clone(p);
      const old = n.building.frames;
      const frames: FrameDef[] = [];
      for (let i = 0; i < count; i++) frames.push({ id: old[i]?.id ?? `F${n.nextFrameNo++}`, y: i * spacing });
      const removed = old.slice(count).map((f) => f.id);
      for (const id of removed) {
        for (const k of Object.keys(n.memberOverrides)) if (k.startsWith(`${id}.`)) delete n.memberOverrides[k];
        n.deleted = n.deleted.filter((d) => !d.startsWith(`${id}.`));
      }
      n.building.frames = frames;
      return n;
    },
  };
}
