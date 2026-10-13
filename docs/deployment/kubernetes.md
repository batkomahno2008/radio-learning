# Deploy on Kubernetes

This guide shows how to run Radio Learning on a Kubernetes cluster with Kustomize. The
deployment has NGINX (`radio-learning-proxy`), the app (`radio-learning`) and Postgres
(`postgres`). There is no Helm chart.

The manifests are in `deploy/k8s/`. The file `deploy/k8s/README.md` has the layout and
the details. This guide has the steps for an operator.

Other guides:
[Docker Compose](docker-compose.md), [NGINX](nginx.md), [staging](staging.md).

## Warning: do not use the retired `ingress-nginx` controller

The community `ingress-nginx` controller of the Kubernetes project retired in March 2026.
It gets no security fixes. Do not install it for this product. The manifests have no
`ingress-nginx` annotations.

Use a maintained cluster edge:

- A Gateway API controller with a `Gateway`. This is the default.
- Or a maintained Ingress controller, with the `ingress` component (section 6).

## How the parts connect

```text
Browser --HTTPS--> Gateway or Ingress (stops TLS)
        --HTTP---> Service radio-learning-proxy (NGINX, port 80 to 8080)
        --HTTP---> Service radio-learning (app, port 80 to 3000)
        --------> Service postgres (port 5432)
```

Only NGINX is reachable from outside. A NetworkPolicy lets only NGINX reach the app. A second
rule lets only the app and the backup job reach Postgres.

## 1. Prerequisites

- Kubernetes 1.30 or later. The manifests use the `sleep` action of `preStop`. The files are
  checked with kubeconform for Kubernetes 1.37.0.
- `kubectl` that matches your cluster.
- Kustomize (`kustomize` 5 or later). `kubectl kustomize` and `kubectl apply -k` also work,
  but `kustomize edit set image` needs the `kustomize` tool.
- A default StorageClass. Postgres and the backup job each use a volume.
- A network plugin that enforces NetworkPolicy, for example Calico. Without it, every pod
  can reach the app and Postgres.
- A cluster edge: a Gateway API controller with a `Gateway`, or a maintained Ingress
  controller (see the warning above).
- A DNS name for the site, and a TLS certificate at the edge.
- Pods that can pull the images `ghcr.io/batkomahno2008/radio-learning` and
  `ghcr.io/batkomahno2008/radio-learning-proxy`, and `postgres:18.6-alpine`.

The namespace has the Pod Security level `restricted`. The cluster refuses a pod that runs
as root, so use the images of this project.

Get the files:

```bash
git clone https://github.com/batkomahno2008/radio-learning.git
cd radio-learning
git checkout <release tag>
```

Replace `<release tag>` with the release that you deploy, for example `v1.0.0`. The tag must agree with the image tag.
Run all commands in this guide from the repository root.

## 2. Create the namespace and the Secret

The Secret `radio-learning-db` is not in Git. Make it with `kubectl`. The password has hex
characters only, so the URL needs no escape.

```bash
kubectl create namespace radio-learning
PASSWORD="$(openssl rand -hex 24)"
kubectl --namespace radio-learning create secret generic radio-learning-db \
  --from-literal=POSTGRES_USER=radio \
  --from-literal=POSTGRES_DB=radio \
  --from-literal=POSTGRES_PASSWORD="$PASSWORD" \
  --from-literal=DATABASE_URL="postgres://radio:${PASSWORD}@postgres:5432/radio"
unset PASSWORD
```

Keep the password in your secret store. Do not write it in a file of the repository.

Check that the Secret has four keys:

```bash
kubectl --namespace radio-learning get secret radio-learning-db
```

The `DATA` column shows `4`. To read the password back from the Secret, run:

```bash
kubectl --namespace radio-learning get secret radio-learning-db -o jsonpath='{.data.POSTGRES_PASSWORD}' | base64 -d
```

## 3. Set the values of your cluster

Edit these files of the prod overlay. Keep your changes in a private branch or a private copy.

### 3.1 The image tags

The base uses the tag `main`. Do not deploy `main`. A node that has an old `main` image keeps
it, so the pods can run old code. Use a version tag or a digest. Both images use the same tag.

