# Helm chart `radio-learning`

The chart installs NGINX, the app and Postgres. It is for a staging-like stack: HTTP only,
reachable on the network. The chart has no file from this repository. The stream list is in
`values.yaml`, and the images come from GHCR.

## 1. Publish the chart (once, on a machine with the repository)

```bash
helm package deploy/helm/radio-learning                  # makes radio-learning-0.1.0.tgz
echo "$GHCR_TOKEN" | helm registry login ghcr.io -u batkomahno2008 --password-stdin
helm push radio-learning-0.1.0.tgz oci://ghcr.io/batkomahno2008/charts
```

No registry? Copy the `.tgz` file to the target machine and use it in place of the `oci://` address.

## 2. Install (no repository on the target)

The target needs `helm` 3.8 or later, `kubectl` access and a default storage class.

```bash
helm install radio oci://ghcr.io/batkomahno2008/charts/radio-learning --version 0.1.0 \
  --namespace radio-learning --create-namespace \
  --set images.app.tag=main --set images.proxy.tag=main
```

Use a `sha-<short>` or release tag, not `main`, for a repeatable install.

Open `http://<node-ip>:30080/` from the network. `kubectl get nodes -o wide` shows the node
addresses. Open the node port in the firewall.

To use a load balancer, add `--set service.type=LoadBalancer --set service.port=80`. Then read the
address with `kubectl -n radio-learning get svc radio-proxy`.

## 3. Settings

Put the changes in a file `my-values.yaml` and add `-f my-values.yaml`. All keys are in `values.yaml`.

| Key | Use |
|---|---|
| `streams`, `stationOrigins` | Stream URLs. Add the `https` origin of each stream to `stationOrigins`, or the CSP blocks it. |
| `service.type`, `service.nodePort` | `NodePort` (default, 30080) or `LoadBalancer`. |
| `database.password` | Empty: the chart makes a random one and keeps it. |
| `database.existingSecret` | Your own Secret with `DATABASE_URL`, `POSTGRES_USER`, `POSTGRES_DB`, `POSTGRES_PASSWORD`. |
| `database.storage.storageClass` | Storage class of the data volume. |
| `imagePullSecrets` | Names of pull Secrets, if the GHCR packages are private. |
| `networkPolicy.enabled` | Set `false` on a cluster with no policy plugin, if the policies cause trouble. |
| `app.replicas`, `proxy.replicas` | Use 2 or more with `podDisruptionBudget.enabled=true`. |

Private images:

```bash
kubectl -n radio-learning create secret docker-registry ghcr \
  --docker-server=ghcr.io --docker-username=<user> --docker-password=<token>
helm upgrade ... --set 'imagePullSecrets={ghcr}'
```

## 4. Check, upgrade, remove

```bash
kubectl -n radio-learning get pods
curl -i http://<node-ip>:30080/api/ready
helm upgrade radio oci://ghcr.io/batkomahno2008/charts/radio-learning --version <new> \
  -n radio-learning --reuse-values --set images.app.tag=<tag> --set images.proxy.tag=<tag>
helm uninstall radio -n radio-learning
```

`helm uninstall` keeps the Secret, the data volume and the backup volume. To delete all data:

```bash
kubectl -n radio-learning delete secret radio-db
kubectl -n radio-learning delete pvc --all
```

(Objects are named `<release>-app`, `<release>-proxy`, `<release>-postgres` and `<release>-db`.)

## 5. Notes

- Backup: a daily `pg_dump` CronJob. Run it by hand with
  `kubectl -n radio-learning create job --from=cronjob/radio-backup manual-1`.
- Plain HTTP on a host name that is not `localhost`: the page works, and the browser logs a harmless
  warning about the `Cross-Origin-Opener-Policy` header. The client makes its id without
  `crypto.randomUUID()` there.
- Pod Security: the pods follow the `restricted` level. To enforce it, run
  `kubectl label ns radio-learning pod-security.kubernetes.io/enforce=restricted`.
- The chart does not add TLS. Add TLS in front of the Service (a load balancer or an Ingress).
