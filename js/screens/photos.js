import { D } from '../state.js';
import { uid, toast, can, openSheet, closeSheet, compressImage, todayStr } from '../utils.js';
import { sAppend, driveUpload, driveThumbUrl, logAudit } from '../api.js';
import { openLightbox } from '../lightbox.js';

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
      ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px" id="site-photos-grid">
          ${photos.map((p, i) => photoCard(p, i)).join('')}
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
  document.querySelectorAll('#site-photos-grid .photo-thumb').forEach((img, i) => {
    img.addEventListener('click', () => openLightbox(photos, i));
  });
}

function photoCard(p, idx = 0) {
  return `<div style="border-radius:12px;overflow:hidden;background:#131929;border:1px solid rgba(212,160,23,.2)">
    <img src="${p.url}" data-fileid="${p.fileId}" data-idx="${idx}" class="photo-thumb"
      style="width:100%;aspect-ratio:1;object-fit:cover;display:block" loading="lazy"
      onerror="if(this.dataset.fileid&&!this.dataset.retried){this.dataset.retried='1';this.src='https://drive.google.com/thumbnail?id='+this.dataset.fileid+'&sz=w400';}else{this.parentElement.style.display='none';}">
    <div style="padding:6px 8px">
      <div style="font-size:11px;font-weight:600;color:rgba(255,255,255,.5)">${new Date(p.date+'T12:00:00').toLocaleDateString('he-IL',{day:'numeric',month:'long'})}</div>
      ${p.desc ? `<div style="font-size:12px;color:#f0f4ff;margin-top:2px">${p.desc}</div>` : ''}
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
  const list = D.wiz.photos || [];
  let fail = 0;
  for (const p of list) {
    try {
      toast('מעלה תמונה...', '');
      const compressed = await compressImage(p.file);
      const fname  = `${siteName}_${date}_${Date.now()}.jpg`;
      const fileId = await driveUpload(compressed, fname);
      const url    = driveThumbUrl(fileId);
      const photoId = uid(), now = new Date().toISOString();
      await sAppend('SitePhotos',[photoId, siteId, siteName, date, '', fileId, url, D.user?.email||'', now, logId]);
      D.photos.push({ id:photoId, siteId, siteName, date, desc:'', fileId, url, by:D.user?.email||'', at:now, logId });
    } catch(err) {
      console.error('Photo upload failed:', err);
      fail++;
    }
  }
  if (fail) toast(`${fail} תמונות לא הועלו — בדוק חיבור`, 'err');
}
