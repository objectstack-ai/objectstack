---
'@objectstack/objectql': patch
---

Correct the last two source comments that justified a batch-level warning with the falsified premise "the strip is schema-uniform". Comment text only — no predicate, no accept set, no exported symbol and no emitted byte moves.

Maintainer ruling C (#14147) moved the static-`readonly` strip INSIDE `engine.insert`, after the `beforeInsert` hooks, where it exempts keys a hook itself assigned — armed per ROW (`hookWrittenKeys: rowHookWrittenKeys[i]`). Two rows in one batch can therefore lose different sets, so uniformity was never the reason the aggregation is sound.

The aggregation is unchanged and stays right on the reason the producer already has: a log line has no per-row slot, so the union of what the batch lost is the only view one line can represent. Both sites now say that and tell a reader how to read a name in the line — "at least one row lost this field", never "every row did".

- `packages/objectql/src/engine.ts` — the per-CALL `preserveAudit` warning at the static-`readonly` insert strip, 60 lines below the `hookWrittenKeys: rowHookWrittenKeys[i]` call that falsifies it.
- `packages/objectql/src/validation/rule-validator.ts` — the docblock of `preserveAuditIgnoredOnInsertWarning`, which contradicted its own file: both `hookWrittenKeys` option docs above it state the granularity as per ROW, never per call. The file now gives one answer.

Same class as the `packages/spec` and `packages/metadata-protocol` carriers corrected before it; with these two, no live source copy of the premise remains.
