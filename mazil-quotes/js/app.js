import * as S from './store.js';
import { calc, lineCalc, fmt, num, isPriced, quoteNo, fmtDate, fmtTime, renderDoc, makePdf, pdfName, pdfFileName, fontsReady, PAGE_W, PAGE_H } from './doc.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const view = $('#view');

// ---------- shell ----------
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2200); }
function busy(on, txt) { $('#busy').classList.toggle('hidden', !on); if (txt) $('#busy-txt').textContent = txt; }
function setTop({ title, sub = S.settings().company, back = null, actions = '' }) {
  $('#top-title').textContent = title; $('#top-sub').textContent = sub;
  const b = $('#top-back'); b.classList.toggle('hidden', !back); b.onclick = back;
  $('#top-actions').innerHTML = actions;
}
function setTab(name) { $('#tabs').classList.toggle('hidden', !name); $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === name)); }
function openSheet(html) { $('#sheet-body').innerHTML = html; $('#sheet').classList.remove('hidden'); return $('#sheet-body'); }
function closeSheet() { $('#sheet').classList.add('hidden'); $('#sheet-body').innerHTML = ''; }
$('#sheet').addEventListener('click', e => { if (e.target.dataset.close != null) closeSheet(); });
$$('#tabs button').forEach(b => b.onclick = () => go(b.dataset.tab));
const money = n => `₪ ${fmt(n)}`;
const localDate = iso => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
function autoGrow(ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 2 + 'px'; }

let guard = null; // returns true if leaving the current view is OK
function go(name, arg) {
  if (guard && !guard()) return;
  guard = null; view.scrollTop = 0;
  ({ list: showList, catalog: showCatalog, settings: showSettings, edit: showEdit, preview: showPreview })[name](arg);
}

// ---------- quote list ----------
function showList() {
  setTab('list'); setTop({ title: 'הצעות מחיר' });
  const db = S.getDb();
  view.innerHTML = `
    <div class="search"><input class="inp" id="q-search" type="search" placeholder="חיפוש לפי לקוח, מספר או פריט…"></div>
    <div id="q-list"></div>
    <button class="fab" id="fab">+ הצעה חדשה</button>`;
  const draw = () => {
    const term = $('#q-search').value.trim();
    const qs = db.quotes.filter(q => !term || [quoteNo(q), q.customer.name, q.ref, ...q.items.map(i => i.desc)].join(' ').includes(term))
      .sort((a, b) => (b.no ?? 0) - (a.no ?? 0));
    $('#q-list').innerHTML = qs.length ? qs.map(q => `
      <button class="q-item" data-id="${q.id}">
        <div class="q-main"><div class="q-no">${esc(quoteNo(q))}</div><div class="q-name">${esc(q.customer.name || 'ללא שם לקוח')}</div>
        <div class="q-date">${fmtDate(q.createdAt)}${q.ref ? ` · מספרכם ${esc(q.ref)}` : ''}</div></div>
        <div class="q-sum">${money(calc(q).grand)}</div>
      </button>`).join('')
      : `<div class="empty">${term ? 'לא נמצאו הצעות' : '<b>עדיין אין הצעות</b>לחץ על "הצעה חדשה" כדי להתחיל'}</div>`;
    $$('.q-item').forEach(b => b.onclick = () => go('preview', b.dataset.id));
  };
  $('#q-search').oninput = draw; draw();
  $('#fab').onclick = () => go('edit', S.newQuote());
}

