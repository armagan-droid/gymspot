#!/bin/sh
# Passes the API password to db-init.sql without putting it in the SQL file.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -c "SET gymspot.api_password = '${GYMSPOT_API_DB_PASSWORD}';" \
  -f /docker-entrypoint-initdb.d/db-init.sql.in
