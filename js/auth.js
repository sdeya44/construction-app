import { CLIENT_ID, SCOPES, USER_KEY } from './config.js';
import { D, loadAll } from './state.js';
import { ensureStructure } from './api.js';
import { showLoad, setLoad, hideLoad, toast, go } from './utils.js';
import { renderDash, startAutoRefresh } from './screens/dashboard.js';
import { initSelects } from './screens/reports.js';
import { applyRoleUI } from './app.js';
import { loadCache, updateStatusBar, startOfflineMonitor } from './offline.js';

export function signIn() {
  const tc = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID, scope: SCOPES,
    callback: async r => {
      if (r.error) { toast('שגיאת כניסה','err'); return; }
      D.token = r.access_token;
      const u = await fetch('https://www.googleapis.com/oauth2/v3/userinfo',
        { headers: { Authorization: 'Bearer '+D.token } });
      D.user = await u.json();
      try { localStorage.setItem(USER_KEY, JSON.stringify(D.user)); } catch {}
      await boot();
    }
  });
  tc.requestAccessToken({ prompt: '' });
}

export function tryAutoLogin() {
  try {
    const s = localStorage.getItem(USER_KEY);
    if (!s) return;
    const saved = JSON.parse(s);

    // If offline, boot from cache immediately without waiting for OAuth
    if (!navigator.onLine) {
      D.user = saved;
      bootOffline();
      return;
    }

    const tc = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID, scope: SCOPES, hint: saved.email||'',
      callback: async r => {
        if (!r.access_token) {
          // Token refresh failed — try offline cache
          D.user = saved;
          bootOffline();
          return;
        }
        D.token = r.access_token;
        D.user  = saved;
        await boot();
      }
    });
    tc.requestAccessToken({ prompt: 'none' });
  } catch {}
}

async function bootOffline() {
  document.getElementById('login-screen').style.display = 'none';
  showLoad('טוען נתונים שמורים...');
  const snap = await loadCache();
  hideLoad();
  if (!snap) {
    document.getElementById('login-screen').style.display = 'flex';
    toast('אין חיבור לאינטרנט ואין נתונים שמורים','err');
    return;
  }
  // Restore cached state fields into D
  const skip = new Set(['token','wiz']);
  for (const [k,v] of Object.entries(snap)) {
    if (!skip.has(k)) D[k] = v;
  }
  D.isOnline = false;
  document.getElementById('app-main').style.display = 'flex';
  applyRoleUI();
  initSelects();
  renderDash();
  updateStatusBar(false);
  startOfflineMonitor(online => {
    D.isOnline = online;
    if (online) toast('חיבור לאינטרנט חזר — רענן את הדף לטעינת נתונים עדכניים','ok');
  });
  toast('מצב לא מקוון — מוצגים נתונים שמורים','warn');
}

async function boot() {
  document.getElementById('login-screen').style.display = 'none';
  showLoad('מתחבר...');
  try {
    setLoad('בודק מבנה גיליון...');
    await ensureStructure();
    setLoad('טוען נתונים...');
    await loadAll();
    // URL bootstrap: ?gm forces GeneralManager permanently via localStorage
    if (new URLSearchParams(location.search).has('gm')) {
      D.role = 'GeneralManager';
      try { localStorage.setItem('cnstr_gm_v1', D.user?.email || ''); } catch {}

      // Also update the sheet so it persists for other devices
      const email = D.user?.email || '';
      const name  = D.user?.name  || email;
      const now   = new Date().toISOString();
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
      } catch(e) {
        toast('⚠️ שמירה לגיליון נכשלה: ' + e.message, 'warn');
      }
    }
    hideLoad();
    document.getElementById('app-main').style.display = 'flex';
    applyRoleUI();
    initSelects();
    renderDash();
    startAutoRefresh();
    updateStatusBar(true);
    startOfflineMonitor(online => {
      D.isOnline = online;
      if (!online) toast('אין חיבור — לא ניתן לשמור','warn');
      else toast('חיבור חזר','ok');
    });
    toast('מחובר ✓','ok');
  } catch(e) {
    hideLoad();
    // Try loading cached data as fallback
    const snap = await loadCache();
    if (snap) {
      const skip = new Set(['token','wiz']);
      for (const [k,v] of Object.entries(snap)) {
        if (!skip.has(k)) D[k] = v;
      }
      D.isOnline = false;
      document.getElementById('app-main').style.display = 'flex';
      applyRoleUI();
      initSelects();
      renderDash();
      updateStatusBar(false);
      startOfflineMonitor(online => { D.isOnline = online; });
      toast('שגיאת טעינה — מוצגים נתונים שמורים','warn');
    } else {
      document.getElementById('app-main').style.display = 'flex';
      toast('שגיאת טעינה: '+e.message,'err');
    }
  }
}
