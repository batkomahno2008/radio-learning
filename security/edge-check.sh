#!/usr/bin/env bash
# S10 edge check (docs/security/policy.md, sections 9.1, 9.2, 9.3, 9.4 and 9.6).
# It examines the HTTP responses of a running NGINX. It does not examine TLS (9.5).
#
# Usage: security/edge-check.sh <base-url>
#   <base-url>       The NGINX address, for example http://localhost:8080/
#   STATION_ORIGINS  Optional. Space-separated origins that the CSP must allow.
#   SKIP_RATE_LIMIT  Optional. Set to 1 to skip the 9.3 check.
#
# Output: one line for each check: "PASS <id> <text>" or "FAIL <id> <text>".
# When GITHUB_STEP_SUMMARY is set, the script also writes a Markdown table to it.
# Exit code: 0 when all checks pass, 1 when one or more checks fail, 2 for a usage error.
#
# Run this script after the E2E suite. The 9.3 check causes 429 responses for some seconds.

set -uo pipefail

BASE_URL="${1:-}"
if [[ -z "$BASE_URL" ]]; then
  echo "usage: $0 <base-url>" >&2
  exit 2
fi
BASE_URL="${BASE_URL%/}"
STATION_ORIGINS="${STATION_ORIGINS:-}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

failures=0
summary_rows=()

record() { # record <PASS|FAIL> <id> <text>
  echo "$1 $2 $3"
  summary_rows+=("| $2 | $1 | ${3//|/\\|} |")
  if [[ "$1" == FAIL ]]; then failures=$((failures + 1)); fi
}

# Get the response headers of a request. Header names become lower case.
# The status code goes to $TMP/<name>.code.
fetch_headers() { # fetch_headers <name> <path> [curl args...]
  local name="$1" path="$2"; shift 2
  curl -sS -o "$TMP/$name.body" -D "$TMP/$name.raw" -w '%{http_code}' --max-time 10 "$@" "$BASE_URL$path" \
    > "$TMP/$name.code" || return 1
  tr -d '\r' < "$TMP/$name.raw" \
    | awk 'NR > 1 && /:/ { i = index($0, ":"); printf "%s:%s\n", tolower(substr($0, 1, i - 1)), substr($0, i + 1) }' \
    > "$TMP/$name.headers"
}

# Print the value of one header (lower-case name), with no leading space.
header() { # header <name> <header-name>
  grep -m1 "^$2:" "$TMP/$1.headers" | cut -d: -f2- | sed 's/^ *//'
}

# A body of 32 KiB. NGINX must refuse it with 413 (9.4). The 413 response is also the error response for 9.1.
head -c 32768 /dev/zero | tr '\0' 'a' > "$TMP/big-body"

