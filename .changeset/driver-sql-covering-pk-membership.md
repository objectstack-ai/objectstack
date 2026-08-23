---
"@objectstack/driver-sql": patch
---

**Bug fix:** on Postgres, `introspectPrimaryKeys` no longer reports a covering primary key's `INCLUDE`'d columns as key members (#11162).

For a primary key created as `CREATE UNIQUE INDEX … INCLUDE (payload)` and promoted with `ALTER TABLE … ADD CONSTRAINT … PRIMARY KEY USING INDEX`, `pg_index.indkey` holds the key columns *and* the payload columns; `indnkeyatts` counts the leading entries that are actually key members and was never consulted, so `payload` came back as part of the key. Measured on a live PostgreSQL 16.13: `indkey = '2 1 3'`, `indnkeyatts = 2`, and the introspected key was `k2, k1, payload` for a declared `(k2, k1)`.

A key with an extra member is a different key: an upsert conflict target naming a non-key column does not match the constraint, and schema-drift comparison against a correctly-declared key reports a phantom `unexpected_key_member`. The join is now bounded with `k.ord <= i.indnkeyatts`, which preserves the declared key order established by #11101. `indnkeyatts` exists on PG 11+; no change for ordinary (non-covering) primary keys.
