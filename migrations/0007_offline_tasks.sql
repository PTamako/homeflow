-- Idempotent offline task creation; additive to the existing tasks table.
ALTER TABLE tasks ADD COLUMN client_request_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_request_id ON tasks(household_id,creator_user_id,client_request_id) WHERE client_request_id IS NOT NULL;
