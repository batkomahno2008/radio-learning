const fs = require('node:fs');
const path = require('node:path');
const pg = require('pg');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

// All app processes use this key, so only one of them changes the schema at a time.
// The number has no other meaning.
const MIGRATION_LOCK = 'SELECT pg_advisory_xact_lock(7140256)';

// Start-up retry for a database that is not ready yet (for example, Postgres starts
// after the app in Compose): 10 attempts in about 30 seconds.
const CONNECT_ATTEMPTS = 10;
const CONNECT_DELAY_MS = [500, 1000, 2000, 4000, 5000];

function createPool({ databaseUrl }) {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    application_name: 'radio-learning',
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
  });
  // An idle client gets an error when Postgres stops or restarts. Without a
  // listener, this error stops the process. The pool replaces the client.
  pool.on('error', (err) => console.error(`Database pool error: ${err.message}`));
  return pool;
}

// SQLSTATE classes that do not go away with a retry: wrong password or user (28)
// and a database that does not exist (3D).
const isPermanent = (err) => /^(28|3D)/.test(err.code ?? '');

async function waitForDatabase(pool) {
  for (let attempt = 1; ; attempt++) {
    try {
      const client = await pool.connect();
      client.release();
      return;
    } catch (err) {
      if (attempt === CONNECT_ATTEMPTS || isPermanent(err)) throw err;
      const delay = CONNECT_DELAY_MS[Math.min(attempt, CONNECT_DELAY_MS.length) - 1];
      console.error(`Database is not ready (attempt ${attempt} of ${CONNECT_ATTEMPTS}): ${err.message}`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

// Applies schema.sql in one transaction. Each start runs it, so every statement in
// schema.sql must stay idempotent. Processes that start at the same time wait for
// the advisory lock, so the CREATE statements never run in parallel.
async function migrate(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(MIGRATION_LOCK);
    await client.query(schema);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { createPool, migrate, waitForDatabase };
