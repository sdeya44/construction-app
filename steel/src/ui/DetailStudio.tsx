import { stackPlate, flushElementTo, growPlate, promoteToParam, type MateResult } from '../geometry/mates';
import { Help } from './fields';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { appendValue, FormulaBuilder, readable, toTokens, varLabel, type FxTarget } from './FormulaBuilder';
import * as THREE from 'three';
import { add, dot, len, scale, sub, type Vec3 } from '../core/vec';
import { generate } from '../geometry/generate';
import { memberSolid } from '../geometry/solid';
import { blankDetail, buildDetail, detailPresets, findSite, presetFits, parseSiteKey, partsToReplace, similarSites, siteKey, VAR_HELP, type DetailResult, type Site } from '../geometry/detail';
import { assignDetail, saveDetail } from '../commands/commands';
import type { CustomDetail, DetailOp, DetailParam, DetailRef, Member } from '../model/types';
import { store, useStore } from '../store';
import { tryProfile } from '../profiles/library';
import { Icon } from './icons';
import { PlateWizard } from './PlateWizard';

/**
 * סטודיו פרטי חיבור: בונים פרט מחלקים — גוררים מהמחסן (פחים, חיתוכים, חורים, ברגים, ריתוך) אל פנים של האלמנט,
 * המארח או פלטה קיימת. כל רכיב "נצמד" לפנים ושומר מרחקים בנוסחאות — לכן הפרט מתעדכן עם החתך, הזווית והצד.
 * מה שרואים כאן = מה שנבנה במודל (אותו מנוע).
 */
export function DetailStudio() {
  const key = useStore((s) => s.detailStudio);
  if (!key) return null;
  return <Studio key={key} siteKey={key} />;
}

type ToolId = 'plate:rect' | 'plate:tri' | 'plate:cham' | 'plate:round' | 'endplate' | 'cut' | 'slot' | 'vent' | 'holes' | 'bolts' | 'rod' | 'weld' | 'angle';
const TOOLS: [string, [ToolId, string, string][]][] = [
  ['פחים', [['plate:rect', 'פלטה מלבנית', 'rect'], ['plate:tri', 'גוסט משולש', 'tri'], ['plate:cham', 'פלטה עם קיטום', 'cham'], ['plate:round', 'פלטה עגולה', 'round']]],
  ['פלטות חכמות', [['endplate', 'פלטת קצה (ניצבת לאלמנט)', 'endplate']]],
  ['חיתוכים', [['cut', 'חיתוך במישור', 'cut'], ['slot', 'חריץ בפרופיל', 'slot'], ['vent', 'חורי אוורור', 'vent']]],
  ['מחברים', [['holes', 'חורים לברגים', 'holes'], ['bolts', 'ברגים', 'bolts'], ['rod', 'מוט הברגה', 'rod'], ['angle', 'זוויתן L', 'angle']]],
  ['ריתוך', [['weld', 'ריתוך (מסגריה)', 'weld']]],
];
const TOOL_ICON: Record<string, ReactNode> = {
  rect: <rect x="5" y="7" width="16" height="12" />, tri: <path d="M5 20V6l16 14z" />, cham: <path d="M5 6h10l6 6v8H5z" />, round: <circle cx="13" cy="13" r="8" />,
  endplate: <><rect x="4" y="4" width="5" height="18" /><path d="M9 9h13M9 17h13" /></>, cut: <><path d="M4 22L22 4" strokeDasharray="3 2" /><path d="M8 18l10-10" /></>,
  slot: <><rect x="4" y="8" width="18" height="10" /><path d="M4 13h9" strokeWidth="3" /></>, vent: <><rect x="4" y="7" width="18" height="12" /><circle cx="10" cy="13" r="2" /><circle cx="16" cy="13" r="2" /></>,
  holes: <><rect x="4" y="5" width="18" height="16" /><circle cx="9" cy="13" r="2.4" /><circle cx="17" cy="13" r="2.4" /></>, bolts: <><path d="M13 3v20" /><path d="M9 3h8v4H9zM9 17h8v3H9z" /></>,
  rod: <path d="M13 2v22M10 6l6 2M10 10l6 2M10 14l6 2M10 18l6 2" />, angle: <path d="M7 4v18h16v-5H12V4z" />, weld: <><path d="M4 20h18M4 20V6" /><path d="M4 20l6-6v6z" fill="currentColor" /></>,
};
const HINT: Record<string, string> = {
  plate: 'על כל פנים: האלמנט, המארח או פלטה', endplate: 'על האלמנט — נצמדת לקצה', cut: 'על האלמנט — במקום החיתוך', slot: 'על האלמנט', vent: 'על האלמנט',
  holes: 'על פלטה', bolts: 'על פלטה (חורים נוספים אוטומטית)', rod: 'על כל פנים', angle: 'על כל פנים: האלמנט, המארח או פלטה', weld: 'על פלטה — מרותכת למה שהיא יושבת עליו',
};
const OPNAME: Record<DetailOp['k'], string> = { plate: 'פלטה', endplate: 'פלטת קצה', cut: 'חיתוך', shift: 'הסטת קצה', slot: 'חריץ', vent: 'אוורור', holes: 'חורים', bolts: 'ברגים', rod: 'מוט הברגה', weld: 'ריתוך', angle: 'זוויתן' };
const PREFIX: Record<DetailOp['k'], string> = { plate: 'P', endplate: 'E', cut: 'C', shift: 'M', slot: 'S', vent: 'V', holes: 'H', bolts: 'B', rod: 'R', weld: 'W', angle: 'L' };
const FACE_NAME: Record<string, string> = { end: 'קצה', 'a+': 'דופן במישור +', 'a-': 'דופן במישור −', 'w+': 'דופן צד +', 'w-': 'דופן צד −', hit: 'פני המגע', opp: 'פנים נגדיות', web: 'ווב', 'z+': 'פנים +', 'z-': 'פנים −' };
const r5 = (x: number) => Math.round(x / 5) * 5;
/** פתיחת בונה הנוסחאות משדה כלשהו */
const FxCtx = createContext<{ open: (t: FxTarget) => void; det: CustomDetail | null }>({ open: () => {}, det: null });
/** תגית מידה: a,b על הגיאומטריה; c = מרכז הבעלים (הקו מוסט הרחק ממנו במסך); grp = פעולה (P1…) או 'site' */
interface Tag { k: string; a: Vec3; b: Vec3; c?: Vec3; grp?: string }
const fmt = (x: number | undefined) => (x === undefined || !Number.isFinite(x) ? '—' : String(Math.round(x * 10) / 10));

