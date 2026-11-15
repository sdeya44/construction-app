import type { ReactElement } from 'react';

/**
 * תמונות קטנות לתפריטים (בקשת משתמש: "תמונה ליד כל תפריט כדי לדעת למה זה שייך").
 * כל תמונה היא מסגרת סככה מוקטנת שבה מודגש (בצבע) החלק שהתפריט עוסק בו.
 */
const B = 'pb', A = 'pa'; // קו בסיס / הדגשה
const frame = (cls = B) => <path className={cls} d="M5 22V11L16 5l11 6v11" />;
const L = (d: string, cls = A) => <path className={cls} d={d} />;

const PICS: Record<string, ReactElement> = {
  project: <>{L('M9 3h10l4 4v15H9z', B)}{L('M12 11h8M12 15h8M12 19h5')}</>,
  geometry: <>{frame(A)}{L('M5 23.5h22', B)}{L('M3 11v11', B)}</>,
  profiles: <>{L('M9 4h14M9 20h14M16 4v16')}</>,
  frames: <>{L('M3 21V12l7-4 7 4v9', B)}{L('M9 19v-8l7-4 7 4v8', B)}{L('M15 17V10l7-4 7 4v7')}</>,
  purlins: <>{frame()}{L('M8.5 8.5l.01 0M12 6.6l.01 0M20 6.6l.01 0M23.5 8.5l.01 0', 'pd')}</>,
  slopeL: <>{frame()}{L('M5 11L16 5')}</>,
  slopeR: <>{frame()}{L('M16 5l11 6')}</>,
  slope: <>{frame()}{L('M5 11L16 5l11 6')}</>,
  splice: <>{L('M2 12h11M19 12h11', B)}{L('M14 7v10M18 7v10')}{L('M13 12h6')}</>,
  knee: <>{frame()}{L('M5 16l5-7.7M27 16l-5-7.7')}</>,
  ridge: <>{frame()}{L('M13 6.5h6v5h-6z')}</>,
  roofX: <>{L('M4 6h24v12H4z', B)}{L('M4 6l24 12M28 6L4 18')}</>,
  walls: <>{L('M5 22V5M27 22V5', B)}{L('M5 8h22M5 13l4-5M27 13l-4-5')}</>,
  ties: <>{L('M4 6h24M4 10h24M4 14h24M4 18h24', B)}{L('M16 4v16')}</>,
  // אלמנטים
  column: <>{frame()}{L('M5 22V11M27 22V11')}</>,
  rafter: <>{frame()}{L('M5 11L16 5l11 6')}</>,
  purlin: <>{L('M10 6h12M10 6v12h12M22 6v3M22 18v-3')}</>,
  brace: <>{L('M5 20L27 4', A)}{L('M4 4h24v16H4z', B)}</>,
  cleat: <>{L('M11 4v15h12')}</>,
  plate: <>{L('M8 7h16v10H8z')}{L('M12 12l.01 0M20 12l.01 0', 'pd')}</>,
  anchor: <>{L('M10 6h12', B)}{L('M13 6v14M19 6v14')}</>,
  beam: <>{L('M5 22V5M27 22V5', B)}{L('M5 9h22')}</>,
  bolt: <>{L('M12 5h8v4h-8z')}{L('M16 9v12')}</>,
  // חיבורים
  eave: <>{frame()}{L('M2.5 10.5h5M2.5 12h5')}</>,
  base: <>{frame()}{L('M2 22h6M24 22h6')}</>,
  'purlin-cleat': <>{L('M3 18L29 9', B)}{L('M13 15V8l5 1.8')}</>,
  'purlin-splice': <>{L('M2 12h28', B)}{L('M13 8h6v8h-6z')}</>,
  'brace-end': <>{L('M4 20h24', B)}{L('M10 20l12-12')}{L('M8 20l2-5h6z')}</>,
  'brace-cross': <>{L('M5 20L27 4M5 4l22 16', B)}{L('M14 12a2 2 0 1 0 4 0a2 2 0 1 0-4 0')}</>,
  'rafter-side': <>{L('M16 22V3', B)}{L('M4 12h12')}{L('M15 9v6')}</>,
  'ridge-tie': <>{frame()}{L('M10 13h12')}</>,
  'beam-splice': <>{L('M2 12h28', B)}{L('M15 6v12M17 6v12')}</>,
  // בדיקות
  error: <>{L('M10 6l12 12M22 6L10 18', 'pe')}</>,
  warning: <>{L('M16 4l10 16H6z', 'pw')}{L('M16 10v5M16 17.5v.5', 'pw')}</>,
  info: <>{L('M16 8v.5M16 11v7', B)}</>,
  elements: <>{frame()}{L('M10 22V14h12v8', A)}</>,
  conns: <>{frame()}{L('M3 9.5h4v3H3zM14 3.5h4v3h-4zM25 9.5h4v3h-4z')}</>,
  issues: <>{L('M16 4l10 16H6z', 'pw')}</>,
  brace0: <>{frame()}{L('M5 16l5-7.7M27 16l-5-7.7')}{L('M9 22l7-10 7 10', 'pa2')}</>,
};

export function MenuPic({ name, size = 28 }: { name: string; size?: number }) {
  const g = PICS[name] ?? PICS.elements;
  return <svg className="mpic" viewBox="0 0 32 24" width={size} height={(size * 24) / 32} aria-hidden="true">{g}</svg>;
}
