import { useRef, useState } from 'react';
import type { Project } from '../types';
import { useStore } from '../store/projectStore';
import { loadFilesAsPages } from '../lib/loadPlans';
import { exportCsv, exportExcel, exportProjectJson, readJsonFile } from '../lib/export';
import type { Tool } from './PlanViewer';

interface Props {
  project: Project;
  tool: Tool;
  setTool: (t: Tool) => void;
  onNewProject: () => void;
  onOpenProject: () => void;
  onEditMeta: () => void;
  onAddManual: () => void;
  onReport: () => void;
}

export function Toolbar({ project, tool, setTool, onNewProject, onOpenProject, onEditMeta, onAddManual, onReport }: Props) {
  const { saveNow, undo, addPages, importProject, showToast } = useStore();
  const planInput = useRef<HTMLInputElement>(null);
  const jsonInput = useRef<HTMLInputElement>(null);
  const [loadingPlan, setLoadingPlan] = useState(false);

  async function onPlanFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setLoadingPlan(true);
    try {
      const pages = await loadFilesAsPages(files);
      if (pages.length) {
        addPages(pages);
        showToast(`נוספו ${pages.length} עמודי תוכנית`);
      } else {
        showToast('לא נמצאו עמודים בקובץ');
      }
    } catch (e) {
      showToast('שגיאה בטעינת הקובץ');
      console.error(e);
    } finally {
      setLoadingPlan(false);
      if (planInput.current) planInput.current.value = '';
    }
  }

  async function onJsonFile(files: FileList | null) {
    if (!files || files.length === 0) return;
    try {
      const data = await readJsonFile(files[0]);
      if (confirm('ייבוא פרויקט מ-JSON ייצור פרויקט חדש. להמשיך?')) {
        await importProject(data);
      }
    } catch {
      showToast('קובץ JSON לא תקין');
    } finally {
      if (jsonInput.current) jsonInput.current.value = '';
    }
  }

  const tbtn = (t: Tool, label: string, title: string) => (
    <button className={'btn tool-btn' + (tool === t ? ' active' : '')} onClick={() => setTool(t)} title={title}>
      {label}
    </button>
  );

  return (
    <div className="toolbar">
      <div className="tb-brand">📐 כלי חישוב כמויות</div>

      <div className="tb-group">
        <button className="btn" onClick={onNewProject}>פרויקט חדש</button>
        <button className="btn" onClick={onOpenProject}>פתח פרויקט</button>
        <button className="btn" onClick={() => { void saveNow(); showToast('נשמר'); }}>💾 שמור</button>
        <button className="btn" onClick={onEditMeta}>פרטי פרויקט</button>
        <button className="btn" onClick={undo} title="בטל פעולה אחרונה">↩ בטל</button>
      </div>

      <div className="tb-group">
        <button className="btn btn-accent" disabled={loadingPlan} onClick={() => planInput.current?.click()}>
          {loadingPlan ? 'טוען…' : '🗂 ייבוא תוכנית'}
        </button>
        {tbtn('scale', '📏 קנה מידה', 'קביעת קנה מידה לעמוד')}
        {tbtn('length', '╱ אורך', 'מדידת אורך')}
        {tbtn('area', '▱ שטח', 'מדידת שטח')}
        {tbtn('count', '#️⃣ ספירה', 'ספירת פריטים')}
        {tbtn('pan', '✋ הזזה', 'גרירת התצוגה')}
      </div>

      <div className="tb-group">
        <button className="btn btn-primary" onClick={onAddManual}>＋ חישוב ידני</button>
        <button className="btn btn-primary" onClick={onReport}>🖨 דוח A4</button>
      </div>

      <div className="tb-group">
        <button className="btn" onClick={() => exportExcel(project)}>Excel</button>
        <button className="btn" onClick={() => exportCsv(project)}>CSV</button>
        <button className="btn" onClick={() => exportProjectJson(project)}>גיבוי JSON</button>
        <button className="btn" onClick={() => jsonInput.current?.click()}>ייבוא JSON</button>
      </div>

      <input ref={planInput} type="file" accept=".pdf,.png,.jpg,.jpeg,image/*,application/pdf" multiple hidden onChange={(e) => onPlanFiles(e.target.files)} />
      <input ref={jsonInput} type="file" accept=".json,application/json" hidden onChange={(e) => onJsonFile(e.target.files)} />
    </div>
  );
}
