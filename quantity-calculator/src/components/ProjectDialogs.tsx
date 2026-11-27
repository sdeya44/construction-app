import { useState } from 'react';
import type { Project } from '../types';
import { useStore } from '../store/projectStore';
import { Modal } from './Modal';

export function ProjectMetaDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const { updateMeta } = useStore();
  const [f, setF] = useState({
    name: project.name,
    client: project.client,
    contractor: project.contractor,
    date: project.date,
    projectNumber: project.projectNumber,
    preparedBy: project.preparedBy,
    notes: project.notes,
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.value });

  return (
    <Modal
      title="פרטי פרויקט"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>ביטול</button>
          <button className="btn btn-primary" onClick={() => { updateMeta(f); onClose(); }}>שמירה</button>
        </>
      }
    >
      <div className="form-grid">
        <label className="field field-wide"><span>שם פרויקט</span><input value={f.name} onChange={set('name')} /></label>
        <label className="field"><span>מספר פרויקט</span><input value={f.projectNumber} onChange={set('projectNumber')} /></label>
        <label className="field"><span>תאריך</span><input value={f.date} onChange={set('date')} /></label>
        <label className="field"><span>שם מזמין</span><input value={f.client} onChange={set('client')} /></label>
        <label className="field"><span>שם קבלן</span><input value={f.contractor} onChange={set('contractor')} /></label>
        <label className="field field-wide"><span>שם מכין החישוב</span><input value={f.preparedBy} onChange={set('preparedBy')} /></label>
        <label className="field field-wide"><span>הערות כלליות</span><textarea rows={3} value={f.notes} onChange={set('notes')} /></label>
      </div>
    </Modal>
  );
}

export function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const { newProject } = useStore();
  const [f, setF] = useState({ name: '', projectNumber: '', client: '', contractor: '', preparedBy: '' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <Modal
      title="פרויקט חדש"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>ביטול</button>
          <button className="btn btn-primary" onClick={async () => { await newProject(f.name ? f : { name: 'פרויקט חדש' }); onClose(); }}>צור פרויקט</button>
        </>
      }
    >
      <div className="form-grid">
        <label className="field field-wide"><span>שם פרויקט</span><input autoFocus value={f.name} onChange={set('name')} placeholder="שם הפרויקט" /></label>
        <label className="field"><span>מספר פרויקט</span><input value={f.projectNumber} onChange={set('projectNumber')} /></label>
        <label className="field"><span>שם מכין החישוב</span><input value={f.preparedBy} onChange={set('preparedBy')} /></label>
        <label className="field"><span>שם מזמין</span><input value={f.client} onChange={set('client')} /></label>
        <label className="field"><span>שם קבלן</span><input value={f.contractor} onChange={set('contractor')} /></label>
      </div>
    </Modal>
  );
}

export function OpenProjectDialog({ onClose }: { onClose: () => void }) {
  const { list, openProject, deleteProject } = useStore();
  return (
    <Modal title="פתיחת פרויקט" onClose={onClose} footer={<button className="btn" onClick={onClose}>סגור</button>}>
      {list.length === 0 && <p>אין פרויקטים שמורים.</p>}
      <div className="project-list">
        {list.map((p) => (
          <div key={p.id} className="project-row">
            <button className="pr-open" onClick={async () => { await openProject(p.id); onClose(); }}>
              <b>{p.name}</b>
              <span className="pr-meta">{p.projectNumber && `מס׳ ${p.projectNumber} · `}{new Date(p.updatedAt).toLocaleString('he-IL')}</span>
            </button>
            <button className="btn btn-danger btn-sm" onClick={() => { if (confirm(`למחוק את הפרויקט "${p.name}"? פעולה זו אינה הפיכה.`)) deleteProject(p.id); }}>מחק</button>
          </div>
        ))}
      </div>
    </Modal>
  );
}
