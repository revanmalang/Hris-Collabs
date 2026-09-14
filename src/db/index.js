const mysql = require('mysql2/promise');

// Connects to MySQL/MariaDB (including XAMPP's bundled MariaDB) via a
// connection pool. See README "Stack" section for the migration history:
// this app started on SQLite/node:sqlite and moved to MySQL for easier
// backup/restore tooling (mysqldump, phpMyAdmin, etc.) and familiarity.
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'employeehub',
  namedPlaceholders: true,
  dateStrings: true, // return DATE/DATETIME as 'YYYY-MM-DD[ HH:MM:SS]' strings, matching the app's existing string-based date handling
  waitForConnections: true,
  connectionLimit: 10,
  decimalNumbers: true,
});

// The app's route code was written against a better-sqlite3-style
// synchronous API: `db.prepare(sql).get(...)` / `.all(...)` / `.run(...)`,
// with parameters passed either positionally (`?` placeholders, args as a
// plain argument list) or as a single named-params object (`@name`
// placeholders, better-sqlite3's convention). Rather than rewriting every
// query string and call site for MySQL, `prepare()` here detects which
// style is in use per-call and adapts: `@name` is rewritten to mysql2's
// `:name` named-placeholder syntax on demand, positional calls pass
// straight through. Every method is now async (`await` required) since
// MySQL is a real network round-trip, unlike embedded SQLite.
// The app generates timestamps with `new Date().toISOString()` everywhere
// (e.g. utils/id.js's nowIso()) - a format MySQL's DATETIME columns reject
// outright (the trailing "Z" and milliseconds aren't valid DATETIME
// syntax). Rather than touching every call site that produces a
// timestamp, ISO strings are rewritten to MySQL's 'YYYY-MM-DD HH:MM:SS'
// here, once, for every parameter passed through prepare().
const ISO_UTC_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(\.\d+)?Z$/;
function toMysqlDateTime(value) {
  if (typeof value !== 'string') return value;
  const m = value.match(ISO_UTC_RE);
  return m ? `${m[1]} ${m[2]}` : value;
}
function sanitizeParam(value) {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.map(sanitizeParam);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) {
      const v = value[k];
      out[k] = v === undefined ? null : toMysqlDateTime(v);
    }
    return out;
  }
  return toMysqlDateTime(value);
}

function prepare(sql) {
  const namedSql = sql.replace(/@(\w+)/g, ':$1');
  const isNamedCall = (args) => args.length === 1 && args[0] !== null && typeof args[0] === 'object' && !Array.isArray(args[0]);

  async function execute(args) {
    if (isNamedCall(args)) {
      const [rows] = await pool.execute(namedSql, sanitizeParam(args[0]));
      return rows;
    }
    const [rows] = await pool.execute(sql, args.map(sanitizeParam));
    return rows;
  }

  return {
    async get(...args) {
      const rows = await execute(args);
      return Array.isArray(rows) ? rows[0] : undefined;
    },
    async all(...args) {
      const rows = await execute(args);
      return Array.isArray(rows) ? rows : [];
    },
    async run(...args) {
      const result = await execute(args);
      return { changes: result.affectedRows ?? 0, lastInsertRowid: result.insertId ?? null };
    },
  };
}

// Runs a single statement with no return value expected (DDL, PRAGMA-style
// session settings, etc.) - kept separate from prepare() since schema/setup
// code doesn't need the get/all/run shape.
async function exec(sql) {
  await pool.query(sql);
}

// Transaction helper matching the shape the route code already uses:
// `const tx = db.transaction(fn); await tx(...args);`. Unlike SQLite,
// MySQL transactions must stay pinned to one physical connection for their
// whole duration, so this checks out a dedicated connection from the pool,
// hands the callback a db-shaped object bound to THAT connection (same
// prepare/get/all/run interface), and commits or rolls back around it.
function transaction(fn) {
  return async (...args) => {
    const conn = await pool.getConnection();
    const scopedPrepare = (sql) => {
      const namedSql = sql.replace(/@(\w+)/g, ':$1');
      const isNamedCall = (a) => a.length === 1 && a[0] !== null && typeof a[0] === 'object' && !Array.isArray(a[0]);
      const run = async (a) => {
        if (isNamedCall(a)) {
          const [rows] = await conn.execute(namedSql, sanitizeParam(a[0]));
          return rows;
        }
        const [rows] = await conn.execute(sql, a.map(sanitizeParam));
        return rows;
      };
      return {
        get: async (...a) => { const r = await run(a); return Array.isArray(r) ? r[0] : undefined; },
        all: async (...a) => { const r = await run(a); return Array.isArray(r) ? r : []; },
        run: async (...a) => { const r = await run(a); return { changes: r.affectedRows ?? 0, lastInsertRowid: r.insertId ?? null }; },
      };
    };
    const scopedDb = { prepare: scopedPrepare, exec: async (sql) => { await conn.query(sql); } };

    try {
      await conn.beginTransaction();
      const result = await fn(scopedDb, ...args);
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  };
}

module.exports = { pool, prepare, exec, transaction };