function Studio({ siteKey: key }: { siteKey: string }) {
  const project = useStore((s) => s.project);
  const studioConn = useStore((s) => s.studioConn);
  const { id } = parseSiteKey(key);
  // מודל בסיס ללא הפרט המותאם באתר הזה — רואים את האלמנט "נקי"
  const base = useMemo(() => { const a = { ...(project.detailAssign ?? {}) }; delete a[key]; return generate({ ...project, detailAssign: a }); }, [project, key]);
  const assignedId = project.detailAssign?.[key];
  const [det, setDetRaw] = useState<CustomDetail>(() => structuredClone(project.customDetails?.find((x) => x.id === assignedId) ?? blankDetail()));
  const hist = useRef<CustomDetail[]>([]);
  const setDet = (fn: (d: CustomDetail) => CustomDetail) => setDetRaw((d) => { hist.current.push(d); if (hist.current.length > 80) hist.current.shift(); return fn(structuredClone(d)); });
  const undo = () => { const p = hist.current.pop(); if (p) setDetRaw(p); };
  const [sel, setSel] = useState<string | null>(null);
  const [armed, setArmed] = useState<ToolId | null>(null);
  const [preview, setPreview] = useState<string>(key);
  const [scope, setScope] = useState<'one' | 'similar' | 'any'>('one');
  const [msg, setMsg] = useState<string>('');
  const [dragState, setDragState] = useState<{ x: number; y: number; lbl: string } | null>(null);
  const [fx, setFx] = useState<FxTarget | null>(null);
  const [fxTokens, setFxTokens] = useState<string[]>([]);
  const [showDims, setShowDims] = useState(true);
  const pKey = parseSiteKey(preview);
  const pMain = base.byId.get(pKey.id);
  const site = useMemo(() => (pMain ? findSite(base.members, pMain, pKey.end) : null), [base, pMain, pKey.end]);
  const others = useMemo(() => { if (!site) return []; const kill = partsToReplace(base.members, base.connections, site.main, site.E, site.O, site.cross?.conn); return base.members.filter((x) => !kill.has(x.id) && x.id !== site.main.id && x.id !== site.host?.id && x.kind !== 'bolt' && ['column', 'rafter', 'purlin', 'cleat', 'plate', 'brace', 'beam', 'girt'].includes(x.kind)
    && Math.min(len(sub(x.start, site.P)), len(sub(x.end, site.P)), len(sub(scale(add(x.start, x.end), 0.5), site.P))) < 900); }, [base, site]);
  const res = useMemo(() => (site ? buildDetail(site, det, { others }) : null), [site, det, others]);
  const similar = useMemo(() => ({ similar: similarSites(base.members, key, true, base.connections), any: similarSites(base.members, key, false, base.connections) }), [base, key]);
  const tags = useMemo<Tag[]>(() => {
    if (!site || !res) return [];
    const T: Tag[] = [], s = site;
    if (s.cross) {
      // תושבת פטה: גובה הפטה (לאורך נורמל הגג), רוחב האגף, ורוחב אגף הקורה (לאורך הפטה)
      const o = add(s.P, scale(s.w, -Math.max(220, s.mb * 2)));
      T.push({ k: 'mh', a: o, b: add(o, scale(s.u, s.mh)) });
      const o2 = add(add(s.P, scale(s.w, -Math.max(330, s.mb * 3))), scale(s.u, s.mh));
      T.push({ k: 'mb', a: o2, b: add(o2, scale(s.a, -s.mb)) });
      const hb = res.values.hb ?? 0;
      if (hb > 0) { const o3 = add(s.P, scale(s.a, Math.max(160, s.mb * 1.8))); T.push({ k: 'hb', a: add(o3, scale(s.w, -hb / 2)), b: add(o3, scale(s.w, hb / 2)) }); }
      for (const [id2, g] of res.plates) {
        const top = add(g.center, scale(g.Z, g.t / 2));
        T.push({ k: `${id2}.w`, a: add(add(top, scale(g.X, -g.w / 2)), scale(g.Y, -g.h / 2)), b: add(add(top, scale(g.X, g.w / 2)), scale(g.Y, -g.h / 2)), c: g.center, grp: id2 });
        T.push({ k: `${id2}.h`, a: add(add(top, scale(g.Y, -g.h / 2)), scale(g.X, g.w / 2)), b: add(add(top, scale(g.Y, g.h / 2)), scale(g.X, g.w / 2)), c: g.center, grp: id2 });
      }
      return T.map((t) => ({ ...t, c: t.c ?? s.P, grp: t.grp ?? 'site' }));
    }
    const c0 = add(s.P, scale(s.u, res.sEnd + Math.max(140, s.mh * 1.4)));
    T.push({ k: 'mh', a: add(c0, scale(s.a, -s.mh / 2)), b: add(c0, scale(s.a, s.mh / 2)) });
    const c1 = add(c0, scale(s.u, 90));
    T.push({ k: 'mb', a: add(c1, scale(s.w, -s.mb / 2)), b: add(c1, scale(s.w, s.mb / 2)) });
    if (s.host) {
      const fr = res.frame({ on: 'host', face: 'hit' });
      const hb = res.values.hb ?? 0;
      if (fr && hb > 0) { const b0 = add(fr.base, scale(fr.e1, -Math.max(180, s.mh * 2))); T.push({ k: 'hb', a: add(b0, scale(fr.e2, -hb / 2)), b: add(b0, scale(fr.e2, hb / 2)) }); }
      if (fr && s.hd > 0) { const b1 = add(fr.base, scale(fr.e1, -Math.max(320, s.mh * 3))); T.push({ k: 'hd', a: b1, b: add(b1, scale(fr.n, -s.hd)) }); }
    }
    for (const [id, g] of res.plates) {
      const top = add(g.center, scale(g.Z, g.t / 2));
      // 1.70: הנקודות על שפות הפלטה עצמה — ההיסט נקבע במסך, הרחק ממרכז הפלטה
      T.push({ k: `${id}.w`, a: add(add(top, scale(g.X, -g.w / 2)), scale(g.Y, -g.h / 2)), b: add(add(top, scale(g.X, g.w / 2)), scale(g.Y, -g.h / 2)), c: g.center, grp: id });
      T.push({ k: `${id}.h`, a: add(add(top, scale(g.Y, -g.h / 2)), scale(g.X, g.w / 2)), b: add(add(top, scale(g.Y, g.h / 2)), scale(g.X, g.w / 2)), c: g.center, grp: id });
    }
    return T.map((t) => ({ ...t, c: t.c ?? s.P, grp: t.grp ?? 'site' }));
  }, [site, res]);
  const fxGroups = useMemo(() => [
    { title: 'האלמנט', items: ['mh', 'mb', 'mt', 'mtf'] },
    { title: 'המארח', items: site?.host ? ['hb', 'hh', 'htf', 'htw', 'hd'] : [] },
    { title: 'זווית ואורך', items: ['ang', 'send'] },
    { title: 'פלטות', items: det.ops.filter((o) => o.k === 'plate' || o.k === 'endplate').flatMap((o) => [`${o.id}.w`, `${o.id}.h`, `${o.id}.t`]) },
    { title: 'משתנים שלי', items: det.vars.map((v) => v.name) },
  ], [det, site]);
  const openFx = (t: FxTarget) => { setFx(t); setFxTokens(toTokens(t.value)); };
  const onTag = (k: string) => { if (fx) setFxTokens((t) => appendValue(t, k)); else setMsg(`${varLabel(k, det)} — בשם "${k}". כדי להשתמש בו: לחצו ƒ ליד שדה ואז על המידה`); };
  curOps.current = det.ops;
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.matches?.('input,select,textarea')) return;
      if (e.key === 'Escape') { if (armed) setArmed(null); else close(); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel) delOp(sel);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  });
  const usedBy = Object.entries(project.detailAssign ?? {}).filter(([k, v]) => v === det.id && k !== key).length;
  const close = () => store.set({ detailStudio: null, studioConn: null });
  const main = base.byId.get(id);
  const live = store.state.derived;
  // אשף הפלטה (חלק מהסטודיו): החיבור הרגיל באתר הזה — לפי בחירה, או החיבור של האלמנט הקרוב לקצה
  const stdConn = (studioConn && live.connById.get(studioConn)) || (site ? live.connections.find((c) => c.type !== 'custom' && c.members.includes(id) && c.parts.some((pid) => { const pm = live.byId.get(pid); return !!pm && len(sub(scale(add(pm.start, pm.end), 0.5), site.P)) < 700; })) : undefined);
  if (!main || !site || !res) return (
    <div className="overlay"><div className="dialog wide"><header><h2>סטודיו פרטים{stdConn ? ` — ${stdConn.label}` : ''}</h2><button className="icon-btn" onClick={close} aria-label="סגירה" data-testid="ds-close"><Icon name="x" /></button></header>
      <div className="body">{stdConn ? <div data-testid="ds-plate-wizard"><PlateWizard c={stdConn} /></div> : 'לא נמצא אלמנט לקצה הזה.'}</div></div></div>
  );

  const nextId = (k: DetailOp['k']) => { let i = 1; while (det.ops.some((o) => o.id === `${PREFIX[k]}${i}`)) i++; return `${PREFIX[k]}${i}`; };
  const addOp = (op: DetailOp) => { setDet((d) => ({ ...d, ops: [...d.ops, op] })); setSel(op.id); };
  const patchOp = (opId: string, patch: Partial<DetailOp> & Record<string, unknown>) => setDet((d) => ({ ...d, ops: d.ops.map((o) => (o.id === opId ? ({ ...o, ...patch } as DetailOp) : o)) }));
  const delOp = (opId: string) => setDet((d) => {
    const kill = new Set([opId]);
    for (let ch = true; ch;) { ch = false; for (const o of d.ops) if (!kill.has(o.id) && ((('ref' in o) && kill.has(o.ref.on)) || (o.k === 'bolts' && kill.has(o.holes)) || (o.k === 'weld' && kill.has(o.part)))) { kill.add(o.id); ch = true; } }
    return { ...d, ops: d.ops.filter((o) => !kill.has(o.id)) };
  });
  const moveOp = (opId: string, dir: -1 | 1) => setDet((d) => { const i = d.ops.findIndex((o) => o.id === opId), j = i + dir; if (j < 0 || j >= d.ops.length) return d; const ops = [...d.ops]; [ops[i], ops[j]] = [ops[j], ops[i]]; return { ...d, ops }; });

  /** הנחת כלי על פגיעה בתלת-ממד */
  const place = (tool: ToolId, hit: Hit): boolean => {
    const err = (m: string) => { setMsg(m); return false; };
    const ref = refFromHit(hit, res, site, tool);
    if (!ref) return err('אי אפשר להניח כאן');
    if (tool.startsWith('plate:')) {
      const shape = tool.split(':')[1] as 'rect' | 'tri' | 'cham' | 'round';
      const onEnd = ref.on === 'main' && ref.face === 'end';
      addOp({ k: 'plate', id: nextId('plate'), ref, mode: onEnd || shape === 'tri' || shape === 'cham' ? 'stand' : 'flat', spin: '0', off: '0', shape, w: shape === 'tri' ? '150' : 'max(mb, hb) + 20', h: shape === 'tri' ? '150' : 'r5(mh/sin(ang))', t: '10', ch: shape === 'cham' ? '50' : '0', corners: [shape === 'cham', false, false, false] });
    } else if (site.cross && ['endplate', 'cut', 'slot', 'vent'].includes(tool)) {
      return err('בתושבת פטה הפטה רציפה — אין חיתוך, חריץ או פלטת קצה. בונים את התושבת מפחים על פני הקורה ופני הווב');
    } else if (tool === 'endplate') {
      if (hit.role !== 'main') return err(HINT.endplate);
      if (det.ops.some((o) => o.k === 'endplate')) return err('לקצה הזה כבר יש פלטת קצה');
      const ops: DetailOp[] = [];
      if (!det.ops.some((o) => o.k === 'cut')) ops.push({ k: 'cut', id: nextId('cut'), kind: 'perp', at: 'r5(mh/2/tan(ang)) + 20' });
      const eid = nextId('endplate');
      ops.push({ k: 'endplate', id: eid, t: '15', w: 'mh+40', h: 'mb+40', dx: '0', dy: '0' });
      setDet((d) => ({ ...d, ops: [...d.ops, ...ops] })); setSel(eid);
      if (ops.length > 1) setMsg('נוסף גם חיתוך ניצב — פלטת קצה צריכה קצה נקי');
    } else if (tool === 'cut') {
      if (hit.role !== 'main') return err(HINT.cut);
      const at = String(Math.max(10, r5(dot(sub(hit.p, site.P), site.u))));
      const ex = det.ops.find((o) => o.k === 'cut');
      if (ex) { patchOp(ex.id, { at }); setSel(ex.id); } else addOp({ k: 'cut', id: nextId('cut'), kind: 'perp', at });
    } else if (tool === 'slot') {
      if (hit.role !== 'main') return err(HINT.slot);
      addOp({ k: 'slot', id: nextId('slot'), L: '100', w: '12', dir: 'a' });
    } else if (tool === 'vent') {
      if (hit.role !== 'main') return err(HINT.vent);
      addOp({ k: 'vent', id: nextId('vent'), d: '12', at: '30' });
    } else if (tool === 'holes') {
      if (hit.role !== 'plate') return err(HINT.holes);
      addOp({ k: 'holes', id: nextId('holes'), ref, rows: '1', cols: '2', px: '60', py: '60', d0: 'd0' });
    } else if (tool === 'bolts') {
      if (hit.role !== 'plate') return err(HINT.bolts);
      let h = det.ops.find((o) => o.k === 'holes' && o.ref.on === ref.on);
      const ops: DetailOp[] = [];
      if (!h) { h = { k: 'holes', id: nextId('holes'), ref, rows: '1', cols: '2', px: '60', py: '60', d0: 'd0' }; ops.push(h); }
      if (det.ops.some((o) => o.k === 'bolts' && o.holes === h!.id)) return err('לחורים האלה כבר יש ברגים');
      const bid = nextId('bolts');
      ops.push({ k: 'bolts', id: bid, holes: h.id, d: 'd', grade: '8.8', site: true });
      setDet((d) => ({ ...d, ops: [...d.ops, ...ops] })); setSel(bid);
    } else if (tool === 'angle') {
      addOp({ k: 'angle', id: nextId('angle'), name: 'זוויתן', ref, H: '60', B: '60', t: '6', w: '100' });
    } else if (tool === 'rod') {
      addOp({ k: 'rod', id: nextId('rod'), ref, d: '20', L: '200' });
    } else if (tool === 'weld') {
      if (hit.role !== 'plate' || !hit.op) return err(HINT.weld);
      if (det.ops.some((o) => o.k === 'weld' && o.part === hit.op)) return err('הפלטה כבר מרותכת');
      addOp({ k: 'weld', id: nextId('weld'), part: hit.op, a: '5', site: false });
    }
    setMsg('');
    return true;
  };
  const moveSel = (opId: string, along: number, across: number) => {
    const op = det.ops.find((o) => o.id === opId);
    if (!op || !('ref' in op)) return;
    setDetRaw((d) => ({ ...d, ops: d.ops.map((o) => (o.id === op.id && 'ref' in o ? ({ ...o, ref: { ...o.ref, along: String(along), across: String(across) } } as DetailOp) : o)) }));
  };

  const keysFor = scope === 'one' ? [key] : scope === 'similar' ? similar.similar : similar.any;
  const errors = res.issues.filter((i) => i.severity === 'error');
  const inLib = project.customDetails?.find((x) => x.id === det.id);
  const changed = !!inLib && JSON.stringify(inLib) !== JSON.stringify(det);
  const apply = (asNew = false) => {
    let d = det;
    if (asNew) {
      const names = new Set((project.customDetails ?? []).map((x) => x.name));
      let nm = det.name; if (names.has(nm)) { let k = 2; while (names.has(`${det.name} (${k})`)) k++; nm = `${det.name} (${k})`; }
      d = { ...structuredClone(det), id: `cd-${Date.now().toString(36)}`, name: nm };
      setDetRaw(d);
    }
    store.exec(assignDetail(keysFor, d));
    setMsg(`הפרט "${d.name}" ${asNew ? 'נשמר כפרט חדש ו' : ''}הוחל על ${keysFor.length} קצוות${asNew && inLib ? ` — "${inLib.name}" נשאר בספרייה כמו שהיה` : ''}`);
  };
  const loadPreset = (p: CustomDetail, copy: boolean) => { setDet(() => (copy ? { ...structuredClone(p), id: `cd-${Date.now().toString(36)}` } : structuredClone(p))); setSel(null); };
  const ends: [string, string][] = site.cross ? [[key, `תושבת פטה על ${site.host?.label ?? ''}`]] : (['start', 'end'] as const).map((e) => { const s = findSite(base.members, main, e); return [siteKey(id, e), `${e === 'start' ? 'קצה התחלה' : 'קצה סוף'} — ${s?.host ? s.host.label : 'קצה חופשי'}`]; });

  return (
    <FxCtx.Provider value={{ open: openFx, det }}>
    <div className="studio" role="dialog" aria-label="סטודיו פרטי חיבור" data-testid="detail-studio">
      <header className="studio-h">
        <div className="studio-title">
          <b>סטודיו פרטים</b>
          <input className="inp" value={det.name} onChange={(e) => { const v = e.target.value; setDet((d) => ({ ...d, name: v })); }} aria-label="שם הפרט" data-testid="ds-name" />
          <select className="inp" value={key} onChange={(e) => store.set({ detailStudio: e.target.value })} aria-label="קצה">{ends.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <span className="muted">{main.label} · {main.profile}{site.host ? ` → ${site.host.profile}` : ''} · {Math.round(site.ang)}°</span>
        </div>
        <div className="ds-match" data-testid="ds-match">
          <label className="row" style={{ gap: 5 }}><input type="checkbox" data-testid="ds-match-on" checked={!!det.match} onChange={(e) => { const on = e.target.checked; setDet((d0) => ({ ...d0, match: on ? { member: [tryProfile(main.profile)?.family ?? ''].filter(Boolean), host: site.host ? [tryProfile(site.host.profile)?.family ?? ''].filter(Boolean) : [], angMin: Math.max(0, Math.round(site.ang) - 15), angMax: Math.min(90, Math.round(site.ang) + 15) } : undefined })); }} />להציע באשף החיבורים במצבים דומים</label>
          {det.match && <span className="ds-match-f">
            אלמנט <input className="inp" style={{ width: 80 }} data-testid="ds-match-member" value={(det.match.member ?? []).join(',')} onChange={(e) => { const v = e.target.value.split(/[,\s]+/).filter(Boolean); setDet((d0) => ({ ...d0, match: { ...d0.match, member: v } })); }} />
            מארח <input className="inp" style={{ width: 80 }} data-testid="ds-match-host" value={(det.match.host ?? []).join(',')} onChange={(e) => { const v = e.target.value.split(/[,\s]+/).filter(Boolean); setDet((d0) => ({ ...d0, match: { ...d0.match, host: v } })); }} />
            זווית <input className="inp num" style={{ width: 52 }} type="number" data-testid="ds-match-a0" value={det.match.angMin ?? 0} onChange={(e) => { const v = Number(e.target.value); setDet((d0) => ({ ...d0, match: { ...d0.match, angMin: v } })); }} />–<input className="inp num" style={{ width: 52 }} type="number" data-testid="ds-match-a1" value={det.match.angMax ?? 90} onChange={(e) => { const v = Number(e.target.value); setDet((d0) => ({ ...d0, match: { ...d0.match, angMax: v } })); }} />°
          </span>}
        </div>
        <div className="studio-actions">
          <button className="btn" onClick={undo} title="ביטול פעולה אחרונה"><Icon name="undo" /> בטל</button>
          <button className="icon-btn" onClick={close} aria-label="סגירה" data-testid="ds-close"><Icon name="x" /></button>
        </div>
      </header>
      <div className="studio-body">
        <aside className="studio-lib" data-testid="ds-lib">
          {TOOLS.map(([g, ts]) => (
            <div className="sl-grp" key={g}><h4>{g}</h4>
              {ts.map(([tid, lbl, ic]) => (
                <button key={tid} className={`sl-tool${armed === tid ? ' on' : ''}`} data-testid={`ds-tool-${tid}`} title={HINT[tid.split(':')[0]]}
                  onPointerDown={(e) => startDrag(e, tid, lbl)} onClick={() => setArmed(armed === tid ? null : tid)}>
                  <svg viewBox="0 0 26 26">{TOOL_ICON[ic]}</svg><span>{lbl}</span>
                </button>
              ))}
            </div>
          ))}
          <div className="sl-grp"><h4>פרטים מוכנים</h4>
            {detailPresets().filter((p) => presetFits(p, site)).map((p) => <button key={p.id} className="sl-tool" title={p.note} data-testid={`ds-preset-${p.id}`} onClick={() => loadPreset(p, true)}><span>{p.name}</span></button>)}
          </div>
          {!!project.customDetails?.length && <div className="sl-grp"><h4>הספרייה שלי</h4>
            {project.customDetails.map((p) => <button key={p.id} className={`sl-tool${p.id === det.id ? ' on' : ''}`} onClick={() => loadPreset(p, false)}><span>{p.name}</span></button>)}
          </div>}
        </aside>
        <section className="studio-stage">
          <Viewer res={res} site={site} others={others} sel={sel} armed={armed} onSelect={setSel} onPlace={(h) => { if (armed && place(armed, h)) setArmed(null); }} onMove={moveSel}
            tags={showDims || fx ? (sel && !fx ? tags.filter((t) => t.grp === sel || t.grp === 'site') : tags) : []} tagLabel={(k) => `${varLabel(k, det)} = ${fmt(res.values[k])}`} onTag={onTag} pickMode={!!fx} />
          <button className={`btn small studio-dims${showDims ? ' on' : ''}`} onClick={() => setShowDims(!showDims)} data-testid="ds-dims">שמות מידות</button>
          <div className="studio-status" data-testid="ds-status">{msg || (fx ? 'בונה נוסחה: לחצו על תגית מידה בשרטוט כדי להוסיף אותה לנוסחה' : armed ? `כלי: ${TOOLS.flatMap((x) => x[1]).find((t) => t[0] === armed)?.[1]} — ${HINT[armed.split(':')[0]]} · לחיצה = הנחה, גרירה = סיבוב · Esc לביטול` : 'גררו כלי מהמחסן אל המודל, או לחצו על כלי ואז על המודל. גרירה על הרקע = סיבוב, גלגלת = זום')}</div>
          {preview !== key && <div className="studio-preview">תצוגה על קצה אחר: {base.byId.get(pKey.id)?.label} <button className="btn small" onClick={() => setPreview(key)}>חזרה</button></div>}
        </section>
        <aside className="studio-side">
          {stdConn && <details className="ss-card" open={!!studioConn} data-testid="ds-plate-wizard"><summary><h4 style={{ display: 'inline' }}>פלטות החיבור הקיים — {stdConn.label}</h4></summary><PlateWizard c={stdConn} /></details>}
          {fx && <FormulaBuilder target={fx} tokens={fxTokens} setTokens={setFxTokens} vars={res.values} det={det} groups={fxGroups} onClose={() => setFx(null)} />}
          <section className="ss-card"><h4>פעולות הפרט</h4>
            <ol className="ss-ops" data-testid="ds-ops">
              {det.ops.map((o) => (
                <li key={o.id} className={`${sel === o.id ? 'sel' : ''}${res.errors[o.id] || Object.keys(res.errors).some((k) => k.startsWith(`${o.id}.`)) ? ' bad' : ''}`} onClick={() => setSel(o.id)} data-testid={`ds-op-${o.id}`}>
                  <span className="mono">{o.id}</span> {OPNAME[o.k]}{o.k === 'plate' && o.name ? ` · ${o.name}` : ''}
                  <span className="ss-on">{'ref' in o ? `${o.ref.on === 'main' ? 'אלמנט' : o.ref.on === 'host' ? 'מארח' : o.ref.on} · ${FACE_NAME[o.ref.face] ?? o.ref.face}` : o.k === 'bolts' ? o.holes : o.k === 'weld' ? o.part : ''}</span>
                  <span className="ss-btns"><button onClick={(e) => { e.stopPropagation(); moveOp(o.id, -1); }} aria-label="למעלה">▲</button><button onClick={(e) => { e.stopPropagation(); moveOp(o.id, 1); }} aria-label="למטה">▼</button><button onClick={(e) => { e.stopPropagation(); delOp(o.id); if (sel === o.id) setSel(null); }} aria-label="מחיקה">✕</button></span>
                </li>
              ))}
              {!det.ops.length && <li className="muted">ריק — גררו כלי, או בחרו פרט מוכן.</li>}
            </ol>
          </section>
          {sel && det.ops.find((o) => o.id === sel) && <OpProps op={det.ops.find((o) => o.id === sel)!} det={det} res={res} patch={(p) => patchOp(sel, p)} mate={(fn) => { const r = fn(det); if ('error' in r) setMsg(r.error); else { setDet(() => r.det); setSel(r.sel); setMsg(''); } }} />}
          <VarsCard det={det} res={res} setDet={setDet} />
          <ParamsCard det={det} res={res} setDet={setDet} />
          <section className="ss-card"><h4>בדיקות</h4>
            <ul className="ss-checks" data-testid="ds-checks">
              {res.issues.filter((i) => i.severity !== 'info').map((i, k) => <li key={k} className={i.severity}>{i.message.replace(/^פרט [^:]*: /, '')}{i.code === 'CD_BOLT' && <span className="hint" data-testid="ds-hint-bolt"> ← הפלטות כנראה לא נפגשות: "פלטה זהה מעליה" או "הצמד את קצה האלמנט אליה" בפלטה שנבחרה.</span>}{i.studioFix && <> <button className="btn small" data-testid="ds-fix" onClick={() => { const f = i.studioFix!; const r = growPlate(det, f.op, f.field, f.add); if ('error' in r) setMsg(r.error); else { setDet(() => r.det); setSel(r.sel); setMsg(''); } }}>תקן: {i.studioFix.label}</button></>}</li>)}
              {!res.issues.some((i) => i.severity !== 'info') && <li className="ok">אין התנגשויות ואין שגיאות. {res.conn.bolts.length ? `${res.conn.bolts.length} ברגים · ` : ''}{res.conn.welds.filter((w) => w.location === 'shop').length} ריתוכי מסגריה</li>}
            </ul>
          </section>
          <section className="ss-card"><h4>בדיקה על קצה אחר</h4>
            <select className="inp" value={preview} onChange={(e) => setPreview(e.target.value)} data-testid="ds-preview">
              {[...new Set([key, ...similar.any])].slice(0, 60).map((k) => { const pp = parseSiteKey(k); const m = base.byId.get(pp.id); return <option key={k} value={k}>{m?.label ?? pp.id} · {m?.profile} · {pp.end === 'start' ? 'התחלה' : 'סוף'}</option>; })}
            </select>
            <div className="hint">הפרט נבנה מחדש על הקצה שנבחר — בודקים שהנוסחאות עובדות גם בחתך/זווית אחרים.</div>
          </section>
          <section className="ss-card"><h4>שמירה והחלה</h4>
            <label className="ss-radio"><input type="radio" checked={scope === 'one'} onChange={() => setScope('one')} /> רק הקצה הזה</label>
            <label className="ss-radio"><input type="radio" checked={scope === 'similar'} onChange={() => setScope('similar')} data-testid="ds-scope-similar" /> כל הקצוות הדומים, אותו חתך ({similar.similar.length})</label>
            <label className="ss-radio"><input type="radio" checked={scope === 'any'} onChange={() => setScope('any')} /> כל הקצוות הדומים, כל החתכים ({similar.any.length})</label>
            {inLib && <div className="hint">עורכים את הפרט "{inLib.name}" מהספרייה{usedBy > 0 ? `, שבשימוש ב-${usedBy} קצוות נוספים` : ''}. "שמור כפרט חדש" משאיר אותו כמו שהוא.</div>}
            <div className="ss-row">
              {errors.length > 0 ? <button className="btn primary" disabled data-testid="ds-apply">לא ניתן להחיל — {errors.length} שגיאות</button> : <>
                <button className="btn primary" disabled={!det.ops.length} onClick={() => apply(!!inLib && changed)} data-testid="ds-apply">{inLib && changed ? `שמור כפרט חדש והחל (${keysFor.length})` : `שמור והחל (${keysFor.length})`}</button>
                {inLib && changed && <button className="btn" onClick={() => apply(false)} data-testid="ds-update">עדכן את "{inLib.name}"{usedBy ? ` (גם ב-${usedBy} קצוות)` : ''}</button>}
              </>}
              <button className="btn" disabled={!det.ops.length} onClick={() => { if (inLib && changed) { const d = { ...structuredClone(det), id: `cd-${Date.now().toString(36)}`, name: `${det.name} (עותק)` }; setDetRaw(d); store.exec(saveDetail(d)); setMsg(`נשמר בספרייה כפרט חדש "${d.name}"`); } else { store.exec(saveDetail(det)); setMsg('נשמר בספרייה'); } }} data-testid="ds-save">{inLib && changed ? 'שמור כעותק בספרייה' : 'שמור לספרייה'}</button>
              {assignedId && <button className="btn" onClick={() => { store.exec(assignDetail([key], null)); setMsg('הקצה חזר לפרט הרגיל'); }}>חזרה לפרט הרגיל</button>}
            </div>
          </section>
        </aside>
      </div>
      {dragState && <div className="ghost-chip" style={{ left: dragState.x, top: dragState.y }}>{dragState.lbl}</div>}
    </div>
    </FxCtx.Provider>
  );

  // ---- גרירה מהמחסן ----
  function startDrag(e: React.PointerEvent, tool: ToolId, lbl: string) {
    const sx = e.clientX, sy = e.clientY;
    let moved = false;
    const mv = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 6) moved = true;
      if (moved) { setDragState({ x: ev.clientX, y: ev.clientY, lbl }); dragTool.current = { tool, hover: true }; }
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up);
      setDragState(null);
      if (moved) {
        const h = viewerPick.current?.(ev.clientX, ev.clientY) ?? null;
        dragTool.current = null;
        if (h) place(tool, h); else setMsg('שחררו מעל רכיב במודל');
        suppressClick.current = true; setTimeout(() => { suppressClick.current = false; }, 0);
      }
    };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  }
}
// מצב גרירה מהמחסן ובחירה בתלת-ממד (סטודיו יחיד פתוח בכל רגע)
const dragTool: { current: { tool: ToolId; hover: boolean } | null } = { current: null };
const viewerPick: { current: ((x: number, y: number) => Hit | null) | null } = { current: null };
const suppressClick = { current: false };

