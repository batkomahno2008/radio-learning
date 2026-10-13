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
docker run -d --name radio-db --env-file .env -p 127.0.0.1:5432:5432 -v radio-db:/var/lib/postgresql postgres:18.6-alpine
```

The `radio-db` volume keeps the data. Use `docker stop radio-db` and
`docker start radio-db` to stop and start it. To delete all ratings, remove the
container and the volume (`docker rm -f radio-db && docker volume rm radio-db`).

```bash
npm start                 # node server.js on http://localhost:3000; reads .env
npm run dev               # same, restarting on file changes

npm run test:api          # API tests on pg-mem (~3 s). They need no network and no Postgres

# The e2e suite does not start the app. Start it first, in a different terminal,
# with the fake station as its stream list:
STREAMS_FILE=tests/fixtures/streams.txt npm start

npm run test:e2e          # full Cucumber suite against a fake station (~10 s)
npm run test:e2e:smoke    # only @smoke scenarios
npm run test:e2e:live     # only @live scenarios, against the real station feed

npx cucumber-js tests/features/ratings.feature:20        # one scenario, by line
npx cucumber-js --name "Giving a thumbs up"              # one scenario, by name
HEADED=1 SLOWMO=250 npm run test:e2e                     # watch it in a browser
BASE_URL=http://localhost:8080/ npm run test:e2e         # test a deployed app (NGINX)
```

With plain HTTP, `BASE_URL` must be a loopback origin (`localhost` or `127.0.0.1`) or an
HTTPS origin. Another host name is not a secure context. Chromium then logs a console error for the
`Cross-Origin-Opener-Policy` header of NGINX, and the clean-console rule fails each scenario.

The e2e suite needs Playwright's Chromium once per machine:
`sudo npx playwright install --with-deps chromium`. The suite starts Chromium with no
special flags. Headless runs use the headless shell.

E2E runner variables:
- `BASE_URL` (default `http://localhost:3000/`): the app under test. On staging, this is
  the NGINX entry point. The suite needs no other access to the app.
- `LIVE_STREAM_URL` (default: the first stream in `stream_URL.txt`): the stream that
  `@live` scenarios play.

A failed run writes `reports/cucumber.html` with a full-page screenshot per listener.

