---
'@objectstack/spec': minor
'@objectstack/objectql': minor
'@objectstack/service-automation': patch
---

feat(objectql): a caller value that a stored field's `expression` replaced is reported through `onFieldsDropped` / `droppedFields` under the new `DroppedFieldsEvent.reason` value `stored_expression`

Clause-②: yes (widening)

The engine computes a stored (non-`formula`) field's declared `expression` on every write, so a value the caller sends for such a field never stands. Until now nothing said so. `onFieldsDropped` stayed silent, so the PATCH and `/batch` doors answered with no `droppedFields`, and a flow's `update_record` reported success over a row that holds the computed value instead of the one sent.

- **New `reason` value.** `DroppedFieldsEventSchema.reason` (`@objectstack/spec/data`) gains `stored_expression`. It means the field is a stored column the engine computes from its `expression`, and the caller's value was replaced by the computed one. The field IS written, so `computed` (a `formula` with no column, whose key is dropped) would be wrong for it. The four existing values are unchanged.
- **When it is reported.** On insert (single, batch, and `insertMany`'s per-row `droppedFields`), on update by id, and on a predicate update, in every context, `isSystem` included. It is reported only when the caller sent the field and the value stored differs from the caller's value. A client that sends the computed value (the console's line-item grid) or no value is told nothing. A value another strip already took, such as a stored expression field that is also `readonly`, is reported once, under that strip's reason.
- **`strictReadonlyWrites` is unchanged.** The maintainer's ruling 「甲」 says only the loud half ships in 18.x. A strict write whose value for such a field differs from the computed one is NOT refused: it completes with the computed value, and the replacement is reported through `onFieldsDropped` under strict as well. A refusal is runtime behaviour that no conversion can carry, so the strict refusal of a `stored_expression` replacement is deferred to 19.0. A strict write that also carries a refusable drop (`readonly`, `readonly_when`, `primary_key`, `computed`) is refused as before, for those drops only, and fires no listener.
- **Flow step warning.** `@objectstack/service-automation` words the new reason. Its warning says the requested value(s) were not stored, rather than that the field was not written, and its closing sentence says the write succeeded with the computed value(s).

**For consumers that branch on `reason`.** A `Record<DroppedFieldsEvent['reason'], …>` table fails its typecheck until it has a `stored_expression` row. That is the intended signal: add the row. A client running behind the server should treat a reason it does not recognise as "not applied", never as one of the known reasons.
