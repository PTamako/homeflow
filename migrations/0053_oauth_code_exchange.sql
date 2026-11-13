-- 0053: Additional OAuth authorization-code and short-lived opaque-token
-- transport for HomeFlow. No historical user/session/household rows touched.
-- Production rollout must verify backups, then apply 0053 BEFORE enabling
-- OAUTH_ENABLED. Clients/redirects live in a server-only exact allowlist.
CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  code_challenge TEXT NOT NULL,
  nonce TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  consumed_at INTEGER,
  consumption_marker TEXT UNIQUE,
  FOREIGN KEY(household_id,user_id)
    REFERENCES household_members(household_id,user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_oauth_authorization_codes_expiry
  ON oauth_authorization_codes(expires_at);
CREATE INDEX IF NOT EXISTS idx_oauth_authorization_codes_user
  ON oauth_authorization_codes(user_id,created_at);
CREATE TABLE IF NOT EXISTS oauth_access_tokens (
  token_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  FOREIGN KEY(household_id,user_id)
    REFERENCES household_members(household_id,user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_oauth_access_tokens_expiry
  ON oauth_access_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_oauth_access_tokens_user
  ON oauth_access_tokens(user_id,created_at);

-- OAuth writes are security events, unlike routine GET/list fetches. Do not
-- store codes, access tokens, passwords, private document fields or nicknames.
CREATE TABLE IF NOT EXISTS oauth_security_events (
  event_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  event TEXT NOT NULL CHECK(event IN ('code_issued','token_exchanged')),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oauth_security_events_user_time
  ON oauth_security_events(user_id,created_at);
