import { h, formModal, attempt, toast, confirmBox, dateLabel } from './dom.js';
import { pickFile, download, dataLocation, isDesktop, flush } from '../persist.js';
import { INDEX_SERIES } from '../schema.js';

export function settingsView(ctx) {
  const api = ctx.api;
  const co = api.company();
  const meta = (k) => api.s.get('SELECT value FROM meta WHERE key=?', [k])?.value ?? '';
  const setMeta = (k, v) => api.s.tx(() => api.s.run('INSERT INTO meta (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [k, v]));

  const loadDekel = async () => {
    const f = await pickFile('.db,.sqlite');
    if (!f) return;
    try {
      const d = await ctx.setDekel(f.bytes, f.name.replace(/\.(db|sqlite)$/i, ''));
      setMeta('dekel_label', d.label);
      toast(`נטען מחירון: ${d.items.length.toLocaleString()} סעיפים, ${d.chapters.size} פרקים`);
      ctx.refresh();
    } catch (e) { toast(e.message, 'err'); }
  };
  const backup = async () => {
    await flush();
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    download(`kayan-boq-backup-${stamp}.kayan`, api.s.export());
    setMeta('last_backup', new Date().toISOString());
    ctx.refresh();
  };
  const restore = async () => {
    const f = await pickFile('.kayan,.db,.sqlite');
    if (!f) return;
    if (!(await confirmBox('שחזור מגיבוי', 'כל הנתונים הנוכחיים יוחלפו בתוכן קובץ הגיבוי. מומלץ לגבות קודם. להמשיך?', { danger: true, ok: 'שחזור' }))) return;
    try {
      const { Store } = await import('../store.js');
      const { Api } = await import('../api.js');
      const { scheduleSave } = await import('../persist.js');
      const s = new Store(ctx.SQL, f.bytes, scheduleSave);
      s.get('SELECT COUNT(*) n FROM projects');
      ctx.store = s; ctx.api = new Api(s);
      scheduleSave(s.export());
      await flush();
      toast('הנתונים שוחזרו'); ctx.go('');
    } catch (e) { toast(`קובץ גיבוי לא תקין: ${e.message}`, 'err'); }
  };
  const lastBackup = meta('last_backup');
  const audit = api.audit(80);

  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('h1', {}, 'הגדרות')),
    h('div', { class: 'grid2' },
      h('div', { class: 'card' }, h('header', {}, h('h2', {}, 'פרטי החברה'), h('div', { class: 'actions' }, h('button', { onclick: () => formModal('פרטי החברה', [
        { name: 'name', label: 'שם', value: co.name, span: true }, { name: 'vat_id', label: 'ח.פ / ע.מ', value: co.vat_id },
        { name: 'phone', label: 'טלפון', value: co.phone }, { name: 'email', label: 'דוא"ל', value: co.email }, { name: 'address', label: 'כתובת', value: co.address, span: true },
      ], (v) => { api.saveCompany(v); ctx.refresh(); }) }, 'עריכה'))),
      h('div', { class: 'card-body' }, h('b', {}, co.name), h('div', { class: 'muted' }, [co.vat_id && `ח.פ ${co.vat_id}`, co.address, co.phone, co.email].filter(Boolean).join(' · ')),
        h('div', { style: { marginTop: '12px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' } },
          h('img', { src: co.logo || 'assets/kayan-logo.jpg', alt: 'לוגו', style: { maxHeight: '48px', maxWidth: '260px', border: '1px solid var(--line)', borderRadius: '6px', background: '#fff' } }),
          h('button', { class: 'sm', onclick: async () => { const f = await pickFile('.png,.jpg,.jpeg,.webp'); if (!f) return; const type = /\.png$/i.test(f.name) ? 'png' : /\.webp$/i.test(f.name) ? 'webp' : 'jpeg';
            let bin = ''; f.bytes.forEach((b) => { bin += String.fromCharCode(b); }); attempt(() => { api.saveCompany({ ...co, logo: `data:image/${type};base64,${btoa(bin)}` }); ctx.refresh(); }, 'הלוגו עודכן'); } }, 'החלפת לוגו'),
          co.logo ? h('button', { class: 'sm ghost', onclick: () => attempt(() => { api.saveCompany({ ...co, logo: null }); ctx.refresh(); }) }, 'לוגו ברירת מחדל') : null,
          h('select', { onchange: (e) => attempt(() => { api.saveCompany({ ...co, logo_mode: e.target.value }); }, 'נשמר') },
            h('option', { value: 'wide', selected: co.logo_mode !== 'corner' }, 'לוגו רחב בראש הדף'), h('option', { value: 'corner', selected: co.logo_mode === 'corner' }, 'לוגו בפינה + פרטי חברה'))))),

      h('div', { class: 'card' }, h('header', {}, h('h2', {}, 'מחירון דקל'), h('div', { class: 'actions' }, h('button', { class: 'primary', onclick: loadDekel }, ctx.dekel ? 'החלפת מחירון' : 'טעינת מחירון'))),
        h('div', { class: 'card-body' }, ctx.dekel
          ? h('div', {}, h('b', {}, meta('dekel_label') || 'מחירון דקל'), h('div', { class: 'muted' }, `${ctx.dekel.items.length.toLocaleString()} סעיפים · ${ctx.dekel.chapters.size} פרקים · ${ctx.dekel.subchapters.size} תתי-פרקים`))
          : h('div', { class: 'alert' }, 'לא נטען מחירון. בחר את קובץ dekel_pricelist.db.'),
        h('p', { class: 'muted', style: { fontSize: '12.5px' } }, 'המחירון נשמר במחשב זה בלבד ואינו חלק מהתוכנה. במעבר לשנת מחירון חדשה — טען את הקובץ החדש; סעיפים מקושרים שומרים את מחיר הייחוס שלהם, ובדיקת התמחור תציג הפרשים ותאפשר עדכון.'))),

      h('div', { class: 'card' }, h('header', {}, h('h2', {}, 'גיבוי ושחזור')),
        h('div', { class: 'card-body stack' },
          h('div', {}, h('div', { class: 'muted' }, 'מיקום הנתונים'), h('div', { style: { direction: 'ltr', textAlign: 'right', fontSize: '12.5px' } }, dataLocation())),
          isDesktop ? h('div', { class: 'muted', style: { fontSize: '12.5px' } }, 'בכל שמירה נשמרים עד 20 עותקי גיבוי אוטומטיים בתיקיית backups שליד קובץ הנתונים.') :
            h('div', { class: 'alert' }, 'בגרסת הדפדפן הנתונים שמורים בדפדפן בלבד. ניקוי נתוני גלישה ימחק אותם — גבה לקובץ באופן קבוע.'),
          h('div', {}, 'גיבוי אחרון לקובץ: ', h('b', {}, lastBackup ? dateLabel(lastBackup) : 'מעולם לא')),
          h('div', { style: { display: 'flex', gap: '8px' } }, h('button', { class: 'primary', onclick: backup }, 'גיבוי לקובץ'), h('button', { class: 'danger', onclick: restore }, 'שחזור מקובץ')))),

      h('div', { class: 'card' }, h('header', {}, h('h2', {}, 'הורדת מדדים מהלמ"ס'), h('div', { class: 'actions' }, h('button', { onclick: () => formModal('קודי מדד בלמ"ס', Object.entries(INDEX_SERIES).map(([k, l]) => (
          { name: k, label: l, value: meta(`cbs_code_${k}`), numeric: true })), (v) => { for (const [k, val] of Object.entries(v)) setMeta(`cbs_code_${k}`, val.trim()); toast('נשמר'); }, {
          intro: h('p', { class: 'muted' }, 'הקוד המספרי של המדד באתר הלמ"ס (מחירים ← מדדים). הקודים לא הוגדרו מראש כי לא ניתן היה לאמת אותם — העתק אותם מאתר הלמ"ס.') }) }, 'קודי מדד'))),
        h('div', { class: 'card-body muted', style: { fontSize: '12.5px' } }, isDesktop ? 'זמין בגרסת Windows. בגרסת הדפדפן — הדבקת ערכים במסך המדדים.' : 'ההורדה האוטומטית זמינה בגרסת Windows בלבד. כאן ניתן להדביק ערכים במסך המדדים.'))),

    h('div', { class: 'card', style: { marginTop: '16px' } }, h('header', {}, h('h2', {}, 'יומן פעולות'), h('span', { class: 'muted' }, '80 אחרונות')),
      h('div', { class: 'table-wrap', style: { maxHeight: '360px' } }, h('table', { class: 't' }, h('tbody', {}, audit.map((a) => h('tr', {}, h('td', { class: 'muted', style: { whiteSpace: 'nowrap' } }, new Date(a.at).toLocaleString('he-IL')), h('td', {}, a.action))))))));
}
