---
"@objectstack/metadata-core": patch
"@objectstack/service-messaging": patch
---

`sys_metadata_commit` and `sys_http_delivery` stop declaring `maxLength: 64` on `id` — the last two platform-shipped declarations that made a clean boot warn about the platform's own tables.

The driver emits `id`, `created_at` and `updated_at` itself and skips any declared field colliding with one, so the STORAGE half of such a declaration is discarded. #12015 made that discard loud instead of silent, and #12131 then cleared 45 system objects declaring `id` as `text`. These two survived that sweep because their residue was an attribute rather than a type: nothing can honour a `maxLength: 64` on a column the platform emits as `varchar(255)`.

Measured on `origin/main` at `70f7d6d735`, over all 112 `*.object.ts` files in the repo (117 object declarations, 215 fields declared on a platform-emitted builtin column): exactly **2** declarations still tripped the diagnostic, and both are these. Fed through the real `SqlDriver` DDL path — one create pass, then one alter pass over the now-existing tables — those two produced **4** `[sql-driver]` collision warning blocks; after this change the same two runs produce **0**, with the 215-field sweep unchanged so the empty result is a measurement and not an empty loop.

**No behaviour changes.** The attribute was already being discarded before it reached DDL, so the physical columns, the accept set and every write path are byte-for-byte what they were. What changes is that the platform's own declarations no longer trip a diagnostic aimed at author code.

⛔ The warning itself is untouched, on purpose. It is working as designed — it is the diagnostic #12015 was filed for, because a declared `id` used to be discarded in silence. Quieting, suppressing or narrowing it was never the remedy; the platform's declarations getting clean is.

Each package gains an in-package pin (`builtin-column-storage-attributes.test.ts`) holding every object schema it ships to that shape, with a positive control in the same run.
