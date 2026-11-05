"""Verify all additive migrations on a clean SQLite database without D1 calls."""
import sqlite3
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
MIGRATIONS=[
    "0001_core.sql",
    "0002_stage1_family_tasks.sql",
    "0003_life_projects.sql",
    "0004_push_notifications.sql",
    "0005_interval_policies.sql",
    "0006_pet_health.sql",
    "0007_offline_tasks.sql",
    "0008_shopping_ledger.sql",
    "0009_finance_target_settings.sql",
    "0009_routine_pet_care.sql",
    "0010_task_pet_care.sql",
    "0011_unified_plan_hub.sql",
    "0012_savings_goal_cadence.sql",
    "0013_plan_completion_marks.sql",
    "0014_shopping_multi_expense.sql",
    "0015_reminder_snoozes.sql",
    "0016_reminder_preferences.sql",
    "0017_shopping_partial_quantity.sql",
    "0018_shopping_created_index.sql",
    "0019_reminder_item_quiet_retry.sql",
    "0020_goal_period_settlements.sql",
    "0021_account_recovery.sql",
    "0022_recycle_plans.sql",
    "0023_today_dismissals.sql",
]
files={p.name for p in (ROOT/"migrations").glob("*.sql")}
assert files==set(MIGRATIONS),f"Unregistered migration files: {files-set(MIGRATIONS)}, missing: {set(MIGRATIONS)-files}"
# 0009 is a historical duplicate prefix, so file names (not numeric prefixes)
# form the canonical order. Never replay them against an existing D1 database.
db=sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys=ON")
for migration in MIGRATIONS:
    source=(ROOT/"migrations"/migration).read_text(encoding="utf-8")
    db.executescript(source)
