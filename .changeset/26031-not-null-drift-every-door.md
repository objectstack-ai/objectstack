---
'@objectstack/types': patch
'@objectstack/runtime': patch
---

fix(runtime,types)!: a NOT NULL refusal on a column no field declares answers `RestServer`'s `400 VALIDATION_FAILED` body at the dispatcher `/data` and actions doors too

Since #24768 the engine refuses a NOT NULL violation on a field the object declares as its own `ValidationError`, which every door answers alike. A column no field declares (drift: the field left the metadata and its NOT NULL column stayed in the table) still leaves the engine as the driver threw it, and the doors answered that refusal three ways. `RestServer`'s `POST /data/:object` answered `mapDataError`'s NOT NULL arm: `400 VALIDATION_FAILED`, the column's sentence, its `required` field entry and the drift `hint`. The runtime dispatcher's `POST /data/:object` let it reach the Hono exits, which answered `500 INTERNAL_ERROR`. The actions door answered `400 VALIDATION_ERROR` with the driver's text (the physical table and column) as the message and the driver's code as `declaredCode`.

Clause-②: yes (widening: `@objectstack/types` adds the export `driverNotNullRefusalAnswer`)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition, stored row or stored shape is added, removed, renamed or re-shaped, and no exported declaration is removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. What changes is the status, code and body two HTTP doors answer for one refusal, a driver NOT NULL refusal on an undeclared column: every write that was refused is still refused and every write that was served is still served. The remedy is on the consumer's side, reading `code` and `details`; never a rewrite of a package source or a stored row. The other categories are closed on facts: both packages publish (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (a wire-answer change), shipped as `patch`: no metadata protocol kind moves.

- **`@objectstack/types`.** New export `driverNotNullRefusalAnswer(error, object?)`: `mapDataError`'s NOT NULL arm answer (`{ status, body }`) when classification answers the error with that arm, `undefined` for every other answer. Every arm ahead of it (a declared status, a sandboxed body's throw, a unique violation, an unknown column, the record validator's `ValidationError`) still decides first. `mapDataError`'s own answers are unchanged.
- **`@objectstack/runtime`.** The dispatcher's `/data/:object` routes answer that refusal themselves with `400`, `error.code: 'VALIDATION_FAILED'`, the column's sentence as `error.message`, and `fields`, `hint` and `object` in `error.details` (was a thrown `500 INTERNAL_ERROR`). The actions door answers the same body (was `400 VALIDATION_ERROR` with the driver's text and `declaredCode`). The driver's text and code no longer reach either wire.
- A `PATCH` cannot reach such a column: naming it is refused before the driver as an undeclared field (`400 INVALID_FIELD`), on both `/data` doors alike, as before.
- The answers for a field the object declares are unchanged.
