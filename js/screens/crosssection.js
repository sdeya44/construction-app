// ============================================================================
// כמויות חפירה/מילוי בחתכים — Average End Area
// שרטוט פרופיל קיים + מתוכנן על קנבס, חישוב שטחי חפירה/מילוי לכל חתך,
// ונפחים בין חתכים בשיטת שטח קצה ממוצע. נתונים ב-localStorage תחת 'cs_v1'.
// ============================================================================

import { go, openSheet, closeSheet, toast } from '../utils.js';

const KEY = 'cs_v1';

// קנבס פנימי קבוע; מוצג responsive
const CW = 340;
const CH = 210;

// צבעים
const C_EXIST = '#2C2620'; // פרופיל קיים — קו כהה
const C_PROP = '#B8922C';  // פרופיל מתוכנן — קו זהב
const C_CUT = 'rgba(176,48,37,0.45)';   // חפירה = אדום
const C_FILL = 'rgba(46,109,164,0.42)';  // מילוי = כחול
const C_CUT_S = '#B03025';
const C_FILL_S = '#2E6DA4';

// ── STATE ────────────────────────────────────────────────────────────────────
let S = null;       // המודל הכולל
let editId = null;  // מזהה החתך הנערך
let editMode = 'existing'; // 'existing' | 'proposed'

function blank() {
  return { project: { name: '', scaleW: 20, scaleH: 10 }, sections: [] };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) { S = JSON.parse(raw); }
  } catch { /* ignore */ }
  if (!S || !S.project || !Array.isArray(S.sections)) S = blank();
  if (!(S.project.scaleW > 0)) S.project.scaleW = 20;
  if (!(S.project.scaleH > 0)) S.project.scaleH = 10;
  return S;
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); }
  catch { toast('שגיאה בשמירה מקומית', 'err'); }
}

function uid() { return 'cs_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// ── GEOMETRY / AREA / VOLUME ─────────────────────────────────────────────────

// אינטרפולציה לינארית של y בנקודה x מתוך פוליליין ממוין לפי x
function interpY(pts, x) {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (x >= a.x && x <= b.x) {
      if (b.x === a.x) return a.y;
      const t = (x - a.x) / (b.x - a.x);
      return a.y + t * (b.y - a.y);
    }
  }
  return null;
}

function sortX(pts) { return [...pts].sort((a, b) => a.x - b.x); }

/**
 * מחשב שטחי חפירה ומילוי (מ״ר) לחתך.
 * חפירה: הפרופיל המתוכנן נמוך מהקיים (על המסך y גדול יותר).
 * מילוי: המתוכנן גבוה מהקיים.
 */
export function sectionAreas(sec, scaleW, scaleH) {
  const ex = sortX(sec.points?.existing || []);
  const pr = sortX(sec.points?.proposed || []);
  if (ex.length < 2 || pr.length < 2) return { cut: 0, fill: 0 };

  const pxPerMx = CW / scaleW;
  const pxPerMy = CH / scaleH;

  const xMin = Math.max(ex[0].x, pr[0].x);
  const xMax = Math.min(ex[ex.length - 1].x, pr[pr.length - 1].x);
  if (xMax <= xMin) return { cut: 0, fill: 0 };

  const N = 240;
  const dxPx = (xMax - xMin) / N;
  const dxM = dxPx / pxPerMx;

  let cut = 0, fill = 0;
  for (let i = 0; i < N; i++) {
    const x = xMin + dxPx * (i + 0.5); // אמצע המקטע
    const ye = interpY(ex, x);
    const yp = interpY(pr, x);
    if (ye == null || yp == null) continue;
    const diffM = (yp - ye) / pxPerMy; // חיובי => מתוכנן מתחת לקיים => חפירה
    if (diffM > 0) cut += diffM * dxM;
    else fill += -diffM * dxM;
  }
  return { cut: round2(cut), fill: round2(fill) };
}

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

/**
 * נפחים בין חתכים עוקבים בשיטת שטח קצה ממוצע:
 * V = (A1 + A2) / 2 × L , בנפרד לחפירה ולמילוי.
 */
