// Database schema. Decimal values are TEXT (exact), money is INTEGER agorot.
export const SCHEMA_VERSION = 2;

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS company (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL DEFAULT 'כיאן הנדסה בע"מ', address TEXT DEFAULT '', phone TEXT DEFAULT '',
  email TEXT DEFAULT '', vat_id TEXT DEFAULT ''
);
INSERT OR IGNORE INTO company (id) VALUES (1);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, client TEXT DEFAULT '', location TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed')),
  dekel_threshold TEXT NOT NULL DEFAULT '15', notes TEXT DEFAULT '', created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contracts (
  id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('client','sub','quote')),
  parent_id INTEGER REFERENCES contracts(id) ON DELETE SET NULL,
  name TEXT NOT NULL, number TEXT DEFAULT '', party TEXT DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'cumulative' CHECK (mode IN ('cumulative','periodic')),
  vat_rate TEXT NOT NULL DEFAULT '18', retention_rate TEXT NOT NULL DEFAULT '0',
  advance_cents INTEGER NOT NULL DEFAULT 0, advance_rate TEXT NOT NULL DEFAULT '0',
  general_discount TEXT NOT NULL DEFAULT '0', opening_cents INTEGER NOT NULL DEFAULT 0,
  index_rule TEXT NOT NULL DEFAULT 'none' CHECK (index_rule IN ('none','manual','full','threshold','partial')),
  index_series TEXT NOT NULL DEFAULT 'residential', index_base_month TEXT DEFAULT '',
  index_lag INTEGER NOT NULL DEFAULT 0, index_threshold TEXT NOT NULL DEFAULT '0', index_share TEXT NOT NULL DEFAULT '100',
  quote_markup TEXT NOT NULL DEFAULT '0', planned_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed')),
  created_at TEXT NOT NULL
);

-- Titles of structures (SS), chapters (SS.CC) and subchapters (SS.CC.TT).
-- discount / markup apply at chapter level; exempt = excluded from the general discount.
CREATE TABLE IF NOT EXISTS sections (
  contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  code TEXT NOT NULL, name TEXT NOT NULL DEFAULT '',
  discount TEXT NOT NULL DEFAULT '0', markup TEXT NOT NULL DEFAULT '0', exempt INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (contract_id, code)
);

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY, contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  struct TEXT NOT NULL, chapter TEXT NOT NULL, sub TEXT NOT NULL, num INTEGER NOT NULL,
  description TEXT NOT NULL DEFAULT '', unit TEXT NOT NULL DEFAULT '',
  qty TEXT NOT NULL DEFAULT '0', price TEXT NOT NULL DEFAULT '0',
  kind TEXT NOT NULL DEFAULT 'contract' CHECK (kind IN ('contract','extra','note')),
  change_status TEXT NOT NULL DEFAULT 'approved' CHECK (change_status IN ('approved','pending','rejected')),
  dekel_code TEXT DEFAULT NULL, dekel_price TEXT DEFAULT NULL, price_manual INTEGER NOT NULL DEFAULT 1,
  source_item_id INTEGER DEFAULT NULL, notes TEXT DEFAULT ''
);
-- item numbers are unique per subchapter; notes may repeat a number (Binarit does this)
CREATE UNIQUE INDEX IF NOT EXISTS items_unique ON items(contract_id, struct, chapter, sub, num) WHERE kind != 'note';
CREATE INDEX IF NOT EXISTS items_contract ON items(contract_id, struct, chapter, sub, num);

CREATE TABLE IF NOT EXISTS bills (
  id INTEGER PRIMARY KEY, contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  number INTEGER NOT NULL, month TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'partial' CHECK (type IN ('partial','final')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved')),
  basis TEXT NOT NULL DEFAULT 'sub' CHECK (basis IN ('calc','sub','appr')),
  doc TEXT NOT NULL DEFAULT '{}', adj TEXT NOT NULL DEFAULT '{}', snapshot TEXT DEFAULT NULL,
  created_at TEXT NOT NULL, approved_at TEXT DEFAULT NULL,
  UNIQUE (contract_id, number)
);

-- Quantities: cumulative in cumulative contracts, period quantities in periodic ones.
CREATE TABLE IF NOT EXISTS bill_lines (
  bill_id INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  q_calc TEXT DEFAULT NULL, q_sub TEXT DEFAULT NULL, q_appr TEXT DEFAULT NULL,
  percent TEXT NOT NULL DEFAULT '100', price TEXT DEFAULT NULL, note TEXT DEFAULT '',
  PRIMARY KEY (bill_id, item_id)
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY, bill_id INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0), date TEXT NOT NULL,
  method TEXT DEFAULT '', ref TEXT DEFAULT '', note TEXT DEFAULT ''
);

-- Index series values: residential = תשומות בנייה למגורים, roads = סלילה וגישור, general = מחירים לצרכן
CREATE TABLE IF NOT EXISTS indices (
  series TEXT NOT NULL, month TEXT NOT NULL, value TEXT NOT NULL, source TEXT DEFAULT 'manual',
  PRIMARY KEY (series, month)
);

CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY, at TEXT NOT NULL, action TEXT NOT NULL, detail TEXT DEFAULT ''
);
`;

export const INDEX_SERIES = {
  residential: 'תשומות בנייה למגורים',
  roads: 'סלילה וגישור',
  general: 'מחירים לצרכן',
};
