---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): stop interpolating raw driver text into client-facing messages (#8136)

Option C of #8086, at the producer. `packages/metadata-protocol` interpolated
raw driver/engine error text into messages and response payloads that reach API
clients. Measured on the uninstall path: `DELETE /api/v1/packages/:id` answered
`500 INTERNAL_ERROR` with the body message `SQLITE_ERROR: no such table:
sys_metadata` — a physical table name on the wire.

Three downstream sanitizers already existed for this class, and each had a hole
traceable to the producer. Two of those holes are structural, not accidental:

- The boundary belts run `looksLikeInternalErrorLeak`, a **heuristic over the
  message**. It now knows the two dialects this repo runs (#8132 / #8263), but a
  phrasing test can only ever know the dialects someone has met — MySQL, MSSQL
  and Oracle each phrase "this table is missing" differently again, and all
  three are measured invisible to it.
- `deletePackage`'s per-item `failed[]` and `cleanups[]` ride onto a
  `PACKAGE_DELETE_PARTIAL` **400** inside `details`. That is data, not a
  message, so no 5xx message withhold at any HTTP boundary ever sees it.

**The rule, now stated once at the producer.** A caught error's sentence is
quoted back to a caller only when that error **declared itself a client-facing
refusal** — a 4xx `status` in the ADR-0112 envelope. Anything undeclared (a bare
`Error` from a driver) or declared a server fault gets a stable sentence naming
the operation that failed, and the original error rides on `cause` so the
operator's log still receives it whole. This is a positive list rather than a
negative heuristic, so a dialect nobody here has run is handled correctly by
default.

Behaviour changes visible to an API client, all on failure paths:

- A driver failure on the uninstall's `sys_metadata` read is now refused with the
  declared envelope this package already uses for that exact condition —
  **503 `SERVICE_UNAVAILABLE`** with the "metadata store could not be read"
  sentence — instead of an undeclared 500 carrying the driver's own text. It
  remains a failure: an unreachable store is never reported as an uninstall that
  removed nothing.
- `deleteMetaItem`'s two failure exits keep the `Failed to delete customization
  overlay` prefix and their existing `status`, but no longer append the driver's
  message.
- `deletePackage`'s `cleanups[].error` reports `cleanup failed` for a cleanup
  that failed without declaring a refusal.

Self-correcting refusals are deliberately untouched: `[item_locked]`,
`[writable_package_required]`, `[no_draft]`, `[tenant_scope_required]` and the
rest declare a 4xx and still reach the caller verbatim, including inside
`failed[]` on a partial uninstall.
