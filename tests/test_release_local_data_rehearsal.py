"""G9 local-only recovery rehearsal regression tests, with synthetic SQLite data.

No production backup, credentials, Cloudflare API or financial rows enter CI.
"""
import hashlib
import importlib.util
import sqlite3
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "release-local-data-rehearsal.py"
spec = importlib.util.spec_from_file_location("local_data_rehearsal", SCRIPT)
rehearsal = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rehearsal)


class OfflineReleaseRehearsalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="synthetic-offline-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "private-restored-baseline.sqlite"
        self.sqls = self.root / "reviewed-sql"
        self.sqls.mkdir()
        with sqlite3.connect(self.source) as db:
            for table in rehearsal.PROTECTED["homeflow"]:
                db.execute("CREATE TABLE " + table + "(id INTEGER PRIMARY KEY, sample TEXT)")
                db.execute("INSERT INTO " + table + "(id, sample) VALUES(1, ?)", (table,))
            db.commit()
        self.original = hashlib.sha256(self.source.read_bytes()).hexdigest()

    def write_migration(self, body):
        name = "0053_synthetic_release.sql"
        (self.sqls / name).write_text(body, encoding="utf-8")
        return name

    def assert_source_untouched(self):
        self.assertEqual(self.original, hashlib.sha256(self.source.read_bytes()).hexdigest())
        rehearsal.check_db(self.source)

    def exercise(self, filename):
        destination = self.root / "staging"
        destination.mkdir()
        return rehearsal.exercise_one(
            "homeflow", self.source, self.sqls, [filename], destination)

    def test_additive_sql_preserves_data_and_local_rollback(self):
        name = self.write_migration(
            "CREATE TABLE new_stage_f (id INTEGER PRIMARY KEY);"
            "INSERT INTO new_stage_f (id) VALUES(7);")
        result = self.exercise(name)
        self.assertEqual(result["migration_status"], "PASS")
        self.assertEqual(result["applied"], 1)
        self.assertEqual(result["planned"], 1)
        self.assertTrue(result["isolated_restore_verified"])
        self.assertFalse("value" in result)
        self.assert_source_untouched()

    def test_mutating_legacy_private_rows_fails_closed_and_restores(self):
        name = self.write_migration(
            "INSERT INTO users(id,sample) VALUES(2,'must-not-apply');")
        result = self.exercise(name)
        self.assertEqual(result["migration_status"], "FAILED")
        self.assertEqual(result["blocker"], "PROTECTED_DATA_TOTALS_CHANGED")
        self.assertTrue(result["isolated_restore_verified"])
        self.assert_source_untouched()

    def test_unchanged_count_but_private_data_modified_is_detected(self):
        name = self.write_migration(
            "UPDATE users SET sample='changed-private-profile' WHERE id=1;")
        result = self.exercise(name)
        self.assertEqual(result["migration_status"], "FAILED")
        self.assertEqual(result["blocker"], "PROTECTED_DATA_TOTALS_CHANGED")
        self.assertTrue(result["isolated_restore_verified"])
        self.assert_source_untouched()

    def test_equal_signed_and_absolute_financial_totals_cannot_hide_row_corruption(self):
        bank = self.root / "local-kakebo.sqlite"
        with sqlite3.connect(bank) as db:
            db.execute("CREATE TABLE entries(id INTEGER PRIMARY KEY,type TEXT,amount INTEGER)")
            db.executemany("INSERT INTO entries VALUES(?,?,?)", [
                (1, "expense", 900), (2, "expense", 300)])
            for table in rehearsal.PROTECTED["kakebo"]:
                if table == "entries":
                    continue
                db.execute("CREATE TABLE " + table + "(id INTEGER PRIMARY KEY)")
            db.commit()
        old_hash = hashlib.sha256(bank.read_bytes()).hexdigest()
        name = self.write_migration(
            "UPDATE entries SET amount=950 WHERE id=1;"
            "UPDATE entries SET amount=250 WHERE id=2;")
        where = self.root / "kakebo-try"
        where.mkdir()
        result = rehearsal.exercise_one("kakebo", bank, self.sqls, [name], where)
        self.assertEqual(result["migration_status"], "FAILED")
        self.assertEqual(result["blocker"], "PROTECTED_DATA_TOTALS_CHANGED")
        self.assertTrue(result["isolated_restore_verified"])
        self.assertEqual(hashlib.sha256(bank.read_bytes()).hexdigest(), old_hash)

    def test_sql_failure_preserves_baseline_and_independent_recovery(self):
        name = self.write_migration("CREATE TABLE incomplete (")
        result = self.exercise(name)
        self.assertEqual(result["migration_status"], "FAILED")
        self.assertEqual(result["blocker"], "ISOLATED_MIGRATION_FAILED")
        self.assertTrue(result["isolated_restore_verified"])
        self.assert_source_untouched()

    def test_missing_or_unsafe_migration_never_changes_original(self):
        for name, expected in [
            ("0053_absent.sql", "PINNED_MIGRATION_MISSING"),
            ("../escape.sql", "UNSAFE_MIGRATION_FILE")]:
            with self.subTest(name=name):
                destination = self.root / ("stage-" + str(len(list(self.root.iterdir()))))
                destination.mkdir()
                result = rehearsal.exercise_one(
                    "homeflow", self.source, self.sqls, [name], destination)
                self.assertEqual(result["migration_status"], "FAILED")
                self.assertEqual(result["blocker"], expected)
                self.assertTrue(result["isolated_restore_verified"])
        self.assert_source_untouched()

    def test_symlink_restored_backup_is_not_accepted(self):
        source_link = self.root / "link.sqlite"
        source_link.symlink_to(self.source)
        with self.assertRaisesRegex(RuntimeError, "READ_ONLY_RESTORED_SQLITE"):
            rehearsal.clone_readonly(source_link, self.root / "invalid.sqlite")
        self.assert_source_untouched()


if __name__ == "__main__":
    unittest.main()
