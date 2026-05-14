import { CLIENT_ID, SCOPES, USER_KEY } from './config.js';
import { D, loadAll } from './state.js';
import { ensureStructure } from './api.js';
import { showLoad, setLoad, hideLoad, toast, go } from './utils.js';
import { renderDash, startAutoRefresh } from './screens/dashboard.js';
import { initSelects } from './screens/reports.js';
import { applyRoleUI } from './app.js';

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
    const tc = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID, scope: SCOPES, hint: saved.email||'',
      callback: async r => {
        if (!r.access_token) return;
        D.token = r.access_token;
        D.user  = saved;
        await boot();
      }
    });
    tc.requestAccessToken({ prompt: 'none' });
  } catch {}
}

async function boot() {
  document.getElementById('login-screen').style.display = 'none';
  showLoad('מתחבר...');
  try {
    setLoad('בודק מבנה גיליון...');
    await ensureStructure();
    setLoad('טוען נתונים...');
    await loadAll();
    hideLoad();
    document.getElementById('app-main').style.display = 'flex';
    applyRoleUI();
    initSelects();
    renderDash();
    startAutoRefresh();
    toast('מחובר ✓','ok');
  } catch(e) {
    hideLoad();
    document.getElementById('app-main').style.display = 'flex';
    toast('שגיאת טעינה: '+e.message,'err');
  }
}
