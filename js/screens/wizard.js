import { D, loadAll } from '../state.js';
import { uid, todayStr, fmtDate, toast, can, go, setBtn, isLocked } from '../utils.js';
import { sRead, sAppend, rebuildTab, checkLogVersion, logAudit } from '../api.js';
import { uploadWizPhotos } from './photos.js';
import { renderDash } from './dashboard.js';
import { filterLogs } from './logs.js';
import { getGroupsForSite, saveGroup, deleteGroup } from '../groups.js';

const WSTEPS = [
  { t:'אתר ותאריך',     s:'1/5' },
  { t:'פעילויות',        s:'2/5' },
  { t:'עובדים נוכחים',   s:'3/5' },
  { t:'ציוד בשטח',       s:'4/5' },
  { t:'אספקות והערות',   s:'5/5' },
];

const ACT_KEYS = ['dig','base','form','cast','strip'];

function getAvailableSites() {
  const active = D.sites.filter(s => s.status === 'פעיל');
  if (D.role === 'SiteManager') {
    const assigned = new Set(D.siteAssignments.filter(a => a.email === D.user?.email).map(a => a.siteId));
    return active.filter(s => assigned.has(s.id));
  }
  return active;
}

function initWiz(overrides = {}) {
  D.wiz = { step:1, date:todayStr(), siteId:'', acts:[], note:'', gNote:'', emps:[], equip:[], dels:[], photos:[], editMode:false, dayOff:false, dayOffReason:'', ...overrides };
}

export function startLog() {
  if (!can('create_log')) { toast('אין הרשאה ליצור יומן','err'); return; }
  if (!D.isOnline) { toast('אין חיבור לאינטרנט — לא ניתן לשמור דיווח','err'); return; }
  if (!getAvailableSites().length) { toast('אין אתרים פעילים זמינים','err'); go('sites'); return; }
  initWiz();
  drawWiz(); go('newlog');
}

export function startLogForSite(siteId) {
  if (!can('create_log')) { toast('אין הרשאה ליצור יומן','err'); return; }
  if (!D.isOnline) { toast('אין חיבור לאינטרנט — לא ניתן לשמור דיווח','err'); return; }
  initWiz({ siteId });
  drawWiz(); go('newlog');
}

export function startQuickLog(siteId = '') {
  if (!can('create_log')) { toast('אין הרשאה ליצור יומן','err'); return; }
  if (!D.isOnline) { toast('אין חיבור לאינטרנט — לא ניתן לשמור דיווח','err'); return; }
  if (!getAvailableSites().length) { toast('אין אתרים פעילים זמינים','err'); go('sites'); return; }
  initWiz({ siteId, quickMode:true });
  drawWiz(); go('newlog');
}

export function editLog(id) {
  const log = D.logs.find(l => l.id === id); if (!log) return;
  if (isLocked(log.date)) { toast('חודש נעול – אי אפשר לערוך','err'); return; }
  if (!can('edit_log'))   { toast('אין הרשאה לעריכה','err'); return; }
  const att  = D.attendance.filter(a => a.logId===id).map(a => a.empId);
  const eq   = D.logEquip.filter(e => e.logId===id).map(e => e.eqId);
  const dels = D.deliveries.filter(d => d.logId===id).map(d => ({ suppId:d.suppId, suppName:d.suppName, material:d.material, qty:d.qty }));
  const acts = ACT_KEYS.filter(k => log[k]);
  const isDayOff = (log.other||'').startsWith('יום חופש:');
  D.wiz = { step:1, date:log.date, siteId:log.siteId, acts, note:isDayOff ? '' : (log.other||''), gNote:log.notes||'',
            emps:att, equip:eq, dels, editLogId:id, editVersion:log.version||1, editMode:true, photos:[],
            dayOff:isDayOff, dayOffReason:isDayOff ? log.other.replace('יום חופש: ','') : '' };
  drawWiz(); go('newlog');
}

