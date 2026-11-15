import { profileWithoutCatalog } from '../src/profiles/library';
import type { CatalogRow } from '../src/profiles/userCatalog';
const pct = (a?: number, b?: number) => (a && b ? ((a - b) / b) * 100 : null);
/** אותה השוואה כמו בדיאלוג, ללא תלות ב-React. */
export function compareRowPure(r: CatalogRow) {
  const g = profileWithoutCatalog(r.name)!;
  return { A: pct(g.props.area, r.A), mass: pct((g.props.area / 1e6) * 7850, r.mass), Iy: pct(g.props.Iy, r.Iy), Iz: pct(g.props.Iz, r.Iz), Wy: pct(g.props.Wy, r.Wy) };
}
