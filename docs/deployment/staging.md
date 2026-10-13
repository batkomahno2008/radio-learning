# Staging environments

A staging environment is a temporary copy of the system. It runs the E2E tests through NGINX
and then it is removed. This guide explains how CI makes the two staging environments, and how
you make them on your machine.

Other guides:
[Docker Compose](docker-compose.md), [Kubernetes](kubernetes.md), [NGINX](nginx.md).

## What a staging environment is

- There are two kinds: one with Docker Compose and one with a kind cluster (Kubernetes in Docker).
- Each one runs NGINX, the app and Postgres from the images that were just built.
- Each one uses a fake station (`https://station.test`). The E2E suite makes it in the browser.
  No real stream is needed.
- Each one uses plain HTTP and no certificate.
- Each one is removed after the test run, with its data.

## Rules for the E2E runner

The E2E suite runs in its own container (`radio-learning-e2e`). It does not deploy anything.
It needs only the address of NGINX.

| Variable | Meaning |
|---|---|
| `BASE_URL` | The address of NGINX. Default: `http://localhost:3000/`. |
| `LIVE_STREAM_URL` | The stream for the `@live` scenarios. Default: the first stream in `stream_URL.txt`. |

**On plain HTTP, `BASE_URL` must be a loopback origin** (`localhost` or `127.0.0.1`) that
reaches NGINX. A host name such as `http://proxy:8080/` is not a secure context. NGINX sends the
`Cross-Origin-Opener-Policy` header, and Chromium then logs a console error. The suite fails each
scenario on a console error. NGINX keeps the header, and the suite has no exception for it.

Two ways to give the runner a loopback origin:

- `--network container:<proxy container>` with `BASE_URL=http://localhost:8080/`. The runner
  shares the network of the NGINX container, so NGINX is `localhost` for it.
- `--network host` with `BASE_URL=http://localhost:<published port>/`.

Also give the runner `--shm-size=1g`. Chromium needs much shared memory.

## How CI makes the environments

CI builds the images from the `Dockerfile`. The build runs the API tests. CI then makes a
staging environment and runs the E2E image against NGINX. At the end, CI removes the
environment. The Compose and kind steps use the same commands as the sections below.

The CI workflow is added by issue #10 (`.github/workflows/ci.yml`). If that file is not in your
checkout yet, use the sections below. They show the same steps by hand.

| Step | Compose staging | kind staging |
|---|---|---|
| Images | `runtime` and `proxy` targets, tagged for the run | The same images, loaded into the cluster |
| Environment | `compose.yaml` + `compose.staging.yaml` | `overlays/staging` on a kind cluster with Calico |
| Database | Postgres in memory (`tmpfs`) | Postgres StatefulSet with a small volume |
| NGINX address | Published port 8080 | Node port 30080, mapped to `127.0.0.1:8080` |
| E2E runner | `--network container:<proxy>` | `--network host` |
| Removal | `docker compose ... down -v` | `kind delete cluster` |

The `@live` scenarios use the real station. They run on the CI runner, which has internet
access, and they do not block the pipeline. The staging NGINX allows both the fake station and
the real station in its CSP.

## Make the Compose staging environment

Prerequisites: Docker Engine 25 or later, Docker Compose 2.24.0 or later. The override file uses
`!reset`, which older Compose versions do not know.

1. Build the images. The build runs the API tests.

   ```bash
   docker build --target runtime -t radio-learning:local .
   docker build --target proxy -t radio-learning-proxy:local .
   docker build --target e2e -t radio-learning-e2e:local .
   ```

2. Set the variables. The password is random and used one time:

   ```bash
   export POSTGRES_PASSWORD=$(openssl rand -hex 24) STAGING_ID=local HTTP_PORT=8080 \
     APP_IMAGE=radio-learning:local PROXY_IMAGE=radio-learning-proxy:local
   ```

3. Start the stack:

   ```bash
   docker compose -f compose.yaml -f deploy/compose/compose.staging.yaml up -d --wait
   ```

   The project name is `radio-learning-staging-${STAGING_ID}`. Two stacks with different
   `STAGING_ID` values can run at the same time. They need different `HTTP_PORT` values.
   The staging file does not build images, so `APP_IMAGE` and `PROXY_IMAGE` are required. The
   app reads its stream list from `tests/fixtures/streams.txt` in your checkout.

4. Check it:

   ```bash
   curl -s http://localhost:8080/healthz
   curl -s http://localhost:8080/api/streams
   ```

   The answers are `ok` and a list with `https://station.test/hls/live.m3u8`.