export function drawWiz() {
  const w = D.wiz;
  const isQuick = !!w.quickMode;

  let dots, stepTitle, stepSub, isLastStep;
  if (isQuick) {
    const qIdx = w.step === 1 ? 0 : 1;
    dots = [0,1].map(j => `<div class="step-dot ${j<qIdx?'done':j===qIdx?'active':''}"></div>`).join('');
    stepTitle = w.step === 1 ? 'אתר ותאריך' : 'עובדים נוכחים';
    stepSub   = `שלב ${qIdx+1}/2 · ⚡ מהיר`;
    isLastStep = w.step === 3;
  } else {
    const i = w.step - 1, st = WSTEPS[i];
    dots = WSTEPS.map((_,j) => `<div class="step-dot ${j<i?'done':j===i?'active':''}"></div>`).join('');
    stepTitle = st.t; stepSub = `שלב ${st.s}`;
    isLastStep = w.step === 5;
  }

  let body = '';
  if (w.step===1) body = wiz1();
  if (w.step===2 && !isQuick) body = wiz2();
  if (w.step===3) body = wiz3();
  if (w.step===4 && !isQuick) body = wiz4();
  if (w.step===5 && !isQuick) body = wiz5();

  const btnText = isLastStep
    ? (w.editMode ? '💾 עדכן יומן' : isQuick ? '⚡ שמור מהיר' : '💾 שמור דיווח')
    : 'המשך →';

  document.getElementById('s-newlog').innerHTML = `
    <div class="step-hdr">
      <div class="step-prog">${dots}</div>
      <div class="step-title">${stepTitle}</div>
      <div class="step-sub">${stepSub}</div>
    </div>
    <div class="scroll">${body}</div>
    <div class="step-ftr">
      <button class="btn btn-ghost" style="width:auto;padding:14px 20px" id="wiz-back">
        ${w.step===1 ? '✕ ביטול' : '← חזור'}
      </button>
      <button class="btn btn-primary fg" id="wiz-btn">${btnText}</button>
    </div>`;

  document.getElementById('wiz-back').onclick = () => {
    if (w.step === 1) { D.wiz = {}; go(w.editMode ? 'logs' : 'dash'); }
    else if (isQuick && w.step === 3) { w.step = 1; drawWiz(); }
    else { w.step--; drawWiz(); }
  };
  document.getElementById('wiz-btn').onclick = () => { if (isLastStep) saveLog(); else wizNext(); };
  bindWizStep(w.step);
}

