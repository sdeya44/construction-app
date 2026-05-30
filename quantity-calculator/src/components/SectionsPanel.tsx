import { useState } from 'react';
import type { Project, Section, Unit } from '../types';
import { UNITS } from '../types';
import { useStore } from '../store/projectStore';
import { summarizeBySection, grandTotals } from '../lib/calc';
import { Modal } from './Modal';

interface Props {
  project: Project;
  activeFilter: string | null | 'all';
  onFilter: (id: string | null | 'all') => void;
}

export function SectionsPanel({ project, activeFilter, onFilter }: Props) {
  const { addSection, updateSection, deleteSection } = useStore();
  const [editing, setEditing] = useState<Section | null>(null);

  const summaries = summarizeBySection(project.rows);
  const totals = grandTotals(project.rows);

  function startNew() {
    const id = addSection();
    const sec = useStore.getState().project?.sections.find((s) => s.id === id);
    if (sec) setEditing(sec);
  }

  return (
    <div className="panel sections-panel">
      <div className="panel-head">
        <h2>ספריית סעיפים</h2>
        <button className="btn btn-sm btn-primary" onClick={startNew}>+ סעיף</button>
      </div>

      <div className="section-list">
        <button
          className={'section-item all' + (activeFilter === 'all' ? ' active' : '')}
          onClick={() => onFilter('all')}
        >
          <div className="si-main"><b>כל הסעיפים</b></div>
          <div className="si-sum">{totals.rowCount} שורות</div>
        </button>

        {project.sections.map((s) => {
          const sum = summaries.get(s.id);
          return (
            <div
              key={s.id}
              className={'section-item' + (activeFilter === s.id ? ' active' : '')}
              onClick={() => onFilter(s.id)}
            >
              <div className="si-main">
                <span className="si-code">{s.code}</span>
                <span className="si-name">{s.name}</span>
              </div>
              <div className="si-sum">
                <b>{sum ? sum.total : 0}</b> {s.unit}
                <span className="si-rows">{sum ? sum.rowCount : 0} ש׳</span>
              </div>
              <button
                className="si-edit"
                title="עריכת סעיף"
                onClick={(e) => { e.stopPropagation(); setEditing(s); }}
              >✎</button>
            </div>
          );
        })}

        {(() => {
          const unassigned = summaries.get(null);
          if (!unassigned) return null;
          return (
            <div
              className={'section-item warn' + (activeFilter === null ? ' active' : '')}
              onClick={() => onFilter(null)}
            >
              <div className="si-main"><span className="si-name">ללא סעיף</span></div>
              <div className="si-sum"><b>{unassigned.rowCount}</b> ש׳</div>
            </div>
          );
        })()}
      </div>

      <div className="grand-totals">
        <div className="gt-row"><span>סך תוספות</span><b>{totals.additions}</b></div>
        <div className="gt-row deduction"><span>סך הפחתות</span><b>-{totals.deductions}</b></div>
        <div className="gt-row net"><span>סך נטו</span><b>{totals.net}</b></div>
        <div className="gt-row"><span>סה״כ שורות</span><b>{totals.rowCount}</b></div>
      </div>

      {editing && (
        <SectionEditor
          section={editing}
          onSave={(partial) => { updateSection(editing.id, partial); setEditing(null); }}
          onDelete={() => { deleteSection(editing.id); setEditing(null); }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function SectionEditor({
  section, onSave, onDelete, onClose,
}: {
  section: Section;
  onSave: (p: Partial<Section>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [code, setCode] = useState(section.code);
  const [name, setName] = useState(section.name);
  const [unit, setUnit] = useState<Unit>(section.unit);
  const [description, setDescription] = useState(section.description);

  return (
    <Modal
      title="סעיף"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-danger" onClick={() => { if (confirm('למחוק את הסעיף? שורות משויכות יישארו ללא סעיף.')) onDelete(); }}>מחק</button>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>ביטול</button>
          <button className="btn btn-primary" onClick={() => onSave({ code, name, unit, description })}>שמירה</button>
        </>
      }
    >
      <div className="form-grid">
        <label className="field"><span>קוד סעיף</span>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="01.01.001" />
        </label>
        <label className="field"><span>יחידה</span>
          <select value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
            {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </label>
        <label className="field field-wide"><span>שם הסעיף</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field field-wide"><span>תיאור</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
      </div>
    </Modal>
  );
}
