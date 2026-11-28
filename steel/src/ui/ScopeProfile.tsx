import { resetOverrides, setMemberProps } from '../commands/commands';
import { MATERIALS } from '../profiles/materials';
import { store, useStore } from '../store';
import type { Member } from '../model/types';
import { ProfilePicker } from './fields';
import { FAMS, profileRoute } from './PropertiesPanel';

const PLATE = (m: Member) => m.kind === 'plate' || m.kind === 'cleat' || m.kind === 'bolt' || m.kind === 'anchor';

/** קבוצת "הציר (שורה)": אותו תפקיד (מזהה בלי מספרי מפתח/מסגרת) ואותו ציר — לפי המזהה (BR.T3.L, BR.W1.L.1, BB.2.L.K1, LT.1.L.D2, HB.R1.L.S2) */
export function lineGroup(sel: Member, all: Member[]): Member[] {
  const key = (id: string) => { const t = id.split('.'); return [t[0], (t[1] ?? '').replace(/\d+/g, '#'), t[2] ?? '', t.slice(3).join('.').replace(/\d+/g, '#')].join('|'); };
  const pre = (id: string) => { const t = id.split('.'); return `${t[0]}|${(t[1] ?? '').replace(/\d+/g, '#')}|${t[2] ?? ''}`; };
  return all.filter((x) => !PLATE(x) && x.kind === sel.kind && pre(x.id) === pre(sel.id) && key(x.id).split('|')[3] === key(sel.id).split('|')[3]);
}

/** כל המודל, אותו תפקיד: אותו מזהה בלי מספרי מפתח/מסגרת ובלי הציר */
export function roleGroup(sel: Member, all: Member[]): Member[] {
  const key = (id: string) => { const t = id.split('.'); return [t[0], (t[1] ?? '').replace(/\d+/g, '#'), t.slice(3).join('.').replace(/\d+/g, '#')].join('|'); };
  return all.filter((x) => !PLATE(x) && x.kind === sel.kind && key(x.id) === key(sel.id));
}

/**
 * חתך וחומר בהיקף שנבחר בחלון הרכיב: האלמנט הזה / הציר (שורה) / כל המודל — אותו מנגנון בכל המשפחות.
 * "כל המודל" משנה את ההגדרה (ומנקה חריגות אישיות); "אלמנט" ו"ציר" — חתך אישי לכל אלמנט (הבונים קוראים אותו, והחיבור נבנה לפיו).
 */
export function ScopeProfile({ ids, scopeKey, selId }: { ids: string[]; scopeKey: string; selId?: string }) {
  const d = useStore((s) => s.derived), p = useStore((s) => s.project);
  const raw = ids.map((i) => d.byId.get(i)).filter((m): m is Member => !!m && !PLATE(m));
  if (!raw.length) return null;
  // בהיקף רב-אלמנטי: רק אלמנטים באותו תפקיד כמו הנבחר (חתך אלכסון לא משנה חגורה)
  const ref = raw.find((m) => m.id === selId) ?? raw[0];
  const ms = scopeKey === 'one' ? raw : roleGroup(ref, raw);
  const m0 = ms[0] ?? ref, route = profileRoute(m0, p);
  const all = scopeKey === 'all';
  if (!ms.length) return null;
  const profs = [...new Set(ms.map((m) => m.profile))], mats = [...new Set(ms.map((m) => m.material))];
  const canEdit = !route || route.one || !!route.single || all;
  const apply = (v: string) => {
    if (route && (all || route.single)) {
      store.exec(route.all(v));
      const pre = m0.id.split('.')[0] + '.', ov = Object.keys(p.memberOverrides).filter((x) => x.startsWith(pre) && p.memberOverrides[x]?.profile);
      if (ov.length) store.exec(resetOverrides(ov));
      return;
    }
    store.exec(setMemberProps(ms.map((m) => m.id), { profile: v }));
  };
  const what = scopeKey === 'one' ? 'האלמנט הזה' : all ? 'כל המודל' : 'הציר (השורה)';
  return (
    <div className="scope-profile" data-testid="scope-profile">
      <div className="scope-bar-h">חתך וחומר — {what} ({ms.length})</div>
      {canEdit
        ? <div className="field prof"><label>חתך</label><ProfilePicker testId="sp-profile" value={profs.length === 1 ? profs[0] : ''} placeholder={profs.length > 1 ? 'משתנה' : undefined} varies={profs.length > 1} families={FAMS[m0.kind]} onCommit={apply} /></div>
        : <div className="hint" data-testid="sp-blocked">החתך נקבע לכל {route!.what} — לשינוי בחרו "כל המודל".</div>}
      {route && all && <div className="hint" style={{ marginTop: 0 }}>חל על כל {route.what} — פחי החיבור מתעדכנים לפי החתך.</div>}
      {route?.single && !all && <div className="hint" style={{ marginTop: 0 }}>אלמנט יחיד בהגדרה — שינוי החתך חל על ההגדרה כולה.</div>}
      <div className="field"><label>חומר</label>
        <select className={`inp${mats.length > 1 ? ' varies' : ''}`} data-testid="sp-material" value={mats.length === 1 ? mats[0] : ''} onChange={(e) => e.target.value && store.exec(setMemberProps(ms.map((m) => m.id), { material: e.target.value }))}>
          {mats.length > 1 && <option value="">משתנה</option>}{MATERIALS.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select></div>
    </div>
  );
}