function bindWizStep(step) {
  if (step === 1) {
    document.getElementById('w-date')?.addEventListener('change', e => { D.wiz.date = e.target.value; });
    document.getElementById('w-site')?.addEventListener('change', e => { D.wiz.siteId = e.target.value; });
    document.getElementById('wiz-copy-btn')?.addEventListener('click', copyYesterday);
    document.getElementById('wiz-quick-toggle')?.addEventListener('click', () => { D.wiz.quickMode = !D.wiz.quickMode; drawWiz(); });
  }
  if (step === 2) {
    document.getElementById('btn-copy-yesterday')?.addEventListener('click', copyFromYesterday);
    document.querySelectorAll('.wiz-act-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const k = chip.dataset.act, a = D.wiz.acts, idx = a.indexOf(k);
        idx === -1 ? a.push(k) : a.splice(idx,1);
        chip.classList.toggle('on');
      });
    });
    document.getElementById('w-note')?.addEventListener('input', e => { D.wiz.note = e.target.value; });
    document.getElementById('wiz-dayoff-toggle')?.addEventListener('click', () => {
      D.wiz.dayOff = !D.wiz.dayOff;
      if (D.wiz.dayOff) { D.wiz.acts = []; D.wiz.note = ''; }
      drawWiz();
    });
    document.querySelectorAll('.wiz-dayoff-reason').forEach(chip => {
      chip.addEventListener('click', () => { D.wiz.dayOffReason = chip.dataset.reason; drawWiz(); });
    });
  }
  if (step === 3) {
    document.querySelectorAll('.wiz-emp-item').forEach(item => {
      item.addEventListener('click', () => {
        const id = item.dataset.id, busy = item.dataset.busy==='1', sel = D.wiz.emps.includes(id);
        const toggle = () => {
          const a = D.wiz.emps, idx = a.indexOf(id);
          idx === -1 ? a.push(id) : a.splice(idx,1);
          item.classList.toggle('on');
          item.querySelector('.sel-check').textContent = D.wiz.emps.includes(id) ? '✓' : '';
        };
        if (busy && !sel) {
          if (confirm(`${item.dataset.name} כבר מדווח ב${item.dataset.busysite||'אתר אחר'} בתאריך זה.\nלהוסיף גם לדיווח זה?`)) toggle();
          return;
        }
        toggle();
      });
    });
    document.querySelectorAll('.group-chip[data-gid]').forEach(btn => {
      btn.addEventListener('click', () => {
        const empIds = btn.dataset.empids.split(',').filter(Boolean);
        const allSel = empIds.every(id => D.wiz.emps.includes(id));
        if (allSel) D.wiz.emps = D.wiz.emps.filter(id => !empIds.includes(id));
        else empIds.forEach(id => { if (!D.wiz.emps.includes(id)) D.wiz.emps.push(id); });
        drawWiz();
      });
    });
    document.querySelectorAll('.group-chip[data-delgid]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        if (confirm('למחוק קבוצה זו?')) { deleteGroup(btn.dataset.delgid); drawWiz(); }
      });
    });
    document.getElementById('save-grp-btn')?.addEventListener('click', () => {
      const name = prompt('שם הצוות:');
      if (name?.trim()) { saveGroup(D.wiz.siteId, name.trim(), [...D.wiz.emps]); toast('צוות נשמר ✓','ok'); drawWiz(); }
    });
  }
  if (step === 4) {
    document.querySelectorAll('.wiz-eq-item').forEach(item => {
      item.addEventListener('click', () => {
        const id = item.dataset.id, a = D.wiz.equip, idx = a.indexOf(id);
        idx === -1 ? a.push(id) : a.splice(idx,1);
        item.classList.toggle('on');
        item.querySelector('.sel-check').textContent = D.wiz.equip.includes(id) ? '✓' : '';
      });
    });
  }
  if (step === 5) {
    document.getElementById('w-gnote')?.addEventListener('input', e => { D.wiz.gNote = e.target.value; });
    document.getElementById('wiz-add-del')?.addEventListener('click', addDel);
    document.getElementById('wiz-cam-btn')?.addEventListener('click', () => document.getElementById('wiz-cam-input').click());
    document.getElementById('wiz-gal-btn')?.addEventListener('click', () => document.getElementById('wiz-gal-input').click());
    document.getElementById('wiz-cam-input').onchange = e => handleWizPhoto(e);
    document.getElementById('wiz-gal-input').onchange = e => handleWizPhoto(e);
    document.querySelectorAll('.del-remove').forEach(btn => {
      btn.addEventListener('click', () => { D.wiz.dels.splice(+btn.dataset.i,1); drawWiz(); });
    });
    document.querySelectorAll('.wiz-photo-remove').forEach(btn => {
      btn.addEventListener('click', () => { D.wiz.photos.splice(+btn.dataset.i,1); drawWiz(); });
    });
  }
}

