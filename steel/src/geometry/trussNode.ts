import type { Project, TrussSpec } from '../model/types';
import { cheekMins } from './truss';

/**
 * צמתי מסבך — מצב וערכים כפי שהמודל מחזיק אותם (1.112): סוג הצומת (`direct` = מרותך ישיר, `cheek` = עם לחיות צומת) הוא **לכל מסבך**
 * (`TrussSpec.nodeCheeks`), לא לצומת בודד. פונקציות טהורות; אין גיאומטריה חדשה ואין בדיקת חוזק.
 */
export type TrussOwner = { owner: 'roof'; spec: TrussSpec; count: number } | { owner: 'transfer'; transferId: string; spec: TrussSpec; count: 1 };
export type NodeCheeks = NonNullable<TrussSpec['nodeCheeks']>;
export type NodeType = 'direct' | 'cheek';

/** מזהה חיבור מסבך (`C.TR.*` גג / `C.TBT.<קורה>` נושא) ← המסבך שמחזיק את ההגדרה */
export function trussOwner(p: Project, connId: string): TrussOwner | null {
  if (connId.startsWith('C.TR.') && p.building.roofTruss?.enabled) {
    const frames = p.building.roofTruss.frames;
    return { owner: 'roof', spec: p.building.roofTruss.spec, count: frames === 'all' ? p.building.frames.length : frames.length };
  }
  if (connId.startsWith('C.TBT.')) {
    const t = (p.building.transfers ?? []).find((x) => x.id === connId.slice(6));
    if (t?.kind === 'truss' && t.truss) return { owner: 'transfer', transferId: t.id, spec: t.truss, count: 1 };
  }
  return null;
}

export const nodeTypeOf = (spec: TrussSpec): NodeType => (spec.nodeCheeks?.enabled ? 'cheek' : 'direct');

/** תיאור מצב הצמתים לתצוגה */
export function nodeStateText(spec: TrussSpec): string {
  const nc = spec.nodeCheeks;
  const mn = cheekMins(nc);
  return nc?.enabled ? `לחיות צומת — עובי ${Math.max(mn.t, nc.t)} מ"מ, גובה ${Math.max(mn.h, nc.h)} מ"מ` : 'צומת מרותך ישיר (ללא לחיות)';
}

/**
 * ערכי הלחיות אחרי החלה של patch (ברירת מחדל 8/100 כשאין עדיין). ערך לא מספרי (NaN/∞) אינו נשמר.
 * המינימומים (`minT`/`minH`) ניתנים לשינוי: ערך חוקי = מספר ≥ 1 מ"מ, אחרת אינו נשמר; העובי והגובה מוגבלים למינימום הנוכחי,
 * והעלאת מינימום מעל הערך הקיים מעלה גם אותו.
 */
export function applyCheeks(spec: TrussSpec, patch: Partial<NodeCheeks>): TrussSpec {
  const cur = spec.nodeCheeks ?? { enabled: false, t: 8, h: 100 };
  const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const next: NodeCheeks = {
    ...cur,
    ...(typeof patch.enabled === 'boolean' ? { enabled: patch.enabled } : {}),
    ...(fin(patch.t) ? { t: patch.t } : {}), ...(fin(patch.h) ? { h: patch.h } : {}),
    ...(fin(patch.minT) && patch.minT >= 1 ? { minT: patch.minT } : {}), ...(fin(patch.minH) && patch.minH >= 1 ? { minH: patch.minH } : {}),
  };
  const mn = cheekMins(next);
  next.t = Math.max(mn.t, next.t); next.h = Math.max(mn.h, next.h);
  return { ...spec, nodeCheeks: next };
}

/** חתימה יציבה של מצב הצמתים (לבדיקות שקילות) */
export const nodeSignature = (spec: TrussSpec): string => { const nc = spec.nodeCheeks; const mn = cheekMins(nc); return nc?.enabled ? `cheek:${Math.max(mn.t, nc.t)}x${Math.max(mn.h, nc.h)}` : 'direct'; };

/** הפרויקט אחרי עדכון לחיות הצומת של המסבך שחיבורו `connId`; null — אין מסבך כזה */
export function withNodeCheeks(p: Project, connId: string, patch: Partial<NodeCheeks>): Project | null {
  const o = trussOwner(p, connId);
  if (!o) return null;
  const n = structuredClone(p);
  if (o.owner === 'roof') n.building.roofTruss = { ...n.building.roofTruss!, spec: applyCheeks(o.spec, patch) };
  else n.building.transfers = n.building.transfers!.map((t) => (t.id === o.transferId ? { ...t, truss: applyCheeks(o.spec, patch) } : t));
  return n;
}