// ---------- editor ----------
function showEdit(q) {
  q = structuredClone(q);
  const isNew = q.no == null;
  let dirty = false;
  setTab(null);
  setTop({ title: isNew ? 'הצעה חדשה' : `עריכת ${quoteNo(q)}`, back: () => go(isNew ? 'list' : 'preview', isNew ? undefined : q.id) });
  guard = () => !dirty || confirm('יש שינויים שלא נשמרו. לצאת בלי לשמור?');

  const db = S.getDb();
  view.innerHTML = `
    <div class="card"><h3>תאריך המסמך</h3>
      <div class="grid2">
        <label class="field"><span>תאריך</span><input class="inp ltr" id="q-date" type="date" value="${localDate(q.createdAt)}"></label>
        <label class="field"><span>שעה</span><input class="inp ltr" id="q-time" type="time" value="${fmtTime(q.createdAt)}"></label>
      </div>
      <div class="row"><button class="btn ghost" id="q-now" style="padding:9px">עדכן להיום ולשעה הנוכחית</button></div>
    </div>
    <div class="card"><h3>לקוח</h3>
      <label class="field"><span>לכבוד</span><input class="inp" id="c-name" list="cust-list" autocomplete="off" value="${esc(q.customer.name)}"></label>
      <datalist id="cust-list">${db.customers.map(c => `<option value="${esc(c.name)}">`).join('')}</datalist>
      <div class="grid2">
        <label class="field"><span>טלפון</span><input class="inp ltr" id="c-phone" inputmode="tel" value="${esc(q.customer.phone)}"></label>
        <label class="field"><span>פקס</span><input class="inp ltr" id="c-fax" inputmode="tel" value="${esc(q.customer.fax)}"></label>
        <label class="field"><span>ע.מ. / ת.ז.</span><input class="inp ltr" id="c-tax" inputmode="numeric" value="${esc(q.customer.taxId)}"></label>
        <label class="field"><span>מספרכם</span><input class="inp ltr" id="q-ref" value="${esc(q.ref)}"></label>
      </div>
    </div>
    <div class="card"><h3>פריטים</h3>
      <div id="items"></div>
      <div class="row"><button class="btn ghost" id="add-item">+ פריט</button><button class="btn ghost" id="add-cat">+ מהמחירון</button></div>
      <p class="small mute" style="margin:10px 2px 0">כל שורה בתיאור = שורה במסמך. המחיר מודפס בשורה האחרונה. השאר כמות ריקה לשורת טקסט בלבד.</p>
    </div>
    <div class="card"><h3>סיכום</h3>
      <div class="grid2">
        <label class="field"><span>הנחה כללית %</span><input class="inp ltr" id="q-disc" inputmode="decimal" value="${esc(q.discount)}"></label>
        <label class="field"><span>מע"מ %</span><input class="inp ltr" id="q-vat" inputmode="decimal" value="${esc(q.vat)}"></label>
      </div>
      <label class="chk"><input type="checkbox" id="q-inc" ${q.vatIncluded ? 'checked' : ''}> המחירים כוללים מע"מ</label>
      <label class="chk"><input type="checkbox" id="q-round" ${q.roundTotal ? 'checked' : ''}> עגל סה"כ לתשלום לשקל שלם (דרך ההנחה)</label>
      <div class="tot" id="tot"></div>
    </div>
    <div class="card"><h3>פרטים נוספים</h3>
      <label class="field"><span>הערות (יודפסו מתחת לסיכום — אופציונלי)</span><textarea class="inp" id="q-notes" rows="2">${esc(q.notes)}</textarea></label>
      <label class="field"><span>מפיק המסמך</span><input class="inp" id="q-prod" value="${esc(q.producer)}"></label>
    </div>
    <div class="savebar"><div class="total"><small>סה"כ לתשלום</small><b id="sb-total"></b></div><button class="btn primary" id="save">שמור והפק</button></div>`;

  const bind = (id, fn) => { const el = $('#' + id); el.addEventListener('input', () => { fn(el.value); dirty = true; refresh(); }); };
  bind('c-name', v => {
    q.customer.name = v;
    const c = db.customers.find(x => x.name === v.trim());
    if (c) { Object.assign(q.customer, c); $('#c-phone').value = c.phone; $('#c-fax').value = c.fax; $('#c-tax').value = c.taxId; }
  });
  bind('c-phone', v => q.customer.phone = v);
  bind('c-fax', v => q.customer.fax = v);
  bind('c-tax', v => q.customer.taxId = v);
  bind('q-ref', v => q.ref = v);
  bind('q-disc', v => q.discount = v);
  bind('q-vat', v => q.vat = v);
  bind('q-notes', v => q.notes = v);
  bind('q-prod', v => q.producer = v);
  bind('q-date', v => {
    if (!v) return;
    const d = new Date(q.createdAt), [y, m, dd] = v.split('-').map(Number);
    d.setFullYear(y, m - 1, dd); q.createdAt = d.toISOString();
  });
  bind('q-time', v => {
    if (!v) return;
    const d = new Date(q.createdAt), [h, mi] = v.split(':').map(Number);
    d.setHours(h, mi, 0, 0); q.createdAt = d.toISOString();
  });
  $('#q-now').onclick = () => {
    const d = new Date(); d.setSeconds(0, 0); q.createdAt = d.toISOString(); dirty = true;
    $('#q-date').value = localDate(q.createdAt); $('#q-time').value = fmtTime(q.createdAt);
  };
  $('#q-inc').onchange = e => { q.vatIncluded = e.target.checked; dirty = true; drawItems(); };
  $('#q-round').onchange = e => { q.roundTotal = e.target.checked; dirty = true; refresh(); };
  autoGrow($('#q-notes'));

  function refresh() {
    const t = calc(q);
    $('#tot').innerHTML = t.inc ? `
      <span>סה"כ כולל מע"מ</span><b>${fmt(t.sub)}</b>
      ${t.discAmt ? `<span>הנחה ${fmt(t.discPct)}%${t.roundAdj ? ` <small class="mute">(כולל עיגול ${fmt(t.roundAdj)})</small>` : ''}</span><b>-${fmt(t.discAmt)}</b>` : ''}
      <span class="grand">סה"כ לתשלום</span><b class="grand">${money(t.grand)}</b>
      <span class="small mute">מתוכו: ללא מע"מ</span><b class="small mute">${fmt(t.after)}</b>
      <span class="small mute">מע"מ ${fmt(t.vatPct)}%</span><b class="small mute">${fmt(t.vat)}</b>` : `
      <span>סה"כ ללא מע"מ</span><b>${fmt(t.sub)}</b>
      ${t.discAmt ? `<span>הנחה ${fmt(t.discPct)}%${t.roundAdj ? ` <small class="mute">(כולל עיגול ${fmt(t.roundAdj)})</small>` : ''}</span><b>-${fmt(t.discAmt)}</b><span>לאחר הנחה</span><b>${fmt(t.after)}</b>` : ''}
      <span>מע"מ ${fmt(t.vatPct)}%</span><b>${fmt(t.vat)}</b>
      <span class="grand">סה"כ לתשלום</span><b class="grand">${money(t.grand)}</b>`;
    $('#sb-total').textContent = money(t.grand);
    $$('#items .it').forEach((el, i) => {
      const it = q.items[i]; if (!it) return;
      el.classList.toggle('text-only', !isPriced(it));
      $('.it-total b', el).textContent = fmt(lineCalc(it).total);
    });
  }

  function drawItems() {
    $('#items').innerHTML = q.items.map((it, i) => `
      <div class="it" data-i="${i}">
        <div class="it-head"><span class="it-n">פריט ${i + 1}</span>
          <button class="it-tool" data-a="up" aria-label="למעלה">↑</button><button class="it-tool" data-a="down" aria-label="למטה">↓</button>
          <button class="it-tool" data-a="dup" aria-label="שכפל">⧉</button><button class="it-tool" data-a="star" aria-label="שמור למחירון">☆</button>
          <button class="it-tool del" data-a="del" aria-label="מחק">✕</button></div>
        <textarea class="inp" data-f="desc" rows="2" placeholder="תאור פריט">${esc(it.desc)}</textarea>
        <div class="grid4" style="margin-top:8px">
          <label class="field"><span>כמות</span><input class="inp ltr" data-f="qty" inputmode="decimal" value="${esc(it.qty)}"></label>
          <label class="field"><span>${q.vatIncluded ? 'מחיר כולל מע"מ' : 'מחיר ליחידה'}</span><input class="inp ltr" data-f="price" inputmode="decimal" value="${esc(it.price)}"></label>
          <label class="field"><span>הנחה %</span><input class="inp ltr" data-f="disc" inputmode="decimal" value="${esc(it.disc)}"></label>
          <label class="field"><span>מק"ט</span><input class="inp ltr" data-f="code" value="${esc(it.code)}"></label>
        </div>
        <div class="it-total"><span>${q.vatIncluded ? 'סה"כ כולל מע"מ' : 'סה"כ נטו'}</span><b></b></div>
      </div>`).join('') || '<p class="mute small">אין פריטים</p>';
    $$('#items textarea').forEach(autoGrow);
    refresh();
  }

  $('#items').addEventListener('input', e => {
    const f = e.target.dataset.f; if (!f) return;
    q.items[+e.target.closest('.it').dataset.i][f] = e.target.value; dirty = true;
    if (e.target.tagName === 'TEXTAREA') autoGrow(e.target);
    refresh();
  });
  $('#items').addEventListener('click', e => {
    const a = e.target.dataset.a; if (!a) return;
    const i = +e.target.closest('.it').dataset.i, it = q.items[i];
    if (a === 'del') { if (!confirm('למחוק את הפריט?')) return; q.items.splice(i, 1); }
    if (a === 'dup') q.items.splice(i + 1, 0, structuredClone(it));
    if (a === 'up' && i > 0) [q.items[i - 1], q.items[i]] = [q.items[i], q.items[i - 1]];
    if (a === 'down' && i < q.items.length - 1) [q.items[i + 1], q.items[i]] = [q.items[i], q.items[i + 1]];
    if (a === 'star') {
      if (!it.desc.trim()) return toast('אין תיאור לשמירה');
      S.saveCatalogItem({ code: it.code, desc: it.desc, price: it.price }); return toast('נשמר במחירון');
    }
    dirty = true; drawItems();
  });
  $('#add-item').onclick = () => { q.items.push({ code: '0', desc: '', qty: '1', price: '', disc: '0' }); dirty = true; drawItems(); $$('#items textarea').at(-1).focus(); };
  $('#add-cat').onclick = () => pickFromCatalog(c => { q.items.push({ code: c.code || '0', desc: c.desc, qty: '1', price: String(c.price ?? ''), disc: '0' }); dirty = true; drawItems(); });
  $('#save').onclick = () => {
    if (!q.customer.name.trim()) { toast('חסר שם לקוח'); $('#c-name').focus(); return; }
    if (!q.items.some(isPriced)) { toast('אין אף פריט עם כמות'); return; }
    q.items.forEach(it => { it.desc = it.desc.replace(/\s+$/, ''); });
    if (!S.upsertQuote(q)) return;
    dirty = false; toast(`נשמרה הצעה ${quoteNo(q)}`); go('preview', q.id);
  };
  drawItems();
}

