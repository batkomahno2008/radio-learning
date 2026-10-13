# Deploy with Docker Compose

This guide shows how to run Radio Learning on one Linux host with Docker Compose. The stack has
three services: `proxy` (NGINX), `app` (Node) and `db` (Postgres 18). You can start, check,
upgrade, back up and restore the stack with this guide only.

Only `proxy` publishes ports. The app and the database have no route from the outside.

Other guides:
[NGINX](nginx.md), [Kubernetes](kubernetes.md), [staging](staging.md).

## Prerequisites

- A Linux host with Docker Engine 25 or later. Check it with `docker version`.
- Docker Compose 2.24.0 or later. Check it with `docker compose version`.
- Free host ports 80 and 443. Use `HTTP_PORT` and `HTTPS_PORT` to change them.
- A DNS name that points to the host. You need it for TLS.
- The `openssl` tool, for the password and for tests.
- `git`, to get the files of this repository.

## 1. Get the files

Clone the repository. Run all `docker compose` commands from the repository root. Compose
resolves each relative path from the directory of `compose.yaml`.

```bash
git clone https://github.com/batkomahno2008/radio-learning.git
cd radio-learning
git checkout <release tag>
```

Replace `<release tag>` with the release that you deploy, for example `v1.0.0`. The tag must agree with the image tag.

## 2. Configure

Copy the example file. Git ignores `.env`. Never commit it.

```bash
cp .env.example .env
```

Set these values in `.env`:

| Name | Default | What to do |
|---|---|---|
| `POSTGRES_PASSWORD` | – (required) | Change it. Use a random value with URL-safe characters. Example: `openssl rand -hex 24`. |
| `POSTGRES_USER` | `radio` | Keep it, or change it before the first start. |
| `POSTGRES_DB` | `radio` | Keep it, or change it before the first start. |
| `APP_IMAGE` | `ghcr.io/batkomahno2008/radio-learning:latest` | Set it to a version tag. See "Upgrade". |
| `PROXY_IMAGE` | `ghcr.io/batkomahno2008/radio-learning-proxy:latest` | Use the same tag as `APP_IMAGE`. |
| `HTTP_PORT` | `80` | The host port for HTTP. |
| `HTTPS_PORT` | `443` | The host port for HTTPS. Only `compose.tls.yaml` uses it. |
| `STATION_ORIGINS` | `https://d3d4yli4hf5bmh.cloudfront.net` | The origin of each stream in the streams file. |
| `STREAMS_HOST_FILE` | `./stream_URL.txt` | The streams file on the host. |

Do not set `DATABASE_URL` for Compose. Compose builds it from `POSTGRES_USER`,
`POSTGRES_PASSWORD` and `POSTGRES_DB`. The `.env.example` file has a `DATABASE_URL` line for
`npm start` on a host. Compose ignores it.

Generate the password and write it into `.env`:

```bash
openssl rand -hex 24
```

Copy the output into `POSTGRES_PASSWORD=` in `.env`. Never write a real password in a file
that Git tracks.

Change the password before the first start. Postgres stores the password in the `db-data`
volume when it makes the database. A later change in `.env` does not change the stored password.
See the troubleshooting table.

### Keep the streams file and `STATION_ORIGINS` in line

The streams file has one stream URL on each line. The browser reads the metadata, the cover
art and the audio directly from the host of each stream. The NGINX Content Security Policy
(CSP) allows only the hosts in `STATION_ORIGINS`.

If you add a stream with a new host, add the origin of that host to `STATION_ORIGINS`.
An origin has the scheme and the host name, for example `https://stream.example.com`. Separate
origins with a space.

The app reads the streams file again on each request. A change of the file needs no restart.
A change of `STATION_ORIGINS` needs a restart of `proxy`. See "Change the configuration".

## 3. First start

Start the stack without TLS first. This checks that the stack works.

```bash
docker compose up -d --wait
```

The command pulls the images, starts `db`, `app` and `proxy` in this order, and waits until
all three are healthy. It prints the status of each service.

