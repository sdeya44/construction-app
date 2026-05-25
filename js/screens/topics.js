import { D } from '../state.js';
import { go, can } from '../utils.js';
import { renderCurrentScreen } from '../app.js';

function _navigate(screen) {
  go(screen);
  renderCurrentScreen();
}

export function renderTopics() {
  const el = document.getElementById('topics-scroll');
  if (!el) return;

  const isGM = D.role === 'GeneralManager';

  const activeSites     = D.sites.filter(s => s.status === 'פעיל').length;
  const activeEquip     = D.equipment.filter(e => e.active === 'פעיל').length;
  const activeSuppliers = D.suppliers.filter(s => s.status === 'פעיל').length;
  const activeEmps      = D.employees.filter(e => e.active === 'פעיל').length;

  const cards = [
    {
      icon: '📍', title: 'אתרים', screen: 'sites',
      sub: `${activeSites} אתרים פעילים`,
      desc: 'רשימה, פרטי אתר, יומן חודשי, ייצוא',
      show: true,
    },
    {
      icon: '🚜', title: 'ציוד', screen: 'equip',
      sub: `${activeEquip} פריטים פעילים`,
      desc: 'רשימה, דוח שימוש חודשי, ייצוא PDF',
      show: true,
    },
    {
      icon: '🚚', title: 'ספקים', screen: 'suppliers',
      sub: `${activeSuppliers} ספקים פעילים`,
      desc: 'רשימה, פרטי ספק, ניהול',
      show: true,
    },
    {
      icon: '👷', title: 'עובדים', screen: 'emp',
      sub: `${activeEmps} עובדים פעילים`,
      desc: 'רשימה, נוכחות חודשית, חישוב שכר',
      show: isGM,
    },
  ];

  el.innerHTML = cards
    .filter(c => c.show)
    .map(c => `
      <div class="topic-card" data-screen="${c.screen}" style="
        background:var(--card);border-radius:16px;padding:20px;margin-bottom:12px;
        display:flex;align-items:center;gap:16px;cursor:pointer;
        box-shadow:0 2px 8px rgba(0,0,0,.06);border:1px solid var(--border);
        transition:transform .15s,box-shadow .15s">
        <div style="font-size:36px;line-height:1">${c.icon}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:17px;font-weight:700;color:var(--text)">${c.title}</div>
          <div style="font-size:12px;color:var(--gold);font-weight:600;margin:2px 0">${c.sub}</div>
          <div style="font-size:12px;color:var(--muted)">${c.desc}</div>
        </div>
        <div style="color:var(--muted);font-size:20px">‹</div>
      </div>`).join('');

  el.querySelectorAll('.topic-card').forEach(card => {
    card.addEventListener('click', () => _navigate(card.dataset.screen));
    card.addEventListener('pointerenter', () => {
      card.style.transform = 'translateY(-2px)';
      card.style.boxShadow = '0 6px 20px rgba(0,0,0,.1)';
    });
    card.addEventListener('pointerleave', () => {
      card.style.transform = '';
      card.style.boxShadow = '0 2px 8px rgba(0,0,0,.06)';
    });
  });
}
