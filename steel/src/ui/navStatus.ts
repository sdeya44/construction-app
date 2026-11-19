import type { DerivedModel, Project } from '../model/types';
import { resolveBays, wallBays } from '../geometry/bracing';
import { kneeDetail } from '../geometry/knee';
import { tryProfile } from '../profiles/library';
import { settingsOf } from './navIndex';

/**
 * עץ = תמונת מצב (1.44): לכל פריט בעץ — שורת ערך קצרה ("מה יש"), מונה, אזהרות משויכות, והאם הרכיב קיים.
 * רכיב שלא קיים בפרויקט עובר לשורת "+ הוסף רכיב" בתחתית העץ.
 */
export interface NavStat { v?: string; n?: number; warn?: number; err?: number; off?: boolean }

const m = (mm: number) => (mm / 1000).toFixed(2).replace(/\.?0+$/, '');

export function navStatus(p: Project, d: DerivedModel): Record<string, NavStat> {
  const b = p.building, br = b.bracing;
  const lines = [...(d.section?.lines ?? [])].sort((a, c) => a.x - c.x);
  const fr = [...b.frames].sort((a, c) => a.y - c.y);
  const nb = fr.length - 1;
  const out: Record<string, NavStat> = {};
  // אזהרות/שגיאות לפי פריט בעץ (לפי האלמנט שההודעה מצביעה עליו)
  const kindOf = (id: string) => d.byId.get(id)?.kind ?? '';
  const sev: Record<string, { warn: number; err: number }> = {};
  for (const i of d.issues) {
    if (i.severity === 'info' || !i.elementId) continue;
    const k = settingsOf(i.elementId, kindOf(i.elementId))?.[0];
    if (!k) continue;
    const s = (sev[k] ??= { warn: 0, err: 0 });
    if (i.severity === 'error') s.err++; else s.warn++;
  }
  const put = (k: string, s: NavStat) => { out[k] = { ...s, ...(sev[k] ? { warn: sev[k].warn || undefined, err: sev[k].err || undefined } : {}) }; };

  const W = lines.length ? lines[lines.length - 1].x - lines[0].x : b.width;
  const L = fr.length ? fr[fr.length - 1].y - fr[0].y : 0;
  put('s:geometry', { v: `${lines.map((l) => l.label).join(' · ')} · ${m(W)} מ' · ${fr.length} מסגרות · ${m(L)} מ'` });
  put('s:profiles', { v: `${b.columnProfile} · ${b.rafterProfile} · ${b.material}` });
  put('s:project', { v: p.meta.name });
  const pl = b.purlins.left;
  const nP = d.members.filter((x) => x.purlin).length;
  put('r:left', { v: `${pl.profile} @${pl.spacing} · תושבת ${pl.cleat.enabled ? 'כן' : 'ללא'}`, n: nP || undefined });
  put('r:right', { v: `${b.purlins.right.profile} @${b.purlins.right.spacing}` });
  put('r:splices', { n: d.splices.filter((x) => x.memberId.startsWith('PL.')).length || undefined, v: 'פלטה + 4 ברגים' });

  const kb = b.kneeBraces;
  const nKb = d.connections.filter((c) => c.id.startsWith('C.KB.')).length;
  const KDET = { fin: 'פח + לשונית', angle: 'זוויתן מוברג לפח', flange: 'פלטת קצה' } as const;
  put('b:knee', kb?.enabled ? { n: nKb || undefined, v: `${kb.profile} · ${(kb.mode ?? 'angle') === 'angle' ? `${kb.angle ?? 45}°` : `מרחק ${kb.reach}`} · ${KDET[kneeDetail(kb.detail, tryProfile(kb.profile)?.family ?? '')]}` } : { off: true });

  const rs = br.rafterStruts?.rows.length ?? 0;
  put('b:roof', br.roof.enabled
    ? { v: `${(br.roof.type ?? 'x') === 'x' ? br.roof.profile : 'סבכת RHS'} · ${resolveBays(br.roof.bays, nb).length} מפתחים${rs ? ` · ${rs} שורות תמוכה` : ''}` }
    : rs ? { v: `${rs} שורות תמוכה בין הקורות` } : { off: true });

  const TYPE: Record<string, string> = { x: 'X', portal: 'אגד B', truss: 'נעילה' };
  const wl = br.walls.enabled ? wallBays(br, lines.map((l) => l.id)).filter(([, bays]) => bays.length) : [];
  const lab = (id: string) => lines.find((l) => l.id === id)?.label ?? id;
  put('b:walls', br.walls.enabled || br.lineTies?.enabled
    ? { v: [...wl.map(([lid, bays]) => `${lab(lid)}: ${TYPE[br.walls.lineType?.[lid] ?? br.walls.type ?? 'x']} ×${resolveBays(bays, nb).length}`), ...(br.lineTies?.enabled ? ['סיב רציף'] : [])].join(' · ') || 'ללא מפתחים' }
    : { off: true });

  const ties = [br.purlinTies.enabled && 'שורות קשירה', br.sagRods?.enabled && `מוטות Ø${br.sagRods.d}`, br.flyBraces?.enabled && 'תמיכה צידית'].filter(Boolean) as string[];
  put('b:ties', ties.length ? { v: ties.join(' · ') } : { off: true });

  const ridges = d.connections.filter((c) => c.type === 'ridge').length;
  put('b:ridge', ridges ? { v: b.ridgeReinf?.type === 'plate' ? 'פלטות חיזוק' : b.ridgeReinf?.type === 'tie' ? 'פרופיל אופקי' : 'ללא חיזוק', n: ridges } : { off: true });

  const tb = b.transfers ?? [];
  put('b:tb', tb.length ? { n: tb.length, v: [...new Set(tb.map((t) => `ציר ${lab(t.lineId)} · ${t.kind === 'truss' ? 'מסבך' : t.profile}${t.knee?.enabled ? ' · אלכסוני Y' : ''}`))].slice(0, 2).join(' / ') } : { off: true });
  put('b:wing', b.wing?.enabled ? { v: `${b.wing.roofType === 'gable' ? 'דו-שיפועי' : 'חד-שיפועי'} · ${m(b.wing.length)} מ'` } : { off: true });
  put('b:truss', b.roofTruss?.enabled ? { v: `${b.roofTruss.frames === 'all' ? 'כל המסגרות' : `${b.roofTruss.frames.length} מסגרות`}`, n: d.connections.filter((c) => c.type === 'truss' && c.id.startsWith('C.TR.')).length || undefined } : { off: true });

  const cl = b.cladding;
  // קירות וחיפוי — תמיד בעץ (לחיפוי כרטיס הפעלה משלו); מוצג רק ערך
  put('w:roof', { v: cl ? (cl.roof.enabled ? `חיפוי גג${cl.gutter?.enabled ? ' · מזחלות' : ''}` : 'ללא חיפוי גג') : 'ללא חיפוי' });
  put('w:walls', { v: cl ? (cl.walls.enabled ? 'חיפוי קירות ופטות קיר' : 'ללא') : undefined });
  put('w:openings', { n: cl?.openings.length || undefined });
  return out;
}

/** שמות לשורת "+ הוסף רכיב" */
export const ADD_LABEL: Record<string, string> = {
  'b:knee': 'אלכסוני עמוד-קורה', 'b:roof': 'קושרות גג', 'b:walls': 'קשיחות קירות', 'b:ties': 'קשירה / מוטות / תמיכה צידית', 'b:ridge': 'חיזוק רכס',
  'b:tb': 'דילול עמודים', 'b:wing': 'כנף L', 'b:truss': 'מסבכי גג',
};
