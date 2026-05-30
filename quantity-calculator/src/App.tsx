import { useEffect, useState } from 'react';
import { useStore } from './store/projectStore';
import type { CalcRow } from './types';
import { Toolbar } from './components/Toolbar';
import { SectionsPanel } from './components/SectionsPanel';
import { PlanViewer, Tool } from './components/PlanViewer';
import { CalcTable } from './components/CalcTable';
import { RowEditor } from './components/RowEditor';
import { ReportA4 } from './components/ReportA4';
import { NewProjectDialog, OpenProjectDialog, ProjectMetaDialog } from './components/ProjectDialogs';

interface EditorState {
  open: boolean;
  initial: Partial<CalcRow>;
}

export default function App() {
  const { project, init, addRow, updateRow, toast, saving } = useStore();
  const [tool, setTool] = useState<Tool>('pan');
  const [filter, setFilter] = useState<string | null | 'all'>('all');
  const [editor, setEditor] = useState<EditorState>({ open: false, initial: {} });
  const [showReport, setShowReport] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showOpen, setShowOpen] = useState(false);
  const [showMeta, setShowMeta] = useState(false);

  useEffect(() => {
    void init();
  }, [init]);

  if (!project) {
    return <div className="loading-screen">טוען…</div>;
  }

  function openManual() {
    setEditor({ open: true, initial: { type: 'box_volume' } });
  }
  function openMeasured(initial: Partial<CalcRow>) {
    setEditor({ open: true, initial });
    setTool('pan');
  }
  function openEdit(row: CalcRow) {
    setEditor({ open: true, initial: row });
  }
  function saveRow(data: Partial<CalcRow>) {
    if (editor.initial.id) updateRow(editor.initial.id, data);
    else addRow(data);
    setEditor({ open: false, initial: {} });
  }

  return (
    <div className="app">
      <Toolbar
        project={project}
        tool={tool}
        setTool={setTool}
        onNewProject={() => setShowNew(true)}
        onOpenProject={() => setShowOpen(true)}
        onEditMeta={() => setShowMeta(true)}
        onAddManual={openManual}
        onReport={() => setShowReport(true)}
      />

      <div className="project-strip">
        <b>{project.name}</b>
        {project.projectNumber && <span> · מס׳ {project.projectNumber}</span>}
        {project.client && <span> · מזמין: {project.client}</span>}
        <span className="save-ind">{saving ? 'שומר…' : 'נשמר אוטומטית ✓'}</span>
      </div>

      <div className="main">
        <SectionsPanel project={project} activeFilter={filter} onFilter={setFilter} />
        <div className="center-col">
          <PlanViewer project={project} tool={tool} setTool={setTool} onMeasured={openMeasured} />
          <CalcTable project={project} activeFilter={filter} onEdit={openEdit} onAddManual={openManual} />
        </div>
      </div>

      {editor.open && (
        <RowEditor
          initial={editor.initial}
          sections={project.sections}
          pages={project.pages.map((p) => ({ id: p.id, name: p.name }))}
          onSave={saveRow}
          onClose={() => setEditor({ open: false, initial: {} })}
        />
      )}

      {showReport && <ReportA4 project={project} onClose={() => setShowReport(false)} />}
      {showNew && <NewProjectDialog onClose={() => setShowNew(false)} />}
      {showOpen && <OpenProjectDialog onClose={() => setShowOpen(false)} />}
      {showMeta && <ProjectMetaDialog project={project} onClose={() => setShowMeta(false)} />}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