export function computeVolumes() {
  const { scaleW, scaleH } = S.project;
  const rows = S.sections.map(sec => ({ sec, ...sectionAreas(sec, scaleW, scaleH) }));
  const spans = [];
  let totCut = 0, totFill = 0;
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i], b = rows[i + 1];
    const L = +a.sec.dist || 0;
    const vCut = round2((a.cut + b.cut) / 2 * L);
    const vFill = round2((a.fill + b.fill) / 2 * L);
    totCut += vCut; totFill += vFill;
    spans.push({ from: a.sec, to: b.sec, L, vCut, vFill });
  }
  return { rows, spans, totCut: round2(totCut), totFill: round2(totFill) };
}

// ── CANVAS DRAWING ───────────────────────────────────────────────────────────
function drawSection(canvas, sec, scaleW, scaleH) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, CW, CH);
  ctx.fillStyle = '#FFFDF8';
  ctx.fillRect(0, 0, CW, CH);

  // רשת
  const pxPerMx = CW / scaleW;
  const pxPerMy = CH / scaleH;
  ctx.strokeStyle = 'rgba(26,23,20,0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let m = 0; m <= scaleW; m += 1) { const x = m * pxPerMx; ctx.moveTo(x, 0); ctx.lineTo(x, CH); }
  for (let m = 0; m <= scaleH; m += 1) { const y = m * pxPerMy; ctx.moveTo(0, y); ctx.lineTo(CW, y); }
  ctx.stroke();

  const ex = sortX(sec.points?.existing || []);
  const pr = sortX(sec.points?.proposed || []);

  // הצללת אזורי חפירה/מילוי בקווים אנכיים דקים
  if (ex.length >= 2 && pr.length >= 2) {
    const xMin = Math.max(ex[0].x, pr[0].x);
    const xMax = Math.min(ex[ex.length - 1].x, pr[pr.length - 1].x);
    const step = 2;
    for (let x = xMin; x <= xMax; x += step) {
      const ye = interpY(ex, x), yp = interpY(pr, x);
      if (ye == null || yp == null) continue;
      ctx.strokeStyle = yp > ye ? C_CUT : C_FILL;
      ctx.beginPath();
      ctx.moveTo(x, ye);
      ctx.lineTo(x, yp);
      ctx.stroke();
    }
  }

  drawPolyline(ctx, ex, C_EXIST, false);
  drawPolyline(ctx, pr, C_PROP, true);
}

function drawPolyline(ctx, pts, color, dashed) {
  if (!pts.length) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  if (dashed) ctx.setLineDash([5, 4]);
  ctx.beginPath();
  pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
  ctx.stroke();
  ctx.setLineDash([]);
  // נקודות
  ctx.fillStyle = color;
  pts.forEach(p => { ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill(); });
  ctx.restore();
}

