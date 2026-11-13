// Display themes: data-theme on <html>, saved per computer (browser storage / Electron profile).
import { h } from './dom.js';

export const THEMES = [
  { id: 'classic', code: '1', name: 'פטרול וזהב', desc: 'רגוע ומדויק, נייטרלים חמים — העיצוב הנוכחי', layout: 'top', sw: ['#f5f4f0', '#ffffff', '#0f4c5c', '#a8844f'] },
  { id: 'onyx', code: '2', name: 'שחור וזהב', desc: 'פס עליון שחור, כותרות סריף, טבלאות בכותרת כהה', layout: 'top', sw: ['#f4f1ea', '#13120f', '#1a1814', '#c9a564'] },
  { id: 'navy', code: '3', name: 'נייבי אדריכלי', desc: 'תפריט צד כחול-עמוק, כרטיסים מעוגלים, הדגשת זהב', layout: 'side', sw: ['#f3f4f7', '#142b45', '#1e3a5c', '#d9b866'] },
  { id: 'graphite', code: '4', name: 'גרפיט לילה', desc: 'מצב כהה מלא, תפריט צד, הדגשת שמפניה', layout: 'side', sw: ['#111316', '#0d0f11', '#191c20', '#c9a96e'] },
  { id: 'copper', code: '5', name: 'בטון ונחושת', desc: 'שוויצרי, פינות חדות, קווים שחורים, הדגשת נחושת', layout: 'top', sw: ['#ecebe8', '#ffffff', '#1f1f1f', '#9a4c27'] },
];
const KEY = 'kayan-boq-theme';

export function currentTheme() {
  let id = 'classic';
  try { id = localStorage.getItem(KEY) || 'classic'; } catch { /* storage blocked */ }
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}
export function applyTheme(t = currentTheme()) {
  if (t.id === 'classic') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = t.id;
}
export function setTheme(id) {
  try { localStorage.setItem(KEY, id); } catch { /* storage blocked */ }
  applyTheme();
}

const mini = (t) => h('span', { class: `theme-mini ${t.layout === 'side' ? 'side' : ''}`, style: { background: t.sw[0] } },
  t.layout === 'side'
    ? [h('span', { class: 'mc' }, h('i', { style: { background: t.sw[2] } }), h('i', { style: { background: t.sw[2], opacity: '.5' } }), h('i', { style: { background: t.sw[3] } })), h('span', { class: 'mb', style: { background: t.sw[1] } })]
    : [h('span', { class: 'mb', style: { background: t.sw[1], borderBottom: `2px solid ${t.sw[3]}` } }), h('span', { class: 'mc' }, h('i', { style: { background: t.sw[2] } }), h('i', { style: { background: t.sw[2], opacity: '.5' } }), h('i', { style: { background: t.sw[3] } }))]);

export function themeButton(onChange) {
  const t = currentTheme();
  return h('button', { class: 'theme-btn sm', title: 'שינוי צורת התצוגה', onclick: (e) => { e.stopPropagation(); openPicker(onChange); } },
    h('span', { class: 'dots' }, t.sw.slice(1).map((c) => h('i', { style: { background: c } }))), 'תצוגה');
}

function openPicker(onChange) {
  document.querySelector('.theme-pop')?.remove();
  const cur = currentTheme().id;
  const pop = h('div', { class: 'theme-pop', role: 'dialog', 'aria-label': 'בחירת עיצוב' },
    h('h3', {}, 'עיצוב התצוגה'),
    THEMES.map((t) => h('button', { class: `theme-opt ${t.id === cur ? 'on' : ''}`, onclick: () => { setTheme(t.id); close(); onChange(); } },
      mini(t), h('span', {}, h('b', {}, t.name), h('small', {}, t.desc)), h('span', { class: 'code' }, `קוד ${t.code}`))));
  const close = () => { pop.remove(); document.removeEventListener('click', outside); document.removeEventListener('keydown', esc); };
  const outside = (e) => { if (!pop.contains(e.target)) close(); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  document.body.append(pop);
  setTimeout(() => { document.addEventListener('click', outside); document.addEventListener('keydown', esc); });
}
