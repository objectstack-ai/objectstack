---
'@objectstack/spec': patch
'@objectstack/objectql': patch
'@objectstack/driver-sql': patch
'@objectstack/driver-turso': patch
'@objectstack/plugin-pinyin-search': patch
---

fix(objectql, driver-sql, spec): a stored field whose `expression` reads an `autonumber` stores the value computed with the number

Clause-②: yes (widening)
Metadata-protocol: none

A stored (non-`formula`) field whose `expression` reads a record number, such as `record.case_number + " - " + record.subject`, was computed before the number existed. On insert it stored `null` (or the `has()` fallback) until a later update by id computed it again. Now the insert computes it again right after the number is issued, and writes the row once, carrying both.

- **`IDataDriver.issueAutonumbers` (new, optional).** A driver that owns its record-number counter can issue a row's numbers ahead of the write, in place, and answer after a unique violation whether the collision was on a number it issued (re-seeding the counter and emptying those slots). `SqlDriver` implements it over its existing counter, so `driver-sqlite-wasm` and `driver-turso` (both faces) inherit it. A driver without it is unchanged.
- **The engine.** For an object whose stored expression reads a record number (directly or through another stored field), the engine asks the driver for the number after validation, where it already issued numbers itself, so a rejected row still burns none. It computes the readers again and hands `create()` / `bulkCreate()` the row with the number filled: one INSERT, no transaction. A collision on a single row is re-issued through the member by the engine's existing retry loop, which computes the readers again. A batch collision re-seeds the counter and is not re-issued (the batch policy the engine already had). Objects with no such field keep the driver's own issue-at-write path. Where the engine issues the number itself (driver-memory, driver-mongodb), the readers are computed again after it does.
- **A driver that owns its counter without the member** stores the readers computed without the number, as before, and the engine now says so once per object at `error` level, with the remedy.
- **`ObjectQL.registerInsertRecomputeListener(id, fn)` (new).** Called per row after that second computation, on the row the driver is handed. `plugin-pinyin-search` registers on it, so a `__search` companion whose name field reads the record number is stamped from the value that carries the number, and `$search` finds the record by pinyin and by its number.
- **One change in what a refused insert reports.** On an object whose stored expression reads the number, a SQL driver's collision that survives every retry now leaves as `ERR_AUTONUMBER_COLLISION` (the engine's three attempts) instead of `DUPLICATE_RECORD` (the driver's own retries). Every other object is unchanged.
