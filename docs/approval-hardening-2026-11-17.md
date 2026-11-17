# HomeFlow household-ledger-only hardening · 2026-11-17

- Production-only release; no Preview Worker/D1/R2 or version previews.
- 0061 registry marker repaired after comparing live table and three triggers.
- Migration 0063 widens presentation-only approval-history dismissal to applied
  household-ledger review forms. Original Kakeibo data and immutable journals stay.
- Old family transfer-consent and monthly policy approval API paths return 410.
  Personal asset receipt/reservation routes are retained.
- '核对原申请' explains idempotent reconciliation rather than new posting.
- Full cross-app CI, SQLite migration check and Cloudflare production verification
  gate migration and deployment.
- Real dual-iPhone account isolation, offline outbox, push delivery, OAuth and
  backup restore still require human device testing. Do not claim they passed.
