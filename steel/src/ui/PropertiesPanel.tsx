import { settingsOf } from './navIndex';
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { resetOverrides, setBuilding, setKneeBraces, setMemberProps, setTransfers, type Command } from '../commands/commands';
import { useFab } from '../fab/useFab';
import { fromMm } from '../core/units';
import { dist } from '../core/vec';
import { cutLength } from '../geometry/solid';
import { massPerMeter, tryProfile } from '../profiles/library';
import { getMaterial, MATERIALS } from '../profiles/materials';
import { store, useStore } from '../store';
import { EditCtx, NumField, ProfilePicker } from './fields';
import { KIND_LABEL, kindLabelOf } from './TreePanel';
import { SpliceEditor } from './SpliceEditor';
import { ConnectionEditor, MemberConnections } from './ConnectionEditor';
import { NavContent, type NavKey } from './SideNav';
import { AssemblyCard, AssemblyConn, AssemblyShape, assemblyOf, type AsmScope } from './AssemblyCard';
import { GutterWizard } from './CladdingPanel';
import { trussFrames, TRUSS_GROUP_HE } from '../geometry/truss';
import { RoofTrussPanel, TransferShape } from './TransferPanel';
import { CleatHubCtx, CleatTypePicker, EndTypePicker } from './ConnTypePicker';
import type { Connection, Member, Project, TransferDef, TrussSpec } from '../model/types';

const f1 = (n: number, d = 1) => n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });

export function PropertiesPanel() {
  const active = useStore((s) => s.activeConn);
  const gutter = useStore((s) => s.activeGutter);
  if (active) return <ConnectionEditor />;
  if (gutter) return <GutterWizard planeId={gutter} />;
  return <PropertiesInner />;
}

