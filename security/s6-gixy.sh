#!/usr/bin/env bash
# S6 NGINX config scan (docs/security/policy.md, sections 3.2 and 9) with gixy-ng.
# gixy-ng must read the config that NGINX uses: /etc/nginx and the files that the start
# script and the envsubst step write to /tmp/nginx. Thus this script copies both trees out
# of a started proxy container, and runs gixy-ng on the copies at the same paths.
#
# Usage: security/s6-gixy.sh <proxy-container> <output-prefix>
#   <proxy-container>  A started container of the proxy image (or of the stock image with
#                      the files of deploy/nginx/ mounted). Mount deploy/nginx/tls/tls.conf
#                      at /etc/nginx/tls/tls.conf for the TLS run, so that the 9.5 rules are checked.
#   <output-prefix>    For example out/s6-nginx-http. The script writes <prefix>.json and <prefix>.sarif.
#   GIXY_IMAGE         Optional. The gixy-ng image (default: the pin of docs/adr/0002-security-tooling.md).
#   NGINX_VERSION      Optional. Default: the version that 'nginx -v' in the container gives.
#
# Needs: Bash 4 or later, Docker, jq, tar.
# Exit code: 0 when the scan ran (the gate step counts the findings in the SARIF file),
# 1 when the rendered config is missing or the scan did not run, 2 for a usage error.

set -euo pipefail

GIXY_IMAGE="${GIXY_IMAGE:-getpagespeed/gixy:v0.2.55@sha256:11170c9b4fc22d30a8d01a19d172382220900599facba4cac5ce01d5b0a77b86}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if (($# != 2)); then
  echo "usage: $0 <proxy-container> <output-prefix>" >&2
  exit 2
fi
container="$1"
prefix="$2"
mkdir -p "$(dirname "$prefix")"

# The rendered config must exist. Without it, gixy-ng skips the server blocks with no error.
for f in /tmp/nginx/conf.d/default.conf /tmp/nginx/http-site.conf /etc/nginx/nginx.conf; do
  if ! docker exec "$container" test -f "$f"; then
    echo "S6: FAIL: $f is missing in container '$container'. Start the proxy before the scan." >&2
    exit 1
  fi
done

if [[ -z "${NGINX_VERSION:-}" ]]; then
  NGINX_VERSION="$(docker exec "$container" nginx -v 2>&1 | sed -n 's#.*nginx/\([0-9.]*\).*#\1#p')"
fi
if [[ ! "$NGINX_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "S6: FAIL: cannot find the NGINX version (got '$NGINX_VERSION'). Set NGINX_VERSION." >&2
  exit 1
fi

# 'docker cp' cannot read a tmpfs (/tmp in the container), so use tar in the container.
# Do not copy the certificate directory: it holds the private key.
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
docker exec "$container" tar -C / --exclude etc/nginx/certs -cf - etc/nginx tmp/nginx | tar -C "$work" -xf -

set +e
docker run --rm \
  -v "$work/etc/nginx:/etc/nginx:ro" -v "$work/tmp/nginx:/tmp/nginx:ro" \
  "$GIXY_IMAGE" --nginx-version "$NGINX_VERSION" -f json /etc/nginx/nginx.conf > "$prefix.json"
rc=$?
set -e
# gixy-ng exits with 1 when it finds a problem. Other codes are errors.
if ((rc > 1)) || ! jq -e 'type == "array"' "$prefix.json" > /dev/null; then
  echo "S6: FAIL: gixy-ng did not run (exit code $rc)." >&2
  exit 1
fi

jq -f "$HERE/gixy-sarif.jq" "$prefix.json" > "$prefix.sarif"
echo "S6: NGINX $NGINX_VERSION, $(jq -r 'length' "$prefix.json") finding(s):" \
  "$(jq -r 'group_by(.severity) | map("\(.[0].severity)=\(length)") | join(" ")' "$prefix.json")"
jq -r '.runs[0].results[] | "  \(.ruleId) \(.level) \(.locations[0].physicalLocation.artifactLocation.uri):\(.locations[0].physicalLocation.region.startLine)"' "$prefix.sarif"
