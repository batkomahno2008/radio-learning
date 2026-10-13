# Kubernetes manifests

This directory deploys NGINX, the app and Postgres with Kustomize (epic #1, decisions D6,
D8 and D13). There is no Helm chart. The full deployment guide is issue #12. This file
has the layout, the commands and the backup runbook.

## Layout

| Path | Content |
|---|---|
| `base/` | Namespace, NGINX (Deployment, Service), app (Deployment, Service), Postgres (StatefulSet, headless Service), NetworkPolicies, PodDisruptionBudgets, backup CronJob and its volume, ConfigMaps. |
| `overlays/staging/` | A temporary environment on a kind cluster. NodePort 30080 on NGINX, fake station, 1 replica, small volumes, Secret from `db.env`. |
| `overlays/prod/` | 2 replicas, `HTTPRoute` for the Gateway API, bigger volumes. It has placeholders. |
| `components/ingress/` | A generic `Ingress` for clusters without Gateway API. It replaces the `HTTPRoute`. |
| `kind/` | `cluster.yaml` (kind cluster), `install-calico.sh`, `db-env.sh`, `netpol-test.sh`. |

## Requirements

- Kubernetes 1.30 or newer. The manifests use the `sleep` action of `preStop`. kubeconform ran against 1.37.0.
- A default StorageClass for the Postgres volume and the backup volume.
- A network plugin that enforces NetworkPolicy, for example Calico. Without it, the policies have no effect and every pod can reach the app and Postgres.
- A cluster edge: a Gateway API controller with a `Gateway`, or an Ingress controller. Do not use the community `ingress-nginx` controller. It is retired. The manifests have no `ingress-nginx` annotation.

## Pods

| Pod | Image | User | Port | Probes |
|---|---|---|---|---|
| `radio-learning-proxy` | `ghcr.io/batkomahno2008/radio-learning-proxy` | 101 | 8080 | `GET /healthz` |
| `radio-learning` | `ghcr.io/batkomahno2008/radio-learning` | 1000 | 3000 | startup and liveness `GET /api/health`, readiness `GET /api/ready` |
| `postgres` | `postgres:18.6-alpine`, pinned by digest | 70 | 5432 | `pg_isready` |

All pods obey rules R1 to R7 and R10 of `docs/security/policy.md`: non-root user, read-only
root file system, no capabilities, no privilege escalation, `RuntimeDefault` seccomp,
resource limits and no service account token. The namespace has the Pod Security level
`restricted`, so the cluster refuses a pod that breaks these rules. Writable paths are
`emptyDir` volumes at `/tmp`, plus `/var/run/postgresql` and the data volume for Postgres.

The app and NGINX are stateless. `terminationGracePeriodSeconds` is 30. A `preStop` sleep of
5 seconds gives the Service time to remove the pod. The app then needs 10 seconds at most
to finish open requests.

### Memory of NGINX

NGINX starts one worker for each CPU of the node (`worker_processes auto`), also when the
CPU limit of the pod is lower. Each idle worker uses about 5 MiB, and the master uses
about 7 MiB (measured on a node with 4 CPUs: 7 MiB for the pod). Each connection with a
large header can use up to 4 buffers of 96 KiB. The limit of 256 MiB is enough for a node
with up to about 30 CPUs. On a bigger node, raise the memory limit of `radio-learning-proxy`.

## Network rules (R8)

`base/networkpolicy.yaml` denies all incoming traffic in the namespace, then allows:

- NGINX: port 8080 from any source (the cluster edge or the node port).
- The app: port 3000 from the NGINX pods only.
- Postgres: port 5432 from the app pods and the backup job pods only.

Only the Service `radio-learning-proxy` can be reached from outside. It is a `ClusterIP`
Service. The staging overlay changes it to a `NodePort`. The policies control incoming
traffic only. Add egress policies if your rules need them.

To test the policies on a running cluster, run `deploy/k8s/kind/netpol-test.sh`. It starts
temporary pods in another namespace and in the app namespace, and it exits with 1 when a
result is not as expected.

## Staging on kind

