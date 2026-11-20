import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { setBuilding, setMemberProps, setPurlinSide } from '../commands/commands';
import { defaultRidgeReinf } from '../model/defaults';
import { defaultRhsTruss } from '../geometry/hbrace';
import { defaultSagRods, defaultFlyBraces } from '../geometry/roofExtras';
import { defaultCladding } from '../geometry/cladding';
import { defaultWing } from '../geometry/wing';
import { purlinParams } from '../geometry/purlins';
import type { DerivedModel, Member, Project, ValidationIssue } from '../model/types';
import { store, useStore } from '../store';
import { familySet } from '../view/realView';
import { ComponentTable } from './ComponentTable';
import { openConnStudio } from './ComponentWindow';
import { CladdingPanel } from './CladdingPanel';
import { NumField, ProfilePicker } from './fields';
import { LiveView3D } from './LiveView3D';
import { DetailEnds, EndCards } from './PropertiesPanel';
import { PlaneStart, RoofPanel, SideEditor } from './RoofPanel';
import { RidgeSchematic } from './schematics';
import { PurlinExtras, RafterStrutsEditor, RoofXConn, RoofXGrid, RoofXSplit, StructurePanel } from './StructurePanel';
import type { NavKey } from './SideNav';
import { RoofTrussPanel, TransferPanel, TransferShape } from './TransferPanel';
import { WingPanel } from './WingPanel';
import { WizardNavigation, WizardScopeSelector, WizardSection, WizardTypeSelector, WizardValidation, wizardClip, wizardCopy, type WzSec, type WzType } from './wizard/Wizard';

/**
 * 1.58: KAYAN Unified Engineering Wizard System — אשף אחיד לכל משפחות הרכיבים.
 * אותו מבנה בדיוק כמו קשיחות הקירות והאלכסונים: סוג → "השינויים יחולו על" → 1 מיקום · 2 גיאומטריה · 3 חתך ומחברים → פעולות.
 * כל משפחה מוגדרת בטבלה (FAMILIES) ומשתמשת בעורכים הקיימים — אין עורך כפול, כל הגדרה נמצאת במקום אחד.
 * המנוע, החישובים ומודל הנתונים לא משתנים.
 */
export type FamKey = 'roofx' | 'ties' | 'ridge' | 'purlins' | 'clad' | 'tb' | 'wing' | 'truss' | 'frame';

const isPart = (m: Member) => m.kind === 'plate' || m.kind === 'bolt' || m.kind === 'cleat' || m.kind === 'anchor';

interface Ctx {
  p: Project; d: DerivedModel;
  sub: string; setSub: (k: string) => void;
  scope: string;
  /** האלמנט שנבחר (אם שייך למשפחה) */
  sel?: Member;
}
interface FamDef {
  title: string; crumb: string; pic: string; tint: string;
  /** מזהי האלמנטים והחיבורים של המשפחה (גם חלקי החיבור: C.<id>…) */
  re: RegExp;
  /** אלמנטים נוספים לפי סוג (פטות, תושבות…) */
  kinds?: Member['kind'][];
  nav: NavKey[];
  /** כניסה מהעץ/הריבון: לאיזה סוג/היקף/קבוצה */
  init?: (nav: NavKey, p: Project) => { sub?: string; scope?: string; sec?: WzSec };
  types?: (c: Ctx) => { label: string; items: WzType<string>[]; value: string | null; pick: (k: string) => void; extra?: ReactNode; component?: boolean };
  enabled?: (c: Ctx) => boolean;
  off?: (c: Ctx) => ReactNode;
  /** היקפים מיוחדים (ברירת מחדל: האלמנט שנבחר / כל המודל) */
  scopes?: (c: Ctx) => { key: string; title: string; ids: string[]; disabled?: string }[];
  loc: (c: Ctx) => ReactNode; geo: (c: Ctx) => ReactNode; conn: (c: Ctx) => ReactNode;
  subs?: (c: Ctx) => Partial<Record<WzSec, string>>;
  codes?: string[];
  copy?: { get: (c: Ctx) => unknown; put: (c: Ctx, v: unknown) => void; label?: (c: Ctx) => string };
  /** טבלת המופעים במיקום */
  table?: RegExp;
}

const b0 = () => store.state.project.building;
const setBr = (patch: Partial<Project['building']['bracing']>) => store.exec(setBuilding({ bracing: { ...b0().bracing, ...patch } }));
const Note = ({ children }: { children: ReactNode }) => <div className="ks-note">{children}</div>;
const sides = (p: Project, d: DerivedModel) => {
  const purl = d.members.filter((m) => m.purlin);
  const planes = d.section?.planes ?? [];
  if (p.building.section) return planes.map((pl) => ({ key: pl.id, side: pl.params, title: `פטות ${pl.label}`, free: pl.startFree, planeId: pl.id as string | undefined, items: purl.filter((m) => m.purlin!.side === pl.id) }));
  if (p.building.roofType === 'gable') return [{ key: 'L', side: 'left', title: 'שיפוע שמאל', items: purl.filter((m) => m.purlin!.side === 'L') }, { key: 'R', side: 'right', title: 'שיפוע ימין', items: purl.filter((m) => m.purlin!.side === 'R') }].map((x) => ({ ...x, free: undefined, planeId: undefined }));
  return [{ key: 'M', side: 'left', title: 'שיפוע הגג', free: undefined, planeId: undefined, items: purl.filter((m) => m.purlin!.side === 'M') }];
};

