import { useMemo } from 'react';
import { store, useStore } from '../store';
import { useFab } from '../fab/useFab';
import { buildSheet } from '../drawing/views';
import { sheetToSvg } from '../drawing/svg';
import { CONN_TYPE } from './ConnectionEditor';

/**
 * פרט טיפוסי של חיבור (1.52): אותו מחולל של גיליון החיבור בשרטוטים — מידות, פלטות, ברגים וריתוכים,
 * מוקטן בתוך הפאנל ומתעדכן חי עם כל שינוי. "פתח גיליון מלא" — למצב שרטוטים.
 */
export function ConnPreview({ connId, compact }: { connId: string; compact?: boolean }) {
  const p = useStore((s) => s.project), d = useStore((s) => s.derived);
  const { fab, bom } = useFab();
  const c = d.connById.get(connId);
  const svg = useMemo(() => {
    if (!c) return null;
    try { return sheetToSvg(buildSheet({ id: `D-CONNP-${connId}`, type: 'connection', number: 'פרט', title: `פרט ${CONN_TYPE[c.type] ?? ''}`, ref: connId }, p, d, fab, bom)); } catch { return null; }
  }, [p, d, fab, bom, connId, c]);
  if (!c) return null;
  if (!svg) return <div className="hint">אין שרטוט פרט לחיבור הזה.</div>;
  return (
    <div className="conn-prev" data-testid={`conn-prev-${connId}`}>
      <div className={`part-prev${compact ? ' compact' : ''}`} dangerouslySetInnerHTML={{ __html: svg }} />
      <button className="btn small" data-testid="conn-prev-open" onClick={() => { store.set({ drawingFocus: `D-CONN-${c.type}` }); window.dispatchEvent(new CustomEvent('ksp-mode', { detail: 'drawings' })); }}>פתח בשרטוטים ←</button>
    </div>
  );
}
