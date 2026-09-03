#!/bin/bash
# Восстановление PG-дампа 1С (custom format) в локальный PostgreSQL.
#   PG_RESTORE_DUMP=/var/lib/postgresql/restore/Fogel_2025 PG_1C_DB=Fogel_2025 ./bin/do-restore-pg.sh
set -u
export PATH=/usr/sbin:/sbin:/usr/bin:/bin

PG_DB="${PG_1C_DB:-Pnevmopodveska_2025}"
DUMP="${PG_RESTORE_DUMP:-/var/lib/postgresql/restore/${PG_DB}}"
LOG="${PG_RESTORE_LOG:-/root/1c-rarus-s3/restore-${PG_DB}.log}"
SCH="/var/lib/postgresql/restore/schema-${PG_DB}.sql"

: > "$LOG"
exec > >(tee -a "$LOG") 2>&1
echo "=== $(date) START restore ${PG_DB} ==="
echo "DUMP=${DUMP}"

if [[ ! -f "$DUMP" ]]; then
  echo "ERROR: dump not found: $DUMP"
  exit 1
fi

pkill -f "pg_restore.*${PG_DB}" || true
sleep 1
sudo -u postgres psql -c "DROP DATABASE IF EXISTS \"${PG_DB}\" WITH (FORCE);"
sudo -u postgres psql -c "CREATE DATABASE \"${PG_DB}\" OWNER usr1csql ENCODING 'UTF8' TEMPLATE template0;"

echo "=== $(date) extract schema ==="
sudo -u postgres pg_restore -s --no-owner --no-acl -f - "$DUMP" \
  | grep -v -E '^\\restrict' \
  | grep -v -E '^\\unrestrict' \
  | grep -v -iE 'CREATE EXTENSION.*(mchar|fulleq|fasttrun)' \
  | grep -v -iE 'COMMENT ON EXTENSION.*(mchar|fulleq|fasttrun)' \
  | sed -E 's/\bpublic\.mvarchar\b/varchar/gi; s/\bpublic\.mchar\b/varchar/gi; s/\bmvarchar[[:space:]]*\(/varchar(/gi; s/\bmchar[[:space:]]*\(/varchar(/gi; s/\bmvarchar\b/varchar/gi; s/\bmchar\b/varchar/gi; s/\bpublic\.varchar\b/varchar/gi' \
  > "$SCH"
grep -v -iE 'CREATE EXTENSION.*(varchar|mchar|fulleq|fasttrun)' "$SCH" \
  | grep -v -iE 'COMMENT ON EXTENSION.*(varchar|mchar|fulleq|fasttrun)' > "${SCH}.tmp"
mv "${SCH}.tmp" "$SCH"
chown postgres:postgres "$SCH"
chmod 644 "$SCH"
echo "schema bytes: $(wc -c < "$SCH")"

echo "=== $(date) apply schema ==="
sudo -u postgres psql -d "$PG_DB" -v ON_ERROR_STOP=0 -f "$SCH"
TABLES=$(sudo -u postgres psql -d "$PG_DB" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
echo "tables: $TABLES"
if [ "${TABLES:-0}" -lt 1000 ]; then
  echo "SCHEMA_FAIL tables=$TABLES"
  exit 1
fi

echo "=== $(date) load data ==="
sudo -u postgres pg_restore -a --no-owner --no-acl --disable-triggers -d "$PG_DB" "$DUMP"
echo "=== $(date) DONE ${PG_DB} ==="
