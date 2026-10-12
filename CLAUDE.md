# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Writing standard

Always use ASD-STE100 Simplified Technical English for all text that you write in this
project. This includes replies, documentation, code comments, commit messages and
pull request descriptions.

- Use approved words only, and use each word with one meaning.
- Use the active voice and the simple tenses.
- Write a maximum of 20 words in an instruction and 25 words in a description.
- Give one instruction in each sentence, and use the imperative form.
- Write a maximum of six sentences in a paragraph.
- Do not use noun clusters of more than three words.
- Do not change code identifiers, commands, file names or quoted text.

## Commands

Node version is pinned in `.nvmrc`. There is no build step and no linter.

```bash
npm start                 # node server.js on http://localhost:3000 (PORT overrides)
npm run dev               # same, restarting on file changes

# The e2e suite does not start the app. Start it first, in a different terminal,
# with the fake station as its stream list and a temporary database:
STREAMS_FILE=tests/fixtures/streams.txt DB_PATH=/tmp/radio-e2e.db npm start

npm run test:e2e          # full Cucumber suite against a fake station (~10 s)
npm run test:e2e:smoke    # only @smoke scenarios
npm run test:e2e:live     # only @live scenarios, against the real station feed

npx cucumber-js tests/features/ratings.feature:20        # one scenario, by line
npx cucumber-js --name "Giving a thumbs up"              # one scenario, by name
HEADED=1 SLOWMO=250 npm run test:e2e                     # watch it in a browser
BASE_URL=http://staging:8080/ npm run test:e2e           # test a deployed app
```

The e2e suite needs Playwright's Chromium once per machine:
`sudo npx playwright install --with-deps chromium`. The suite uses the full Chromium
(`channel: 'chromium'`), not the headless shell.

E2E runner variables:
- `BASE_URL` (default `http://localhost:3000/`): the app under test. On staging, this is
  the NGINX entry point. The suite needs no other access to the app.
- `LIVE_STREAM_URL` (default: the first stream in `stream_URL.txt`): the stream that
  `@live` scenarios play.

A failed run writes `reports/cucumber.html` with a full-page screenshot per listener.

## Architecture

A single-page internet radio player: an Express 5 server, a SQLite database and one
static HTML file. CommonJS throughout.

- `server.js` — serves `public/`, exposes hls.js from `node_modules` at `/vendor/hls`,
  and the JSON API (`/api/streams`, `/api/ratings`, `/api/health`). Binds to 127.0.0.1 only.
- `db.js` — opens the database with better-sqlite3 and executes `schema.sql` on every
  start, so every statement in `schema.sql` must stay idempotent.
- `public/index.html` — markup and client script in one file, no bundler.
- `public/styles.css` — all CSS, linked from `index.html`.

Environment overrides: `PORT`, `DB_PATH` (default `data/dev.db`), `STREAMS_FILE`
(default `stream_URL.txt`, re-read on every `/api/streams` request).

### NGINX proxy (`deploy/nginx/`)

