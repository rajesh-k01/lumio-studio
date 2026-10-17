#!/bin/sh
# Starts as root only long enough to make the data folder writable, then runs the server as the unprivileged "node" user.
# Platforms such as Railway mount the persistent volume owned by root, which hides the chown done at build time and
# would make every database write fail with EACCES.
set -e
DB="${LUMIO_DB:-/app/data/lumio.db}"
DIR="$(dirname "$DB")"
mkdir -p "$DIR"
if [ "$(id -u)" = "0" ]; then
  chown -R node:node "$DIR"
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
