// Database schema. Decimal values are TEXT (exact), money is INTEGER agorot.
export const SCHEMA_VERSION = 6;

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS company (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL DEFAULT 'כיאן הנדסה בע"מ', address TEXT DEFAULT '', phone TEXT DEFAULT '',
  email TEXT DEFAULT '', vat_id TEXT DEFAULT '', logo TEXT DEFAULT NULL, logo_mode TEXT DEFAULT 'wide'
);
INSERT OR IGNORE INTO company (id) VALUES (1);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, client TEXT DEFAULT '', location TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed')),
  dekel_threshold TEXT NOT NULL DEFAULT '15', notes TEXT DEFAULT '', created_at TEXT NOT NULL,
  supervisor TEXT DEFAULT '', manager TEXT DEFAULT ''
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
  end_month TEXT DEFAULT '', pay_terms INTEGER NOT NULL DEFAULT 60, meas_areas INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed')),
  created_at TEXT NOT NULL,
  -- locked = contract quantities/prices frozen (set on quote conversion / first bill); changes go through change items
  locked INTEGER NOT NULL DEFAULT 0,
  -- versions: contracts sharing version_group are versions of one BOQ; origin_id = the contract it was copied from
  version_group INTEGER DEFAULT NULL, version_label TEXT DEFAULT '', origin_id INTEGER DEFAULT NULL
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
  source_item_id INTEGER DEFAULT NULL, notes TEXT DEFAULT '',
  -- where the bill quantity comes from: typed in the bill ('manual') or the calculation sheet ('meas');
  -- meas_opening = quantity billed manually before the sheet was opened (counted as approved)
  qsrc TEXT NOT NULL DEFAULT 'manual', meas_opening TEXT DEFAULT NULL
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
  returned INTEGER NOT NULL DEFAULT 0,
  UNIQUE (contract_id, number)
);
-- status history of a bill (prepared / submitted / returned for corrections / approved / reopened)
CREATE TABLE IF NOT EXISTS bill_events (
  id INTEGER PRIMARY KEY, bill_id INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  at TEXT NOT NULL, status TEXT NOT NULL, note TEXT DEFAULT ''
);

-- Issued quote revisions (מהדורות): a frozen copy of the quote as it was sent.
CREATE TABLE IF NOT EXISTS quote_revisions (
  id INTEGER PRIMARY KEY, contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  rev INTEGER NOT NULL, created_at TEXT NOT NULL, recipient TEXT DEFAULT '', note TEXT DEFAULT '',
  total_cents INTEGER NOT NULL DEFAULT 0, snapshot TEXT NOT NULL,
  UNIQUE (contract_id, rev)
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
  method TEXT DEFAULT '', ref TEXT DEFAULT '', note TEXT DEFAULT '', group_id INTEGER DEFAULT NULL
);

-- Purchases / deliveries / invoices supplied by us and offset from a bill (קיזוז רכש).
-- parent_id links a delivery to its order or an invoice to its delivery; only one document
-- in such a chain may be offset, which prevents counting the same material twice.
CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY, contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('order','delivery','invoice')),
  doc_no TEXT DEFAULT '', date TEXT NOT NULL, supplier TEXT DEFAULT '', description TEXT DEFAULT '',
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  parent_id INTEGER DEFAULT NULL REFERENCES purchases(id) ON DELETE SET NULL,
  bill_id INTEGER DEFAULT NULL REFERENCES bills(id) ON DELETE SET NULL
);

-- Tenders (מכרזים): a set of items from a contract sent to several bidders for prices.
CREATE TABLE IF NOT EXISTS tenders (
  id INTEGER PRIMARY KEY, contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  name TEXT NOT NULL, scope TEXT NOT NULL DEFAULT '', due TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','awarded','cancelled')),
  awarded_bidder INTEGER DEFAULT NULL, awarded_contract INTEGER DEFAULT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tender_items (
  tender_id INTEGER NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  PRIMARY KEY (tender_id, item_id)
);
CREATE TABLE IF NOT EXISTS bidders (
  id INTEGER PRIMARY KEY, tender_id INTEGER NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  name TEXT NOT NULL, contact TEXT DEFAULT '', discount TEXT NOT NULL DEFAULT '0', note TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS bid_prices (
  bidder_id INTEGER NOT NULL REFERENCES bidders(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  price TEXT NOT NULL,
  PRIMARY KEY (bidder_id, item_id)
);

-- Quantity calculation (דפי חישוב): measurement rows per item. Rows persist across bills; each
-- approval appends to meas_history (append-only) and freezes the rows into the bill snapshot.
CREATE TABLE IF NOT EXISTS measurements (
  id INTEGER PRIMARY KEY, contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE, sort REAL NOT NULL DEFAULT 0,
  is_group INTEGER NOT NULL DEFAULT 0, group_label TEXT DEFAULT '', descr TEXT DEFAULT '', area TEXT DEFAULT '',
  shape TEXT DEFAULT 'מלבן', d1 TEXT DEFAULT '', d2 TEXT DEFAULT '', d3 TEXT DEFAULT '', t TEXT DEFAULT '', qty TEXT DEFAULT '',
  sign INTEGER NOT NULL DEFAULT 1, notes TEXT DEFAULT '', cancelled INTEGER NOT NULL DEFAULT 0, approval TEXT DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS meas_item ON measurements(contract_id, item_id, sort);
CREATE TABLE IF NOT EXISTS meas_history (
  id INTEGER PRIMARY KEY, meas_id INTEGER NOT NULL REFERENCES measurements(id) ON DELETE CASCADE,
  bill_id INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE, bill_number INTEGER NOT NULL,
  action TEXT NOT NULL, value TEXT NOT NULL, prev_value TEXT NOT NULL DEFAULT '0', claimed TEXT, approval_status TEXT, approval_note TEXT DEFAULT '', date TEXT NOT NULL
);

-- Defects (ליקויים), linked to a project and optionally to a contract item.
CREATE TABLE IF NOT EXISTS defects (
  id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  contract_id INTEGER DEFAULT NULL REFERENCES contracts(id) ON DELETE SET NULL,
  item_id INTEGER DEFAULT NULL REFERENCES items(id) ON DELETE SET NULL,
  location TEXT DEFAULT '', description TEXT NOT NULL, severity TEXT NOT NULL DEFAULT 'normal' CHECK (severity IN ('low','normal','high','critical')),
  responsible TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','fixed','closed')),
  opened TEXT NOT NULL, due TEXT DEFAULT '', closed TEXT DEFAULT '', notes TEXT DEFAULT ''
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
