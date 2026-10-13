const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const express = require('express');

const MAX_TRACKS = 20;

const isKey = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max;

// Request data in a log line (CodeQL js/log-injection). Remove CR and LF, so that a
// client cannot add a false log line. Show each other control character as \xNN,
// because a terminal can run some of them (for example the C1 character 0x9b).
// Show the line separators (U+2028, U+2029) and the bidi controls (U+202A to U+202E,
// U+2066 to U+2069) as \uNNNN, because a log viewer can show them as a new line or
// show the text in a different order.
const LOG_UNSAFE = /[\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069]/g;
const forLog = (value) =>
  String(value)
    .replace(/[\r\n]/g, '')
    .replace(LOG_UNSAFE, (c) => {
      const code = c.charCodeAt(0);
      return code > 0xff ? `\\u${code.toString(16).padStart(4, '0')}` : `\\x${code.toString(16).padStart(2, '0')}`;
    });

// Totals and the rating of one client for many tracks, in one query. A track with
// no ratings gets no row. CASE in place of FILTER, because pg-mem has no FILTER.
const RATING_SUMMARIES = `
  SELECT track,
         SUM(CASE WHEN value = 1 THEN 1 ELSE 0 END)::int AS up,
         SUM(CASE WHEN value = -1 THEN 1 ELSE 0 END)::int AS down,
         SUM(CASE WHEN client = $2 THEN value ELSE 0 END)::int AS mine
    FROM ratings
   WHERE track = ANY($1)
   GROUP BY track`;
const UPSERT_RATING = `
  INSERT INTO ratings (track, client, value) VALUES ($1, $2, $3)
  ON CONFLICT (track, client) DO UPDATE SET value = EXCLUDED.value`;
const DELETE_RATING = 'DELETE FROM ratings WHERE track = $1 AND client = $2';

// Ratings are keyed by "Artist - Title" and an anonymous per-browser client id.
async function ratingSummaries(pool, tracks, client) {
  const { rows } = await pool.query(RATING_SUMMARIES, [tracks, client]);
  const found = new Map(rows.map(({ track, up, down, mine }) => [track, { up, down, mine }]));
  return Object.fromEntries(tracks.map((track) => [track, found.get(track) ?? { up: 0, down: 0, mine: 0 }]));
}

// One stream per line: either a bare URL or "Name | URL". Blank lines and
// lines starting with # are skipped. Read per request so edits apply on reload.
function parseStreams(text) {
  const streams = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const sep = line.indexOf('|');
    const url = (sep === -1 ? line : line.slice(sep + 1)).trim();
    if (!/^https?:\/\//i.test(url)) continue;
    const name = sep === -1 ? '' : line.slice(0, sep).trim();
    streams.push({ name: name || new URL(url).hostname, url });
  }
  return streams;
}

// Makes the Express app. It does not listen; server.js does that. The caller owns
// the pool, so tests can give a pool for a different database (for example pg-mem).
function createApp({ pool, streamsFile, serveStatic = true }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());

  // In deployments NGINX serves these files, and the app serves only /api.
  if (serveStatic) {
    app.use(express.static(path.join(__dirname, 'public')));
    app.use('/vendor/hls', express.static(path.join(__dirname, 'node_modules/hls.js/dist')));
  }

  app.get('/api/streams', async (req, res) => {
    let text;
    try {
      text = await fs.readFile(streamsFile, 'utf8');
    } catch {
      return res.status(500).json({ error: 'stream list is unavailable' });
    }
    res.json(parseStreams(text));
  });

  // Accepts one or more track params and responds with a summary per track.
  app.get('/api/ratings', async (req, res) => {
    const { client } = req.query;
    const tracks = [].concat(req.query.track ?? []);
    if (!isKey(client, 100) || !tracks.length || tracks.length > MAX_TRACKS || !tracks.every((t) => isKey(t, 500))) {
      return res.status(400).json({ error: `client and 1 to ${MAX_TRACKS} tracks are required` });
    }
    res.json(await ratingSummaries(pool, tracks, client));
  });

  // value is 1 (up), -1 (down) or 0 (clear).
  app.post('/api/ratings', async (req, res) => {
    const { track, client, value } = req.body ?? {};
    if (!isKey(track, 500) || !isKey(client, 100) || ![1, 0, -1].includes(value)) {
      return res.status(400).json({ error: 'track, client and a value of 1, 0 or -1 are required' });
    }
    if (value === 0) await pool.query(DELETE_RATING, [track, client]);
    else await pool.query(UPSERT_RATING, [track, client, value]);
    res.json((await ratingSummaries(pool, [track], client))[track]);
  });

  // Liveness: the process answers. It does not use the database, so a database
  // failure does not make the orchestrator restart the app.
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // Readiness: the app can use the database. The orchestrator stops traffic to the
  // app while this returns 503. NGINX sends /api/* to the app, so this answer is
  // public: it shows no version data (audit N1, security policy 9.6).
  app.get('/api/ready', async (req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ready' });
    } catch (err) {
      console.error(`Readiness check failed: ${err.message}`);
      res.status(503).json({ status: 'unavailable' });
    }
  });

  // An API client gets JSON also for a path that does not exist.
  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'not found' });
  });

  // Express 5 sends errors from async handlers here, and also a body that is not
  // valid JSON. Answer with JSON and no stack trace; log the details to stderr.
  // Express finds an error handler by its four parameters, so keep `next`.
  // The format string of each log line is a constant. Request data goes in as an
  // argument, so a "%s" in a path is not a format specifier (CodeQL js/tainted-format-string).
  app.use((err, req, res, next) => {
    // Too late for a JSON answer: the Express default handler closes the connection.
    if (res.headersSent) return next(err);
    const status = err.status >= 400 && err.status < 500 ? err.status : 500;
    if (status === 500) console.error('%s %s failed:', req.method, forLog(req.path), err);
    else console.error('%s %s from %s: %d %s', req.method, forLog(req.path), forLog(req.ip), status, forLog(err.type || err.message));
    res.status(status).json({ error: status === 500 ? 'internal error' : http.STATUS_CODES[status] });
  });

  return app;
}

module.exports = { createApp };
