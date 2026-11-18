import { useMemo } from 'react';
import { setBuilding } from '../commands/commands';
import type { DerivedModel, Member } from '../model/types';
import { store, useStore } from '../store';
import { cachedSolid } from '../view/scene';
import { HaunchEditor } from './SectionEditor';
import { GutterSchematic } from './CladdingPanel';
import { LockTrussFields, PortalFields, RoofXConn, RoofXShape, WallXShape, XConnFields } from './StructurePanel';
import { KneeEditor } from './SectionEditor';
import { EditCtx } from './fields';
import { defaultPortal } from '../geometry/portal';
import { defaultLockTruss } from '../geometry/lockTruss';

/**
 * חלון מכלול (בקשת משתמש 18.11.2026): לחיצה על אלמנט פותחת את כל המכלול שהוא שייך אליו —
 * תמונת הצורה (מהמודל עצמו), בחירת צורה/סוג, וסוג המחבר בכל צד. אותה מסגרת לכל סוגי האלמנטים.
 */
export type AsmFamily = 'lock' | 'portal' | 'wallx' | 'roofx' | 'knee' | 'gutter' | 'haunch' | 'frame';
export interface Asm { family: AsmFamily; title: string; ids: string[]; lineId?: string; bay?: number; view: 'yz' | 'xz' | 'xy' }

const FAM_NAME: Record<AsmFamily, string> = { lock: 'נעילה אופקית (מסבך)', portal: 'אגד B', wallx: 'קושרות X בקיר', roofx: 'קושרות X בגג', knee: 'אלכסון עמוד-קורה', gutter: 'תומך מזחלה', haunch: 'מכפל', frame: 'מסגרת' };