// ── MAIN SCREEN ──────────────────────────────────────────────────────────────
export function renderCrossSection() {
  load();
  const body = document.getElementById('cs-body');
  if (!body) return;

  const { rows, spans, totCut, totFill } = computeVolumes();

  body.innerHTML = `
    <div class="card">
      <div class="card-title">פרטי הפרויקט</div>
      <div class="form-group">
        <label class="form-label">שם הפרויקט / ציר</label>
        <input type="text" class="form-input" id="cs-pname" placeholder="לדוגמה: כביש גישה ציר 1" value="${esc(S.project.name)}">
      </div>
      <div class="btn-row">
        <div class="form-group" style="flex:1;margin:0">
          <label class="form-label">קנה מידה — רוחב (מ׳)</label>
          <input type="number" class="form-input" id="cs-sw" min="1" step="1" value="${S.project.scaleW}">
        </div>
        <div class="form-group" style="flex:1;margin:0">
          <label class="form-label">קנה מידה — גובה (מ׳)</label>
          <input type="number" class="form-input" id="cs-sh" min="1" step="1" value="${S.project.scaleH}">
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-title" style="display:flex;justify-content:space-between;align-items:center">
        <span>סיכום נפחים</span>
        <span style="font-size:11px;color:var(--muted)">${S.sections.length} חתכים</span>
      </div>
      <div style="display:flex;gap:10px">
        <div style="flex:1;background:rgba(176,48,37,.08);border-radius:14px;padding:14px;text-align:center">
          <div style="font-size:26px;font-weight:800;color:${C_CUT_S}">${fmt(totCut)}</div>
          <div style="font-size:12px;color:var(--muted);margin-top:2px">חפירה מ״ק</div>
        </div>
        <div style="flex:1;background:rgba(46,109,164,.08);border-radius:14px;padding:14px;text-align:center">
          <div style="font-size:26px;font-weight:800;color:${C_FILL_S}">${fmt(totFill)}</div>
          <div style="font-size:12px;color:var(--muted);margin-top:2px">מילוי מ״ק</div>
        </div>
      </div>
      ${spans.length ? `<div style="margin-top:6px">${spans.map(spanRow).join('')}</div>` : ''}
    </div>

    <div class="card">
      <div class="card-title">חתכים</div>
      <div id="cs-list">${rows.length ? rows.map(r => sectionCard(r)).join('') : `<div class="muted" style="text-align:center;padding:20px 0">אין חתכים עדיין. הוסף חתך ראשון.</div>`}</div>
      <button class="btn btn-primary mt8" id="cs-add">➕ הוסף חתך</button>
    </div>
  `;

  // ציור תצוגות מקדימות
  rows.forEach(r => {
    const cv = body.querySelector(`canvas[data-prev="${r.sec.id}"]`);
    if (cv) drawSection(cv, r.sec, S.project.scaleW, S.project.scaleH);
  });

  // אירועים
  const onMeta = () => {
    S.project.name = document.getElementById('cs-pname').value;
    S.project.scaleW = Math.max(1, +document.getElementById('cs-sw').value || 20);
    S.project.scaleH = Math.max(1, +document.getElementById('cs-sh').value || 10);
    save();
  };
  document.getElementById('cs-pname').addEventListener('input', () => { S.project.name = document.getElementById('cs-pname').value; save(); });
  document.getElementById('cs-sw').addEventListener('change', () => { onMeta(); renderCrossSection(); });
  document.getElementById('cs-sh').addEventListener('change', () => { onMeta(); renderCrossSection(); });
  document.getElementById('cs-add').addEventListener('click', () => openEditor(null));

  body.querySelectorAll('[data-edit]').forEach(el =>
    el.addEventListener('click', () => openEditor(el.dataset.edit)));
}

function spanRow(s) {
  return `<div style="display:flex;justify-content:space-between;font-size:12px;padding:6px 0;border-bottom:1px solid var(--border)">
    <span style="color:var(--text)">${esc(s.from.name || 'חתך')} ← ${esc(s.to.name || 'חתך')}</span>
    <span style="color:var(--muted)">L=${fmt(s.L)}מ׳ · <b style="color:${C_CUT_S}">${fmt(s.vCut)}</b> / <b style="color:${C_FILL_S}">${fmt(s.vFill)}</b> מ״ק</span>
  </div>`;
}

function sectionCard(r) {
  const sec = r.sec;
  return `<div class="list-item clickable" data-edit="${sec.id}" style="align-items:flex-start;gap:12px;cursor:pointer">
    <canvas data-prev="${sec.id}" width="${CW}" height="${CH}" style="width:120px;height:74px;border-radius:8px;border:1px solid var(--border);flex-shrink:0;background:#FFFDF8"></canvas>
    <div style="flex:1;min-width:0">
      <div class="li-name">${esc(sec.name || 'חתך ללא שם')}</div>
      <div class="li-sub">${sec.station != null && sec.station !== '' ? 'תחנה ' + esc(String(sec.station)) + ' · ' : ''}מרחק לבא: ${fmt(+sec.dist || 0)} מ׳</div>
      <div style="font-size:12px;margin-top:4px">
        <span style="color:${C_CUT_S};font-weight:700">חפירה ${fmt(r.cut)}</span> ·
        <span style="color:${C_FILL_S};font-weight:700">מילוי ${fmt(r.fill)}</span> מ״ר
      </div>
    </div>
    <div style="color:var(--muted);font-size:20px">‹</div>
  </div>`;
}

// ── EDITOR ───────────────────────────────────────────────────────────────────
function findSec(id) { return S.sections.find(x => x.id === id); }

function openEditor(id) {
  editMode = 'existing';
  if (id) {
    editId = id;
  } else {
    const sec = { id: uid(), name: '', station: '', dist: 10, points: { existing: [], proposed: [] } };
    S.sections.push(sec);
    editId = sec.id;
    save();
  }
  renderEditor();
  const ov = document.getElementById('sh-csedit');
  if (ov) ov.style.display = '';
  openSheet('sh-csedit');
}