function PropertiesInner() {
  const [scope, setScope] = useState<AsmScope>('line');
  const fab = useFab().fab;
  const sel = useStore((s) => s.selection);
  const d = useStore((s) => s.derived);
  const p = useStore((s) => s.project);
  const u = p.displayUnit;
  const L = (mm: number) => (u === 'm' ? `${fromMm(mm, 'm').toFixed(3)} מ'` : `${mm.toFixed(1)} מ"מ`);
  const ms = sel.map((id) => d.byId.get(id)).filter((m): m is NonNullable<typeof m> => !!m);

  if (!ms.length) {
    return (
      <div className="panel-body" data-testid="props-empty">
        <div className="panel-title">מאפיינים</div>
        <div className="hint">לא נבחר אלמנט. לחיצה על אלמנט בתצוגה בוחרת אותו; לחיצה חוזרת באותה נקודה בוחרת את האלמנט שמאחוריו. Ctrl מוסיף/מסיר מהבחירה.</div>
        <div className="panel-title">סיכום מודל</div>
        <ModelSummary />
      </div>
    );
  }

  if (ms.length > 1) {
    const ed = ms.filter((x) => x.kind !== 'bolt');
    const ids = ed.map((x) => x.id);
    const profiles = [...new Set(ed.map((m) => m.profile))];
    const mats = [...new Set(ed.map((m) => m.material))];
    const rolls = [...new Set(ed.map((m) => m.rollDeg))];
    const weight = ms.reduce((s, m) => {
      const pr = tryProfile(m.profile);
      return s + (pr ? massPerMeter(pr, getMaterial(m.material).density) * cutLength(m).max / 1000 : 0);
    }, 0);
    const byKind = new Map<string, string[]>();
    for (const m of ms) byKind.set(m.kind, [...(byKind.get(m.kind) ?? []), m.id]);
    const byMat = new Map<string, string[]>();
    for (const m of ed) byMat.set(m.material, [...(byMat.get(m.material) ?? []), m.id]);
    return (
      <div className="panel-body" data-testid="props-multi">
        <div className="el-head"><div className="k">מאפיינים משותפים</div><div className="t"><b><span data-testid="sel-count">{ms.length}</span> אלמנטים</b></div></div>
        <div className="field prof"><label>חתך</label><ProfilePicker testId="multi-profile" placeholder={profiles.length > 1 ? 'משתנה' : undefined} varies={profiles.length > 1} value={profiles.length === 1 ? profiles[0] : ''} onCommit={(v) => store.exec(setMemberProps(ids, { profile: v }))} /></div>
        <div className="field"><label>חומר</label>
          <select className={`inp${mats.length > 1 ? ' varies' : ''}`} value={mats.length === 1 ? mats[0] : ''} data-testid="multi-material" onChange={(e) => e.target.value && store.exec(setMemberProps(ids, { material: e.target.value }))}>
            {mats.length > 1 && <option value="">משתנה</option>}{MATERIALS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        <div className="field"><label>סיבוב סביב הציר</label><NumField value={rolls.length === 1 ? rolls[0] : NaN} suffix="°" placeholder="משתנה" onCommit={(v) => store.exec(setMemberProps(ids, { rollDeg: v }))} /></div>
        <div className="hint varies-note">שדה "משתנה" אינו משנה דבר עד שמקלידים בו ערך. ערך חדש חל על כל {ed.length} האלמנטים בפקודה אחת — ביטול אחד מחזיר הכול.</div>
        <div className="panel-title">הרכב הבחירה</div>
        <dl className="kv">
          {[...byKind].map(([k, v]) => <Fragment key={k}><dt>{KIND_LABEL[k as keyof typeof KIND_LABEL]}</dt><dd>{v.length} <button className="link-btn" onClick={() => store.select(v)}>בחר רק אותם</button></dd></Fragment>)}
          {byMat.size > 1 && [...byMat].map(([k, v]) => <Fragment key={`m${k}`}><dt>{k}</dt><dd>{v.length} <button className="link-btn" onClick={() => store.select(v)}>בחר רק {k}</button></dd></Fragment>)}
          <dt>חתכים</dt><dd>{profiles.join(', ')}</dd>
          <dt>משקל (גיאומטרי)</dt><dd>{f1(weight)} ק"ג</dd>
        </dl>
        <button className="btn" onClick={() => store.exec(resetOverrides(sel))}>איפוס התאמות ידניות</button>
      </div>
    );
  }

  const m = ms[0];
  const pr = tryProfile(m.profile);
  const mat = getMaterial(m.material);
  const cl = cutLength(m);
  const kgm = pr ? massPerMeter(pr, mat.density) : 0;
  const ov = p.memberOverrides[m.id];
  const stale = d.issues.some((i) => i.code === 'STALE_OVERRIDE' && i.elementId === m.id);
  const frameNo = m.frameId ? p.building.frames.findIndex((f) => f.id === m.frameId) + 1 : 0;
  const conns = d.connections.filter((c) => c.members.includes(m.id) || c.parts.includes(m.id)).length;
  const mark = fab.parts.find((x) => x.memberId === m.id)?.mark;
  const plateLike = m.kind === 'plate' || m.kind === 'cleat' || m.kind === 'bolt' || m.kind === 'anchor';
  const asm = assemblyOf(m, d);
  const fam = asm && asm.family !== 'frame' ? asm : null;
  const inRT = !!p.building.roofTruss?.enabled && !plateLike && (/^TR\./.test(m.id) || /^F[^.]+\.BC\.\d+$/.test(m.id) || (m.kind === 'rafter' && !!m.frameId && trussFrames(p).includes(m.frameId)));
  const tbDef = /^TB\./.test(m.id) && !plateLike ? (p.building.transfers ?? []).find((t) => t.id === m.id.split('.')[1]) ?? null : null;
  const custom = plateLike && m.connId?.startsWith('C.CD.') ? d.connById.get(m.connId)?.custom : undefined;
  return (
    <div className="panel-body" data-testid="props-single">
      <div className="el-head">
        <div className="k">{kindLabelOf(m)}{frameNo > 0 ? ` · מסגרת ${frameNo}` : ''}{m.side ? ` · ${m.side === 'L' ? 'שמאל' : 'ימין'}` : ''} <span className={`badge ${m.source === 'manual' ? 'warn' : 'blue'}`}>{m.source === 'manual' ? 'ידני' : 'פרמטרי'}</span></div>
        <div className="t"><b>{mark ?? m.label}</b><span className="mono" data-testid="prop-id">{m.id}</span></div>
      </div>
      {/* 1 — המכלול: שם ותמונה */}
      <AssemblyCard m={m} />
      {m.manualPlacement && m.source === 'generated' && (
        <div className={`issue ${stale ? 'warning' : ''}`} style={{ marginTop: 6 }}>
          <span className="ic">!</span>
          <div>{stale ? 'מיקום ידני שאינו תקף עוד לאחר שינוי פרמטרי.' : 'האלמנט הוזז ידנית ואינו עוקב אחר הפרמטרים.'}
            <div><button className="btn small" style={{ marginTop: 4 }} onClick={() => store.exec(resetOverrides([m.id]))}>החזר לפרמטרי</button></div></div>
        </div>
      )}
      {/* 2 — חתך וחומר: בוחר חתך אחד בלבד, עם היקף */}
      <PSec id="prof" title={plateLike ? 'חלק וחומר' : 'חתך וחומר'} testId="psec-prof">
        {pr && !plateLike && (
          <div className="sec-card">
            <SectionShape outline={pr.outline.outer} />
            <div style={{ minWidth: 0 }}>
              <div className="nm">{m.profile}</div>
              <div className="dm">h {f1(pr.props.h)} · b {f1(pr.props.b)}</div>
              {pr.verified ? <span className="badge ok" title={pr.source} data-testid="prof-verified">✓ מאומת מקטלוג</span> : <span className="badge warn" title={pr.source}>לא מאומת</span>}
            </div>
          </div>
        )}
        {m.partDesc && <div className="hint" style={{ marginTop: 0 }}>{m.partDesc}</div>}
        {!plateLike && <ProfileScope m={m} />}
        <div className="field"><label>חומר</label>
          <select className="inp" value={m.material} onChange={(e) => store.exec(setMemberProps([m.id], { material: e.target.value }))}>
            {MATERIALS.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </div>
        {m.purlin ? (
          <div className="field"><label>היפוך חתך (פטה זו)</label>
            <select className="inp" data-testid="prop-flip" value={p.memberOverrides[m.id]?.mirror ? '1' : '0'} onChange={(e) => store.exec(setMemberProps([m.id], { mirror: e.target.value === '1' }))}>
              <option value="0">לפי הגדרת הצד</option><option value="1">הפוך מהגדרת הצד</option>
            </select>
          </div>
        ) : !plateLike && (
          <div className="field"><label>היפוך חתך</label>
            <select className="inp" value={m.mirror ? '1' : '0'} onChange={(e) => store.exec(setMemberProps([m.id], { mirror: e.target.value === '1' }))}>
              <option value="0">רגיל</option><option value="1">הפוך</option>
            </select>
          </div>
        )}
        {ov && (ov.profile || ov.material || ov.rollDeg !== undefined || ov.mirror !== undefined) && m.source === 'generated' && (
          <div className="row"><span className="badge warn">ערכים ששונו ידנית</span><button className="btn small" onClick={() => store.exec(resetOverrides([m.id]))}>איפוס</button></div>
        )}
        <dl className="kv" style={{ marginTop: 10 }}>
          <dt>אורך קו ייחוס</dt><dd data-testid="prop-len">{L(dist(m.start, m.end))}</dd>
          <dt>אורך חיתוך מרבי</dt><dd>{L(cl.max)}</dd>
          {m.kind === 'column' && (() => { const br = columnCutBreakdown(m, cl.max); return br ? <><dt>פירוט</dt><dd data-testid="prop-cut-why" style={{ fontSize: 11, lineHeight: 1.35 }}>{br}</dd></> : null; })()}
          <dt>משקל</dt><dd data-testid="prop-weight">{f1((kgm * cl.max) / 1000)} ק"ג</dd>
          <dt>סימון חלק</dt><dd>{mark ?? '—'}</dd>
        </dl>
        {m.purlin && <PurlinInfoBlock id={m.id} />}
      </PSec>
      {/* 3 — צורה ומידות של המכלול */}
      {fam && <PSec id="shape" title={`צורה ומידות — ${fam.title.split(' — ')[0]}`} testId="psec-shape"><div data-testid="hub-settings"><AssemblyShape asm={fam} scope={scope} setScope={setScope} /></div></PSec>}
      {inRT && <PSec id="shape" title="צורה ומידות — מסבך גג" testId="psec-shape"><div data-testid="hub-settings"><EditCtx.Provider value={{ embed: true, part: 'shape' }}><RoofTrussPanel /></EditCtx.Provider></div></PSec>}
      {tbDef && <PSec id="shape" title={`צורה ומידות — ${tbDef.kind === 'truss' ? 'מסבך נושא' : 'קורה נושאת'}`} testId="psec-shape"><div data-testid="hub-settings"><TransferShape id={tbDef.id} /></div></PSec>}
      {/* 4 — חיבורים: סוג חיבור בכל קצה + פרטי החיבור + רשימה */}
      <PSec id="conns" title={`חיבורים${conns ? ` (${conns})` : ''}`} testId="ptab-conns">
        {!plateLike && <DetailEnds m={m} />}
        {fam && <AssemblyConn asm={fam} scope={scope} />}
        {plateLike && m.kind !== 'cleat' && m.connId && (d.connById.get(m.connId)?.type === 'purlin-cleat' || d.connById.get(m.connId)?.custom?.site.includes('|x:')) && <div className="hub-set"><CleatTypePicker connId={m.connId} /></div>}
        {m.purlin && <div className="hub-set"><CleatTypePicker side={m.purlin.paramKey ?? (m.purlin.side === 'R' ? 'right' : 'left')} /></div>}
        {custom && (
          <div className="hub-set"><div className="hub-set-h">פרט מותאם: {p.customDetails?.find((x) => x.id === custom.detailId)?.name}</div>
            <button className="btn primary" data-testid="open-studio-part" onClick={() => store.set({ detailStudio: custom.site })}>פתח בסטודיו פרטים</button></div>
        )}
        {plateLike && !custom && <HubSettings m={m} />}
        <MemberConnections memberId={m.id} />
        {!conns && <div className="hint">אין חיבורים לאלמנט זה.</div>}
        {/* חיבור המשך — רק לאלמנטים ארוכים (לא מוטות מילוי של מסבך, לא תומכים/פלטות) */}
        {['column', 'rafter', 'beam', 'purlin', 'girt'].includes(m.kind) && !/(^|\.)TR\./.test(m.id) && <SpliceEditor m={m} />}
      </PSec>
      {/* 5 — הגדרות כלליות של המבנה (עמוד/קורה/פטה): מקופל */}
      {!plateLike && !fam && !tbDef && !inRT && <PSec id="general" title="הגדרות כלליות (לכל המבנה)" testId="psec-general" closed>
        {/* פטה: החתך וסוג התושבת כבר למעלה — כאן רק פריסה ומידות */}
        <EditCtx.Provider value={m.purlin ? { embed: true, part: 'shape' } : { embed: false }}><HubSettings m={m} /></EditCtx.Provider></PSec>}
      {/* 6 — מתקדם */}
      <PSec id="adv" title="מתקדם — סיבוב, קואורדינטות, תכונות חתך" testId="ptab-adv" closed>
        <div className="field"><label>סיבוב סביב הציר</label><NumField value={m.rollDeg} suffix="°" onCommit={(v) => store.exec(setMemberProps([m.id], { rollDeg: v }))} /></div>
        <div className="panel-title">גיאומטריה</div>
        <dl className="kv">
          <dt>תיאור</dt><dd style={{ direction: 'rtl', textAlign: 'right', fontFamily: 'var(--font)' }}>{m.label}</dd>
          <dt>אורך חיתוך מזערי</dt><dd>{L(cl.min)}</dd>
          <dt>התחלה (X,Y,Z)</dt><dd>{[m.start.x, m.start.y, m.start.z].map((v) => v.toFixed(1)).join(', ')}</dd>
          <dt>סוף (X,Y,Z)</dt><dd>{[m.end.x, m.end.y, m.end.z].map((v) => v.toFixed(1)).join(', ')}</dd>
          <dt>חיתוך התחלה</dt><dd>{m.startCut ? 'מישורי' : 'ניצב'}</dd>
          <dt>חיתוך סוף</dt><dd>{m.endCut ? 'מישורי' : 'ניצב'}</dd>
        </dl>
        {pr && <>
          <div className="panel-title">תכונות חתך {pr.verified ? <span className="badge ok" title={pr.source} data-testid="prof-verified-adv">מאומת</span> : <span className="badge warn" title={pr.source}>לא מאומת</span>}</div>
          <dl className="kv">
            <dt>h × b</dt><dd>{f1(pr.props.h)} × {f1(pr.props.b)} מ"מ</dd>
            <dt>A</dt><dd>{f1(pr.props.area / 100, 2)} ס"מ²</dd>
            <dt>משקל למטר</dt><dd data-testid="prop-kgm">{f1(kgm, 2)} ק"ג/מ'</dd>
            <dt>Iy</dt><dd>{f1(pr.props.Iy / 1e4)} ס"מ⁴</dd>
            <dt>Iz</dt><dd>{f1(pr.props.Iz / 1e4)} ס"מ⁴</dd>
            <dt>Wy / Wz</dt><dd>{f1(pr.props.Wy / 1e3)} / {f1(pr.props.Wz / 1e3)} ס"מ³</dd>
            <dt>iy / iz</dt><dd>{f1(pr.props.iy / 10, 2)} / {f1(pr.props.iz / 10, 2)} ס"מ</dd>
          </dl>
          <div className="hint">{pr.verified ? `מקור: ${pr.source}.` : `מחושב מגיאומטריית החתך. ${pr.note ?? ''} אסור לשימוש בחישובי חוזק עד ייבוא קטלוג מאומת.`}</div>
        </>}
      </PSec>
      <div className="hint">שינוי חל מיד · Ctrl+Z לביטול</div>
    </div>
  );
}

/** סעיף מתקפל בפאנל האלמנט; המצב (פתוח/סגור) נשמר */
function PSec({ id, title, testId, closed, children }: { id: string; title: string; testId?: string; closed?: boolean; children: ReactNode }) {
  const key = `ksp-psec-${id}`;
  let open = !closed;
  try { const v = localStorage.getItem(key); if (v !== null) open = v === '1'; } catch { /* */ }
  return (
    <details className="psec" open={open || undefined} onToggle={(e) => { try { localStorage.setItem(key, (e.currentTarget as HTMLDetailsElement).open ? '1' : '0'); } catch { /* */ } }}>
      <summary data-testid={testId}>{title}</summary>
      <div className="psec-b">{children}</div>
    </details>
  );
}

const FAMS: Record<string, string[]> = { column: ['HEA', 'HEB', 'IPE', 'HEM', 'RHS', 'SHS'], rafter: ['IPE', 'HEA', 'HEB', 'RHS'], beam: ['IPE', 'HEA', 'HEB', 'RHS', 'SHS'], purlin: ['C', 'Z'], girt: ['C', 'Z'], brace: ['L', 'RHS', 'SHS', 'CHS', 'UPN'] };
const PLURAL: Record<string, string> = { column: 'העמודים', rafter: 'קורות הגג', beam: 'הקורות', purlin: 'הפטות', girt: 'פטות הקיר', brace: 'האלכסונים', plate: 'הפלטות', cleat: 'התומכים' };
/** קבוצת "הדומים": אותו סוג ואותו תפקיד (קידומת מזהה) ואותו חתך נוכחי */
export function similarOf(m: Member, all: Member[]): Member[] {
  const role = (x: Member) => x.id.split('.').filter((t) => !/^F\d+$/.test(t) && !/^\d+$/.test(t)).slice(0, 2).join('.');
  const r = role(m);
  return all.filter((x) => x.kind === m.kind && x.profile === m.profile && (x.kind === 'column' || x.kind === 'rafter' || role(x) === r));
}

/** חתך: סוג ← מידה, עם היקף השינוי — האלמנט הזה או כל הדומים בפרויקט */
/**
 * אלמנטים שנבנים מהגדרה כללית (אלכסונים, קושרות, אגד B, סבכת RHS): "כל הדומים" משנה את ההגדרה עצמה;
 * "רק האלמנט הזה" נתמך באלכסוני עמוד-קורה בלבד (בשאר — החתך קובע את פחי החיבור המשותפים).
 */
function profileRoute(m: Member, p: Project): { all: (v: string) => Command; one: boolean; what: string } | null {
  const b = p.building, br = b.bracing;
  const id = m.id;
  if (id.startsWith('KB.')) return { all: (v) => setKneeBraces({ profile: v, sides: Object.fromEntries(Object.entries(b.kneeBraces?.sides ?? {}).map(([k, o]) => [k, { ...o, profile: undefined }])) }), one: true, what: 'אלכסוני עמוד-קורה' };
  if (/^BR\.R/.test(id)) return { all: (v) => setBuilding({ bracing: { ...br, roof: { ...br.roof, profile: v } } }), one: false, what: 'קושרות הגג' };
  if (/^BR\.W/.test(id)) return { all: (v) => setBuilding({ bracing: { ...br, walls: { ...br.walls, profile: v } } }), one: false, what: 'קושרות הקיר' };
  if (/^BR\.T/.test(id)) return { all: (v) => setBuilding({ bracing: { ...br, purlinTies: { ...br.purlinTies, profile: v } } }), one: false, what: 'שורות הקשירה' };
  if (/^BB\./.test(id) && br.walls.portal) { const isK = /\.K\d+$/.test(id); return { all: (v) => setBuilding({ bracing: { ...br, walls: { ...br.walls, portal: { ...br.walls.portal!, ...(isK ? { brace: v } : { beam: v }) } } } }), one: false, what: isK ? 'אלכסוני אגד B' : 'קורות אגד B' }; }
  if (/^TB\./.test(id)) {
    const tid = id.split('.')[1], defs = b.transfers ?? [], def = defs.find((t) => t.id === tid);
    if (def) {
      const put = (patch: Partial<TransferDef>) => setTransfers(defs.map((t) => (t.id === tid ? { ...t, ...patch } : t)));
      if (def.kind === 'truss' && def.truss) {
        const n = def.truss.panels, dm = /\.TR\.D(\d+)[ab]$/.exec(id);
        const g: keyof TrussSpec['profiles'] = /\.BC$/.test(id) ? 'bottom' : /\.TR\.V\d+$/.test(id) ? 'vert' : dm ? (+dm[1] === 0 || +dm[1] === n - 1 ? 'endDiag' : 'diag') : 'top';
        return { all: (v) => put({ truss: { ...def.truss!, profiles: { ...def.truss!.profiles, [g]: v } } }), one: false, what: `${TRUSS_GROUP_HE[g]} במסבך הנושא` };
      }
      return { all: (v) => put({ profile: v }), one: false, what: 'הקורה הנושאת' };
    }
  }
  const rt = b.roofTruss;
  if (rt?.enabled && (/^TR\./.test(id) || /^F[^.]+\.BC\.\d+$/.test(id))) {
    const n = rt.spec.panels, dm = /\.D(\d+)[ab]$/.exec(id);
    const g: keyof TrussSpec['profiles'] = /\.BC\.\d+$/.test(id) ? 'bottom' : /\.V\d+$/.test(id) ? 'vert' : dm ? (+dm[1] === 0 || +dm[1] === n - 1 ? 'endDiag' : 'diag') : 'diag';
    return { all: (v) => setBuilding({ roofTruss: { ...rt, spec: { ...rt.spec, profiles: { ...rt.spec.profiles, [g]: v } } } }), one: false, what: `${TRUSS_GROUP_HE[g]} במסבכי הגג` };
  }
  if (/^HB\./.test(id) && br.roof.rhs) { const isD = /\.D\d+$/.test(id); return { all: (v) => setBuilding({ bracing: { ...br, roof: { ...br.roof, rhs: { ...br.roof.rhs!, ...(isD ? { diag: v } : { strut: v }) } } } }), one: false, what: isD ? 'אלכסוני הסבכה' : 'מוטות הסבכה' }; }
  return null;
}

function ProfileScope({ m }: { m: Member }) {
  const d = useStore((s) => s.derived);
  const p = useStore((s) => s.project);
  // היקף שנבחר מראש (לחיצה על הכפתורים); null = לשאול אחרי בחירת החתך
  const [scope, setScope] = useState<'one' | 'all' | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => { setPending(null); setScope(null); }, [m.id]);
  const sim = similarOf(m, d.members);
  const route = profileRoute(m, p);
  const role = m.kind === 'column' || m.kind === 'rafter' || m.kind === 'purlin' ? m.kind : undefined;
  const allCount = route ? d.members.filter((x) => x.id.split('.')[0] === m.id.split('.')[0] && x.kind === m.kind).length : sim.length;
  const allLabel = route ? `כל ${route.what} (${allCount})` : `כל ${PLURAL[m.kind] ?? 'הדומים'} ב-${m.profile} (${sim.length})`;
  const canChoose = sim.length > 1 && (!route || route.one);
  const apply = (v: string, eff: 'one' | 'all') => {
    setPending(null);
    if (eff === 'all' && route) { store.exec(route.all(v)); const pre = m.id.split('.')[0] + '.'; const ov = Object.keys(p.memberOverrides).filter((x) => x.startsWith(pre) && p.memberOverrides[x]?.profile); if (ov.length) store.exec(resetOverrides(ov)); return; }
    store.exec(setMemberProps(eff === 'all' ? sim.map((x) => x.id) : [m.id], { profile: v }));
  };
  const commit = (v: string) => {
    if (route && !route.one) return apply(v, 'all');
    if (!canChoose) return apply(v, 'one');
    if (scope) return apply(v, scope);
    setPending(v);
  };
  return (
    <>
      <div className="field prof"><label>חתך</label><ProfilePicker testId="prop-profile" value={pending ?? m.profile} families={FAMS[m.kind]} role={role} onCommit={commit} /></div>
      {route && !route.one && <div className="hint" style={{ marginTop: 0 }}>החתך חל על כל {route.what} — פחי החיבור נקבעים לפיו.</div>}
      {pending && (
        <div className="scope-ask" role="alertdialog" aria-label="היקף שינוי החתך" data-testid="scope-ask">
          <div>להחיל <b className="mono">{pending}</b> על:</div>
          <div className="ss-row">
            <button className="btn primary" onClick={() => apply(pending, 'all')} data-testid="scope-ask-all">{allLabel}</button>
            <button className="btn" onClick={() => apply(pending, 'one')} data-testid="scope-ask-one">רק האלמנט הזה</button>
            <button className="btn small" onClick={() => setPending(null)}>ביטול</button>
          </div>
        </div>
      )}
      {canChoose && !pending && (
        <div className="seg scope-seg" role="radiogroup" aria-label="היקף השינוי (אפשר לקבוע מראש; אחרת התוכנה שואלת)">
          <button className={`tbtn${scope === 'one' ? ' on' : ''}`} data-testid="scope-one" onClick={() => setScope(scope === 'one' ? null : 'one')}>רק האלמנט הזה</button>
          <button className={`tbtn${scope === 'all' ? ' on' : ''}`} data-testid="scope-all" onClick={() => setScope(scope === 'all' ? null : 'all')}>{allLabel}</button>
        </div>
      )}
    </>
  );
}

/** כל ההגדרות שקובעות את האלמנט — בתוך הפאנל (במקום חלונית צפה / מעבר לעץ) */
function HubSettings({ m }: { m: Member }) {
  const d = useStore((s) => s.derived);
  // פלטה / תומך / בורג / מוט עיגון: אשף הפלטה של החיבור שלהם
  if (m.kind === 'plate' || m.kind === 'cleat' || m.kind === 'bolt' || m.kind === 'anchor') {
    const base = m.id.replace(/\.(H|S|N)$/, '');
    const c = (m.connId && d.connById.get(m.connId)) || d.connections.find((x) => x.parts.includes(m.id) || x.parts.includes(base));
    if (c && m.kind !== 'cleat') return <StudioPlateButton c={c} />;
    // תומך שאינו תושבת פטה (תומך מזחלה וכו') — רק הסטודיו; הגדרות השיפוע אינן שלו
    if (c && c.type !== 'purlin-cleat') return <StudioPlateButton c={c} />;
    if (c) return <><StudioPlateButton c={c} /><CleatHubCtx.Provider value={c.type === 'purlin-cleat' ? c.id : undefined}><HubNav m={m} /></CleatHubCtx.Provider></>;
  }
  return <HubNav m={m} />;
}

/** אשף הפלטה הוא חלק מהסטודיו: מהמאפיינים פותחים את הסטודיו על החיבור של הפלטה */
function StudioPlateButton({ c }: { c: Connection }) {
  const d = useStore((s) => s.derived);
  const open = () => {
    const pts = c.parts.map((x) => d.byId.get(x)).filter((x): x is Member => !!x).map((x) => ({ x: (x.start.x + x.end.x) / 2, y: (x.start.y + x.end.y) / 2, z: (x.start.z + x.end.z) / 2 }));
    const P = pts.length ? { x: pts.reduce((a, q) => a + q.x, 0) / pts.length, y: pts.reduce((a, q) => a + q.y, 0) / pts.length, z: pts.reduce((a, q) => a + q.z, 0) / pts.length } : null;
    let best: [string, 'start' | 'end', number] | null = null;
    for (const id of c.members) { const mm = d.byId.get(id); if (!mm || !P) continue; for (const e of ['start', 'end'] as const) { const q = mm[e]; const dd = Math.hypot(q.x - P.x, q.y - P.y, q.z - P.z); if (!best || dd < best[2]) best = [id, e, dd]; } }
    store.set({ detailStudio: best ? `${best[0]}|${best[1]}` : `${c.members[0]}|start`, studioConn: c.id });
  };
  return <div className="hub-set" data-testid="plate-studio"><div className="hub-set-h">פלטות וברגים: {c.label}</div>
    <button className="btn primary" data-testid="open-plate-studio" onClick={open}>עריכת הפלטה בסטודיו</button>
    <div className="hint">אשף הפלטה (מידות, חורים, ברגים, סטנדרט מסגריה) נמצא בסטודיו, ליד בניית פרט מותאם.</div></div>;
}

const DETAIL_KINDS = new Set(['column', 'rafter', 'beam', 'brace', 'purlin', 'girt']);
/** פרט חיבור בכל קצה של האלמנט: הפרט הנוכחי (רגיל/מותאם) + פתיחת הסטודיו */
function DetailEnds({ m }: { m: Member }) {
  const p = useStore((s) => s.project);
  const d = useStore((s) => s.derived);
  if (!DETAIL_KINDS.has(m.kind)) return null;
  const lib = new Map((p.customDetails ?? []).map((x) => [x.id, x.name]));
  return (
    <div className="hub-set" data-testid="detail-ends">
      <div className="hub-set-h">סוג חיבור בכל קצה</div>
      <div className="cd-ends">
        {(['start', 'end'] as const).map((e) => {
          const k = `${m.id}|${e}`, det = p.detailAssign?.[k];
          const pt = e === 'start' ? m.start : m.end;
          const near = d.connections.filter((c) => c.type !== 'custom' && (c.members.includes(m.id) || c.parts.includes(m.id))).map((c) => c.label)[0];
          return (
            <div className="cd-end" key={e}>
              <span>{e === 'start' ? 'קצה התחלה' : 'קצה סוף'} <span className="muted mono">z {Math.round(pt.z)}</span> · {det ? <b>{lib.get(det) ?? 'פרט מותאם'}</b> : <span className="muted">{near ? 'פרט רגיל' : 'ללא חיבור'}</span>}</span>
              <EndTypePicker memberId={m.id} end={e} />
            </div>
          );
        })}
      </div>
      <div className="hint">בוחרים פרט רגיל, פרט מהספרייה, או בונים פרט חדש בסטודיו — והוא נוסף לרשימה.</div>
    </div>
  );
}

function HubNav({ m }: { m: Member }) {
  const navOpen = useStore((s) => s.navKey);
  const key = settingsOf(m.id, m.kind, m.purlin?.paramKey ?? (m.purlin?.side === 'R' ? 'right' : m.purlin ? 'left' : undefined));
  const inTruss = m.kind === 'rafter' && !!m.frameId && trussFrames(store.state.project).includes(m.frameId);
  const nav = inTruss ? 'b:truss' : (m.kind === 'column' || m.kind === 'rafter') && !m.id.startsWith('TB.') ? 's:geometry' : m.id.startsWith('TB.') ? 'b:tb' : key?.[0];
  const label = inTruss ? 'מסבך גג (קורת הגג = חגורה עליונה)' : (m.kind === 'column' || m.kind === 'rafter') && !m.id.startsWith('TB.') ? 'גיאומטריה: גבהים, שיפועים וצירים (לכל המסגרות)' : key?.[1];
  if (!nav) return null;
  const GROUP: Record<string, string> = { s: 'structure', b: 'brace', r: 'roof', w: 'clad' };
  const open = navOpen === nav || (!!navOpen && GROUP[nav.split(':')[0]] === navOpen && nav !== 'b:tb' && nav !== 'b:truss');
  if (open) return <div className="hub-set" data-testid="hub-settings"><div className="hub-set-h">⚙ {label}</div><div className="hint">ההגדרות פתוחות בתפריט מימין.</div></div>;
  return (
    <div className="hub-set" data-testid="hub-settings">
      <div className="hub-set-h">⚙ {label}</div>
      <NavContent nav={nav as NavKey} onOpenConn={(id) => store.set({ activeConn: id })} />
    </div>
  );
}

/** שרטוט חתך מוקטן מקו המתאר של הפרופיל. */
function SectionShape({ outline }: { outline: { u: number; v: number }[] }) {
  const us = outline.map((q) => q.u), vs = outline.map((q) => q.v);
  const u0 = Math.min(...us), u1 = Math.max(...us), v0 = Math.min(...vs), v1 = Math.max(...vs);
  const w = u1 - u0 || 1, h = v1 - v0 || 1, k = Math.min(36 / w, 50 / h);
  const pts = outline.map((q) => `${(20 + (q.u - (u0 + u1) / 2) * k).toFixed(2)},${(27 - (q.v - (v0 + v1) / 2) * k).toFixed(2)}`).join(' ');
  return <svg viewBox="0 0 40 54" role="img" aria-label="חתך"><polygon points={pts} fill="#1f5a3f" /></svg>;
}

function ModelSummary() {
  const d = useStore((s) => s.derived);
  const counts = new Map<string, { n: number; len: number; kg: number }>();
  for (const x of d.parts) {
    const pr = tryProfile(x.profile);
    if (!pr) continue;
    const e = counts.get(x.profile) ?? { n: 0, len: 0, kg: 0 };
    e.n++; e.len += x.length; e.kg += (massPerMeter(pr, getMaterial(x.material).density) * x.length) / 1000;
    counts.set(x.profile, e);
  }
  const tot = [...counts.values()].reduce((s, e) => s + e.kg, 0);
  return (
    <>
      <table className="tbl" data-testid="summary">
        <thead><tr><th>חתך</th><th>חלקים</th><th>אורך (מ')</th><th>ק"ג</th></tr></thead>
        <tbody>
          {[...counts.entries()].map(([k, e]) => (
            <tr key={k}><td style={{ direction: 'ltr', textAlign: 'right' }}>{k}</td><td>{e.n}</td><td>{f1(e.len / 1000, 2)}</td><td>{f1(e.kg, 0)}</td></tr>
          ))}
          <tr><td><b>סה"כ</b></td><td /><td /><td><b>{f1(tot, 0)}</b></td></tr>
        </tbody>
      </table>
      <dl className="kv"><dt>נקודות תמיכה לפטות</dt><dd>{d.supports.length}</dd><dt>חיבורי המשך</dt><dd>{d.splices.length} ({d.splices.filter((x) => x.status === 'bolted').length} מוברגים)</dd></dl>
      <div className="hint">משקל גיאומטרי מחתכים לא מאומתים. רשימת חיתוך ו-BOM מלאים — במצב "ייצור".</div>
    </>
  );
}

function PurlinInfoBlock({ id }: { id: string }) {
  const d = useStore((s) => s.derived);
  const p = useStore((s) => s.project);
  const m = d.byId.get(id)!;
  const pi = m.purlin!;
  const u = p.displayUnit;
  const L = (mm: number) => (u === 'm' ? `${fromMm(mm, 'm').toFixed(3)} מ'` : `${mm.toFixed(1)} מ"מ`);
  const sup = d.supports.filter((s) => s.purlinId === id);
  const b = p.building;
  const sideName = { L: 'שמאל', R: 'ימין', M: 'גג חד־שיפועי' }[pi.side];
  return (
    <>
      <div className="panel-title">מיקום הפטה</div>
      <dl className="kv" data-testid="purlin-info">
        <dt>צד גג</dt><dd style={{ direction: 'rtl', textAlign: 'right', fontFamily: 'var(--font)' }}>{sideName}</dd>
        <dt>מספר בצד</dt><dd>{pi.index} / {pi.count}</dd>
        <dt>{pi.side === 'M' ? 'מרחק מקצה ההתחלה' : 'מרחק מהרכס'} (שיפוע)</dt><dd data-testid="purlin-s">{L(pi.sSlope)}</dd>
        <dt>מרחק בהיטל אופקי</dt><dd>{L(pi.sHoriz)}</dd>
        <dt>מרווח מהקודמת</dt><dd>{pi.index > 1 ? L(pi.spanBefore) : '—'}{pi.isLast && pi.index > 1 ? ' (אחרונה)' : ''}</dd>
        <dt>פתיחת החתך</dt><dd style={{ direction: 'rtl', textAlign: 'right', fontFamily: 'var(--font)' }}>{pi.opening === 'up' ? 'לכיוון הרכס / הצד הגבוה' : 'לכיוון המרזב'}</dd>
        <dt>אורך קו</dt><dd>{L(dist(m.start, m.end))}</dd>
        <dt>קונזולות (Y)</dt><dd>{L(b.purlinOverhangStart)} / {L(b.purlinOverhangEnd)}</dd>
        <dt>נקודות תמיכה</dt><dd data-testid="purlin-supports">{sup.length}</dd>
      </dl>
      <div className="hint">מגע עם האגף העליון של קורת הגג: 0 מ"מ. גובה החתך ניצב למישור הגג. מגע גיאומטרי אינו אישור ביצוע.</div>
    </>
  );
}


/**
 * פירוט אורך החיתוך של עמוד: קו הייחוס (מפלס הבסיס עד פני עליון קורת הגג בציר) פחות מה שמעליו ומתחתיו —
 * עומק קורת הגג (אנכי, לפי השיפוע), פלטות ראש העמוד, ופלטת הבסיס כשהיא מרותכת לעמוד (במצב מבוטן — העמוד על הפלטה).
 */
function columnCutBreakdown(m: Member, cut: number): string | null {
  const st = store.state, d = st.derived, p = st.project;
  const L0 = dist(m.start, m.end);
  const eave = d.connections.find((c) => c.type === 'eave' && c.members.includes(m.id));
  const raf = eave ? d.byId.get(eave.members.find((x) => x !== m.id) ?? '') : undefined;
  const parts: string[] = [`קו ייחוס ${Math.round(L0)}`];
  let rest = L0 - cut;
  if (raf) {
    const pr = tryProfile(raf.profile);
    const dx = Math.hypot(raf.end.x - raf.start.x, raf.end.y - raf.start.y), dz = raf.end.z - raf.start.z;
    const k = Math.sqrt(1 + (dz / (dx || 1)) ** 2);
    const hv = (pr?.props.h ?? 0) * k;
    parts.push(`קורת גג ${raf.profile} ${Math.round(hv)}${k > 1.001 ? ' (בשיפוע)' : ''}`); rest -= hv;
    const plates = (eave?.parts ?? []).map((id) => d.byId.get(id)).filter((q): q is Member => !!q && q.kind === 'plate');
    const pt = plates.reduce((s, q) => s + (tryProfile(q.profile)?.dims.t ?? Number(/x(\d+)/.exec(q.profile)?.[1] ?? 0)), 0);
    if (pt) { parts.push(`פלטות ראש ${plates.length}×${Math.round(pt / plates.length)}`); rest -= pt; }
  }
  const base = p.connectionDefaults.base;
  if (base.enabled && (base.mode ?? 'embedded') === 'bolted') { parts.push(`פלטת בסיס ${base.t}`); rest -= base.t; }
  if (rest > 1) parts.push(`מכפל / מרווח ${Math.round(rest)}`);
  return `${parts.join(' − ')}${rest < -1 ? ` + ${Math.round(-rest)} (הצד הגבוה של ראש בשיפוע)` : ''} = ${Math.round(cut)}`;
}
