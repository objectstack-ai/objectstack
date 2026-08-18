---
"@objectstack/objectql": patch
---

fix(engine): `cascadeDeleteRelations` probes a `multiple: true` reference field with a spelling its storage can answer, so REST DELETE stops returning 400 for every object such a field points at (#9362)

Any object pointed at by any registered `multiple: true` `lookup` /
`master_detail` field had its data-plane delete refused outright:

```
POST   /api/v1/data/showcase_account  {"name":"anything","status":"active"} -> 201
DELETE /api/v1/data/showcase_account/<id>                                   -> 400 INVALID_FILTER
```

On the stock showcase that is `showcase_account`, because
`showcase_field_zoo.f_lookups` is `Field.lookup('showcase_account', { multiple: true })`.
The fault is **schema-driven, not data-driven** — the dependents probe runs once
per DECLARED relation, so emptying the referring table changes nothing.

**Mechanism.** The probe built a bare-equality filter for every reference field
aimed at the object being deleted, including the multi-value ones. A
`multiple: true` field stores an array, which every SQL backend here puts in a
JSON TEXT column, so bare equality compares the whole serialization (`["a","b"]`)
against one id and can never hold. `driver-sql` refuses that spelling
(`INVALID_FILTER` / 400) rather than compiling a silently wrong answer.

**Neither of the two correct behaviours around it was touched.** The driver's
refusal stays — it is right, and loosening it would restore the fail-both-ways
comparison it exists to stop. The discriminate-or-propagate `catch` that
surfaces a probe failure instead of inventing "no dependents" stays too: the
probe's filter spelling was never correct, and that tightening only turned a
silent wrong answer into a loud one.

**The fix is at the probe's construction site, and nowhere else.** A multi-value
field is asked with `$contains` — the membership spelling the refusal itself
prescribes, and the one every driver here answers (`driver-sql` and the two
drivers extending it lower it to `LIKE '%v%'` over the serialization,
`driver-mongodb` and `driver-memory` to a `$regex` that matches per element). No
filter or predicate surface is widened: `$contains` was already declared, and the
single-valued probe is byte-identical to what it was.

`$contains` is a SUBSTRING test, so on every one of those backends the pushdown
answers a **superset** — with ids `acc_1` and `acc_10`, a row holding `acc_10`
matches a probe for `acc_1`. The rows are therefore narrowed exactly afterwards,
element-wise, the same reading the dangling-reference audit already applies to a
stored reference. Without that half the fix would make `cascade` delete and
`set_null` clear rows that never referenced the record — worse than the 400. An
id needing JSON escaping is asked for in both stored spellings, so the guard
cannot fail open on it either.

Both directions are pinned, against a driver double that reproduces the JSON
column refusal and against a real `SqlDriver` on better-sqlite3 driven through
the real data-plane delete: the delete succeeds and the row is gone, a live
dependent through the array still refuses with `DELETE_RESTRICTED` / 409, and an
id that is a prefix of another neither inherits its dependents nor loses its own.

## Shipping with it: a TEMPORARY refusal on `set_null` over a multi-value reference

Maintainer-ruled to land in the same change, and **explicitly a holding position
rather than a semantic**: while a `multiple: true` reference field would take the
`set_null` limb, the delete is now refused (`DELETE_RESTRICTED` / 409) instead of
executed.

Repairing the probe is what would make that limb run for the first time in this
codebase — before #8895 the probe swallowed its own failure and skipped the
relation, after #8895 it raised `INVALID_FILTER` and aborted the delete — and the
limb writes `null` over the WHOLE array, discarding every other member. Measured
on the real stack: a row holding `["acc_a","acc_b"]` re-reads as `null` once
`acc_a` is deleted.

The right semantics is "remove just the deleted member", but the residual shape
when the array empties (`[]` or `null`) is observable on the read path and to a
required multi-value validator, and nothing in `FieldSchema` pins it. That
question is tracked in objectstack#9438; refusing loudly until it is answered
decides nothing and reverts in one `if`, while writing would decide it by
accident and cannot be undone for the rows it touched.

**Scope of the refusal, and what it deliberately leaves alone.** It is the
required-FK escalation directly above it, applied to an adjacent case: the same
`behavior` reassignment, reading the same `behavior === 'set_null'`. Because
`fdef.deleteBehavior || 'set_null'` collapses an absent declaration and an
explicitly authored `set_null` into one value, both are covered — the same way
both are already covered by the required-FK escalation, and without adding a
distinction the existing shape does not make. An explicit `cascade` or `restrict`
is untouched, a single-valued `set_null` still clears its foreign key, and a
relation with no dependent rows still deletes: only the disposition changes, so
the P0 above genuinely closes for every other path.

**No new wire code**, per the rule `operation-message.ts` already states for this
envelope — one `DELETE_RESTRICTED` with more than one sentence, splitting the
sentence and never the code. The reason is developer-facing, so it rides
`developerMessage`, which names the refusal as temporary and cites the tracking
issue literally so removing this is one grep. The business message a user reads is
unchanged, because their action is unchanged: clear or reassign the referencing
records.
