import type { Connection, DerivedModel, Project } from './types';
import { tryProfile } from '../profiles/library';
import { defaultKneeBraces, kneeDetail } from '../geometry/knee';
import { defaultRafterStruts } from '../geometry/rafterStruts';

/**
 * רישום סוגי פרט (1.42): לכל משפחת חיבור — זיהוי מצב מהמודל, סוגי פרט עם התאמה ("מתאים / עם הערה / לא מתאים" + סיבה),
 * סכמת פרמטרים, קריאה והחלה בהיקף (חיבור זה / כל החיבורים באותו מצב). הספרייה: הגדרות שמורות בפרויקט הפתוח.
 */
export type ConnFamily = 'knee' | 'strut' | 'base';
export type Fit = { status: 'ok' | 'warn' | 'no'; reason: string };
export interface ParamDef { key: string; label: string; unit?: string; options?: { v: string | number; t: string }[]; min?: number }
export type Params = Record<string, string | number>;
export interface Situation {
  family: ConnFamily; connId: string; title: string;
  facts: { k: string; v: string }[];
  /** מפתח המצב — חיבורים עם אותו מפתח נערכים יחד */
  key: string; sameCount: number;
  memberFamily?: string; hostFamily?: string;
  /** מפתח מיקום לחריג (מפתח-צד באלכסונים, שורה בתמוכות, מזהה חיבור בבסיס) */
  local: string;
}
export interface DetailType {
  id: string; family: ConnFamily; title: string; desc: string; pic: string;
  fit: (s: Situation) => Fit;
  params: ParamDef[];
}
export interface ConnPreset { id: string; family: ConnFamily; detail: string; name: string; params: Params }

const HOLLOW = ['RHS', 'SHS', 'CHS'];
const fam = (name?: string) => (name ? tryProfile(name)?.family ?? '' : '');

