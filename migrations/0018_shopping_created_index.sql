-- Shopping list uses household + creation order for five-row keyset pages.
-- Add a covering sort index so D1 avoids a temporary B-tree for this list.
CREATE INDEX IF NOT EXISTS idx_shopping_household_created
  ON shopping_items(household_id,created_at DESC,id DESC);
