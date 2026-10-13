# NGINX proxy

NGINX is the entry point of Radio Learning. This guide explains what NGINX does and how to set
its variables. It also shows how to change the CSP and the rate limits, and how to test a change.

The file `deploy/nginx/README.md` has more detail on the files. Other guides:
[Docker Compose](docker-compose.md), [Kubernetes](kubernetes.md), [staging](staging.md).

## What NGINX does

- It serves the static files (`public/`) and the hls.js files at `/vendor/hls/`.
- It sends `/api/*` to the Node app. The app does not serve static files in a deployment.
- It adds the security headers to each answer, also to errors: CSP, HSTS,
  `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` and
  `Cross-Origin-Opener-Policy`.
- It limits the request rate, the open connections, the body size and the header size.
- It compresses text answers (gzip) and writes a JSON access log.
- It answers `GET /healthz` itself (`ok`). This check does not call the app.
- In Compose with TLS, it stops TLS and sends HTTP to HTTPS. In Kubernetes, the cluster edge
  stops TLS and NGINX uses plain HTTP.

The image is `ghcr.io/batkomahno2008/radio-learning-proxy`. It uses
`nginxinc/nginx-unprivileged` as its base. NGINX runs as UID 101 and listens on port 8080 (HTTP) and
port 8443 (HTTPS, only with `tls/tls.conf`). It writes only to `/tmp`, so the root file
system can be read-only.

## Environment variables

NGINX reads three variables at start. A script checks them before NGINX starts. A wrong
value stops the container with a message that starts with `15-radio-learning.envsh: ERROR`.

| Name | Default | Meaning |
|---|---|---|
| `APP_UPSTREAM` | `app:3000` | The `host:port` of the app. Compose uses `app:3000`. Kubernetes uses `radio-learning:80`. |
| `STATION_ORIGINS` | empty | Space-separated `https://` origins of the stream hosts. They go into the CSP. |
| `REAL_IP_FROM` | empty (off) | Space-separated addresses or CIDR ranges of the cluster edge. |

Where to set them:

| Platform | Where |
|---|---|
| Compose | `APP_UPSTREAM` is fixed in `compose.yaml`. Set `STATION_ORIGINS` in `.env`. Compose has no `REAL_IP_FROM`. |
| Kubernetes | The ConfigMap `radio-learning-proxy-env`. Set the values in `deploy/k8s/base/kustomization.yaml` and `deploy/k8s/overlays/prod/kustomization.yaml`. |

### `APP_UPSTREAM`

NGINX finds the address of the host name at start, and not again. If the name does not resolve,
NGINX does not start. If the app gets a new address, NGINX sends traffic to the old address
until NGINX restarts. Compose restarts `proxy` when `app` restarts. A Kubernetes Service
address does not change.

### `STATION_ORIGINS`

The browser reads the metadata, the cover art and the audio directly from the host of the
stream. The CSP allows only the origins in this variable (`img-src`, `media-src` and
`connect-src`).

- Use the origin of each stream in the streams file. An origin is the scheme and the host name,
  for example `https://stream.example.com`.
- Keep this variable and the streams file in line. If an origin is missing, the page loads but
  the player cannot play. The browser console shows CSP errors.
- Use `https://` origins only. You can use a wildcard host, for example `https://*.example.com`.

### `REAL_IP_FROM`

When this variable is set, NGINX reads the client IP from `X-Forwarded-For`. It does this only
for requests from these addresses. The rate limits then count each client.

- Use it when a proxy is in front of NGINX. Example: the Gateway or Ingress controller in
  Kubernetes.
- Set it to the **pod address range of the Gateway or Ingress controller**. Do not use the
  address of the load balancer. The pods of the controller open the connection to NGINX.
- If you set it too wide, a client can send a false IP.
- If you leave it empty behind a proxy, all clients share the address of the proxy. The rate
  limit then blocks them together.
- The prod overlay of Kubernetes has the placeholder `REPLACE_WITH_EDGE_ADDRESS_RANGE`. The
  placeholder is not valid on purpose. NGINX stops at start until the operator sets a real
  range. This prevents an unsafe default.

The app trusts one proxy (`TRUST_PROXY=1`). NGINX sends it only the client IP that NGINX found.

## The edge controls

All values are in `deploy/nginx/templates/default.conf.template`. They are not environment
variables.

| Control | Value |
|---|---|
| Rate limit for writes (all methods except `GET` and `HEAD` on `/api/`, for example `POST`) | 5 requests each second for each client IP, burst 10. Then `429`. |
| Rate limit for reads (`GET` and `HEAD` on `/api/`) | 20 requests each second for each client IP, burst 40. Then `429`. |
| Open connections | 20 for each client IP. Then `429`. |
| Request body | 16 KiB. Then `413`. |
| Request line and each header | 96 KiB. |
| Static files | `index.html` is not cached. Other files have `max-age=3600`. |
| `/api/*` | `Cache-Control: no-store`. |
| TLS | TLS 1.2 and 1.3. Strong ciphers only. |