function pickFromCatalog(onPick) {
  const cat = S.getDb().catalog;
  const body = openSheet(`<h2>הוסף מהמחירון</h2>
    <input class="inp" id="cat-s" type="search" placeholder="חיפוש…" style="margin-bottom:10px">
    <div id="cat-l"></div>`);
  const draw = () => {
    const t = $('#cat-s', body).value.trim();
    const list = cat.filter(c => !t || c.desc.includes(t) || String(c.code).includes(t));
    $('#cat-l', body).innerHTML = list.length ? list.map(c => catRow(c)).join('') : '<div class="empty">המחירון ריק. שמור פריט עם ☆ או הוסף בלשונית "מחירון".</div>';
    $$('.cat-item', body).forEach(b => b.onclick = () => { onPick(cat.find(c => c.id === b.dataset.id)); closeSheet(); toast('נוסף'); });
  };
  $('#cat-s', body).oninput = draw; draw();
}
const catRow = c => {
  const [first, ...rest] = c.desc.split('\n');
  return `<button class="cat-item" data-id="${c.id}"><div class="cat-desc"><b>${esc(first)}</b>${esc(rest.join('\n'))}</div><div class="cat-price">${c.price !== '' ? fmt(num(c.price)) : ''}</div></button>`;
};

// ---------- preview / share ----------
let pdfJob = null; // { key, promise }
function pdfFor(q) {
  const key = JSON.stringify(q) + JSON.stringify(S.settings());
  if (!pdfJob || pdfJob.key !== key) pdfJob = { key, promise: waitLibs().then(() => makePdf(q, S.settings(), $('#pdf-host'))) };
  return pdfJob.promise;
}
async function waitLibs() { for (let i = 0; i < 100 && !(window.jspdf && window.html2canvas); i++) await new Promise(r => setTimeout(r, 50)); }

