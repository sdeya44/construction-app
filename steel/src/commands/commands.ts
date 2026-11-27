import { add, rotateAxis, sub, v3, type Vec3 } from '../core/vec';
import { degToRad } from '../core/units';
import { generate, placementBasis } from '../geometry/generate';
import type { CustomDetail, TransferDef, ValidationIssue, ApprovalStatus, BuildingParams, KneeBraceParams, CleatParams, DrawingRecord, FrameDef, ManualMember, Member, MemberOverride, PlateConnParams, Project, PurlinSideParams, PurlinSystem, StockLot, TrussSpec } from '../model/types';
import { purlinParams } from '../geometry/purlins';
import { effectiveSplices } from '../geometry/autoSplice';
import { withNodeCheeks } from '../geometry/trussNode';
import { defaultKneeBraces } from '../geometry/knee';
import { defaultSideConn } from '../model/defaults';
import type { CustomSection } from '../model/section';
import { commitNumbering, computeFabrication } from '../fab/marks';
import { hasErrors, validateBuilding } from '../model/validate';
import { catalogNames, tryProfile } from '../profiles/library';
import { assessBraceCandidate, suggestSize, suggestTransferProfile } from '../model/sizing';
import { suggestEavePlate } from '../geometry/eavePlate';
import { MATERIALS } from '../profiles/materials';

export class CommandError extends Error {}

/**
 * כל פקודה היא פונקציה טהורה: Project ⇒ Project חדש. פקודה שאינה חוקית זורקת CommandError
 * והמודל אינו משתנה. ההיסטוריה (Undo/Redo) נשמרת ב-store כרצף מצבים.
 */
export interface Command { label: string; run: (p: Project) => Project; /** מותר גם כשהמהדורה נעולה */ allowWhenLocked?: boolean }

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

/** חתך מודולרי: הגדרה/החלפה/ביטול (undefined = חזרה למצב קלאסי). ולידציה מבנית; שגיאות טופולוגיה מדווחות בבעיות. */
export function setSection(section: CustomSection | undefined, label = 'עדכון חתך המסגרת'): Command {
  return {
    label,
    run: (p) => {
      if (section) {
        if (!section.lines.length) throw new CommandError('נדרשת לפחות שורת עמודים אחת');
        if (!section.planes.length) throw new CommandError('נדרש לפחות מישור גג אחד');
        const ids = new Set<string>();
        for (const l of section.lines) {
          if (!Number.isFinite(l.x)) throw new CommandError('מיקום ציר לא מספרי');
          if (ids.has(l.id)) throw new CommandError(`מזהה ציר כפול: ${l.id}`);
          ids.add(l.id);
        }
        const xs = [...section.lines].map((l) => l.x).sort((a, b) => a - b);
        for (let i = 1; i < xs.length; i++) if (xs[i] - xs[i - 1] < 500) throw new CommandError('שני צירים קרובים מ-0.5 מ\'');
        const pids = new Set<string>();
        for (const pl of section.planes) {
          if (![pl.x0, pl.x1, pl.z0, pl.z1].every(Number.isFinite)) throw new CommandError('ערך מישור לא מספרי');
          if (!(pl.x1 - pl.x0 >= 500)) throw new CommandError('מישור: הקצה הימני חייב להיות מימין לשמאלי (לפחות 0.5 מ\')');
          if (Math.min(pl.z0, pl.z1) <= p.building.baseElevation + 1000) throw new CommandError('מישור נמוך מדי');
          if (pids.has(pl.id)) throw new CommandError(`מזהה מישור כפול: ${pl.id}`);
          pids.add(pl.id);
        }
      }
      const n = clone(p);
      n.building = { ...n.building, section: section ? clone(section) : undefined };
      if (!section) delete n.building.section;
      return n;
    },
  };
}