## How the config is built

At start, NGINX renders the template with `envsubst`. The result is
`/tmp/nginx/conf.d/default.conf`. The start script also writes the real-IP file and the file
for the HTTP server.

A reload (`nginx -s reload`) reads the files again, but it does not render the template again.
So:

- After a change of a **variable**, restart the container.
  - Compose: run `docker compose up -d`.
  - Kubernetes: change the value in the overlay. Run `kubectl apply -k`.
    Kustomize makes a new ConfigMap with a new name, and the pods restart.
- After a change of a **template**, build a new image and deploy it.
- After a change of a **certificate**, run a reload.

## Change the CSP

The CSP is in the `map $host $content_security_policy` block of
`deploy/nginx/templates/default.conf.template`.

1. To allow a new stream host, change `STATION_ORIGINS`. Do not edit the template.
2. To allow another host (for example a new font host), edit the template. Add the origin to
   the right directive, for example `font-src`.
3. Do not add `'unsafe-inline'` to `script-src`. The page has no inline script and no
   inline event handler. Do not add them to `public/index.html`.
4. Build a new proxy image and test it (see "Test a change").
5. Deploy the new image with a new tag. Both images use the same tag.

## Change the rate limits

The limits are in the first block of `deploy/nginx/templates/default.conf.template`.

- `limit_req_zone ... rate=5r/s` sets the write rate. `rate=20r/s` sets the read rate.
- `limit_req zone=... burst=...` sets the burst for each zone.
- `limit_conn conn_per_ip 20` sets the open connections.
- `client_max_body_size 16k` sets the body size.

Edit the value. Build a new proxy image. Test it. Deploy it with a new tag.

Do not set the limit lower than what the page needs. The page makes one batched read each 10
seconds and one write for each click on a thumb.

## Test a change

Use the proxy image that you built, or the stock image with your files mounted.

### Check the syntax

Run `nginx -t` in a temporary container. The container renders the template and tests it.

```bash
docker build --target proxy -t radio-learning-proxy:local .
docker run --rm -e APP_UPSTREAM=127.0.0.1:3000 -e STATION_ORIGINS=https://station.test \
  radio-learning-proxy:local nginx -t
```

The last lines must be `syntax is ok` and `test is successful`. To test a changed template
without a build, mount it:

```bash
docker run --rm -e APP_UPSTREAM=127.0.0.1:3000 -e STATION_ORIGINS=https://station.test \
  -v "$PWD/deploy/nginx/templates:/etc/nginx/templates:ro" \
  radio-learning-proxy:local nginx -t
```

A mistake gives a message with the file and the line, for example
`invalid number of arguments in "limit_conn_status" directive in /tmp/nginx/conf.d/default.conf:38`.
To test the start script, add `-e REAL_IP_FROM=10.244.0.0/16`.

### Test the behavior in a running stack

Start a staging stack (see [staging](staging.md)). Then test the limits and the headers:

```bash
curl -sI http://localhost:8080/ | grep -i content-security-policy
for i in $(seq 1 40); do
  curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:8080/api/ratings \
    -H 'Content-Type: application/json' -d '{"track":"A - B","client":"c1","value":1}'
done | sort | uniq -c
```

With the default limits, a fast burst of 40 requests gives some `200` answers and then `429`
answers. A body over 16 KiB gives `413`.

### Run the E2E suite through NGINX

The suite checks the CSP with a real browser: a CSP violation is a console error and fails
the scenario. Run it against the staging stack. On plain HTTP, `BASE_URL` must be a loopback
origin (`localhost` or `127.0.0.1`) that reaches NGINX. See [staging](staging.md).

## Logs

The access log is JSON on `stdout`. Each line has the time, the request id and the client IP.
It also has the method, the path, the status and the times. The path has no query string,
because the query string holds the client id of a listener.

The error log (level `notice`) can hold the full request line of a failed upstream request.
Treat it with care.

Read the logs:

```bash
docker compose logs --tail 100 proxy                                   # Compose
kubectl --namespace radio-learning logs deployment/radio-learning-proxy  # Kubernetes
```

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| The container stops. The log has `15-radio-learning.envsh: ERROR`. | A variable has a wrong value. | Read the message. Fix the variable. |
| The container stops and `REAL_IP_FROM` shows the placeholder. | The operator did not set the range. | Set the pod range of the edge. |
| `host not found in upstream`. | `APP_UPSTREAM` does not resolve. | Use the right host name. Start the app first. |
| `502 Bad Gateway` or `504 Gateway Timeout` on `/api/`. | The app is down, or it has a new address. | Check the app. Restart NGINX. |
| `429` for many clients. | A limit is too low, or `REAL_IP_FROM` is wrong behind a proxy. | Check `REAL_IP_FROM`. Then check the limits. |
| `413` on a rating. | The body is over 16 KiB. | Send a smaller body. |
| CSP errors in the browser console. | A host is not in the CSP. | Add the stream host to `STATION_ORIGINS`. |