// ---------------------------------------------------------------
interface Hit { role: 'main' | 'host' | 'plate' | 'other'; op?: string; p: Vec3; n: Vec3 }

function refFromHit(h: Hit, res: DetailResult, s: Site, tool: ToolId): DetailRef | null {
  let on: string, face: string;
  if (h.role === 'main') {
    on = 'main';
    const along = dot(sub(h.p, s.P), s.u);
    if (s.cross) face = dot(h.n, s.a) >= 0 ? 'a+' : 'a-';
    else if (dot(h.n, scale(s.u, -1)) > 0.6 || (tool.startsWith('plate') || tool === 'rod') && along - res.sEnd < 30) face = 'end';
    else if (Math.abs(dot(h.n, s.a)) >= Math.abs(dot(h.n, s.w))) face = dot(h.n, s.a) > 0 ? 'a+' : 'a-';
    else face = dot(h.n, s.w) > 0 ? 'w+' : 'w-';
  } else if (h.role === 'host') { on = 'host'; face = dot(h.n, s.n) < -0.6 ? 'opp' : 'hit'; }
  else if (h.role === 'plate' && h.op) { const g = res.plates.get(h.op); if (!g) return null; on = h.op; face = dot(h.n, g.Z) >= 0 ? 'z+' : 'z-'; }
  else return null;
  const fr = res.frame({ on, face });
  if (!fr) return null;
  const r = sub(h.p, fr.base);
  let across = r5(dot(r, fr.e2)); if (Math.abs(across) < 8) across = 0;
  return { on, face, along: String(r5(dot(r, fr.e1))), across: String(across) };
}