```bash
cd deploy/k8s/overlays/prod
kustomize edit set image \
  ghcr.io/batkomahno2008/radio-learning=ghcr.io/batkomahno2008/radio-learning:1.0.0 \
  ghcr.io/batkomahno2008/radio-learning-proxy=ghcr.io/batkomahno2008/radio-learning-proxy:1.0.0
cd ../../../..
```

Replace `1.0.0` with the version that you deploy.

### 3.2 The Gateway reference and the host name

Edit `deploy/k8s/overlays/prod/httproute.yaml`. Change these values:

| Field | What to set |
|---|---|
| `spec.parentRefs[0].name` | The name of your `Gateway`. |
| `spec.parentRefs[0].namespace` | The namespace of your `Gateway`. |
| `spec.parentRefs[0].sectionName` | The name of the HTTPS listener of the `Gateway`. |
| `spec.hostnames[0]` | Your DNS name. |

The `Gateway` must:

- Stop TLS and keep the `Strict-Transport-Security` header that NGINX sends.
- Accept routes from the namespace `radio-learning`. Set `allowedRoutes` on the listener, for
  example `namespaces.from: All`. Without it, the `HTTPRoute` is not accepted.
- Send plain HTTP requests to HTTPS. NGINX sends no redirect in this setup.

### 3.3 `REAL_IP_FROM`

Edit `deploy/k8s/overlays/prod/kustomization.yaml`. Find the line
`REAL_IP_FROM=REPLACE_WITH_EDGE_ADDRESS_RANGE`.

Replace the placeholder with the pod address range of your Gateway or Ingress controller.
Example: `REAL_IP_FROM=10.244.0.0/16`. Use a space to separate more than one range.

This setting is important for two reasons:

- NGINX reads the client IP from `X-Forwarded-For`, but only for requests from this range.
  The rate limits then count each client, and not the edge.
- Use the address range of the **pods** of the edge, not the address of the load balancer.
  For Envoy Gateway, use the pod network range.

The placeholder is not valid on purpose. NGINX stops at start until you set a real range.
The log of the pod then shows `REAL_IP_FROM: Use a space-separated list of addresses or CIDR ranges`.
This stops an unsafe default.

To find the pod addresses of your edge, run
`kubectl get pods --all-namespaces -o wide`, and find the pods of the controller.

### 3.4 `STATION_ORIGINS` and the streams ConfigMap

The streams ConfigMap and `STATION_ORIGINS` must agree. Change them together.

- `deploy/k8s/base/streams.txt`: one stream URL on each line. The app reads this file.
- `STATION_ORIGINS` in `deploy/k8s/base/kustomization.yaml`: the origin of each stream. The
  CSP of NGINX allows only these origins. Use a space to separate origins.

Example: if `streams.txt` has `https://stream.example.com/hls/live.m3u8`, set
`STATION_ORIGINS=https://stream.example.com`.

If an origin is missing, the page loads but the player cannot play. The browser console
shows CSP errors.

A change of a ConfigMap makes new pods, because the ConfigMap names have a hash. The pods
restart in a rolling update.

### 3.5 The check of the build

Render the overlay and look for the values that you set:

```bash
kubectl kustomize deploy/k8s/overlays/prod | grep -n "image:\|REAL_IP_FROM\|STATION_ORIGINS\|kind: HTTPRoute"
```

The output must show your image tags, your `REAL_IP_FROM` and your origins.

## 4. Apply the prod overlay

```bash
kubectl apply -k deploy/k8s/overlays/prod
```

## 5. Check the rollout

Wait for each workload:

```bash
kubectl --namespace radio-learning rollout status statefulset/postgres --timeout=300s
kubectl --namespace radio-learning rollout status deployment/radio-learning --timeout=300s
kubectl --namespace radio-learning rollout status deployment/radio-learning-proxy --timeout=300s
kubectl --namespace radio-learning get pods
```

All pods must be `Running` and `READY`. The prod overlay has 2 replicas of NGINX and 2
replicas of the app, and one pod of Postgres.

Check the site through a port-forward (this does not use the edge):