export const DETAIL_TYPES: DetailType[] = [
  { id: 'knee.angle', family: 'knee', title: 'זוויתן מוברג לפח', desc: 'פח מרותך למארח (מסגריה), הזוויתן מוברג ישירות לפח בשטח', pic: 'angle',
    fit: (s) => (s.memberFamily === 'L' ? { status: 'ok', reason: 'זוויתן — מוברג ישירות לפח' } : { status: 'no', reason: 'דורש זוויתן (L) — האלמנט ' + (s.memberFamily || '?') }),
    params: [{ key: 'plateT', label: 'עובי פח', unit: 'מ"מ', min: 6 }, { key: 'boltsPerEnd', label: 'ברגים בקצה', options: [{ v: 2, t: '1' }, { v: 4, t: '2' }, { v: 6, t: '3' }] }, { key: 'boltD', label: 'קוטר בורג', options: [12, 16, 20].map((d) => ({ v: d, t: `M${d}` })) }] },
  { id: 'knee.fin', family: 'knee', title: 'פח + לשונית בחריץ', desc: 'פח מרותך למארח, לשונית מרותכת בחריץ הפרופיל; מוברגים בחפיפה בשטח', pic: 'fin',
    fit: (s) => (HOLLOW.includes(s.memberFamily ?? '') ? { status: 'ok', reason: 'פרופיל חלול — לשונית בחריץ' } : { status: 'no', reason: 'דורש פרופיל חלול (RHS/SHS/CHS)' }),
    params: [{ key: 'plateT', label: 'עובי פח ולשונית', unit: 'מ"מ', min: 6 }, { key: 'boltsPerEnd', label: 'ברגים בקצה', options: [2, 4, 6].map((n) => ({ v: n, t: String(n) })) }, { key: 'boltD', label: 'קוטר בורג', options: [12, 16, 20].map((d) => ({ v: d, t: `M${d}` })) }] },
  { id: 'knee.flange', family: 'knee', title: 'פלטת קצה לאגף', desc: 'פלטת קצה מרותכת לאלכסון, 4 ברגים לאגף העמוד ולאגף התחתון של הקורה', pic: 'flange',
    fit: (s) => (HOLLOW.includes(s.hostFamily ?? '') ? { status: 'warn', reason: 'עמוד חלול — אין גישה לאום מבפנים; נדרשים ברגים חד-צדדיים' } : { status: 'ok', reason: 'מארח פתוח — גישה לאום' }),
    params: [{ key: 'plateT', label: 'עובי פלטה', unit: 'מ"מ', min: 6 }, { key: 'boltD', label: 'קוטר בורג', options: [12, 16, 20].map((d) => ({ v: d, t: `M${d}` })) }] },
  { id: 'strut.endplate', family: 'strut', title: 'פלטת קצה מוברגת', desc: 'פלטה מרותכת לתמוכה, מוברגת לווב הקורה; משני צדי קורה — אותם ברגים', pic: 'endplate',
    fit: () => ({ status: 'ok', reason: 'מתאים לכל חתך' }),
    params: [{ key: 'plateT', label: 'עובי פלטה', unit: 'מ"מ', min: 6 }, { key: 'bolts', label: 'ברגים בקצה', options: [2, 4].map((n) => ({ v: n, t: String(n) })) }, { key: 'boltD', label: 'קוטר בורג', options: [12, 16, 20].map((d) => ({ v: d, t: `M${d}` })) }] },
  { id: 'strut.fin', family: 'strut', title: 'פח + לשונית', desc: 'פח מרותך לווב, לשונית בחריץ ה-RHS, מוברגים בחפיפה', pic: 'fin',
    fit: (s) => (HOLLOW.includes(s.memberFamily ?? '') ? { status: 'ok', reason: 'פרופיל חלול' } : { status: 'no', reason: 'דורש פרופיל חלול' }),
    params: [{ key: 'plateT', label: 'עובי פח ולשונית', unit: 'מ"מ', min: 6 }, { key: 'bolts', label: 'ברגים בקצה', options: [2, 4].map((n) => ({ v: n, t: String(n) })) }, { key: 'boltD', label: 'קוטר בורג', options: [12, 16, 20].map((d) => ({ v: d, t: `M${d}` })) }] },
  { id: 'strut.weld', family: 'strut', title: 'ריתוך ישיר', desc: 'ריתוך היקפי לווב בשטח — ללא פחים וברגים', pic: 'weld',
    fit: () => ({ status: 'warn', reason: 'ריתוך בשטח — נדרש תיקון גלוון' }), params: [] },
  { id: 'base.embedded', family: 'base', title: 'פלטה מבוטנת', desc: 'פלטה עם מוטות עיגון מבוטנת; העמוד מרותך בשטח', pic: 'baseEmbedded',
    fit: () => ({ status: 'warn', reason: 'ריתוך בשטח — נדרש תיקון גלוון' }), params: [{ key: 't', label: 'עובי פלטה', unit: 'מ"מ', min: 8 }, { key: 'anchorLength', label: 'אורך עיגון', unit: 'מ"מ' }] },
  { id: 'base.bolted', family: 'base', title: 'ברגי עיגון', desc: 'פלטה מרותכת לעמוד במסגריה, ברגי עיגון בשטח', pic: 'baseBolted',
    fit: () => ({ status: 'ok', reason: 'הכל בברגים בשטח' }), params: [{ key: 't', label: 'עובי פלטה', unit: 'מ"מ', min: 8 }, { key: 'anchorLength', label: 'אורך עיגון', unit: 'מ"מ' }] },
  { id: 'base.pile', family: 'base', title: 'טמון בכלונס', desc: 'העמוד טמון בכלונס — ללא פלטה ועיגון', pic: 'basePile',
    fit: () => ({ status: 'ok', reason: 'כלונס / ביסוס עם שרוול' }), params: [{ key: 'pileEmbed', label: 'עומק הטמנה', unit: 'מ"מ', min: 0 }] },
];
export const detailById = (id: string) => DETAIL_TYPES.find((t) => t.id === id);

/** משפחת חיבור לפי מזהה */
export function familyOf(c: Pick<Connection, 'id' | 'type'>): ConnFamily | null {
  if (c.id.startsWith('C.KB.')) return 'knee';
  if (/^C\.RS\d+\./.test(c.id)) return 'strut';
  if (c.type === 'base') return 'base';
  return null;
}

