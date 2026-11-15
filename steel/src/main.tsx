import { createRoot } from 'react-dom/client';
import { lastProjectId, loadCatalog, loadProject } from './persist/idb';
import { setUserCatalog, type UserCatalog } from './profiles/userCatalog';
import { clearProfileCache } from './profiles/library';
import { store } from './store';
import { App } from './ui/App';
import './ui/app.css';

async function boot() {
  // פתיחת הפרויקט האחרון מהאחסון המקומי; אם אין — פרויקט ברירת מחדל (GEO-01)
  try {
    const cat = await loadCatalog<UserCatalog>();
    if (cat) { setUserCatalog(cat); clearProfileCache(); }
  } catch { /* קטלוג חסר או פגום — ממשיכים עם חישוב גיאומטרי */ }
  try {
    const id = await lastProjectId();
    if (id) store.loadProject(await loadProject(id));
    else await store.saveNow('יצירת פרויקט');
  } catch (e) {
    store.toast('error', `טעינת הפרויקט האחרון נכשלה: ${(e as Error).message}. פתח "פתיחה" לשחזור גרסה.`);
  }
  createRoot(document.getElementById('root')!).render(<App />);
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  }
}
void boot();
