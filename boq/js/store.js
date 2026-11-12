// Thin wrapper over a sql.js Database. Every mutation runs inside tx(); after a successful
// commit the whole database is handed to the persistence adapter (one file = full backup).
import { SCHEMA, SCHEMA_VERSION } from './schema.js';

export class Store {
  constructor(SQL, bytes, persist = null) {
    this.db = bytes ? new SQL.Database(bytes) : new SQL.Database();
    this.persist = persist;
    this.db.run('PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA);
    const v = this.get("SELECT value FROM meta WHERE key='schema'");
    if (!v) this.db.run("INSERT INTO meta VALUES ('schema', ?)", [String(SCHEMA_VERSION)]);
    this.listeners = new Set();
    this.depth = 0;
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
