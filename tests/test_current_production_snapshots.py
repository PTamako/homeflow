"""Regression tests for current-production isolated snapshot checks."""
from __future__ import annotations
import importlib.util
import sqlite3
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "verify-current-production-snapshots.py"
spec = importlib.util.spec_from_file_location("verify_current_snapshots", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CurrentSnapshotTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def database(self, app, *, missing=None):
        path = Path(self.tmp.name) / (app + ".sqlite")
        db = sqlite3.connect(path)
        db.execute("PRAGMA foreign_keys=ON")
        tables = module.REQUIRED[app] - set(missing or [])
        for table in sorted(tables):
            if table == "d1_migrations":
                db.execute("CREATE TABLE d1_migrations(name TEXT PRIMARY KEY)")
            else:
                db.execute(f"CREATE TABLE {table}(id TEXT PRIMARY KEY)")
        if "d1_migrations" in tables:
            names = (module.expected_homeflow_migrations()
                     if app == "homeflow" else {"0001_initial.sql"})
            db.executemany("INSERT INTO d1_migrations(name) VALUES (?)",
                           [(name,) for name in sorted(names)])
        db.commit()
        db.close()
        return str(path)

    def test_each_current_database_passes_without_replaying_migrations(self):
        for app in module.APPS:
            with self.subTest(app=app):
                info = module.verify_current_database(app, self.database(app))
                self.assertEqual(info["integrity"], "ok")
                self.assertFalse(info["production_writes"])
                self.assertTrue(info["restored_snapshot"])

    def test_missing_schema_is_rejected(self):
        path = self.database("jp-document-assistant",
                             missing={"homeflow_identity_links"})
        with self.assertRaisesRegex(ValueError, "CURRENT_SCHEMA_MISSING"):
            module.verify_current_database("jp-document-assistant", path)

    def test_homeflow_manifest_mismatch_is_rejected(self):
        path = self.database("homeflow")
        with sqlite3.connect(path) as db:
            db.execute("DELETE FROM d1_migrations WHERE name = (SELECT name FROM d1_migrations LIMIT 1)")
        with self.assertRaisesRegex(ValueError, "HOMEFLOW_MIGRATION_MANIFEST_MISMATCH"):
            module.verify_current_database("homeflow", path)


if __name__ == "__main__":
    unittest.main()