If the images do not exist in the registry, build them from the repository:
`docker compose up -d --build --wait`. The build runs the API tests.

Check the stack:

```bash
docker compose ps
curl -s http://localhost/healthz
curl -s http://localhost/api/ready
curl -s http://localhost/api/streams
```

Expected answers:

| Request | Answer |
|---|---|
| `GET /healthz` | `ok`. NGINX answers. It does not call the app. |
| `GET /api/ready` | `{"status":"ready"}`. The app reached the database. |
| `GET /api/streams` | The JSON list of your streams. |

If you set `HTTP_PORT`, use that port in the URLs. Then open `http://<your host>/` in a
browser.

`/api/ready` answers `503` with `{"status":"unavailable"}` when the database is down.

## 4. TLS

NGINX stops TLS in this stack. You give NGINX a certificate. This guide uses certbot with
the webroot mode. Certbot writes a challenge file into the volume `radio-learning_acme`.
NGINX serves that volume at `/.well-known/acme-challenge/` on port 80, also when TLS is on.

The volume name is `radio-learning_acme`, because the Compose project name is `radio-learning`.
Compose makes the volume at the first start.

### Get the first certificate

1. Start the stack without TLS (section 3). NGINX must answer on port 80 at your DNS name.
2. Run certbot. Replace `radio.example.com` with your DNS name.

   ```bash
   docker run --rm \
     -v radio-learning_acme:/var/www/acme \
     -v /etc/letsencrypt:/etc/letsencrypt \
     -v /var/lib/letsencrypt:/var/lib/letsencrypt \
     certbot/certbot:v4.2.0@sha256:9626d72120577cf72da4fc7948806e9993598981720a4cbe04340a502468d67b certonly --webroot -w /var/www/acme -d radio.example.com
   ```

   The standalone mode also works (`--standalone -p 80:80`), but it needs port 80 free. Stop
   the stack before you use it. The renewal then needs a stop of the stack too. Use the webroot mode.

3. Copy the certificate files into a directory outside the repository. Use `install`, because
   the files in `/etc/letsencrypt/live/` are links. A link does not work inside the container.
   UID 101 (the NGINX user) must read the key. Use the group 101.

   ```bash
   sudo install -d -m 0755 /etc/radio-learning/certs
   sudo install -m 0644 /etc/letsencrypt/live/radio.example.com/fullchain.pem /etc/radio-learning/certs/fullchain.pem
   sudo install -m 0640 -g 101 /etc/letsencrypt/live/radio.example.com/privkey.pem /etc/radio-learning/certs/privkey.pem
   ```

4. Add these lines to `.env`. Then Compose uses the TLS file each time.

   ```bash
   COMPOSE_FILE=compose.yaml:deploy/compose/compose.tls.yaml
   CERTS_DIR=/etc/radio-learning/certs
   ```

5. Apply the change:

   ```bash
   docker compose up -d --wait
   ```

   Without `COMPOSE_FILE`, add `-f compose.yaml -f deploy/compose/compose.tls.yaml` to each
   `docker compose` command.

6. Check it:

   ```bash
   curl -sI http://radio.example.com/ | head -3
   curl -sI https://radio.example.com/ | head -3
   curl -s https://radio.example.com/api/ready
   curl -s http://radio.example.com/healthz
   ```

   With TLS on, NGINX answers each HTTP request with `301` to HTTPS. The exceptions are
   `/healthz` and `/.well-known/acme-challenge/`. The redirect has no port, so publish port 80
   and port 443 (the defaults).

NGINX does not start with `compose.tls.yaml` when the certificate files are missing or the
key is not readable. See the troubleshooting table.

### Renew the certificate

Certificates from Let's Encrypt are valid for a short time. Renew them on a schedule. NGINX
reads the files only at start and at reload, so a renewal needs a reload.

