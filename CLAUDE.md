# CLAUDE.md

[![CI](https://github.com/batkomahno2008/radio-learning/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/batkomahno2008/radio-learning/actions/workflows/ci.yml)

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

## Kubernetes (`deploy/k8s/`)

Plain manifests with Kustomize, no Helm (epic #1, D8). `deploy/k8s/README.md` has the
steps for staging, production, backup and restore.

- `base/` — namespace `radio-learning` (Pod Security `restricted`), NGINX
  (`radio-learning-proxy`), the app (`radio-learning`), Postgres (StatefulSet `postgres`),
  NetworkPolicies, PodDisruptionBudgets and the backup CronJob. The kustomization makes the
  ConfigMaps `radio-learning-streams` (the stream list, mounted at `/config/streams.txt`)
  and `radio-learning-proxy-env` (`APP_UPSTREAM`, `STATION_ORIGINS`, `REAL_IP_FROM`).
- `overlays/staging/` — for kind: images `radio-learning:ci` and `radio-learning-proxy:ci`,
  fake station stream list, NodePort 30080 on NGINX, small volumes. The Secret
  `radio-learning-db` comes from `db.env`, which `kind/db-env.sh` makes. Git ignores it.
- `overlays/prod/` — 2 replicas, `HTTPRoute` (Gateway API), placeholders for the Gateway, the
  host name and `REAL_IP_FROM`. The Secret is not in Git (`kubectl create secret`, README).
- `components/ingress/` — a generic `Ingress` that replaces the `HTTPRoute`. Never use the
  retired `ingress-nginx` controller or its annotations.
- `kind/` — `cluster.yaml`, `install-calico.sh` (kind needs Calico to enforce
  NetworkPolicy), `db-env.sh` and `netpol-test.sh` (the R8 test).
- Secret `radio-learning-db` keys: `DATABASE_URL`, `POSTGRES_USER`, `POSTGRES_DB`,
  `POSTGRES_PASSWORD`. All pods run as non-root with a read-only root file system and
  an `emptyDir` at `/tmp` (UID 1000 app, 101 NGINX, 70 Postgres).
- Only the Service `radio-learning-proxy` is reachable from outside. The NetworkPolicies
  let only the NGINX pods reach the app and only the app pods and the backup job reach
  Postgres. Pods use the label `app.kubernetes.io/name` for this. Keep the labels when you
  rename a workload.
- The image names in the manifests are `ghcr.io/batkomahno2008/radio-learning` and
  `ghcr.io/batkomahno2008/radio-learning-proxy`. Overlays and the deploy step set the tags
  with `images:` or `kustomize edit set image`. The Postgres image has a tag and a digest.
  The base tag `main` can run a stale image on a node (`IfNotPresent`), so the deploy step
  must set a real tag.
- `kind load` only the two `:ci` images. The kind node pulls Postgres by its digest, so it
  needs internet access (GitHub runners have it). For an offline node, see "Staging on
  kind" in `deploy/k8s/README.md`: import the image, then tag it under its digest name.

```bash
deploy/k8s/kind/db-env.sh                               # once, makes overlays/staging/db.env
kubectl kustomize deploy/k8s/overlays/staging           # also: overlays/prod
kubectl kustomize deploy/k8s/overlays/prod | kubeconform -strict -summary -kubernetes-version 1.37.0 \
  -schema-location default \
  -schema-location 'https://raw.githubusercontent.com/datreeio/CRDs-catalog/main/{{.Group}}/{{.ResourceKind}}_{{.ResourceAPIVersion}}.json'
                                                        # the second schema location is for the HTTPRoute
                                                        # CI pins its commit (CRDS_CATALOG_COMMIT in ci.yml)

kind create cluster --config deploy/k8s/kind/cluster.yaml   # host port 8080 -> NGINX
deploy/k8s/kind/install-calico.sh
kind load docker-image radio-learning:ci radio-learning-proxy:ci --name radio-learning   # only these two
kubectl apply -k deploy/k8s/overlays/staging
kubectl --namespace radio-learning wait --for=condition=Ready pod --all --timeout=300s
BASE_URL=http://localhost:8080/ npm run test:e2e        # use localhost, not another host name
deploy/k8s/kind/netpol-test.sh                          # R8: who can reach app and Postgres
kind delete cluster --name radio-learning
```

## CI pipeline (`.github/`)

`.github/workflows/ci.yml` runs on each PR, on each push to `main`, on tags `v*.*.*` and
by hand (`workflow_dispatch`). A new push to a PR cancels the old run of that PR.

| Job | Needs | What it does |
|---|---|---|
| `build` | – | Builds the `test` target (API tests), `runtime` as `radio-learning:ci` and `proxy` as `radio-learning-proxy:ci`, with the four label build arguments. Runs the image checks of #8 (no tests, no npm, no app code in `proxy`). Fills the build cache for `e2e`. Uploads the two images as the artifact `ci-images`. |
| `manifests` | – | `kubeconform` on the staging and prod overlays (Kubernetes 1.37.0, CRDs-catalog pinned to a commit) and `docker compose config` on the three Compose files. |
| `staging-e2e` | `build`, `manifests` | Matrix `target: [compose, kind]`. Loads the images, builds `e2e` from the cache, deploys, waits for `/healthz` and `/api/ready` through NGINX, runs the E2E image, then `@live` (does not block, D10). On kind, it also runs `netpol-test.sh`. It always removes the environment. |
| `security` | `build` | Calls `.github/workflows/security.yml` with `mode: report`. Scans the repository and the `ci-images` artifact, and uploads SARIF files to the Security tab. See "Security scans" below. |
| `publish` | `build`, `manifests`, `staging-e2e`, `security` | Only on a push to `main` or a `v*.*.*` tag. Pushes both images to GHCR. |

- A failed API test stops the run in `build`. Then no staging job and no `publish` job runs.
- A deploy step only deploys, and an E2E step only runs tests (rule 2.1). The composite
  actions keep them apart:
  - `.github/actions/staging-compose` and `.github/actions/staging-kind`: input `command`
    is `up`, `logs` or `down`. `up` makes a random Postgres password and gives the
    outputs `network`, `base-url` and `host-url`. `staging-kind` also gives `bin-dir`, the
    directory of the pinned `kind` and `kubectl`.
  - `staging-kind` does not change `PATH` for later steps (no `GITHUB_PATH`, zizmor
    `github-env`). A later step that needs the pinned `kubectl` puts `bin-dir` first in
    its own `PATH`, as the NetworkPolicy step in `ci.yml` does.
  - `.github/actions/run-e2e`: inputs `base-url`, `network`, `tags`, `profile`, `image`
    and `report-dir`. It runs the E2E image with `--shm-size=1g`.
- `BASE_URL` is always a loopback origin that reaches NGINX: Compose uses
  `--network container:<proxy>` and `http://localhost:8080/`, kind uses `--network host`
  and `http://localhost:8080/` (node port 30080). Compose staging publishes host port 18080,
  not 8080.
- The kind job loads only the two `:ci` images. The node pulls Postgres by its digest.
- When a step fails, or when `@live` fails, the job uploads the artifact
  `staging-e2e-<target>-report`: `reports/` (`cucumber.html`) and the NGINX, app and
  Postgres logs.
- `publish` tags both images the same: `sha-<short>`, `main`, `X.Y.Z`, `X.Y`, and `latest`
  only on a release tag (no pre-release part). It builds from the cache of `build`, with
  `provenance: mode=max` and `sbom: true`. It also makes a GitHub artifact attestation
  (`gh attestation verify`). The E2E image is never published.
- The workflow never changes a manifest. At release time, the operator sets the prod image
  tag with `kustomize edit set image`.
- `permissions: contents: read` for the workflow. Only `publish` has `packages: write`,
  `id-token: write` and `attestations: write`. Only `security` has `security-events: write`.
  Each action is pinned to a full commit SHA, with the version in a comment. kind, kubectl
  and kubeconform have a pinned version and a SHA-256 sum.

### Security scans (`.github/workflows/security.yml`, `docs/security/policy.md`)

The workflow uses existing tools only. The project has no custom scanner, rule, script or
exception tool (decision of the user, epic #1). `docs/security/policy.md` has the targets,
the tools with their pinned versions, the gates and the places for exceptions.

- Triggers: `workflow_call` (the `security` job of `ci.yml`) and a nightly `schedule`.
  The night run scans the published images with tag `main` and always uses `report` mode.
- Input `mode`: `report` (now) or `enforce`. In `report` mode the job passes. In both modes
  it writes a summary table (`$GITHUB_STEP_SUMMARY`) with the result counts of each tool for
  each severity, and the result of each scan, gate and SARIF upload step. `enforce` fails
  on a failed gate step. Issue #13 changes the value in `ci.yml`.
- The CodeQL gate is not in the workflow. It is a code scanning ruleset ("Require code
  scanning results", High or higher) that an admin sets (policy section 3.2, S8).
- Jobs: `repo` (S1, S3, S4, S5, S7 history, S8, S9), `images` (matrix `runtime` and
  `proxy`: S2, S7 images, S6) and `e2e-image` (S2, report only). `images` loads the images
  from the artifact `ci-images`. `e2e-image` builds the `e2e` image from the build cache.
- The gitleaks scan reads all branches. A branch with a secret, also a fake one, makes the
  S7 gate fail until you delete the branch.
- Tools: Trivy (npm, images, Dockerfile, Kubernetes), KICS (Compose), Gixy-Next (NGINX
  config from `nginx -T` of the `proxy` image), gitleaks (history), CodeQL (JavaScript and
  workflows), zizmor (workflows). KICS, Gixy-Next and gitleaks run from their official
  images, pinned by digest. The other tools run from their official Actions.
- Each scan uploads a SARIF file with its own category. The artifacts `security-sarif-*`
  keep the files for 7 days.
- To accept a risk, use the ignore file of the tool (`.trivyignore`, `.gitleaksignore`,
  `.github/zizmor.yml`, a KICS comment, `--skips` of Gixy-Next, a CodeQL dismissal). Write
  the reason, the owner and the expiry date next to the entry (policy section 5).
- To change a tool, change its version and its pin together. The `env` block of
  `security.yml` has the versions and the digests.

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
