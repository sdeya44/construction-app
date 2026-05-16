import { CLIENT_ID, SCOPES, USER_KEY } from './config.js';
import { D, loadAll } from './state.js';
import { ensureStructure } from './api.js';
import { showLoad, setLoad, hideLoad, toast, go } from './utils.js';
import { renderDash, startAutoRefresh } from './screens/dashboard.js';
import { initSelects } from './screens/reports.js';
import { applyRoleUI } from './app.js';
import { loadCache, updateStatusBar, startOfflineMonitor } from './offline.js';

const loginEl  = () => document.getElementById('login-screen');
const appEl    = () => document.getElementById('app-main');

function restoreCache(snap, online) {
  const skip = new Set(['token','wiz']);
  for (const [k,v] of Object.entries(snap)) { if (!skip.has(k)) D[k] = v; }
  D.isOnline = online;
  appEl().style.display = 'flex';
  applyRoleUI(); initSelects(); renderDash();
  updateStatusBar(online);
  startOfflineMonitor(on => { D.isOnline = on; });
}

export function signIn() {
  const tc = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID, scope: SCOPES,
    callback: async r => {
      if (r.error) { toast('שגיאת כניסה','err'); return; }
      D.token = r.access_token;
      const u = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: 'Bearer '+D.token } });
      D.user = await u.json();
      try { localStorage.setItem(USER_KEY, JSON.stringify(D.user)); } catch {}
      await boot();
    }
  });
  tc.requestAccessToken({ prompt: '' });
}

export function tryAutoLogin() {
  try {
    const s = localStorage.getItem(USER_KEY); if (!s) return;
    const saved = JSON.parse(s);
    if (!navigator.onLine) { D.user = saved; bootOffline(); return; }
    const tc = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID, scope: SCOPES, hint: saved.email||'',
      callback: async r => {
        if (!r.access_token) { D.user = saved; bootOffline(); return; }
        D.token = r.access_token;
        try {
          const u = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: 'Bearer '+D.token } });
          const fresh = await u.json();
          D.user = fresh.email ? fresh : saved;
          localStorage.setItem(USER_KEY, JSON.stringify(D.user));
        } catch { D.user = saved; }
        await boot();
      }
    });
    tc.requestAccessToken({ prompt: 'none' });
  } catch {}
}

async function bootOffline() {
  loginEl().style.display = 'none';
  showLoad('טוען נתונים שמורים...');
  const snap = await loadCache();
  hideLoad();
  if (!snap) {
    loginEl().style.display = 'flex';
    toast('אין חיבור לאינטרנט ואין נתונים שמורים','err');
    return;
  }
  restoreCache(snap, false);
  startOfflineMonitor(online => {
    D.isOnline = online;
    if (online) toast('חיבור לאינטרנט חזר — רענן את הדף לטעינת נתונים עדכניים','ok');
  });
  toast('מצב לא מקוון — מוצגים נתונים שמורים','warn');
}

async function boot() {
  loginEl().style.display = 'none';
  showLoad('מתחבר...');
  try {
    setLoad('בודק מבנה גיליון...');
    await ensureStructure();
    setLoad('טוען נתונים...');
    await loadAll();
    if (new URLSearchParams(location.search).has('gm')) {
      D.role = 'GeneralManager';
      const email = (D.user?.email || '').toLowerCase().trim(), name = D.user?.name || email, now = new Date().toISOString();
      try { localStorage.setItem('cnstr_gm_v1', email); } catch {}
      const already = D.users.find(u => u.email === email);
      try {
        if (!already) {
          const { uid } = await import('./utils.js');
          const { sAppend } = await import('./api.js');
          const id = uid();
          await sAppend('Users', [id, email, name, 'GeneralManager', now, 'bootstrap']);
          D.users.push({ id, email, name, role: 'GeneralManager', addedAt: now, addedBy: 'bootstrap' });
          toast('נרשמת כמנהל ראשי ✓', 'ok');
        } else if (already.role !== 'GeneralManager') {
          const { rebuildTab } = await import('./api.js');
          const idx = D.users.findIndex(u => u.email === email);
          D.users[idx] = { ...already, role: 'GeneralManager' };
          await rebuildTab('Users', D.users.map(u => [u.id, u.email, u.name, u.role, u.addedAt, u.addedBy]));
          toast('תפקיד עודכן ל-מנהל ראשי ✓', 'ok');
        }
      } catch(e) { toast('⚠️ שמירה לגיליון נכשלה: '+e.message, 'warn'); }
    }
    hideLoad();
    appEl().style.display = 'flex';
    applyRoleUI(); initSelects(); renderDash(); startAutoRefresh();
    updateStatusBar(true);
    startOfflineMonitor(online => {
      D.isOnline = online;
      toast(online ? 'חיבור חזר' : 'אין חיבור — לא ניתן לשמור', online ? 'ok' : 'warn');
    });
    toast('מחובר ✓','ok');
  } catch(e) {
    hideLoad();
    const snap = await loadCache();
    if (snap) {
      restoreCache(snap, false);
      startOfflineMonitor(online => { D.isOnline = online; });
      toast('שגיאת טעינה — מוצגים נתונים שמורים','warn');
    } else {
      appEl().style.display = 'flex';
      toast('שגיאת טעינה: '+e.message,'err');
    }
  }
}
