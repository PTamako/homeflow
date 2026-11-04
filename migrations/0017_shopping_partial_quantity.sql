-- Preserve old purchases: NULL means historically linked quantity was not captured.
-- New links created through the UI provide an explicit, confirmed quantity.
ALTER TABLE shopping_expense_links ADD COLUMN purchase_quantity INTEGER
  CHECK(purchase_quantity BETWEEN 1 AND 9999);