```bash
kubectl --namespace radio-learning port-forward service/radio-learning-proxy 8080:80
```

In a different terminal:

```bash
curl -s http://localhost:8080/healthz
curl -s http://localhost:8080/api/ready
```

The answers are `ok` and `{"status":"ready"}`.

Check the route and the edge:

```bash
kubectl --namespace radio-learning describe httproute radio-learning
curl -s https://radio.example.com/api/ready
```

The `describe` output must show the condition `Accepted` with the status `True`. Replace
`radio.example.com` with your DNS name.

## 6. A cluster without Gateway API

Use the `ingress` component. It removes the `HTTPRoute` and adds an `Ingress`.

1. Edit `deploy/k8s/components/ingress/ingress.yaml`. Set `ingressClassName`, the host name
   (two places) and the name of the TLS Secret. The Secret must be in the namespace
   `radio-learning`. Make it with your certificate tool.
2. Do not add `ingress-nginx` annotations. If your controller needs annotations, add them
   in your own overlay.
3. Make your own overlay:

   ```bash
   mkdir deploy/k8s/overlays/my-cluster
   ```

   Write this to `deploy/k8s/overlays/my-cluster/kustomization.yaml`:

   ```yaml
   apiVersion: kustomize.config.k8s.io/v1beta1
   kind: Kustomization
   resources:
     - ../prod
   components:
     - ../../components/ingress
   ```

4. Set the image tags, `REAL_IP_FROM` and `STATION_ORIGINS` as in section 3. Use the
   prod overlay for these settings. The Gateway values in `httproute.yaml` do not matter,
   because the component removes the `HTTPRoute`.
5. Apply your overlay: `kubectl apply -k deploy/k8s/overlays/my-cluster`.
6. Do the checks of section 5. Use `kubectl --namespace radio-learning describe ingress radio-learning` in place of the route check.

## 7. Upgrade and roll back

### Upgrade

1. Make a backup (section 8).
2. Set the new tag for both images (section 3.1).
3. Apply the overlay: `kubectl apply -k deploy/k8s/overlays/prod`.
4. Do the rollout checks (section 5).

Kubernetes replaces the pods one by one. A `preStop` sleep of 5 seconds and the readiness probe
keep requests from reaching a pod that stops.

### Roll back

Use `kubectl rollout undo` for the app and for NGINX:

```bash
kubectl --namespace radio-learning rollout undo deployment/radio-learning
kubectl --namespace radio-learning rollout undo deployment/radio-learning-proxy
kubectl --namespace radio-learning rollout status deployment/radio-learning --timeout=300s
kubectl --namespace radio-learning rollout status deployment/radio-learning-proxy --timeout=300s
```

To see the history, run `kubectl --namespace radio-learning rollout history deployment/radio-learning`.

Then set the old tag again in your overlay (section 3.1). If you do not, the next
`kubectl apply` installs the new tag again.

If the new version changed the data, restore the backup from step 1 (section 8).

## 8. Backups

`CronJob/radio-learning-backup` runs `pg_dump --format=custom` each day at 03:17 UTC. It writes
`radio-learning-<time>.dump` to the volume `radio-learning-backup`. It checks the file with
`pg_restore --list`, and it keeps the 7 newest files.

The backup volume is in the same cluster as the database. A loss of the cluster loses both.
Copy the dump files out of the cluster (section 8.2).

### 8.1 Run a backup now

```bash
kubectl --namespace radio-learning create job --from=cronjob/radio-learning-backup backup-now
kubectl --namespace radio-learning wait --for=condition=complete job/backup-now --timeout=180s
kubectl --namespace radio-learning logs job/backup-now
```

The log lists the dump files. Remove the job when you no longer need it:
`kubectl --namespace radio-learning delete job backup-now`.

### 8.2 Copy a dump out of the cluster

