---
"@objectstack/spec": minor
"@objectstack/core": minor
"@objectstack/runtime": minor
---

feat(spec,core,runtime)!: ADR-0112 batch 1 — one error-code vocabulary, SCREAMING_SNAKE, schema-enforced (#3841)

Settles #3841 per ADR-0112: the top-level `error.code` vocabulary is
SCREAMING_SNAKE, in two tiers.

- **`StandardErrorCode` members renamed in place** (`validation_error` →
  `VALIDATION_ERROR`, all 53). Breaking for importers that branch on the old
  lowercase members; the type name and member *meanings* are unchanged.
- **New `ERROR_CODE_LEDGER`** (`@objectstack/spec/api`): service-specific codes
  (`AUTH_REQUIRED`, `VALIDATION_FAILED`, `ATTACHMENT_DOWNLOAD_DENIED`, …) are
  registered per owning package. `ErrorCode` = standard ∪ registered.
- **`ApiErrorSchema.code` is now `ErrorCode`**, not `z.string()` — an
  unregistered code fails parse, so the envelope conformance suites assert
  values, not just shape.
- **`FieldErrorSchema.code` widened to `z.string()`** (ADR-0112 D6): field-level
  codes are a separate vocabulary the enum never described; #3977 owns its real
  catalog.
- **Derived codes changed case on the wire**: `standardErrorCodeForHttpStatus`
  now yields SCREAMING members (`permission_denied` → `PERMISSION_DENIED`,
  `method_not_allowed` → `METHOD_NOT_ALLOWED`, …) — this map was #3842's
  designated one-file sweep point for exactly this decision.
- **`ANONYMOUS_DENY_CODE` is `'UNAUTHENTICATED'`** (was `'unauthenticated'`) —
  the promoted code on anonymous-denied requests and the REST `enforceAuth`
  body change spelling with it.

`error-catalog.mdx` and the error-handling guides are rewritten to the single
vocabulary; a spec test now locks the catalog page's headings to the enum so
they cannot drift apart again. Remaining lowercase emitters (cloud-connection,
plugin-auth envelope codes, metadata-protocol, …) are the batch-2 sweep.
