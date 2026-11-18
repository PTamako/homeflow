-- Upgrade ONLY still-valid, originally issued HomeFlow login sessions to the
-- new 30-day maximum. Never revive expired/logged-out sessions, create tokens,
-- or push any session past 30 days after its original creation.
UPDATE sessions
SET expires_at = (CAST(strftime('%s', created_at) AS INTEGER) * 1000) + 2592000000
WHERE expires_at > (CAST(strftime('%s', 'now') AS INTEGER) * 1000)
  AND created_at IS NOT NULL
  AND strftime('%s', created_at) IS NOT NULL
  AND expires_at < (CAST(strftime('%s', created_at) AS INTEGER) * 1000) + 2592000000;
