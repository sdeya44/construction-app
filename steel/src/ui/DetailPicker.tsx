import type { ReactNode } from 'react';

/**
 * בורר פרט אחיד (1.41): אריחים עם שרטוט, סינון לפי משפחת החתך, והיקף (הכל / חריג). אותו רכיב בתפריט הצד,
 * בחלון האלמנט ובעורך החיבור — כמו כרטיסי הדילול (A1–A5).
 */
export interface DetailOption<K extends string> { key: K; title: string; desc: string; pic: ReactNode; /** לא מתאים לחתך הנוכחי — מוסתר */ hidden?: boolean }

export function DetailTiles<K extends string>({ label, options, value, onChange, testId, note }: {
  label: string; options: DetailOption<K>[]; value: K; onChange: (k: K) => void; testId: string; note?: string;
}) {
  const vis = options.filter((o) => !o.hidden);
  const cur = vis.find((o) => o.key === value) ?? vis[0];
  return (
    <div className="det-pick" data-testid={testId}>
      <div className="tb-lbl">{label}</div>
      <div className="tile-row" role="radiogroup" aria-label={label}>
        {vis.map((o) => (
          <button key={o.key} role="radio" aria-checked={cur?.key === o.key} className={`pic-tile${cur?.key === o.key ? ' on' : ''}`} data-testid={`${testId}-${o.key}`} title={o.desc} onClick={() => onChange(o.key)}>
            {o.pic}<span>{o.title}</span>
          </button>
        ))}
      </div>
      {cur && <div className="hint">{cur.desc}{note ? ` ${note}` : ''}</div>}
    </div>
  );
}

/** היקף השינוי: כל החיבורים מהסוג / חריג למיקום הזה */
export function ScopeToggle({ value, onChange, oneLabel, testId }: { value: 'all' | 'one'; onChange: (v: 'all' | 'one') => void; oneLabel: string; testId: string }) {
  return (
    <div className="seg scope-seg" role="radiogroup" aria-label="היקף השינוי" data-testid={testId}>
      <button className={`tbtn${value === 'all' ? ' on' : ''}`} data-testid={`${testId}-all`} onClick={() => onChange('all')}>כל החיבורים מהסוג</button>
      <button className={`tbtn${value === 'one' ? ' on' : ''}`} data-testid={`${testId}-one`} onClick={() => onChange('one')}>{oneLabel}</button>
    </div>
  );
}

// ---- שרטוטים קטנים (60×44) — סכמטיים, צבעי המערכת
const H = '#8a948f', S = '#3a4a42', P = '#c2721c', B = '#2f6fb0';
const Svg = ({ children }: { children: ReactNode }) => <svg viewBox="0 0 60 44" width={88} height={64} aria-hidden="true">{children}</svg>;
const bolt = (x: number, y: number) => <circle cx={x} cy={y} r={2.2} fill={B} />;

