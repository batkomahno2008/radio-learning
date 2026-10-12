# NGINX proxy

NGINX is the entry point of the product (decision D12 in epic #1). It serves the static
files and the hls.js files, and it sends `/api/*` to the Node app. It also owns the edge
controls of `docs/security/policy.md` section 9: security headers, CSP, rate limits,
body size, TLS, gzip and access logs.

The base image is `nginxinc/nginx-unprivileged:1.30.5-alpine3.24` (stable line), pinned by
digest `sha256:56b8272e43a0525f67aed68d1e0794a712d10e3e45a563e118e9a77c817e6f86`.
NGINX runs as UID 101 and listens on port 8080 (HTTP) and 8443 (HTTPS).

## Files

| File in this directory | Path in the container | Notes |
|---|---|---|
| `nginx.conf` | `/etc/nginx/nginx.conf` | Main file: workers, JSON access log, temporary paths in `/tmp`, `server_tokens off`. |
| `templates/default.conf.template` | `/etc/nginx/templates/default.conf.template` | Edge limits, CSP, gzip, upstream and the HTTP server on 8080. The envsubst step of the image writes it to `/tmp/nginx/conf.d/default.conf`. |
| `snippets/*.conf` | `/etc/nginx/snippets/` | Locations of the site, `/healthz`, the HTTPS redirect and the security headers. |
| `docker-entrypoint.d/15-radio-learning.envsh` | `/docker-entrypoint.d/15-radio-learning.envsh` | Start script. It must have the execute bit. See "Start" below. |
| `tls/tls.conf` | `/etc/nginx/tls/tls.conf` | HTTPS server on 8443. Mount it only in Compose with TLS (D14). Do not put it in the image. |
| `public/` (repository root) | `/usr/share/nginx/html/` | Static files. |
| `node_modules/hls.js/dist/` | `/usr/share/nginx/vendor/hls/` | Served at `/vendor/hls/`. |
| Certificate files (not in Git) | `/etc/nginx/certs/fullchain.pem`, `/etc/nginx/certs/privkey.pem` | Only with `tls/tls.conf`. UID 101 must be able to read the key. |

NGINX writes only to `/tmp`. Mount a writable `tmpfs` or `emptyDir` at `/tmp` and keep the
root file system read-only. `/etc/nginx/conf.d` does not have to be writable.

## Environment variables

| Name | Default | Notes |
|---|---|---|
| `APP_UPSTREAM` | `app:3000` | `host:port` of the Node app. Kubernetes: `radio-learning:80`. NGINX finds the address of the host name one time, at start. |
| `STATION_ORIGINS` | – (empty) | Space-separated origins of the station host, for the CSP (`img-src`, `media-src`, `connect-src`). Staging: `https://station.test`. Production: the origin of the stream in `STREAMS_FILE`. When it is empty, the player cannot play. |
| `REAL_IP_FROM` | – (off) | Space-separated addresses or CIDR ranges of the cluster edge. When it is set, NGINX reads the client IP from `X-Forwarded-For`, but only for requests from these addresses. |

The values go into the NGINX config, so the start script accepts only the expected
characters. A wrong value stops the container with an error message.

## Start

`/docker-entrypoint.sh` of the image runs the scripts in `/docker-entrypoint.d/` in name
order before NGINX starts. `15-radio-learning.envsh`:

1. Sets the defaults above and checks the values.
2. Sets `NGINX_ENVSUBST_OUTPUT_DIR=/tmp/nginx/conf.d` for the envsubst step.
3. Writes `/tmp/nginx/real-ip.conf`: `set_real_ip_from` lines when `REAL_IP_FROM` is set,
   else no directive.
4. Writes `/tmp/nginx/http-site.conf`. Without `tls/tls.conf`, port 8080 serves the site.
   With `tls/tls.conf`, port 8080 sends each request to `https://<host>/` with `301`,
   but `/healthz` stays on HTTP.

Then `20-envsubst-on-templates.sh` of the image writes the template.

## Edge controls

All limit values are in `templates/default.conf.template`. Do not move them to an
environment variable. That changes the shared contracts (epic #1, rule 10).

| Control | Value |
|---|---|
| Rate limit, `POST` (all methods other than `GET` and `HEAD`) on `/api/` | 5 requests each second for each client IP, burst 10, then `429` |
| Rate limit, `GET` and `HEAD` on `/api/` | 20 requests each second for each client IP, burst 40, then `429` |
| Open connections | 20 for each client IP, then `429` |
| Request body | 16 KiB, then `413` |
| Request line and each header | 96 KiB (the largest valid `GET /api/ratings` is about 89 KiB), then `414` or `400` |
| Static files | `index.html`: `Cache-Control: no-cache`. Other files: `max-age=3600` and an ETag. |
| `/api/*` | `Cache-Control: no-store`. NGINX removes `X-Powered-By` and the security headers of the app. |
| Security headers | On each answer, also on errors: CSP, HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`. |
| TLS (`tls/tls.conf`) | TLS 1.2 and 1.3. TLS 1.2 uses only ECDHE with AES-GCM or ChaCha20-Poly1305. |

NGINX sends HSTS also on plain HTTP. Browsers ignore it there. In Kubernetes, the cluster
edge must keep the header.

`/api/` requests get these headers: `Host`, `X-Forwarded-For` (only the client IP that
NGINX found, not the value from the client), `X-Forwarded-Proto` and `X-Request-ID`.
The access log has the same request id. The log has the path without the query string,
because the query string holds the client id of the listener.

## Test the config

Use the stock image with the files of this directory mounted. Start the app first:

```bash
npm ci
STREAMS_FILE=tests/fixtures/streams.txt DB_PATH=/tmp/radio-e2e.db npm start
```

Then start NGINX in a different terminal (host network, so `127.0.0.1:3000` is the app):

```bash
docker run --rm --name radio-proxy --network host \
  --read-only --tmpfs /tmp:uid=101,gid=101 --cap-drop ALL \
  -e APP_UPSTREAM=127.0.0.1:3000 -e STATION_ORIGINS=https://station.test \
  -v "$PWD/deploy/nginx/nginx.conf:/etc/nginx/nginx.conf:ro" \
  -v "$PWD/deploy/nginx/templates:/etc/nginx/templates:ro" \
  -v "$PWD/deploy/nginx/snippets:/etc/nginx/snippets:ro" \
  -v "$PWD/deploy/nginx/docker-entrypoint.d/15-radio-learning.envsh:/docker-entrypoint.d/15-radio-learning.envsh:ro" \
  -v "$PWD/public:/usr/share/nginx/html:ro" \
  -v "$PWD/node_modules/hls.js/dist:/usr/share/nginx/vendor/hls:ro" \
  nginxinc/nginx-unprivileged:1.30.5-alpine3.24@sha256:56b8272e43a0525f67aed68d1e0794a712d10e3e45a563e118e9a77c817e6f86
```

Check it:

```bash
docker exec radio-proxy nginx -t
curl -sI http://localhost:8080/                       # headers, Server: nginx (no version)
curl -s http://localhost:8080/healthz                 # ok
BASE_URL=http://localhost:8080/ npm run test:e2e      # E2E suite through NGINX
```

For TLS, also mount `tls/tls.conf` at `/etc/nginx/tls/tls.conf` and a directory with
`fullchain.pem` and `privkey.pem` at `/etc/nginx/certs`. Then test port 8443.

The CSP has `script-src 'self'`, so the page must have no inline script. Issue #6 moves the
client script to `public/app.js`. Before that change, the browser blocks the inline
script of `public/index.html` behind NGINX.