5. Run the E2E image. Use one of these two commands.

   ```bash
   docker run --rm --network container:radio-learning-staging-local-proxy-1 --shm-size=1g \
     -e BASE_URL=http://localhost:8080/ radio-learning-e2e:local
   ```

   ```bash
   docker run --rm --network host --shm-size=1g \
     -e BASE_URL=http://localhost:8080/ radio-learning-e2e:local
   ```

   The container name is `radio-learning-staging-<STAGING_ID>-proxy-1`. The run takes about 10
   seconds. The last lines are `24 scenarios (24 passed)`.

   To run the `@live` scenarios, add `--profile live` after the image name. They need access to
   the real station.

6. If a scenario fails, mount a volume to get the report. The suite writes
   `reports/cucumber.html` with a screenshot for each listener:

   ```bash
   docker run --rm --network host --shm-size=1g -e BASE_URL=http://localhost:8080/ \
     -v "$PWD/reports:/e2e/reports" radio-learning-e2e:local
   ```

   The `reports` directory must be writable by UID 1001 (`pwuser`).

7. Remove the stack and its data:

   ```bash
   docker compose -f compose.yaml -f deploy/compose/compose.staging.yaml down -v
   ```

You can also run the suite without Docker for the runner. Start the app and the stack, then run
`BASE_URL=http://localhost:8080/ npm run test:e2e` on the host. This needs Playwright's Chromium.

## Make the kind staging environment

Prerequisites: Docker, `kind`, `kubectl` and `kustomize` or `kubectl kustomize`. The staging
overlay is for Kubernetes 1.37.0, the version of the kind node image in the cluster file.

1. Make the cluster and install Calico. kind needs Calico, because the default network plugin
   of kind does not enforce NetworkPolicy.

   ```bash
   kind create cluster --config deploy/k8s/kind/cluster.yaml
   deploy/k8s/kind/install-calico.sh
   ```

2. Build the two images and load them into the cluster:

   ```bash
   docker build --target runtime -t radio-learning:ci .
   docker build --target proxy -t radio-learning-proxy:ci .
   kind load docker-image radio-learning:ci radio-learning-proxy:ci --name radio-learning
   ```

   Load only these two images. The node pulls the Postgres image by its digest from the
   internet. Do not load Postgres with `kind load`. The file `deploy/k8s/README.md` shows a
   different way for a node with no internet access.

3. Make the database secret and deploy the staging overlay:

   ```bash
   deploy/k8s/kind/db-env.sh
   kubectl apply -k deploy/k8s/overlays/staging
   kubectl --namespace radio-learning wait --for=condition=Ready pod --all --timeout=300s
   ```

   `db-env.sh` writes `deploy/k8s/overlays/staging/db.env` with random values. Git ignores it.

4. Run the E2E image. The cluster file maps the node port 30080 to port 8080 on `127.0.0.1`.

   ```bash
   docker build --target e2e -t radio-learning-e2e:local .
   docker run --rm --network host --shm-size=1g \
     -e BASE_URL=http://localhost:8080/ radio-learning-e2e:local
   ```

5. Test the network rules (rule R8). The script exits with 1 on a wrong result.

   ```bash
   deploy/k8s/kind/netpol-test.sh
   ```

6. Remove the cluster:

   ```bash
   kind delete cluster --name radio-learning
   ```

If port 8080 is busy, change `hostPort` in `deploy/k8s/kind/cluster.yaml` and use the new
port in `BASE_URL`.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Every scenario fails. The report shows a `Cross-Origin-Opener-Policy` console error. | `BASE_URL` is plain HTTP with a host name that is not loopback. | Use `http://localhost:8080/` with `--network container:<proxy>` or `--network host`. |
| `docker compose` prints `required variable APP_IMAGE is missing a value` (or `PROXY_IMAGE`). | The staging file needs the image names. | Export `APP_IMAGE` and `PROXY_IMAGE`. |
| `docker compose` prints an error for `!reset`. | Compose is older than 2.24.0. | Update Compose. |
| The suite stops: the first stream is not `https://station.test/hls/live.m3u8`. | The app uses another stream list. | Use `compose.staging.yaml`, which mounts `tests/fixtures/streams.txt`. |
| Chromium crashes or hangs. | Not enough shared memory. | Add `--shm-size=1g`. |
| `bind: address already in use` on port 8080. | Another stack uses the port. | Set a different `HTTP_PORT`, and use it in `BASE_URL`. |
| The `@live` scenarios fail. | The runner cannot reach the real station. | Run them on a machine with internet access. |
| `kubectl wait` times out on kind. | Calico is not ready, or an image is missing on the node. | Run `kubectl --namespace radio-learning get pods` and `describe pod`. Load the images again. |
| `kustomize build` fails for the staging overlay: `db.env` is missing. | You did not run `db-env.sh`. | Run `deploy/k8s/kind/db-env.sh`. |