function wiz1() {
  const sites = getAvailableSites();
  if (D.wiz.editMode) {
    const site = D.sites.find(s => s.id === D.wiz.siteId);
    return `<div class="form-group"><label class="form-label">תאריך</label>
      <div class="form-input" style="background:#fff7ed;color:var(--muted)">${fmtDate(D.wiz.date)}</div></div>
      <div class="form-group"><label class="form-label">אתר</label>
      <div class="form-input" style="background:#fff7ed;color:var(--muted)">${site?.name||D.wiz.siteId}</div></div>
      <div class="muted tc" style="font-size:12px;padding:4px 0">ניתן לערוך פעילויות, עובדים, ציוד, הערות ואספקות</div>`;
  }
  const quickBtn = `<button class="btn btn-sm mt8" id="wiz-quick-toggle"
    style="width:auto;${D.wiz.quickMode?'background:rgba(249,115,22,.1);border:2px solid var(--blue);color:var(--blue)':'background:var(--bg);border:2px solid var(--border);color:var(--muted)'}">
    ⚡ ${D.wiz.quickMode ? 'מצב מהיר — פעיל' : 'מצב מהיר (2 שלבים)'}
  </button>`;
  return `<div class="form-group"><label class="form-label">תאריך</label>
    <input type="date" class="form-input" id="w-date" value="${D.wiz.date}" max="${todayStr()}"></div>
    <div class="form-group"><label class="form-label">אתר *</label>
    <select class="form-input" id="w-site">
      <option value="">— בחר אתר —</option>
      ${sites.map(s=>`<option value="${s.id}" ${D.wiz.siteId===s.id?'selected':''}>${s.name}</option>`).join('')}
    </select></div>
    <div class="row" style="gap:8px;flex-wrap:wrap">
      <button class="btn btn-outline btn-sm" id="wiz-copy-btn" style="width:auto">📋 העתק מיומן קודם</button>
      ${quickBtn}
    </div>`;
}

function wiz2() {
  const acts = [
    {k:'dig',l:'חפירה',i:'⛏️'},{k:'base',l:'מצעים',i:'🪨'},
    {k:'form',l:'טפסנות',i:'🪵'},{k:'cast',l:'יציקה',i:'🏗️'},
    {k:'strip',l:'פירוק טפסנות',i:'🔧'}
  ];
  const dayOffReasons = [{k:'חג',i:'🎉'},{k:'גשם',i:'🌧️'},{k:'תקלה',i:'🔧'},{k:'אחר',i:'📝'}];
  const dim = D.wiz.dayOff ? 'style="opacity:.35;pointer-events:none"' : '';
  return `<div style="margin-bottom:10px">
    <button class="btn btn-ghost btn-sm" id="btn-copy-yesterday" style="width:auto">📋 העתק מאתמול</button>
  </div>
  <div class="chips" ${dim}>
    ${acts.map(a=>`<div class="chip wiz-act-chip ${D.wiz.acts.includes(a.k)?'on':''}" data-act="${a.k}">${a.i} ${a.l}</div>`).join('')}
  </div>
  <div class="form-group mt12" ${dim}><label class="form-label">פעילות נוספת / הערת פעילות</label>
    <input type="text" class="form-input" id="w-note" placeholder="פעילות אחרת..." value="${D.wiz.note}"></div>
  <div class="divider"></div>
  <div class="chip day-off-chip ${D.wiz.dayOff?'on':''}" id="wiz-dayoff-toggle">🚫 אתר לא עבד היום</div>
  ${D.wiz.dayOff ? `<div class="chips mt8">
    ${dayOffReasons.map(r=>`<div class="chip ${D.wiz.dayOffReason===r.k?'on dayoff-sel':''} wiz-dayoff-reason" data-reason="${r.k}">${r.i} ${r.k}</div>`).join('')}
  </div>
  <div class="muted tc mt8" style="font-size:12px">הסיבה תירשם ביומן. שלבים הבאים אופציונליים.</div>` : ''}`;
}

