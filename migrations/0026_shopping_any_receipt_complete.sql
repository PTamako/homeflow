-- Shopping is a checklist, not a quantity or per-item amount allocation.
-- Earlier partial purchases may have verified links but no completion timestamp.
-- Backfill only those rows; preserve all receipt links and existing completion history.
UPDATE shopping_items
SET completed_at=(
      SELECT MIN(linked_at) FROM shopping_expense_links
      WHERE shopping_id=shopping_items.id AND household_id=shopping_items.household_id
    ),
    completed_by=COALESCE(completed_by,(
      SELECT linked_by FROM shopping_expense_links
      WHERE shopping_id=shopping_items.id AND household_id=shopping_items.household_id
      ORDER BY linked_at,external_entry_id LIMIT 1
    ))
WHERE completed_at IS NULL
  AND EXISTS (
    SELECT 1 FROM shopping_expense_links
    WHERE shopping_id=shopping_items.id AND household_id=shopping_items.household_id
  );
