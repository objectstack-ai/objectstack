---
'@objectstack/metadata': patch
---

Serve an Invalid `Date` from a driver instead of raising `RangeError` in `DatabaseLoader.stat`.

`canonicalIsoInstant` reached `value.toISOString()` for any `Date`, and that call raises `RangeError: Invalid time value` for the one `Date` whose time value is `NaN`. `stat()` is a hot read path — REST `/meta/*`, ObjectQL plan resolution, runtime overlay merges — so one legacy `sys_metadata` row answered **500** where the spelling this repair replaced had served a visibly-wrong value.

The shape is measured: mysql2 3.23.1 hands back a constant literally named `INVALID_DATE` for a zero `DATETIME`, and postgres-date 1.0.7 builds `new Date(NaN)` for every year in 275760..294276, which Postgres itself stores.

The `Date` arm now guards on `Number.isNaN(value.getTime())` and answers `undefined`, so `stat()`'s own `?? new Date().toISOString()` — the branch an absent column already takes — publishes a parseable `MetadataStats.mtime`. `undefined` rather than visible text is deliberate here: `mtime` is declared `z.string().datetime()`, so the text `"Invalid Date"` would not produce a readable cell, it would produce a zod refusal at the consumer, moving the failure instead of removing it. A blank is excluded for the opposite reason — it hides the producer's bug.
