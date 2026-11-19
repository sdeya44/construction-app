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
const Svg = ({ children }: { children: ReactNode }) => <svg viewBox="0 0 60 44" width={60} height={44} aria-hidden="true">{children}</svg>;
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
  basePile: <Svg><rect x={24} y={2} width={12} height={34} fill="none" stroke={S} strokeWidth={2} /><rect x={16} y={20} width={28} height={24} fill="#d9d4c7" /><path d="M2 20 H58" stroke={H} strokeWidth={1} strokeDasharray="3 2" /></Svg>,
};