/** שדה נוסחה: טקסט חופשי + הערך המחושב + שגיאה */
function EF({ label, value, onChange, vkey, res, hint, testId, onParam }: { label: string; value: string; onChange: (v: string) => void; vkey: string; res: DetailResult; hint?: string; testId?: string; onParam?: () => void }) {
  const err = res.errors[vkey];
  const fx = useContext(FxCtx);
  const plain = /^-?[0-9.]+$/.test(value.trim());
  return (
    <div className={`ef${err ? ' bad' : ''}`} title={hint}>
      <span className="ef-l">{label}</span>
      <span className="ef-in">
        <input className="inp mono" value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId} spellCheck={false} aria-label={label} />
        <button className="fx-btn" title="בונה נוסחה בלחצנים" aria-label={`בונה נוסחה — ${label}`} data-testid={testId ? `${testId}-fx` : undefined} onClick={() => fx.open({ title: label, value, apply: onChange })}>ƒ</button>
        {onParam && <button className="fx-btn" title="הפוך לשדה באשף החיבורים (פרמטר) — בלי נוסחה" aria-label={`הפוך לפרמטר — ${label}`} data-testid={testId ? `${testId}-param` : undefined} onClick={onParam}>⚙</button>}
      </span>
      <span className="ef-v">{err ? err : `= ${fmt(res.values[vkey])}`}</span>
      {!plain && !err && value.trim() && <span className="ef-read">{readable(value, fx.det ?? undefined)}</span>}
    </div>
  );
}