function wiz3() {
  const emps = D.employees.filter(e => e.active === 'פעיל');
  if (!emps.length) return `<div class="empty"><div class="empty-icon">👷</div><div class="empty-title">אין עובדים פעילים</div></div>`;
  const otherSiteAtt = D.attendance.filter(a => a.date===(D.wiz.date||todayStr()) && a.siteId!==D.wiz.siteId && a.logId!==D.wiz.editLogId);
  const busyIds = otherSiteAtt.map(a => a.empId);
  const busySite = {};
  otherSiteAtt.forEach(a => { const s = D.sites.find(x=>x.id===a.siteId); busySite[a.empId] = s?.name || 'אתר אחר'; });
  const groups = D.wiz.siteId ? getGroupsForSite(D.wiz.siteId) : [];
  const groupBar = groups.length || D.wiz.emps.length ? `
    <div class="group-bar">
      ${groups.map(g => {
        const allSel = g.empIds.every(id => D.wiz.emps.includes(id));
        return `<button class="group-chip${allSel?' active-grp':''}" data-gid="${g.id}" data-empids="${g.empIds.join(',')}">👥 ${g.name}</button>
                <button class="group-chip del-grp" data-delgid="${g.id}" title="מחק קבוצה">✕</button>`;
      }).join('')}
      ${D.wiz.emps.length ? `<button class="group-chip save-grp" id="save-grp-btn">💾 שמור כצוות</button>` : ''}
    </div>` : '';
  return groupBar + emps.map(e => {
    const busy = busyIds.includes(e.id) && !D.wiz.emps.includes(e.id);
    const sel  = D.wiz.emps.includes(e.id);
    return `<div class="sel-item wiz-emp-item ${sel?'on':''} ${busy?'dim':''}" data-id="${e.id}" data-busy="${busy?'1':'0'}" data-name="${e.name}" data-busysite="${busySite[e.id]||''}">
      <div class="sel-check">${sel?'✓':''}</div>
      <div><div class="li-name">${e.name}</div><div class="muted">${e.profession||''}${busy?` · מדווח ב${busySite[e.id]||'אתר אחר'}`:''}</div></div>
    </div>`;
  }).join('');
}

function wiz4() {
  const eq = D.equipment.filter(e => e.active === 'פעיל');
  if (!eq.length) return `<div class="empty"><div class="empty-icon">🚜</div><div class="empty-title">אין ציוד פעיל</div></div>`;
  return eq.map(e => {
    const sel = D.wiz.equip.includes(e.id);
    return `<div class="sel-item ${sel?'on':''} wiz-eq-item" data-id="${e.id}">
      <div class="sel-check">${sel?'✓':''}</div>
      <div><div class="li-name">${e.name}</div><div class="muted">${e.type||''}</div></div>
    </div>`;
  }).join('');
}

