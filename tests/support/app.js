const fs = require('node:fs');
const path = require('node:path');
const Station = require('./station');

const root = path.join(__dirname, '..', '..');

// The first stream in a stream list file, in the format that server.js reads:
// a bare URL or "Name | URL" on each line, with # for comments.
function firstStream(file) {
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const url = line.slice(line.indexOf('|') + 1).trim();
    if (/^https?:\/\//i.test(url)) return url;
  }
  throw new Error(`${file} lists no stream URL`);
}

// The app under test: a server that already runs at BASE_URL. On staging this is
// the NGINX entry point. The suite does not start the server and does not touch
// its database; unique track names keep the scenarios apart (see World.onAir).
class App {
  constructor() {
    this.url = new URL(process.env.BASE_URL || 'http://localhost:3000/').href;
    this.origin = new URL(this.url).origin;
    this.checked = null;
  }

  // @live scenarios play this stream, whatever the server lists.
  get liveStreamUrl() {
    return process.env.LIVE_STREAM_URL || firstStream(path.join(root, 'stream_URL.txt'));
  }

  // The deterministic scenarios play the fake station, so the server must list it
  // first. Checked once per run, to give a clear message instead of failed steps.
  expectStationStream() {
    this.checked ??= (async () => {
      const streamsUrl = new URL('api/streams', this.url);
      let streams;
      try {
        const res = await fetch(streamsUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        streams = await res.json();
      } catch (err) {
        throw new Error(`Cannot get ${streamsUrl} (${err.message}). Start the app or set BASE_URL.`);
      }
      if (streams[0]?.url !== Station.STREAM_URL) {
        throw new Error(
          `The app at ${this.url} must list ${Station.STREAM_URL} as its first stream ` +
            `(STREAMS_FILE). It lists: ${JSON.stringify(streams.map((s) => s.url))}`
        );
      }
    })();
    return this.checked;
  }
}

module.exports = new App();
