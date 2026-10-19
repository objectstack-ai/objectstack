---
"@objectstack/spec": minor
---

feat(spec): `PublishPackageDraftsResponseSchema` declares `backfillApplied`, the per-field receipt of the publish door's opt-in backfill

Clause-②: yes (widening)

- `backfillApplied?: { success, fields: [{ object, field, updated, error?, code? }] }`, present only when the request named a `backfill` and the batch published. Declared so the door's response parse carries it instead of stripping it.
