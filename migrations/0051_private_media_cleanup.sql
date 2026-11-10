-- R2 deletion retries: D1 metadata is retained until a private R2 object is
-- actually deleted. This preserves logical deletion across Worker failures.
ALTER TABLE media_assets ADD COLUMN deleted_at TEXT;
CREATE INDEX idx_media_assets_pending_r2_delete
  ON media_assets(deleted_at,id) WHERE deleted_at IS NOT NULL;
