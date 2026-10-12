#!/bin/sh
# Installs Calico, a network plugin that enforces NetworkPolicy, on the current
# kubectl context (a kind cluster made with cluster.yaml).
#
# The script downloads a pinned release of the manifest, checks its SHA-256 sum and
# applies it. Set CALICO_REGISTRY to use a mirror of the images, for example
# CALICO_REGISTRY=docker.io/calico when quay.io is not reachable.
set -eu

CALICO_VERSION=v3.33.0
CALICO_SHA256=2de8f47595fb9c41b3f47d7b767a1f8e72ecf84057af834738ff12689a234da5
CALICO_REGISTRY="${CALICO_REGISTRY:-quay.io/calico}"
URL="https://raw.githubusercontent.com/projectcalico/calico/${CALICO_VERSION}/manifests/calico.yaml"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

curl -fsSL --retry 3 -o "$work/calico.yaml" "$URL"
echo "${CALICO_SHA256}  $work/calico.yaml" | sha256sum -c -

sed "s#quay.io/calico/#${CALICO_REGISTRY}/#g" "$work/calico.yaml" | kubectl apply -f -

kubectl --namespace kube-system rollout status daemonset/calico-node --timeout=300s
kubectl --namespace kube-system rollout status deployment/calico-kube-controllers --timeout=300s
kubectl wait --for=condition=Ready nodes --all --timeout=300s
