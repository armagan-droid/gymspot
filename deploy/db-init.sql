-- Runs once when the Postgres volume is created (docker-compose.prod.yml).
-- The API logs in as gymspot_api: it owns nothing and has no table grants of
-- its own, it can only SET ROLE gymspot_app, which RLS always applies to
-- (specs/06). A query that forgets the tenant context fails instead of leaking.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'gymspot_app') THEN
    CREATE ROLE gymspot_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'gymspot_api') THEN
    EXECUTE format('CREATE ROLE gymspot_api LOGIN PASSWORD %L', current_setting('gymspot.api_password'));
  END IF;
END $$;
-- no inheritance: gymspot_api has no privileges until it explicitly SETs ROLE gymspot_app (PostgreSQL 16+)
GRANT gymspot_app TO gymspot_api WITH INHERIT FALSE, SET TRUE;
GRANT CONNECT ON DATABASE gymspot TO gymspot_api;
