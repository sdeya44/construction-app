export { selectEquipStatus, saveEquip } from './equipment.js';
export { openAddSupp, selectSuppStatus, saveSupp } from './suppliers.js';

export function renderMgmt() {}

export function mgmtAdd() {
  import('./suppliers.js').then(m => m.openAddSupp());
}
