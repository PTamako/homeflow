"""Read-only acceptance checks for ALREADY-MIGRATED D1 exports restored offline.

Never reapply historical migrations to current production snapshots. No row
contents, personally identifying IDs, private SQL, or secrets are printed.
"""
from __future__ import annotations

import argparse
import json
import re
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APPS = ("homeflow", "kakebo", "it-study-platform", "jp-document-assistant")
REQUIRED = {
    "homeflow": {"d1_migrations", "household_members",
                 "notification_inbox", "household_approval_requests"},
    "kakebo": {"d1_migrations"},
    "it-study-platform": {"d1_migrations", "homeflow_identity_links"},
    "jp-document-assistant": {"d1_migrations", "homeflow_identity_links"},
}


def expected_homeflow_migrations() -> set[str]:
    source = (ROOT / "scripts" / "check_migrations.py").read_text(encoding="utf-8")
    match = re.search(r"MIGRATIONS=\[([\s\S]*?)\]\s*\nfiles=", source)
    if match is None:
        raise ValueError("HOMEFLOW_MIGRATION_MANIFEST_NOT_FOUND")
    return set(re.findall(r'"([^"]+\.sql)"', match.group(1)))


def verify_current_database(app: str, database_path: str) -> dict:
    if app not in APPS:
        raise ValueError("UNKNOWN_DATABASE")
    path = Path(database_path).resolve(strict=True)
    if not path.is_file():
        raise ValueError("DATABASE_FILE_NOT_FOUND")
    uri = path.as_uri() + "?mode=ro"
    with sqlite3.connect(uri, uri=True, timeout=10) as db:
        db.execute("PRAGMA query_only=ON")
        results = db.execute("PRAGMA integrity_check").fetchall()
        if results != [("ok",)]:
            raise ValueError("SQLITE_INTEGRITY_FAILED:" + app)
        if db.execute("PRAGMA foreign_key_check").fetchone() is not None:
            raise ValueError("SQLITE_FOREIGN_KEY_FAILED:" + app)
        tables = {row[0] for row in db.execute(
            "SELECT name FROM sqlite_master WHERE type='table'")}
        if not REQUIRED[app].issubset(tables):
            raise ValueError("CURRENT_SCHEMA_MISSING:" + app)
        tracked = {row[0] for row in db.execute(
            "SELECT name FROM d1_migrations")}
        if not tracked:
            raise ValueError("MIGRATION_TRACKING_EMPTY:" + app)
        if app == "homeflow" and tracked != expected_homeflow_migrations():
            raise ValueError("HOMEFLOW_MIGRATION_MANIFEST_MISMATCH")
        # Snapshot verification is read-only; release does not alter any rows.
        return {"database": app, "integrity": "ok", "foreign_keys": "ok",
                "restored_snapshot": True, "tracked_migrations": len(tracked),
                "table_count": len(tables), "production_writes": False}


def main() -> None:
    parser = argparse.ArgumentParser()
    for app in APPS:
        parser.add_argument("--db-" + app, required=True)
    args = parser.parse_args()
    rows = []
    for app in APPS:
        rows.append(verify_current_database(app, getattr(args, "db_" + app.replace("-", "_"))))
    print(json.dumps({"ok": True, "current_production_snapshots": rows,
                      "historical_sql_replayed": False,
                      "no_raw_records_logged": True}, ensure_ascii=False))


if __name__ == "__main__":
    main()
