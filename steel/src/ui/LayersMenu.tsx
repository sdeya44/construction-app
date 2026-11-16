import { useState } from 'react';
import type { MemberKind } from '../model/types';
import { store, useStore } from '../store';
import { Icon } from './icons';

const LAYERS: { kind: MemberKind; label: string }[] = [
  { kind: 'column', label: 'עמודים' }, { kind: 'rafter', label: 'קורות גג' }, { kind: 'purlin', label: 'פטות' }, { kind: 'girt', label: 'פטות קיר ועמודי רוח' },
  { kind: 'cleat', label: 'תומכי פטות' }, { kind: 'brace', label: 'קושרות ואלכסונים' }, { kind: 'beam', label: 'פרופילי חיזוק' },
  { kind: 'plate', label: 'פלטות ופחים' }, { kind: 'bolt', label: 'ברגים' }, { kind: 'anchor', label: 'מוטות עיגון' },
];

/**
 * שכבות תצוגה: מתג לכל סוג אלמנט עם מונה, וחיווי לאלמנטים מוסתרים/מבודדים (H / I) — כדי ששום דבר לא "ייעלם" בלי סיבה גלויה.
 */
export function LayersMenu() {
  const [open, setOpen] = useState(false);
  const filter = useStore((s) => s.filter);
  const view = useStore((s) => s.view);
  const hasClad = useStore((s) => !!s.project.building.cladding);
  const members = useStore((s) => s.derived.members);
  const hidden = useStore((s) => s.hidden);
  const isolated = useStore((s) => s.isolated);
  const counts = new Map<string, number>();
  for (const m of members) counts.set(m.kind, (counts.get(m.kind) ?? 0) + 1);
  const off = LAYERS.filter((l) => filter[l.kind] === false && counts.get(l.kind));
  const restricted = off.length > 0 || hidden.length > 0 || !!isolated;
  const resetAll = () => store.set({ filter: Object.fromEntries(LAYERS.map((l) => [l.kind, true])) as Record<MemberKind, boolean>, hidden: [], isolated: null });
  return (
    <div className="layers">
      <button className={`tbtn${restricted ? ' warn-on' : ''}`} onClick={() => setOpen(!open)} title="שכבות תצוגה" data-testid="layers-btn" aria-expanded={open}>
        <Icon name="eye" /><span>שכבות</span>{restricted && <i className="dot" />}
      </button>
      {open && (
        <div className="layers-pop" data-testid="layers-pop">
          {LAYERS.filter((l) => counts.get(l.kind)).map((l) => (
            <label key={l.kind} className="layer-row">
              <input type="checkbox" checked={filter[l.kind] !== false} data-testid={`layer-${l.kind}`}
                onChange={(e) => store.set({ filter: { ...filter, [l.kind]: e.target.checked } })} />
              <span>{l.label}</span><span className="mono muted">{counts.get(l.kind)}</span>
            </label>
          ))}
          {hasClad && <label className="layer-row"><input type="checkbox" checked={view.cladding} data-testid="layer-cladding" onChange={(e) => store.setView({ cladding: e.target.checked })} /><span>משטחי חיפוי (שקוף)</span><span /></label>}
          {(hidden.length > 0 || isolated) && <div className="hint" style={{ margin: '6px 2px 0' }}>{isolated ? `מצב בידוד: ${isolated.length} אלמנטים מוצגים` : ''}{hidden.length ? ` · ${hidden.length} מוסתרים ידנית (H)` : ''}</div>}
          <button className="btn small" style={{ marginTop: 6, width: '100%' }} data-testid="layers-all" onClick={resetAll}>הצג הכל</button>
        </div>
      )}
      {restricted && !open && <div className="layers-flag" data-testid="layers-flag" onClick={() => setOpen(true)}>
        {off.length ? `מוסתר: ${off.map((l) => l.label).join(', ')}` : isolated ? 'מצב בידוד' : `${hidden.length} מוסתרים`} · <u onClick={(e) => { e.stopPropagation(); resetAll(); }}>הצג הכל</u>
      </div>}
    </div>
  );
}
