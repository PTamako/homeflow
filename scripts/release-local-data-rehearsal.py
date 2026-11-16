#!/usr/bin/env python3
"""G9 private offline rehearsal against four user-restored production D1 SQLite files.

The 2026-11-14 encrypted A-stage backup is already owner-confirmed. Do not
upload private data, decrypt a password in Chat/GitHub/Cloudflare, or mutate
a live D1. This script clones each *locally restored SQLite* backup read-only,
replays exactly the pinned Stage F migrations in isolation, compares original
critical financial/private totals, then physically restores the staged copy
from its untouched baseline. It is NOT a real Cloudflare production rollback.
"""
import argparse
import hashlib
import json
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

PROTECTED = {
    "homeflow": ["users", "household_members", "tasks", "family_profiles"],
    "kakebo": ["entries", "payment_sources", "investment_holdings", "receipt_r2_state"],
    "it-study-platform": ["study_attempts", "scenario_attempts", "saved_vocabulary_entries_v2"],
    "jp-document-assistant": ["documents", "users"],
}


def check_db(path):
    with sqlite3.connect(str(path)) as db:
        status = db.execute("PRAGMA integrity_check").fetchone()
        if status != ("ok",):
            raise RuntimeError("SQLITE_INTEGRITY_CHECK_FAILED")
        # A new migration must never introduce dangling references.
        errors = db.execute("PRAGMA foreign_key_check").fetchmany(1)
        if errors:
            raise RuntimeError("SQLITE_FOREIGN_KEY_CHECK_FAILED")


def protected_columns(path, tables):
    """Capture original columns so additive migrations can add new columns."""
    with sqlite3.connect(str(path)) as db:
        present = {r[0] for r in db.execute(
            "SELECT name FROM sqlite_master WHERE type='table'")}
        result = {}
        for table in tables:
            if table not in present:
                raise RuntimeError("PROTECTED_TABLE_MISSING:" + table)
            cols = [r[1] for r in db.execute(
                'PRAGMA table_info("' + table.replace('"', '""') + '")')]
            if not cols:
                raise RuntimeError("PROTECTED_COLUMNS_MISSING:" + table)
            result[table] = cols
        return result


def snapshot(path, tables, original_columns):
    """Hash EVERY original row without revealing personal information.

    Counting rows or summing money is insufficient: offsetting changes to
    different expenses can cancel while corrupting an individual's ledger.
    The original-column projection permits only additive new schema columns.
    """
    with sqlite3.connect(str(path)) as db:
        counts = {}
        for table in tables:
            cols = original_columns[table]
            quoted = lambda x: '"' + x.replace('"', '""') + '"'
            names = ",".join(quoted(c) for c in cols)
            row_hashes = []
            try:
                for row in db.execute(
                    "SELECT " + names + " FROM " + quoted(table)):
                    values = [
                        {"blob_sha256": hashlib.sha256(v).hexdigest(),
                         "bytes": len(v)} if isinstance(v, bytes) else v
                        for v in row
                    ]
                    payload = json.dumps(values, ensure_ascii=False,
                                         separators=(",", ":"), allow_nan=False)
                    row_hashes.append(hashlib.sha256(payload.encode()).hexdigest())
            except (sqlite3.Error, ValueError, TypeError) as exc:
                raise RuntimeError(
                    "PROTECTED_ROW_FINGERPRINT_UNAVAILABLE:" + table) from exc
            row_hashes.sort()
            counts[table] = len(row_hashes)
            counts[table + "_original_row_sha256"] = hashlib.sha256(
                "\\n".join(row_hashes).encode()).hexdigest()
        if "entries" in counts:
            counts["entries_signed_amount"] = int(db.execute(
                "SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE -amount END),0)"
                " FROM entries").fetchone()[0])
            counts["entries_amount_total"] = int(db.execute(
                "SELECT COALESCE(SUM(amount),0) FROM entries").fetchone()[0])
        return counts


def clone_readonly(source, dest):
    """SQLite online backup API safely includes local WAL state without editing source."""
    if not source.is_file() or source.is_symlink():
        raise RuntimeError("READ_ONLY_RESTORED_SQLITE_FILE_REQUIRED")
    uri = source.resolve().as_uri() + "?mode=ro"
    ro = sqlite3.connect(uri, uri=True)
    try:
        with sqlite3.connect(str(dest)) as out:
            ro.backup(out)
    finally:
        ro.close()


def preexisting_additive_column_guard(db, name):
    """Reconcile exactly TWO known historically pre-applied legacy columns.

    A migration lacking its schema_migrations marker is NOT assumed absent.
    Existing columns may only be skipped when every type, default and CHECK
    matches the frozen original SQL. Partial schema never receives an unsafe
    ALTER or is silently considered PASS.
    """
    expected = {
        "0020_recurring_multi_schedule.sql": (
            "recurring_plans",
            {
                "weekdays_json": ("TEXT", 1, "'[]'",
                    "CHECK(json_valid(weekdays_json))"),
                "month_days_json": ("TEXT", 1, "'[]'",
                    "CHECK(json_valid(month_days_json))"),
                "interval_months": ("INTEGER", 1, "1",
                    "CHECK(interval_months BETWEEN 1 AND 24)"),
            }),
        "0021_sbi_transfer_purpose.sql": (
            "sbi_transfer_links",
            {"purpose": ("TEXT", 1, "'monthly'",
                "CHECK(purpose IN ('monthly','purchase','funding'))")}),
    }
    if name not in expected:
        return False
    table, required = expected[name]
    columns = {r[1]: r for r in db.execute(
        'PRAGMA table_info("' + table + '")')}
    present = set(required).intersection(columns)
    if not present:
        return False
    schema_row = db.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name=?",
        (table,)).fetchone()
    ddl = "".join((schema_row[0] if schema_row else "").lower().split())
    for col, (coltype, notnull, default, check) in required.items():
        got = columns.get(col)
        if (got is None or got[2].upper() != coltype
                or got[3] != notnull or got[4] != default
                or "".join(check.lower().split()) not in ddl):
            raise RuntimeError("PREEXISTING_MIGRATION_SCHEMA_MISMATCH:" + name)
    return True