/** מארח (אגף/ווב) משמאל, אלמנט אלכסוני */
export const PIC = {
  fin: <Svg><rect x={4} y={4} width={6} height={36} fill={H} /><rect x={10} y={17} width={18} height={10} fill={P} /><rect x={22} y={14} width={34} height={16} fill="none" stroke={S} strokeWidth={2} /><rect x={20} y={19} width={18} height={6} fill="#e8b47a" />{bolt(18, 22)}{bolt(25, 22)}</Svg>,
  angle: <Svg><rect x={4} y={4} width={6} height={36} fill={H} /><rect x={10} y={15} width={20} height={14} fill={P} /><path d="M18 18 H56 M18 18 V24" stroke={S} strokeWidth={3} fill="none" />{bolt(22, 22)}</Svg>,
  flange: <Svg><rect x={4} y={4} width={6} height={36} fill={H} /><rect x={10} y={8} width={4} height={28} fill={P} /><rect x={14} y={15} width={42} height={14} fill="none" stroke={S} strokeWidth={2} />{bolt(12, 11)}{bolt(12, 33)}</Svg>,
  endplate: <Svg><rect x={26} y={4} width={4} height={36} fill={H} /><rect x={22} y={10} width={4} height={24} fill={P} /><rect x={30} y={10} width={4} height={24} fill={P} /><rect x={4} y={15} width={18} height={14} fill="none" stroke={S} strokeWidth={2} /><rect x={34} y={15} width={22} height={14} fill="none" stroke={S} strokeWidth={2} />{bolt(28, 12)}{bolt(28, 32)}</Svg>,
  weld: <Svg><rect x={26} y={4} width={4} height={36} fill={H} /><rect x={6} y={15} width={20} height={14} fill="none" stroke={S} strokeWidth={2} /><rect x={30} y={15} width={24} height={14} fill="none" stroke={S} strokeWidth={2} /><path d="M24 13 L26 15 M24 31 L26 29 M32 13 L30 15 M32 31 L30 29" stroke={P} strokeWidth={2.5} /></Svg>,
  baseEmbedded: <Svg><rect x={24} y={2} width={12} height={22} fill="none" stroke={S} strokeWidth={2} /><rect x={12} y={24} width={36} height={4} fill={P} /><rect x={2} y={28} width={56} height={14} fill="#d9d4c7" /><path d="M18 28 v10 M42 28 v10" stroke={B} strokeWidth={2} /></Svg>,
  baseBolted: <Svg><rect x={24} y={2} width={12} height={22} fill="none" stroke={S} strokeWidth={2} /><rect x={12} y={24} width={36} height={4} fill={P} /><rect x={2} y={28} width={56} height={14} fill="#d9d4c7" /><path d="M16 20 v20 M44 20 v20" stroke={B} strokeWidth={2.5} />{bolt(16, 22)}{bolt(44, 22)}</Svg>,
  eaveSplit: <Svg><rect x={4} y={14} width={12} height={28} fill={H} /><rect x={2} y={10} width={16} height={4} fill={P} /><rect x={2} y={6} width={16} height={4} fill={P} /><path d="M18 4 L58 0" stroke={S} strokeWidth={6} />{bolt(4, 10)}{bolt(16, 10)}</Svg>,
  eaveSingle: <Svg><rect x={4} y={14} width={12} height={28} fill={H} /><rect x={2} y={10} width={16} height={4} fill={P} /><path d="M2 6 L58 2" stroke={S} strokeWidth={6} />{bolt(4, 8)}{bolt(16, 8)}</Svg>,
  ridge: <Svg><path d="M4 30 L28 14 M32 14 L56 30" stroke={S} strokeWidth={6} /><rect x={27} y={8} width={3} height={22} fill={P} /><rect x={30} y={8} width={3} height={22} fill={P} />{bolt(30, 12)}{bolt(30, 26)}</Svg>,
  rod: <Svg><rect x={26} y={4} width={4} height={36} fill={H} /><path d="M6 30 L26 22" stroke={S} strokeWidth={4} /><path d="M24 23 L40 17" stroke={B} strokeWidth={2.5} /><rect x={38} y={13} width={6} height={8} fill={P} /></Svg>,
  finH: <Svg><rect x={4} y={4} width={6} height={36} fill={H} /><rect x={10} y={22} width={22} height={4} fill={P} /><rect x={20} y={16} width={36} height={6} fill="none" stroke={S} strokeWidth={2} />{bolt(16, 24)}{bolt(26, 24)}</Svg>,
  cleatRun: <Svg><rect x={2} y={32} width={56} height={6} fill={H} /><path d="M20 32 V16 H34" stroke={P} strokeWidth={4} fill="none" /><rect x={24} y={6} width={4} height={26} fill="none" stroke={S} strokeWidth={2} />{bolt(22, 22)}</Svg>,
  cleatStand: <Svg><rect x={2} y={32} width={56} height={6} fill={H} /><path d="M20 32 V12 M20 32 H30" stroke={P} strokeWidth={4} fill="none" /><rect x={24} y={6} width={4} height={26} fill="none" stroke={S} strokeWidth={2} />{bolt(22, 16)}{bolt(22, 26)}</Svg>,
  cleatPlate: <Svg><rect x={2} y={32} width={56} height={6} fill={H} /><rect x={20} y={10} width={4} height={22} fill={P} /><path d="M24 32 L36 32 L24 16 Z" fill={P} opacity={0.7} />{bolt(22, 14)}{bolt(22, 24)}</Svg>,
  splicePlate: <Svg><rect x={2} y={14} width={26} height={16} fill="none" stroke={S} strokeWidth={2} /><rect x={32} y={14} width={26} height={16} fill="none" stroke={S} strokeWidth={2} /><rect x={18} y={17} width={24} height={10} fill={P} />{bolt(22, 22)}{bolt(38, 22)}</Svg>,
  basePile: <Svg><rect x={24} y={2} width={12} height={34} fill="none" stroke={S} strokeWidth={2} /><rect x={16} y={20} width={28} height={24} fill="#d9d4c7" /><path d="M2 20 H58" stroke={H} strokeWidth={1} strokeDasharray="3 2" /></Svg>,
};

/** סוגי מכלול קשיחות קיר (1.51) — אריחים גדולים עם ציור המכלול בין שני עמודים */
const W = ({ children }: { children: ReactNode }) => <svg viewBox="0 0 80 50" width={92} height={58} aria-hidden="true"><path d="M8 46 V4 M72 46 V4" stroke={H} strokeWidth={4} /><path d="M4 46 H76" stroke="#c9cfca" strokeWidth={1.5} />{children}</svg>;
export const WALL_PIC = {
  x: <W><path d="M10 8 L70 44 M70 8 L10 44" stroke={S} strokeWidth={2.4} /><rect x={36} y={22} width={8} height={8} fill={P} /></W>,
  portal: <W><path d="M10 10 H70" stroke={S} strokeWidth={4.5} /><path d="M10 24 L22 10 M70 24 L58 10" stroke={S} strokeWidth={2.4} /></W>,
  truss: <W><path d="M10 9 H70 M10 21 H70" stroke={S} strokeWidth={2.6} /><path d="M10 21 L20 9 L30 21 L40 9 L50 21 L60 9 L70 21" stroke={S} strokeWidth={1.8} fill="none" /></W>,
  none: <W><path d="M30 26 H50" stroke="#b9c0bb" strokeWidth={2} strokeDasharray="4 3" /></W>,
};

/** סוג קושרות גג — מבט על פנל בין שתי קורות */
const RF = ({ children }: { children: ReactNode }) => <svg viewBox="0 0 80 50" width={92} height={58} aria-hidden="true"><path d="M6 6 H74 M6 44 H74" stroke={H} strokeWidth={4} />{children}</svg>;
export const ROOF_PIC = {
  x: <RF><path d="M10 8 L70 42 M70 8 L10 42" stroke={B} strokeWidth={2.4} /></RF>,
  rhs: <RF><path d="M10 8 V42 M40 8 V42 M70 8 V42" stroke={S} strokeWidth={2.4} /><path d="M10 8 L40 42 M40 8 L70 42" stroke={S} strokeWidth={1.8} /></RF>,
};