tables={x[0] for x in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
required={"users","households","household_members","family_profiles","tasks","anniversaries","routines",
          "routine_marks","wishes","trips","goals","shopping_items","memories","media_assets","finance_links","push_subscriptions","notification_deliveries","pet_health_records","finance_target_settings","goal_period_adjustments","plan_completion_marks","goal_period_settlements","account_recovery_codes","shopping_expense_links","reminder_snoozes","reminder_preferences","reminder_item_preferences","today_dismissals"}
assert required.issubset(tables),f"Missing tables: {required - tables}"

# Every expected object must exist before historical files can be baselined.
secondary_indexes={
  "idx_household_members_user","idx_family_profiles_household","idx_sessions_user","idx_sessions_expiry",
  "idx_invitations_household","idx_tasks_household_due","idx_tasks_creator","idx_tasks_assignee",
  "idx_anniversaries_household","idx_routines_household","idx_wishes_household",
  "idx_trips_household_start","idx_goals_household","idx_shopping_household",
  "idx_memories_household_time","idx_media_memory","idx_push_subs_user",
  "idx_notification_deliveries_purge","idx_routines_next_due","idx_pet_health_profile",
  "idx_tasks_request_id","idx_pet_health_routine_occurrence","idx_pet_health_source_task",
  "idx_shopping_due_active","idx_wishes_target_active","idx_goals_target_on",
  "idx_plan_completion_household_date","idx_shop_links_household",
  "idx_reminder_snoozes_expiration","idx_shopping_household_created",
  "idx_goal_settlements_goal_period"
}
existing_indexes={x[0] for x in db.execute("SELECT name FROM sqlite_master WHERE type='index'")}
assert secondary_indexes.issubset(existing_indexes),f"Missing indexes: {secondary_indexes-existing_indexes}"
triggers={"cleanup_finance_trip","cleanup_finance_goal","cleanup_finance_shopping",
          "cleanup_plan_wish_marks","cleanup_plan_goal_marks","restore_legacy_shopping_link",
           "invalidate_goal_settlement_adjustment_insert","invalidate_goal_settlement_adjustment_update"}
existing_triggers={x[0] for x in db.execute("SELECT name FROM sqlite_master WHERE type='trigger'")}
assert triggers.issubset(existing_triggers),f"Missing triggers: {triggers-existing_triggers}"
added_columns={
  "users":{"password_rounds"},
  "family_profiles":{"relation","adopted_on","weight_grams","notes","archived_at"},
  "tasks":{"client_request_id","health_record_type","remind_enabled"},
  "routines":{"next_due_on","health_record_type","remind_enabled"},
  "pet_health_records":{"source_routine_id","source_occurrence_on","source_task_id"},
  "shopping_items":{"ledger_entry_id","due_on"},
  "wishes":{"target_on"},
  "goals":{"goal_mode","start_on"},
  "shopping_expense_links":{"purchase_quantity"},
  "reminder_preferences":{"quiet_start_hour","quiet_end_hour"},
  "notification_deliveries":{"attempts"},
}
for table in ("routines","anniversaries","wishes","goals","shopping_items","trips","memories"):
  added_columns.setdefault(table,set()).add("deleted_at")
for table,needed in added_columns.items():
    found={x[1] for x in db.execute(f"PRAGMA table_info({table})")}
    assert needed.issubset(found),f"{table} missing migration columns: {needed-found}"

columns={x[1] for x in db.execute("PRAGMA table_info(users)")}
assert "client_request_id" in {x[1] for x in db.execute("PRAGMA table_info(tasks)")}
assert "ledger_entry_id" in {x[1] for x in db.execute("PRAGMA table_info(shopping_items)")}
assert {"adjustment_amount","period_start","period_end"}.issubset({x[1] for x in db.execute("PRAGMA table_info(finance_target_settings)")})
assert {"remind_enabled"}.issubset({x[1] for x in db.execute("PRAGMA table_info(tasks)")})
assert "remind_enabled" in {x[1] for x in db.execute("PRAGMA table_info(routines)")}
assert "target_on" in {x[1] for x in db.execute("PRAGMA table_info(wishes)")}
assert "due_on" in {x[1] for x in db.execute("PRAGMA table_info(shopping_items)")}
assert {"goal_mode","start_on"}.issubset({x[1] for x in db.execute("PRAGMA table_info(goals)")})
assert "password_rounds" in columns
assert "health_record_type" in {x[1] for x in db.execute("PRAGMA table_info(routines)")}
assert "source_routine_id" in {x[1] for x in db.execute("PRAGMA table_info(pet_health_records)")}
assert "source_task_id" in {x[1] for x in db.execute("PRAGMA table_info(pet_health_records)")}
assert "remind_enabled" in {x[1] for x in db.execute("PRAGMA table_info(tasks)")}
assert "goal_mode" in {x[1] for x in db.execute("PRAGMA table_info(goals)")}
assert "goal_period_adjustments" in tables
assert {"period_key","status","target_amount","actual_amount","difference_amount"}.issubset(
    {x[1] for x in db.execute("PRAGMA table_info(goal_period_settlements)")})
assert {"plan_type","plan_id","period_key","completed_at"}.issubset(
    {x[1] for x in db.execute("PRAGMA table_info(plan_completion_marks)")})
assert "next_due_on" in {x[1] for x in db.execute("PRAGMA table_info(routines)")}
db.execute("INSERT INTO households(id,display_name) VALUES('primary','Demo')")
db.execute("INSERT INTO users(id,login_name,password_salt,password_verifier) VALUES('u-1','demo','x','y')")
db.execute("INSERT INTO household_members(household_id,user_id,role) VALUES('primary','u-1','owner')")
db.execute("INSERT INTO tasks(id,household_id,creator_user_id,visibility,title) VALUES('task','primary','u-1','private','test')")
assert db.execute("SELECT COUNT(*) FROM tasks WHERE household_id='primary'").fetchone()[0]==1
try:
    db.execute("INSERT INTO tasks(id,household_id,creator_user_id,visibility,title) VALUES('bad','missing','u-1','private','bad')")
except sqlite3.IntegrityError:
    pass
else:
    raise AssertionError("Foreign key isolation not enforced")
print("Migration SQL verified:",", ".join(MIGRATIONS),"—",len(tables),"tables")
