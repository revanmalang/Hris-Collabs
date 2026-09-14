require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./index');
const { seedPermissions } = require('../services/permissions');
const { explainDbError } = require('./friendlyErrors');

// mysql2's pool.query() runs one statement per call by default (no
// multi-statement execution), so schema.sql is split on top-level `;`
// boundaries. The schema has no stored procedures/triggers with embedded
// semicolons, so a plain split is safe here.
function splitStatements(sql) {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith('--'));
}

// Re-running migrate.js against an already-migrated database should be
// safe. CREATE TABLE IF NOT EXISTS already handles that for tables, but
// the standalone ALTER TABLE (adding the departments->employees FK after
// both tables exist) has no "IF NOT EXISTS" equivalent in stock
// MySQL/MariaDB, so a duplicate-constraint error on re-run is expected
// and ignored here rather than treated as a real failure.
async function runStatement(stmt) {
  try {
    await db.exec(stmt);
  } catch (err) {
    const alreadyExists = /already exists|Duplicate (key name|column name)|Duplicate key on write or update/i.test(err.message);
    if (!alreadyExists) throw err;
  }
}

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  for (const stmt of splitStatements(sql)) {
    await runStatement(stmt);
  }

  await seedPermissions();

  console.log('Migration complete. Tables ready in database', process.env.DB_NAME || 'employeehub');
  await db.pool.end();
}

main().catch((err) => {
  const friendly = explainDbError(err);
  if (friendly) {
    console.error('\n❌ Migration gagal:\n');
    console.error(friendly);
    console.error('');
  } else {
    console.error('Migration failed:', err.message);
  }
  process.exit(1);
});
