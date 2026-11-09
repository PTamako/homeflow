-- Family shop rewards may grant a virtual yen allowance to a linked wish's
-- one-time savings goal. Nothing is posted to Kakebo or treated as bank cash.
-- Redemption rows are immutable audit entries; credits never duplicate on retries.
ALTER TABLE reward_items ADD COLUMN goal_credit_yen INTEGER NOT NULL DEFAULT 0
 CHECK(goal_credit_yen BETWEEN 0 AND 100000);

ALTER TABLE reward_redemptions ADD COLUMN credited_wish_id TEXT
 REFERENCES wishes(id) ON DELETE SET NULL;
ALTER TABLE reward_redemptions ADD COLUMN credited_goal_id TEXT
 REFERENCES goals(id) ON DELETE SET NULL;
ALTER TABLE reward_redemptions ADD COLUMN goal_credit_yen INTEGER NOT NULL DEFAULT 0
 CHECK(goal_credit_yen BETWEEN 0 AND 100000);
ALTER TABLE reward_redemptions ADD COLUMN wish_title_snapshot TEXT;

ALTER TABLE reward_group_orders ADD COLUMN credited_wish_id TEXT
 REFERENCES wishes(id) ON DELETE SET NULL;
ALTER TABLE reward_group_orders ADD COLUMN credited_goal_id TEXT
 REFERENCES goals(id) ON DELETE SET NULL;
ALTER TABLE reward_group_orders ADD COLUMN goal_credit_yen INTEGER NOT NULL DEFAULT 0
 CHECK(goal_credit_yen BETWEEN 0 AND 100000);
ALTER TABLE reward_group_orders ADD COLUMN wish_title_snapshot TEXT;

CREATE INDEX idx_reward_wish_credits
 ON reward_redemptions(household_id,credited_goal_id);
CREATE INDEX idx_reward_group_wish_credits
 ON reward_group_orders(household_id,credited_goal_id,status);

-- Activate the existing user-renamed 200-point "wish purchase" reward only.
-- Other presets and households are untouched, and existing redemptions do not
-- retroactively grant any yen credit.
UPDATE reward_items SET goal_credit_yen=1000
 WHERE id=household_id||':dessert' AND title='获得一件想要的东西'
   AND description LIKE '1000日元以内%';