1. Write this script to `/usr/local/bin/radio-learning-renew.sh`. Replace the domain name
   and the path `/opt/radio-learning` (the repository directory).

   ```sh
   #!/bin/sh
   set -eu
   # Cron starts with another working directory. Compose reads .env and COMPOSE_FILE here.
   cd /opt/radio-learning
   DOMAIN=radio.example.com
   LIVE=/etc/letsencrypt/live/$DOMAIN
   CERTS=/etc/radio-learning/certs
   docker run --rm \
     -v radio-learning_acme:/var/www/acme \
     -v /etc/letsencrypt:/etc/letsencrypt \
     -v /var/lib/letsencrypt:/var/lib/letsencrypt \
     certbot/certbot:v4.2.0@sha256:9626d72120577cf72da4fc7948806e9993598981720a4cbe04340a502468d67b renew --quiet
   install -m 0644 "$LIVE/fullchain.pem" "$CERTS/fullchain.pem"
   install -m 0640 -g 101 "$LIVE/privkey.pem" "$CERTS/privkey.pem"
   docker compose exec -T proxy nginx -s reload
   ```

2. Make the script executable: `sudo chmod 0755 /usr/local/bin/radio-learning-renew.sh`.
3. Run it each day from cron or from a systemd timer. Certbot renews only when the
   certificate is close to its end date. The reload is safe each day.
4. Run the script by hand one time. Read the output.

`nginx -s reload` starts new workers with the new files. It does not drop open connections.
The script copies into a directory, not into single mounted files. A directory mount shows
the new files at once.

## 5. Logs

```bash
docker compose logs --tail 100 proxy
docker compose logs --tail 100 app
docker compose logs --tail 100 db
docker compose logs -f              # follow all services
```

Each service keeps 3 log files of 10 MB at most. The NGINX access log is JSON. It records the
path without the query string. The error log of NGINX can hold the full request line, which has
the client id of a listener. Treat it with care.

## 6. Change the configuration

Compose does not restart a service when `.env` changes. Run `up -d` again. Compose then
recreates only the services that changed.

```bash
docker compose up -d --wait
```

A change of `STATION_ORIGINS` recreates `proxy`. A change of the streams file needs no
restart.

## 7. Upgrade and roll back

Both images use the same tag. Published tags are `X.Y.Z`, `X.Y`, `sha-<short>`, `main`, and
`latest` for releases. Use `X.Y.Z` in production. Do not use `main`: it changes.

### Upgrade

1. Make a backup (section 8).
2. Note the old tag: `grep IMAGE .env`.
3. Set the new tag in `.env`. Use the same tag for both images.

   ```bash
   APP_IMAGE=ghcr.io/batkomahno2008/radio-learning:1.0.1
   PROXY_IMAGE=ghcr.io/batkomahno2008/radio-learning-proxy:1.0.1
   ```

4. Pull the images and recreate the services:

   ```bash
   docker compose pull
   docker compose up -d --wait
   ```

5. Check the stack (section 3). Check the version of the images with
   `docker compose images`.

The app makes its table again at each start with idempotent SQL. The data in the `db-data`
volume stays.

### Roll back

1. Set the old tag in `.env` for both images.
2. Run `docker compose pull` and `docker compose up -d --wait`.
3. Check the stack.

Sometimes the new version changes the data, and the old version cannot use it. Then restore
the backup from step 1 of the upgrade (section 8).

## 8. Back up and restore Postgres

The only data is the ratings table in the `db-data` volume. Use `pg_dump` through
`docker compose exec`. The commands read the user and the database name from the container
environment, so they need no password.

### Back up

1. Write this script to `/usr/local/bin/radio-learning-backup.sh`. Replace the path
   `/opt/radio-learning` (the repository directory).

   ```sh
   #!/bin/sh
   set -eu
   # Cron starts with another working directory. Compose reads .env here.
   cd /opt/radio-learning
   DIR=/var/backups/radio-learning
   mkdir -p "$DIR"
   FILE="$DIR/radio-$(date +%Y%m%d-%H%M%S).sql"
   docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' > "$FILE" || { rm -f "$FILE"; exit 1; }
   test -s "$FILE"
   find "$DIR" -name 'radio-*.sql' -mtime +14 -delete
   echo "$FILE"
   ```