function OpProps({ op, det, res, patch, mate }: { op: DetailOp; det: CustomDetail; res: DetailResult; patch: (p: Record<string, unknown>) => void; mate: (fn: (d: CustomDetail) => MateResult) => void }) {
  const k = (f: string) => `${op.id}.${f}`;
  const plates = det.ops.filter((o) => o.k === 'plate' || o.k === 'endplate' || o.k === 'angle').map((o) => o.id);
  const refEditor = (ref: DetailRef) => (
    <>
      <label className="ef"><span className="ef-l">יושב על</span>
        <select className="inp" value={ref.on} onChange={(e) => { const on = e.target.value; patch({ ref: { ...ref, on, face: on === 'main' ? 'end' : on === 'host' ? 'hit' : 'z+' } }); }}>
          <option value="main">האלמנט</option><option value="host">המארח</option>{plates.filter((x) => x !== op.id).map((x) => <option key={x} value={x}>פלטה {x}</option>)}
        </select>
        <select className="inp" value={ref.face} onChange={(e) => patch({ ref: { ...ref, face: e.target.value } })}>
          {(ref.on === 'main' ? ['end', 'a+', 'a-', 'w+', 'w-'] : ref.on === 'host' ? ['hit', 'opp', 'web'] : ['z+', 'z-']).map((f) => <option key={f} value={f}>{FACE_NAME[f]}</option>)}
        </select>
      </label>
      <EF label="לאורך" value={ref.along} onChange={(v) => patch({ ref: { ...ref, along: v } })} vkey={k('along')} res={res} testId={`ds-${op.id}-along`} />
      <EF label="לרוחב" value={ref.across} onChange={(v) => patch({ ref: { ...ref, across: v } })} vkey={k('across')} res={res} testId={`ds-${op.id}-across`} />
      <div className="ss-row"><button className="btn small" onClick={() => patch({ ref: { ...ref, across: '0' } })}>מרכז לרוחב</button><button className="btn small" onClick={() => patch({ ref: { ...ref, along: '0' } })}>מרכז לאורך</button></div>
    </>
  );
  return (
    <section className="ss-card" data-testid="ds-props"><h4>{OPNAME[op.k]} <span className="mono">{op.id}</span></h4>
      {op.k === 'plate' && <>
        <div className="ss-row" data-testid="ds-mates" title="הצמדות — מתרגמות לפעולות קיימות (פלטה על פלטה, חיתוך מקביל למארח)">
          <button className="btn small" data-testid="ds-mate-stack" onClick={() => mate((d) => stackPlate(d, op.id))}>פלטה זהה מעליה</button>
          <button className="btn small" data-testid="ds-mate-flush" onClick={() => mate((d) => flushElementTo(d, op.id))}>הצמד את קצה האלמנט אליה</button>
        </div>
        <label className="ef"><span className="ef-l">שם</span><input className="inp" value={op.name ?? ''} placeholder="פלטה" onChange={(e) => patch({ name: e.target.value })} /></label>
        <label className="ef"><span className="ef-l">צורה</span><select className="inp" value={op.shape} onChange={(e) => patch({ shape: e.target.value })}><option value="rect">מלבן</option><option value="cham">מלבן עם קיטום</option><option value="tri">משולש</option><option value="round">עגול</option></select></label>
        <EF label={op.shape === 'round' ? 'קוטר' : 'רוחב w'} value={op.w} onChange={(v) => patch({ w: v })} vkey={k('w')} res={res} testId={`ds-${op.id}-w`} hint="לאורך ציר X של הפלטה" onParam={() => mate((d) => promoteToParam(d, op.id, 'w', res.values[k('w')]))} />
        {op.shape !== 'round' && <EF label="גובה h" value={op.h} onChange={(v) => patch({ h: v })} vkey={k('h')} res={res} testId={`ds-${op.id}-h`} onParam={() => mate((d) => promoteToParam(d, op.id, 'h', res.values[k('h')]))} />}
        <EF label="עובי t" value={op.t} onChange={(v) => patch({ t: v })} vkey={k('t')} res={res} testId={`ds-${op.id}-t`} onParam={() => mate((d) => promoteToParam(d, op.id, 't', res.values[k('t')]))} />
        {op.shape === 'cham' && <><EF label="קיטום" value={op.ch} onChange={(v) => patch({ ch: v })} vkey={k('ch')} res={res} />
          <div className="ss-row">{['↗', '↖', '↙', '↘'].map((s, i) => <button key={i} className={`btn small${op.corners[i] ? ' on' : ''}`} onClick={() => { const c = [...op.corners] as typeof op.corners; c[i] = !c[i]; patch({ corners: c }); }}>{s}</button>)}</div></>}
        <div className="ss-row"><span className="ef-l">מישור</span><button className={`btn small${op.mode === 'flat' ? ' on' : ''}`} onClick={() => patch({ mode: 'flat' })} data-testid={`ds-${op.id}-flat`}>שוכבת על הפנים</button><button className={`btn small${op.mode === 'stand' ? ' on' : ''}`} onClick={() => patch({ mode: 'stand' })} data-testid={`ds-${op.id}-stand`}>ניצבת לפנים</button></div>
        <EF label="סיבוב (°)" value={op.spin} onChange={(v) => patch({ spin: v })} vkey={k('spin')} res={res} />
        <div className="ss-row">{[-90, -15, 15, 90].map((a) => <button key={a} className="btn small" onClick={() => { const cur = Number(op.spin); patch({ spin: Number.isFinite(cur) ? String((cur + a) % 360) : `${op.spin} + ${a}` }); }}>{a > 0 ? `+${a}` : a}</button>)}</div>
        <EF label="היסט מהפנים" value={op.off} onChange={(v) => patch({ off: v })} vkey={k('off')} res={res} hint="שלילי = שקוע לתוך הפנים (לשונית בחריץ)" />
        {refEditor(op.ref)}
      </>}
      {op.k === 'endplate' && <>
        <EF label="עובי t" value={op.t} onChange={(v) => patch({ t: v })} vkey={k('t')} res={res} />
        <EF label="רוחב (במישור)" hint="לאורך מישור האלמנט (ברירת מחדל: גובה החתך + 40)" value={op.w} onChange={(v) => patch({ w: v })} vkey={k('w')} res={res} />
        <EF label="גובה (ניצב)" hint="ניצב למישור האלמנט (ברירת מחדל: רוחב החתך + 40)" value={op.h} onChange={(v) => patch({ h: v })} vkey={k('h')} res={res} />
        <EF label="היסט במישור" value={op.dx} onChange={(v) => patch({ dx: v })} vkey={k('dx')} res={res} />
        <EF label="היסט ניצב" value={op.dy} onChange={(v) => patch({ dy: v })} vkey={k('dy')} res={res} />
      </>}
      {op.k === 'cut' && <>
        <div className="ss-row">{([['perp', 'ניצב לציר'], ['host', 'מקביל למארח'], ['vert', 'אנכי'], ['horiz', 'אופקי']] as const).map(([kk, l]) => <button key={kk} className={`btn small${op.kind === kk ? ' on' : ''}`} onClick={() => patch({ kind: kk })}>{l}</button>)}</div>
        <EF label={op.kind === 'host' ? 'מרחק מפני המארח' : 'מרחק לאורך הציר'} value={op.at} onChange={(v) => patch({ at: v })} vkey={k('at')} res={res} testId={`ds-${op.id}-at`} />
      </>}
      {op.k === 'shift' && <EF label="הסטה ניצבת למישור (לאורך w)" value={op.by} onChange={(v) => patch({ by: v })} vkey={k('by')} res={res} hint="למשל חצי עובי הפח+הלשונית — הציר זז, פלטות על 'axis' נשארות" />}
      {op.k === 'slot' && <><EF label="אורך" value={op.L} onChange={(v) => patch({ L: v })} vkey={k('L')} res={res} /><EF label="רוחב" value={op.w} onChange={(v) => patch({ w: v })} vkey={k('w')} res={res} hint="עובי הלשונית + 2" /></>}
      {op.k === 'vent' && <><EF label="קוטר" value={op.d} onChange={(v) => patch({ d: v })} vkey={k('d')} res={res} /><EF label="מרחק מהקצה" value={op.at} onChange={(v) => patch({ at: v })} vkey={k('at')} res={res} /></>}
      {op.k === 'holes' && <>
        <EF label="שורות (לאורך)" value={op.rows} onChange={(v) => patch({ rows: v })} vkey={k('rows')} res={res} />
        <EF label="עמודות (לרוחב)" value={op.cols} onChange={(v) => patch({ cols: v })} vkey={k('cols')} res={res} />
        <EF label="מרווח לרוחב" value={op.px} onChange={(v) => patch({ px: v })} vkey={k('px')} res={res} testId={`ds-${op.id}-px`} />
        <EF label="מרווח לאורך" value={op.py} onChange={(v) => patch({ py: v })} vkey={k('py')} res={res} />
        <EF label="קוטר חור" value={op.d0} onChange={(v) => patch({ d0: v })} vkey={k('d0')} res={res} />
        {refEditor(op.ref)}
      </>}
      {op.k === 'bolts' && <>
        <EF label="קוטר בורג" value={op.d} onChange={(v) => patch({ d: v })} vkey={k('d')} res={res} />
        <label className="ef"><span className="ef-l">דרגה</span><select className="inp" value={op.grade} onChange={(e) => patch({ grade: e.target.value })}><option>8.8</option><option>10.9</option><option>5.6</option></select></label>
        <div className="ss-row"><button className={`btn small${op.site ? ' on' : ''}`} onClick={() => patch({ site: true })}>הרכבה בשטח</button><button className={`btn small${!op.site ? ' on' : ''}`} onClick={() => patch({ site: false })}>מסגריה</button></div>
        <Help>אורך הבורג והחורים בכל החלקים שהוא עובר בהם — אוטומטי. {res.conn.bolts.filter((b) => b.id.includes(`.${op.id}.`)).slice(0, 1).map((b) => `M${b.d}×${b.length}, אחיזה ${b.grip}`).join('')}</Help>
      </>}
      {op.k === 'angle' && <>
        <EF label="רגל מוברגת H" value={op.H} onChange={(v) => patch({ H: v })} vkey={k('H')} res={res} testId={`ds-${op.id}-H`} hint="הרגל הצמודה לפנים — לאורך e1 של הפנים" />
        <EF label="רגל בסיס B" value={op.B} onChange={(v) => patch({ B: v })} vkey={k('B')} res={res} testId={`ds-${op.id}-B`} />
        <EF label="עובי t" value={op.t} onChange={(v) => patch({ t: v })} vkey={k('t')} res={res} testId={`ds-${op.id}-t`} />
        <EF label="אורך w" value={op.w} onChange={(v) => patch({ w: v })} vkey={k('w')} res={res} testId={`ds-${op.id}-w`} />
        {refEditor(op.ref)}
      </>}
      {op.k === 'rod' && <><EF label="קוטר" value={op.d} onChange={(v) => patch({ d: v })} vkey={k('d')} res={res} /><EF label="אורך" value={op.L} onChange={(v) => patch({ L: v })} vkey={k('L')} res={res} />{refEditor(op.ref)}</>}
      {op.k === 'weld' && <>
        <EF label="גרון a" value={op.a} onChange={(v) => patch({ a: v })} vkey={k('a')} res={res} />
        <label className="ef"><span className="ef-l">מרותך אל</span><select className="inp" value={op.to ?? ''} onChange={(e) => patch({ to: e.target.value || undefined })}><option value="">מה שהפלטה יושבת עליו</option><option value="main">האלמנט</option><option value="host">המארח</option>{plates.filter((x) => x !== op.part).map((x) => <option key={x} value={x}>פלטה {x}</option>)}</select></label>
        <div className="ss-row"><button className={`btn small${!op.site ? ' on' : ''}`} onClick={() => patch({ site: false })}>מסגריה</button><button className={`btn small${op.site ? ' on' : ''}`} onClick={() => patch({ site: true })}>שטח</button></div>
      </>}
    </section>
  );
}