function wiz5() {
  const site = D.sites.find(s => s.id === D.wiz.siteId);
  const activeSupps = D.suppliers.filter(s => s.status === 'פעיל');
  return `
    <div class="form-group"><label class="form-label">הערות כלליות</label>
      <textarea class="form-input" id="w-gnote" placeholder="הערות לדיווח...">${D.wiz.gNote||''}</textarea></div>
    <div class="card-title mt12">אספקות (אופציונלי)</div>
    ${D.wiz.dels.map((d,i)=>`<div class="list-item">
      <div class="avatar av-green">🚚</div>
      <div class="li-info"><div class="li-name">${d.material}</div><div class="li-sub">${d.suppName||''} · ${d.qty||''}</div></div>
      <button class="btn btn-danger btn-sm del-remove" data-i="${i}" style="width:auto">✕</button>
    </div>`).join('')}
    <div class="card mt12">
      <div class="card-title">הוסף אספקה</div>
      <div class="form-group"><label class="form-label">ספק</label>
        <select class="form-input" id="del-s">
          <option value="">— בחר ספק —</option>
          ${activeSupps.map(s=>`<option value="${s.id}|${s.name}">${s.name}</option>`).join('')}
        </select></div>
      <div class="form-group"><label class="form-label">חומר</label>
        <input type="text" class="form-input" id="del-m" placeholder="בטון, חול..."></div>
      <div class="form-group"><label class="form-label">כמות</label>
        <input type="text" class="form-input" id="del-q" placeholder='5 מ"ק'></div>
      <button class="btn btn-outline" id="wiz-add-del">➕ הוסף</button>
    </div>
    <div class="card mt12">
      <div class="card-title">📸 תמונות אתר</div>
      ${(D.wiz.photos||[]).map((p,i)=>`<div class="list-item">
        <div class="avatar av-blue" style="width:54px;height:54px;border-radius:10px;overflow:hidden">
          <img src="${p.url}" style="width:100%;height:100%;object-fit:cover">
        </div>
        <div class="li-info"><div class="li-name" style="font-size:13px">${p.name}</div></div>
        <button class="btn btn-danger btn-sm wiz-photo-remove" data-i="${i}" style="width:auto">✕</button>
      </div>`).join('')}
      ${!D.wiz.photos?.length ? '<div class="muted" style="font-size:13px;margin-bottom:10px">תמונות ישויכו לאתר ולתאריך הדיווח</div>' : ''}
      <div class="btn-row" style="margin-top:8px">
        <button class="btn btn-outline btn-sm fg" id="wiz-cam-btn">📷 מצלמה</button>
        <button class="btn btn-ghost btn-sm fg" id="wiz-gal-btn">🖼️ גלריה</button>
      </div>
    </div>
    <div class="card mt12" style="background:#fff7ed">
      <div class="card-title">סיכום</div>
      <div class="list-item" style="border:none;padding:4px 0"><span>📅</span><span style="margin-right:auto;font-weight:600">${fmtDate(D.wiz.date)}</span></div>
      <div class="list-item" style="border:none;padding:4px 0"><span>📍</span><span style="margin-right:auto;font-weight:600">${site?.name||'-'}</span></div>
      <div class="list-item" style="border:none;padding:4px 0"><span>👷</span><span style="margin-right:auto;font-weight:600">${D.wiz.emps.length} עובדים</span></div>
      <div class="list-item" style="border:none;padding:4px 0"><span>🚜</span><span style="margin-right:auto;font-weight:600">${D.wiz.equip.length} ציוד</span></div>
    </div>`;
}

function wizNext() {
  const w = D.wiz;
  if (w.step === 1 && !w.editMode) {
    w.date   = document.getElementById('w-date')?.value || w.date;
    w.siteId = document.getElementById('w-site')?.value || w.siteId;
    if (!w.siteId) { toast('יש לבחור אתר','err'); return; }
    if (D.logs.find(l => l.siteId===w.siteId && l.date===w.date)) { toast('יומן לאתר זה כבר קיים היום','err'); return; }
    if (isLocked(w.date)) { toast('חודש זה נעול','err'); return; }
    if (w.quickMode) { w.step = 3; drawWiz(); return; }
  }
  if (w.step === 2) {
    w.note = document.getElementById('w-note')?.value || w.note;
  }
  w.step++; drawWiz();
}

function addDel() {
  const sv  = document.getElementById('del-s').value;
  const mat = document.getElementById('del-m').value.trim();
  const qty = document.getElementById('del-q').value.trim();
  if (!mat) { toast('יש להזין שם חומר','err'); return; }
  const [suppId, suppName] = sv ? sv.split('|') : ['',''];
  D.wiz.dels.push({ suppId, suppName:suppName||'', material:mat, qty });
  drawWiz();
}

function handleWizPhoto(e) {
  const f = e.target.files[0]; if (!f) return;
  e.target.value = '';
  if (!D.wiz.photos) D.wiz.photos = [];
  D.wiz.photos.push({ file:f, url:URL.createObjectURL(f), name:f.name });
  drawWiz();
}

function applyLogToDwiz(prev) {
  D.wiz.acts  = ACT_KEYS.filter(k => prev[k]);
  D.wiz.note  = (prev.other||'').startsWith('יום חופש:') ? '' : (prev.other||'');
  D.wiz.emps  = D.attendance.filter(a => a.logId===prev.id).map(a => a.empId);
  D.wiz.equip = D.logEquip.filter(e => e.logId===prev.id).map(e => e.eqId);
  D.wiz.dels  = D.deliveries.filter(d => d.logId===prev.id).map(d => ({ suppId:d.suppId, suppName:d.suppName, material:d.material, qty:d.qty }));
}

