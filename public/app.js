// The client script of index.html. It is a file and not an inline script, so the
// Content-Security-Policy can use script-src 'self'. index.html loads it after hls.js.
const audio = document.getElementById('audio');
const playBtn = document.getElementById('play');
const muteBtn = document.getElementById('mute');
const volume = document.getElementById('volume');
const statusEl = document.getElementById('status');
const stateEl = document.getElementById('state');
const streamQualityEl = document.getElementById('stream-quality');
const coverEl = document.getElementById('cover');
const ratingTemplate = document.getElementById('rating-template');

const LOSSLESS = /flac|alac/i;
const METADATA_INTERVAL_MS = 10000;
let hls = null;
let wantPlay = false;
let metadataBase = null;
let track = null;
let previousShown = '';
// Track key -> { up, down, mine }, shared by every widget showing that track.
const ratings = new Map();
const voting = new Set();
let voteEpoch = 0;

// Transient states show in the player; errors get their own line.
function setState(text, isError = false) {
  statusEl.textContent = isError ? '' : text;
  stateEl.textContent = isError ? text : '';
  stateEl.classList.toggle('error', isError);
  stateEl.hidden = !isError;
}

function levelCodec(level) {
  return level.audioCodec || level.attrs?.CODECS || '';
}

function levelLabel(level) {
  const codec = levelCodec(level);
  const kbps = level.bitrate ? ` ${Math.round(level.bitrate / 1000)} kbps` : '';
  // The manifest's declared bandwidth understates the FLAC rendition, so omit it.
  if (LOSSLESS.test(codec)) return '48kHz FLAC / HLS Lossless';
  if (/mp4a/i.test(codec)) return `AAC${kbps} / HLS`;
  return `${codec || 'Default'}${kbps} / HLS`;
}

function showFormat() {
  const level = hls?.levels[hls.currentLevel];
  streamQualityEl.textContent = `Stream quality: ${level ? levelLabel(level) : 'HLS'}`;
}

function teardown() {
  if (hls) { hls.destroy(); hls = null; }
  audio.removeAttribute('src');
  audio.load();
  showFormat();
}

function loadStream(url) {
  teardown();
  if (!url) return;
  setState('Connecting…');

  if (window.Hls && Hls.isSupported()) {
    hls = new Hls({ lowLatencyMode: false });
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      const levels = hls.levels;
      // Bitrate-based ABR would not reliably choose the lossless rendition,
      // so pin it explicitly whenever the stream offers one.
      const lossless = levels.findIndex((l) => LOSSLESS.test(levelCodec(l)));
      hls.currentLevel = lossless === -1 ? levels.length - 1 : lossless;
      showFormat();
      setState(wantPlay ? 'Buffering…' : 'Ready');
      if (wantPlay) play();
    });
    hls.on(Hls.Events.LEVEL_SWITCHED, showFormat);
    hls.on(Hls.Events.ERROR, (_, data) => {
      if (!data.fatal) return;
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        setState('Network problem, retrying…', true);
        hls.startLoad();
      } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        setState('Playback problem, recovering…', true);
        hls.recoverMediaError();
      } else {
        setState('This stream cannot be played.', true);
        wantPlay = false;
        teardown();
      }
    });
    hls.loadSource(url);
    hls.attachMedia(audio);
  } else if (audio.canPlayType('application/vnd.apple.mpegurl')) {
    // Native HLS (iOS Safari): the browser picks the rendition itself.
    audio.src = url;
    setState('Ready');
    if (wantPlay) play();
  } else {
    setState('This browser cannot play HLS streams.', true);
    playBtn.disabled = true;
  }
}

function play() {
  wantPlay = true;
  // Jump to the live edge instead of resuming stale buffered audio.
  if (hls?.liveSyncPosition) audio.currentTime = hls.liveSyncPosition;
  audio.play().catch((err) => {
    if (err.name === 'AbortError') return;
    wantPlay = false;
    setState(err.name === 'NotAllowedError' ? 'Press play to start.' : 'Could not start playback.', err.name !== 'NotAllowedError');
  });
}

