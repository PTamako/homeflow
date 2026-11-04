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
    "0011_unified_plan_hub.sql",
    "0012_savings_goal_cadence.sql",
]
db=sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys=ON")
for migration in MIGRATIONS:
    source=(ROOT/"migrations"/migration).read_text(encoding="utf-8")
    db.executescript(source)
tables={x[0] for x in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
required={"users","households","household_members","family_profiles","tasks","anniversaries","routines",
          "routine_marks","wishes","trips","goals","shopping_items","memories","media_assets","finance_links","push_subscriptions","notification_deliveries","pet_health_records","finance_target_settings","goal_period_adjustments"}
assert required.issubset(tables),f"Missing tables: {required - tables}"
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
