import { useState } from 'react';
import { tryProfile } from '../profiles/library';
import type { CustomDetail } from '../model/types';
import { varLabel } from './FormulaBuilder';

/**
 * כרטיסי חתך בסטודיו הפרטים: שרטוט החתך של האלמנט והמארח עם **שם המשתנה והערך** על כל מידה (mb, mh, mt, mtf, hb, hh, htf, htw) —
 * נראה תמיד, בלי תלות בזווית המצלמה (פתקיות הדפנות מוצגות רק לדופן שפונה למצלמה). לחיצה על תגית = אותה פעולה כמו תגית במודל (הוספה לנוסחה בבונה).
 * מקרא מתחת לכל כרטיס: שם המשתנה, משמעותו בעברית והערך.
 */
interface Lab { k: string; x: number; y: number; px: number; py: number }
const W = 170, H = 150, PAD = 34;

function Card({ title, profile, vars, values, det, onTag }: { title: string; profile: string; vars: { vert: string; horiz: string; wall?: string; flange?: string }; values: Record<string, number>; det: CustomDetail; onTag: (k: string) => void }) {
  const p = tryProfile(profile);
  if (!p) return null;
  const o = p.outline.outer;
  const us = o.map((q) => q.u), vs = o.map((q) => q.v);
  const u0 = Math.min(...us), u1 = Math.max(...us), v0 = Math.min(...vs), v1 = Math.max(...vs);
  const sc = Math.min((W - 2 * PAD) / (u1 - u0 || 1), (H - 2 * PAD) / (v1 - v0 || 1));
  const X = (u: number) => PAD + (u - u0) * sc, Y = (v: number) => H - PAD - (v - v0) * sc;
  const path = (pts: { u: number; v: number }[]) => 'M' + pts.map((q) => `${X(q.u).toFixed(1)},${Y(q.v).toFixed(1)}`).join('L') + 'Z';
  const d = [path(o), ...p.outline.holes.map(path)].join('');
  const fam = p.family;
  const tf = p.dims.tf ?? p.dims.t ?? 0, tw = p.dims.tw ?? p.dims.t ?? 0;
  const hollow = fam === 'RHS' || fam === 'SHS' || fam === 'CHS';
  const labs: Lab[] = [];
  // רוחב (מלמטה) וגובה (מימין)
  labs.push({ k: vars.horiz, x: X((u0 + u1) / 2), y: H - 8, px: X((u0 + u1) / 2), py: Y(v0) + 10 });
  labs.push({ k: vars.vert, x: W - 30, y: H / 2, px: X(u1) + 10, py: Y((v0 + v1) / 2) });
  // עובי: חלול — דופן עליונה; אחרת אגף עליון + ווב
  if (hollow && vars.wall) labs.push({ k: vars.wall, x: X((u0 + u1) / 2), y: 14, px: X((u0 + u1) / 2), py: Y(v1 - tf / 2) });
  else if (!hollow) {
    if (vars.flange) labs.push({ k: vars.flange, x: X(u0) + 6, y: 14, px: X(u0 + (u1 - u0) * 0.2), py: Y(v1 - tf / 2) });
    if (vars.wall) labs.push({ k: vars.wall, x: X((u0 + u1) / 2) - 8, y: H / 2 + 8, px: X((u0 + u1) / 2), py: Y((v0 + v1) / 2) });
  }
  void tw;
  return (
    <div className="ssc-card" data-testid={`sec-card-${title === 'האלמנט' ? 'main' : 'host'}`}>
      <h5>{title} <span className="mono">{profile}</span></h5>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`חתך ${profile}`}>
        <path d={d} fill="var(--sec-fill, #cfd6dd)" fillRule="evenodd" stroke="var(--ink, #222)" strokeWidth="1" />
        {labs.map((l) => (
          <g key={l.k} className="ssc-lab" onClick={() => onTag(l.k)} data-testid={`sec-tag-${title === 'האלמנט' ? 'm' : 'h'}-${l.k}`} style={{ cursor: 'pointer' }}>
            <line x1={l.x} y1={l.y - 4} x2={l.px} y2={l.py} />
            <circle cx={l.px} cy={l.py} r="2.4" />
            <rect x={l.x - 30} y={l.y - 10} width="60" height="15" rx="3" />
            <text x={l.x} y={l.y + 1.5} textAnchor="middle">{l.k} {Math.round((values[l.k] ?? 0) * 10) / 10}</text>
          </g>
        ))}
      </svg>
      <ul className="ssc-legend">
        {labs.map((l) => <li key={l.k}><code>{l.k}</code> {varLabel(l.k, det)} <b>{Math.round((values[l.k] ?? 0) * 10) / 10}</b></li>)}
      </ul>
    </div>
  );
}

export function SectionCards({ mainProfile, hostProfile, values, det, onTag }: { mainProfile: string; hostProfile?: string; values: Record<string, number>; det: CustomDetail; onTag: (k: string) => void }) {
  const [open, setOpen] = useState(true);
  const mp = tryProfile(mainProfile);
  // mh/mb תלויי הנחה: האם הגובה במישור הוא h או b של הפרופיל
  const swapped = !!mp && Math.abs((values.mh ?? 0) - mp.props.h) > 0.5 && Math.abs((values.mh ?? 0) - mp.props.b) < 0.5;
  const mainVars = { vert: swapped ? 'mb' : 'mh', horiz: swapped ? 'mh' : 'mb', wall: 'mt', flange: 'mtf' };
  const hostVars = { vert: 'hh', horiz: 'hb', wall: 'htw', flange: 'htf' };
  return (
    <div className="ssc-cards" data-testid="sec-cards">
      <button className="btn small" onClick={() => setOpen(!open)} data-testid="sec-toggle" aria-expanded={open}>חתכים והמשתנים שלהם {open ? '▾' : '▸'}</button>
      {open && <div className="ssc-row">
        <Card title="האלמנט" profile={mainProfile} vars={mainVars} values={values} det={det} onTag={onTag} />
        {hostProfile && <Card title="המארח" profile={hostProfile} vars={hostVars} values={values} det={det} onTag={onTag} />}
      </div>}
    </div>
  );
}
