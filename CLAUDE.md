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

The app needs Postgres. For local development, copy `.env.example` to `.env` and
change the password in `POSTGRES_PASSWORD` and `DATABASE_URL`. Then start Postgres 18
in Docker. The command reads the three `POSTGRES_` values from `.env`:

```bash
docker run -d --name radio-db --env-file .env -p 127.0.0.1:5432:5432 -v radio-db:/var/lib/postgresql postgres:18-alpine
```

The `radio-db` volume keeps the data. Use `docker stop radio-db` and
`docker start radio-db` to stop and start it. To delete all ratings, remove the
container and the volume (`docker rm -f radio-db && docker volume rm radio-db`).

```bash
npm start                 # node server.js on http://localhost:3000; reads .env
npm run dev               # same, restarting on file changes

# The e2e suite does not start the app. Start it first, in a different terminal,
# with the fake station as its stream list:
STREAMS_FILE=tests/fixtures/streams.txt npm start

npm run test:e2e          # full Cucumber suite against a fake station (~10 s)
npm run test:e2e:smoke    # only @smoke scenarios
npm run test:e2e:live     # only @live scenarios, against the real station feed

npx cucumber-js tests/features/ratings.feature:20        # one scenario, by line
npx cucumber-js --name "Giving a thumbs up"              # one scenario, by name
HEADED=1 SLOWMO=250 npm run test:e2e                     # watch it in a browser
BASE_URL=http://staging:8080/ npm run test:e2e           # test a deployed app
```

The e2e suite needs Playwright's Chromium once per machine:
`sudo npx playwright install --with-deps chromium`. The suite starts Chromium with no
special flags. Headless runs use the headless shell.

E2E runner variables:
- `BASE_URL` (default `http://localhost:3000/`): the app under test. On staging, this is
  the NGINX entry point. The suite needs no other access to the app.
- `LIVE_STREAM_URL` (default: the first stream in `stream_URL.txt`): the stream that
  `@live` scenarios play.

A failed run writes `reports/cucumber.html` with a full-page screenshot per listener.

## Architecture

A single-page internet radio player: an Express 5 app, a Postgres database, and one
static HTML page with its client script. CommonJS throughout. In deployments, NGINX
serves the static files and sends `/api/*` to the app (epic #1, decision D12).

- `config.js` — `loadConfig()` reads and checks all environment variables. A missing
  or wrong value stops the start with a clear message. Other modules do not read
  `process.env`.
- `db.js` — `createPool(config)` makes the `pg` pool (10 connections at most) and logs
  pool errors. `waitForDatabase(pool)` retries the first connection (10 attempts in
  about 30 s). `migrate(pool)` applies `schema.sql` in one transaction under
  `pg_advisory_xact_lock`, so app processes that start at the same time do not collide.
- `schema.sql` — applied on every start, so every statement must stay idempotent. Keep
  the SQL simple, because the API tests run it on pg-mem. For example, use
  `SUM(CASE WHEN ...)` and not `COUNT(*) FILTER (...)`.
- `app.js` — `createApp({ pool, streamsFile, serveStatic })` returns the Express app and
  does not listen. The caller gives the pool, so tests can give a pg-mem pool. The JSON
  API: `/api/streams`, `/api/ratings`, `/api/health` (liveness, no database) and
  `/api/ready` (readiness, 503 when the database is down). With `serveStatic`, it also
  serves `public/` and hls.js from `node_modules` at `/vendor/hls`. A JSON error handler
  answers with no stack trace and logs to stderr. Express sends no `X-Powered-By`.
- `server.js` — loads the config, makes the pool, waits for the database, runs
  `migrate`, makes the app, sets `trust proxy` and listens on `HOST:PORT`. It logs
  `Listening on ...`. On SIGTERM or SIGINT, it stops new connections, lets open
  requests finish, closes the pool and exits 0. After 10 s, it exits 1. The keep-alive
  timeout (65 s) is longer than the NGINX upstream idle time (60 s).
- `public/index.html` — markup only. It has no inline script, so the CSP can use
  `script-src 'self'`.
- `public/app.js` — the client script, no bundler. `index.html` loads it after hls.js.
- `public/styles.css` — all CSS, linked from `index.html`.

Environment variables (`.env.example` has all of them):

| Name | Default | Notes |
|---|---|---|
| `DATABASE_URL` | – (required) | `postgres://user:password@host:5432/database`. The app does not log it. |
| `HOST` | `127.0.0.1` | The address that the app listens on. A container uses `0.0.0.0`. |
| `PORT` | `3000` | |
| `STREAMS_FILE` | `stream_URL.txt` in the app directory | Read again on each `/api/streams` request. |
| `SERVE_STATIC` | `true` | `false`: the app does not serve `public/` and `/vendor/hls`, because NGINX serves them. |
| `TRUST_PROXY` | `false` | Express `trust proxy`. Deployments use `1` (one NGINX in front of the app). |

`npm start` and `npm run dev` read `.env` when it exists. A variable that the shell
sets has priority over `.env`.

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
  The server gets all tracks of a request in one query (`track = ANY($1)`).
- All queries use parameters (`$1`, `$2`, ...). Do not put request data into SQL text.
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
- **Secure context:** `crypto.randomUUID()` exists only in a secure context (HTTPS or
  `localhost`). Staging uses plain HTTP on a host name that is not `localhost`, so
  `public/app.js` then makes the client id (a UUID v4) from `crypto.getRandomValues()`.
  Chromium starts with no flag that changes this, so the suite tests what a real
  browser does. To test this path locally, start the app with `HOST=0.0.0.0` and use
  a `BASE_URL` with an address that is not loopback.
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