export function setKneeBraces(patch: Partial<KneeBraceParams>): Command {
  return {
    label: 'עדכון אלכסוני עמוד-קורה',
    run: (p) => {
      if (patch.profile !== undefined && !tryProfile(patch.profile)) throw new CommandError(`חתך לא מוכר: ${patch.profile}`);
      for (const [k, v] of Object.entries(patch)) if (typeof v === 'number' && !(v > 0)) throw new CommandError(`${k}: ערך חייב להיות חיובי`);
      const n = clone(p);
      n.building.kneeBraces = { ...defaultKneeBraces(), ...(n.building.kneeBraces ?? {}), ...clone(patch) };
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
      if (!n.settings.stockLengths.every((x) => x > 0)) throw new CommandError('אורכי מלאי חייבים להיות חיוביים');
      if (!(n.settings.kerf >= 0 && n.settings.kerf < 20)) throw new CommandError('רוחב להב 0–20 מ"מ');
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
      // QA-F1: הפניות נוספות למסגרת שנמחקה (השמות פרטים מותאמים, ערכי מופע, חריגי חיבור) — לא נשארות יתומות בפרויקט
      const refsFrame = new RegExp(`(?:^|[.|:])${id.replace(/[^\w]/g, '\\$&')}(?=[.|:]|$)`);
      const prune = <T extends Record<string, unknown> | undefined>(o: T): T => (o ? (Object.fromEntries(Object.entries(o).filter(([k]) => !refsFrame.test(k))) as T) : o);
      n.detailAssign = prune(n.detailAssign); n.detailParams = prune(n.detailParams);
      n.connectionOverrides = prune(n.connectionOverrides); n.cleatOverrides = prune(n.cleatOverrides);
      if (n.building.kneeBraces?.offCells) n.building.kneeBraces.offCells = n.building.kneeBraces.offCells.filter((c) => !c.startsWith(`${id}|`));
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

/** שחזור אלמנטים מסוימים — כולל החלקים שנוצרו איתם (מזהים שמתחילים במזהה או ב-C.מזהה) */
export function restoreMembers(ids: string[]): Command {
  return {
    label: 'שחזור אלמנט',
    run: (p) => {
      const hit = (d: string) => ids.some((id) => d === id || d.startsWith(`${id}.`) || d.startsWith(`C.${id}.`));
      return { ...clone(p), deleted: p.deleted.filter((d) => !hit(d)) };
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

/** עדכון פרמטרי פטות לצד אחד. פרמטרי צד אחד אינם משנים את הצד השני. */
/** עדכון פרמטרי פטות: side = left / right / מזהה מישור בחתך מודולרי */
export function setPurlinSide(side: string, patch: Partial<PurlinSideParams>): Command {
  return {
    label: `עדכון פטות ${side === 'left' ? 'שמאל' : side === 'right' ? 'ימין' : side}`,
    run: (p) => {
      if (patch.profile !== undefined && !tryProfile(patch.profile)) throw new CommandError(`חתך לא מוכר: ${patch.profile}`);
      for (const k of ['first', 'spacing', 'edgeOffset'] as const) {
        if (patch[k] !== undefined && !Number.isFinite(patch[k])) throw new CommandError('ערך לא מספרי');
      }
      if (patch.spacing !== undefined && !(patch.spacing > 0)) throw new CommandError('מרווח פטות חייב להיות חיובי');
      if (patch.first !== undefined && patch.first < 0) throw new CommandError('מרחק ראשון לא יכול להיות שלילי');
      if (patch.edgeOffset !== undefined && patch.edgeOffset < 0) throw new CommandError('מרחק מהקצה לא יכול להיות שלילי');
      const n = clone(p);
      writePurlinParams(n, side, { ...purlinParams(n.building.purlins, side), ...clone(patch) });
      // נחסם רק שינוי שיוצר שגיאה חדשה — שגיאה קיימת (גם בשיפוע אחר) לא תמנע את תיקונה
      const key = (i: { code: string; message: string }) => `${i.code}|${i.message}`;
      const before = new Set(generate(p).issues.filter((i) => i.severity === 'error').map(key));
      const errs = generate(n).issues.filter((i) => i.severity === 'error' && i.code.startsWith('PURLIN') && !before.has(key(i)));
      if (errs.length) throw new CommandError(errs.map((e) => e.message).join('\n'));
      return n;
    },
  };
}

function writePurlinParams(n: Project, key: string, v: PurlinSideParams) {
  if (key === 'left') n.building.purlins.left = v;
  else if (key === 'right') n.building.purlins.right = v;
  else n.building.purlins.planes = { ...(n.building.purlins.planes ?? {}), [key]: v };
}

export function setPurlinSystem(patch: Partial<Pick<PurlinSystem, 'material' | 'monoStart' | 'splice' | 'pieceBays' | 'engine'>>): Command {
  return {
    label: 'עדכון מערכת פטות',
    run: (p) => {
      const n = clone(p);
      n.building.purlins = { ...n.building.purlins, ...patch };
      return n;
    },
  };
}

/** קביעת מיקומי חיבורי המשך למכלול (מרחקים לאורך הציר מנקודת ההתחלה). */
export function setSplices(memberId: string, positions: number[]): Command {
  return {
    label: 'עדכון חיבורי המשך',
    run: (p) => {
      if (positions.some((t) => !Number.isFinite(t))) throw new CommandError('מיקום לא מספרי');
      const n = clone(p);
      const sorted = [...new Set(positions.map((t) => Math.round(t * 1000) / 1000))].sort((a, b) => a - b);
      n.splices[memberId] = sorted; // רשימה ריקה = "ללא חיבור" במפורש (גובר על החלוקה האוטומטית)
      return n;
    },
  };
}

/**
 * הצעה אוטומטית לחיבורי המשך: לפטות — מעל נקודות תמיכה, לשאר — חלוקה שווה, כך שאף חלק אינו ארוך מחומר הגלם.
 * מחליפה חיבורים קיימים רק לאלמנטים שנבחרו.
 */
export function proposeSplicesFor(ids: string[]): Command {
  return {
    label: 'הצעת חיבורי המשך',
    run: (p) => {
      const d = generate(p);
      const n = clone(p);
      // אותו חישוב כמו החלוקה האוטומטית (מוט מלא + השלמה, הרחק מתומכי פטות; פטות — מעל תומכים)
      const eff = effectiveSplices({ ...p, splices: {}, settings: { ...p.settings, autoSplice: true } }, d.members.filter((m) => ids.includes(m.id)), d.supports).splices;
      for (const id of ids) {
        if (!d.byId.get(id)) continue;
        const ts = eff[id] ?? [];
        if (ts.length) n.splices[id] = ts; else delete n.splices[id];
      }
      return n;
    },
  };
}

/** החלת מידות תומך על כל תומכי הפטות בכל השיפועים, וביטול התאמות בודדות (החלטת משתמש) */
export function setCleatAll(cleat: CleatParams): Command {
  return {
    label: 'עדכון כל תומכי הפטות',
    run: (p) => {
      const n = clone(p);
      const pu = n.building.purlins;
      pu.left = { ...pu.left, cleat: clone(cleat) };
      pu.right = { ...pu.right, cleat: clone(cleat) };
      if (pu.planes) pu.planes = Object.fromEntries(Object.entries(pu.planes).map(([k, v]) => [k, { ...v, cleat: clone(cleat) }]));
      n.cleatOverrides = {};
      return n;
    },
  };
}

/** עדכון פרמטרי תומך ברירת מחדל לצד, או לתומך בודד (cleatId). */
export function setCleat(side: string, patch: Partial<CleatParams>, cleatId?: string): Command {
  return {
    label: cleatId ? `עדכון תומך ${cleatId}` : `עדכון תומכי פטות ${side === 'left' ? 'שמאל' : side === 'right' ? 'ימין' : side}`,
    run: (p) => {
      for (const [k, v] of Object.entries(patch)) {
        if (typeof v === 'number' && !(v > 0) && k !== 'holeHeight') throw new CommandError('ערך חייב להיות חיובי');
      }
      if (patch.rows !== undefined && !(Number.isInteger(patch.rows) && patch.rows >= 1 && patch.rows <= 4)) throw new CommandError('מספר שורות 1–4');
      if (patch.perRow !== undefined && !(Number.isInteger(patch.perRow) && patch.perRow >= 1 && patch.perRow <= 6)) throw new CommandError('ברגים בשורה 1–6');
      const n = clone(p);
      if (cleatId) n.cleatOverrides[cleatId] = { ...(n.cleatOverrides[cleatId] ?? {}), ...clone(patch) };
      else { const cur = purlinParams(n.building.purlins, side); writePurlinParams(n, side, { ...cur, cleat: { ...cur.cleat, ...clone(patch) } }); }
      return n;
    },
  };
}

export function resetCleat(cleatId: string): Command {
  return { label: 'איפוס תומך', run: (p) => { const n = clone(p); delete n.cleatOverrides[cleatId]; return n; } };
}

function checkPlate(patch: Partial<PlateConnParams>) {
  for (const k of ['t', 'w', 'l', 'gauge', 'pitch', 'weldSize', 'anchorLength'] as const) {
    const v = patch[k];
    if (v !== undefined && (!Number.isFinite(v) || v < 0)) throw new CommandError('ערך לא תקין');
  }
  if (patch.t !== undefined && !(patch.t > 0)) throw new CommandError('עובי פלטה חייב להיות חיובי');
  for (const k of ['cols', 'rows'] as const) {
    const v = patch[k];
    if (v !== undefined && !(Number.isInteger(v) && v >= 1 && v <= 8)) throw new CommandError('מספר ברגים 1–8');
  }
  if (patch.bolt?.d !== undefined && ![10, 12, 16, 20, 24].includes(patch.bolt.d)) throw new CommandError('קוטר בורג: M10/M12/M16/M20/M24');
}

/** עדכון חיבור בודד — נשמר לאלמנט (connectionOverrides). */
export function setConnection(id: string, patch: Partial<PlateConnParams> & { status?: ApprovalStatus; fixity?: 'rigid' | 'pinned' | 'semi' }): Command {
  return {
    label: 'עדכון חיבור',
    run: (p) => {
      checkPlate(patch);
      const n = clone(p);
      const cur = n.connectionOverrides[id] ?? {};
      n.connectionOverrides[id] = { ...cur, ...clone(patch), ...(patch.bolt ? { bolt: { ...(cur.bolt ?? n.connectionDefaults[connTypeOf(id)].bolt), ...patch.bolt } } : {}) };
      return n;
    },
  };
}

export function resetConnection(id: string): Command {
  return { label: 'איפוס חיבור לברירת מחדל', run: (p) => { const n = clone(p); delete n.connectionOverrides[id]; return n; } };
}

/** עדכון ברירת מחדל לסוג חיבור (חל על כל החיבורים שלא שונו ידנית). */
export function setConnectionDefault(type: 'eave' | 'ridge' | 'base' | 'side', patch: Partial<PlateConnParams>): Command {
  return {
    label: 'עדכון ברירת מחדל לחיבורים',
    run: (p) => {
      checkPlate(patch);
      const n = clone(p);
      const cur = type === 'side' ? (n.connectionDefaults.side ?? defaultSideConn()) : n.connectionDefaults[type];
      n.connectionDefaults[type] = { ...cur, ...clone(patch), bolt: { ...cur.bolt, ...(patch.bolt ?? {}) } };
      return n;
    },
  };
}

export function connTypeOf(id: string): 'eave' | 'ridge' | 'base' {
  if (id.startsWith('C.EAVE.')) return 'eave';
  if (id.startsWith('C.RIDGE.')) return 'ridge';
  if (id.startsWith('C.BASE.')) return 'base';
  throw new CommandError(`סוג חיבור לא נתמך: ${id}`);
}

/** שמירת החיבור כתבנית בספרייה, והחלת תבנית על חיבורים. */
export function saveTemplate(name: string, connId: string, params: PlateConnParams): Command {
  return {
    label: 'שמירת תבנית חיבור',
    run: (p) => {
      if (!name.trim()) throw new CommandError('נדרש שם לתבנית');
      const n = clone(p);
      n.connectionTemplates.push({ id: `T${Date.now().toString(36)}`, name: name.trim(), type: connTypeOf(connId), params: clone(params) });
      return n;
    },
  };
}

export function applyTemplate(templateId: string, connIds: string[]): Command {
  return {
    label: 'החלת תבנית חיבור',
    run: (p) => {
      const t = p.connectionTemplates.find((x) => x.id === templateId);
      if (!t) throw new CommandError('תבנית לא נמצאה');
      const n = clone(p);
      for (const id of connIds) {
        if (connTypeOf(id) !== t.type) throw new CommandError('התבנית אינה מתאימה לסוג החיבור');
        n.connectionOverrides[id] = { ...(n.connectionOverrides[id] ?? {}), ...clone(t.params) };
      }
      return n;
    },
  };
}

/** מספור: קיבוע הסימונים הזמניים ברישום (חלקים ומכלולים קיימים שומרים על סימונם). */
export function numberParts(): Command {
  return {
    label: 'מספור חלקים ומכלולים',
    run: (p) => {
      const d = generate(p);
      const fab = computeFabrication(p, d);
      return { ...clone(p), marks: commitNumbering(p, fab) };
    },
  };
}

/** אישור מהדורה: נעילת המודל. השינוי הבא מחייב פתיחת מהדורה חדשה. */
export function approveRevision(note: string): Command {
  return {
    label: 'אישור ונעילת מהדורה',
    allowWhenLocked: false,
    run: (p) => {
      const n = clone(p);
      const snap = JSON.stringify({ ...p, revision: undefined });
      n.revision = { ...n.revision, locked: true, log: [...n.revision.log, { rev: n.revision.current, date: new Date().toISOString(), note, status: 'approved', snapshot: snap }] };
      return n;
    },
  };
}

const nextRev = (r: string) => (/^[A-Y]$/.test(r) ? String.fromCharCode(r.charCodeAt(0) + 1) : `${r}1`);

export function openNewRevision(note: string): Command {
  return {
    label: 'פתיחת מהדורה חדשה',
    allowWhenLocked: true,
    run: (p) => {
      if (!p.revision.locked) throw new CommandError('המהדורה הנוכחית אינה נעולה');
      const n = clone(p);
      const rev = nextRev(p.revision.current);
      n.revision = { current: rev, locked: false, log: [...n.revision.log, { rev, date: new Date().toISOString(), note, status: 'draft' }] };
      return n;
    },
  };
}

/** עדכון רשומת שרטוט (סטטוס, גיליון, מהדורה). אישור שומר חתימת תוכן; שינוי מאוחר מסמן "השתנה מאז האישור". */
export function setDrawing(id: string, base: Omit<DrawingRecord, 'status' | 'rev' | 'history' | 'sheet'>, patch: Partial<DrawingRecord>, note = ''): Command {
  return {
    label: 'עדכון שרטוט',
    allowWhenLocked: true,
    run: (p) => {
      const n = clone(p);
      const cur: DrawingRecord = n.drawings.find((x) => x.id === id) ?? { ...base, status: 'draft' as const, rev: p.revision.current, history: [] };
      const next = { ...cur, ...patch };
      if (patch.status && patch.status !== cur.status) next.history = [...cur.history, { rev: next.rev, date: new Date().toISOString(), status: patch.status, note }];
      n.drawings = [...n.drawings.filter((x) => x.id !== id), next];
      return n;
    },
  };
}

/** הסתרה / שחזור של הודעות (אזהרות ומידע): מפתחות issueKey או "קוד|*" לסוג שלם */
export function dismissIssues(keys: string[], hide: boolean): Command {
  return {
    label: hide ? `הסתרת ${keys.length} הודעות` : 'שחזור הודעות',
    run: (p) => {
      const n = clone(p);
      const s = new Set(n.dismissedIssues ?? []);
      for (const k of keys) { if (hide) s.add(k); else s.delete(k); }
      n.dismissedIssues = [...s];
      return n;
    },
  };
}

/** החלת כל הצעות התיקון ברשימה בפקודה אחת (ביטול אחד מחזיר הכל). כפילויות מאוחדות. */
export function applyIssueFixes(issues: ValidationIssue[]): Command {
  return {
    label: `תיקון ${issues.length} הודעות`,
    run: (p) => {
      let n = p;
      const done = new Set<string>();
      for (const i of issues) {
        if (i.fix) {
          const k = `F|${i.fix.purlinKey}|${JSON.stringify(i.fix.patch)}`;
          if (done.has(k)) continue; done.add(k);
          try { n = setPurlinSide(i.fix.purlinKey, i.fix.patch).run(n); } catch { /* תיקון שנדחה — ממשיכים */ }
        } else if (i.cleatFix) {
          const f = i.cleatFix;
          const k = `C|${f.side}|${f.cleatId ?? ''}|${JSON.stringify(f.patch)}`;
          if (done.has(k)) continue; done.add(k);
          try { n = setCleat(f.side, f.patch, f.cleatId).run(n); } catch { /* תיקון שנדחה — ממשיכים */ }
        }
      }
      return n;
    },
  };
}

/** ביטול מיקומי חיבורי המשך ידניים לאלמנט — חזרה לחלוקה האוטומטית */
export function setSplicesAuto(memberId: string): Command {
  return { label: 'חיבורי המשך — אוטומטי', run: (p) => { const n = clone(p); delete n.splices[memberId]; return n; } };
}

/**
 * התאמת חתכים לפי הערכת הגדלים (כללי אצבע): לכל תפקיד — הגודל הקטן ביותר שמסומן "סביר" באותה משפחה,
 * ואחריו התאמת פלטת ראש העמוד לחתכים החדשים. הערכה בלבד — לא תכן סטטי.
 */
export function applySizingSuggestion(): Command {
  return {
    label: 'התאמת חתכים לפי כללי אצבע',
    run: (p0) => {
      let n = clone(p0);
      const fam = (name: string) => tryProfile(name)?.family ?? '';
      const namesOf = (f: string) => catalogNames().find((g) => g.family === f)?.names ?? [];
      const b = n.building;
      for (const [role, key] of [['column', 'columnProfile'], ['rafter', 'rafterProfile']] as const) {
        const d = generate(n);
        const s = suggestSize(n, d, role, fam(b[key]), namesOf(fam(b[key])));
        if (s) n.building[key] = s;
      }
      {
        const d = generate(n);
        const pu = n.building.purlins;
        const cur = pu.left.profile;
        const s = suggestSize(n, d, 'purlin', fam(cur), namesOf(fam(cur)).filter((x) => /^[A-Z]+\d+x\d+/.test(x)));
        if (s) { pu.left.profile = s; pu.right.profile = s; if (pu.planes) for (const k of Object.keys(pu.planes)) pu.planes[k].profile = s; }
      }
      // קושרות גג וקירות: הזוויתן הקטן ביותר שעומד בתמירות
      for (const [prefix, key] of [['BR.R', 'roof'], ['BR.W', 'walls']] as const) {
        const br = n.building.bracing[key];
        if (!br?.enabled) continue;
        const d = generate(n);
        const f0 = fam(br.profile);
        const names = namesOf(f0).filter((x) => /^[A-Z]+\d+x\d+(x[\d.]+)?$/.test(x));
        const num = (x: string) => x.replace(/^[A-Z]+/, '').split('x').map(Number);
        names.sort((a, b2) => { const A = num(a), B = num(b2); return A[0] - B[0] || (A[2] ?? A[1]) - (B[2] ?? B[1]); });
        // רגל מינימלית 50 — מקום לשורת ברגים בפח החיבור
        const ok = names.filter((x) => num(x)[0] >= 50).find((x) => { try { return assessBraceCandidate(n, d, prefix, x).status !== 'small'; } catch { return false; } });
        if (ok) br.profile = ok;
      }
      // פלטת ראש עמוד ופלטת בסיס מותאמות לחתכים
      const slope = Math.abs(n.building.slopeLeftPct ?? 0) / 100;
      const cos = 1 / Math.sqrt(1 + slope * slope);
      const e = n.connectionDefaults.eave;
      const sg = suggestEavePlate(e, n.building.rafterProfile, n.building.columnProfile, cos);
      n.connectionDefaults.eave = { ...e, ...sg };
      const cp = tryProfile(n.building.columnProfile);
      if (cp) {
        const bs = n.connectionDefaults.base, up5 = (x: number) => Math.ceil(x / 5) * 5;
        const l = up5(Math.max(bs.l, cp.props.h + 2 * bs.weldSize + 20)), w = up5(Math.max(bs.w, cp.props.b + 2 * bs.weldSize + 20));
        const eE = (bs.l - (bs.rows - 1) * bs.pitch) / 2, eW = (bs.w - (bs.cols - 1) * bs.gauge) / 2;
        n.connectionDefaults.base = { ...bs, l, w, pitch: bs.rows > 1 ? Math.round((l - 2 * eE) / (bs.rows - 1)) : bs.pitch, gauge: bs.cols > 1 ? Math.round((w - 2 * eW) / (bs.cols - 1)) : bs.gauge };
      }
      n = clone(n);
      return n;
    },
  };
}

/**
 * דילול עמודים: מעמודים שנבחרו — רצפים בכל שורה; לכל רצף קורה נושאת בין העמודים הסמוכים שנותרו.
 * עמוד ראשון/אחרון בשורה לא ניתן לבטל (אין תמיכה לקורה). מוזג עם קורות נושאות קיימות באותה שורה.
 */
export function planOmissions(p: Project, columnIds: string[]): { defs: TransferDef[]; errors: string[] } {
  const d = generate(p);
  const fr = [...p.building.frames].sort((a, b) => a.y - b.y);
  const errors: string[] = [];
  const byLine = new Map<string, Set<string>>();
  for (const id of columnIds) {
    const m = d.byId.get(id);
    if (!m || m.kind !== 'column' || !m.lineId || !m.frameId) continue;
    byLine.set(m.lineId, (byLine.get(m.lineId) ?? new Set()).add(m.frameId));
  }
  // עמודים שכבר בוטלו בשורה — נכללים ברצף
  for (const t of p.building.transfers ?? []) for (const f of t.removed) byLine.set(t.lineId, (byLine.get(t.lineId) ?? new Set()).add(f));
  const defs: TransferDef[] = [];
  const ipe = catalogNames().find((g) => g.family === 'IPE')?.names ?? [];
  for (const [lineId, set] of byLine) {
    const idx = fr.map((f, i) => (set.has(f.id) ? i : -1)).filter((i) => i >= 0);
    let k = 0;
    while (k < idx.length) {
      let j = k; while (j + 1 < idx.length && idx[j + 1] === idx[j] + 1) j++;
      const a = idx[k] - 1, b2 = idx[j] + 1;
      const label = d.section?.lines.find((l) => l.id === lineId)?.label ?? lineId;
      if (a < 0 || b2 >= fr.length) errors.push(`שורה ${label}: לא ניתן לבטל את העמוד הראשון/האחרון בשורה — אין עמוד שיתמוך בקורה הנושאת`);
      else {
        const old = (p.building.transfers ?? []).find((t) => t.lineId === lineId && t.removed.some((f) => idx.slice(k, j + 1).includes(fr.findIndex((q) => q.id === f))));
        const def: TransferDef = { id: old?.id ?? `${lineId}${fr[a].id}`, lineId, from: fr[a].id, to: fr[b2].id, removed: idx.slice(k, j + 1).map((i) => fr[i].id), profile: old?.profile ?? 'IPE400', support: old?.support ?? 'A1', seat: old?.seat ?? 'B1' };
        if (!old) def.profile = suggestTransferProfile(p, d, def, ipe) ?? 'IPE600';
        defs.push(def);
      }
      k = j + 1;
    }
  }
  return { defs, errors };
}

export function setTransfers(defs: TransferDef[], label = 'דילול עמודים — קורות נושאות'): Command {
  return { label, run: (p) => { const n = clone(p); n.building.transfers = defs.length ? clone(defs) : undefined; return n; } };
}

/** שמירת פרט מותאם בספריית הפרויקט (הוספה או עדכון לפי מזהה) */
export function saveDetail(det: CustomDetail): Command {
  return {
    label: `שמירת פרט "${det.name}"`,
    run: (p) => {
      if (!det.name.trim()) throw new CommandError('לפרט חייב להיות שם');
      const n = clone(p);
      const list = n.customDetails ?? [];
      const i = list.findIndex((x) => x.id === det.id);
      if (i >= 0) list[i] = clone(det); else list.push(clone(det));
      n.customDetails = list;
      return n;
    },
  };
}
/** הוספת כמה פרטים לספרייה בפעולה אחת (ייבוא קובץ ספרייה) */
export function addDetails(list: CustomDetail[]): Command {
  return {
    label: `ייבוא ${list.length} פרטים לספרייה`,
    run: (p) => {
      if (!list.length) throw new CommandError('אין פרטים בקובץ');
      const n = clone(p);
      const have = new Set((n.customDetails ?? []).map((x) => x.id));
      if (list.some((x) => have.has(x.id))) throw new CommandError('מזהה פרט כפול');
      n.customDetails = [...(n.customDetails ?? []), ...clone(list)];
      return n;
    },
  };
}
/** מחיקת פרט מהספרייה — ושחרור כל הקצוות שהשתמשו בו (חזרה לפרט הרגיל) */
export function deleteDetail(id: string): Command {
  return {
    label: 'מחיקת פרט מהספרייה',
    run: (p) => {
      const n = clone(p);
      n.customDetails = (n.customDetails ?? []).filter((x) => x.id !== id);
      const released = Object.entries(n.detailAssign ?? {}).filter(([, v]) => v === id).map(([k]) => k);
      n.detailAssign = Object.fromEntries(Object.entries(n.detailAssign ?? {}).filter(([, v]) => v !== id));
      n.detailParams = dropKeys(n.detailParams, released);
      return n;
    },
  };
}
/** שיוך פרט לקצוות אלמנטים ("מזהה|start/end"). detail=null — חזרה לפרט הרגיל. הפרט נשמר בספרייה. */
export function assignDetail(keys: string[], det: CustomDetail | null): Command {
  return {
    label: det ? `החלת פרט "${det.name}" על ${keys.length} קצוות` : `ביטול פרט מותאם ב-${keys.length} קצוות`,
    run: (p) => {
      let n = det ? saveDetail(det).run(p) : clone(p);
      if (n === p) n = clone(p);
      const a = { ...(n.detailAssign ?? {}) };
      const changed: string[] = [];
      for (const k of keys) { if (a[k] !== det?.id) changed.push(k); if (det) a[k] = det.id; else delete a[k]; }
      n.detailAssign = a;
      // ערכי מופע שייכים לפרט שנבחר — החלפת פרט (או חזרה לפרט הרגיל) מאפסת אותם
      n.detailParams = dropKeys(n.detailParams, changed);
      return n;
    },
  };
}

/** הסרת מפתחות אתר מאובייקט ערכי המופע (מחזיר undefined כשנשאר ריק — השדה אופציונלי) */
function dropKeys(m: Project['detailParams'], keys: string[]): Project['detailParams'] {
  if (!m) return m;
  const r = Object.fromEntries(Object.entries(m).filter(([k]) => !keys.includes(k)));
  return Object.keys(r).length ? r : undefined;
}

/**
 * ערך פרמטר למופע (מתכון v2) בקצוות נתונים. value=null — חזרה לברירת המחדל של הפרט.
 * הערך נשמר רק עבור הקצוות האלה; תבנית הפרט בספרייה לא משתנה.
 */
export function setDetailParam(keys: string[], name: string, value: number | null): Command {
  return {
    label: value === null ? `פרמטר "${name}" — חזרה לברירת מחדל` : `פרמטר "${name}" = ${value} (${keys.length > 1 ? `${keys.length} קצוות` : 'קצה אחד'})`,
    run: (p) => {
      if (value !== null && !Number.isFinite(value)) throw new CommandError('ערך הפרמטר חייב להיות מספר');
      const n = clone(p);
      const all = { ...(n.detailParams ?? {}) };
      for (const k of keys) {
        if (!n.detailAssign?.[k]) continue; // אין פרט מותאם בקצה — אין למה לשמור ערכים
        const cur = { ...(all[k] ?? {}) };
        if (value === null) delete cur[name]; else cur[name] = value;
        if (Object.keys(cur).length) all[k] = cur; else delete all[k];
      }
      n.detailParams = Object.keys(all).length ? all : undefined;
      return n;
    },
  };
}
/** איפוס כל ערכי המופע בקצוות — חזרה לברירות המחדל של הפרט */
export function resetDetailParams(keys: string[]): Command {
  return { label: `איפוס פרמטרי פרט ב-${keys.length} קצוות`, run: (p) => { const n = clone(p); n.detailParams = dropKeys(n.detailParams, keys); return n; } };
}
/**
 * "עדכן תבנית": קובע את ברירת המחדל של משתנה בפרט בספרייה (כל הקצוות שאין להם ערך משלהם משתנים).
 * הנוסחה מוחלפת במספר — לכן רק לפרמטרים מסוג מספר/בחירה/מתג.
 */
export function setDetailTemplateVar(detailId: string, name: string, value: number): Command {
  return {
    label: `עדכון תבנית: ${name} = ${value}`,
    run: (p) => {
      if (!Number.isFinite(value)) throw new CommandError('ערך הפרמטר חייב להיות מספר');
      const n = clone(p);
      const det = (n.customDetails ?? []).find((x) => x.id === detailId);
      const v = det?.vars.find((x) => x.name === name);
      if (!det || !v) throw new CommandError('הפרט או המשתנה לא נמצאו בספרייה');
      v.expr = String(value);
      return n;
    },
  };
}

/** שינוי בכל תושבות הפטות (כל השיפועים) — סוג התושבת, תושבת תפר וכד'; מבטל את אותו שדה בהתאמות בודדות */
export function setCleatEverywhere(patch: Partial<CleatParams>, label = 'עדכון סוג כל תושבות הפטות'): Command {
  return {
    label,
    run: (p) => {
      const n = clone(p);
      const pu = n.building.purlins;
      pu.left = { ...pu.left, cleat: { ...pu.left.cleat, ...clone(patch) } };
      pu.right = { ...pu.right, cleat: { ...pu.right.cleat, ...clone(patch) } };
      if (pu.planes) pu.planes = Object.fromEntries(Object.entries(pu.planes).map(([k, v]) => [k, { ...v, cleat: { ...v.cleat, ...clone(patch) } }]));
      const keys = Object.keys(patch);
      n.cleatOverrides = Object.fromEntries(Object.entries(n.cleatOverrides).map(([k, o]) => [k, Object.fromEntries(Object.entries(o).filter(([f]) => !keys.includes(f)))]).filter(([, o]) => Object.keys(o).length));
      return n;
    },
  };
}
/** החלפת סוג חיבור: מבטל פרטים מותאמים בקצוות/תושבות, ואז מבצע פקודה (סוג מובנה) */
export function withDetailCleared(keys: string[], inner: Command | null, label: string): Command {
  return {
    label,
    run: (p) => {
      let n = clone(p);
      if (n.detailAssign) n.detailAssign = Object.fromEntries(Object.entries(n.detailAssign).filter(([k]) => !keys.includes(k)));
      n.detailParams = dropKeys(n.detailParams, keys);
      if (inner) n = inner.run(n);
      return n;
    },
  };
}

/** עקיבות חומר: ליטים והקצאות (1.106) — מחליף את כל המבנה; `assign` מנוקה מהפניות לליטים שנמחקו */
export function setTraceability(t: { lots: StockLot[]; assign: Record<string, string> }): Command {
  return {
    label: 'עקיבות חומר',
    run: (p) => {
      const n = clone(p);
      const ids = new Set(t.lots.map((l) => l.id));
      n.traceability = { lots: t.lots, assign: Object.fromEntries(Object.entries(t.assign).filter(([, id]) => ids.has(id))) };
      return n;
    },
  };
}

/** לחיות צומת של מסבך (גג/נושא) לפי מזהה חיבור המסבך — `geometry/trussNode.ts`; בלי מסבך כזה — אין שינוי */
export function setTrussNodeCheeks(connId: string, patch: Partial<NonNullable<TrussSpec['nodeCheeks']>>): Command {
  return { label: 'צמתי מסבך', run: (p) => withNodeCheeks(p, connId, patch) ?? p };
}
