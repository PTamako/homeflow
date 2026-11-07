-- Household lottery: each member may draw 7 times per Tokyo calendar month.
-- Prize credits spend from the same household-only wallet as the rewards shop.
CREATE TABLE IF NOT EXISTS household_lottery_draws (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_request_id TEXT NOT NULL,
  month_on TEXT NOT NULL CHECK(length(month_on)=7),
  prize_kind TEXT NOT NULL CHECK(prize_kind IN ('empty','five','ten','twenty','fifty','double')),
  cost_points INTEGER NOT NULL DEFAULT 5 CHECK(cost_points=5),
  prize_points INTEGER NOT NULL CHECK(prize_points>=0),
  created_at TEXT NOT NULL,
  UNIQUE(household_id,user_id,client_request_id),
  CHECK((prize_kind='empty' AND prize_points=0)
    OR (prize_kind='five' AND prize_points=5)
    OR (prize_kind='ten' AND prize_points=10)
    OR (prize_kind='twenty' AND prize_points=20)
    OR (prize_kind='fifty' AND prize_points=50)
    OR prize_kind='double')
);
CREATE INDEX IF NOT EXISTS idx_lottery_member_month
 ON household_lottery_draws(household_id,user_id,month_on,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lottery_household_history
 ON household_lottery_draws(household_id,created_at DESC);
