---
"@objectstack/rest": patch
"@objectstack/objectql": patch
---

fix(rest,objectql): the import dry run asks the engine for its verdict instead of predicting it (#4633 ruling D)

`POST /api/v1/data/:object/import?dryRun=true` green-lit rows the very same
endpoint then rejected. Measured on 17.0.0-rc.1: a CSV cell aimed at a
structured `address` field reported `{ ok: 1, created: 1 }` on the dry run and
`{ errors: 1, code: 'VALIDATION_FAILED' }` on the real write.

The dry run predicted the write's verdict with a hand-copied mirror of a slice
of the engine's rules (`import-coerce.ts`'s `firstMissingRequiredField` and
`firstConstraintViolation`). A copy cannot structurally keep up with the family
it mirrors: ADR-0104 value shapes (`address` / `location` / references / media),
`format` checks, object-level `validations` and the state machine had no
counterpart, and `coerceFieldValue` routes structured shapes through its
pass-through catch-all, so no verdict was formed at all.

**The mirror is retired.** The dry run now calls `DataProtocol.validateData`
(#6037), which runs the same `validateRecord` / `evaluateValidationRules` that
`insert()` runs, under the deployment's own ADR-0104 posture — so a bad value
shape is an error on a self-certified deployment and an admitted warning on a
warn-first one, exactly as on the write. Agreement is by construction, not by a
copy kept in step by hand.

Also in this change:

- **`engine.validate()` now resolves `defaultValue`s and seeds owned roll-up
  `summary` fields before validating, on `insert` mode**, because `insert()`
  does. Without it a required-but-defaulted column left unmapped was previewed
  `failed` and written `created` — a false alarm on the row a preview is meant
  to reassure you about. `update` mode still does not default (#2706).
- **A row report failed by validation now names the offending column.** The
  engine's `ValidationError` carries `fields[]`, so the row's `field` is set and
  its `code` is the field-level code (`required`, `min_value`, `max_length`,
  `invalid_type`, …) rather than the wrapper's `VALIDATION_FAILED`. This is the
  same vocabulary the dry run and the per-cell coercion failures already spoke;
  before, a `min: 0` violation was `min_value` on the dry run and
  `VALIDATION_FAILED` on the write.
- **Dry-run rows may carry `warnings[]`** — findings this deployment admits
  rather than rejects (ADR-0104 warn-first). The row is `ok`, and the complaint
  is visible instead of living only in a server log line.

A protocol that does not implement `validateData` (plugin-auth's identity
import, whose write is better-auth rather than the engine) is not handed a
substitute: its dry run reports coercion and create/update/skip resolution only.
An engine-derived preview of a non-engine write would report findings that write
never produces.
