const KEY = 'cnstr_groups_v1';

function _load() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); }
  catch { return []; }
}

function _save(g) {
  localStorage.setItem(KEY, JSON.stringify(g));
}

export function getGroupsForSite(siteId) {
  return _load().filter(g => g.siteId === siteId);
}

export function saveGroup(siteId, name, empIds) {
  if (!name?.trim() || !empIds?.length) return false;
  const groups = _load();
  const existing = groups.find(g => g.siteId === siteId && g.name === name.trim());
  if (existing) {
    existing.empIds = [...empIds];
    existing.updatedAt = Date.now();
  } else {
    groups.push({ id: Date.now().toString(36), siteId, name: name.trim(), empIds: [...empIds], createdAt: Date.now() });
  }
  _save(groups);
  return true;
}

export function deleteGroup(id) {
  _save(_load().filter(g => g.id !== id));
}
