import { add, rotateAxis, sub, v3, type Vec3 } from '../core/vec';
import { degToRad } from '../core/units';
import { generate, placementBasis } from '../geometry/generate';
import type { ApprovalStatus, BuildingParams, CleatParams, DrawingRecord, FrameDef, ManualMember, Member, MemberOverride, PlateConnParams, Project, PurlinSideParams, PurlinSystem } from '../model/types';
import { proposeSplices } from '../geometry/purlins';
import { commitNumbering, computeFabrication } from '../fab/marks';
import { hasErrors, validateBuilding } from '../model/validate';
import { tryProfile } from '../profiles/library';
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

/** עדכון פרמטרי פטות לצד אחד. פרמטרי צד אחד אינם משנים את הצד השני. */
export function setPurlinSide(side: 'left' | 'right', patch: Partial<PurlinSideParams>): Command {
  return {
    label: `עדכון פטות ${side === 'left' ? 'שמאל' : 'ימין'}`,
    run: (p) => {
      if (patch.profile !== undefined && !tryProfile(patch.profile)) throw new CommandError(`חתך לא מוכר: ${patch.profile}`);
      for (const k of ['first', 'spacing', 'edgeOffset'] as const) {
        if (patch[k] !== undefined && !Number.isFinite(patch[k])) throw new CommandError('ערך לא מספרי');
      }
      if (patch.spacing !== undefined && !(patch.spacing > 0)) throw new CommandError('מרווח פטות חייב להיות חיובי');
      if (patch.first !== undefined && patch.first < 0) throw new CommandError('מרחק ראשון לא יכול להיות שלילי');
      if (patch.edgeOffset !== undefined && patch.edgeOffset < 0) throw new CommandError('מרחק מהקצה לא יכול להיות שלילי');
      const n = clone(p);
      n.building.purlins[side] = { ...n.building.purlins[side], ...clone(patch) };
      const errs = generate(n).issues.filter((i) => i.severity === 'error' && i.code.startsWith('PURLIN'));
      if (errs.length) throw new CommandError(errs.map((e) => e.message).join('\n'));
      return n;
    },
  };
}

export function setPurlinSystem(patch: Partial<Pick<PurlinSystem, 'material' | 'monoStart' | 'splice' | 'pieceBays'>>): Command {
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
      if (sorted.length) n.splices[memberId] = sorted; else delete n.splices[memberId];
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
      const stock = p.settings.stockLength;
      for (const id of ids) {
        const m = d.byId.get(id);
        if (!m) continue;
        const L = Math.hypot(m.end.x - m.start.x, m.end.y - m.start.y, m.end.z - m.start.z);
        let ts: number[];
        if (m.purlin) {
          const sup = d.supports.filter((s) => s.purlinId === id).map((s) => s.p.y - m.start.y).sort((a, b) => a - b);
          const nb = p.building.purlins.pieceBays ?? 0;
          // אורך קטע לפי מספר מפתחים (החלטת משתמש): תפר מעל כל N מסגרות
          ts = nb > 0 ? sup.filter((_, i) => i > 0 && i < sup.length - 1 && i % nb === 0) : proposeSplices(L, stock, sup);
        } else {
          const k = Math.ceil(L / stock);
          ts = k > 1 ? Array.from({ length: k - 1 }, (_, i) => (L * (i + 1)) / k) : [];
        }
        if (ts.length) n.splices[id] = ts; else delete n.splices[id];
      }
      return n;
    },
  };
}

/** עדכון פרמטרי תומך ברירת מחדל לצד, או לתומך בודד (cleatId). */
export function setCleat(side: 'left' | 'right', patch: Partial<CleatParams>, cleatId?: string): Command {
  return {
    label: cleatId ? `עדכון תומך ${cleatId}` : `עדכון תומכי פטות ${side === 'left' ? 'שמאל' : 'ימין'}`,
    run: (p) => {
      for (const [k, v] of Object.entries(patch)) {
        if (typeof v === 'number' && !(v > 0) && k !== 'holeHeight') throw new CommandError('ערך חייב להיות חיובי');
      }
      if (patch.rows !== undefined && !(Number.isInteger(patch.rows) && patch.rows >= 1 && patch.rows <= 4)) throw new CommandError('מספר שורות 1–4');
      if (patch.perRow !== undefined && !(Number.isInteger(patch.perRow) && patch.perRow >= 1 && patch.perRow <= 6)) throw new CommandError('ברגים בשורה 1–6');
      const n = clone(p);
      if (cleatId) n.cleatOverrides[cleatId] = { ...(n.cleatOverrides[cleatId] ?? {}), ...clone(patch) };
      else n.building.purlins[side].cleat = { ...n.building.purlins[side].cleat, ...clone(patch) };
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
export function setConnectionDefault(type: 'eave' | 'ridge' | 'base', patch: Partial<PlateConnParams>): Command {
  return {
    label: 'עדכון ברירת מחדל לחיבורים',
    run: (p) => {
      checkPlate(patch);
      const n = clone(p);
      n.connectionDefaults[type] = { ...n.connectionDefaults[type], ...clone(patch), bolt: { ...n.connectionDefaults[type].bolt, ...(patch.bolt ?? {}) } };
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
      const cur = n.drawings.find((x) => x.id === id) ?? { ...base, sheet: 'A3' as const, status: 'draft' as const, rev: p.revision.current, history: [] };
      const next = { ...cur, ...patch };
      if (patch.status && patch.status !== cur.status) next.history = [...cur.history, { rev: next.rev, date: new Date().toISOString(), status: patch.status, note }];
      n.drawings = [...n.drawings.filter((x) => x.id !== id), next];
      return n;
    },
  };
}
