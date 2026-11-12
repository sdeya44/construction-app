import { h, formModal, modal, attempt, toast, confirmBox, monthLabel } from './dom.js';
import { INDEX_SERIES } from '../schema.js';

/** Accepts lines like "01/2026 133.9", "2026-01\t133.9", "ינואר 2026 133.9" is not supported. */
export function parseIndexPaste(text) {
  const out = [], bad = [];
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim();
    if (!l) continue;
    let m = l.match(/^(\d{4})[-/.](\d{1,2})\s*[\t ,;]\s*([\d.,]+)/) ?? null;
    let y, mo, v;
    if (m) [, y, mo, v] = m;
    else if ((m = l.match(/^(\d{1,2})[-/.](\d{4})\s*[\t ,;]\s*([\d.,]+)/))) [, mo, y, v] = m;
    if (!m) { bad.push(l); continue; }
    out.push({ month: `${y}-${String(mo).padStart(2, '0')}`, value: v.replace(/,/g, '') });
  }
  return { rows: out, bad };
}

export function indicesView(ctx) {
  const api = ctx.api;
  let series = sessionStorage.getItem('idx-series') || 'residential';
  const body = h('div');
  const draw = () => {
    const list = api.indices(series);
    const used = api.s.all(`SELECT name, index_base_month, index_rule FROM contracts WHERE index_series=? AND index_rule NOT IN ('none','manual')`, [series]);
    body.replaceChildren(
      h('div', { class: 'card' },
        h('header', {}, h('div', { style: { display: 'flex', gap: '6px' } }, Object.entries(INDEX_SERIES).map(([k, l]) =>
          h('button', { class: k === series ? 'primary' : '', onclick: () => { series = k; sessionStorage.setItem('idx-series', k); draw(); } }, l))),
        h('div', { class: 'actions' },
          h('button', { onclick: () => edit() }, '+ ערך'),
          h('button', { onclick: paste }, 'הדבקת טבלה'),
          ctx.native?.fetchCbs || globalThis.kayanNative?.fetchCbs ? h('button', { onclick: download }, 'עדכון מהלמ"ס') : null)),
        used.length ? h('div', { class: 'card-body muted', style: { fontSize: '12.5px' } }, `בשימוש בחוזים: ${used.map((u) => `${u.name} (בסיס ${monthLabel(u.index_base_month)})`).join(' · ')}`) : null,
        list.length ? h('div', { class: 'table-wrap' }, h('table', { class: 't' },
          h('thead', {}, h('tr', {}, h('th', {}, 'חודש'), h('th', { class: 'n' }, 'ערך'), h('th', {}, 'מקור'), h('th', {}, ''))),
          h('tbody', {}, list.map((r) => h('tr', {}, h('td', {}, monthLabel(r.month)), h('td', { class: 'n' }, r.value), h('td', { class: 'muted' }, r.source === 'cbs' ? 'למ"ס' : 'ידני'),
            h('td', {}, h('button', { class: 'ghost sm', onclick: () => edit(r) }, 'עריכה'),
              h('button', { class: 'ghost sm danger', onclick: async () => { if (await confirmBox('מחיקת ערך', `למחוק את ${monthLabel(r.month)}?`, { danger: true })) attempt(() => { api.deleteIndex(series, r.month); draw(); }); } }, 'מחיקה')))))))
          : h('div', { class: 'empty' }, h('b', {}, 'אין ערכים'), 'הזן ידנית או הדבק טבלה מאתר הלמ"ס.')));
  };
  const edit = (r) => formModal(r ? 'עריכת ערך מדד' : 'ערך מדד חדש', [
    { name: 'month', label: 'חודש', type: 'month', value: r?.month ?? new Date().toISOString().slice(0, 7), required: true },
    { name: 'value', label: 'ערך', value: r?.value ?? '', numeric: true, required: true },
  ], (v) => { api.setIndex(series, v.month, v.value); draw(); });
  const paste = () => {
    const ta = h('textarea', { rows: 12, style: { width: '100%', direction: 'ltr', fontFamily: 'monospace' }, placeholder: '01/2026\t133.9\n02/2026\t134.2' });
    modal(`הדבקת ערכי ${INDEX_SERIES[series]}`, [h('p', { class: 'muted' }, 'כל שורה: חודש (MM/YYYY או YYYY-MM) ואחריו הערך. ניתן להעתיק עמודות מטבלת הלמ"ס.'), ta], {
      actions: [{ label: 'ביטול' }, { label: 'שמירה', primary: true, onClick: () => {
        const { rows, bad } = parseIndexPaste(ta.value);
        if (!rows.length) { toast('לא זוהו ערכים', 'err'); return false; }
        const ok = attempt(() => api.s.tx(() => rows.forEach((r) => api.setIndex(series, r.month, r.value)), `עדכון ${rows.length} ערכי מדד`));
        if (ok === undefined) return false;
        toast(`נשמרו ${rows.length} ערכים${bad.length ? `, ${bad.length} שורות לא זוהו` : ''}`);
        draw();
      } }],
    });
  };
  const download = async () => {
    const code = api.s.get('SELECT value FROM meta WHERE key=?', [`cbs_code_${series}`])?.value;
    if (!code) { toast('הגדר קוד מדד למ"ס בהגדרות (לא הוגדר מראש — יש לאמת את הקוד באתר הלמ"ס)', 'err'); return; }
    try {
      const rows = await globalThis.kayanNative.fetchCbs(code);
      if (!rows.length) throw new Error('לא התקבלו ערכים');
      api.s.tx(() => rows.forEach((r) => api.setIndex(series, r.month, r.value, 'cbs')), `הורדת ${rows.length} ערכי מדד`);
      toast(`עודכנו ${rows.length} ערכים`); draw();
    } catch (e) { toast(`ההורדה נכשלה: ${e.message}. ניתן להדביק ערכים ידנית.`, 'err'); }
  };
  draw();
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'מדדים'), h('div', { class: 'sub' }, 'ערכי מדד לחישוב התייקרות. חשבון מאושר שומר את הערכים שבהם חושב.'))),
    body);
}
