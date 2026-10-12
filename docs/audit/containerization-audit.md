# Containerization audit

This audit lists each item that stops Radio Learning from running well in a container
and behind NGINX. It belongs to issue #2 of epic #1.

## Scope and method

- Date: 2026-10-12. Commit: `857da33` on `main`.
- Files read: `server.js`, `db.js`, `schema.sql`, `public/index.html`, `public/styles.css`,
  `package.json`, `.nvmrc`, `.gitignore`, `stream_URL.txt`, `cucumber.js` and `tests/support/*`.
- No code changed. Each action below belongs to the owner issue.
- The local Node version was 22. The repository pins 24 in `.nvmrc`. The audit does not depend on the difference.

## How to read the tables

- Risk: High means the container or the proxy fails. Medium means a wrong or weak result. Low means a small effect.
- Owner: the one issue from epic #1 that does the action. A second issue is named in the action when it helps.
- "Accepted risk" means no issue acts. The reason is in the action column.

## Findings from the plan (issue #2, section "Context")

| ID | Finding | Risk | Action | Owner |
|---|---|---|---|---|
| C1 | `server.js` binds to `127.0.0.1` only (`app.listen(port, '127.0.0.1')`). A container cannot receive traffic. | High | Read `HOST` (default `127.0.0.1`) and `PORT`. The image sets `HOST=0.0.0.0` (#8). | #6 |
| C2 | `db.js` runs `fs.mkdirSync` for `data/` next to the code. This fails on a read-only root file system. | High | The Postgres change removes the file access in `db.js`. Confirm that the app writes no file at run time. | #6 |
| C3 | `server.js` has no `SIGTERM` or `SIGINT` handler. Compose and Kubernetes send `SIGTERM`, so the app ends with open requests and open connections. | High | Stop the listener, wait for open requests, close the pool, then exit. Set a time limit. | #6 |
| C4 | The app reads `stream_URL.txt` from the code directory. `STREAMS_FILE` exists, but deployments have no mounted file. | Medium | Keep `STREAMS_FILE`. Mount the file in Compose (#8) and use a ConfigMap in Kubernetes (#9). The runtime image must not depend on the file in the code directory. | #8 |
| C5 | `/vendor/hls` comes from `node_modules/hls.js/dist`. The runtime image has no `node_modules` for hls.js and no static files. | High | The `proxy` image build copies the hls.js files from a build stage. NGINX serves `/vendor/hls`. | #16 |
| C6 | `public/index.html` has one inline `<script>` block (about 310 lines). A strict CSP without `unsafe-inline` blocks it. | High | Move the script to `public/app.js`. Keep the hls.js `<script src>` tag. | #6 |
| C7 | `index.html` loads Google Fonts from `fonts.googleapis.com` and `fonts.gstatic.com`. The server sends no security headers. | Medium | NGINX sends the headers and the CSP. The CSP must allow the two font hosts in `style-src` and `font-src`. Self-hosting the fonts is a follow-up (see F-OPEN-1). | #16 |
| C8 | The app does not set `trust proxy`. Behind NGINX, `req.ip` and `req.protocol` show the proxy. | Medium | Read `TRUST_PROXY` (default `false`). The image sets `1`. | #6 |
| C9 | `tests/support/app.js` opens the SQLite file with `better-sqlite3` and runs `DELETE FROM ratings`. It also writes the streams file. A remote `BASE_URL` has neither file. | High | Use unique track names for each scenario (decision D2). Remove the direct database access and the `server.js` spawn from the remote mode. | #5 |

## New findings

| ID | Finding | Risk | Action | Owner |
|---|---|---|---|---|
| N1 | `GET /api/health` runs a database query and shows the SQLite version. It cannot serve as a liveness check. No readiness endpoint exists. | High | `GET /api/health` returns `ok` with no database call. Add `GET /api/ready` with a database check and a 503 on failure. Do not show version data. | #6 |
| N2 | Nothing sets `NODE_ENV`. Express runs in development mode, and the default error handler can show stack traces. | Medium | Set `NODE_ENV=production` in the `runtime` stage. | #8 |
| N3 | `express.json()` has no error handler. A broken JSON body gets the default HTML error answer, not JSON. Outside production, that answer contains the stack trace. Express 5 already writes `err.stack` to stderr (unless env is `test`), so the log is not missing. | Medium | Add a JSON error handler. Log errors to stderr with no secrets. | #6 |
| N4 | `GET /api/ratings` takes up to 20 `track` params of up to 500 characters. Percent-encoding can use up to 9 bytes for each UTF-16 unit, so the largest valid URL is about 91 KB (20 x 500 x 9 bytes plus the other parts). The NGINX default header buffer is 8 KB, so NGINX answers 414. | Medium | Set `large_client_header_buffers` to fit the largest valid request, or limit the track length and the number of tracks in the contract. Add a test with 20 long tracks. | #16 |
| N5 | The page sends one `GET /api/ratings` every 10 seconds for each listener, plus the votes. Many listeners can share one IP address (NAT). A tight rate limit blocks real users. | Medium | Size the rate limits from this load. Use `burst`. Make the limits easy to change. | #16 |
| N6 | The browser reads `metadatav2.json` and `cover.jpg` from the station host and plays HLS from it. The CSP needs `connect-src`, `img-src` and `media-src` for that host, and `blob:` for the player and its worker. If the stream list moves to another host, the CSP blocks it. | High | Build the CSP from `STATION_ORIGINS`. Add `worker-src blob:` and `media-src blob:`. Document that `STATION_ORIGINS` must match `STREAMS_FILE`. | #16 |
| N7 | `crypto.randomUUID()` works only in a secure context (HTTPS or `localhost`). On staging, the page can load over plain HTTP from another host name. Then `clientId()` returns `null` and ratings fail with no message. | Medium | Add a fallback that uses `crypto.getRandomValues`. Test the page over plain HTTP on a non-local host name. | #6 |
| N8 | Node closes idle connections after 5 seconds by default. NGINX keep-alive to the upstream can use a connection that Node closes at that moment. The result is a rare 502. | Medium | Set `server.keepAliveTimeout` above the NGINX upstream idle time. Set `headersTimeout` above it. | #6 |
| N9 | The schema runs on every start. With many replicas, the DDL statements can run at the same time. | Medium | Run the migration under a Postgres advisory lock. | #6 |
| N10 | After the Postgres change, the app cannot start without a database. In Compose and Kubernetes, Postgres can start after the app. A pool with no error handler can crash the process. | Medium | Retry the first connection with a limit. Handle pool errors. Add a Compose health check (#8) and a Kubernetes readiness probe (#9). | #6 |
| N11 | After #6, `npm start` needs `DATABASE_URL`. The local development flow and the `CLAUDE.md` commands change. | Medium | Document a local flow in `CLAUDE.md` (for example, Compose with the database only). See F-OPEN-2. | #6 |
| N12 | `DATABASE_URL` holds a password after #6. No secret is in the repository today. `.gitignore` has no `.env` entry. | Medium | Never set a default password. Do not log the URL. Add `.env` to `.gitignore`. Use a Kubernetes Secret (#9). | #6 |
| N13 | The repository has no `.dockerignore`. A build context with `.git`, `data/`, `reports/` and `docs/` is large and can leak files into an image. | Medium | Add `.dockerignore` for `.git`, `data/`, `reports/`, `docs/`, `node_modules` and `.env`. Keep `tests/` in the context: the `test` and `e2e` stages copy it. The `runtime` stage copies files by name. | #8 |
| N14 | `.nvmrc` pins Node 24.21.0. `package.json` has no `engines` field. The base image can drift from the pin. | Low | Pin the base image tag and digest to the `.nvmrc` major version. | #8 |
| N15 | `better-sqlite3` is a native module. It needs a compiler and a matching libc in the image. `hls.js` is in `dependencies`, but only the `proxy` image needs its files. | Medium | The Postgres change removes `better-sqlite3`. The runtime stage runs `npm ci --omit=dev`. The proxy build stage copies the hls.js dist files. | #8 |
| N16 | With the exec form, Node is PID 1 and gets the signal. But PID 1 has no default action for `SIGTERM`, so the C3 handler is necessary. Without the exec form, the signal does not reach the app. | Medium | Use `ENTRYPOINT ["node", "server.js"]` (exec form). Use `init: true` in Compose when needed. Test the `docker stop` time. | #8 |
| N17 | The staging E2E needs `/api/streams` to return the fake station URL `https://station.test/...`. The local harness writes this file at run time. Compose staging has no such step. | High | Mount a streams file with the station URL in the Compose staging file. | #8 |
| N18 | Same as N17 for kind. The streams file is a ConfigMap. | High | Add a staging overlay patch for the streams ConfigMap. | #9 |
| N19 | The harness waits for the log text `Listening` before it starts. The `server.js` rewrite in #6 can change the text. | Low | Keep the log line, or change the harness in the same PR. | #6 |
| N20 | Express serves the static files with default caching (`ETag`, no `max-age`). The API answers must not be cached. | Low | Set cache headers in NGINX: short cache for static files, `no-store` for `/api/*`. | #16 |
| N23 | `tests/support/station.js` `attach()` answers each request to a host other than `localhost` or `127.0.0.1` with an empty `text/css` 200. Against a remote `BASE_URL` (for example `http://proxy:8080/`), this catches the page, `styles.css`, `/vendor/hls` and `/api/*`, so all scenarios fail. | High | Limit the stub to the off-site hosts (fonts) and let the `BASE_URL` host pass. | #5 |
| N24 | Express sends `X-Powered-By: Express`. | Low | Call `app.disable('x-powered-by')`. NGINX also uses `proxy_hide_header X-Powered-By` as defence in depth (#16). | #6 |
| N21 | `/api/ratings` accepts any `track` and `client` string. A client can create many rows. There are no accounts. | Medium | Accepted risk: the product is anonymous by design. The length limits (500 and 100) and the NGINX rate limits (#16) reduce abuse. #13 reviews it again. | Accepted risk |
| N22 | `GET /api/streams` reads the file with `readFileSync` on each request. This blocks the event loop for a short time. | Low | Accepted risk: the file is very small, and the re-read on each request is a documented feature. | Accepted risk |

## Checklist result

| Area | Result | Items |
|---|---|---|
| Configuration | Fails | `HOST` and `DATABASE_URL` are missing. `PORT` and `STREAMS_FILE` exist. See C1, C4, C8, N11. |
| Secrets | Passes today | No secret is in the code or in the logs. `stream_URL.txt` holds a public URL. See N12 for the future. |
| Process | Fails | One process and stdout logging are correct. Graceful shutdown is missing. See C3, N3, N16. |
| File system | Fails today | `db.js` writes `data/`. This ends with the Postgres change. See C2. |
| Network | Fails | The bind address is fixed. See C1. |
| Health | Fails | One endpoint exists, and it uses the database. See N1. |
| Dependencies | Needs work | See N14 and N15. |
| State | Passes | The app keeps no state in memory. The ratings are in the database. The only file is the read-only streams list. |
| Reverse proxy | Fails | See C5 to C8, N4 to N8, N20. |

Reverse proxy detail:

- Forwarded headers: C8.
- Static files: C5.
- Absolute URLs: the server builds none. The page uses paths from the site root (`/api/...`, `/logo.png`, `/vendor/hls/...`). The app must run at the root of a host name and not under a sub-path. This is accepted.
- Request size: the largest valid body is a rating of about 1.9 KB in UTF-8, or about 3.7 KB with `\uXXXX` escapes. NGINX sets a small `client_max_body_size` (#16). The 413 answer is part of the contract.
- Long requests: no request is long. The HLS stream goes from the station host to the browser and does not pass the proxy. Default timeouts are enough. See N8 for keep-alive.

## Open questions for the epic

- F-OPEN-1: Should the fonts move into the repository? This removes the third-party hosts from the CSP and from the privacy view. It needs a code change and a new issue.
- F-OPEN-2: Which local flow replaces `npm start` with SQLite? Issue #6 must choose and tell the Tech Lead.