function syncPlayIcon() {
  const playing = !audio.paused;
  // SVG elements have no `hidden` property, so toggle the attribute.
  document.getElementById('icon-play').toggleAttribute('hidden', playing);
  document.getElementById('icon-pause').toggleAttribute('hidden', !playing);
  playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
}

function syncMuteIcon() {
  const silent = audio.muted || audio.volume === 0;
  document.getElementById('icon-waves').toggleAttribute('hidden', silent);
  document.getElementById('icon-muted').toggleAttribute('hidden', !silent);
  muteBtn.setAttribute('aria-label', audio.muted ? 'Unmute' : 'Mute');
}

playBtn.addEventListener('click', () => {
  if (audio.paused) play();
  else { wantPlay = false; audio.pause(); }
});
audio.addEventListener('play', syncPlayIcon);
audio.addEventListener('pause', () => { syncPlayIcon(); if (!wantPlay) setState('Paused'); });
audio.addEventListener('playing', () => { setState('Live'); showFormat(); });
audio.addEventListener('waiting', () => { if (wantPlay) setState('Buffering…'); });

muteBtn.addEventListener('click', () => { audio.muted = !audio.muted; });
volume.addEventListener('input', () => { audio.volume = Number(volume.value); audio.muted = false; });
audio.addEventListener('volumechange', syncMuteIcon);
audio.volume = Number(volume.value);

function setText(id, text) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.hidden = !text;
}

// crypto.randomUUID() exists only in a secure context (HTTPS or localhost). Plain
// HTTP on another host name has only crypto.getRandomValues(), so make the same
// random UUID (version 4) from 16 random bytes.
function randomUUID() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx (RFC 9562)
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function clientId() {
  try {
    let id = localStorage.getItem('client');
    if (!id) { id = randomUUID(); localStorage.setItem('client', id); }
    return id;
  } catch {
    return null;
  }
}

function ratingWidget(key, name) {
  const widget = ratingTemplate.content.firstElementChild.cloneNode(true);
  widget.dataset.track = key || '';
  for (const btn of widget.querySelectorAll('button')) {
    const label = btn.dataset.value === '1' ? 'Thumbs up' : 'Thumbs down';
    btn.setAttribute('aria-label', name ? `${label} for ${name}` : label);
  }
  return widget;
}

const nowRating = ratingWidget(null);
nowRating.setAttribute('aria-labelledby', 'rating-label');
document.getElementById('rating').append(nowRating);

function showRatings() {
  const canRate = Boolean(clientId());
  for (const widget of document.querySelectorAll('.rating-controls')) {
    const key = widget.dataset.track;
    const rating = ratings.get(key);
    for (const btn of widget.querySelectorAll('button')) {
      const value = Number(btn.dataset.value);
      btn.setAttribute('aria-pressed', String(rating?.mine === value));
      btn.disabled = !key || !canRate;
      // Totals stay blank until the server has answered for this track.
      btn.nextElementSibling.textContent = rating ? (value === 1 ? rating.up : rating.down) : '';
    }
  }
}

async function loadRatings() {
  const client = clientId();
  const keys = new Set([...document.querySelectorAll('.rating-controls')].map((w) => w.dataset.track).filter(Boolean));
  showRatings();
  if (!client || !keys.size) return;
  const epoch = voteEpoch;
  try {
    const params = new URLSearchParams({ client });
    for (const key of keys) params.append('track', key);
    const res = await fetch(`/api/ratings?${params}`);
    if (!res.ok) return;
    const summaries = await res.json();
    // A vote that overlapped this request makes its totals stale; the next poll catches up.
    if (epoch !== voteEpoch) return;
    for (const [key, summary] of Object.entries(summaries)) ratings.set(key, summary);
    showRatings();
  } catch {}
}

