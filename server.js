const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const db = require('./db');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor/hls', express.static(path.join(__dirname, 'node_modules/hls.js/dist')));

// One stream per line: either a bare URL or "Name | URL". Blank lines and
// lines starting with # are skipped. Read per request so edits apply on reload.
const streamsFile = process.env.STREAMS_FILE || path.join(__dirname, 'stream_URL.txt');

app.get('/api/streams', (req, res) => {
  let text;
  try {
    text = fs.readFileSync(streamsFile, 'utf8');
  } catch {
    return res.status(500).json({ error: 'stream list is unavailable' });
  }
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
  res.json(streams);
});

// Ratings are keyed by "Artist - Title" and an anonymous per-browser client id.
const ratingCounts = db.prepare(
  'SELECT COALESCE(SUM(value = 1), 0) AS up, COALESCE(SUM(value = -1), 0) AS down FROM ratings WHERE track = ?'
);
const ratingByClient = db.prepare('SELECT value FROM ratings WHERE track = ? AND client = ?');
const upsertRating = db.prepare(
  'INSERT INTO ratings (track, client, value) VALUES (?, ?, ?) ON CONFLICT (track, client) DO UPDATE SET value = excluded.value'
);
const deleteRating = db.prepare('DELETE FROM ratings WHERE track = ? AND client = ?');

const isKey = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max;

function ratingSummary(track, client) {
  return { ...ratingCounts.get(track), mine: ratingByClient.get(track, client)?.value ?? 0 };
}

const MAX_TRACKS = 20;

// Accepts one or more track params and responds with a summary per track.
app.get('/api/ratings', (req, res) => {
  const { client } = req.query;
  const tracks = [].concat(req.query.track ?? []);
  if (!isKey(client, 100) || !tracks.length || tracks.length > MAX_TRACKS || !tracks.every((t) => isKey(t, 500))) {
    return res.status(400).json({ error: `client and 1 to ${MAX_TRACKS} tracks are required` });
  }
  res.json(Object.fromEntries(tracks.map((track) => [track, ratingSummary(track, client)])));
});

// value is 1 (up), -1 (down) or 0 (clear).
app.post('/api/ratings', (req, res) => {
  const { track, client, value } = req.body ?? {};
  if (!isKey(track, 500) || !isKey(client, 100) || ![1, 0, -1].includes(value)) {
    return res.status(400).json({ error: 'track, client and a value of 1, 0 or -1 are required' });
  }
  if (value === 0) deleteRating.run(track, client);
  else upsertRating.run(track, client, value);
  res.json(ratingSummary(track, client));
});

app.get('/api/health',(req, res) => {
  const { version } = db.prepare('SELECT sqlite_version() AS version').get();
  res.json({ status: 'ok', sqlite: version });
});

// Bind to localhost only; this is a prototyping server, not a public one.
app.listen(port, '127.0.0.1', () => {
  console.log(`Listening on http://localhost:${port}`);
});
