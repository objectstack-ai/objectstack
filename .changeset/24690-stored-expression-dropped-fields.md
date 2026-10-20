---
'@objectstack/spec': minor
'@objectstack/objectql': minor
'@objectstack/service-automation': patch
---

feat(objectql)!: a caller value that a stored field's `expression` replaced is reported through `onFieldsDropped` / `droppedFields` under the new `DroppedFieldsEvent.reason` value `stored_expression`

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) A narrowing of what a `strictReadonlyWrites` write is accepted as, plus one value added to an output enum. Nothing an author or a caller can write is removed, renamed or re-shaped: `DroppedFieldsEventSchema.reason` gains `stored_expression` and keeps its four values, so there is no tombstone and nothing for `objectstack migrate meta` to rewrite. The other categories are closed on facts: all three packages publish (not unpublished); no ADR-0087 id covers this behaviour and this diff adds none (not registered or already-registered); and the change is a write-path behaviour, not only an interface or type change (not runtime-interface-only or type-surface-only). -->

**BREAKING** accept-set narrowing for `strictReadonlyWrites` callers only, shipped as `minor` under the launch-window convention for breaking changes.

Since the engine computes a stored (non-`formula`) field's declared `expression` on every write, a value the caller sends for such a field never stands. Until now nothing said so: `onFieldsDropped` stayed silent, so the PATCH and `/batch` doors answered with no `droppedFields`, and a flow's `update_record` reported success, over a row that holds the computed value instead of the one sent.

- **New `reason` value.** `DroppedFieldsEventSchema.reason` (`@objectstack/spec/data`) gains `stored_expression`: the field is a stored column the engine computes from its `expression`, and the caller's value was replaced by the computed one. The field IS written, so `computed` (a `formula` with no column, whose key is dropped) would be wrong for it. The name follows the existing arms, which name the field's role, not what happened to the value.
- **When it is reported.** On insert (single, batch, and `insertMany`'s per-row `droppedFields`), on update by id, and on a predicate update, in every context, `isSystem` included. Only when the caller sent the field and the value stored differs from the caller's value. A client that sends the computed value (the console's line-item grid) or no value is told nothing. A value another strip already took, such as a stored expression field that is also `readonly`, is reported once, under that strip's reason.
- **`strictReadonlyWrites`.** Its coverage is every reason `onFieldsDropped` reports, so a strict write whose value for such a field differs from the computed one is now **refused** with `ERR_READONLY_FIELD_REJECTED`, and nothing is written. Before this change it succeeded and the value was silently replaced. A strict write that sends the computed value, or none, is not affected.
- **Flow step warning.** `@objectstack/service-automation` words the new reason. Its warning says the requested value(s) were not stored, rather than that the field was not written, and its closing sentence says the write succeeded with the computed value(s).

**For consumers that branch on `reason`.** A `Record<DroppedFieldsEvent['reason'], …>` table fails its typecheck until it has a `stored_expression` row. That is the intended signal: add the row.

**Fix.** Nothing, if your client sends the computed value or none. Under `strictReadonlyWrites`, leave the field out of the payload or send the value its expression computes.
