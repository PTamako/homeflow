#!/usr/bin/env python3
"""Restore one Cloudflare D1 exported SQL file into an EPHEMERAL local SQLite only.

Never accepts a Cloudflare account token or a production D1 identifier.
No SQL/text/data is emitted into GitHub Actions logs or artifacts.
"""
import os
import sqlite3
import sys
from pathlib import Path


def main():
    if len(sys.argv) != 3:
        return 2
    source, target = map(Path, sys.argv[1:])
    if not source.is_file() or source.is_symlink() or target.exists():
        return 2
    if source.stat().st_size < 256 or source.stat().st_size > 320 * 1024 * 1024:
        return 2
    try:
        sql = source.read_text(encoding="utf-8")
        with sqlite3.connect(target) as db:
            db.enable_load_extension(False)
            db.executescript(sql)
            db.commit()
            if db.execute("PRAGMA integrity_check").fetchone() != ("ok",):
                raise ValueError("INTEGRITY_FAILED")
            if db.execute("PRAGMA foreign_key_check").fetchone():
                raise ValueError("FOREIGN_KEY_CHECK_FAILED")
        os.chmod(target, 0o600)
        return 0
    except Exception:
        # sqlite exceptions can contain financial/SQL text. Intentionally
        # never print raw exception or any SQL in security-sensitive CI.
        return 1


if __name__ == "__main__":
    sys.exit(main())