function closeEditor() {
  closeSheet('sh-csedit');
  const ov = document.getElementById('sh-csedit');
  setTimeout(() => { if (ov) ov.style.display = 'none'; }, 350);
  editId = null;
  renderCrossSection();
}

function renderEditor() {
  const sec = findSec(editId);
  const host = document.getElementById('sh-csedit-body');
  if (!sec || !host) return;
  const a = sectionAreas(sec, S.project.scaleW, S.project.scaleH);

  host.innerHTML = `
    <div class="sh-title">✏️ עריכת חתך</div>
    <div class="form-group">
      <label class="form-label">שם החתך</label>
      <input type="text" class="form-input" id="ed-name" placeholder="לדוגמה: חתך 1-1" value="${esc(sec.name)}">
    </div>
    <div class="btn-row">
      <div class="form-group" style="flex:1;margin:0">
        <label class="form-label">תחנה (אופציונלי)</label>
        <input type="text" class="form-input" id="ed-station" placeholder="0+00" value="${esc(String(sec.station ?? ''))}">
      </div>
      <div class="form-group" style="flex:1;margin:0">
        <label class="form-label">מרחק לחתך הבא (מ׳)</label>
        <input type="number" class="form-input" id="ed-dist" min="0" step="0.5" value="${+sec.dist || 0}">
      </div>
    </div>

    <div style="display:flex;gap:14px;align-items:center;justify-content:center;font-size:12px;color:var(--muted);margin:4px 0 8px">
      <span><span style="display:inline-block;width:14px;height:3px;background:${C_EXIST};vertical-align:middle"></span> קיים</span>
      <span><span style="display:inline-block;width:14px;height:3px;background:${C_PROP};vertical-align:middle;border-bottom:2px dashed ${C_PROP}"></span> מתוכנן</span>
      <span><span style="display:inline-block;width:12px;height:12px;background:${C_CUT};vertical-align:middle;border-radius:2px"></span> חפירה</span>
      <span><span style="display:inline-block;width:12px;height:12px;background:${C_FILL};vertical-align:middle;border-radius:2px"></span> מילוי</span>
    </div>

    <canvas id="ed-canvas" width="${CW}" height="${CH}"
      style="width:100%;height:auto;aspect-ratio:${CW}/${CH};border-radius:12px;border:1px solid var(--border);touch-action:none;display:block;background:#FFFDF8"></canvas>

    <div style="text-align:center;font-size:12px;color:var(--muted);margin-top:6px">
      קנה מידה: ${S.project.scaleW}מ׳ רוחב × ${S.project.scaleH}מ׳ גובה · שרטוט משמאל לימין
    </div>

    <div class="btn-row mt8">
      <button class="btn btn-sm ${editMode === 'existing' ? 'btn-primary' : 'btn-ghost'}" id="ed-mode-ex" style="flex:1">פרופיל קיים</button>
      <button class="btn btn-sm ${editMode === 'proposed' ? 'btn-primary' : 'btn-ghost'}" id="ed-mode-pr" style="flex:1">פרופיל מתוכנן</button>
    </div>
    <div class="btn-row mt8">
      <button class="btn btn-ghost btn-sm" id="ed-undo" style="flex:1">↶ בטל נקודה</button>
      <button class="btn btn-ghost btn-sm" id="ed-clear" style="flex:1">🗑 נקה פרופיל</button>
    </div>

    <div class="card mt12" style="margin-bottom:0;display:flex;gap:10px;text-align:center">
      <div style="flex:1"><div style="font-size:20px;font-weight:800;color:${C_CUT_S}">${fmt(a.cut)}</div><div style="font-size:11px;color:var(--muted)">חפירה מ״ר</div></div>
      <div style="flex:1"><div style="font-size:20px;font-weight:800;color:${C_FILL_S}">${fmt(a.fill)}</div><div style="font-size:11px;color:var(--muted)">מילוי מ״ר</div></div>
    </div>

    <button class="btn btn-primary mt12" id="ed-save">✓ שמור וסגור</button>
    <button class="btn btn-danger mt8" id="ed-del">מחק חתך</button>
  `;

  const canvas = document.getElementById('ed-canvas');
  drawSection(canvas, sec, S.project.scaleW, S.project.scaleH);

  // הוספת נקודה בלחיצה (משמאל לימין בלבד)
  const addPoint = (clientX, clientY) => {
    const rect = canvas.getBoundingClientRect();
    const x = Math.round((clientX - rect.left) / rect.width * CW);
    const y = Math.round((clientY - rect.top) / rect.height * CH);
    if (x < 0 || x > CW || y < 0 || y > CH) return;
    const arr = sec.points[editMode];
    const last = arr[arr.length - 1];
    if (last && x <= last.x) { toast('יש לשרטט משמאל לימין', 'err'); return; }
    arr.push({ x, y });
    save();
    drawSection(canvas, sec, S.project.scaleW, S.project.scaleH);
    refreshEditorAreas(sec);
  };
  canvas.addEventListener('pointerdown', e => { e.preventDefault(); addPoint(e.clientX, e.clientY); });

  // שדות טקסט
  document.getElementById('ed-name').addEventListener('input', e => { sec.name = e.target.value; save(); });
  document.getElementById('ed-station').addEventListener('input', e => { sec.station = e.target.value; save(); });
  document.getElementById('ed-dist').addEventListener('input', e => { sec.dist = +e.target.value || 0; save(); });

  document.getElementById('ed-mode-ex').addEventListener('click', () => { editMode = 'existing'; renderEditor(); });
  document.getElementById('ed-mode-pr').addEventListener('click', () => { editMode = 'proposed'; renderEditor(); });
  document.getElementById('ed-undo').addEventListener('click', () => {
    sec.points[editMode].pop(); save();
    drawSection(canvas, sec, S.project.scaleW, S.project.scaleH); refreshEditorAreas(sec);
  });
  document.getElementById('ed-clear').addEventListener('click', () => {
    sec.points[editMode] = []; save();
    drawSection(canvas, sec, S.project.scaleW, S.project.scaleH); refreshEditorAreas(sec);
  });
  document.getElementById('ed-save').addEventListener('click', closeEditor);
  document.getElementById('ed-del').addEventListener('click', () => {
    if (!confirm('למחוק את החתך?')) return;
    S.sections = S.sections.filter(x => x.id !== editId);
    save(); closeEditor();
  });
}

