---
'@objectstack/driver-sql': patch
---

fix(driver-sql): a plain index MySQL refuses to key is logged and the sync goes on, so the object's remaining boot steps run

Clause-②: no
Metadata-protocol: none

MySQL refuses a TEXT column in a key without a key length (`ER_BLOB_KEY_WITHOUT_LENGTH`) and a key part wider than 3072 bytes (`ER_TOO_LONG_KEY`). A UNIQUE index past that refusal is carried on a hash shadow; a plain (non-unique) index has no such route. Schema sync logged the refusal and then threw it, and no caller between it and the per-object boot loop caught the throw. So on every boot, for that object, every index declared after the refused one was never attempted, and the old-key index retirement, the drift reconcile and report, the canonical datetime/time/json/boolean backfills and the MySQL `TIMESTAMP`/`TIME` widenings were all skipped, while the boot counted a schema-sync failure.

The shape that reaches it is an upgrade: a column created as TEXT before its field declared a `maxLength` stays TEXT, so a release that adds the bound and a plain index over that column hits the refusal.

FROM: the refusal is logged at `error` and thrown, and the object's remaining steps are skipped. TO: the refusal is logged at `error` once, on the durability channel, with the same field-level remedy, and the sync goes on. The index is still not created and still not substituted (no prefix index, no shadow column); the drift report still lists it as missing. A UNIQUE index that the hash-shadow route could not carry still throws, as before. PostgreSQL and SQLite never refuse these keys and are unchanged.

To build the refused index, convert the column to `varchar(n)` by hand (the remedy the log line names) and let the next boot create it.
