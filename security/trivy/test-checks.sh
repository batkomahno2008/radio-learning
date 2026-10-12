#!/usr/bin/env bash
# Tests for the project checks of Trivy (security/trivy/checks/).
# Each directory in security/trivy/testdata/ is one test case. It holds the input files and
# expected.txt: one line "<check ID> <count>" for each failed check, sorted. An empty file
# means "no failed check".
#
# A case with a compose.yaml is rendered first, with all compose.*.yaml override files,
# the same as the S4 scan: docker compose -f compose.yaml -f <override> config --no-interpolate.
#
# Usage: security/trivy/test-checks.sh [case ...]
#   TRIVY_IMAGE  Optional. The Trivy image (default: the pin of docs/adr/0002-security-tooling.md).
# Needs: Bash 4 or later, Docker with the compose plugin, jq.
# Exit code: 0 when all cases agree with expected.txt, 1 when one or more do not.

set -euo pipefail

TRIVY_IMAGE="${TRIVY_IMAGE:-ghcr.io/aquasecurity/trivy:0.75.0@sha256:af6acf9a6b85dfe389a1941505c0ce9efef52a4719635e1a962f022a3d855daa}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
TESTDATA="$HERE/testdata"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cases=("$@")
if ((${#cases[@]} == 0)); then
  for d in "$TESTDATA"/*/; do cases+=("$(basename "$d")"); done
fi

failed=0
for name in "${cases[@]}"; do
  src="$TESTDATA/$name"
  out="$WORK/$name"
  mkdir -p "$out/input"

  if [[ -f "$src/compose.yaml" ]]; then
    files=(-f "$src/compose.yaml")
    for o in "$src"/compose.*.yaml; do
      [[ -e "$o" ]] && files+=(-f "$o")
    done
    docker compose --project-directory "$src" "${files[@]}" config --no-interpolate > "$out/input/compose.yaml"
  else
    find "$src" -maxdepth 1 -type f ! -name expected.txt -exec cp {} "$out/input/" \;
  fi

  docker run --rm --name "trivy-test-$name-$$" --user "$(id -u):$(id -g)" \
    -v "$REPO/security/trivy:/checks:ro" -v "$out:/work" \
    "$TRIVY_IMAGE" config --quiet --skip-check-update --cache-dir /tmp/trivy-cache \
    --misconfig-scanners dockerfile,kubernetes,yaml \
    --config-check /checks/checks \
    --config-file-schemas /checks/schemas/compose.json \
    --check-namespaces user \
    --format json --output /work/result.json /work/input

  jq -r '[.Results[]?.Misconfigurations[]? | select(.Status == "FAIL") | .ID]
         | group_by(.) | map("\(.[0]) \(length)") | .[]' "$out/result.json" > "$out/actual.txt"

  if diff -u "$src/expected.txt" "$out/actual.txt" > "$out/diff.txt"; then
    echo "PASS $name ($(wc -l < "$out/actual.txt") check IDs)"
  else
    echo "FAIL $name"
    sed 's/^/    /' "$out/diff.txt"
    failed=$((failed + 1))
  fi
done

echo "Trivy check tests: $failed failed case(s) of ${#cases[@]}."
((failed == 0))