function showPreview(id) {
  const q = S.getQuote(id); if (!q) return go('list');
  setTab(null);
  setTop({ title: `הצעה ${quoteNo(q)}`, sub: q.customer.name, back: () => go('list') });
  view.innerHTML = `
    <div class="pv-actions">
      <button class="btn primary wide" id="pv-share">שתף PDF (וואטסאפ / מייל)</button>
      <button class="btn blue" id="pv-dl">הורד PDF</button>
      <button class="btn" id="pv-edit">ערוך</button>
      <button class="btn" id="pv-dup">שכפל להצעה חדשה</button>
      <div class="seg" id="pv-copy"><button data-v="מקור">מקור</button><button data-v="העתק">העתק</button></div>
    </div>
    <div class="pv-pages" id="pv-pages"></div>
    <div style="margin-top:16px"><button class="btn danger" id="pv-del" style="width:100%">מחק הצעה</button></div>`;

  const draw = async () => {
    await fontsReady();
    const pages = renderDoc(q, S.settings(), $('#measure-host'));
    const w = Math.min(view.clientWidth - 28, PAGE_W), sc = w / PAGE_W;
    const box = $('#pv-pages'); box.innerHTML = '';
    for (const p of pages) {
      const wrap = document.createElement('div'); wrap.className = 'pv-wrap';
      wrap.style.width = w + 'px'; wrap.style.height = PAGE_H * sc + 'px';
      p.style.transform = `scale(${sc})`; wrap.appendChild(p); box.appendChild(wrap);
    }
    $$('#pv-copy button').forEach(b => b.classList.toggle('on', b.dataset.v === (q.copyType || 'מקור')));
    pdfFor(q).catch(e => console.error(e)); // warm up so "share" stays inside the tap gesture
  };
  draw();
  window.onresize = () => { if ($('#pv-pages')) draw(); };

  const getBlob = async () => {
    const pending = pdfFor(q);
    let done = false; pending.finally(() => done = true);
    await new Promise(r => setTimeout(r, 0));
    if (!done) busy(true, 'מייצר PDF…');
    try { return await pending; } finally { busy(false); }
  };
  $('#pv-dl').onclick = async () => {
    try { download(await getBlob(), pdfFileName(q)); } catch (e) { alert('יצירת PDF נכשלה: ' + e.message); }
  };
  $('#pv-share').onclick = async () => {
    let blob; try { blob = await getBlob(); } catch (e) { return alert('יצירת PDF נכשלה: ' + e.message); }
    const file = new File([blob], pdfName(q), { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: `הצעת מחיר ${quoteNo(q)}` }); }
      catch (e) { if (e.name === 'NotAllowedError') toast('ה-PDF מוכן — לחץ שוב על שתף'); else if (e.name !== 'AbortError') alert(e.message); }
    } else { download(blob, pdfFileName(q)); toast('המכשיר לא תומך בשיתוף — הקובץ הורד'); }
  };
  $('#pv-edit').onclick = () => go('edit', q);
  $('#pv-dup').onclick = () => go('edit', S.duplicateQuote(q));
  $('#pv-del').onclick = () => { if (confirm(`למחוק את הצעה ${quoteNo(q)}? לא ניתן לשחזר.`)) { S.deleteQuote(q.id); toast('נמחקה'); go('list'); } };
  $$('#pv-copy button').forEach(b => b.onclick = () => { q.copyType = b.dataset.v; S.save(); draw(); });
}