The commands below make a cluster, load the images, deploy the staging overlay and run
the E2E suite on the host. Run them from the repository root. Use the images that
Dockerfile targets `runtime` and `proxy` make (issue #8).

```bash
kind create cluster --config deploy/k8s/kind/cluster.yaml
deploy/k8s/kind/install-calico.sh
docker build --target runtime -t radio-learning:ci .
docker build --target proxy -t radio-learning-proxy:ci .
kind load docker-image radio-learning:ci radio-learning-proxy:ci --name radio-learning
deploy/k8s/kind/db-env.sh                      # makes overlays/staging/db.env, Git ignores it
kubectl apply -k deploy/k8s/overlays/staging
kubectl --namespace radio-learning wait --for=condition=Ready pod --all --timeout=300s
BASE_URL=http://localhost:8080/ npm run test:e2e
deploy/k8s/kind/netpol-test.sh
kind delete cluster --name radio-learning
```

- `cluster.yaml` maps the node port 30080 to the host port 8080 on 127.0.0.1. Change `hostPort` when port 8080 is busy.
- Use `http://localhost:8080/` as `BASE_URL`. Chromium ignores the `Cross-Origin-Opener-Policy` header on plain HTTP with another host name, and the clean-console rule of the E2E suite then fails every scenario.
- Load only the two `:ci` images. The node pulls the Postgres image by its digest from Docker Hub, so the machine needs internet access (GitHub runners have it). Do not run `kind load docker-image postgres:...`: a pull by digest does not make the tag in Docker, and with the containerd image store `kind load` can fail with `ctr: content digest ... not found`.
- For a node with no internet access, put the Postgres image on the node under its digest name. A load by tag alone is not enough, because the manifests name the image by tag and digest and the kubelet then pulls it:

  ```bash
  IMAGE=postgres:18.6-alpine@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873
  docker pull "$IMAGE"
  docker tag "$IMAGE" postgres:18.6-alpine        # the save command needs a tag
  docker save postgres:18.6-alpine | docker exec -i radio-learning-control-plane \
    ctr --namespace=k8s.io images import --digests --snapshotter=overlayfs -
  docker exec radio-learning-control-plane ctr --namespace=k8s.io images tag \
    docker.io/library/postgres:18.6-alpine \
    docker.io/library/postgres@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873
  ```
- `install-calico.sh` checks the SHA-256 sum of the pinned Calico manifest. Set `CALICO_REGISTRY` to use a mirror of the images.
- The staging overlay uses the tag `ci` and `imagePullPolicy: IfNotPresent`.
- The `@live` scenarios run through this NGINX too: `STATION_ORIGINS` has the fake station and the real station.

## Production

1. Make the namespace and the Secret. The Secret is not in Git. Use a password of hex characters, so the URL needs no escape:

   ```bash
   kubectl create namespace radio-learning
   PASSWORD="$(openssl rand -hex 24)"
   kubectl --namespace radio-learning create secret generic radio-learning-db \
     --from-literal=POSTGRES_USER=radio \
     --from-literal=POSTGRES_DB=radio \
     --from-literal=POSTGRES_PASSWORD="$PASSWORD" \
     --from-literal=DATABASE_URL="postgres://radio:${PASSWORD}@postgres:5432/radio"
   ```

2. Change the placeholders in your copy of `overlays/prod/`:
   - `httproute.yaml`: the `Gateway` (`name`, `namespace`, `sectionName`) and the host name.
   - `kustomization.yaml`: `REAL_IP_FROM`, the address range of the Gateway or Ingress controller pods. NGINX does not start with the placeholder, on purpose.
   - `base/streams.txt` and `STATION_ORIGINS` in `base/kustomization.yaml`: the stream list and the origin of each stream. Keep them the same.
3. Set the image tags. Use a version tag or a digest, not `main`. The base uses the tag `main`, and a pod with a tag runs with `imagePullPolicy: IfNotPresent`. A node that has an old `main` image keeps it, so the pods can run stale code. The deploy step must always set a real tag:

   ```bash
   cd deploy/k8s/overlays/prod
   kustomize edit set image \
     ghcr.io/batkomahno2008/radio-learning=ghcr.io/batkomahno2008/radio-learning:1.0.0 \
     ghcr.io/batkomahno2008/radio-learning-proxy=ghcr.io/batkomahno2008/radio-learning-proxy:1.0.0
   ```

4. Apply: `kubectl apply -k deploy/k8s/overlays/prod`.

The Gateway stops TLS. NGINX and the app use plain HTTP in the cluster. The Gateway
must keep the `Strict-Transport-Security` header that NGINX sends. The Gateway must also:

- Allow routes from the namespace `radio-learning`: set `allowedRoutes` on the listener (for example `namespaces.from: All`, or a selector for this namespace). Without it, the `HTTPRoute` is not accepted.
- Send plain HTTP requests to HTTPS. The Gateway does this, not NGINX. NGINX on port 8080 serves the site and sends no redirect in this setup.

### A cluster without Gateway API

Make your own overlay that uses the `ingress` component. The component removes the
`HTTPRoute` and adds an `Ingress`. Change `ingressClassName`, the host name and the TLS
Secret in `components/ingress/ingress.yaml` first.

```yaml
# overlays/my-cluster/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ../prod
components:
  - ../../components/ingress
```

### Check the manifests

```bash
deploy/k8s/kind/db-env.sh                          # staging needs db.env
for overlay in staging prod; do
  kubectl kustomize "deploy/k8s/overlays/$overlay" | kubeconform -strict -summary \
    -kubernetes-version 1.37.0 \
    -schema-location default \
    -schema-location 'https://raw.githubusercontent.com/datreeio/CRDs-catalog/main/{{.Group}}/{{.ResourceKind}}_{{.ResourceAPIVersion}}.json'
done
```

The second `-schema-location` has the Gateway API schemas. Pin its commit in CI.

## Backup and restore

`CronJob/radio-learning-backup` runs `pg_dump --format=custom` every day at 03:17 UTC. It
writes `radio-learning-<time>.dump` to the volume `radio-learning-backup`, checks the file
with `pg_restore --list`, and keeps the 7 newest files. The volume is separate from the
data volume of Postgres, but it is in the same cluster. Copy the files out of the cluster
too (see "Copy the dump files" below).

Run a backup now:

```bash
kubectl --namespace radio-learning create job --from=cronjob/radio-learning-backup backup-now
kubectl --namespace radio-learning wait --for=condition=complete job/backup-now --timeout=180s
kubectl --namespace radio-learning logs job/backup-now      # lists the dump files
```

### Restore into a fresh database

Use this to check a dump or to read old data. The live database does not change.

1. Find the file name in the log of a backup job. Put it in `DUMP_FILE` below.
2. Apply this pod. The label lets the NetworkPolicy connect it to Postgres.

   ```yaml
   apiVersion: v1
   kind: Pod
   metadata:
     name: radio-learning-restore
     labels:
       app.kubernetes.io/name: radio-learning-backup
   spec:
     restartPolicy: Never
     automountServiceAccountToken: false
     enableServiceLinks: false
     securityContext:
       runAsNonRoot: true
       runAsUser: 70
       runAsGroup: 70
       fsGroup: 70
       seccompProfile:
         type: RuntimeDefault
     containers:
       - name: restore
         image: postgres:18.6-alpine@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873
         securityContext:
           allowPrivilegeEscalation: false
           readOnlyRootFilesystem: true
           capabilities:
             drop: ["ALL"]
         env:
           - name: PGHOST
             value: postgres
           - name: PGUSER
             valueFrom:
               secretKeyRef: {name: radio-learning-db, key: POSTGRES_USER}
           - name: PGPASSWORD
             valueFrom:
               secretKeyRef: {name: radio-learning-db, key: POSTGRES_PASSWORD}
           - name: DUMP_FILE
             value: radio-learning-20261012T224546Z.dump
           - name: TARGET_DB
             value: radio_restore
         command:
           - sh
           - -c
           - |
             set -eu
             psql --dbname=postgres --command="CREATE DATABASE \"$TARGET_DB\""
             pg_restore --no-owner --dbname="$TARGET_DB" "/backups/$DUMP_FILE"
             psql --dbname="$TARGET_DB" --command='SELECT count(*) AS ratings FROM ratings'
         volumeMounts:
           - {name: backup, mountPath: /backups, readOnly: true}
           - {name: tmp, mountPath: /tmp}
     volumes:
       - name: backup
         persistentVolumeClaim:
           claimName: radio-learning-backup
       - name: tmp
         emptyDir:
           sizeLimit: 64Mi
   ```

3. Wait for the pod and read the log:
   `kubectl --namespace radio-learning wait --for=jsonpath='{.status.phase}'=Succeeded pod/radio-learning-restore`,
   then `kubectl --namespace radio-learning logs radio-learning-restore`.
4. Delete the pod. Drop the database when you no longer need it.

### Restore into the live database (disaster recovery)

Use this when the data is lost or wrong. The restore replaces the content of the database.

1. Stop the app: `kubectl --namespace radio-learning scale deployment/radio-learning --replicas=0`.
2. If the Postgres volume is lost, make an empty Postgres: scale `statefulset/postgres` to 0, delete `pvc/data-postgres-0`, scale it to 1 and wait until the pod is ready.
3. Apply the restore pod above with two changes: `TARGET_DB` is `radio` (the value of `POSTGRES_DB`), and the command is only `pg_restore --clean --if-exists --no-owner --dbname="$TARGET_DB" "/backups/$DUMP_FILE"` (remove the `CREATE DATABASE` line).
4. Wait until the pod succeeds. Delete it.
5. Start the app again: scale `deployment/radio-learning` to the old number of replicas. Check `GET /api/ready`.

The dump holds the ratings only. The app makes its table again at each start, so a restore
into a new empty cluster works.

### Copy the dump files

Start the restore pod with `command: ["sleep", "3600"]` and no `env`, then run:

```bash
kubectl --namespace radio-learning cp radio-learning-restore:/backups ./radio-learning-backups
```

Store the files outside the cluster, for example in an object store.

## Known limits

- Postgres is one pod. A node failure stops the database until the pod starts on another node. The daily dump limits the data loss to 24 hours. High availability is a follow-up after #15.
- The password in the Secret is not rotated by the manifests. To change it, change the Secret, change the password in Postgres (`ALTER ROLE`) and restart the app.
- A change of a ConfigMap (stream list, NGINX variables) restarts the pods, because the generated name has a hash. A change of the Secret does not restart them.
