-- Apply only on homeflow-preview, after 0001_core.sql.
INSERT INTO environment_identity(key,database_name) VALUES('current','homeflow-preview')
ON CONFLICT(key) DO NOTHING;
