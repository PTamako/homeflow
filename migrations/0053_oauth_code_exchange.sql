-- 0053: Additional OAuth authorization-code and short-lived opaque-token
-- transport for HomeFlow. No historical user/session/household rows touched.
-- Production rollout must verify backups, then apply 0053 BEFORE enabling
-- OAUTH_ENABLED. Clients/redirects live in a server-only exact allowlist.
CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  household_id TEXT NOT NULL REFERENCES households(id),
  code_challenge TEXT NOT NULL,
  nonce TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  consumed_at INTEGER,
  consumption_marker TEXT UNIQUE,
  FOREIGN KEY(household_id,user_id)
    REFERENCES household_members(household_id,user_id)
);
CREATE INDEX IF NOT EXISTS idx_oauth_authorization_codes_expiry
  ON oauth_authorization_codes(expires_at);
CREATE INDEX IF NOT EXISTS idx_oauth_authorization_codes_user
  ON oauth_authorization_codes(user_id,created_at);
CREATE TABLE IF NOT EXISTS oauth_access_tokens (
  token_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  household_id TEXT NOT NULL REFERENCES households(id),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  FOREIGN KEY(household_id,user_id)
    REFERENCES household_members(household_id,user_id)
);
CREATE INDEX IF NOT EXISTS idx_oauth_access_tokens_expiry
  ON oauth_access_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_oauth_access_tokens_user
  ON oauth_access_tokens(user_id,created_at);
