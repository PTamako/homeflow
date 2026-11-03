-- Apply only on the newly created homeflow production D1.
INSERT INTO environment_identity(key,database_name) VALUES('current','homeflow')
ON CONFLICT(key) DO NOTHING;