1. Start a pod that mounts the backup volume read-only. Save this as `backup-reader.yaml`:

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
         command: ["sleep", "3600"]
         securityContext:
           allowPrivilegeEscalation: false
           readOnlyRootFilesystem: true
           capabilities:
             drop: ["ALL"]
         volumeMounts:
           - {name: backup, mountPath: /backups, readOnly: true}
     volumes:
       - name: backup
         persistentVolumeClaim:
           claimName: radio-learning-backup
   ```

2. Apply it and wait:

   ```bash
   kubectl --namespace radio-learning apply -f backup-reader.yaml
   kubectl --namespace radio-learning wait --for=condition=Ready pod/radio-learning-restore --timeout=120s
   ```

3. Copy the files, then delete the pod:

   ```bash
   kubectl --namespace radio-learning cp radio-learning-restore:/backups ./radio-learning-backups
   kubectl --namespace radio-learning delete pod radio-learning-restore
   ```

4. Store the files outside the cluster, for example in an object store.

### 8.3 Restore into a fresh database

Use this to check a dump or to read old data. The live database does not change.

1. Find the file name in the log of a backup job (section 8.1).
2. Save this as `restore-test.yaml`. Set `DUMP_FILE` to the file name.

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

3. Apply it, wait, and read the log:

   ```bash
   kubectl --namespace radio-learning apply -f restore-test.yaml
   kubectl --namespace radio-learning wait --for=jsonpath='{.status.phase}'=Succeeded pod/radio-learning-restore --timeout=120s
   kubectl --namespace radio-learning logs radio-learning-restore
   ```

   The log shows the number of ratings in the restored database `radio_restore`.

4. Delete the pod. Drop the database when you no longer need it:

   ```bash
   kubectl --namespace radio-learning delete pod radio-learning-restore
   kubectl --namespace radio-learning exec statefulset/postgres -- dropdb -U radio radio_restore
   ```

### 8.4 Restore into the live database (disaster recovery)

Use this when the data is lost or wrong. The restore replaces the content of the database.
Run all steps in the same shell, because step 1 sets a shell variable.

1. Record the number of app replicas. Then stop the app.

   ```bash
   REPLICAS="$(kubectl --namespace radio-learning get deployment/radio-learning -o jsonpath='{.spec.replicas}')"
   echo "replicas: $REPLICAS"
   kubectl --namespace radio-learning scale deployment/radio-learning --replicas=0
   ```

2. Do this step only if the Postgres volume is lost. It makes an empty Postgres.

   ```bash
   kubectl --namespace radio-learning scale statefulset/postgres --replicas=0
   kubectl --namespace radio-learning delete pvc/data-postgres-0
   kubectl --namespace radio-learning scale statefulset/postgres --replicas=1
   kubectl --namespace radio-learning rollout status statefulset/postgres --timeout=300s
   ```

3. Find the file name of the dump in the log of a backup job (section 8.1). Then start the restore pod.
   Replace the value of `DUMP_FILE`.

   ```bash
   DUMP_FILE=radio-learning-20261012T224546Z.dump
   cat <<'EOF' | sed "s/REPLACE_DUMP_FILE/$DUMP_FILE/" | kubectl --namespace radio-learning apply -f -
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
             value: REPLACE_DUMP_FILE
           - name: TARGET_DB
             value: radio
         command:
           - sh
           - -c
           - pg_restore --clean --if-exists --no-owner --dbname="$TARGET_DB" "/backups/$DUMP_FILE"
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
   EOF
   ```

   `TARGET_DB` is `radio`, the value of `POSTGRES_DB`.

4. Wait until the pod succeeds. Read the log. Delete the pod.

   ```bash
   kubectl --namespace radio-learning wait --for=jsonpath='{.status.phase}'=Succeeded pod/radio-learning-restore --timeout=300s
   kubectl --namespace radio-learning logs radio-learning-restore
   kubectl --namespace radio-learning delete pod radio-learning-restore
   ```

5. Start the app with the number of replicas from step 1. Check the rollout.

   ```bash
   kubectl --namespace radio-learning scale deployment/radio-learning --replicas="$REPLICAS"
   kubectl --namespace radio-learning rollout status deployment/radio-learning --timeout=300s
   curl -s https://radio.example.com/api/ready
   ```

The dump holds the ratings only. The app makes its table again at each start, so a restore
into a new empty cluster also works.

## 9. Limits of Postgres in the cluster

- Postgres is one pod (a StatefulSet with one replica). There is no replica and no
  automatic failover.
- When the node fails, the database is down until the pod starts on another node. The
  volume must be reachable from that node.
- The daily dump limits the data loss to 24 hours. Run a backup before each upgrade.
- The dumps are in the same cluster. Copy them out (section 8.2).
- The manifests do not rotate the password. See "Change the password" below.
- A change of the Secret does not restart the pods. A change of a ConfigMap does.
- High availability is not part of version 1.0.0.

### Change the password

1. Make a new password. Replace the Secret with it. Use hex characters only.

   ```bash
   PASSWORD="$(openssl rand -hex 24)"
   kubectl --namespace radio-learning create secret generic radio-learning-db \
     --from-literal=POSTGRES_USER=radio \
     --from-literal=POSTGRES_DB=radio \
     --from-literal=POSTGRES_PASSWORD="$PASSWORD" \
     --from-literal=DATABASE_URL="postgres://radio:${PASSWORD}@postgres:5432/radio" \
     --dry-run=client -o yaml | kubectl --namespace radio-learning replace -f -
   echo "$PASSWORD"
   ```

2. Change the password in Postgres. Replace `<new password>` with the value from step 1.

   ```bash
   kubectl --namespace radio-learning exec statefulset/postgres -- psql -U radio -d radio -c "ALTER ROLE radio PASSWORD '<new password>'"
   ```

3. Restart the app:

   ```bash
   kubectl --namespace radio-learning rollout restart deployment/radio-learning
   ```

## 10. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| A proxy pod is in `CrashLoopBackOff`. Its log has `REAL_IP_FROM: Use a space-separated list`. | `REAL_IP_FROM` still has the placeholder or a wrong value. | Set the pod address range of the edge (section 3.3). Apply again. |
| A proxy pod is in `CrashLoopBackOff`. Its log has `STATION_ORIGINS`. | An origin is not an `https://` origin. | Fix `STATION_ORIGINS` (section 3.4). |
| A pod is in `CreateContainerConfigError` with `secret "radio-learning-db" not found`. | You did not make the Secret. | Make it (section 2). |
| A pod stays `Pending`. | No StorageClass, or no resources on the nodes. | Run `kubectl --namespace radio-learning describe pod <name>`. Set a default StorageClass. |
| A pod is in `ImagePullBackOff`. | The tag does not exist, or the node cannot reach the registry. | Check the tag (section 3.1). Check the network of the node. |
| The pods use old code after an upgrade. | You use the tag `main` and the node keeps an old image. | Use a version tag or a digest. |
| The site answers `404` or `503` from the edge, not from NGINX. | The `HTTPRoute` or the `Ingress` is not accepted. | Run `kubectl --namespace radio-learning describe httproute radio-learning`. Fix `parentRefs` and `allowedRoutes`. |
| The site answers `502` or `504` from NGINX. | The app pods are not ready. | Run `kubectl --namespace radio-learning get pods` and `logs deployment/radio-learning`. |
| `/api/ready` answers `503`. | The app cannot reach Postgres. | Run `kubectl --namespace radio-learning logs statefulset/postgres`. Check the Secret and the NetworkPolicy. |
| The app logs `password authentication failed`. | The Secret was changed after Postgres made its database. | Run `ALTER ROLE` with the password of the Secret ("Change the password" in section 9). |
| Many answers are `429`, also for different clients. | `REAL_IP_FROM` is wrong, so NGINX counts all clients as the edge address. | Set the pod range of the edge (section 3.3). |
| The page loads but the player is silent. The console shows CSP errors. | The stream origin is not in `STATION_ORIGINS`. | Add the origin (section 3.4). Apply again. |
| Every pod can reach Postgres. | The network plugin does not enforce NetworkPolicy. | Install a plugin that enforces it, for example Calico. |
| `kubectl apply` fails for `HTTPRoute` with `no matches for kind`. | The cluster has no Gateway API CRDs. | Install the Gateway API CRDs and a controller. Or use the `ingress` component (section 6). |
| The backup job fails. | The backup volume is full or Postgres is down. | Run `kubectl --namespace radio-learning logs job/<name>`. |
