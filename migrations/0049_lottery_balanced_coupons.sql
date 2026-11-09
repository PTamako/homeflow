-- Balanced family lottery B: additive, preserves all historical draws and balances.
-- Legacy prize_kind and cost_points CHECK constraints remain unchanged.
-- New prizes are represented by special_prize_kind while retaining legacy empty
-- as a backwards-compatible storage value; 6-point credit is 5 + bonus 1.
CREATE TABLE lottery_coupons (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  draw_id TEXT NOT NULL UNIQUE REFERENCES household_lottery_draws(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('ticket','shop','wish')),
  created_at TEXT NOT NULL,
  expires_on TEXT NOT NULL,
  used_at TEXT,
  use_reference TEXT,
  used_wish_id TEXT REFERENCES wishes(id) ON DELETE SET NULL,
  used_goal_id TEXT REFERENCES goals(id) ON DELETE SET NULL,
  wish_title_snapshot TEXT,
  CHECK(used_at IS NULL OR use_reference IS NOT NULL)
);
CREATE INDEX idx_lottery_coupons_user ON lottery_coupons(household_id,user_id,expires_on,created_at);
CREATE INDEX idx_lottery_coupons_goal ON lottery_coupons(household_id,used_goal_id,used_at);

ALTER TABLE household_lottery_draws ADD COLUMN special_prize_kind TEXT
  CHECK(special_prize_kind IS NULL OR special_prize_kind IN ('ticket','shop','wish'));
ALTER TABLE household_lottery_draws ADD COLUMN prize_bonus_points INTEGER NOT NULL DEFAULT 0
  CHECK(prize_bonus_points IN (0,1) AND (prize_bonus_points=0 OR prize_kind='five'));
ALTER TABLE household_lottery_draws ADD COLUMN ticket_coupon_id TEXT REFERENCES lottery_coupons(id);
CREATE UNIQUE INDEX idx_lottery_draw_ticket_once ON household_lottery_draws(ticket_coupon_id)
  WHERE ticket_coupon_id IS NOT NULL;

-- Coupon generation and consumption are in the same database statement as a draw.
CREATE TRIGGER lottery_coupon_granted AFTER INSERT ON household_lottery_draws
WHEN NEW.special_prize_kind IS NOT NULL
BEGIN
  INSERT INTO lottery_coupons(id,household_id,user_id,draw_id,kind,created_at,expires_on)
  VALUES(NEW.id,NEW.household_id,NEW.user_id,NEW.id,NEW.special_prize_kind,
    NEW.created_at,date(NEW.created_at,'+9 hours',
      CASE NEW.special_prize_kind WHEN 'ticket' THEN '+60 days' ELSE '+90 days' END));
END;
CREATE TRIGGER lottery_ticket_guard BEFORE INSERT ON household_lottery_draws
WHEN NEW.ticket_coupon_id IS NOT NULL
BEGIN
 SELECT RAISE(ABORT,'invalid_free_ticket')
 WHERE NOT EXISTS (
   SELECT 1 FROM lottery_coupons c
   WHERE c.id=NEW.ticket_coupon_id AND c.household_id=NEW.household_id
     AND c.user_id=NEW.user_id AND c.kind='ticket' AND c.used_at IS NULL
     AND c.expires_on>=date(NEW.created_at,'+9 hours'));
END;
CREATE TRIGGER lottery_ticket_claim AFTER INSERT ON household_lottery_draws
WHEN NEW.ticket_coupon_id IS NOT NULL
BEGIN
 UPDATE lottery_coupons SET used_at=NEW.created_at,use_reference=NEW.id
 WHERE id=NEW.ticket_coupon_id AND household_id=NEW.household_id
   AND user_id=NEW.user_id AND used_at IS NULL;
END;

ALTER TABLE reward_redemptions ADD COLUMN shop_coupon_id TEXT REFERENCES lottery_coupons(id);
ALTER TABLE reward_redemptions ADD COLUMN coupon_quantity INTEGER
  CHECK(coupon_quantity IS NULL OR coupon_quantity BETWEEN 1 AND 99);
CREATE UNIQUE INDEX idx_reward_shop_coupon_once ON reward_redemptions(shop_coupon_id)
  WHERE shop_coupon_id IS NOT NULL;
CREATE TABLE reward_coupon_discounts (
  coupon_id TEXT PRIMARY KEY REFERENCES lottery_coupons(id) ON DELETE CASCADE,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redemption_id TEXT NOT NULL UNIQUE REFERENCES reward_redemptions(id) ON DELETE CASCADE,
  discount_points INTEGER NOT NULL CHECK(discount_points BETWEEN 1 AND 50),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_reward_coupon_discounts_household
 ON reward_coupon_discounts(household_id,user_id,created_at);
CREATE TRIGGER reward_shop_coupon_guard BEFORE INSERT ON reward_redemptions
WHEN NEW.shop_coupon_id IS NOT NULL
BEGIN
 SELECT RAISE(ABORT,'invalid_shop_coupon')
 WHERE NOT EXISTS (
   SELECT 1 FROM lottery_coupons c
   JOIN reward_items r ON r.id=NEW.reward_id AND r.household_id=NEW.household_id
   WHERE c.id=NEW.shop_coupon_id AND c.household_id=NEW.household_id
     AND c.user_id=NEW.redeemed_by AND c.kind='shop' AND c.used_at IS NULL
     AND c.expires_on>=date(NEW.created_at,'+9 hours')
     AND NEW.coupon_quantity BETWEEN 1 AND 99
     AND r.points*NEW.coupon_quantity>=20);
END;
CREATE TRIGGER reward_shop_coupon_claim AFTER INSERT ON reward_redemptions
WHEN NEW.shop_coupon_id IS NOT NULL
BEGIN
 UPDATE lottery_coupons SET used_at=NEW.created_at,use_reference=SUBSTR(NEW.client_request_id,1,36)
 WHERE id=NEW.shop_coupon_id AND household_id=NEW.household_id
   AND user_id=NEW.redeemed_by AND used_at IS NULL;
 INSERT INTO reward_coupon_discounts
  (coupon_id,household_id,user_id,redemption_id,discount_points,created_at)
 SELECT NEW.shop_coupon_id,NEW.household_id,NEW.redeemed_by,NEW.id,
    MIN(50,CAST(r.points*NEW.coupon_quantity/20 AS INTEGER)),NEW.created_at
 FROM reward_items r WHERE r.id=NEW.reward_id;
END;
