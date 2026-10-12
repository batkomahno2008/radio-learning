#!/bin/sh
# Tests rule R8 of docs/security/policy.md with throwaway pods: only NGINX is reachable
# from outside, only NGINX reaches the app, and only the app and the backup job reach Postgres.
#
# Run it on the current kubectl context, after the staging overlay is ready.
# The cluster needs a network plugin that enforces NetworkPolicy (install-calico.sh).
# The script exits with 1 when one result is not as expected.
set -eu

NS="${NAMESPACE:-radio-learning}"
OTHER_NS="${OTHER_NAMESPACE:-netpol-other}"
# The image of the StatefulSet: it has wget and pg_isready.
IMAGE="postgres:18.6-alpine@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873"

kubectl get namespace "$OTHER_NS" > /dev/null 2>&1 || kubectl create namespace "$OTHER_NS" > /dev/null

failures=0

# probe NAMESPACE NAME-LABEL EXPECTED TITLE
# Starts one pod, tries the three Services and compares the result with EXPECTED.
probe() {
  ns="$1"; name="$2"; expected="$3"; title="$4"
  kubectl --namespace "$ns" delete pod netpol-probe --ignore-not-found --wait=true > /dev/null
  kubectl --namespace "$ns" apply -f - > /dev/null <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: netpol-probe
  labels:
    ${name:+app.kubernetes.io/name: $name}
    netpol-probe: "true"
spec:
  restartPolicy: Never
  automountServiceAccountToken: false
  securityContext:
    runAsNonRoot: true
    runAsUser: 70
    runAsGroup: 70
    seccompProfile:
      type: RuntimeDefault
  containers:
    - name: probe
      image: $IMAGE
      imagePullPolicy: IfNotPresent
      securityContext:
        allowPrivilegeEscalation: false
        readOnlyRootFilesystem: true
        capabilities:
          drop: ["ALL"]
      command:
        - sh
        - -c
        - |
          t() { if "\$@" > /dev/null 2>&1; then printf reachable; else printf BLOCKED; fi; }
          printf 'proxy=%s app=%s postgres=%s\n' \
            "\$(t wget -T 3 -q -O /dev/null http://radio-learning-proxy.$NS.svc.cluster.local/healthz)" \
            "\$(t wget -T 3 -q -O /dev/null http://radio-learning.$NS.svc.cluster.local/api/health)" \
            "\$(t pg_isready -t 3 -h postgres.$NS.svc.cluster.local -p 5432)"
EOF
  kubectl --namespace "$ns" wait --for=jsonpath='{.status.phase}'=Succeeded pod/netpol-probe --timeout=120s > /dev/null 2>&1 || true
  actual="$(kubectl --namespace "$ns" logs netpol-probe 2>/dev/null || true)"
  kubectl --namespace "$ns" delete pod netpol-probe --wait=false > /dev/null
  if [ "$actual" = "$expected" ]; then
    echo "PASS  $title: $actual"
  else
    echo "FAIL  $title: expected '$expected', got '$actual'"
    failures=$((failures + 1))
  fi
}

probe "$OTHER_NS" ""                      "proxy=reachable app=BLOCKED postgres=BLOCKED"   "pod in another namespace"
probe "$NS"       ""                      "proxy=reachable app=BLOCKED postgres=BLOCKED"   "pod in the namespace, no label"
probe "$NS"       radio-learning-proxy    "proxy=reachable app=reachable postgres=BLOCKED" "pod with the NGINX label"
probe "$NS"       radio-learning          "proxy=reachable app=BLOCKED postgres=reachable" "pod with the app label"
probe "$NS"       radio-learning-backup   "proxy=reachable app=BLOCKED postgres=reachable" "pod with the backup job label"

[ "$failures" -eq 0 ] || { echo "$failures check(s) failed."; exit 1; }
echo "All checks passed."