def replay_migrations(dbpath, migrations_dir, filenames):
    if not migrations_dir.is_dir():
        raise RuntimeError("PINNED_MIGRATION_DIRECTORY_MISSING")
    applied = []
    verified_existing = []
    for name in filenames:
        if "/" in name or "\\" in name or not name.endswith(".sql"):
            raise RuntimeError("UNSAFE_MIGRATION_FILE")
        path = migrations_dir / name
        if path.is_symlink() or not path.is_file():
            raise RuntimeError("PINNED_MIGRATION_MISSING:" + name)
        sql = path.read_text(encoding="utf-8")
        if not sql.strip():
            raise RuntimeError("PINNED_MIGRATION_EMPTY:" + name)
        try:
            with sqlite3.connect(str(dbpath)) as db:
                db.execute("PRAGMA foreign_keys=ON")
                if preexisting_additive_column_guard(db, name):
                    verified_existing.append(name)
                    continue
                db.executescript(sql)
                db.commit()
        except sqlite3.Error as exc:
            raise RuntimeError("ISOLATED_MIGRATION_FAILED:" + name + ":" + type(exc).__name__) from exc
        applied.append(name)
    return applied, verified_existing


def exercise_one(label, source, migration_dir, files, root):
    folder = root / label
    folder.mkdir()
    original = folder / "baseline.sqlite"
    working = folder / "migrated.sqlite"
    restored = folder / "restored.sqlite"
    clone_readonly(source, original)
    check_db(original)
    cols = protected_columns(original, PROTECTED[label])
    old = snapshot(original, PROTECTED[label], cols)
    shutil.copyfile(original, working)
    applied = []
    preexisting = []
    caught = None
    try:
        applied, preexisting = replay_migrations(working, migration_dir, files)
        check_db(working)
        new = snapshot(working, PROTECTED[label], cols)
        if old != new:
            raise RuntimeError("PROTECTED_DATA_TOTALS_CHANGED")
    except Exception as exc:
        caught = str(exc)
    finally:
        # RESTORE ISOLATED COPY EVEN AFTER A FAILED MIGRATION. No remote writes.
        clone_readonly(original, restored)
        check_db(restored)
        if snapshot(restored, PROTECTED[label], cols) != old:
            raise RuntimeError("ISOLATED_ROLLBACK_FAILED")
        digest_original = hashlib.sha256(original.read_bytes()).hexdigest()
        digest_restored = hashlib.sha256(restored.read_bytes()).hexdigest()
        if digest_original != digest_restored:
            # SQLite Online Backup can rearrange pages; logical totals are the
            # correctness invariant, so identical bytes are additional evidence.
            byte_identical = False
        else:
            byte_identical = True
        if snapshot(original, PROTECTED[label], cols) != old:
            raise RuntimeError("ORIGINAL_BASELINE_MUTATED")
    return {"database": label, "applied": len(applied),
            "verified_preexisting": preexisting, "completed": len(applied) + len(preexisting),
            "planned": len(files),
            "protected_counts_sha256": hashlib.sha256(json.dumps(
                old, sort_keys=True).encode()).hexdigest(),
            "isolated_restore_verified": True,
            "byte_identical": byte_identical,
            "migration_status": "FAILED" if caught else "PASS",
            "blocker": caught and caught.split(":")[0],
            "blocked_migration": caught.split(":")[1] if caught and ":" in caught else None}


def load_manifest(repo_root):
    code = ("import{MIGRATION_PLANS}from './scripts/release-d1-migration-inventory.mjs';"
            "console.log(JSON.stringify(MIGRATION_PLANS));")
    raw = subprocess.check_output(["node", "--input-type=module", "-e", code],
                                  cwd=str(repo_root), text=True, timeout=20)
    plans = json.loads(raw)
    if {p["db"] for p in plans} != set(PROTECTED):
        raise RuntimeError("FOUR_APP_MIGRATION_MANIFEST_INCOMPLETE")
    return plans


def main():
    parser = argparse.ArgumentParser(
        description="Local-only four-D1 real-backup migration and rollback rehearsal")
    for name in PROTECTED:
        parser.add_argument("--db-" + name, required=True, type=Path)
    parser.add_argument("--repo-kakebo", required=True, type=Path)
    parser.add_argument("--repo-it-study-platform", required=True, type=Path)
    parser.add_argument("--repo-jp-document-assistant", required=True, type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    paths = {"homeflow": root, "kakebo": args.repo_kakebo,
             "it-study-platform": args.repo_it_study_platform,
             "jp-document-assistant": args.repo_jp_document_assistant}
    plans = load_manifest(root)
    results = []
    try:
        with tempfile.TemporaryDirectory(prefix="four-app-local-rehearsal-") as tmp:
            for p in plans:
                name = p["db"]
                results.append(exercise_one(name,
                    getattr(args, "db_" + name.replace("-", "_")),
                    paths[name] / "migrations", p["files"], Path(tmp)))
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc).split(":")[0],
                          "production_mutations": False,
                          "production_release_authorized": False}))
        return 2
    ok = all(r["migration_status"] == "PASS" and r["completed"] == r["planned"]
             for r in results)
    print(json.dumps({"ok": ok, "results": results,
                      "production_mutations": False,
                      "production_release_authorized": False,
                      "requires_independent_cloudflare_deployment_rollback": True},
                     sort_keys=True, indent=2))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