# --- 9.1 and 9.6 on three types of response: a static file, an API response and an error response.
declare -A PATHS=([static]="/" [api]="/api/health" [error]="/api/ratings")
declare -A ARGS=([static]="" [api]="" [error]="-X POST -H Content-Type:application/json --data-binary @$TMP/big-body")
for name in static api error; do
  # shellcheck disable=SC2086 # ARGS holds several curl arguments on purpose.
  if ! fetch_headers "$name" "${PATHS[$name]}" ${ARGS[$name]}; then
    record FAIL "9.1-$name" "No response from $BASE_URL${PATHS[$name]}"
    continue
  fi

  missing=()
  [[ "$(header "$name" x-content-type-options)" == "nosniff" ]] || missing+=("X-Content-Type-Options")
  [[ "$(header "$name" x-frame-options)" == "DENY" ]] || missing+=("X-Frame-Options")
  case "$(header "$name" referrer-policy)" in
    strict-origin-when-cross-origin | strict-origin | same-origin | no-referrer) ;;
    *) missing+=("Referrer-Policy") ;;
  esac
  pp="$(header "$name" permissions-policy)"
  for feature in camera microphone geolocation payment usb; do
    [[ "$pp" == *"$feature=()"* ]] || { missing+=("Permissions-Policy($feature)"); break; }
  done
  [[ "$(header "$name" cross-origin-opener-policy)" == "same-origin" ]] || missing+=("Cross-Origin-Opener-Policy")
  max_age="$(header "$name" strict-transport-security | grep -o 'max-age=[0-9]*' | cut -d= -f2)"
  [[ -n "$max_age" && "$max_age" -ge 31536000 ]] || missing+=("Strict-Transport-Security")
  [[ -n "$(header "$name" content-security-policy)" ]] || missing+=("Content-Security-Policy")
  [[ -z "$(header "$name" x-powered-by)" ]] || missing+=("X-Powered-By is present")

  if ((${#missing[@]} == 0)); then
    record PASS "9.1-$name" "All security headers are correct on ${PATHS[$name]}"
  else
    record FAIL "9.1-$name" "Wrong or missing on ${PATHS[$name]}: ${missing[*]}"
  fi

  server="$(header "$name" server)"
  if [[ "$server" =~ [0-9] ]]; then
    record FAIL "9.6-$name" "Server header shows a version: '$server'"
  elif grep -qiE 'nginx/[0-9]' "$TMP/$name.body"; then
    record FAIL "9.6-$name" "The response body shows the NGINX version"
  else
    record PASS "9.6-$name" "No version in the Server header or the body"
  fi
done

# --- 9.2 Content Security Policy (on the static page).
csp="$(header static content-security-policy)"
if [[ -z "$csp" ]]; then
  record FAIL "9.2" "No Content-Security-Policy header on /"
else
  # One directive for each line: "name value value ...".
  tr ';' '\n' <<<"$csp" | sed 's/^ *//; s/ *$//' | grep -v '^$' > "$TMP/csp"
  directive() { grep -m1 -i "^$1\( \|$\)" "$TMP/csp" | cut -s -d' ' -f2-; }
  has_directive() { grep -qi "^$1\( \|$\)" "$TMP/csp"; }
  problems=()

  declare -A REQUIRED=(
    [default-src]="'self'"
    [script-src]="'self'"
    [style-src]="'self' https://fonts.googleapis.com"
    [font-src]="'self' https://fonts.gstatic.com"
    [img-src]="'self' data: $STATION_ORIGINS"
    [media-src]="'self' blob: $STATION_ORIGINS"
    [connect-src]="'self' $STATION_ORIGINS"
    [worker-src]="'self' blob:"
    [object-src]="'none'"
    [base-uri]="'self'"
    [form-action]="'self'"
    [frame-ancestors]="'none'"
  )
  for d in "${!REQUIRED[@]}"; do
    if ! has_directive "$d"; then
      problems+=("missing $d")
      continue
    fi
    value=" $(directive "$d") "
    for source in ${REQUIRED[$d]}; do
      [[ "$value" == *" $source "* ]] || problems+=("$d lacks $source")
    done
  done

  script_value="$(directive script-src)"
  has_directive script-src || script_value="$(directive default-src)"
  for bad in "'unsafe-inline'" "'unsafe-eval'" "data:" "blob:" "*" "http:"; do
    [[ " $script_value " == *" $bad "* ]] && problems+=("script-src has $bad")
  done

  if ((${#problems[@]} == 0)); then
    record PASS "9.2" "The CSP has all required directives and no unsafe script source"
  else
    record FAIL "9.2" "CSP problems: ${problems[*]}"
  fi
fi

# --- 9.4 Body size: the 32 KiB body (sent in the 9.1 error check) must get 413.
code="$(cat "$TMP/error.code" 2>/dev/null || echo none)"
if [[ "$code" == "413" ]]; then
  record PASS "9.4" "POST /api/ratings with 32 KiB got 413"
else
  record FAIL "9.4" "POST /api/ratings with 32 KiB got $code, expected 413"
fi

# --- 9.3 Rate limits: more requests than the limit must get at least one 429.
burst() { # burst <count> <curl args...>; prints the count of 429 responses
  local n="$1"; shift
  for _ in $(seq 1 "$n"); do
    curl -sS -o /dev/null -w '%{http_code}\n' --max-time 10 "$@" &
  done | grep -c '^429$'
  wait
}
if [[ "${SKIP_RATE_LIMIT:-0}" == "1" ]]; then
  record PASS "9.3" "Skipped (SKIP_RATE_LIMIT=1)"
else
  n429="$(burst 40 -X POST -H 'Content-Type: application/json' --data '{}' "$BASE_URL/api/ratings")"
  if ((n429 > 0)); then
    record PASS "9.3-ratings" "40 parallel POST /api/ratings got $n429 x 429"
  else
    record FAIL "9.3-ratings" "40 parallel POST /api/ratings got no 429"
  fi
  n429="$(burst 120 "$BASE_URL/api/streams")"
  if ((n429 > 0)); then
    record PASS "9.3-api" "120 parallel GET /api/streams got $n429 x 429"
  else
    record FAIL "9.3-api" "120 parallel GET /api/streams got no 429"
  fi
fi

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    echo "### S10 edge check: $BASE_URL"
    echo
    echo "| Check | Result | Detail |"
    echo "|---|---|---|"
    printf '%s\n' "${summary_rows[@]}"
    echo
  } >> "$GITHUB_STEP_SUMMARY"
fi

echo "S10 edge check: $failures failed check(s)."
((failures == 0))
