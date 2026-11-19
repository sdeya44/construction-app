import type { ReactElement } from 'react';

const P = (d: string) => <path d={d} />;
const ICONS: Record<string, ReactElement> = {
  select: P('M5 3l14 8-6 1.5L10 19z'),
  sizing: <><circle cx="7" cy="17" r="3" /><circle cx="12" cy="8" r="3" /><circle cx="17" cy="17" r="3" /></>,
  move: <>{P('M12 2v20M2 12h20')}{P('M9 5l3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3M19 9l3 3-3 3')}</>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" />{P('M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3')}</>,
  rotate: <>{P('M20 12a8 8 0 1 1-2.3-5.7')}{P('M20 4v5h-5')}</>,
  mirror: <>{P('M12 3v18')}{P('M9 7L4 17h5zM15 7l5 10h-5z')}</>,
  trash: <>{P('M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3')}</>,
  measure: <>{P('M3 17L17 3l4 4L7 21z')}{P('M7 13l2 2M10 10l2 2M13 7l2 2')}</>,
  undo: <>{P('M9 14L4 9l5-5')}{P('M4 9h10a6 6 0 0 1 0 12h-3')}</>,
  redo: <>{P('M15 14l5-5-5-5')}{P('M20 9H10a6 6 0 0 0 0 12h3')}</>,
  fit: <>{P('M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5')}</>,
  zoomSel: <><circle cx="11" cy="11" r="6" />{P('M20 20l-4.5-4.5M11 8v6M8 11h6')}</>,
  eye: <>{P('M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z')}<circle cx="12" cy="12" r="3" /></>,
  eyeOff: <>{P('M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c6 0 10 6 10 6a17 17 0 0 1-3.3 3.9M6.6 6.6C3.8 8.4 2 12 2 12s4 7 10 7a9.6 9.6 0 0 0 4.4-1.1')}</>,
  isolate: <><rect x="8" y="8" width="8" height="8" />{P('M3 3h4M17 3h4M3 21h4M17 21h4M3 3v4M21 3v4M3 17v4M21 17v4')}</>,
  showAll: <>{P('M3 12h18M12 3v18')}<circle cx="12" cy="12" r="9" /></>,
  grid: <>{P('M3 8h18M3 16h18M8 3v18M16 3v18')}</>,
  dims: <>{P('M3 7v10M21 7v10M3 12h18M6 9l-3 3 3 3M18 9l3 3-3 3')}</>,
  tag: <>{P('M3 12V4h8l10 10-8 8z')}<circle cx="7.5" cy="8.5" r="1.5" /></>,
  wire: <>{P('M4 7l8-4 8 4v10l-8 4-8-4z M4 7l8 4 8-4M12 11v10')}</>,
  solid: <>{P('M4 7l8-4 8 4v10l-8 4-8-4z')}{P('M4 7l8 4 8-4M12 11v10')}</>,
  split: <><rect x="3" y="3" width="18" height="18" rx="2" />{P('M12 3v18M3 12h18')}</>,
  clip: <>{P('M4 20L20 4')}<rect x="3" y="3" width="18" height="18" rx="2" strokeDasharray="3 3" /></>,
  file: <>{P('M6 2h9l5 5v15H6z')}{P('M14 2v6h6')}</>,
  save: <>{P('M5 3h12l4 4v14H5z')}{P('M8 3v5h8V3M8 21v-7h8v7')}</>,
  folder: P('M3 6h7l2 2h9v11H3z'),
  download: <>{P('M12 3v12M7 10l5 5 5-5M4 20h16')}</>,
  camera: <>{P('M4 8h3l2-3h6l2 3h3v11H4z')}{P('M12 10.5a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 1 0 0-6.4')}</>,
  upload: <>{P('M12 21V9M7 14l5-5 5 5M4 4h16')}</>,
  plus: P('M12 5v14M5 12h14'),
  x: P('M6 6l12 12M18 6L6 18'),
  props: <>{P('M4 6h16M4 12h10M4 18h7')}</>,
  tree: <>{P('M4 5h6M4 5v14M4 12h6M4 19h6')}<rect x="11" y="3" width="9" height="4" /><rect x="11" y="10" width="9" height="4" /><rect x="11" y="17" width="9" height="4" /></>,
  building: <>{P('M3 20V10l9-6 9 6v10')}{P('M7 20v-7M17 20v-7M3 10h18')}</>,
  alert: <>{P('M12 3l10 18H2z')}{P('M12 10v5M12 18v.5')}</>,
  cube: <>{P('M12 2l9 5v10l-9 5-9-5V7z')}{P('M3 7l9 5 9-5M12 12v10')}</>,
  link: <><circle cx="7" cy="7" r="3" /><circle cx="17" cy="17" r="3" />{P('M9 9l6 6')}</>,
  sheet: <>{P('M6 2h9l5 5v15H6z')}{P('M14 2v6h6M9 13h6M9 17h4')}</>,
  factory: <>{P('M3 20h18M5 20V10l5 3V8l5 3V6l4 2v12')}</>,
  search: <><circle cx="11" cy="11" r="7" />{P('M20 20l-4-4')}</>,
  calc: <><rect x="5" y="3" width="14" height="18" rx="2" />{P('M8 7h8M8 11h2M12 11h2M8 15h2M12 15h2')}</>,
  more: <><circle cx="5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="19" cy="12" r="1.2" /></>,
  history: <>{P('M3 12a9 9 0 1 0 3-6.7L3 8')}{P('M3 3v5h5M12 7v5l3 2')}</>,
};

export function Icon({ name }: { name: keyof typeof ICONS | string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name] ?? null}
    </svg>
  );
}
