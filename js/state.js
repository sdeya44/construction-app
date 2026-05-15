import { ROLES } from './config.js';
import { sRead } from './api.js';
import { saveCache } from './offline.js';

export const D = {
  user: null, token: null,
  role: 'SiteManager',
  isOnline: navigator.onLine,
  lastSync: null,
  activeScreen: 'dash',
  sites: [], employees: [], equipment: [], suppliers: [],
  logs: [], attendance: [], logEquip: [], deliveries: [],
  monthLocks: [], photos: [], users: [], siteAssignments: [],
  logTab: 'all', empTab: 'active', siteTab: 'active', mgmtTab: 'suppliers',
  gmTab: 'payroll',
  editSiteId: null, editEmpId: null, editSuppId: null, editEquipId: null,
  empStatus: 'פעיל', siteStatus: 'פעיל', suppStatus: 'פעיל', equipStatus: 'פעיל',
  wiz: {}, reportMonth: null, reportYear: null,
};

export async function loadAll() {
  const [si,em,eq,su,lg,at,le,dl,ml,ph,us,sa] = await Promise.all([
    sRead('Sites',           'A2:E5000'),
    sRead('Employees',       'A2:G5000'),
    sRead('Equipment',       'A2:E5000'),
    sRead('Suppliers',       'A2:E5000'),
    sRead('DailyLogs',       'A2:P5000'),
    sRead('Attendance',      'A2:F5000'),
    sRead('LogEquipment',    'A2:F5000'),
    sRead('Deliveries',      'A2:G5000'),
    sRead('MonthLocks',      'A2:H5000'),
    sRead('SitePhotos',      'A2:J5000'),
    sRead('Users',           'A2:F5000'),
    sRead('SiteAssignments', 'A2:F5000'),
  ]);

  D.sites      = (si||[]).filter(r=>r[0]).map(r=>({
    id:r[0], name:r[1]||'', address:r[2]||'', status:r[3]||'פעיל', notes:r[4]||''
  }));
  D.employees  = (em||[]).filter(r=>r[0]).map(r=>({
    id:r[0], name:r[1]||'', phone:r[2]||'', profession:r[3]||'',
    active:r[4]||'פעיל', notes:r[5]||'', dailyRate: r[6] ? +r[6] : 0
  }));
  D.equipment  = (eq||[]).filter(r=>r[0]).map(r=>({
    id:r[0], name:r[1]||'', type:r[2]||'', active:r[3]||'פעיל', notes:r[4]||''
  }));
  D.suppliers  = (su||[]).filter(r=>r[0]).map(r=>({
    id:r[0], name:r[1]||'', phone:r[2]||'', notes:r[3]||'', status:r[4]||'פעיל'
  }));
  D.logs       = (lg||[]).filter(r=>r[0]).map(r=>({
    id:r[0], date:r[1]||'', siteId:r[2]||'', siteName:r[3]||'', manager:r[4]||'',
    dig:r[5]==='TRUE', base:r[6]==='TRUE', form:r[7]==='TRUE',
    cast:r[8]==='TRUE', strip:r[9]==='TRUE',
    other:r[10]||'', notes:r[11]||'', at:r[12]||'',
    version: r[13] ? +r[13] : 1,
    updatedAt: r[14]||'', updatedBy: r[15]||''
  }));
  D.attendance = (at||[]).filter(r=>r[0]).map(r=>({
    id:r[0], logId:r[1]||'', empId:r[2]||'', empName:r[3]||'', date:r[4]||'', siteId:r[5]||''
  }));
  D.logEquip   = (le||[]).filter(r=>r[0]).map(r=>({
    id:r[0], logId:r[1]||'', eqId:r[2]||'', eqName:r[3]||'', date:r[4]||'', siteId:r[5]||''
  }));
  D.deliveries = (dl||[]).filter(r=>r[0]).map(r=>({
    id:r[0], logId:r[1]||'', suppId:r[2]||'', suppName:r[3]||'',
    material:r[4]||'', qty:r[5]||'', notes:r[6]||''
  }));
  D.monthLocks = (ml||[]).filter(r=>r[0]).map(r=>({
    id:r[0], month:+r[1], year:+r[2], locked:r[3]==='TRUE', by:r[4]||'', at:r[5]||''
  }));
  D.photos     = (ph||[]).filter(r=>r[0]).map(r=>({
    id:r[0], siteId:r[1]||'', siteName:r[2]||'', date:r[3]||'',
    desc:r[4]||'', fileId:r[5]||'', url:r[6]||'',
    by:r[7]||'', at:r[8]||'', logId:r[9]||''
  }));
  D.users      = (us||[]).filter(r=>r[0]).map(r=>({
    id:r[0], email:r[1]||'', name:r[2]||'', role:r[3]||'SiteManager',
    addedAt:r[4]||'', addedBy:r[5]||''
  }));
  D.siteAssignments = (sa||[]).filter(r=>r[0]).map(r=>({
    id:r[0], email:r[1]||'', siteId:r[2]||'', siteName:r[3]||'',
    addedAt:r[4]||'', addedBy:r[5]||''
  }));

  // Determine role from sheet
  const userRecord = D.users.find(u => u.email === D.user?.email);
  let raw = userRecord ? userRecord.role : 'SiteManager';
  if (raw === 'Admin')                            raw = 'GeneralManager';
  else if (raw === 'Manager' || raw === 'Viewer') raw = 'SiteManager';

  D.role = raw;

  // LocalStorage override: if this email was bootstrapped as GM, honour it
  try {
    const gmEmail = localStorage.getItem('cnstr_gm_v1');
    if (gmEmail && gmEmail === D.user?.email) D.role = 'GeneralManager';
  } catch {}

  D.isOnline = true;
  D.lastSync = new Date();
  try {
    const { token, wiz, ...snap } = D;
    await saveCache(snap);
  } catch {}
}

export function logToRow(l) {
  return [
    l.id, l.date, l.siteId, l.siteName, l.manager,
    l.dig?'TRUE':'FALSE', l.base?'TRUE':'FALSE', l.form?'TRUE':'FALSE',
    l.cast?'TRUE':'FALSE', l.strip?'TRUE':'FALSE',
    l.other||'', l.notes||'', l.at||'',
    l.version||1, l.updatedAt||'', l.updatedBy||''
  ];
}
export function attToRow(a)  { return [a.id, a.logId, a.empId, a.empName, a.date, a.siteId]; }
export function leToRow(e)   { return [e.id, e.logId, e.eqId, e.eqName, e.date, e.siteId]; }
export function delToRow(d)  { return [d.id, d.logId, d.suppId, d.suppName, d.material, d.qty, d.notes||'']; }
export function photoToRow(p){ return [p.id, p.siteId, p.siteName, p.date, p.desc||'', p.fileId, p.url, p.by, p.at, p.logId||'']; }