function FxBtn({ title, value, apply }: FxTarget) { const fx = useContext(FxCtx); return <button className="fx-btn" title="בונה נוסחה בלחצנים" onClick={() => fx.open({ title, value, apply })}>ƒ</button>; }

/** פרמטרים שמוצגים באשף (מתכון v2): בוחרים אילו משתנים הופכים לשדה, ומגדירים תווית, סוג פקד, יחידה וטווח */
function ParamsCard({ det, res, setDet }: { det: CustomDetail; res: DetailResult; setDet: (fn: (d: CustomDetail) => CustomDetail) => void }) {
  const get = (name: string) => det.params?.find((q) => q.name === name);
  const edit = (name: string, fn: (q: DetailParam) => void) => setDet((d) => { const q = d.params?.find((y) => y.name === name); if (q) fn(q); return d; });
  const toggle = (name: string, on: boolean) => setDet((d) => {
    const list = d.params ?? [];
    if (!on) d.params = list.filter((q) => q.name !== name);
    else if (!list.some((q) => q.name === name)) d.params = [...list, { name, label: d.vars.find((v) => v.name === name)?.note || name, kind: 'number', unit: 'מ"מ' }];
    return d;
  });
  const vars = det.vars.filter((v) => v.name);
  return (
    <section className="ss-card" data-testid="ds-params"><h4>פרמטרים באשף</h4>
      <div className="hint">משתנה שמסומן כאן יופיע כשדה באשף החיבורים; ערך שמשנים באשף נשמר לקצה הזה בלבד (או לתבנית), והנוסחה כאן נשארת ברירת המחדל.</div>
      <div className="ss-vars">
        {vars.map((v) => {
          const q = get(v.name);
          return (
            <div key={v.name} className="ss-var" data-testid={`dsp-${v.name}`} style={{ flexWrap: 'wrap' }}>
              <label className="ss-radio"><input type="checkbox" checked={!!q} data-testid={`dsp-on-${v.name}`} onChange={(e) => toggle(v.name, e.target.checked)} /><span className="mono">{v.name}</span></label>
              {q && <>
                <input className="inp" value={q.label} aria-label="תווית" onChange={(e) => { const x = e.target.value; edit(v.name, (y) => { y.label = x; }); }} />
                <select className="inp" value={q.kind} aria-label="סוג פקד" onChange={(e) => { const k = e.target.value as DetailParam['kind']; edit(v.name, (y) => { y.kind = k; if (k === 'toggle') { y.options = undefined; y.unit = undefined; } if (k === 'select' && !y.options?.length) y.options = [{ value: res.values[v.name] ?? 0, label: String(res.values[v.name] ?? 0) }]; }); }}>
                  <option value="number">מספר</option><option value="select">בחירה</option><option value="toggle">מתג (כן/לא)</option>
                </select>
                {q.kind === 'number' && <>
                  <input className="inp num" style={{ width: 64 }} value={q.unit ?? ''} placeholder="יחידה" aria-label="יחידה" onChange={(e) => { const x = e.target.value; edit(v.name, (y) => { y.unit = x || undefined; }); }} />
                  <input className="inp num" style={{ width: 70 }} type="number" value={q.min ?? ''} placeholder="מינ׳" aria-label="מינימום" onChange={(e) => { const x = e.target.value; edit(v.name, (y) => { y.min = x === '' ? undefined : Number(x); }); }} />
                  <input className="inp num" style={{ width: 70 }} type="number" value={q.max ?? ''} placeholder="מקס׳" aria-label="מקסימום" onChange={(e) => { const x = e.target.value; edit(v.name, (y) => { y.max = x === '' ? undefined : Number(x); }); }} />
                </>}
                {q.kind === 'select' && <input className="inp mono" style={{ minWidth: 160 }} value={(q.options ?? []).map((o) => `${o.value}=${o.label}`).join(', ')} placeholder="ערך=תווית, ערך=תווית" aria-label="אפשרויות"
                  onChange={(e) => { const x = e.target.value; edit(v.name, (y) => { y.options = x.split(',').map((t) => t.trim()).filter(Boolean).map((t) => { const [a, ...b] = t.split('='); const n = Number(a); return { value: Number.isFinite(n) ? n : 0, label: (b.join('=') || a).trim() }; }); }); }} />}
                <input className="inp" style={{ width: 90 }} value={q.group ?? ''} placeholder="קבוצה" aria-label="קבוצה" onChange={(e) => { const x = e.target.value; edit(v.name, (y) => { y.group = x || undefined; }); }} />
              </>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function VarsCard({ det, res, setDet }: { det: CustomDetail; res: DetailResult; setDet: (fn: (d: CustomDetail) => CustomDetail) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="ss-card"><h4>משתנים ונוסחאות</h4>
      <div className="ss-vars">
        {det.vars.map((v, i) => (
          <div className={`ss-var${res.errors[`var.${v.name}`] ? ' bad' : ''}`} key={i}>
            <input className="inp mono" value={v.name} aria-label="שם משתנה" onChange={(e) => { const x = e.target.value.replace(/[^A-Za-z0-9_]/g, ''); setDet((d) => { const was = d.vars[i].name; d.vars[i].name = x; const q = d.params?.find((y) => y.name === was); if (q) q.name = x; return d; }); }} />
            <span>=</span>
            <span className="ef-in"><input className="inp mono" value={v.expr} aria-label="נוסחה" title={v.note} onChange={(e) => { const x = e.target.value; setDet((d) => { d.vars[i].expr = x; return d; }); }} />
              <FxBtn title={v.note || v.name} value={v.expr} apply={(x) => setDet((d) => { d.vars[i].expr = x; return d; })} /></span>
            <span className="ef-v">{res.errors[`var.${v.name}`] ?? fmt(res.values[v.name])}</span>
            <button className="icon-btn" onClick={() => setDet((d) => { const [gone] = d.vars.splice(i, 1); if (d.params) d.params = d.params.filter((y) => y.name !== gone.name); return d; })} aria-label="מחיקת משתנה">✕</button>
          </div>
        ))}
      </div>
      <div className="ss-row"><button className="btn small" onClick={() => setDet((d) => { let n = 1; while (d.vars.some((x) => x.name === `v${n}`)) n++; d.vars.push({ name: `v${n}`, expr: '0' }); return d; })}>+ משתנה</button>
        <button className="btn small" onClick={() => setOpen(!open)}>{open ? 'הסתר' : 'מה אפשר לכתוב?'}</button></div>
      {open && <div className="ss-help">
        <div>מידות האתר:</div>
        {VAR_HELP.map(([n, l]) => <div key={n}><span className="mono">{n}</span> = {fmt(res.values[n])} — {l}</div>)}
        <div>תוצאות פעולות: <span className="mono">P1.w P1.h P1.t H1.px B1.d send</span></div>
        <div>פונקציות: <span className="mono">min max abs sqrt r5 round ceil sin cos tan if(c,a,b)</span> · זוויות במעלות</div>
      </div>}
    </section>
  );
}

// ---------------------------------------------------------------
function Viewer({ res, site, others, sel, armed, onSelect, onPlace, onMove, tags, tagLabel, onTag, pickMode }: { res: DetailResult; site: Site; others: Member[]; sel: string | null; armed: ToolId | null; onSelect: (id: string | null) => void; onPlace: (h: Hit) => void; onMove: (op: string, along: number, across: number) => void; tags: Tag[]; tagLabel: (k: string) => string; onTag: (k: string) => void; pickMode: boolean }) {
  const tagBox = useRef<HTMLDivElement>(null);
  const tagsRef = useRef<Tag[]>(tags);
  tagsRef.current = tags;
  const cvRef = useRef<HTMLCanvasElement>(null);
  const ctx = useRef<{ R: THREE.WebGLRenderer; scene: THREE.Scene; cam: THREE.PerspectiveCamera; world: THREE.Group; marker: THREE.Mesh; orbit: { th: number; ph: number; r: number }; dirty: boolean; raf: number } | null>(null);
  const [, force] = useState(0);
  const cbs = useRef({ onSelect, onPlace, onMove, armed, sel, res, site });
  cbs.current = { onSelect, onPlace, onMove, armed, sel, res, site };

  useEffect(() => {
    const cv = cvRef.current!;
    let R: THREE.WebGLRenderer;
    try { R = new THREE.WebGLRenderer({ canvas: cv, antialias: true }); } catch { return; }
    R.setPixelRatio(Math.min(2, devicePixelRatio));
    R.localClippingEnabled = true;
    R.setClearColor(0xf3efe6);
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(32, 1, 5, 50000);
    cam.up.set(0, 0, 1);
    const hl = new THREE.HemisphereLight(0xffffff, 0x9aa09a, 0.85); hl.position.set(0, 0, 1); scene.add(hl);
    scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    const dl = new THREE.DirectionalLight(0xffffff, 0.55); dl.position.set(1, -2, 3); scene.add(dl);
    const dl2 = new THREE.DirectionalLight(0xffffff, 0.3); dl2.position.set(-2, 1, 1); scene.add(dl2);
    const world = new THREE.Group(); scene.add(world);
    const marker = new THREE.Mesh(new THREE.SphereGeometry(6, 12, 8), new THREE.MeshBasicMaterial({ color: 0x1f5a3f }));
    marker.visible = false; scene.add(marker);
    // כיוון מבט התחלתי: ניצב למישור הפרט, מעט מהצד
    const w = site.w;
    const th0 = Math.atan2(w.x, -w.y) + 0.5;
    ctx.current = { R, scene, cam, world, marker, orbit: { th: th0, ph: 0.3, r: 2300 }, dirty: true, raf: 0 };
    const loop = () => {
      const c = ctx.current; if (!c) return;
      if (c.dirty) {
        const { th, ph, r } = c.orbit, P = cbs.current.site.P;
        cam.position.set(P.x + r * Math.cos(ph) * Math.sin(th), P.y - r * Math.cos(ph) * Math.cos(th), P.z + r * Math.sin(ph));
        cam.lookAt(P.x, P.y, P.z);
        R.render(scene, cam); c.dirty = false;
        // תגיות מידות (HTML) מעל קווי המידה
        // 1.70: מידות תלויות-מבט — קו מידה בניצב לקטע במסך, מוסט הרחק ממרכז הבעלים (הפלטה), קווי עזר לנקודות;
        // תגית שחופפת לתגית אחרת עוברת לשורה הבאה (עד 4), אחרת מוסתרת. מעבר עכבר — הדגשה.
        const box = tagBox.current, svgEl = box?.querySelector('svg');
        if (box && svgEl) {
          const W = cv.clientWidth, H = cv.clientHeight;
          const scr = (p: Vec3) => { const m = new THREE.Vector3(p.x, p.y, p.z).project(cam); return { x: ((m.x + 1) / 2) * W, y: ((1 - m.y) / 2) * H, ok: m.z < 1 }; };
          const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
          const parts: string[] = [];
          const f1 = (v: number) => v.toFixed(1);
          const byK = new Map(tagsRef.current.map((t) => [t.k, t]));
          box.querySelectorAll<HTMLElement>('button.dim-tag[data-k]').forEach((el) => {
            const tg = byK.get(el.dataset.k ?? ''); if (!tg) { el.style.display = 'none'; return; }
            el.style.display = ''; // למדידת הרוחב (תגית חדשה מתחילה מוסתרת — visibility)
            const A = scr(tg.a), B = scr(tg.b), Cc = scr(tg.c ?? tg.a);
            const L = Math.hypot(B.x - A.x, B.y - A.y);
            if (!A.ok || !B.ok || L < 18) { el.style.display = 'none'; return; }
            const ux = (B.x - A.x) / L, uy = (B.y - A.y) / L;
            let nx = -uy, ny = ux;
            const Mx = (A.x + B.x) / 2, My = (A.y + B.y) / 2;
            if ((Mx - Cc.x) * nx + (My - Cc.y) * ny < 0) { nx = -nx; ny = -ny; }
            const hw = el.offsetWidth / 2 + 3, hh = el.offsetHeight / 2 + 2;
            let off = -1;
            for (let lv = 0; lv < 4 && off < 0; lv++) {
              const o = 22 + lv * 24, qx = Mx + nx * o, qy = My + ny * o;
              const r = { x0: qx - hw, x1: qx + hw, y0: qy - hh, y1: qy + hh };
              if (!placed.some((z) => r.x0 < z.x1 && r.x1 > z.x0 && r.y0 < z.y1 && r.y1 > z.y0)) { placed.push(r); off = o; }
            }
            if (off < 0) { el.style.display = 'none'; return; }
            const A2 = { x: A.x + nx * off, y: A.y + ny * off }, B2 = { x: B.x + nx * off, y: B.y + ny * off };
            const hot = el.matches(':hover') ? ' hot' : '';
            const tk = (P: { x: number; y: number }) => `<line x1="${f1(P.x - (ux + nx) * 4)}" y1="${f1(P.y - (uy + ny) * 4)}" x2="${f1(P.x + (ux + nx) * 4)}" y2="${f1(P.y + (uy + ny) * 4)}"/>`;
            parts.push(`<g class="sd${hot}" data-k="${tg.k}"><line class="x" x1="${f1(A.x + nx * 3)}" y1="${f1(A.y + ny * 3)}" x2="${f1(A2.x + nx * 4)}" y2="${f1(A2.y + ny * 4)}"/><line class="x" x1="${f1(B.x + nx * 3)}" y1="${f1(B.y + ny * 3)}" x2="${f1(B2.x + nx * 4)}" y2="${f1(B2.y + ny * 4)}"/><line x1="${f1(A2.x)}" y1="${f1(A2.y)}" x2="${f1(B2.x)}" y2="${f1(B2.y)}"/>${tk(A2)}${tk(B2)}<circle cx="${f1(A.x)}" cy="${f1(A.y)}" r="3"/><circle cx="${f1(B.x)}" cy="${f1(B.y)}" r="3"/></g>`);
            el.style.left = `${(A2.x + B2.x) / 2}px`; el.style.top = `${(A2.y + B2.y) / 2}px`;
            el.style.visibility = 'visible';
          });
          svgEl.innerHTML = parts.join('');
        }
      }
      c.raf = requestAnimationFrame(loop);
    };
    loop();
    const ro = new ResizeObserver(() => { const W = cv.clientWidth, H = cv.clientHeight; R.setSize(W, H, false); cam.aspect = W / Math.max(1, H); cam.updateProjectionMatrix(); if (ctx.current) ctx.current.dirty = true; });
    ro.observe(cv);
    force((x) => x + 1);
    return () => { cancelAnimationFrame(ctx.current?.raf ?? 0); ro.disconnect(); R.dispose(); ctx.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // בניית הסצנה מחדש בכל שינוי
  useEffect(() => {
    const c = ctx.current; if (!c) return;
    const { world } = c;
    while (world.children.length) { const o = world.children.pop()!; (o as THREE.Mesh).geometry?.dispose(); }
    const mats = {
      host: new THREE.MeshStandardMaterial({ color: 0xb5bdb7, metalness: 0.2, roughness: 0.7, side: THREE.DoubleSide }),
      main: new THREE.MeshStandardMaterial({ color: 0xd2d7d0, metalness: 0.2, roughness: 0.6, side: THREE.DoubleSide }),
      plate: new THREE.MeshStandardMaterial({ color: 0x86a9cf, metalness: 0.2, roughness: 0.6, side: THREE.DoubleSide }),
      sel: new THREE.MeshStandardMaterial({ color: 0x1f5a3f, metalness: 0.2, roughness: 0.6, side: THREE.DoubleSide }),
      bolt: new THREE.MeshStandardMaterial({ color: 0x2b3138, metalness: 0.5, roughness: 0.5, side: THREE.DoubleSide }),
      other: new THREE.MeshStandardMaterial({ color: 0xd9d4c8, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }),
      clash: new THREE.MeshStandardMaterial({ color: 0xc0392b, metalness: 0.1, roughness: 0.6, side: THREE.DoubleSide }),
    };
    const clashIds = new Set(res.issues.filter((i) => i.code === 'CLASH').map((i) => i.elementId));
    const add3 = (m: Member, mat: THREE.Material, ud: Record<string, unknown>, edges = true) => {
      let s; try { s = memberSolid(m); } catch { return; }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(s.tris, 3)); g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, mat); mesh.userData = ud; world.add(mesh);
      if (edges) { const eg = new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.Float32BufferAttribute(s.edges, 3)); world.add(new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: 0x3c4741 }))); }
    };
    const crop = (m: Member): Member => {
      // אלמנט ארוך — רק האזור שליד הפרט (1.2 מ' מכל צד)
      const d = sub(m.end, m.start), L = len(d); if (L < 2600) return m;
      const ex = scale(d, 1 / L), t = dot(sub(site.P, m.start), ex), a = Math.max(0, t - 1200), b = Math.min(L, t + 1200);
      return { ...m, start: add(m.start, scale(ex, a)), end: add(m.start, scale(ex, b)), startCut: a > 1 ? undefined : m.startCut, endCut: b < L - 1 ? undefined : m.endCut };
    };
    if (site.host) add3(crop(site.host), mats.host, { role: 'host' });
    add3(crop(res.main), mats.main, { role: 'main' });
    for (const m of res.members) {
      const op = m.id.slice(res.conn.id.length + 1).split('.')[0];
      if (m.kind === 'bolt') { const bop = op; add3(m, sel && res.conn.bolts.some((b) => b.id.startsWith(`${res.conn.id}.${sel}.`) && m.id.startsWith(b.id)) ? mats.sel : mats.bolt, { role: 'bolt', op: bop }, false); continue; }
      add3(m, clashIds.has(m.id) ? mats.clash : sel === op ? mats.sel : mats.plate, { role: m.kind === 'anchor' ? 'rod' : 'plate', op });
    }
    for (const o of others) add3(crop(o), mats.other, { role: 'other' }, false);
    // ריתוכים
    for (const wd of res.conn.welds) {
      if (len(sub(wd.to, wd.from)) < 1) continue;
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(wd.from.x, wd.from.y, wd.from.z), new THREE.Vector3(wd.to.x, wd.to.y, wd.to.z)]);
      world.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: wd.location === 'shop' ? 0xd7891c : 0xc0392b, linewidth: 3 })));
    }
    // קווי המידות מצוירים במסך (שכבת SVG) — לפי המבט
    c.dirty = true;
  }, [res, sel, site, others, tags]);

  const pick = (x: number, y: number): Hit | null => {
    const c = ctx.current, cv = cvRef.current; if (!c || !cv) return null;
    const r = cv.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null;
    const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), c.cam);
    const hs = ray.intersectObjects(c.world.children.filter((o) => (o as THREE.Mesh).isMesh && o.userData.role && o.userData.role !== 'other'), false);
    const h = hs[0]; if (!h) return null;
    const n = h.face ? h.face.normal.clone() : new THREE.Vector3(0, 0, 1);
    if (n.dot(ray.ray.direction) > 0) n.negate();
    const role = h.object.userData.role as string;
    return { role: role === 'rod' || role === 'bolt' ? 'plate' : (role as Hit['role']), op: h.object.userData.op, p: { x: h.point.x, y: h.point.y, z: h.point.z }, n: { x: n.x, y: n.y, z: n.z } };
  };
  viewerPick.current = pick;
  // נקודת חיבור לבדיקות: מיקום מסך של נקודת עולם ומרכזי הפלטות
  (window as unknown as { __kspStudio?: unknown }).__kspStudio = {
    screenOf: (p: Vec3) => { const c = ctx.current, cv = cvRef.current; if (!c || !cv) return null; c.cam.updateMatrixWorld(); const v = new THREE.Vector3(p.x, p.y, p.z).project(c.cam); const r = cv.getBoundingClientRect(); return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height }; },
    plate: (id: string) => res.plates.get(id)?.center ?? null,
    site: () => cbs.current.site.P,
  };

  // אינטראקציה: סיבוב, בחירה, הנחה, הזזה
  useEffect(() => {
    const cv = cvRef.current!;
    let orbit: { x: number; y: number } | null = null;
    let pend: { x: number; y: number; h: Hit | null } | null = null;
    let mv: { op: string; plane: THREE.Plane; base: Vec3; e1: Vec3; e2: Vec3; on: boolean; sx: number; sy: number } | null = null;
    const down = (e: PointerEvent) => {
      if (suppressClick.current) return;
      cv.setPointerCapture(e.pointerId);
      const { armed: a, sel: s, res: rs } = cbs.current;
      const h = pick(e.clientX, e.clientY);
      // כלי חמוש: לחיצה (בלי תזוזה) = הנחה; גרירה = סיבוב התצוגה
      if (a) { pend = { x: e.clientX, y: e.clientY, h }; orbit = { x: e.clientX, y: e.clientY }; return; }
      const opId = h?.op && (h.role === 'plate') ? h.op : null;
      if (opId) {
        if (s !== opId) cbs.current.onSelect(opId);
        // הזזה על הפנים שהרכיב יושב עליהן (ברגים — דרך קבוצת החורים שלהם)
        const bo = curOps.current.find((o) => o.id === opId);
        const opRef = findRef(bo?.k === 'bolts' ? bo.holes : opId);
        const mvOp = bo?.k === 'bolts' ? bo.holes : opId;
        if (opRef) { const fr = rs.frame(opRef); if (fr) mv = { op: mvOp, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(fr.n.x, fr.n.y, fr.n.z), new THREE.Vector3(fr.base.x, fr.base.y, fr.base.z)), base: fr.base, e1: fr.e1, e2: fr.e2, on: false, sx: e.clientX, sy: e.clientY }; }
        return;
      }
      if (h && h.role !== 'other') cbs.current.onSelect(null);
      orbit = { x: e.clientX, y: e.clientY };
    };
    const findRef = (opId: string): DetailRef | null => { const o = curOps.current.find((x) => x.id === opId); return o && 'ref' in o ? o.ref : null; };
    const move = (e: PointerEvent) => {
      const c = ctx.current; if (!c) return;
      if (mv) {
        if (!mv.on && Math.hypot(e.clientX - mv.sx, e.clientY - mv.sy) > 4) mv.on = true;
        if (!mv.on) return;
        const r = cv.getBoundingClientRect(); const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), c.cam);
        const p = new THREE.Vector3(); if (!ray.ray.intersectPlane(mv.plane, p)) return;
        const q = sub({ x: p.x, y: p.y, z: p.z }, mv.base);
        let ac = r5(dot(q, mv.e2)); if (Math.abs(ac) < 8) ac = 0;
        cbs.current.onMove(mv.op, r5(dot(q, mv.e1)), ac);
        return;
      }
      if (pend && Math.hypot(e.clientX - pend.x, e.clientY - pend.y) > 5) pend = null;
      if (orbit) { c.orbit.th -= (e.clientX - orbit.x) * 0.006; c.orbit.ph = Math.max(-1.45, Math.min(1.45, c.orbit.ph + (e.clientY - orbit.y) * 0.006)); orbit = { x: e.clientX, y: e.clientY }; c.dirty = true; return; }
      if (cbs.current.armed || dragTool.current?.hover) {
        const h = pick(e.clientX, e.clientY);
        c.marker.visible = !!h; if (h) c.marker.position.set(h.p.x, h.p.y, h.p.z); c.dirty = true;
      }
    };
    const up = () => { if (pend?.h) cbs.current.onPlace(pend.h); pend = null; orbit = null; mv = null; };
    const wheel = (e: WheelEvent) => { e.preventDefault(); const c = ctx.current; if (!c) return; c.orbit.r = Math.max(250, Math.min(8000, c.orbit.r * (1 + Math.sign(e.deltaY) * 0.1))); c.dirty = true; };
    cv.addEventListener('pointerdown', down); window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); cv.addEventListener('wheel', wheel, { passive: false });
    return () => { cv.removeEventListener('pointerdown', down); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); cv.removeEventListener('wheel', wheel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <>
      <canvas ref={cvRef} className="studio-cv" data-testid="ds-canvas" />
      <div ref={tagBox} className={`dim-tags${pickMode ? ' pick' : ''}`}>
        <svg className="dim-svg" />
        {tags.map((t) => <button key={t.k} data-k={t.k} className="dim-tag" style={{ visibility: 'hidden' }} onClick={() => onTag(t.k)} data-testid={`tag-${t.k}`} title={t.k}
          onPointerEnter={() => { if (ctx.current) ctx.current.dirty = true; }} onPointerLeave={() => { if (ctx.current) ctx.current.dirty = true; }}>{tagLabel(t.k)} <span className="mono">{t.k}</span></button>)}
      </div>
    </>
  );
}
const curOps: { current: DetailOp[] } = { current: [] };