/** זיהוי המצב של חיבור מהמודל */
export function situationOf(p: Project, d: DerivedModel, connId: string): Situation | null {
  const c = d.connById.get(connId);
  if (!c) return null;
  const f = familyOf(c);
  if (!f) return null;
  const lab = (lid: string) => d.section?.lines.find((l) => l.id === lid)?.label ?? lid;
  if (f === 'knee') {
    const br = d.byId.get(c.parts[0]); const col = d.byId.get(c.members[0]), raf = d.byId.get(c.members[1]);
    const key = c.id.split('.').slice(3).join('.');
    const v = br ? { x: br.end.x - br.start.x, z: br.end.z - br.start.z } : { x: 1, z: 1 };
    const ang = Math.round((Math.atan2(Math.abs(v.z), Math.abs(v.x)) * 180) / Math.PI);
    const mf = fam(br?.profile), hf = fam(col?.profile);
    const same = d.connections.filter((x) => x.id.startsWith('C.KB.') && fam(d.byId.get(x.parts[0])?.profile) === mf).length;
    return { family: f, connId, local: key, title: `אלכסון עמוד-קורה · ציר ${lab(key.split('.')[0])}`, memberFamily: mf, hostFamily: hf, key: `knee|${mf}|${hf}`, sameCount: same,
      facts: [{ k: 'מארח 1', v: `עמוד ${col?.profile ?? '?'}${HOLLOW.includes(hf) ? ' · דופן חלול' : ''}` }, { k: 'מארח 2', v: `קורה ${raf?.profile ?? '?'} · אגף תחתון` }, { k: 'אלמנט', v: `${br?.profile ?? '?'} (משפחה ${mf || '?'})` }, { k: 'זווית', v: `${ang}° מהאופק` }, { k: 'מישור', v: 'במישור המסגרת' }] };
  }
  if (f === 'strut') {
    const m = /^C\.RS(\d+)\./.exec(c.id)!; const row = (p.building.bracing.rafterStruts?.rows ?? [])[Number(m[1]) - 1];
    const st = d.byId.get(c.members[1] ?? ''), raf = d.byId.get(c.members[0]);
    const mf = fam(st?.profile);
    return { family: f, connId, local: row?.id ?? '', title: 'תמוכה בין קורות', memberFamily: mf, hostFamily: fam(raf?.profile), key: `strut|${mf}`, sameCount: d.connections.filter((x) => /^C\.RS\d+\./.test(x.id)).length,
      facts: [{ k: 'מארח', v: `ווב קורה ${raf?.profile ?? '?'}` }, { k: 'אלמנט', v: `${st?.profile ?? '?'}` }, { k: 'זווית', v: '90° לווב' }, { k: 'מישור', v: 'אופקי, לאורך המבנה' }] };
  }
  const col = d.byId.get(c.members[0]);
  return { family: f, connId, local: connId, title: 'בסיס עמוד', memberFamily: fam(col?.profile), key: 'base', sameCount: d.connections.filter((x) => x.type === 'base').length,
    facts: [{ k: 'אלמנט', v: `עמוד ${col?.profile ?? '?'}` }, { k: 'מארח', v: 'יסוד / כלונס' }] };
}

/** הפרט הנוכחי והפרמטרים (כלליים, או של המיקום אם יש חריג) */
export function readCurrent(p: Project, s: Situation): { detail: string; params: Params; local: boolean } {
  const b = p.building;
  if (s.family === 'knee') {
    const kb = b.kneeBraces ?? defaultKneeBraces();
    const ov = kb.sides?.[s.local];
    const det = kneeDetail(ov?.detail ?? kb.detail, s.memberFamily ?? '');
    return { detail: `knee.${det}`, local: !!ov?.detail, params: { plateT: kb.plateT, boltsPerEnd: kb.boltsPerEnd ?? 2, boltD: kb.bolt.d } };
  }
  if (s.family === 'strut') {
    const rs = b.bracing.rafterStruts ?? defaultRafterStruts();
    const row = rs.rows.find((r) => r.id === s.local);
    return { detail: `strut.${row?.detail ?? rs.detail ?? 'endplate'}`, local: !!row?.detail, params: { plateT: rs.plateT, bolts: rs.bolts ?? 2, boltD: rs.bolt.d } };
  }
  const base = { ...p.connectionDefaults.base, ...(p.connectionOverrides[s.connId] ?? {}) };
  return { detail: `base.${base.mode ?? 'embedded'}`, local: !!p.connectionOverrides[s.connId]?.mode, params: { t: base.t, anchorLength: base.anchorLength ?? 800, pileEmbed: base.pileEmbed ?? 600 } };
}

