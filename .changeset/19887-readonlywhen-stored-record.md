---
"@objectstack/objectql": patch
---

fix(objectql): a record-scoped `readonlyWhen` lock is judged against the values the update STORES, not a read-only value the caller forged (#19887)

**What a caller could do before.** A caller with edit rights could change a
field locked by a `record`-scoped `readonlyWhen` by putting a forged value for
a statically `readonly` field in the same update. With `amount: { readonlyWhen:
"record.status == 'closed'" }` and a `readonly: true` `status`,
`update(ticket, { status: 'open', amount: 999 })` on a CLOSED ticket committed
`amount = 999`: the lock was judged against the forged `status: 'open'`, then
the read-only `status` was stripped, so the ticket stayed closed with its frozen
amount rewritten. The same happened through a read-only master-detail field
read as `record.invoice`, on bulk (`multi: true`) updates for every matched
row, and for a parent field's own `readonlyWhen` lock that reads a read-only
field.

**What happens now.** The lock reads the update as it will be stored: a value
the read-only strip removes is replaced by the row's stored value before any
`readonlyWhen` predicate is evaluated. In the example above `amount` is dropped
as locked, exactly as `update(ticket, { amount: 999 })` on its own always was.
Where the read-only strip keeps the value (an `isSystem` caller, a
`preserveAudit` write of a preservable field, a value a `beforeUpdate` hook
wrote), the value is stored, and the lock reads it as before.

**What else you may see move, all in the same direction (the stored values
decide):**

- Forging a LOCKING value for a read-only field (`status: 'closed'` on an open
  ticket) no longer locks the other fields — they now commit.
- `onFieldsDropped` now reports the locked field (`readonly_when`) before the
  read-only one (`readonly`), and a `strictReadonlyWrites` refusal names both;
  it was a refusal before and still is.
- A field that is both `readonly: true` and `readonlyWhen`-locked may now be
  reported as `readonly_when` instead of `readonly` when its own predicate reads
  a forged value; it is dropped either way.
- `requiredWhen` and validation rules run on the stripped update, so they now
  see the amount the row keeps: a requirement only the forged-through amount
  raised no longer refuses the write, and clearing a field the kept amount
  requires is now refused (`VALIDATION_FAILED`).
