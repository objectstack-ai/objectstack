---
"@objectstack/objectql": patch
---

fix(objectql): the read-only strip's warning stops promising a commit that `strictReadonlyWrites` refused, and offers `preserveAudit` only where it works (#8214)

Two claims `readonlyStripWarning` (and its insert-side twin
`runtimeOwnedStripWarning`) were making were not true of the call in front of
them. The level is unchanged — both lines stay at `warn`, so real forgery
attempts stay visible — and both still name the field, the consequence and a
remedy.

**1. "COMMITTED WITHOUT IT" under `strictReadonlyWrites`.** The strip logs from
inside `stripReadonlyFields` / `stripRuntimeOwnedFields`, while the refusal
throws afterwards and before any driver call. A strict caller was told in prose
that the write had been committed without the field while nothing had been
written at all — a reader debugging from the log alone went hunting for a row
that was never touched. Measured on a real `ObjectQL` plus a recording driver:

| | refused code | driver writes | warn lines | claimed a commit |
|---|---|---|---|---|
| update, strict | `ERR_READONLY_FIELD_REJECTED` | 0 | 1 | yes |
| insert, strict | `ERR_READONLY_FIELD_REJECTED` | 0 | 1 | yes |

The strip now learns the flag and reports the refusal instead — naming
`ERR_READONLY_FIELD_REJECTED`, and pointing at dropping `strictReadonlyWrites`
rather than at `onFieldsDropped`, which is the remedy that applies in that mode.
Default (non-strict) writes are byte-identical: there the commit really happens,
and the sentence was always true.

**2. The remedy named `isSystem` but never `preserveAudit`.** `stripReadonlyFields`
honours `context.preserveAudit`, a whitelist narrower than `isSystem` by
construction, but the message offered only the blanket exemption — so an import
that forgot the flag was steered to the strictly worse posture. The narrower
remedy is now offered **per field, derived from the same predicate the strip
consults**, never from a prose description of the whitelist: a field the flag
would really have kept gets the sentence, and a non-audit `system` column such
as `organization_id` — which `preserveAudit` strips anyway — does not.

The write's own address still logs nothing (#8141), in strict mode as well.