async function rate(key, value) {
  const client = clientId();
  if (!key || !client || voting.has(key)) return;
  const before = ratings.get(key) || { up: 0, down: 0, mine: 0 };
  // Pressing the selected thumb again clears the rating.
  const mine = before.mine === value ? 0 : value;
  ratings.set(key, {
    up: before.up - (before.mine === 1) + (mine === 1),
    down: before.down - (before.mine === -1) + (mine === -1),
    mine,
  });
  voting.add(key);
  voteEpoch++;
  showRatings();
  try {
    const res = await fetch('/api/ratings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ track: key, client, value: mine }),
    });
    if (!res.ok) throw new Error(res.statusText);
    ratings.set(key, await res.json());
  } catch {
    ratings.set(key, before);
  }
  voting.delete(key);
  voteEpoch++;
  showRatings();
}

document.querySelector('main').addEventListener('click', (event) => {
  const btn = event.target.closest('.rating-controls button');
  if (btn) rate(btn.parentElement.dataset.track, Number(btn.dataset.value));
});

coverEl.addEventListener('load', () => { coverEl.hidden = false; });
coverEl.addEventListener('error', () => { coverEl.hidden = true; });

function showMetadata(meta) {
  setText('artist', meta.artist || 'Radio Learning');
  setText('title', (meta.title || 'Live stream') + (meta.date ? ` (${meta.date})` : ''));
  setText('album', meta.album || '');
  const source = [meta.bit_depth && `${meta.bit_depth}-bit`, meta.sample_rate && `${meta.sample_rate / 1000}kHz`].filter(Boolean).join(' ');
  setText('source-quality', source && `Source quality: ${source}`);

  const previous = [];
  for (let i = 1; meta[`prev_title_${i}`]; i++) {
    previous.push({ artist: meta[`prev_artist_${i}`], title: meta[`prev_title_${i}`] });
  }
  // Rebuild only when the list changes, so polling never replaces a button mid-click.
  const shown = JSON.stringify(previous);
  if (shown !== previousShown) {
    previousShown = shown;
    const rows = previous.map(({ artist, title }) => {
      const li = document.createElement('li');
      const text = document.createElement('span');
      const em = document.createElement('em');
      em.textContent = title;
      text.append(`${artist || 'Unknown artist'}: `, em);
      li.append(text);
      if (artist) li.append(ratingWidget(`${artist} - ${title}`, `${artist} - ${title}`));
      return li;
    });
    document.getElementById('previous').replaceChildren(...rows);
  }

  const key = meta.artist && meta.title ? `${meta.artist} - ${meta.title}` : null;
  if (key !== track) {
    track = key;
    nowRating.dataset.track = key || '';
    // The cover lives at a fixed URL, so vary the query to defeat the cache per track.
    coverEl.src = `${metadataBase}cover.jpg?t=${encodeURIComponent(key || '')}`;
  }
  // Reload on every poll so totals from other listeners stay current.
  loadRatings();
}

async function refreshMetadata() {
  try {
    const res = await fetch(`${metadataBase}metadatav2.json`, { cache: 'no-store' });
    if (res.ok) showMetadata(await res.json());
  } catch {
    // Keep showing the last known track.
  }
}

async function init() {
  let streams;
  try {
    const res = await fetch('/api/streams');
    if (!res.ok) throw new Error(res.statusText);
    streams = await res.json();
  } catch {
    setState('Could not load the stream list.', true);
    return;
  }
  if (!streams.length) {
    setState('Add a stream URL to stream_URL.txt.', true);
    return;
  }
  playBtn.disabled = false;
  loadStream(streams[0].url);

  // Track metadata and cover art are published at the root of the stream's host.
  metadataBase = new URL('/', streams[0].url).href;
  refreshMetadata();
  setInterval(refreshMetadata, METADATA_INTERVAL_MS);
}

init();
