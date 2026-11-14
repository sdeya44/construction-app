// בונה קובץ HTML יחיד (JS+CSS+אייקון מוטמעים) שנפתח בלחיצה כפולה, ללא שרת.
import fs from 'node:fs';
const dist = 'dist';
let html = fs.readFileSync(`${dist}/index.html`, 'utf8');
const icon = 'data:image/svg+xml;base64,' + fs.readFileSync('public/icon.svg').toString('base64');
html = html.replace(/<link rel="stylesheet"[^>]*href="\.\/(assets\/[^"]+\.css)"[^>]*>/, (_, f) => `<style>${fs.readFileSync(`${dist}/${f}`, 'utf8')}</style>`);
html = html.replace(/<script type="module" crossorigin src="\.\/(assets\/[^"]+\.js)"><\/script>/, (_, f) =>
  `<script type="module">${fs.readFileSync(`${dist}/${f}`, 'utf8').replaceAll('</script', '<\\/script').replaceAll('./icon.svg', icon)}</script>`);
html = html.replace(/<link rel="manifest"[^>]*>/, '').replace(/href="\.\/icon\.svg"/, `href="${icon}"`);
fs.mkdirSync('release', { recursive: true });
fs.writeFileSync('release/KAYAN-STEEL-PRO.html', html);
console.log('release/KAYAN-STEEL-PRO.html', (html.length / 1024).toFixed(0), 'KB');
