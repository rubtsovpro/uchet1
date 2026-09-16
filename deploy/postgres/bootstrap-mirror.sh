#!/usr/bin/env bash
# Bootstrap Postgres-зеркала из SQLite-схемы (dual-run).
# Usage on tech35:
#   WMS_PG_MIRROR_URL=... ./deploy/postgres/bootstrap-mirror.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCHEMA="${ROOT}/deploy/postgres/schema_from_sqlite.sql"
URL="${WMS_PG_MIRROR_URL:-}"
if [[ -z "$URL" ]]; then
  if [[ -f /etc/warehouse-wms.env ]]; then
    # shellcheck disable=SC1091
    set -a; source /etc/warehouse-wms.env; set +a
    URL="${WMS_PG_MIRROR_URL:-}"
  fi
fi
if [[ -z "$URL" ]]; then
  echo "WMS_PG_MIRROR_URL required" >&2
  exit 1
fi
if [[ ! -f "$SCHEMA" ]]; then
  echo "missing $SCHEMA — run tools/sqlite_schema_to_pg.py first" >&2
  exit 1
fi
echo "Applying schema to mirror…"
psql "$URL" -v ON_ERROR_STOP=1 -c 'CREATE EXTENSION IF NOT EXISTS "pgcrypto";' || true
# schema may have sqlite-isms; apply best-effort then report
set +e
psql "$URL" -v ON_ERROR_STOP=0 -f "$SCHEMA" > /tmp/pg-mirror-schema.log 2>&1
RC=$?
set -e
echo "schema apply exit=$RC · log=/tmp/pg-mirror-schema.log · lines=$(wc -l </tmp/pg-mirror-schema.log)"
psql "$URL" -c "SELECT count(*) AS tables FROM information_schema.tables WHERE table_schema='public';"
echo "OK · next: worker WMS_PG_MIRROR=1 will upsert hot tables"