/** החלה: scope 'all' = כל החיבורים באותו מצב (ההגדרה הכללית; חריגים נשמרים), 'one' = המיקום הזה בלבד */
export function applyDetail(p: Project, s: Situation, detail: string, params: Params, scope: 'all' | 'one'): Project {
  const n: Project = structuredClone(p);
  const kind = detail.split('.')[1];
  const num = (k: string, dflt: number) => (params[k] === undefined || params[k] === '' ? dflt : Number(params[k]));
  if (s.family === 'knee') {
    const kb = n.building.kneeBraces ?? { ...defaultKneeBraces(), enabled: true };
    const det = kind as 'fin' | 'angle' | 'flange';
    if (scope === 'one') kb.sides = { ...(kb.sides ?? {}), [s.local]: { ...(kb.sides?.[s.local] ?? {}), detail: det } };
    else kb.detail = det;
    kb.plateT = num('plateT', kb.plateT); kb.boltsPerEnd = num('boltsPerEnd', kb.boltsPerEnd ?? 2); kb.bolt = { ...kb.bolt, d: num('boltD', kb.bolt.d) };
    n.building.kneeBraces = kb;
  } else if (s.family === 'strut') {
    const rs = n.building.bracing.rafterStruts ?? defaultRafterStruts();
    const det = kind as 'endplate' | 'fin' | 'weld';
    if (scope === 'one') rs.rows = rs.rows.map((r) => (r.id === s.local ? { ...r, detail: det } : r));
    else rs.detail = det;
    rs.plateT = num('plateT', rs.plateT); rs.bolts = num('bolts', rs.bolts ?? 2); rs.bolt = { ...rs.bolt, d: num('boltD', rs.bolt.d) };
    n.building.bracing.rafterStruts = rs;
  } else {
    const patch = { mode: kind as 'embedded' | 'bolted' | 'pile', t: num('t', n.connectionDefaults.base.t), anchorLength: num('anchorLength', n.connectionDefaults.base.anchorLength ?? 800), pileEmbed: num('pileEmbed', n.connectionDefaults.base.pileEmbed ?? 600) };
    if (scope === 'one') n.connectionOverrides[s.connId] = { ...(n.connectionOverrides[s.connId] ?? {}), ...patch };
    else n.connectionDefaults.base = { ...n.connectionDefaults.base, ...patch };
  }
  return n;
}

/** פרטים מוצעים: סוגי הפרט של המשפחה + הגדרות שמורות בספרייה, מדורגים (מתאים ← עם הערה ← לא מתאים) */
export function candidates(p: Project, s: Situation): { id: string; detail: string; title: string; desc: string; pic: string; fit: Fit; preset?: ConnPreset; isDefault?: boolean }[] {
  const lib = (p.connLibrary ?? []).filter((x) => x.family === s.family);
  type Cand = { id: string; detail: string; title: string; desc: string; pic: string; fit: Fit; preset?: ConnPreset; isDefault?: boolean };
  const out: Cand[] = [
    ...DETAIL_TYPES.filter((t) => t.family === s.family).map((t) => ({ id: t.id, detail: t.id, title: t.title, desc: t.desc, pic: t.pic, fit: t.fit(s) })),
    ...lib.map((x) => { const t = detailById(x.detail)!; return { id: x.id, detail: x.detail, title: x.name, desc: `הגדרה שמורה של "${t.title}"`, pic: t.pic, fit: t.fit(s), preset: x, isDefault: p.connDefaults?.[s.family] === x.id }; }),
  ];
  const rank = { ok: 0, warn: 1, no: 2 } as const;
  return out.sort((a, c) => rank[a.fit.status] - rank[c.fit.status] || (c.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0) || (a.preset ? 1 : 0) - (c.preset ? 1 : 0));
}