2. Make it executable: `sudo chmod 0755 /usr/local/bin/radio-learning-backup.sh`.
3. Run it by hand and read the output: `sudo /usr/local/bin/radio-learning-backup.sh`.
4. Add one line to the crontab of root (`sudo crontab -e`). It runs the script each day at 03:17.

   ```text
   17 3 * * * /usr/local/bin/radio-learning-backup.sh
   ```

The file is plain SQL. The script keeps the files of the last 14 days. Keep a copy outside the host.

### Restore

A restore replaces the ratings table with the content of the file.

1. Stop the app, so that it does not write during the restore:

   ```bash
   docker compose stop app
   ```

2. Restore the file. Replace the file name.

   ```bash
   docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 --single-transaction' < /var/backups/radio-learning/radio-20260101-030000.sql
   ```

3. Start the app and check the data:

   ```bash
   docker compose start app
   docker compose restart proxy
   docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT count(*) FROM ratings"'
   curl -s http://localhost/api/ready
   ```

To restore on a new host, set up the stack (sections 1 to 3). Then run steps 1 to 3.
The app makes the empty table at the first start, and the dump replaces it.

## 9. Stop and remove

```bash
docker compose stop                 # stop; keep the data
docker compose down                 # remove containers; keep the volumes
docker compose down -v              # remove containers AND the data volumes
```

`down -v` deletes all ratings. Make a backup first.

## 10. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `docker compose` prints `Set POSTGRES_PASSWORD in .env`. | `.env` is missing or has no password. | Copy `.env.example` to `.env`. Set `POSTGRES_PASSWORD`. |
| `docker compose` prints an error about `!reset` or `start_interval`. | Compose or Docker Engine is too old. | Install Compose 2.24.0 or later and Docker Engine 25 or later. |
| The browser shows `502 Bad Gateway` or `504 Gateway Timeout` on `/api/`. | NGINX cannot reach the app. The app is down or it restarted. | Run `docker compose ps` and `docker compose logs app`. Restart: `docker compose restart app proxy`. |
| The app logs `Cannot start: password authentication failed`. | You changed `POSTGRES_PASSWORD` after the first start. The volume keeps the old password. | Put the old password back. Or change it in Postgres: `docker compose exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'`, then `ALTER ROLE <user> PASSWORD '<new>';`. Then run `docker compose restart app`. |
| `GET /api/ready` answers `503`. | The app cannot reach the database. | Run `docker compose logs db`. Wait for `db` to be healthy. |
| Many requests answer `429`. | One client IP is over the rate limit or the connection limit. | Wait. Look at `docker compose logs proxy` for the client. See [NGINX](nginx.md) for the limits. |
| The page loads but the player is silent. The browser console shows CSP errors. | The origin of the stream is not in `STATION_ORIGINS`. | Add the origin to `.env`. Run `docker compose up -d --wait`. |
| `proxy` restarts. The log has `Permission denied` for `privkey.pem`. | UID 101 cannot read the key. | Run `sudo chown :101 <key>` and `sudo chmod 0640 <key>`. |
| `proxy` restarts. The log has `cannot load certificate`. | The files `fullchain.pem` or `privkey.pem` are missing from `CERTS_DIR`, or they are links. | Copy the files with `install` (section 4). |
| `docker compose` prints `required variable CERTS_DIR is missing a value`. | `compose.tls.yaml` is in use and `CERTS_DIR` is not set. | Set `CERTS_DIR` in `.env`. |
| `proxy` does not start. The log has `15-radio-learning.envsh: ERROR`. | A variable has a wrong value. | Read the message. Fix `STATION_ORIGINS` in `.env`. |
| `bind: address already in use` | Another program uses port 80 or 443. | Stop it, or set `HTTP_PORT` and `HTTPS_PORT`. |
| The browser shows an old page after an upgrade. | The browser keeps static files for one hour. | Reload with `Ctrl+Shift+R`. `index.html` is not cached. |
