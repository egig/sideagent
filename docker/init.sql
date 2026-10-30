-- Runs once on an empty Postgres volume (docker-entrypoint-initdb.d).
CREATE EXTENSION IF NOT EXISTS vector;
