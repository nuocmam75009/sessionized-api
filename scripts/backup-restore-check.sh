#!/usr/bin/env bash
# Test de la procédure de sauvegarde et de restauration PostgreSQL.
#
# Sur le conteneur postgres-test de docker-compose : sauvegarde la base
# (pg_dump, format custom), la restaure dans une base vierge (pg_restore),
# puis compare table par table le nombre de lignes et une empreinte MD5 du
# contenu. Le script échoue si une seule table diffère.
#
#   docker compose up -d postgres-test
#   npm run test:e2e        # ou npm run db:seed, pour avoir des données
#   bash scripts/backup-restore-check.sh
#
# Mêmes commandes qu'en production (voir README, « Sauvegarde et
# restauration »), où la source est la base Neon et la cible une base ou une
# branche vierge.
set -euo pipefail
# Git Bash (Windows) réécrirait /tmp en chemin Windows dans les arguments de docker.
export MSYS_NO_PATHCONV=1

SERVICE=postgres-test
DB_USER=sessionized
SOURCE_DB=${SOURCE_DB:-sessionized_test}
TARGET_DB=sessionized_restore_check
DUMP=/tmp/sessionized-backup.dump

in_db() { docker compose exec -T "$SERVICE" "$@"; }
sql() { in_db psql -U "$DB_USER" -d "$1" -v ON_ERROR_STOP=1 -Atq -c "$2"; }

# Une ligne par table : nom, nombre de lignes, MD5 du contenu trié.
fingerprint() {
  local db=$1 table
  for table in $(sql "$db" "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1"); do
    printf '%s %s\n' "$table" "$(sql "$db" "SELECT count(*) || ' ' || md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) FROM \"$table\" t")"
  done
}

echo "1. Empreinte de la base source ($SOURCE_DB)"
before=$(fingerprint "$SOURCE_DB")
echo "$before" | awk '{ printf "   %-22s %8s lignes\n", $1, $2 }'

echo "2. Sauvegarde : pg_dump --format=custom"
start=$(date +%s)
in_db pg_dump -U "$DB_USER" --format=custom --no-owner --no-privileges -f "$DUMP" "$SOURCE_DB"
size=$(in_db stat -c %s "$DUMP")
echo "   $((size / 1024)) Ko en $(( $(date +%s) - start )) s"

echo "3. Restauration dans une base vierge ($TARGET_DB)"
start=$(date +%s)
sql postgres "DROP DATABASE IF EXISTS $TARGET_DB" >/dev/null
sql postgres "CREATE DATABASE $TARGET_DB" >/dev/null
in_db pg_restore -U "$DB_USER" --no-owner --no-privileges --exit-on-error -d "$TARGET_DB" "$DUMP"
echo "   restaurée en $(( $(date +%s) - start )) s"

echo "4. Comparaison table par table"
after=$(fingerprint "$TARGET_DB")
if [ "$before" == "$after" ]; then
  echo "   OK : $(echo "$after" | wc -l | tr -d ' ') tables identiques (lignes et contenu)."
  status=0
else
  echo "   ÉCART :"
  diff <(echo "$before") <(echo "$after") || true
  status=1
fi

sql postgres "DROP DATABASE $TARGET_DB" >/dev/null
in_db rm -f "$DUMP"
exit $status
