import { createRoot } from 'react-dom/client';
import { lastProjectId, loadCatalog, loadProject } from './persist/idb';
import { setUserCatalog, type UserCatalog } from './profiles/userCatalog';
import { clearProfileCache } from './profiles/library';
import { store } from './store';
import { App } from './ui/App';
// גופנים מקומיים (OFL) — עובדים גם ללא רשת; מוטמעים בקובץ היחיד
import '@fontsource/assistant/hebrew-400.css';
import '@fontsource/assistant/hebrew-600.css';
import '@fontsource/assistant/hebrew-700.css';
import '@fontsource/assistant/latin-400.css';
import '@fontsource/assistant/latin-600.css';
import '@fontsource/assistant/latin-700.css';
import '@fontsource/frank-ruhl-libre/hebrew-700.css';
import '@fontsource/frank-ruhl-libre/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-600.css';
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
