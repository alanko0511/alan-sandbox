#!/usr/bin/env bash
# Full-stack template: a Postgres container ready to go on :5432.
#
# Idempotent, per the template contract — sandbox-rerun re-executes this.
set -euo pipefail

SANDBOX_USER="${SANDBOX_USER:-alanko}"
PG_VERSION=16
PG_CONTAINER=sandbox-postgres

echo "[fullstack] pulling postgres:$PG_VERSION"
docker pull "postgres:$PG_VERSION" >/dev/null

if docker ps -a --format '{{.Names}}' | grep -qx "$PG_CONTAINER"; then
  echo "[fullstack] $PG_CONTAINER already exists; leaving it alone"
else
  echo "[fullstack] creating $PG_CONTAINER"
  # Bound to localhost only. The VM has an external IP for egress and no
  # ingress firewall rule, but binding to 0.0.0.0 would still be careless.
  docker run -d \
    --name "$PG_CONTAINER" \
    --restart unless-stopped \
    -p 127.0.0.1:5432:5432 \
    -e POSTGRES_PASSWORD=postgres \
    -e POSTGRES_USER=postgres \
    -e POSTGRES_DB=postgres \
    -v sandbox-pgdata:/var/lib/postgresql/data \
    "postgres:$PG_VERSION" >/dev/null
fi

# Handy default so projects don't each need to rediscover the connection string.
PROFILE="/home/$SANDBOX_USER/.bashrc"
LINE='export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/postgres"'
grep -qxF "$LINE" "$PROFILE" 2>/dev/null || echo "$LINE" >> "$PROFILE"

echo "[fullstack] postgres ready on 127.0.0.1:5432"
