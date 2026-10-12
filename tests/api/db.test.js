const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it, mock } = require('node:test');
const { createPool, migrate, waitForDatabase } = require('../../db');
const { captureErrors, createMemoryPool } = require('./helpers');

const SCHEMA = fs.readFileSync(path.join(__dirname, '../../schema.sql'), 'utf8');

// A pool with a client that records its queries. fail(sql) decides which one throws.
function recordingPool(fail = () => false) {
  const queries = [];
  const state = { released: 0 };
  const client = {
    query: async (sql) => {
      queries.push(sql);
      if (fail(sql)) throw new Error(sql === 'ROLLBACK' ? 'rollback failed' : 'query failed');
    },
    release: () => state.released++,
  };
  return { pool: { connect: async () => client }, queries, state };
}

describe('migrate', () => {
  it('creates the ratings table on a new database', async () => {
    const pool = createMemoryPool();
    await migrate(pool);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM ratings');
    assert.equal(rows[0].n, 0);
    await pool.end();
  });

  it('is idempotent on one database: a second run keeps the table and its rows', async () => {
    // pg-mem needs noAstCoverageCheck for a second run (see helpers.js).
    const pool = createMemoryPool({ noAstCoverageCheck: true });
    await migrate(pool);
    await pool.query("INSERT INTO ratings (track, client, value) VALUES ('A - B', 'alice', 1)");
    await migrate(pool);
    await migrate(pool);
    const { rows } = await pool.query('SELECT track, client, value FROM ratings');
    assert.deepEqual(rows, [{ track: 'A - B', client: 'alice', value: 1 }]);
    await pool.end();
  });

  it('gives each database its own state', async () => {
    const one = createMemoryPool();
    const two = createMemoryPool();
    await migrate(one);
    await migrate(two);
    await one.query("INSERT INTO ratings (track, client, value) VALUES ('A - B', 'alice', 1)");
    const { rows } = await two.query('SELECT count(*)::int AS n FROM ratings');
    assert.equal(rows[0].n, 0);
    await Promise.all([one.end(), two.end()]);
  });

  it('makes a table that allows one row for each (track, client) and the values 1 and -1', async () => {
    const pool = createMemoryPool();
    await migrate(pool);
    const insert = (client, value) =>
      pool.query('INSERT INTO ratings (track, client, value) VALUES ($1, $2, $3)', ['A - B', client, value]);
    await insert('alice', 1);
    await insert('bob', -1);
    await assert.rejects(insert('alice', -1), /duplicate key|unique/i);
    await assert.rejects(insert('carol', 0), /check|constraint/i);
    await assert.rejects(insert('carol', 2), /check|constraint/i);
    await pool.end();
  });

  it('runs in one transaction: BEGIN, the advisory lock, schema.sql, COMMIT', async () => {
    const { pool, queries, state } = recordingPool();
    await migrate(pool);
    assert.deepEqual(queries, ['BEGIN', 'SELECT pg_advisory_xact_lock(7140256)', SCHEMA, 'COMMIT']);
    assert.equal(state.released, 1);
  });

  it('rolls back, releases the client and passes on the error when the schema fails', async () => {
    const { pool, queries, state } = recordingPool((sql) => sql === SCHEMA);
    await assert.rejects(migrate(pool), /query failed/);
    assert.deepEqual(queries.slice(-2), [SCHEMA, 'ROLLBACK']);
    assert.ok(!queries.includes('COMMIT'));
    assert.equal(state.released, 1);
  });

  it('passes on the first error also when the rollback fails', async () => {
    const { pool, state } = recordingPool((sql) => sql === SCHEMA || sql === 'ROLLBACK');
    await assert.rejects(migrate(pool), /query failed/);
    assert.equal(state.released, 1);
  });
});

describe('waitForDatabase', () => {
  const connectError = (code) => Object.assign(new Error(`connect failed ${code}`), { code });

  it('returns at once when the first connection works', async () => {
    let released = 0;
    await waitForDatabase({ connect: async () => ({ release: () => released++ }) });
    assert.equal(released, 1);
  });

  it('tries again after a transient error, with a delay', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let calls = 0;
    const pool = {
      connect: async () => {
        if (++calls < 3) throw connectError('ECONNREFUSED');
        return { release() {} };
      },
    };
    const flush = () => new Promise((resolve) => setImmediate(resolve));
    let done = false;
    const lines = await captureErrors(async () => {
      const waiting = waitForDatabase(pool).then(() => (done = true));
      await flush();
      assert.equal(calls, 1);
      t.mock.timers.tick(500);
      await flush();
      assert.equal(calls, 2);
      t.mock.timers.tick(1000);
      await waiting;
    });
    assert.ok(done);
    assert.equal(calls, 3);
    // Node may log a warning about the experimental mock timers; ignore it.
    const logged = lines.filter((line) => line.startsWith('Database is not ready'));
    assert.deepEqual(logged.map((line) => line.replace(/ connect failed.*/, '')), [
      'Database is not ready (attempt 1 of 10):',
      'Database is not ready (attempt 2 of 10):',
    ]);
  });

  it('stops at once for a wrong password (28...) and a missing database (3D...)', async () => {
    for (const code of ['28P01', '3D000']) {
      let calls = 0;
      const pool = {
        connect: async () => {
          calls++;
          throw connectError(code);
        },
      };
      await assert.rejects(waitForDatabase(pool), new RegExp(code));
      assert.equal(calls, 1);
    }
  });

  it('gives up after 10 attempts', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let calls = 0;
    const pool = {
      connect: async () => {
        calls++;
        throw connectError('ECONNREFUSED');
      },
    };
    const flush = () => new Promise((resolve) => setImmediate(resolve));
    await captureErrors(async () => {
      const waiting = assert.rejects(waitForDatabase(pool), /ECONNREFUSED/);
      for (let i = 0; i < 9; i++) {
        await flush();
        t.mock.timers.tick(5000);
      }
      await waiting;
    });
    assert.equal(calls, 10);
  });
});

describe('createPool', () => {
  it('makes a pool with the limits of the app', async () => {
    const pool = createPool({ databaseUrl: 'postgres://u:p@127.0.0.1:1/d' });
    assert.equal(pool.options.max, 10);
    assert.equal(pool.options.connectionTimeoutMillis, 5000);
    assert.equal(pool.options.application_name, 'radio-learning');
    await pool.end();
  });

  it('logs a pool error and does not throw it', async () => {
    const pool = createPool({ databaseUrl: 'postgres://u:p@127.0.0.1:1/d' });
    const lines = await captureErrors(async () => {
      pool.emit('error', new Error('terminating connection due to administrator command'));
    });
    assert.deepEqual(lines, ['Database pool error: terminating connection due to administrator command']);
    await pool.end();
  });
});
