#!/bin/bash
# Postgres bootstrap for n8n queue mode (runs once, on first container start).
# Creates the non-root user n8n connects with, separate from the Postgres
# superuser. Values come from the environment — no secrets live in this file.
# This is the standard n8n queue-mode init script; mount it at
# /docker-entrypoint-initdb.d/init-data.sh (the queue compose does this).
set -e

if [ -n "${POSTGRES_NON_ROOT_USER:-}" ] && [ -n "${POSTGRES_NON_ROOT_PASSWORD:-}" ]; then
	psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
		CREATE USER ${POSTGRES_NON_ROOT_USER} WITH PASSWORD '${POSTGRES_NON_ROOT_PASSWORD}';
		GRANT ALL PRIVILEGES ON DATABASE ${POSTGRES_DB} TO ${POSTGRES_NON_ROOT_USER};
		GRANT CREATE ON SCHEMA public TO ${POSTGRES_NON_ROOT_USER};
	EOSQL
else
	echo "SETUP INFO: POSTGRES_NON_ROOT_USER / POSTGRES_NON_ROOT_PASSWORD not set; skipping non-root user creation."
fi