export const FAMILIES: Record<FamKey, FamDef> = {
  // ---------------- קושרות גג ----------------
  roofx: {
    title: 'קושרות גג', crumb: 'חיזוקים', pic: 'roofX', tint: 'teal', re: /^(C\.)?(BR\.R|HB\.|RS\d+\.)/, nav: ['b:roof'], table: /^(BR\.R|HB\.|RS\d+\.)/,
    codes: ['X_STRUT', 'X_STRUT_SHORT', 'X_COUNT', 'X_SNAP', 'BRACE_LONG', 'HB_NARROW', 'ROD_PROFILE', 'RS_OUT', 'RS_DEEP', 'RS_YSPLIT', 'RS_RHS', 'RS_BOLTS', 'STRUT_CLASH'],
    types: ({ p }) => {
      const r = p.building.bracing.roof;
      return { label: 'סוג קושרות הגג', value: r.enabled ? r.type ?? 'x' : null,
        items: [{ key: 'x', title: 'X מזוויתנים', sub: 'מתיחה בלבד', testId: 'br-roof-type-x' }, { key: 'rhs', title: 'סבכה אופקית RHS', sub: 'מוטות + אלכסונים', testId: 'br-roof-type-rhs' }],
        pick: (k) => setBr({ roof: { ...b0().bracing.roof, enabled: true, type: k as 'x' | 'rhs', rhs: b0().bracing.roof.rhs ?? defaultRhsTruss() } }),
        extra: <label className="ks-off"><input type="checkbox" data-testid="br-roof" checked={r.enabled} onChange={(e) => setBr({ roof: { ...b0().bracing.roof, enabled: e.target.checked } })} />פעיל</label> };
    },
    enabled: ({ p }) => p.building.bracing.roof.enabled,
    off: () => <><div className="ks-empty">בחרו סוג כדי להוסיף קושרות גג. תמוכות בין הקורות אפשר להגדיר גם בלי קושרות:</div><RafterStrutsEditor /></>,
    loc: () => <><Note>באילו מפתחים ובכמה פנלים לאורך השיפוע — לחיצה על תא בתוכנית: ללא → X אחד → 2 → 3.</Note><RoofXGrid /><RoofXSplit /></>,
    geo: ({ p }) => { const r = p.building.bracing.roof; const sr = (patch: Partial<typeof r>) => setBr({ roof: { ...b0().bracing.roof, ...patch } }); return <>
      <RafterStrutsEditor />
      <div className="wz-sub">מרווחים בקצוות הקושרות</div>
      <div className="field"><label>שני קצוות באותה נקודה, אותו מפתח</label><NumField testId="br-samegap" value={r.sameGap ?? 200} suffix='מ"מ' onCommit={(v) => sr({ sameGap: Math.max(0, v) })} /></div>
      {r.endDetail === 'rod' && <div className="field"><label>מפתחים סמוכים — מוטות זה מעל זה</label><NumField testId="br-adjgap" value={r.adjGap ?? 40} suffix='מ"מ' onCommit={(v) => sr({ adjGap: Math.max(0, v) })} /></div>}
      <div className="field"><label>מרחק מפני עמוד שממשיך מעל הגג</label><NumField testId="br-colclear" value={r.colClear ?? 150} suffix='מ"מ' onCommit={(v) => sr({ colClear: Math.max(0, v) })} /></div>
    </>; },
    conn: ({ p }) => { const r = p.building.bracing.roof; return <>
      {(r.type ?? 'x') === 'x' && <div className="field prof"><label>חתך הקושרת</label><ProfilePicker testId="br-roof-prof" value={r.profile} families={['L', 'RHS', 'SHS', 'CHS']} onCommit={(v) => setBr({ roof: { ...b0().bracing.roof, profile: v } })} /></div>}
      <RoofXConn />
    </>; },
    subs: ({ p, d }) => ({ loc: `${Math.round(d.members.filter((m) => /^BR\.R/.test(m.id)).length / 2)} אלכסונים`, geo: `${p.building.bracing.rafterStruts?.rows.length ?? 0} שורות תמוכה`, conn: (p.building.bracing.roof.type ?? 'x') === 'x' ? p.building.bracing.roof.profile : 'RHS' }),
    copy: { get: ({ p }) => p.building.bracing.roof, put: (_c, v) => setBr({ roof: v as Project['building']['bracing']['roof'] }) },
  },

  // ---------------- פטות: קשירה, מוטות תלייה, תמיכה צידית ----------------
  ties: {
    title: 'פטות: קשירה, מוטות, תמיכה', crumb: 'חיזוקים', pic: 'ties', tint: 'teal', re: /^(C\.)?(BR\.T|SR\.|FB\.)/, nav: ['b:ties'], table: /^(BR\.T|SR\.|FB\.)/,
    types: ({ p, sub, setSub }) => {
      const br = p.building.bracing;
      const on = { ties: br.purlinTies.enabled, sag: !!br.sagRods?.enabled, fly: !!br.flyBraces?.enabled } as Record<string, boolean>;
      const toggle = (k: string, v: boolean) => {
        const b = b0().bracing;
        if (k === 'ties') setBr({ purlinTies: { ...b.purlinTies, enabled: v } });
        if (k === 'sag') setBr({ sagRods: { ...(b.sagRods ?? defaultSagRods()), enabled: v } });
        if (k === 'fly') setBr({ flyBraces: { ...(b.flyBraces ?? defaultFlyBraces()), enabled: v } });
      };
      return { label: 'רכיב', value: sub, component: true,
        items: [
          { key: 'ties', title: 'שורות קשירה', sub: on.ties ? 'פעיל' : 'כבוי', testId: 'fam-sub-ties' },
          { key: 'sag', title: 'מוטות תלייה', sub: on.sag ? 'פעיל' : 'כבוי', testId: 'fam-sub-sag' },
          { key: 'fly', title: 'תמיכה צידית', sub: on.fly ? 'פעיל' : 'כבוי', testId: 'fam-sub-fly' },
        ],
        pick: setSub,
        extra: <label className="ks-off"><input type="checkbox" data-testid={sub === 'ties' ? 'br-ties' : sub === 'sag' ? 'sr-on' : 'fb-on'} checked={on[sub]} onChange={(e) => toggle(sub, e.target.checked)} />פעיל</label> };
    },
    init: () => ({ sub: 'ties' }),
    enabled: ({ p, sub }) => (sub === 'ties' ? p.building.bracing.purlinTies.enabled : sub === 'sag' ? !!p.building.bracing.sagRods?.enabled : !!p.building.bracing.flyBraces?.enabled),
    off: ({ sub }) => <div className="ks-empty">{sub === 'ties' ? 'זוויתן באמצע כל מפתח, צמוד לאגף התחתון של הפטות — מונע את הפיתול שלהן.' : sub === 'sag' ? 'מוט הברגה דרך ווב הפטות לאורך השיפוע — מקטין את מפתח הפטה בכיוון החלש.' : 'זוויתן ב-45° מהפטה אל תחתית קורת הגג — מייצב את האגף התחתון ברוח.'} סמנו "פעיל" כדי להוסיף.</div>,
    loc: ({ sub }) => <Note>{sub === 'ties' ? 'שורה באמצע כל מפתח, בכל השיפועים.' : sub === 'sag' ? 'מספר השורות בכל מפתח נקבע בגיאומטריה.' : 'תדירות (כל פטה / כל פטה שנייה…) נקבעת בגיאומטריה.'}</Note>,
    geo: ({ sub }) => (sub === 'ties' ? <Note>שורת הקשירה צמודה לאגף התחתון של הפטות, באמצע המפתח — אין מידות נוספות.</Note> : <PurlinExtras which={sub as 'sag' | 'fly'} />),
    conn: ({ p, sub }) => (sub === 'ties' ? <div className="field prof"><label>חתך שורת הקשירה</label><ProfilePicker testId="br-ties-prof" value={p.building.bracing.purlinTies.profile} families={['L', 'RHS', 'SHS', 'CHS']} onCommit={(v) => setBr({ purlinTies: { ...b0().bracing.purlinTies, profile: v } })} /></div>
      : <Note>{sub === 'sag' ? 'קוטר המוט — בגיאומטריה. אומים בשני צידי הווב.' : 'החתך והבורג — בגיאומטריה.'}</Note>),
    subs: ({ p, sub }) => ({ conn: sub === 'ties' ? p.building.bracing.purlinTies.profile : sub === 'sag' ? `Ø${p.building.bracing.sagRods?.d ?? ''}` : p.building.bracing.flyBraces?.profile ?? '' }),
  },

  // ---------------- חיזוק רכס ----------------
  ridge: {
    title: 'חיזוק רכס', crumb: 'חיזוקים', pic: 'ridge', tint: 'teal', re: /^(C\.)?(RT\.|C\.RIDGE)/, nav: ['b:ridge'],
    types: ({ p }) => {
      const rr = p.building.ridgeReinf ?? { ...defaultRidgeReinf(), type: 'none' as const };
      return { label: 'שיטת חיזוק הרכס', value: rr.type === 'none' ? null : rr.type,
        items: [{ key: 'plate', title: 'פלטה מוגבהת', sub: 'פלטות קצה מוגבהות + משולשים', testId: 'ridge-type-plate' }, { key: 'tie', title: 'פרופיל אופקי', sub: 'קורה מתחת לרכס', testId: 'ridge-type-tie' }],
        pick: (k) => store.exec(setBuilding({ ridgeReinf: { ...(b0().ridgeReinf ?? defaultRidgeReinf()), type: k as 'plate' | 'tie' } })),
        extra: <label className="ks-off"><input type="checkbox" data-testid="ridge-on" checked={rr.type !== 'none'} onChange={(e) => store.exec(setBuilding({ ridgeReinf: { ...(b0().ridgeReinf ?? defaultRidgeReinf()), type: e.target.checked ? 'plate' : 'none' } }))} />פעיל</label> };
    },
    enabled: ({ p }) => (p.building.ridgeReinf?.type ?? 'none') !== 'none',
    off: ({ d }) => <div className="ks-empty">{d.connections.some((c) => c.type === 'ridge') ? 'בחרו שיטה כדי לחזק את חיבורי הרכס.' : 'אין רכס במודל (גג חד־שיפועי או רכס מעל עמוד) — אין מה לחזק.'}</div>,
    loc: ({ d }) => <><Note>החיזוק נבנה בכל חיבורי הרכס — {d.connections.filter((c) => c.type === 'ridge' && /^C\.RIDGE/.test(c.id)).length} מסגרות.</Note></>,
    geo: ({ p }) => { const rr = p.building.ridgeReinf ?? defaultRidgeReinf(); return <><RidgeSchematic />{rr.type === 'tie' && <div className="field"><label>מרווח מתחת לקורות ברכס</label><NumField testId="rr-gap" value={rr.tieGap} suffix='מ"מ' onCommit={(v) => store.exec(setBuilding({ ridgeReinf: { ...rr, tieGap: v } }))} /></div>}</>; },
    conn: ({ p }) => { const rr = p.building.ridgeReinf ?? defaultRidgeReinf(); return rr.type === 'tie'
      ? <div className="field prof"><label>חתך הפרופיל</label><ProfilePicker testId="rr-tie" value={rr.tieProfile} families={['IPE', 'UPN', 'HEA', 'RHS']} onCommit={(v) => store.exec(setBuilding({ ridgeReinf: { ...rr, tieProfile: v } }))} /></div>
      : <Note>פלטות הקצה ברכס מוגבהות ונוספת שורת ברגים; פלטה משולשת מרותכת מתחת לכל קורה. המידות — על השרטוט בגיאומטריה.</Note>; },
    subs: ({ p }) => ({ geo: p.building.ridgeReinf?.type === 'tie' ? 'פרופיל אופקי' : 'פלטה מוגבהת', conn: p.building.ridgeReinf?.type === 'tie' ? p.building.ridgeReinf.tieProfile : '' }),
  },

  // ---------------- פטות ותושבות ----------------
  purlins: {
    title: 'פטות ותושבות', crumb: 'גג ופטות', pic: 'slope', tint: 'mustard', re: /^(C\.)?(PL\.|CL\.|C\.PS\.|C\.PC\.)/, kinds: ['purlin'], nav: ['r:left', 'r:right', 'r:splices'], table: /^(PL\.|CL\.)/,
    init: (nav, p) => ({ scope: nav === 'r:right' ? (p.building.section ? undefined : 'R') : undefined, sec: nav === 'r:splices' ? 'conn' : 'geo' }),
    scopes: ({ p, d }) => sides(p, d).map((s) => ({ key: s.key, title: s.title, ids: s.items.map((m) => m.id) })),
    loc: ({ p, d, scope }) => { const s = sides(p, d).find((x) => x.key === scope) ?? sides(p, d)[0]; return s ? <><Note>מיקומי הפטות לאורך השיפוע — פריסה אוטומטית או ידנית.</Note><SideEditor side={s.side} title={s.title} freeStart={s.free} items={s.items} part="positions" /></> : null; },
    geo: ({ p, d, scope }) => { const s = sides(p, d).find((x) => x.key === scope) ?? sides(p, d)[0]; return s ? <>{s.planeId && <PlaneStart planeId={s.planeId} />}<SideEditor side={s.side} title={s.title} freeStart={s.free} items={s.items} part="layout" /><details className="ks-more"><summary>חומר וצד התחלה — כל הגג</summary><RoofPanel section="system" /></details></> : null; },
    conn: ({ p, d, scope }) => { const s = sides(p, d).find((x) => x.key === scope) ?? sides(p, d)[0]; return s ? <><SideEditor side={s.side} title={s.title} freeStart={s.free} items={s.items} part="cleat" /><details className="ks-more" open={false}><summary>חיבורי המשך פטות — כל הגג</summary><RoofPanel section="splices" /></details></> : null; },
    subs: ({ p, d, scope }) => { const s = sides(p, d).find((x) => x.key === scope) ?? sides(p, d)[0]; const prm = s ? purlinParams(p.building.purlins, s.side) : null; return { loc: `${s?.items.length ?? 0} פטות`, geo: prm ? `מרווח ${prm.spacing}` : '', conn: prm ? prm.profile : '' }; },
    copy: {
      get: ({ p, d, scope }) => { const s = sides(p, d).find((x) => x.key === scope) ?? sides(p, d)[0]; return s ? purlinParams(p.building.purlins, s.side) : null; },
      put: ({ p, d, scope }, v) => { const s = sides(p, d).find((x) => x.key === scope) ?? sides(p, d)[0]; if (s && v) { const { manualPositions: _m, ...rest } = v as ReturnType<typeof purlinParams>; void _m; store.exec(setPurlinSide(s.side as 'left', rest)); } },
      label: ({ p, d, scope }) => `ל${(sides(p, d).find((x) => x.key === scope) ?? sides(p, d)[0])?.title ?? ''}`,
    },
  },

  // ---------------- חיפוי, פטות קיר, מזחלות, פתחים ----------------
  clad: {
    title: 'קירות וחיפוי', crumb: 'קירות וחיפוי', pic: 'walls', tint: 'mustard', re: /^(C\.)?(GT\.|WP\.|C\.GB\.)/, nav: ['w:roof', 'w:walls', 'w:openings'], table: /^(GT\.|WP\.)/,
    init: (nav) => ({ sub: nav === 'w:walls' ? 'walls' : nav === 'w:openings' ? 'openings' : 'roof', sec: nav === 'w:openings' ? 'loc' : 'geo' }),
    types: ({ sub, setSub, p }) => ({ label: 'רכיב', value: sub, component: true, pick: setSub,
      items: [{ key: 'roof', title: 'חיפוי גג ומזחלות', sub: p.building.cladding?.roof.enabled ? 'פעיל' : 'כבוי', testId: 'fam-sub-roof' }, { key: 'walls', title: 'חיפוי קירות ופטות קיר', testId: 'fam-sub-walls' }, { key: 'openings', title: 'פתחים', sub: `${p.building.cladding?.openings.length ?? 0}`, testId: 'fam-sub-openings' }] }),
    enabled: ({ p }) => !!p.building.cladding,
    off: () => <><div className="ks-empty">חיפוי גג וקירות, פטות קיר ועמודי רוח, פתחים, מזחלות ומרזבים — עם כתב כמויות.</div><button className="btn primary" data-testid="clad-enable" onClick={() => store.exec(setBuilding({ cladding: defaultCladding() }))}>הוספת חיפוי למבנה</button></>,
    loc: ({ sub }) => (sub === 'openings' ? <CladdingPanel section="openings" /> : <Note>{sub === 'roof' ? 'החיפוי מכסה את כל מישורי הגג; המזחלות — במפתחים שנבחרים בגיאומטריה.' : 'פטות הקיר ועמודי הרוח — בכל הקירות שמסומנים בגיאומטריה.'}</Note>),
    geo: ({ sub }) => (sub === 'openings' ? <Note>מידות הפתח ומיקומו — ברשימת הפתחים (מיקום במבנה).</Note> : <CladdingPanel section={sub as 'roof' | 'walls'} />),
    conn: ({ sub }) => <Note>{sub === 'roof' ? 'תושבות המזחלה ופחי הקצה — בחיבורים שלמטה (אשף / סטודיו).' : sub === 'walls' ? 'תושבות פטות הקיר לעמודים — בחיבורים שלמטה.' : 'משקופי הפתח מחוברים לפטות הקיר.'}</Note>,
    copy: { get: ({ p }) => p.building.cladding, put: (_c, v) => store.exec(setBuilding({ cladding: v as Project['building']['cladding'] })) },
  },

  // ---------------- דילול עמודים — קורות נושאות ----------------
  tb: {
    title: 'דילול עמודים — קורות נושאות', crumb: 'רכיבים מיוחדים', pic: 'frames', tint: 'mustard', re: /^(C\.)?(TB\.|KT\.|C\.TB|C\.KT)/, nav: ['b:tb'], table: /^(TB\.|KT\.)/,
    loc: () => <><Note>הקורות הנושאות לפי ציר וקבוצה — "ערוך" פותח את כל הפרטים של הקבוצה. לביטול עמודים: בחירה במודל ← "בטל עמודים".</Note><TransferPanel /></>,
    geo: ({ sel, p }) => { const id = sel ? (/^(?:TB|KT)\.([^.]+)/.exec(sel.id)?.[1]) : undefined; const t = id ? (p.building.transfers ?? []).find((x) => x.id === id || sel!.id.includes(x.id)) : undefined; return t ? <TransferShape id={t.id} /> : <Note>בחרו קורה נושאת במודל כדי לערוך אותה כאן, או "ערוך" בקבוצה (מיקום במבנה).</Note>; },
    conn: () => <Note>התמיכה בעמוד, מושב קורת הגג ואלכסוני Y — בעורך הקבוצה (מיקום במבנה) ובחיבורים שלמטה.</Note>,
    subs: ({ p }) => ({ loc: `${p.building.transfers?.length ?? 0} קורות` }),
  },

  // ---------------- כנף ----------------
  wing: {
    title: 'כנף — סככת L', crumb: 'רכיבים מיוחדים', pic: 'geometry', tint: 'mustard', re: /^(C\.)?W\./, nav: ['b:wing'],
    types: ({ p }) => { const w = p.building.wing; return { label: 'סוג גג הכנף', value: w?.enabled ? w.roofType : null,
      items: [{ key: 'gable', title: 'דו-שיפועי', sub: 'רכס ניצב לסככה', testId: 'wing-add-gable' }, { key: 'mono', title: 'חד-שיפועי', sub: 'יורד החוצה מהקיר', testId: 'wing-add-mono' }],
      pick: (k) => { const b = b0(); const cur = b.wing; store.exec(setBuilding({ wing: cur ? { ...defaultWing(b, k as 'gable' | 'mono'), side: cur.side, fromFrame: cur.fromFrame, enabled: true } : defaultWing(b, k as 'gable' | 'mono') })); },
      extra: w ? <label className="ks-off"><input type="checkbox" data-testid="wing-on" checked={w.enabled} onChange={(e) => store.exec(setBuilding({ wing: { ...w, enabled: e.target.checked } }))} />פעיל</label> : undefined }; },
    enabled: ({ p }) => !!p.building.wing?.enabled,
    off: () => <div className="ks-empty">בחרו סוג גג כדי להוסיף כנף נמוכה לקיר הצד של הסככה.</div>,
    loc: () => <WingPanel part="loc" />, geo: () => <WingPanel part="geo" />, conn: () => <WingPanel part="conn" />,
    subs: ({ p }) => ({ loc: p.building.wing ? `${p.building.wing.bays} מפתחים` : '', geo: p.building.wing ? `${p.building.wing.slopePct}%` : '' }),
  },

  // ---------------- מסבכי גג ----------------
  truss: {
    title: 'מסבכי גג', crumb: 'רכיבים מיוחדים', pic: 'roofX', tint: 'mustard', re: /^(C\.)?(TR\.|C\.TR)/, nav: ['b:truss'], table: /^TR\./,
    types: ({ p }) => { const rt = p.building.roofTruss; return { label: 'צורת המסבך', value: rt?.enabled ? rt.shape : null,
      items: [{ key: 'flat', title: 'חגורה אופקית', testId: 'rt-shape-flat' }, { key: 'parallel', title: 'מקבילה לגג', testId: 'rt-shape-parallel' }, { key: 'scissor', title: '"מספריים"', sub: 'מוגבהת ברכס', testId: 'rt-shape-scissor' }],
      pick: (k) => { const r = b0().roofTruss; if (r) store.exec(setBuilding({ roofTruss: { ...r, enabled: true, shape: k as 'flat', rise: r.rise ?? 1000 } })); },
      extra: rt ? <label className="ks-off"><input type="checkbox" data-testid="rt-on" checked={rt.enabled} onChange={(e) => store.exec(setBuilding({ roofTruss: { ...rt, enabled: e.target.checked } }))} />פעיל</label> : undefined }; },
    enabled: ({ p }) => !!p.building.roofTruss?.enabled,
    off: () => <RoofTrussPanel />,
    loc: () => <RoofTrussPanel part="loc" />, geo: () => <RoofTrussPanel part="geo" />,
    conn: () => <Note>חתכי החגורות, האנכיים והאלכסונים — באשף המסבך (גיאומטריה). חיבורי המשך וחיבור החגורה לעמודים — בחיבורים שלמטה.</Note>,
    copy: { get: ({ p }) => p.building.roofTruss?.spec, put: (_c, v) => { const r = b0().roofTruss; if (r && v) store.exec(setBuilding({ roofTruss: { ...r, spec: v as typeof r.spec } })); } },
  },

  // ---------------- מסגרות: צירים, גבהים, חתכים ----------------
  frame: {
    title: 'מסגרות — צירים, גבהים וחתכים', crumb: 'מבנה', pic: 'geometry', tint: 'teal', re: /^(C\.)?(F\d+\.|C\.EAVE|C\.BASE|C\.RIDGE)/, kinds: ['column', 'rafter'], nav: ['s:geometry', 's:profiles'],
    init: (nav) => ({ sec: nav === 's:profiles' ? 'conn' : 'loc' }),
    loc: () => <StructurePanel section="geometry" />,
    geo: ({ p }) => <Note>{p.building.section ? 'גבהים ושיפועים — בלשונית "מישורי גג וגבהים" (מיקום במבנה).' : 'רוחב, גובה ושיפוע — בלשונית "צירים" (מיקום במבנה). השרטוט למעלה מתעדכן מיד.'}</Note>,
    conn: () => <StructurePanel section="profiles" />,
    subs: ({ p }) => ({ loc: `${p.building.frames.length} מסגרות`, conn: `${p.building.columnProfile} · ${p.building.rafterProfile}` }),
  },
};

