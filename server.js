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

app.get('/api/health', (req, res) => {
  const { version } = db.prepare('SELECT sqlite_version() AS version').get();
  res.json({ status: 'ok', sqlite: version });
});

// Bind to localhost only; this is a prototyping server, not a public one.
app.listen(port, '127.0.0.1', () => {
  console.log(`Listening on http://localhost:${port}`);
});