The `Dockerfile` builds the images, and `compose.yaml` runs them (see "Docker images and
Compose" below). Docker needs BuildKit, which is the default.

```bash
docker build .                                    # runs the API tests, makes the runtime image
docker build --target test .                      # only the API tests
docker build --target proxy -t radio-learning-proxy:local .   # NGINX image
docker build --target e2e -t radio-learning-e2e:local .       # E2E runner image

cp .env.example .env                              # then set POSTGRES_PASSWORD
docker compose up -d --build --wait               # production stack: proxy, app, db (builds the images)
docker compose -f compose.yaml -f deploy/compose/compose.staging.yaml up -d --wait   # staging
docker compose down -v                            # stop a stack and delete its data
```

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
  `/api/ready` (readiness: `SELECT 1`, 503 when the database is down). The two health
  answers show no version data, because NGINX makes them public. An unknown `/api/*`
  path gets a JSON 404. With `serveStatic`, the app also serves `public/` and hls.js
  from `node_modules` at `/vendor/hls`. A JSON error handler answers with no stack
  trace and logs to stderr. Express sends no `X-Powered-By`.
- `server.js` — loads the config, makes the pool, the app and the HTTP server, adds the
  SIGTERM and SIGINT handlers, waits for the database, runs `migrate` and listens on
  `HOST:PORT`. It logs `Listening on ...`. A signal before `Listening on` closes the
  pool and exits 0. A signal after it stops new connections, lets open requests finish,
  closes the pool and exits 0. After 10 s, it exits 1. The keep-alive timeout (65 s)
  is longer than the NGINX upstream idle time (4 s, `keepalive_timeout` in the template).
- Request headers: Node accepts 96 KiB (`maxHeaderSize`), because the largest valid
  `GET /api/ratings` (20 tracks of 500 characters) is about 90 KB. Keep this value the
  same as `large_client_header_buffers` in the NGINX config.
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

### Docker images and Compose (`Dockerfile`, `compose.yaml`, `deploy/compose/`)

One `Dockerfile` has these targets (epic #1, decision D7). `runtime` is the last stage, so it
is the default target. Each base image has a tag and a digest. Change both together.

| Target | Image | Content |
|---|---|---|
| `test` | – | Runs `npm run test:api` and writes `/test-passed`. It needs no network and no database. |
| `e2e` | `radio-learning-e2e` | The Playwright image, `tests/`, `cucumber.js` and dev dependencies. No app code. Runs as `pwuser`. Not published. |
| `proxy` | `ghcr.io/batkomahno2008/radio-learning-proxy` | NGINX config from `deploy/nginx/`, `public/` and the hls.js files (no source maps). No app code. Runs as UID 101. |
| `runtime` | `ghcr.io/batkomahno2008/radio-learning` | `server.js`, `app.js`, `db.js`, `config.js`, `schema.sql`, `stream_URL.txt` and the production dependencies. Runs as UID 1000. |

- `runtime` and `proxy` copy `/test-passed` from `test`. So a failed API test fails their build.
  BuildKit caches a passed test, so a build with unchanged inputs does not run it again.
- `runtime` has no tests, no `public/`, no dev dependencies, no hls.js and no npm, npx, corepack
  or yarn. It sets `NODE_ENV=production`, `HOST=0.0.0.0`, `SERVE_STATIC=false` and `TRUST_PROXY=1`.
  The entry point is `node server.js` in exec form, so Node is PID 1 and gets SIGTERM.
- Both images have a `HEALTHCHECK`: `GET /api/health` on port 3000 and `GET /healthz` on port 8080.
- The label build arguments are `IMAGE_SOURCE`, `IMAGE_REVISION`, `IMAGE_VERSION` and `IMAGE_CREATED`.
- `.dockerignore` keeps `.git`, `data/`, `reports/`, `docs/`, `node_modules`, `.env*` and the
  Compose files out of the build context. It keeps `tests/` in the context, because `test` and
  `e2e` copy it.
- `runtime` copies its files by name, not with `COPY . .`. If you add a file that the app needs
  at run time, add its name to that `COPY` line. A new app file may also need a new
  `--test-coverage-include` entry in `test:api`.

`compose.yaml` runs three services. Only `proxy` has `ports:` (policy rule R8). Do not add a
port to `app` or `db`, and do not add `compose.override.yaml`, because Compose loads it by itself.

| Service | Image | Notes |
|---|---|---|
| `proxy` | `${PROXY_IMAGE}` (default `ghcr.io/.../radio-learning-proxy:latest`) | Publishes `${HTTP_PORT:-80}` to 8080. Waits for a healthy `app`. |
| `app` | `${APP_IMAGE}` (default `ghcr.io/.../radio-learning:latest`) | `stop_grace_period: 15s`. Mounts the stream list read-only. Waits for a healthy `db`. |
| `db` | `postgres:18.6-alpine`, pinned by digest | Runs as UID 70. Named volume `db-data` at `/var/lib/postgresql`. `pg_isready` health check. |

- Networks: `edge` (`proxy`, `app`) and `backend` (`app`, `db`, with no route to the outside).
- All services have `read_only: true`, a `tmpfs` for `/tmp`, `cap_drop: [ALL]`,
  `no-new-privileges:true`, CPU and memory limits, and a numeric `user`.
- Secrets come from `.env` (Git ignores it). Compose puts `POSTGRES_PASSWORD` into the
  `DATABASE_URL` of the app, so use URL-safe characters. Example: `openssl rand -hex 24`.
- Compose variables (`.env.example` lists them): `POSTGRES_PASSWORD` (required), `POSTGRES_USER`,
  `POSTGRES_DB`, `APP_IMAGE`, `PROXY_IMAGE`, `HTTP_PORT`, `HTTPS_PORT`, `STATION_ORIGINS`
  (default: the real station) and `STREAMS_HOST_FILE` (default `./stream_URL.txt`).
- Run `docker compose` from the repository root. Compose resolves each relative path in the
  added files from the directory of `compose.yaml`.
- `docker compose up --build` builds `app` and `proxy` from the `Dockerfile`. The published
  images do not exist before the first release.
- `docker compose stop app` takes less than 1 s, because the app handles SIGTERM.
- The `acme` volume is the certbot webroot. NGINX mounts it read-only at `/var/www/acme`.

**Staging** (`deploy/compose/compose.staging.yaml`) is a temporary stack for the E2E tests. It
does not build: `APP_IMAGE` and `PROXY_IMAGE` are required. It has no named volume (the database
lives in memory) and no TLS. The project name is `radio-learning-staging-${STAGING_ID}`, so two
stacks can run at the same time. The app reads `tests/fixtures/streams.txt` from the checkout.
`STATION_ORIGINS` lists `https://station.test` and the real station, so `@live` runs through NGINX.

```bash
export POSTGRES_PASSWORD=$(openssl rand -hex 24) STAGING_ID=local HTTP_PORT=8080 \
  APP_IMAGE=radio-learning:local PROXY_IMAGE=radio-learning-proxy:local
docker compose -f compose.yaml -f deploy/compose/compose.staging.yaml up -d --wait
docker run --rm --network host --shm-size=1g -e BASE_URL=http://localhost:8080/ radio-learning-e2e:local
docker run --rm --network host --shm-size=1g -e BASE_URL=http://localhost:8080/ radio-learning-e2e:local --profile live
docker compose -f compose.yaml -f deploy/compose/compose.staging.yaml down -v
```

The E2E runner must reach NGINX on a loopback origin (`localhost` or `127.0.0.1`). A page on
plain HTTP with another host name (for example `http://proxy:8080/`) is not a secure context.
Chromium then logs a console error for the `Cross-Origin-Opener-Policy` header, and the
clean-console rule fails each scenario. NGINX keeps the header, and the harness has no
exception (decision on PR #24). Use `--network host` with the published port, or
`--network container:<proxy container>` with `BASE_URL=http://localhost:8080/`.

The Compose files need Docker Compose 2.24.0 or later (`!reset`) and Docker Engine 25 or later
(`start_interval` in the health checks).

**TLS** (`deploy/compose/compose.tls.yaml`, decision D14) adds port `${HTTPS_PORT:-443}`. It mounts
`deploy/nginx/tls/tls.conf` and the directory in `CERTS_DIR` (`fullchain.pem` and `privkey.pem`)
read-only. Keep the certificates outside the repository. UID 101 must read `privkey.pem`, for
example with mode 0640 and group 101. NGINX then sends each HTTP request except `/healthz` to HTTPS.

```bash
CERTS_DIR=/etc/radio-learning/certs docker compose -f compose.yaml -f deploy/compose/compose.tls.yaml up -d --wait
```

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

## Tests

There are two test suites. Each suite runs in a different place (epic #1, decisions D3 and D4).

| Suite | Command | Runs | Database |
|---|---|---|---|
| API tests (`tests/api/`) | `npm run test:api` | In the build, in the Dockerfile `test` stage | pg-mem, in memory |
| E2E tests (`tests/features/` and others) | `npm run test:e2e` | On staging, through NGINX | The real Postgres |

The API tests find faults in the HTTP API and in SQL early and fast. The E2E tests find
faults in the full system. NGINX behavior (headers, rate limits) is not in the API tests.

## API tests (`tests/api/`)

The tests use the built-in `node:test` runner, `supertest` and `pg-mem`. They call the
real `createApp()` and `migrate()` with a pg-mem pool. They need no network, no running
server and no Postgres.

- `helpers.js` — `createTestApp({ serveStatic, streamsText, trustProxy })` makes a new
  pg-mem database, runs `migrate`, writes a temporary streams file and returns the app,
  a `supertest` client (`api`), the pool and `close()`. Call it in `beforeEach` and call
  `close()` in `afterEach`. `captureErrors(fn)` returns what the app writes to
  `console.error` while `fn` runs.
- `*.test.js` — one file for each area: `streams`, `ratings-get`, `ratings-post`,
  `system` (health, ready, 404, error answers, static files, trust proxy), `config` and
  `db` (`migrate`, `waitForDatabase`, `createPool`).
- The runner starts each file in its own process. Each test makes its own database, so
  files and tests share no state. `supertest` uses a free port, so no test uses a fixed port.
- `npm run test:api` uses a glob (`"tests/api/*.test.js"`), not the directory `tests/api/`.
  Node 22 and Node 24 (24.21.0, the `.nvmrc` version) both fail with the directory form
  (`Cannot find module '.../tests/api'`). Do not put it back. `helpers.js` is not a test file.
- The script fails when line coverage is below 80%. Coverage counts `app.js`,
  `config.js` and `db.js` only (`--test-coverage-include`). `server.js` starts a server
  when `require` loads it, so the E2E tests cover it. Add each new app file to the script.
- Add a test for each new route, each new rule of validation and each new SQL statement.
  Check a new test: break the code on purpose, run the tests, and see the test fail.

Limits of pg-mem (version 3.0.14), and what the tests do about them:

- It has no `pg_advisory_xact_lock`. `createMemoryPool()` registers a function that does
  nothing. The argument type is `integer`, because the key in `db.js` is an integer literal.
- A second `migrate()` on the same database fails its AST coverage check. Run `migrate()`
  once for each database. The test of idempotence uses `newDb({ noAstCoverageCheck: true })`.
- It has no `FILTER (WHERE ...)`. The SQL uses `SUM(CASE WHEN ...)`. Keep the SQL simple.
- It does not check what Postgres 18 does, for example locks and concurrent writes. The
  E2E tests on staging check the real Postgres.

## E2E tests (`tests/` except `tests/api/`)

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
  `localhost`). On plain HTTP with a host name that is not loopback, `public/app.js` makes the
  client id (a UUID v4) from `crypto.getRandomValues()`. Chromium starts with no flag that
  changes this, so the suite tests what a real browser does. Staging E2E goes through NGINX
  and reaches it on a loopback origin (decision on PR #24), so the page uses
  `crypto.randomUUID()` there, as in production. To test the fallback, run the suite
  directly against the app (no NGINX, so no COOP header): start it with `HOST=0.0.0.0`
  and use a `BASE_URL` with an address that is not loopback.
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