export const famOfNav = (k: NavKey): FamKey | null => (Object.keys(FAMILIES) as FamKey[]).find((f) => FAMILIES[f].nav.includes(k)) ?? null;
/** לחיצה על אלמנט במודל — אילו משפחות נפתחות ישר באשף (השאר: כרטיס האלמנט) */
const CLICK: FamKey[] = ['roofx', 'ties'];
export function famOfMember(m: Member | undefined, d: DerivedModel): FamKey | null {
  if (!m) return null;
  const id = isPart(m) && m.connId ? d.connById.get(m.connId)?.members[0] ?? m.connId : m.id;
  return CLICK.find((f) => new RegExp(FAMILIES[f].re.source.replace('^(C\\.)?', '^')).test(id)) ?? null;
}
export function famOfConn(id: string | null | undefined): FamKey | null {
  if (!id) return null;
  return CLICK.find((f) => FAMILIES[f].re.test(id.replace(/^C\./, '')) && /^C\./.test(id)) ?? null;
}
export const famMatch = (f: FamKey) => { const F = FAMILIES[f]; return (m: Member) => F.re.test(m.id) || (!!F.kinds && F.kinds.includes(m.kind)) || (!!m.connId && F.re.test(m.connId)); };

export function FamilyStudio({ fam, nav, memberId }: { fam: FamKey; nav: NavKey; memberId?: string }) {
  const p = useStore((s) => s.project), d = useStore((s) => s.derived);
  const F = FAMILIES[fam];
  const match = useMemo(() => famMatch(fam), [fam]);
  const selRaw = memberId ? d.byId.get(memberId) : undefined;
  const sel = selRaw && match(selRaw) ? (isPart(selRaw) && selRaw.connId ? d.byId.get(d.connById.get(selRaw.connId)?.members.find((x) => d.byId.get(x) && match(d.byId.get(x)!)) ?? '') ?? selRaw : selRaw) : undefined;
  const init = F.init?.(nav, p) ?? {};
  const [sub, setSub] = useState<string>(init.sub ?? '');
  const custom = F.scopes?.({ p, d, sub, setSub, scope: '', sel });
  const [scope, setScope] = useState<string>(init.scope ?? (custom ? custom[0]?.key ?? 'all' : sel ? 'one' : 'all'));
  const [sec, setSec] = useState<WzSec>(init.sec ?? 'loc');
  const [wide, setWide] = useState(false);
  // כניסה חוזרת מהעץ/הריבון לאותה משפחה (למשל שיפוע שמאל → ימין) — הסוג, ההיקף והקבוצה מתעדכנים
  useEffect(() => { const i = F.init?.(nav, store.state.project) ?? {}; if (i.sub) setSub(i.sub); if (i.scope) setScope(i.scope); if (i.sec) setSec(i.sec); }, [nav]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (sel && !custom) setScope('one'); }, [sel?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const activeConn = useStore((s) => s.activeConn);
  useEffect(() => { if (activeConn && F.re.test(activeConn)) setSec('conn'); }, [activeConn, F.re]);
  const ctx: Ctx = { p, d, sub, setSub, scope, sel };
  const enabled = F.enabled ? F.enabled(ctx) : true;
  const types = F.types?.(ctx);

  const own = useMemo(() => d.members.filter((m) => match(m)), [d, match]);
  const scopeList = custom ?? [
    { key: 'one', title: 'האלמנט שנבחר', ids: sel ? [sel.id] : [], disabled: sel ? undefined : 'בחרו אלמנט של הרכיב במודל' },
    { key: 'all', title: 'כל המודל', ids: own.filter((m) => !isPart(m)).map((m) => m.id) },
  ];
  const cur = scopeList.find((s) => s.key === scope) ?? scopeList[scopeList.length - 1];
  const scopeIds = useMemo(() => {
    const S = new Set(cur?.ids ?? []);
    const parts = d.connections.filter((c) => c.members.some((x) => S.has(x))).flatMap((c) => c.parts);
    return [...S, ...parts];
  }, [d, cur?.key, cur?.ids.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { store.set({ scopeHi: enabled && scopeIds.length ? scopeIds : null }); }, [scopeIds, enabled]);
  useEffect(() => () => { store.set({ scopeHi: null }); }, []);

  const set3d = useMemo(() => familySet(p, d, match, { memberId: sel?.id ?? (custom ? cur?.ids[0] : undefined), wide: wide || fam === 'frame', key: `${fam}|${scope}|${sub}` }), [p, d, match, sel?.id, wide, fam, scope, sub, cur?.ids[0]]); // eslint-disable-line react-hooks/exhaustive-deps
  const conns = useMemo(() => d.connections.filter((c) => F.re.test(c.id) || c.members.some((x) => { const m = d.byId.get(x); return !!m && match(m) && !isPart(m); })).filter((c) => !cur || scope === 'all' || !custom && scope === 'one' ? (scope !== 'one' || c.members.includes(sel?.id ?? '')) : c.members.some((x) => cur.ids.includes(x))), [d, F.re, match, scope, sel?.id, cur?.ids.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useMemo(() => {
    const g = new Map<string, typeof conns>();
    for (const c of conns) { const k = c.label.replace(/(ציר|מפתח|מסגרת|קו|פטה)\s+[^\s—–-]+/g, '').replace(/\bF\d+\b/g, '').replace(/\s+/g, ' ').trim() || c.label; (g.get(k) ?? g.set(k, []).get(k)!).push(c); }
    return [...g.entries()].slice(0, 8);
  }, [conns]);
  const [cg, setCg] = useState(0);
  const issues = useMemo<ValidationIssue[]>(() => d.issues.filter((i) => F.re.test(i.elementId ?? '') || (F.codes ?? []).includes(i.code)), [d, F]);
  const clip = F.copy ? wizardClip<unknown>(fam) : undefined;
  const subs = { loc: `${own.filter((m) => !isPart(m)).length} אלמנטים`, ...(F.subs?.(ctx) ?? {}) };

  return (
    <div className="ks" data-testid={`fam-${fam}`}>
      {types && <WizardTypeSelector label={types.label} value={types.value} onPick={types.pick}
        types={types.items} extra={types.extra} />}
      {!enabled && (F.off?.(ctx) ?? <div className="ks-empty">הרכיב לא פעיל.</div>)}
      {enabled && <>
        <WizardScopeSelector<string> value={cur?.key ?? 'all'} onPick={setScope}
          scopes={scopeList.map((s) => ({ key: s.key, title: s.title, count: s.ids.length || undefined, disabled: s.disabled, testId: s.key === 'one' ? 'pscope-one' : s.key === 'all' ? 'pscope-asmall' : `pscope-${s.key}` }))}
          note={<>{scopeIds.length} אלמנטים וחלקים — מודגשים בכתום{F.copy && <> · <button className="wz-link" onClick={() => wizardCopy(fam, F.copy!.get(ctx))} data-testid="wz-copy">העתקת הגדרות</button>{clip != null && <> · <button className="wz-link" onClick={() => F.copy!.put(ctx, clip)} data-testid="wz-paste">הדבקה {F.copy.label?.(ctx) ?? ''}</button></>}</>}</>} />
        {sel && <div className="ks-sel" data-testid="fam-sel">נבחר: {sel.label}</div>}
        <WizardNavigation value={sec} onPick={setSec} subs={subs} />
        <WizardValidation issues={issues} />

        {sec === 'loc' && <WizardSection id="loc">
          {F.loc(ctx)}
          {F.table && <details className="ks-more"><summary>טבלת מופעים</summary><ComponentTable match={F.table} testId={`ctab-${fam}`} /></details>}
        </WizardSection>}

        {sec === 'geo' && <WizardSection id="geo" className="ks-geo">
          <LiveView3D set={set3d} rev={d} height={300} modes={fam === 'frame' ? undefined : <div className="seg-mini"><button className={wide ? '' : 'on'} onClick={() => setWide(false)} data-testid="live3d-near">קרוב</button><button className={wide ? 'on' : ''} onClick={() => setWide(true)} data-testid="live3d-far">כל הרכיב</button></div>} />
          <div className="ks-dims">{F.geo(ctx)}</div>
        </WizardSection>}

        {sec === 'conn' && <WizardSection id="conn">
          {scope === 'one' && sel && !custom && <div className="ks-elend">
            <div className="field prof"><label>חתך האלמנט שנבחר</label><ProfilePicker testId="prop-profile" value={p.memberOverrides[sel.id]?.profile ?? sel.profile} families={['L', 'RHS', 'SHS', 'CHS', 'UPN', 'IPE', 'HEA', 'C', 'Z']} onCommit={(v) => store.exec(setMemberProps([sel.id], { profile: v }))} /></div>
            <div className="ks-note">קצוות האלמנט — פרט מוכן לכל קצה, או פרט חדש בסטודיו:</div><EndCards m={sel} /><DetailEnds m={sel} />
          </div>}
          {F.conn(ctx)}
          {groups.length > 0 && <>
            <div className="wz-sub">מחברים ברכיב</div>
            <div className="ks-ends" role="tablist" aria-label="מחברים">
              {groups.map(([label, cs], i) => (
                <button key={label} role="tab" aria-selected={cg === i} className={`ks-end${cg === i ? ' on' : ''}`} onClick={() => setCg(i)} data-testid={`ks-cg-${i}`}><b>מחבר {i + 1} — {label}</b><small>{cs.length} חיבורים</small></button>
              ))}
            </div>
            {groups[Math.min(cg, groups.length - 1)] && <div className="ks-acts">
              <button className="btn" onClick={() => store.set({ connWizard: groups[Math.min(cg, groups.length - 1)][1][0].id })} data-testid="ks-wizard">אשף המחברים</button>
              <button className="btn" onClick={() => openConnStudio(groups[Math.min(cg, groups.length - 1)][1][0], d)} data-testid="ks-studio">סטודיו ✎</button>
            </div>}
          </>}
        </WizardSection>}
      </>}
    </div>
  );
}