function refreshEditorAreas(sec) {
  const a = sectionAreas(sec, S.project.scaleW, S.project.scaleH);
  const host = document.getElementById('sh-csedit-body');
  const cards = host?.querySelectorAll('.card.mt12 div[style*="font-weight:800"]');
  if (cards && cards.length === 2) {
    cards[0].textContent = fmt(a.cut);
    cards[1].textContent = fmt(a.fill);
  }
}

// ── PDF EXPORT ───────────────────────────────────────────────────────────────
export function exportCrossSectionPDF() {
  load();
  if (!S.sections.length) { toast('אין חתכים לייצוא', 'err'); return; }
  const { rows, spans, totCut, totFill } = computeVolumes();
  const { scaleW, scaleH } = S.project;

  // צילום כל חתך לתמונה
  const imgs = rows.map(r => {
    const cv = document.createElement('canvas');
    cv.width = CW; cv.height = CH;
    drawSection(cv, r.sec, scaleW, scaleH);
    return cv.toDataURL('image/png');
  });

  const today = new Date().toLocaleDateString('he-IL');
  const secBlocks = rows.map((r, i) => `
    <div class="sec">
      <div class="sec-h">${esc(r.sec.name || 'חתך ' + (i + 1))}${r.sec.station ? ' · תחנה ' + esc(String(r.sec.station)) : ''}</div>
      <img src="${imgs[i]}" class="sec-img">
      <table class="mini"><tr>
        <td>שטח חפירה</td><td class="cut">${fmt(r.cut)} מ״ר</td>
        <td>שטח מילוי</td><td class="fill">${fmt(r.fill)} מ״ר</td>
        <td>מרחק לבא</td><td>${fmt(+r.sec.dist || 0)} מ׳</td>
      </tr></table>
    </div>`).join('');

  const volRows = spans.map(s => `<tr>
    <td>${esc(s.from.name || 'חתך')} ← ${esc(s.to.name || 'חתך')}</td>
    <td>${fmt(s.L)}</td>
    <td>${fmt((sectionAreas(s.from, scaleW, scaleH).cut))} / ${fmt(sectionAreas(s.to, scaleW, scaleH).cut)}</td>
    <td class="cut">${fmt(s.vCut)}</td>
    <td class="fill">${fmt(s.vFill)}</td>
  </tr>`).join('');

  const html = `<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="UTF-8">
  <link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;700;800&display=swap" rel="stylesheet">
  <style>
    *{font-family:'Heebo',sans-serif;box-sizing:border-box}
    body{margin:18px;direction:rtl;color:#1A1714;background:#fff;font-size:12px}
    .biz{color:#B8922C;font-size:13px;font-weight:800;text-align:center}
    h2{color:#B8922C;text-align:center;font-size:20px;margin:2px 0 2px;font-weight:800}
    .sub{color:#726E68;text-align:center;font-size:12px;margin-bottom:14px}
    .grid{display:flex;flex-wrap:wrap;gap:12px}
    .sec{width:calc(50% - 6px);border:1px solid rgba(184,146,44,.25);border-radius:10px;padding:8px;page-break-inside:avoid}
    .sec-h{font-weight:800;font-size:13px;margin-bottom:6px;color:#2C2620}
    .sec-img{width:100%;height:auto;border:1px solid #eee;border-radius:6px;background:#FFFDF8}
    table{width:100%;border-collapse:collapse;margin-top:8px}
    .mini td{padding:4px 5px;font-size:10px;border:1px solid rgba(184,146,44,.15);text-align:center}
    h3{color:#B8922C;margin:22px 0 6px;font-size:15px}
    .vol th{background:#B8922C;color:#fff;padding:8px 6px;font-size:11px}
    .vol td{padding:7px 6px;border-bottom:1px solid rgba(184,146,44,.12);font-size:11px;text-align:center}
    .vol tfoot td{background:#2C2620;color:#fff;font-weight:800}
    .cut{color:#B03025;font-weight:700}.fill{color:#2E6DA4;font-weight:700}
    @media print{body{margin:8px}@page{size:A4;margin:10mm}}
  </style></head><body>
    <div class="biz">כמויות חפירה ומילוי — חתכים</div>
    <h2>${esc(S.project.name || 'חישוב כמויות בחתכים')}</h2>
    <div class="sub">שיטת שטח קצה ממוצע (Average End Area) · קנה מידה ${scaleW}×${scaleH} מ׳ · ${today}</div>

    <h3>חתכים (${rows.length})</h3>
    <div class="grid">${secBlocks}</div>

    <h3>נפחים בין חתכים</h3>
    <table class="vol">
      <thead><tr><th>מקטע</th><th>אורך L (מ׳)</th><th>שטחי חפירה A1/A2 (מ״ר)</th><th>נפח חפירה (מ״ק)</th><th>נפח מילוי (מ״ק)</th></tr></thead>
      <tbody>${volRows || '<tr><td colspan="5">דרושים לפחות שני חתכים לחישוב נפח</td></tr>'}</tbody>
      <tfoot><tr><td colspan="3">סה״כ</td><td>${fmt(totCut)}</td><td>${fmt(totFill)}</td></tr></tfoot>
    </table>

    <div style="margin-top:26px;display:flex;gap:40px">
      <div style="flex:1;text-align:center"><div style="border-top:1px solid #2C2620;padding-top:4px;font-size:11px;color:#726E68">חתימת מכין החישוב</div></div>
      <div style="flex:1;text-align:center"><div style="border-top:1px solid #2C2620;padding-top:4px;font-size:11px;color:#726E68">בדיקת מהנדס</div></div>
    </div>
  </body></html>`;

  const w = window.open('', '_blank');
  if (!w) { toast('אפשר חלונות קופצים', 'err'); return; }
  w.document.write(html);
  w.document.close();
  setTimeout(() => w.print(), 700);
}

// ── HELPERS ──────────────────────────────────────────────────────────────────
function fmt(n) {
  if (n == null || isNaN(n)) return '0';
  return (Math.round((n + Number.EPSILON) * 100) / 100).toLocaleString('he-IL', { maximumFractionDigits: 2 });
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
