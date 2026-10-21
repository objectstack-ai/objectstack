---
'@objectstack/objectql': minor
---

fix(objectql)!: under `strictReadonlyWrites`, a write whose value a stored field's `expression` replaces (`stored_expression`) is refused, and nothing is written

Clause-②: no (narrowing: under `strictReadonlyWrites`, a write whose value a stored expression replaces is refused instead of reported; it ships now under the amended 「甲」, #6015 `6303865025`)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition, stored shape or exported declaration is added, removed, renamed or narrowed, and no stored row is read, rewritten or converted, so there is nothing for `objectstack migrate meta` to rewrite. What changes is the answer the engine gives an in-process caller that opts into `strictReadonlyWrites` and sends a value a stored expression then replaces: that write is refused where it completed and was reported. The remedy is the caller's own payload (leave the field out, or send the computed value), which no ledger entry can derive. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (the strict mode's refusal set grows by one reason), shipped as `minor` under the amended ruling 「甲」: a narrowing that no conversion carries ships now, in 18.x. It applies only to a caller that opts into the in-process `strictReadonlyWrites` option. No REST or wire caller can set that option, and every write without it behaves exactly as before.

`strictReadonlyWrites` refuses every drop that `onFieldsDropped` reports. Since the `stored_expression` reason landed, one reported drop was left out: a caller's value for a stored (non-`formula`) field that declares an `expression`, which the engine replaces with the computed value. Under strict, such a write completed and was only reported. It is now refused like every other strip's drop.

- **FROM:** a write with `strictReadonlyWrites: true` that sent a value for a stored expression field, different from the value the engine computes, completed. The row held the computed value, and `onFieldsDropped` received a `stored_expression` event.
- **TO:** the same write throws `ReadonlyFieldRejectedError` (`code: 'ERR_READONLY_FIELD_REJECTED'`), whose `drops` carries the `stored_expression` event. Nothing is written, and `onFieldsDropped` does not fire. This holds on insert (a single row, a batch, and `insertMany`, which refuses the whole call as it does for the other strict drops), on update by id, and on a predicate update.
- **One refusal names everything.** When the same payload also carries another strip's drop (`readonly`, `readonly_when`, `primary_key`, `computed`), the one refusal names all of them together, `stored_expression` last. Before, such a write was refused for the other drops alone. The message's per-reason form gains a `stored_expression` remedy, spoken only when that reason is present, so every other refusal's message is unchanged.
- **Unchanged:** a strict write that sends the computed value, or no value for the field, is not refused, because nothing it sent was replaced. A stored expression field also declared `readonly` is still refused once, as `readonly`. Without `strictReadonlyWrites`, the write completes with the computed value and the replacement is reported, as before. The error code is unchanged.
- **The fix for a strict caller:** leave the stored expression field out of the payload, or send the value its expression computes. To let the replacement happen and merely observe it, drop `strictReadonlyWrites` and pass `onFieldsDropped`.

This supersedes the `strictReadonlyWrites` bullet of the `stored_expression` reason's entry, which deferred this refusal to a later major.

Measured before the change: no non-test caller in this repository passes `strictReadonlyWrites` (the examples, dogfood suites and runtime doors pass none), so no in-repo producer moves.