export function assemblyOf(m: Member, d: DerivedModel): Asm | null {
  const id = m.id, cid = m.connId ?? '';
  const lineLabel = (lid: string) => d.section?.lines.find((l) => l.id === lid)?.label ?? lid;
  const connParts = (pred: (cId: string) => boolean) => d.connections.filter((c) => pred(c.id)).flatMap((c) => [...c.parts, ...c.bolts.flatMap((b) => [`${b.id}.H`, `${b.id}.S`, `${b.id}.N`])]);
  const withConnMembers = (ids: string[]) => d.members.filter((x) => x.connId && ids.includes(x.connId)).map((x) => x.id);
  // נעילה אופקית
  let mm = /^(?:C\.)?LT\.(\d+)\.([^.]+)\./.exec(id) ?? /^C\.LT\.(\d+)\.([^.]+)\./.exec(cid);
  if (!mm && /^C\.LT\.[^.]+\./.test(cid)) { const c = d.connById.get(cid); const ch = c?.members.find((x) => x.startsWith('LT.')); if (ch) mm = /^LT\.(\d+)\.([^.]+)\./.exec(ch); }
  if (mm) {
    const [, bay, line] = mm; const pre = `LT.${bay}.${line}.`;
    const chords = d.members.filter((x) => x.id.startsWith(pre)).map((x) => x.id);
    const joints = d.connections.filter((c) => c.id.startsWith(`C.LT.${bay}.${line}.`) || (c.id.startsWith('C.LT.') && c.members.some((x) => chords.includes(x))));
    const cols = [...new Set(joints.flatMap((c) => c.members.filter((x) => x.includes('.COL.'))))];
    const ids = [...chords, ...cols, ...joints.flatMap((c) => [...c.parts, ...c.bolts.flatMap((b) => [`${b.id}.H`, `${b.id}.S`, `${b.id}.N`])]), ...withConnMembers(joints.map((c) => c.id))];
    return { family: 'lock', title: `${FAM_NAME.lock} — ציר ${lineLabel(line!)} מפתח ${bay}`, ids: [...new Set(ids)], lineId: line, bay: Number(bay) - 1, view: 'yz' };
  }
  mm = /^(?:C\.)?BB\.(\d+)\.([^.]+)/.exec(id) ?? /^C\.BB\.(\d+)\.([^.]+)/.exec(cid);
  if (mm) {
    const [, bay, line] = mm; const pre = `BB.${bay}.${line}`;
    const ms = d.members.filter((x) => x.id === pre || x.id.startsWith(`${pre}.`)).map((x) => x.id);
    const parts = connParts((c) => c.startsWith(`C.BB.${bay}.${line}.`));
    const cols = [...new Set(d.connections.filter((c) => c.id.startsWith(`C.BB.${bay}.${line}.`)).flatMap((c) => c.members.filter((x) => x.includes('.COL.'))))];
    return { family: 'portal', title: `${FAM_NAME.portal} — ציר ${lineLabel(line!)} מפתח ${bay}`, ids: [...new Set([...ms, ...parts, ...cols])], lineId: line, bay: Number(bay) - 1, view: 'yz' };
  }
  mm = /^(?:C\.)?BR\.W(\d+)\.([^.]+)/.exec(id) ?? /^C\.BR\.W(\d+)\.([^.]+)/.exec(cid);
  if (mm) {
    const [, bay, line] = mm; const pre = `BR.W${bay}.${line}.`;
    const ms = d.members.filter((x) => x.id.startsWith(pre)).map((x) => x.id);
    const parts = connParts((c) => c.startsWith(`C.${pre}`));
    const cols = [...new Set(d.connections.filter((c) => c.id.startsWith(`C.${pre}`)).flatMap((c) => c.members.filter((x) => x.includes('.COL.'))))];
    return { family: 'wallx', title: `${FAM_NAME.wallx} — ציר ${lineLabel(line!)} מפתח ${bay}`, ids: [...new Set([...ms, ...parts, ...cols])], lineId: line, bay: Number(bay) - 1, view: 'yz' };
  }
  mm = /^(?:C\.)?BR\.R(\d+)\.([^.]+)/.exec(id) ?? /^C\.BR\.R(\d+)\.([^.]+)/.exec(cid);
  if (mm) {
    const [, bay, seg] = mm; const pre = `BR.R${bay}.${seg}.`;
    const ms = d.members.filter((x) => x.id.startsWith(pre)).map((x) => x.id);
    const conns = d.connections.filter((c) => c.id.startsWith(`C.${pre}`));
    const hosts = [...new Set(conns.flatMap((c) => c.members.filter((x) => d.byId.get(x)?.kind === 'rafter')))];
    return { family: 'roofx', title: `${FAM_NAME.roofx} — מפתח ${bay}, קטע ${seg}`, ids: [...new Set([...ms, ...connParts((c) => c.startsWith(`C.${pre}`)), ...hosts])], bay: Number(bay) - 1, view: 'xy' };
  }
  const famByConn = (prefix: string, fam: AsmFamily): Asm | null => {
    const c = cid.startsWith(prefix) ? d.connById.get(cid) : d.connections.find((x) => x.id.startsWith(prefix) && (x.parts.includes(id) || (x.members.includes(id) && d.byId.get(id)?.kind === 'brace')));
    if (!c) return null;
    return { family: fam, title: `${FAM_NAME[fam]} — ${c.label}`, ids: [...new Set([...c.members, ...c.parts, ...c.bolts.flatMap((b) => [`${b.id}.H`, `${b.id}.S`, `${b.id}.N`]), ...withConnMembers([c.id])])], view: 'xz' };
  };
  const k = famByConn('C.KB.', 'knee') ?? famByConn('C.GB.', 'gutter') ?? famByConn('C.HN.', 'haunch');
  if (k) return k;
  if ((m.kind === 'column' || m.kind === 'rafter') && m.frameId) {
    const fno = store.state.project.building.frames.findIndex((f) => f.id === m.frameId) + 1;
    const ids = d.members.filter((x) => x.frameId === m.frameId && (x.kind === 'column' || x.kind === 'rafter')).map((x) => x.id);
    const kb = d.connections.filter((c) => c.id.startsWith(`C.KB.${m.frameId}.`)).flatMap((c) => c.members.filter((x) => d.byId.get(x)?.kind === 'brace'));
    return { family: 'frame', title: `${FAM_NAME.frame} ${fno}`, ids: [...ids, ...kb], view: 'xz' };
  }
  return null;
}

