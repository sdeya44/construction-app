/** אתרי בדיקה לפרטי הספרייה: קורת I מול אגף עמוד (ניצב), ופטה מעל קורת גג. */
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { findSite, type Site } from '../src/geometry/detail';
import { v3 } from '../src/core/vec';
import type { DerivedModel, Member } from '../src/model/types';

function make(col: string, beam: string) {
  const b = defaultBuilding(); b.columnProfile = col;
  const d = generate(newProject('lib', b));
  const c = d.members.find((m) => m.kind === 'column' && m.start.x < 1)!;
  // קורת I ניצבת לאגף העמוד (העמוד: גובה החתך לאורך X), באמצע הגובה
  const bm: Member = { id: 'T.BEAM', kind: 'beam', label: 'קורת בדיקה', start: v3(2500, c.start.y, 3000), end: v3(c.start.x, c.start.y, 3000), profile: beam, material: 'S235', rollDeg: 0, mirror: false, anchor: 'center', refUp: v3(0, 0, 1), source: 'manual', manualPlacement: true };
  const members = [...d.members, bm];
  const pur = d.members.find((m) => m.purlin)!;
  const fr = b.frames[1]!.id;
  const sites = [findSite(members, bm, 'end'), findSite(members, pur, `x:${fr}`)].filter(Boolean) as Site[];
  const dd: DerivedModel = { ...d, members, byId: new Map(members.map((m) => [m.id, m])) };
  return { sites, d: dd };
}
export const libSites: [string, () => { sites: Site[]; d: DerivedModel }][] = [
  ['HEA200 / IPE200', () => make('HEA200', 'IPE200')],
  ['HEB300 / IPE360', () => make('HEB300', 'IPE360')],
];
