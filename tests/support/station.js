const fs = require('node:fs');
const path = require('node:path');

const fixtures = path.join(__dirname, '..', 'fixtures', 'station');
const baseMetadata = JSON.parse(fs.readFileSync(path.join(fixtures, 'metadata.json'), 'utf8'));

// A 1x1 PNG stands in for the cover art.
const COVER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64'
);
const CONTENT_TYPES = { '.m3u8': 'application/vnd.apple.mpegurl', '.mp4': 'video/mp4', '.m4s': 'video/iso.segment' };
const HISTORY_LENGTH = 5;
const CORS = { 'access-control-allow-origin': '*' };

// "Artist - Title"; a name without the separator is a title with no artist.
function parseTrack(name) {
  const sep = name.indexOf(' - ');
  return sep === -1 ? { artist: '', title: name } : { artist: name.slice(0, sep), title: name.slice(sep + 3) };
}

// Stands in for the station's host: serves the metadata feed, cover art and a
// short silent stream from fixtures, so scenarios control what is on air.
class Station {
  static ORIGIN = 'https://station.test';
  static STREAM_URL = `${Station.ORIGIN}/hls/live.m3u8`;

  constructor() {
    this.current = null;
    this.previous = [];
  }

  // Starts a new song; the one that was playing moves to the top of the history.
  play(name) {
    if (this.current) this.previous = [this.current, ...this.previous].slice(0, HISTORY_LENGTH);
    this.current = parseTrack(name);
  }

  setPrevious(names) {
    this.previous = names.map(parseTrack);
  }

  metadata() {
    const meta = { ...baseMetadata, ...this.current };
    this.previous.forEach(({ artist, title }, i) => {
      meta[`prev_artist_${i + 1}`] = artist;
      meta[`prev_title_${i + 1}`] = title;
    });
    return meta;
  }

  async attach(context) {
    // Anything else off-site (web fonts) gets an empty answer rather than a network call.
    await context.route(
      (url) => !['localhost', '127.0.0.1'].includes(url.hostname),
      (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' })
    );
    await context.route(`${Station.ORIGIN}/**`, (route) => this.serve(route));
  }

  serve(route) {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/metadatav2.json') return route.fulfill({ json: this.metadata(), headers: CORS });
    if (pathname === '/cover.jpg') return route.fulfill({ contentType: 'image/png', body: COVER, headers: CORS });
    const file = path.join(fixtures, path.normalize(pathname));
    if (!file.startsWith(fixtures) || !fs.existsSync(file)) return route.fulfill({ status: 404, headers: CORS });
    return route.fulfill({ contentType: CONTENT_TYPES[path.extname(file)], body: fs.readFileSync(file), headers: CORS });
  }
}

module.exports = Station;
