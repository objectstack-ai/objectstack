---
"@objectstack/spec": minor
"@objectstack/objectql": minor
"@objectstack/driver-sql": minor
---

`signature` and `qrcode` join the bounded-string family end to end, closing the last measured hole #11794 left open (#11875, maintainer ruling 2026-08-25, option 1). Three seams move together, in the order that keeps declared = enforced at every step:

- **Authoring (`@objectstack/spec`)**: `maxLength` / `minLength` become authorable on `signature` and `qrcode` — both types join `BOUNDED_STRING_FIELD_TYPES`, so `Field.signature({ maxLength: 64 })`, refused at the authoring seam since #11566, now parses. The refusal message for the remaining out-of-set types enumerates the set itself instead of a hand-written copy of it, and both authoring forms show the key for the same set.
- **Write seam (`@objectstack/objectql`)**: the record-validator's `max_length` / `min_length` branch now reads the spec's `BOUNDED_STRING_FIELD_TYPES` instead of a hand-copied ten-type list, so a declared bound on `signature` / `qrcode` refuses an over-long value with a field-named ADR-0112 `max_length` envelope — boundary measured: exactly `maxLength` characters is accepted, one past it is refused, on insert and update. `secret` and `color` are deliberately NOT covered (opaque `sys_secret` ref per ADR-0100; short by construction — the ruling's explicit carve-outs).
- **Storage (`@objectstack/driver-sql`)**: both types move from the catch-all's `varchar(255)` into the TEXT family, under exactly the invariant #11794 established — an unbounded TEXT column is permitted precisely because the write seam now enforces the declared bound. Measured on live MySQL 8.0.46 (`STRICT_TRANS_TABLES`) and Postgres 16: a 1000-character data-URI signature, previously refused by the server (`ER_DATA_TOO_LONG` / `22001`), lands in a column that reads back as `text` from `information_schema.COLUMNS` on both dialects and round-trips byte-identically. The #11374 keyed-and-bounded rule applies to them unchanged: a keyed, bounded column is emitted `varchar(maxLength)` and the server refuses exactly one character past the declared bound.

Nothing about existing tables changes — `createColumn` runs on `CREATE TABLE` and `ALTER TABLE ADD COLUMN`, so the column it sizes is always empty; a pre-existing `signature` / `qrcode` column stays `varchar(255)` until an operator migrates it, and the additive sync never rewrites a column's type on its own.
