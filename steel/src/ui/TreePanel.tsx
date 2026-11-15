import { setPurlinSide } from '../commands/commands';
import { useState } from 'react';
import type { Member, MemberKind } from '../model/types';
import { store, useStore } from '../store';
import { KIND_COLOR } from '../view/scene';
import { Icon } from './icons';

export const KIND_LABEL: Record<MemberKind, string> = {
  column: 'עמוד', rafter: 'קורת גג', beam: 'קורה', brace: 'קושרת', purlin: 'פטה', cleat: 'זוויתן', plate: 'פלטה', bolt: 'בורג', anchor: 'מוט עיגון',
};

export function TreePanel() {
  const d = useStore((s) => s.derived);
  const sel = useStore((s) => s.selection);
  const hidden = useStore((s) => s.hidden);
  const filter = useStore((s) => s.filter);
  const frames = useStore((s) => s.project.building.frames);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const selSet = new Set(sel), hidSet = new Set(hidden);
  const groups: { key: string; title: string; items: Member[] }[] = frames.map((f, i) => ({
    key: f.id, title: `מסגרת ${i + 1} · ${f.id}`, items: d.members.filter((m) => m.frameId === f.id),
  }));
  const purl = d.members.filter((m) => m.purlin);
  if (purl.length) groups.push({ key: 'purlins', title: 'פטות', items: purl });
  const manual = d.members.filter((m) => !m.frameId && !m.purlin);
  if (manual.length) groups.push({ key: 'manual', title: 'אלמנטים ידניים', items: manual });

  return (
    <div className="panel-body" data-testid="tree-panel">
      <div className="panel-title">מסנן בחירה</div>
      <div className="row" style={{ marginBottom: 8 }}>
        {(Object.keys(filter) as MemberKind[]).map((k) => (
          <label key={k} className="badge" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={filter[k]} onChange={(e) => store.set({ filter: { ...filter, [k]: e.target.checked } })} />
            {KIND_LABEL[k]}
          </label>
        ))}
      </div>
      <div className="panel-title">אלמנטים ({d.members.length})</div>
      {groups.map((g) => {
        const isOpen = open[g.key] ?? g.items.some((m) => selSet.has(m.id));
        return (
          <div className="tree-group" key={g.key}>
            <div className="tree-head" onClick={() => setOpen({ ...open, [g.key]: !isOpen })}>
              <span>{isOpen ? '▾' : '◂'}</span>
              <span>{g.title}</span>
              <span className="badge" style={{ marginInlineStart: 'auto' }}>{g.items.length}</span>
              <button className="icon-btn" title="בחר את כל המסגרת" onClick={(e) => { e.stopPropagation(); store.select(g.items.map((m) => m.id)); }}><Icon name="select" /></button>
            </div>
            {isOpen && g.items.map((m) => (
              <div key={m.id} data-el={m.id} className={`tree-item${selSet.has(m.id) ? ' sel' : ''}${hidSet.has(m.id) ? ' hidden-el' : ''}`}
                onClick={(e) => store.select([m.id], e.ctrlKey || e.metaKey ? 'toggle' : e.shiftKey ? 'add' : 'replace')}>
                <span className="swatch" style={{ background: `#${KIND_COLOR[m.kind].toString(16).padStart(6, '0')}` }} />
                <span>{m.purlin ? m.label : `${KIND_LABEL[m.kind]}${m.side ? (m.side === 'L' ? ' שמאל' : ' ימין') : ''}`}</span>
                <span className="id">{m.id}</span>
                <span className="prof">{m.profile}</span>
                <button className="icon-btn" title={hidSet.has(m.id) ? 'הצג' : 'הסתר'} onClick={(e) => {
                  e.stopPropagation();
                  store.set({ hidden: hidSet.has(m.id) ? hidden.filter((h) => h !== m.id) : [...hidden, m.id] });
                }}><Icon name={hidSet.has(m.id) ? 'eyeOff' : 'eye'} /></button>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

export function IssuesPanel() {
  const issues = useStore((s) => s.derived.issues);
  if (!issues.length) return <div className="panel-body"><div className="hint" data-testid="no-issues">אין בעיות פתוחות במודל.</div></div>;
  return (
    <div className="panel-body" data-testid="issues-panel">
      {issues.map((i, k) => (
        <div key={k} className={`issue ${i.severity}`} data-el={i.elementId}
          onClick={() => { if (i.elementId) store.select([i.elementId]); }}>
          <span className="ic">{i.severity === 'error' ? '✕' : i.severity === 'warning' ? '!' : 'i'}</span>
          <div><div>{i.message}</div><div className="hint" style={{ margin: 0, direction: 'ltr', textAlign: 'right' }}>{i.code}{i.elementId ? ` · ${i.elementId}` : ''}</div>{i.fix && <button className="btn small fix-btn" data-testid={`fix-${i.code}`} onClick={(e) => { e.stopPropagation(); store.exec(setPurlinSide(i.fix!.purlinKey, i.fix!.patch)); }}>תיקון: {i.fix.label}</button>}</div>
        </div>
      ))}
    </div>
  );
}
