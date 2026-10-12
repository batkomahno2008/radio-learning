const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DataType, newDb } = require('pg-mem');
const request = require('supertest');
const { createApp } = require('../../app');
const { migrate } = require('../../db');

// Streams file with one of each kind of line that the parser must handle.
const STREAMS_TEXT = [
  '# Comment line',
  '',
  'https://one.test/live.m3u8',
  'Station Two | https://two.test/hls/live.m3u8',
  '   ',
  'ftp://three.test/live',
  'not a url at all',
  ' Station Four  |  http://four.test:8000/stream  ',
  '| https://five.test/live.m3u8',
  'Station Six | rtmp://six.test/live',
  '',
].join('\r\n');

// Makes a new in-memory database. The pool has the same interface as pg.Pool.
// pg-mem has no pg_advisory_xact_lock, so register a function that does nothing.
// The lock key in db.js is an integer literal, so the argument type is integer.
// Limit of pg-mem: a second migrate() on the same database fails its AST coverage
// check, because it does not accept a CREATE TABLE IF NOT EXISTS that it skips. Run
// migrate() once for each database, or pass { noAstCoverageCheck: true }.
function createMemoryPool(options) {
  const db = newDb(options);
  db.public.registerFunction({
    name: 'pg_advisory_xact_lock',
    args: [DataType.integer],
    returns: DataType.bool,
    implementation: () => true,
  });
  const { Pool } = db.adapters.createPg();
  return new Pool();
}

// Writes a streams file in a new temporary directory. Returns the file path.
function writeStreamsFile(text = STREAMS_TEXT) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radio-api-'));
  const file = path.join(dir, 'streams.txt');
  fs.writeFileSync(file, text);
  return file;
}

// Makes one test environment: a new database with the schema, a temporary streams
// file and the app. Each call gives a separate database, so no state is shared.
// supertest binds each request to a free port, so no test uses a fixed port.
// Call close() when the test ends.
async function createTestApp({ serveStatic = false, streamsText, trustProxy } = {}) {
  const pool = createMemoryPool();
  await migrate(pool);
  const streamsFile = writeStreamsFile(streamsText);
  const app = createApp({ pool, streamsFile, serveStatic });
  if (trustProxy !== undefined) app.set('trust proxy', trustProxy);
  return {
    app,
    pool,
    streamsFile,
    api: request(app),
    close: async () => {
      await pool.end();
      fs.rmSync(path.dirname(streamsFile), { recursive: true, force: true });
    },
  };
}

// Replaces console.error while fn runs, so a test can read what the app logs and the
// test output stays clean. Returns the logged lines (each argument list joined).
async function captureErrors(fn) {
  const lines = [];
  const original = console.error;
  console.error = (...args) => lines.push(args.map(String).join(' '));
  try {
    await fn();
  } finally {
    console.error = original;
  }
  return lines;
}

module.exports = { STREAMS_TEXT, captureErrors, createMemoryPool, createTestApp, writeStreamsFile };
