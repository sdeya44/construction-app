import { D } from '../state.js';
import { uid, toast, can, openSheet, closeSheet, compressImage } from '../utils.js';
import { sAppend, driveUpload, driveThumbUrl, logAudit } from '../api.js';
import { todayStr } from '../utils.js';

let _photoSiteId = null;

export function openSitePhotos(siteId) {
  const site = D.sites.find(s => s.id === siteId); if (!site) return;
  _photoSiteId = siteId;
  renderPhotosSheet(site);
  openSheet('sh-photos');
}

function renderPhotosSheet(site) {
  const photos = [...D.photos.filter(p => p.siteId === site.id)].sort((a,b) => b.date.localeCompare(a.date));
  document.getElementById('sh-photos-body').innerHTML = `
    <div class="sh-title">📸 ${site.name}</div>
    ${can('upload_photos') ? `
    <div class="btn-row" style="margin-bottom:16px">
      <button class="btn btn-primary fg" id="site-cam-trigger">📷 מצלמה</button>
      <button class="btn btn-outline fg" id="site-gal-trigger">🖼️ גלריה</button>
    </div>` : ''}
    ${photos.length
      ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          ${photos.map(p => photoCard(p)).join('')}
         </div>`
      : `<div class="empty"><div class="empty-icon">📸</div><div class="empty-title">אין תמונות עדיין</div></div>`}
    <button class="btn btn-ghost mt8" id="site-photos-close">סגור</button>`;

  document.getElementById('site-photos-close')?.addEventListener('click', () => closeSheet('sh-photos'));
  document.getElementById('site-cam-trigger')?.addEventListener('click', () => {
    document.getElementById('site-cam-input').click();
  });
  document.getElementById('site-gal-trigger')?.addEventListener('click', () => {
    document.getElementById('photo-input').click();
  });
}

function photoCard(p) {
  return `<div style="border-radius:12px;overflow:hidden;background:#f0f3fa;border:1px solid #e5e9f5">
    <img src="${p.url}" data-fileid="${p.fileId}"
      style="width:100%;aspect-ratio:1;object-fit:cover;display:block" loading="lazy"
      onerror="if(this.dataset.fileid&&!this.dataset.retried){this.dataset.retried='1';this.src='https://lh3.googleusercontent.com/d/'+this.dataset.fileid;}else{this.parentElement.style.display='none';}">
    <div style="padding:6px 8px">
      <div style="font-size:11px;font-weight:600;color:#6b7280">${new Date(p.date+'T12:00:00').toLocaleDateString('he-IL',{day:'numeric',month:'long'})}</div>
      ${p.desc ? `<div style="font-size:12px;color:#374151;margin-top:2px">${p.desc}</div>` : ''}
    </div>
  </div>`;
}

export function handlePhotoUpload(e) {
  const f = e.target.files[0]; if (!f) return;
  e.target.value = '';
  uploadSitePhoto(f);
}

async function uploadSitePhoto(file) {
  if (!_photoSiteId) return;
  const site = D.sites.find(s => s.id === _photoSiteId); if (!site) return;
  toast('מדחס ומעלה תמונה...','');
  try {
    const compressed = await compressImage(file);
    const today  = todayStr();
    const fname  = `${site.name}_${today}_${Date.now()}.jpg`;
    const fileId = await driveUpload(compressed, fname);
    const url    = driveThumbUrl(fileId);
    const photoId = uid(), now = new Date().toISOString();
    await sAppend('SitePhotos',[photoId, _photoSiteId, site.name, today, '', fileId, url, D.user?.email||'', now, '']);
    D.photos.push({ id:photoId, siteId:_photoSiteId, siteName:site.name, date:today, desc:'', fileId, url, by:D.user?.email||'', at:now, logId:'' });
    await logAudit('CREATE','SitePhoto',photoId,`תמונה הועלתה לאתר ${site.name}`);
    toast('תמונה הועלתה ✓','ok');
    renderPhotosSheet(site);
  } catch(e) { toast('שגיאה: '+e.message,'err'); }
}

export async function uploadWizPhotos(siteId, siteName, date, logId='') {
  for (const p of (D.wiz.photos||[])) {
    try {
      const compressed = await compressImage(p.file);
      const fname  = `${siteName}_${date}_${Date.now()}.jpg`;
      const fileId = await driveUpload(compressed, fname);
      const url    = driveThumbUrl(fileId);
      const photoId = uid(), now = new Date().toISOString();
      await sAppend('SitePhotos',[photoId, siteId, siteName, date, '', fileId, url, D.user?.email||'', now, logId]);
      D.photos.push({ id:photoId, siteId, siteName, date, desc:'', fileId, url, by:D.user?.email||'', at:now, logId });
    } catch {}
  }
}