function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

// ---------- catalog ----------
function showCatalog() {
  setTab('catalog'); setTop({ title: 'מחירון פריטים' });
  const draw = () => {
    const cat = S.getDb().catalog;
    view.innerHTML = `<div id="cl">${cat.length ? cat.map(catRow).join('') : '<div class="empty"><b>המחירון ריק</b>פריטים קבועים נכנסים להצעה בלחיצה אחת</div>'}</div>
      <button class="fab" id="fab">+ פריט למחירון</button>`;
    $$('.cat-item').forEach(b => b.onclick = () => editCat(cat.find(c => c.id === b.dataset.id)));
    $('#fab').onclick = () => editCat({ code: '0', desc: '', price: '' });
  };
  const editCat = c => {
    const body = openSheet(`<h2>${c.id ? 'עריכת פריט' : 'פריט חדש'}</h2>
      <label class="field"><span>תאור (כל שורה = שורה במסמך)</span><textarea class="inp" id="e-desc" rows="4">${esc(c.desc)}</textarea></label>
      <div class="grid2"><label class="field"><span>מחיר ליחידה</span><input class="inp ltr" id="e-price" inputmode="decimal" value="${esc(c.price)}"></label>
      <label class="field"><span>מק"ט</span><input class="inp ltr" id="e-code" value="${esc(c.code)}"></label></div>
      <div class="row"><button class="btn primary" id="e-save">שמור</button>${c.id ? '<button class="btn danger" id="e-del">מחק</button>' : ''}</div>`);
    const ta = $('#e-desc', body); autoGrow(ta); ta.oninput = () => autoGrow(ta);
    $('#e-save', body).onclick = () => {
      const desc = ta.value.replace(/\s+$/, ''); if (!desc) return toast('חסר תיאור');
      S.saveCatalogItem({ ...c, desc, price: $('#e-price', body).value, code: $('#e-code', body).value || '0' }); closeSheet(); draw();
    };
    if (c.id) $('#e-del', body).onclick = () => { if (confirm('למחוק מהמחירון?')) { S.deleteCatalogItem(c.id); closeSheet(); draw(); } };
  };
  draw();
}

