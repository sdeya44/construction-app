import { SHEET_ID, HDR } from './config.js';
import { D } from './state.js';
import { uid, toast } from './utils.js';

// ── CORE FETCH ────────────────────────────────────────────────────────────────
export async function api(url, method='GET', body=null) {
  const opts = {
    method,
    headers: { Authorization: 'Bearer '+D.token, 'Content-Type': 'application/json' }
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(url, opts);
  if (!r.ok) { const e = await r.json(); throw new Error(e.error?.message || r.statusText); }
  return r.json();
}

// ── SHEETS HELPERS ────────────────────────────────────────────────────────────
export async function sRead(tab, range) {
  try {
    const r = await api(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(tab+'!'+range)}`);
    return r.values || [];
  } catch { return []; }
}

export async function sWrite(tab, cell, vals) {
  await api(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(tab+'!'+cell)}?valueInputOption=RAW`,
    'PUT', { values: vals }
  );
}

export async function sAppend(tab, row) {
  await api(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(tab+'!A1')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    'POST', { values: [row] }
  );
}

export async function sClear(tab) {
  try {
    await api(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(tab+'!A2:Z5000')}:clear`, 'POST', {});
  } catch {}
}

export async function rebuildTab(tab, rows) {
  await sClear(tab);
  if (rows.length) await sWrite(tab, 'A2', rows);
}

// ── SAFE READ-THEN-WRITE ──────────────────────────────────────────────────────
// Reads fresh data from sheet, filters rows matching predicate, rewrites.
// This prevents wiping data written by other sessions.
export async function safeDeleteRows(tab, colIndex, matchValue) {
  const rows = await sRead(tab, 'A2:Z5000');
  const kept = rows.filter(r => r[0] && r[colIndex] !== matchValue);
  await rebuildTab(tab, kept);
  return kept;
}

export async function safeUpdateRow(tab, idColIndex, matchId, newRow) {
  const rows = await sRead(tab, 'A2:Z5000');
  const updated = rows.filter(r=>r[0]).map(r => r[idColIndex] === matchId ? newRow : r);
  await rebuildTab(tab, updated);
}

// ── ENSURE STRUCTURE ──────────────────────────────────────────────────────────
export async function ensureStructure() {
  const meta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=sheets.properties.title`);
  const exist = (meta.sheets||[]).map(s => s.properties.title);
  const missing = Object.keys(HDR).filter(t => !exist.includes(t));
  if (missing.length) {
    await api(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}:batchUpdate`, 'POST', {
      requests: missing.map(t => ({ addSheet: { properties: { title: t } } }))
    });
  }
  for (const [tab, cols] of Object.entries(HDR)) {
    const v = await sRead(tab, 'A1:Z1');
    if (!v || !v[0] || v[0][0] !== cols[0]) {
      await sWrite(tab, 'A1', [cols]);
    }
  }
}

// ── CONFLICT DETECTION ────────────────────────────────────────────────────────
export async function checkLogVersion(logId, expectedVersion) {
  const rows = await sRead('DailyLogs', 'A2:P5000');
  const row = rows.find(r => r[0] === logId);
  if (!row) return { conflict: false, deleted: true };
  const currentVersion = row[13] ? +row[13] : 1;
  return { conflict: currentVersion !== expectedVersion, currentVersion };
}

// ── AUDIT LOG ─────────────────────────────────────────────────────────────────
export async function logAudit(action, entityType, entityId, summary) {
  try {
    await sAppend('AuditLog', [
      uid(),
      new Date().toISOString(),
      D.user?.email || '',
      D.user?.name  || '',
      action, entityType, entityId, summary
    ]);
  } catch {}
}

// ── DRIVE UPLOAD ──────────────────────────────────────────────────────────────
export async function driveUpload(file, filename) {
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify({ name: filename })], { type: 'application/json' }));
  form.append('file', file);
  const r = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
    { method: 'POST', headers: { Authorization: 'Bearer '+D.token }, body: form }
  );
  const data = await r.json();
  if (!data.id) {
    const reason = data.error?.message || data.error?.status || `HTTP ${r.status}`;
    throw new Error(reason);
  }
  await fetch(`https://www.googleapis.com/drive/v3/files/${data.id}/permissions`, {
    method: 'POST',
    headers: { Authorization: 'Bearer '+D.token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone' })
  });
  return data.id;
}

export function driveThumbUrl(fileId) {
  return `https://lh3.googleusercontent.com/d/${fileId}`;
}
