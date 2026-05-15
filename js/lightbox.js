let _imgs = [];
let _idx  = 0;
let _kh   = null;

export function openLightbox(photos, startIdx = 0) {
  _imgs = photos;
  _idx  = Math.max(0, Math.min(startIdx, photos.length - 1));
  const lb = document.getElementById('sh-lightbox');
  if (!lb) return;
  _render();
  lb.classList.add('open');
}

export function closeLightbox() {
  const lb = document.getElementById('sh-lightbox');
  if (!lb) return;
  lb.classList.remove('open');
  if (_kh) { document.removeEventListener('keydown', _kh); _kh = null; }
}

function _render() {
  const lb = document.getElementById('sh-lightbox');
  if (!lb || !_imgs.length) return;
  const p      = _imgs[_idx];
  const src    = typeof p === 'string' ? p : (p.url    || '');
  const fileId = typeof p === 'string' ? '' : (p.fileId || '');
  const desc   = typeof p === 'string' ? '' : (p.desc  || p.description || '');
  const date   = typeof p === 'string' ? '' : (p.date  || '');
  const caption = [date, desc].filter(Boolean).join(' · ');

  lb.innerHTML = `
    <div class="lb-bg" id="lb-bg"></div>
    <button class="lb-close" id="lb-close">✕</button>
    ${_imgs.length > 1 ? `
      <button class="lb-nav lb-prev" id="lb-prev">›</button>
      <button class="lb-nav lb-next" id="lb-next">‹</button>
    ` : ''}
    <div class="lb-img-wrap" id="lb-wrap">
      <img src="${src}" data-fileid="${fileId}" class="lb-img" loading="eager"
        onerror="if(this.dataset.fileid&&!this.dataset.retried){this.dataset.retried='1';this.src='https://drive.google.com/thumbnail?id='+this.dataset.fileid+'&sz=w800';}else{this.style.display='none';}">
    </div>
    <div class="lb-footer">
      ${caption ? `<div class="lb-caption">${caption}</div>` : ''}
      ${_imgs.length > 1 ? `<div class="lb-counter">${_idx + 1} / ${_imgs.length}</div>` : ''}
    </div>
  `;

  document.getElementById('lb-bg')   ?.addEventListener('click', closeLightbox);
  document.getElementById('lb-close')?.addEventListener('click', closeLightbox);
  document.getElementById('lb-prev') ?.addEventListener('click', e => { e.stopPropagation(); _go(-1); });
  document.getElementById('lb-next') ?.addEventListener('click', e => { e.stopPropagation(); _go(1);  });

  let tx = 0;
  const wrap = document.getElementById('lb-wrap');
  if (wrap) {
    wrap.addEventListener('touchstart', e => { tx = e.touches[0].clientX; }, { passive: true });
    wrap.addEventListener('touchend',   e => {
      const dx = e.changedTouches[0].clientX - tx;
      if (Math.abs(dx) > 50) _go(dx < 0 ? 1 : -1);
    }, { passive: true });
  }

  if (_kh) document.removeEventListener('keydown', _kh);
  _kh = e => {
    if (!document.getElementById('sh-lightbox')?.classList.contains('open')) return;
    if (e.key === 'Escape')     closeLightbox();
    if (e.key === 'ArrowLeft')  _go(1);
    if (e.key === 'ArrowRight') _go(-1);
  };
  document.addEventListener('keydown', _kh);
}

function _go(dir) {
  if (_imgs.length <= 1) return;
  _idx = (_idx + dir + _imgs.length) % _imgs.length;
  _render();
}