In deployments, NGINX is the entry point (epic #1, D12). It serves `public/` and the
hls.js files at `/vendor/hls/`, and it sends `/api/*` to the app. `deploy/nginx/README.md`
has the file layout, the mounts, the variables and the test commands.

- Image: `nginxinc/nginx-unprivileged` (stable, alpine), pinned by digest. Port 8080 (HTTP)
  and 8443 (HTTPS, only when `tls/tls.conf` is mounted). NGINX writes only to `/tmp`.
- Variables: `APP_UPSTREAM` (default `app:3000`), `STATION_ORIGINS` (station origins for
  the CSP) and `REAL_IP_FROM` (off by default). `15-radio-learning.envsh` checks them at start.
- Edge controls: security headers and CSP on each answer, rate limits, connection limit,
  16 KiB body limit, gzip and a JSON access log. All limit values are in
  `templates/default.conf.template`. Do not make them environment variables.
- The CSP has `script-src 'self'`. Do not add an inline script or an inline event handler
  to `public/index.html`. Add a new off-site host to the CSP in the template.
- `GET /healthz` is the NGINX health check. It does not call the app. Port 8080 also
  serves `/.well-known/acme-challenge/` from `/var/www/acme` for certbot.
- Test: start the app, start the stock image with the files mounted (see the README), then
  `BASE_URL=http://localhost:8080/ npm run test:e2e`.

### How the page gets its data

The server only knows the stream URL. Track metadata and cover art are fetched by the
browser directly from the root of the stream's host (`metadatav2.json`, `cover.jpg`),
polled every 10 seconds. The previous-tracks list comes from the `prev_artist_N` /
`prev_title_N` fields of that same feed.

Playback uses hls.js and pins the lossless (FLAC) rendition whenever the manifest offers
one, rather than leaving the choice to bitrate-based switching.

### Ratings

- A track is identified by the string `"Artist - Title"`; there is no track table. The
  now-playing widget and a history row for the same song share one key, which is how a
  rating follows a track into the history.
- A listener is an anonymous UUID kept in `localStorage` under `client`.
- One row per (track, client) with value 1 or -1; clearing a rating deletes the row.
- `GET /api/ratings` takes one or more `track` params (max 20) and returns a map of
  `{ up, down, mine }` per track. The page makes one batched request per metadata poll.
- Votes are optimistic in the client. While a vote is being saved, further clicks on
  that track are ignored, and a poll response that overlapped a vote is discarded.

### Design references

`RadioLearning_Style_Guide.txt` (palette, typography, component rules) and
`RadioLearning_Layout.md` / `RadioLearningLayout.png` (target layout) are the source of
truth for visual changes. The CSS custom properties in `styles.css` mirror the palette.

## E2E tests (`tests/`)

Cucumber scenarios in `features/`, step definitions in `steps/`, Playwright page objects
in `pages/`, and the harness in `support/`.

- **App under test:** `support/app.js` reads `BASE_URL`. The suite does not start the
  server, does not write its stream list and does not touch its database. So it can
  run against a local `npm start` or a staging deployment, through NGINX.
- **Isolation:** each scenario gets a random 6-character token. The fake station adds
  it to each title that it serves, for example `Got to Be Real ~a1b2c3`. So each
  scenario rates tracks that no other scenario or earlier run has rated, also on a
  shared database. Production code has no test hooks.
- **On-air names:** `World.onAir(name)` maps a track name from a step to the name on
  the page. Use it for each track name, row text or title that goes to a page object.
  Do not change the text of the `.feature` files to show tokens.
- **Stream list:** deterministic scenarios use the stream list of the app. The app
  must list `https://station.test/hls/live.m3u8` first (`tests/fixtures/streams.txt`).
  A `Before` hook checks this once and stops with a clear message if it is wrong.
  `@live` scenarios route `GET /api/streams` in the browser to `LIVE_STREAM_URL`.
- **Fake station:** `support/station.js` intercepts `https://station.test/**` and serves
  metadata, cover art and a short silent FLAC stream from `fixtures/station/`. Steps such
  as `the station is playing "Artist - Title"` and `the station starts playing "..."`
  control what is on air. Requests to other origins than `BASE_URL` (web fonts) are
  stubbed.
- **Secure context:** the page uses `crypto.randomUUID()`, which needs a secure context.
  Chromium starts with `--unsafely-treat-insecure-origin-as-secure` for the `BASE_URL`
  origin, because staging uses plain HTTP on a host name that is not `localhost`.
  The flag hides a known product limit (audit N7). #6 removes the flag and the
  `channel: 'chromium'` line when it adds a fallback for the client id.
- **No waiting for polls:** each browser context has Playwright's clock installed;
  `PlayerPage.pollStation()` fast-forwards 10 seconds to trigger the next metadata poll.
- **Listeners:** steps name an actor ("Alice", "Bob"). `World.player(name)` lazily opens
  a separate browser context per name, which gives each one its own client id.
- **Track references in steps:** the `{track}` parameter is either `the current track`
  or `"Artist - Title" in the history`.
- **Locators** use roles and accessible names (for example
  `Thumbs up for Artist - Title`), so renaming an `aria-label` in `index.html` breaks
  the page objects.
- **Clean-console rule:** a passing scenario is failed in the `After` hook if the page
  logged a console error, threw, or got a non-2xx answer from the `BASE_URL` origin.
  Chromium logs a CSP violation as a console error, so a CSP violation also fails the
  scenario. `@live` scenarios are exempt and use the real stream and the real clock.
- `RatingWidget.vote()` waits for the POST to finish before returning; keep that when
  adding steps that click thumbs back to back, because of the click-ignoring rule above.
- Tags: `@smoke`, `@live` (excluded from the default profile), `@wip` (always excluded).
