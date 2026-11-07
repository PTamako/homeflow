-- Family reward shop and weekly challenges. Additive; existing completion history unchanged.
CREATE TABLE IF NOT EXISTS reward_items (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 60),
  description TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '🎁',
  points INTEGER NOT NULL CHECK(points BETWEEN 10 AND 10000),
  stock INTEGER CHECK(stock IS NULL OR stock BETWEEN 0 AND 9999),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  builtin INTEGER NOT NULL DEFAULT 0 CHECK(builtin IN (0,1)),
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_reward_items_household ON reward_items(household_id,active,created_at);

CREATE TABLE IF NOT EXISTS reward_redemptions (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  reward_id TEXT NOT NULL REFERENCES reward_items(id),
  redeemed_by TEXT NOT NULL REFERENCES users(id),
  title_snapshot TEXT NOT NULL,
  icon_snapshot TEXT NOT NULL,
  points_spent INTEGER NOT NULL CHECK(points_spent BETWEEN 10 AND 10000),
  client_request_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','fulfilled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fulfilled_at TEXT,
  fulfilled_by TEXT REFERENCES users(id),
  UNIQUE(household_id,redeemed_by,client_request_id)
);
CREATE INDEX IF NOT EXISTS idx_reward_redemptions_user
  ON reward_redemptions(household_id,redeemed_by,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reward_redemptions_stock ON reward_redemptions(reward_id);

-- The weekly bonus is materialized on the 10th completion and reversed if
-- a completion is undone. The JST week runs Monday through Sunday.
CREATE TABLE IF NOT EXISTS weekly_challenge_awards (
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_on TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 30 CHECK(points=30),
  awarded_at TEXT NOT NULL,
  PRIMARY KEY(household_id,user_id,week_on)
);
CREATE INDEX IF NOT EXISTS idx_weekly_challenge_member
  ON weekly_challenge_awards(household_id,user_id,week_on DESC);
CREATE TRIGGER IF NOT EXISTS rewards_weekly_points_earned
AFTER INSERT ON completion_points
BEGIN
  INSERT OR IGNORE INTO weekly_challenge_awards
    (household_id,user_id,week_on,points,awarded_at)
  SELECT NEW.household_id,NEW.earner_user_id,
    date(NEW.earned_at,'+9 hours','weekday 0','-6 days'),30,
    strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE (SELECT COUNT(*) FROM completion_points cp
      WHERE cp.household_id=NEW.household_id AND cp.earner_user_id=NEW.earner_user_id
      AND date(cp.earned_at,'+9 hours','weekday 0','-6 days')=
          date(NEW.earned_at,'+9 hours','weekday 0','-6 days'))>=10;
END;
CREATE TRIGGER IF NOT EXISTS rewards_weekly_points_revoked
AFTER DELETE ON completion_points
BEGIN
  DELETE FROM weekly_challenge_awards
  WHERE household_id=OLD.household_id AND user_id=OLD.earner_user_id
    AND week_on=date(OLD.earned_at,'+9 hours','weekday 0','-6 days')
    AND (SELECT COUNT(*) FROM completion_points cp
      WHERE cp.household_id=OLD.household_id AND cp.earner_user_id=OLD.earner_user_id
      AND date(cp.earned_at,'+9 hours','weekday 0','-6 days')=
          date(OLD.earned_at,'+9 hours','weekday 0','-6 days'))<10;
END;

-- Presets are real household products: both members may change price, stock or active state.
INSERT OR IGNORE INTO reward_items(id,household_id,title,description,icon,points,builtin)
SELECT h.id||':dessert',h.id,'请吃一次甜品','一起挑喜欢的甜品，口味由兑换人决定','🍦',100,1 FROM households h;
INSERT OR IGNORE INTO reward_items(id,household_id,title,description,icon,points,builtin)
SELECT h.id||':movie',h.id,'指定一次电影','由兑换人选择电影或家庭电影之夜','🎬',200,1 FROM households h;
INSERT OR IGNORE INTO reward_items(id,household_id,title,description,icon,points,builtin)
SELECT h.id||':dinner',h.id,'选择一次周末大餐','周末餐厅由兑换人决定','🍖',300,1 FROM households h;
INSERT OR IGNORE INTO reward_items(id,household_id,title,description,icon,points,builtin)
SELECT h.id||':rest',h.id,'一次家务休息券','商量好哪次家务由另一位代劳','🛋️',500,1 FROM households h;
CREATE TRIGGER IF NOT EXISTS rewards_seed_new_household
AFTER INSERT ON households
BEGIN
  INSERT OR IGNORE INTO reward_items(id,household_id,title,description,icon,points,builtin)
    VALUES(NEW.id||':dessert',NEW.id,'请吃一次甜品','一起挑喜欢的甜品，口味由兑换人决定','🍦',100,1);
  INSERT OR IGNORE INTO reward_items(id,household_id,title,description,icon,points,builtin)
    VALUES(NEW.id||':movie',NEW.id,'指定一次电影','由兑换人选择电影或家庭电影之夜','🎬',200,1);
  INSERT OR IGNORE INTO reward_items(id,household_id,title,description,icon,points,builtin)
    VALUES(NEW.id||':dinner',NEW.id,'选择一次周末大餐','周末餐厅由兑换人决定','🍖',300,1);
  INSERT OR IGNORE INTO reward_items(id,household_id,title,description,icon,points,builtin)
    VALUES(NEW.id||':rest',NEW.id,'一次家务休息券','商量好哪次家务由另一位代劳','🛋️',500,1);
END;

-- Two-member pooled redemption: one stable price snapshot, each member pays only
-- from their own balance, never from an unapproved transfer.
CREATE TABLE IF NOT EXISTS reward_group_orders (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  reward_id TEXT NOT NULL REFERENCES reward_items(id),
  created_by TEXT NOT NULL REFERENCES users(id),
  client_request_id TEXT NOT NULL,
  title_snapshot TEXT NOT NULL,
  icon_snapshot TEXT NOT NULL,
  points_required INTEGER NOT NULL CHECK(points_required BETWEEN 10 AND 10000),
  status TEXT NOT NULL DEFAULT 'collecting'
    CHECK(status IN ('collecting','requested','fulfilled','cancelled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  funded_at TEXT,
  fulfilled_at TEXT,
  fulfilled_by TEXT REFERENCES users(id),
  cancelled_at TEXT,
  UNIQUE(household_id,created_by,client_request_id)
);
CREATE INDEX IF NOT EXISTS idx_reward_group_household
  ON reward_group_orders(household_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reward_group_reward
  ON reward_group_orders(reward_id,status);

CREATE TABLE IF NOT EXISTS reward_group_contributions (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL REFERENCES reward_group_orders(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  points INTEGER NOT NULL CHECK(points BETWEEN 1 AND 10000),
  client_request_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(household_id,user_id,client_request_id)
);
CREATE INDEX IF NOT EXISTS idx_reward_group_contributions_order
  ON reward_group_contributions(household_id,order_id,user_id);

-- This trigger runs inside the contribution INSERT transaction, so an order
-- becomes redeemable only after the exact amount has been jointly funded.
CREATE TRIGGER IF NOT EXISTS rewards_group_funded
AFTER INSERT ON reward_group_contributions
BEGIN
  UPDATE reward_group_orders
  SET status='requested',funded_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE id=NEW.order_id AND household_id=NEW.household_id AND status='collecting'
    AND (SELECT COALESCE(SUM(c.points),0) FROM reward_group_contributions c
      WHERE c.order_id=NEW.order_id)=points_required;
END;