function hull2(p0: number[][]): number[][] {
  const p = [...p0].sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!);
  if (p.length < 3) return p;
  const cr = (o: number[], a: number[], b: number[]) => (a[0]! - o[0]!) * (b[1]! - o[1]!) - (a[1]! - o[1]!) * (b[0]! - o[0]!);
  const lo: number[][] = [], up: number[][] = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2]!, lo[lo.length - 1]!, q) <= 0) lo.pop(); lo.push(q); }
  for (const q of [...p].reverse()) { while (up.length >= 2 && cr(up[up.length - 2]!, up[up.length - 1]!, q) <= 0) up.pop(); up.push(q); }
  return [...lo.slice(0, -1), ...up.slice(0, -1)];
}

/** תמונת המכלול: קווי המתאר של המוצקים, בהיטל למישור המכלול */
function AsmPicture({ asm, sel }: { asm: Asm; sel: string }) {
  const d = useStore((s) => s.derived);
  const data = useMemo(() => {
    const pr = asm.view === 'yz' ? (_x: number, y: number, z: number) => [y, -z] : asm.view === 'xz' ? (x: number, _y: number, z: number) => [x, -z] : (x: number, y: number) => [y, -x];
    // לכל אלמנט: מעטפת קמורה של נקודות המוצק בהיטל (פרופיל עם פינות מעוגלות אין לו קווי אורך "חדים")
    const polys: { pts: number[][]; hi: boolean; thin: boolean }[] = [];
    const ms = asm.ids.map((x) => d.byId.get(x)).filter((x): x is Member => !!x && x.kind !== 'bolt');
    for (const m of ms) {
      const sol = cachedSolid(m);
      const pts = [...sol.startRing, ...sol.endRing].map((q) => pr(q.x, q.y, q.z));
      polys.push({ pts: hull2(pts), hi: m.id === sel, thin: m.kind === 'plate' || m.kind === 'cleat' || m.kind === 'anchor' });
    }
    const xs = polys.flatMap((q) => q.pts.map((t) => t[0]!)), ys = polys.flatMap((q) => q.pts.map((t) => t[1]!));
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    return { segs: polys, x0, y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
  }, [asm, d, sel]);
  if (!data.segs.length) return null;
  const pad = Math.max(data.w, data.h) * 0.04;
  return (
    <svg className="asm-pic" viewBox={`${data.x0 - pad} ${data.y0 - pad} ${data.w + 2 * pad} ${data.h + 2 * pad}`} preserveAspectRatio="xMidYMid meet" data-testid="asm-pic" role="img" aria-label={asm.title}>
      {[...data.segs].sort((a, b) => Number(a.hi) - Number(b.hi)).map((s, i) => <polygon key={i} points={s.pts.map((t) => `${t[0]},${t[1]}`).join(' ')} className={s.hi ? 'asm-hi' : s.thin ? 'asm-thin' : 'asm-ln'} vectorEffect="non-scaling-stroke" />)}
    </svg>
  );
}

/** סוג קשיחות הקיר: לציר זה בלבד או לכל הצירים */
function WallTypeSwitch({ asm, scope }: { asm: Asm; scope: 'line' | 'all' }) {
  const br = useStore((s) => s.project.building.bracing);
  const cur = (asm.lineId && br.walls.lineType?.[asm.lineId]) ?? br.walls.type ?? 'x';
  const set = (k: 'x' | 'portal' | 'truss') => {
    const walls = scope === 'line' && asm.lineId
      ? { ...br.walls, lineType: { ...(br.walls.lineType ?? {}), [asm.lineId]: k } }
      : { ...br.walls, type: k, lineType: undefined };
    store.exec(setBuilding({ bracing: { ...br, walls: { ...walls, portal: walls.portal ?? defaultPortal(), truss: walls.truss ?? defaultLockTruss() } } }));
  };
  return (
    <div className="ss-row" role="radiogroup" aria-label="צורת המכלול">
      {([['x', 'אלכסוני X'], ['portal', 'אגד B'], ['truss', 'מסבך נעילה']] as const).map(([k, t]) => (
        <button key={k} className={`btn small${cur === k ? ' on' : ''}`} data-testid={`asm-type-${k}`} onClick={() => set(k)}>{t}</button>
      ))}
    </div>
  );
}

export type AsmScope = 'line' | 'all';

/** ראש המכלול: שם, תמונה, בחירה/בידוד */
export function AssemblyCard({ m }: { m: Member }) {
  const d = useStore((s) => s.derived);
  const asm = useMemo(() => assemblyOf(m, d), [m, d]);
  if (!asm) return null;
  return (
    <div className="asm-card" data-testid="asm-card">
      <div className="asm-h"><b>מכלול:</b> <span data-testid="asm-title">{asm.title}</span></div>
      <AsmPicture asm={asm} sel={m.id} />
      <div className="ss-row">
        <button className="btn small" data-testid="asm-select" onClick={() => store.select(asm.ids.filter((x) => d.byId.has(x)))}>בחר את כל המכלול</button>
        <button className="btn small" data-testid="asm-isolate" onClick={() => store.set({ isolated: asm.ids.filter((x) => d.byId.has(x)) })}>בודד בתצוגה</button>
      </div>
    </div>
  );
}

/** בחירת היקף לקשיחות קירות: ציר זה בלבד / כל הצירים */
export function ScopeSwitch({ scope, setScope }: { scope: AsmScope; setScope: (v: AsmScope) => void }) {
  return <div className="field"><label>חל על</label>
    <div className="ss-row">
      <label className="ss-radio"><input type="radio" checked={scope === 'line'} onChange={() => setScope('line')} data-testid="asm-scope-line" /> ציר זה בלבד</label>
      <label className="ss-radio"><input type="radio" checked={scope === 'all'} onChange={() => setScope('all')} data-testid="asm-scope-all" /> כל הצירים</label>
    </div></div>;
}

/** צורה ומידות של המכלול (בלי חתך — החתך נבחר רק ב"חתך וחומר") */
export function AssemblyShape({ asm, scope, setScope }: { asm: Asm; scope: AsmScope; setScope: (v: AsmScope) => void }) {
  const br = useStore((s) => s.project.building.bracing);
  const wallFam = asm.family === 'lock' || asm.family === 'portal' || asm.family === 'wallx';
  const lineType = (asm.lineId && br.walls.lineType?.[asm.lineId]) ?? br.walls.type ?? 'x';
  const lid = scope === 'line' ? asm.lineId : undefined;
  return (
    <EditCtx.Provider value={{ embed: true, part: 'shape' }}>
      {wallFam && <>
        <ScopeSwitch scope={scope} setScope={setScope} />
        <div className="field"><label>צורה</label><WallTypeSwitch asm={asm} scope={scope} /></div>
        {lineType === 'truss' && <LockTrussFields lineId={lid} />}
        {lineType === 'portal' && <PortalFields lineId={lid} />}
        {lineType === 'x' && <WallXShape />}
      </>}
      {asm.family === 'roofx' && <RoofXShape />}
      {asm.family === 'knee' && <KneeEditor />}
      {asm.family === 'haunch' && <HaunchEditor />}
      {asm.family === 'gutter' && <>
        <GutterSchematic />
        <button className="btn" data-testid="open-gutter-wizard" onClick={() => { const pid = asm.ids.find((x) => x.startsWith('C.GB.'))?.split('.')[2]; store.select([]); store.set({ activeGutter: pid ?? null }); }}>אשף המזחלה המלא</button>
      </>}
    </EditCtx.Provider>
  );
}

/** חיבורי המכלול (פלטות, ברגים, סוג חיבור בכל צד) */
export function AssemblyConn({ asm, scope }: { asm: Asm; scope: AsmScope }) {
  const br = useStore((s) => s.project.building.bracing);
  const lineType = (asm.lineId && br.walls.lineType?.[asm.lineId]) ?? br.walls.type ?? 'x';
  const lid = scope === 'line' ? asm.lineId : undefined;
  const wallFam = asm.family === 'lock' || asm.family === 'portal' || asm.family === 'wallx';
  return (
    <EditCtx.Provider value={{ embed: true, part: 'conn' }}>
      {wallFam && lineType === 'truss' && <LockTrussFields lineId={lid} />}
      {wallFam && lineType === 'portal' && <PortalFields lineId={lid} />}
      {wallFam && lineType === 'x' && <XConnFields />}
      {asm.family === 'roofx' && <RoofXConn />}
      {asm.family === 'knee' && <KneeEditor />}
    </EditCtx.Provider>
  );
}
