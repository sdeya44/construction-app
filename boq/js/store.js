// Thin wrapper over a sql.js Database. Every mutation runs inside tx(); after a successful
// commit the whole database is handed to the persistence adapter (one file = full backup).
import { SCHEMA, SCHEMA_VERSION } from './schema.js';

export class Store {
  constructor(SQL, bytes, persist = null) {
    this.db = bytes ? new SQL.Database(bytes) : new SQL.Database();
    this.persist = persist;
    this.db.run('PRAGMA foreign_keys = ON;');
    this.migrate();
    this.db.exec(SCHEMA);
    this.db.run("INSERT OR REPLACE INTO meta VALUES ('schema', ?)", [String(SCHEMA_VERSION)]);
    this.listeners = new Set();
    this.depth = 0;
  }

  /** Upgrade databases created by older versions, before SCHEMA (CREATE IF NOT EXISTS) runs. */
  migrate() {
    const has = (t) => this.get("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [t]);
    if (!has('items')) return; // fresh database
    const cols = (t) => this.all(`PRAGMA table_info(${t})`).map((c) => c.name);
    if (!cols('contracts').includes('planned_cents')) this.db.run('ALTER TABLE contracts ADD COLUMN planned_cents INTEGER NOT NULL DEFAULT 0');
    // v1 had a table-level UNIQUE on item numbers; Binarit files repeat note numbers → rebuild without it
    const sql = this.get("SELECT sql FROM sqlite_master WHERE name='items'").sql;
    if (/UNIQUE\s*\(contract_id/.test(sql)) {
      this.db.run('PRAGMA foreign_keys = OFF;');
      this.db.exec(`BEGIN;
        ALTER TABLE items RENAME TO items_v1;
        CREATE TABLE items (
          id INTEGER PRIMARY KEY, contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
          struct TEXT NOT NULL, chapter TEXT NOT NULL, sub TEXT NOT NULL, num INTEGER NOT NULL,
          description TEXT NOT NULL DEFAULT '', unit TEXT NOT NULL DEFAULT '',
          qty TEXT NOT NULL DEFAULT '0', price TEXT NOT NULL DEFAULT '0',
          kind TEXT NOT NULL DEFAULT 'contract' CHECK (kind IN ('contract','extra','note')),
          change_status TEXT NOT NULL DEFAULT 'approved' CHECK (change_status IN ('approved','pending','rejected')),
          dekel_code TEXT DEFAULT NULL, dekel_price TEXT DEFAULT NULL, price_manual INTEGER NOT NULL DEFAULT 1,
          source_item_id INTEGER DEFAULT NULL, notes TEXT DEFAULT '');
        INSERT INTO items SELECT id, contract_id, struct, chapter, sub, num, description, unit, qty, price, kind, change_status, dekel_code, dekel_price, price_manual, source_item_id, notes FROM items_v1;
        DROP TABLE items_v1;
        COMMIT;`);
      this.db.run('PRAGMA foreign_keys = ON;');
    }
  }

  all(sql, params = []) {
    const st = this.db.prepare(sql);
    try {
      st.bind(params);
      const out = [];
      while (st.step()) out.push(st.getAsObject());
      return out;
    } finally { st.free(); }
  }
  get(sql, params = []) { return this.all(sql, params)[0] ?? null; }
  run(sql, params = []) {
    this.db.run(sql, params);
    return { id: this.get('SELECT last_insert_rowid() AS id').id, changes: this.db.getRowsModified() };
  }

  /** Atomic unit of work. Nested calls join the outer transaction. */
  tx(fn, label = '') {
    if (this.depth > 0) return fn(this);
    this.db.run('BEGIN');
    this.depth++;
    let result;
    try {
      result = fn(this);
      if (label) this.run('INSERT INTO audit (at, action, detail) VALUES (?,?,?)', [new Date().toISOString(), label, '']);
      this.db.run('COMMIT');
    } catch (e) {
      this.db.run('ROLLBACK');
      throw e;
    } finally { this.depth--; }
    this.changed();
    return result;
  }

  changed() {
    if (this.persist) this.persist(this.export());
    for (const l of this.listeners) l();
  }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  // sql.js export() closes and reopens the db, resetting pragmas — restore them.
  export() { const b = this.db.export(); this.db.run('PRAGMA foreign_keys = ON;'); return b; }
}

export const nowIso = () => new Date().toISOString();
export const today = () => new Date().toISOString().slice(0, 10);
