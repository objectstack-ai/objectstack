---
"@objectstack/objectql": patch
---

fix(objectql): a `readonlyWhen` lock is judged against the values the update STORES, not a value another `readonlyWhen` lock drops (#19911)

**What a caller could do before.** When one field's `readonlyWhen` read a field
that carries its own `readonlyWhen`, a caller with edit rights could change a
locked field by sending a new value for the other one in the same update. With
`status: { readonlyWhen: "previous.status == 'closed'" }` and `amount: {
readonlyWhen: "record.status == 'closed'" }`, `update(c1, { status: 'open',
amount: 999 })` on a CLOSED row committed `amount = 999`: `status` was dropped
by its own lock, but `amount` was judged against the dropped `'open'`, so the
row stayed closed with its frozen amount rewritten. The same happened on bulk
(`multi: true`) updates for every matched row, and for a master-detail field's
own `readonlyWhen` lock that reads such a field — the row moved to another
header although its lock held on the row it kept. `isSystem` callers were
affected too (a `readonlyWhen` lock binds them).

**What happens now.** Every `readonlyWhen` lock reads the update as it will be
stored: a value another lock drops is replaced by the row's stored value before
the lock is judged. In the example above `amount` is dropped as locked, exactly
as `update(c1, { amount: 999 })` on its own always was. Values a `beforeUpdate`
hook wrote are still stored and read as before.

**What else you may see move, all in the same direction (the stored values
decide):**

- The reverse: a value that WOULD lock another field no longer locks it when
  its own lock drops it. With `status` frozen by `previous.frozen == true`,
  `update(r, { status: 'closed', amount: 999 })` now stores the amount (the row
  stays open, so its amount is unlocked); before, the amount was dropped too.
- `onFieldsDropped` reports every dropped field in the one `readonly_when`
  event, and a `strictReadonlyWrites` refusal names the fields the update would
  have dropped; it was a refusal before and still is.
- `requiredWhen` and validation rules run on the stripped update, so they see
  the amount the row keeps: a requirement only the dropped-through amount raised
  no longer refuses the write, and clearing a field the kept amount requires is
  now refused (`VALIDATION_FAILED`).
- When locks read each other in a cycle, so that no set of drops agrees with
  the stored row, every lock involved holds: the fields are dropped, never
  written.
- A master-detail field whose own lock reads `record`, on an object where
  another field in the update has a `parent`-scoped lock, now reads the named
  header before deciding whether the row moves: one more header read when it
  does not.
