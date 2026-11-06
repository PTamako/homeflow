-- Preserve a single daily inbox row while tracking whether the recipient
-- has already been notified of the latest merged completion event.
-- Additive: old read_at values, IDs and recipient permissions stay unchanged.
ALTER TABLE notification_inbox ADD COLUMN last_completion_key TEXT;
