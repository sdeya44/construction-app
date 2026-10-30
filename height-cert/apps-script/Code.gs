/**
 * סנכרון אפליקציית "אישורי הדרכה – עבודה בגובה" לגוגל שיטס.
 *
 * הוראות התקנה (בחשבון הגוגל של אחמד):
 *  1. פותחים גיליון חדש: sheets.new
 *  2. תפריט: תוספים (Extensions) ← Apps Script. מוחקים את הקוד הקיים ומדביקים את כל הקובץ הזה.
 *  3. משנים את SECRET (ראו למטה) לסיסמה ארוכה וייחודית, לפחות 20 תווים.
 *  4. Deploy ← New deployment ← סוג: Web app
 *       Execute as: Me
 *       Who has access: Anyone
 *     ואחרי Deploy מאשרים הרשאות (Advanced ← Go to project).
 *  5. מעתיקים את ה-Web app URL, ובאפליקציה: הגדרות ← סנכרון ← מדביקים כתובת + אותו מפתח.
 *
 * אחרי כל שינוי בקוד צריך Deploy ← Manage deployments ← Edit ← New version.
 */

// *** חובה לשנות. חייב להיות זהה למפתח שמוזן באפליקציה. ***
const SECRET = 'CHANGE-ME-TO-A-LONG-RANDOM-KEY';

const SCHEMA = {
  employers: ['id', '_u', 'deleted', 'type', 'typeOther', 'company', 'contact', 'idnum', 'phone', 'address', 'zip'],
  workers:   ['id', '_u', 'deleted', 'employerId', 'first', 'last', 'father', 'idnum', 'birthYear', 'profession', 'address', 'signature'],
  certs:     ['id', '_u', 'deleted', 'workerId', 'employerId', 'date', 'until', 'serial', 'topics', 'signature', 'createdAt'],
  meta:      ['id', '_u', 'deleted', 'data']
};
const JSON_COLS = { signature: 1, topics: 1, data: 1 };
const KINDS = ['employers', 'workers', 'certs', 'meta'];

function doGet() {
  return ContentService.createTextOutput('OK - height-cert sync').setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return jsonOut({ ok: false, error: 'bad request' }); }
  if (!req || req.key !== SECRET) return jsonOut({ ok: false, error: 'auth' });
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    return jsonOut(syncCore(req, makeStore(), Date.now()));
  } catch (err) {
    return jsonOut({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

function jsonOut(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------- ליבת הסנכרון (בלי תלות ב-Google, ניתנת לבדיקה) ---------- */
function syncCore(req, store, nowMs) {
  const out = { ok: true, now: nowMs };
  const since = Number(req.since || 0);
  KINDS.forEach(function (kind) {
    const existing = store.read(kind);
    const byId = {};
    existing.forEach(function (r) { byId[r.id] = r; });
    const incoming = kind === 'meta' ? (req.meta ? [req.meta] : []) : ((req.changes || {})[kind] || []);
    const updates = [], appends = [], skip = {}, lost = {};
    incoming.forEach(function (r) {
      if (!r || !r.id) return;
      const cur = byId[r.id];
      if (cur && Number(cur._u) >= Number(r._u)) { lost[r.id] = 1; return; }   // בשרת גרסה חדשה יותר
      const rec = Object.assign({}, r, { srv: nowMs });
      if (cur) { updates.push({ row: cur.__row, rec: rec }); byId[r.id] = Object.assign({ __row: cur.__row }, rec); }
      else { appends.push(rec); byId[r.id] = Object.assign({ __row: -1 }, rec); }
      skip[r.id] = 1;
    });
    store.write(kind, updates, appends);
    out[kind] = Object.keys(byId).map(function (id) { return byId[id]; })
      .filter(function (r) { return lost[r.id] || (!skip[r.id] && Number(r.srv || 0) > since); })
      .map(function (r) { const c = Object.assign({}, r); delete c.__row; return c; });
  });
  return out;
}

/* ---------- אחסון בגיליון ---------- */
function colsOf(kind) { return SCHEMA[kind].concat(['srv']); }

function sheetFor(kind) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(kind);
  if (!sh) {
    sh = ss.insertSheet(kind);
    const c = colsOf(kind);
    sh.getRange(1, 1, 1, c.length).setNumberFormat('@').setValues([c]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function decode(col, v) {
  if (col === '_u' || col === 'srv') return Number(v) || 0;
  if (col === 'deleted') return v === true || v === 'true';
  if (JSON_COLS[col]) { if (v === '' || v == null) return null; try { return JSON.parse(v); } catch (e) { return null; } }
  return v == null ? '' : String(v);
}

function encode(col, v) {
  if (v === undefined || v === null) return '';
  if (col === 'deleted') return v ? 'true' : '';
  if (JSON_COLS[col]) return JSON.stringify(v);
  return String(v);
}

function makeStore() {
  return {
    read: function (kind) {
      const sh = sheetFor(kind), cols = colsOf(kind), n = sh.getLastRow();
      if (n < 2) return [];
      const vals = sh.getRange(2, 1, n - 1, cols.length).getValues();
      const out = [];
      vals.forEach(function (row, i) {
        const o = { __row: i + 2 };
        cols.forEach(function (c, j) { o[c] = decode(c, row[j]); });
        if (o.id) out.push(o);
      });
      return out;
    },
    write: function (kind, updates, appends) {
      if (!updates.length && !appends.length) return;
      const sh = sheetFor(kind), cols = colsOf(kind);
      const toRow = function (rec) { return cols.map(function (c) { return encode(c, rec[c]); }); };
      updates.forEach(function (u) {
        sh.getRange(u.row, 1, 1, cols.length).setNumberFormat('@').setValues([toRow(u.rec)]);
      });
      if (appends.length) {
        const start = sh.getLastRow() + 1, need = start + appends.length - 1;
        if (sh.getMaxRows() < need) sh.insertRowsAfter(sh.getMaxRows(), need - sh.getMaxRows());
        sh.getRange(start, 1, appends.length, cols.length).setNumberFormat('@').setValues(appends.map(toRow));
      }
    }
  };
}