function copyFromYesterday() {
  const siteId = D.wiz.siteId; if (!siteId) { toast('אתר לא נבחר','err'); return; }
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate()-1);
  const yStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth()+1).padStart(2,'0')}-${String(yesterday.getDate()).padStart(2,'0')}`;
  const prev = D.logs.find(l => l.siteId===siteId && l.date===yStr);
  if (!prev) { toast('אין דיווח מאתמול','err'); return; }
  applyLogToDwiz(prev);
  toast('הועתק מאתמול ✓','ok');
  drawWiz();
}

function copyYesterday() {
  const siteId = document.getElementById('w-site')?.value || D.wiz.siteId;
  if (!siteId) { toast('בחר אתר תחילה','err'); return; }
  D.wiz.siteId = siteId;
  const prev = [...D.logs].filter(l => l.siteId===siteId && l.date<D.wiz.date).sort((a,b)=>b.date.localeCompare(a.date))[0];
  if (!prev) { toast('אין יומן קודם לאתר זה','err'); return; }
  applyLogToDwiz(prev);
  toast('נתונים הועתקו מיומן '+prev.date+' ✓','ok');
  drawWiz();
}

async function saveLog() {
  if (D.wiz.editMode) { await saveLogEdit(); return; }
  if (!D.isOnline) { toast('אין חיבור לאינטרנט — לא ניתן לשמור','err'); return; }
  const w = D.wiz;
  const site = D.sites.find(s => s.id === w.siteId);
  if (!site) { toast('אתר לא נמצא','err'); return; }
  setBtn('wiz-btn', true, 'שומר...');
  const logId = uid(), now = new Date().toISOString();
  const noteVal = w.dayOff ? `יום חופש: ${w.dayOffReason||'אחר'}` : (w.note||'');
  const tf = k => w.acts.includes(k)?'TRUE':'FALSE';
  try {
    await sAppend('DailyLogs',[logId, w.date, w.siteId, site.name, D.user?.email||'',
      tf('dig'),tf('base'),tf('form'),tf('cast'),tf('strip'),
      noteVal, w.gNote||'', now, 1, '', '']);
    for (const eid of w.emps) {
      const e = D.employees.find(x=>x.id===eid);
      await sAppend('Attendance',[uid(),logId,eid,e?.name||'',w.date,w.siteId]);
    }
    for (const eqid of w.equip) {
      const e = D.equipment.find(x=>x.id===eqid);
      await sAppend('LogEquipment',[uid(),logId,eqid,e?.name||'',w.date,w.siteId]);
    }
    for (const d of w.dels) {
      await sAppend('Deliveries',[uid(),logId,d.suppId||'',d.suppName||'',d.material,d.qty||'','']);
    }
    if (w.photos?.length) await uploadWizPhotos(w.siteId, site.name, w.date, logId);
    await logAudit('CREATE','DailyLog',logId,`יומן חדש: ${site.name} ${w.date}`);
    await loadAll();
    toast('דיווח נשמר ✓','ok');
    D.wiz = {}; go('dash'); renderDash();
  } catch(e) { toast('שגיאה: '+e.message,'err'); setBtn('wiz-btn',false,'💾 שמור דיווח'); }
}

async function saveLogEdit() {
  if (!D.isOnline) { toast('אין חיבור לאינטרנט — לא ניתן לשמור','err'); return; }
  const w = D.wiz;
  const log = D.logs.find(l => l.id===w.editLogId); if (!log) { toast('יומן לא נמצא','err'); return; }
  setBtn('wiz-btn', true, 'שומר...');
  try {
    const noteVal = w.dayOff ? `יום חופש: ${w.dayOffReason||'אחר'}` : (w.note||'');
    const { conflict, deleted } = await checkLogVersion(w.editLogId, w.editVersion);
    if (deleted)  { toast('יומן זה נמחק ע"י משתמש אחר','err'); setBtn('wiz-btn',false,'💾 עדכן יומן'); return; }
    if (conflict) { toast('⚠️ היומן שונה ע"י משתמש אחר. סגור וטען מחדש.','err'); setBtn('wiz-btn',false,'💾 עדכן יומן'); return; }

    const [lg,at,le,dl] = await Promise.all([
      sRead('DailyLogs','A2:P5000'), sRead('Attendance','A2:F5000'),
      sRead('LogEquipment','A2:F5000'), sRead('Deliveries','A2:G5000')
    ]);

    const newVersion = (w.editVersion||1) + 1, now = new Date().toISOString();
    const tf = k => w.acts.includes(k)?'TRUE':'FALSE';
    const newLg = lg.filter(r=>r[0]).map(r => r[0]!==w.editLogId ? r : [
      r[0],r[1],r[2],r[3],r[4], tf('dig'),tf('base'),tf('form'),tf('cast'),tf('strip'),
      noteVal, w.gNote||'', r[12]||'', newVersion, now, D.user?.email||''
    ]);
    const newAtAdd = w.emps.map(eid  => { const e=D.employees.find(x=>x.id===eid);  return [uid(),w.editLogId,eid,e?.name||'',log.date,log.siteId]; });
    const newLeAdd = w.equip.map(eqid=>{ const e=D.equipment.find(x=>x.id===eqid); return [uid(),w.editLogId,eqid,e?.name||'',log.date,log.siteId]; });
    const newDlAdd = w.dels.map(d    =>  [uid(),w.editLogId,d.suppId||'',d.suppName||'',d.material,d.qty||'','']);

    await Promise.all([
      rebuildTab('DailyLogs',  newLg),
      rebuildTab('Attendance', [...at.filter(r=>r[0]&&r[1]!==w.editLogId), ...newAtAdd]),
      rebuildTab('LogEquipment',[...le.filter(r=>r[0]&&r[1]!==w.editLogId),...newLeAdd]),
      rebuildTab('Deliveries', [...dl.filter(r=>r[0]&&r[1]!==w.editLogId), ...newDlAdd]),
    ]);

    const li = D.logs.findIndex(l => l.id===w.editLogId);
    D.logs[li] = { ...D.logs[li], dig:w.acts.includes('dig'), base:w.acts.includes('base'), form:w.acts.includes('form'), cast:w.acts.includes('cast'), strip:w.acts.includes('strip'), other:noteVal, notes:w.gNote||'', version:newVersion, updatedAt:now, updatedBy:D.user?.email||'' };
    D.attendance = D.attendance.filter(a=>a.logId!==w.editLogId);
    newAtAdd.forEach(r => D.attendance.push({id:r[0],logId:r[1],empId:r[2],empName:r[3],date:r[4],siteId:r[5]}));
    D.logEquip = D.logEquip.filter(e=>e.logId!==w.editLogId);
    newLeAdd.forEach(r => D.logEquip.push({id:r[0],logId:r[1],eqId:r[2],eqName:r[3],date:r[4],siteId:r[5]}));
    D.deliveries = D.deliveries.filter(d=>d.logId!==w.editLogId);
    newDlAdd.forEach(r => D.deliveries.push({id:r[0],logId:r[1],suppId:r[2],suppName:r[3],material:r[4],qty:r[5],notes:''}));

    await logAudit('UPDATE','DailyLog',w.editLogId,`עדכון יומן: ${log.siteName} ${log.date}`);
    toast('יומן עודכן ✓','ok');
    D.wiz = {}; filterLogs(); renderDash(); go('logs');
  } catch(e) { toast('שגיאה: '+e.message,'err'); setBtn('wiz-btn',false,'💾 עדכן יומן'); }
}