// ---------- settings ----------
function showSettings() {
  setTab('settings'); setTop({ title: 'הגדרות' });
  const s = S.settings();
  view.innerHTML = `
    <div class="card"><h3>מספור הצעות</h3>
      <div class="grid2">
        <label class="field"><span>קידומת</span><input class="inp ltr" id="s-prefix" value="${esc(s.prefix)}"></label>
        <label class="field"><span>המספר הבא</span><input class="inp ltr" id="s-next" inputmode="numeric" value="${esc(s.nextNo)}"></label>
      </div>
      <p class="small mute" style="margin:0">ההצעה הבאה תקבל: <b class="ltr" id="s-sample"></b>. אם התוכנה במשרד ממשיכה להפיק הצעות, הגדר כאן סדרה נפרדת (קידומת אחרת) כדי שלא ייווצרו שני מסמכים עם אותו מספר.</p>
    </div>
    <div class="card"><h3>פרטי העסק</h3>
      <label class="field"><span>שם החברה (חתימה)</span><input class="inp" id="s-company" value="${esc(s.company)}"></label>
      <div class="grid2">
        <label class="field"><span>עוסק מורשה</span><input class="inp ltr" id="s-osek" inputmode="numeric" value="${esc(s.osek)}"></label>
        <label class="field"><span>מע"מ ברירת מחדל %</span><input class="inp ltr" id="s-vat" inputmode="decimal" value="${esc(s.vat)}"></label>
      </div>
      <label class="chk"><input type="checkbox" id="s-inc" ${s.vatIncluded ? 'checked' : ''}> הצעות חדשות: מחירים כוללים מע"מ</label>
      <label class="field"><span>מפיק המסמך (ברירת מחדל)</span><input class="inp" id="s-producer" value="${esc(s.producer)}"></label>
    </div>
    <div class="card"><h3>לוגו / כותרת המסמך</h3>
      <img class="hdr-prev" id="s-hdr" src="${esc(s.headerImg || 'assets/header.jpg')}" alt="">
      <div class="row"><label class="btn" style="text-align:center">החלף תמונה<input type="file" id="s-hdr-file" accept="image/*" hidden></label>
      <button class="btn" id="s-hdr-reset">ברירת מחדל</button></div>
    </div>
    <div class="card"><h3>גיבוי</h3>
      <p class="small mute" style="margin:0 0 10px">הנתונים נשמרים רק בטלפון הזה. מומלץ לגבות פעם בשבוע ולשמור את הקובץ בוואטסאפ/דרייב.</p>
      <div class="row"><button class="btn blue" id="s-export">ייצוא גיבוי</button><label class="btn" style="text-align:center">שחזור מגיבוי<input type="file" id="s-import" accept=".json,application/json" hidden></label></div>
      <p class="small mute" style="margin:10px 0 0" id="s-stats"></p>
    </div>`;
  const db = S.getDb();
  $('#s-stats').textContent = `${db.quotes.length} הצעות · ${db.customers.length} לקוחות · ${db.catalog.length} פריטים במחירון`;
  const sample = () => $('#s-sample').textContent = `${s.prefix}/${String(s.nextNo).padStart(6, '0')}`;
  const map = { 's-prefix': 'prefix', 's-company': 'company', 's-osek': 'osek', 's-producer': 'producer' };
  for (const [id, k] of Object.entries(map)) $('#' + id).oninput = e => { s[k] = e.target.value; S.save(); sample(); };
  $('#s-next').oninput = e => { const n = parseInt(e.target.value, 10); if (n > 0) { s.nextNo = n; S.save(); sample(); } };
  $('#s-inc').onchange = e => { s.vatIncluded = e.target.checked; S.save(); };
  $('#s-vat').oninput = e => { s.vat = num(e.target.value); S.save(); };
  sample();
  $('#s-hdr-file').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    s.headerImg = await resizeImage(f, 1600); S.save(); $('#s-hdr').src = s.headerImg; toast('הכותרת עודכנה');
  };
  $('#s-hdr-reset').onclick = () => { s.headerImg = ''; S.save(); $('#s-hdr').src = 'assets/header.jpg'; };
  $('#s-export').onclick = async () => {
    const name = `quotes-backup-${new Date().toISOString().slice(0, 10)}.json`;
    const file = new File([S.exportJson()], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    download(file, name);
  };
  $('#s-import').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    if (!confirm('השחזור יחליף את כל הנתונים בטלפון הזה. להמשיך?')) return;
    try { S.importJson(await f.text()); toast('השחזור הושלם'); showSettings(); } catch (err) { alert('שחזור נכשל: ' + err.message); }
  };
}

function resizeImage(file, maxW) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const sc = Math.min(1, maxW / img.width), c = document.createElement('canvas');
      c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src); res(c.toDataURL('image/jpeg', 0.9));
    };
    img.onerror = rej; img.src = URL.createObjectURL(file);
  });
}

// ---------- boot ----------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => { });
go('list');
