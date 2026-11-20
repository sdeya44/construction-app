import { useMemo, useState } from 'react';
import { useStore } from '../../store';
import { connSet } from '../../view/realView';
import { LiveView3D } from '../LiveView3D';

/**
 * 1.60: עורך המחבר — תצוגה תלת-ממדית מוגדלת של המחבר שנבחר (פלטות, ברגים, קצוות האלמנטים),
 * מתחת לשדות החיבור; "הגדלה" מגדילה את התצוגה. אותו מחבר כמו "אשף המחברים" / "סטודיו".
 */
export function ConnView({ connId }: { connId?: string }) {
  const d = useStore((s) => s.derived);
  const [big, setBig] = useState(false);
  const set = useMemo(() => (connId ? connSet(d, connId) : null), [d, connId]);
  if (!connId || !set) return null;
  const c = d.connById.get(connId);
  return (
    <div className={`wz-connview${big ? ' big' : ''}`} data-testid="conn-view">
      <div className="wz-cv-h"><b>המחבר בתלת-ממד</b><small>{c?.label}</small><span className="sp" />
        <button className="btn small" onClick={() => setBig(!big)} data-testid="conn-view-big" aria-pressed={big}>{big ? '⤡ הקטנה' : '⤢ הגדלה'}</button></div>
      <LiveView3D set={set} rev={d} height={big ? 520 : 260} />
    </div>
  );
}
