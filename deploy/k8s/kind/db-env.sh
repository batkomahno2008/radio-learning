#!/bin/sh
# Makes deploy/k8s/overlays/staging/db.env with a random database password.
# The staging overlay turns this file into the Secret "radio-learning-db".
# Git ignores db.env. The script does not overwrite an existing file.
set -eu

target="$(dirname "$0")/../overlays/staging/db.env"

if [ -e "$target" ]; then
  echo "$target exists. No change."
  exit 0
fi

# Hex characters need no escape in the URL.
password="$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"

umask 077
cat > "$target" <<EOF
POSTGRES_USER=radio
POSTGRES_DB=radio
POSTGRES_PASSWORD=${password}
DATABASE_URL=postgres://radio:${password}@postgres:5432/radio
EOF
echo "Made $target"
