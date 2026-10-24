---
'@objectstack/driver-sql': patch
---

fix(driver-sql)!: `findWithWindowFunctions()` compiles the function name and sort direction from closed sets and quotes every column it names

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition or stored shape is added, removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. No export, type, flag or error code is added, removed or renamed: the refusal is the existing `INVALID_QUERY`. What narrows is the set of `windowFunctions[]` entries one driver method accepts, and the remedy is the caller using a supported function name and `asc` / `desc`. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this method (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (the window-function door's accept set narrows), shipped as `patch`: it changes which calls one driver method serves, not what a metadata author can write.

`SqlDriver.findWithWindowFunctions()` (and the drivers that inherit it: `driver-sqlite-wasm`, and `driver-turso` on its local and replica transports) assembled its `OVER (…)` clause as text. It now builds it from closed tables and quoted identifiers:

- **Function:** one of `row_number`, `rank`, `dense_rank`, `percent_rank`, `cume_dist`, in any case. These are the argument-less functions the door's flat shape can express. Any other name answers `400 INVALID_QUERY` before a statement is sent.
- **Direction:** `asc` or `desc`, in any case, defaulting to `asc`. Anything else answers `400 INVALID_QUERY`.
- **Fields:** each `partitionBy` and `orderBy` field is emitted as a quoted column reference, so a field names a column and nothing else.
- **Unchanged:** every call that names a supported function, a column and `asc` / `desc` compiles to the same window and returns the same rows.
- **Fix:** use one of the five functions above and `asc` / `desc`. A window that needs an argument (`lag`, `lead`, `ntile`, `first_value`) was never expressible through this door; send it through the driver's `execute()` with bound parameters.
