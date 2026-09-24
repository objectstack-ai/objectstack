---
"@objectstack/objectql": patch
---

fix(objectql): a value one `readonlyWhen` lock drops can no longer unlock another `readonlyWhen` lock (#19911)

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

**What happens now.** A value one `readonlyWhen` lock drops can no longer
unlock another: no field is written while its `readonlyWhen` is TRUE on the row
the update stores. The locks are judged together, again with each dropped
value put back to the row's stored one, until no further field locks. Then the
fields held only by a value that was later put back are released, and every
lock is judged again against what that release stores, round after round,
until the dropped fields are exactly the ones locked on the row the update
stores; after one round more than the caller sent fields carrying a
`readonlyWhen`, the first, larger set of drops stands instead. In the example
above `amount` is dropped as locked, exactly as `update(c1, { amount: 999 })`
on its own always was. Values a `beforeUpdate` hook wrote are still stored and
read as before.

**What else you may see move:**

- The reverse: a value that WOULD lock another field no longer locks it when
  its own lock drops it. With `status` frozen by `previous.frozen == true`,
  `update(r, { status: 'closed', amount: 999 })` now stores the amount (the row
  stays open, so its amount is unlocked); before, the amount was dropped too.
- `onFieldsDropped` reports every dropped field in the one `readonly_when`
  event, and a `strictReadonlyWrites` refusal names the fields the update would
  have dropped; it was a refusal before and still is.
- `requiredWhen` and validation rules run on the stripped update, so they see
  the amount the row keeps: a requirement only the let-through amount raised
  no longer refuses the write, and clearing a field the kept amount requires is
  now refused (`VALIDATION_FAILED`).
- A field whose own lock is FALSE on the stored row can still be dropped, but
  only where locks read each other in a cycle (a `parent`-scoped lock counts
  as reading the master-detail field, which picks the header). Without such a
  cycle the update drops exactly the caller's fields whose lock is TRUE on the
  row it stores (on a bulk update, on at least one matched row). In a cycle,
  no set of drops may agree with the stored row: with `a` locked by `record.b
  == 'x'` and `b` by `record.a == 'old_a'`, `update(r, { a: 'new_a', b: 'x'
  })` on a row `{ a: 'old_a', b: 'y' }` drops both, although `a` is unlocked
  on the row it stores. A cycle can also have more than one set that agrees:
  with `a` locked by `record.b == 'new_b'` and `b` by `record.a == 'new_a'`,
  `update(r, { a: 'new_a', b: 'new_b' })` on a row holding neither new value
  would agree with the row by dropping either one, and it drops both. Some
  other updates with two such sets store one of them. Where the drops do not
  settle, the first, larger set stands: a lock the update cannot settle is
  not waived.
- A master-detail repoint that the field's own `record`-scoped lock used to
  hold can now land. Its lock is judged together with the other locks on the
  header the update names, so when the value that lock reads is itself locked
  under that header, the value is dropped, the repoint lands, and the edit is
  dropped under the header the row lands on. With `invoice: { readonlyWhen:
  "record.amount == 'big'" }` and `amount: { readonlyWhen: "parent.status ==
  'paid'" }`, `update(line, { invoice: 'inv_a', amount: 'big' })` on a line
  under an open invoice, naming a paid one, used to keep the line where it was
  and store `amount: 'big'` (`onFieldsDropped` reported `invoice`); it now
  moves the line onto the paid invoice and keeps its old amount
  (`onFieldsDropped` reports `amount`), by id and on bulk updates. A
  `strictReadonlyWrites` refusal of that write now names `amount` instead of
  `invoice`. Both outcomes agree with the locks on the row they store.
- A master-detail field whose own lock reads `record`, on an object where
  another field in the update has a `parent`-scoped lock, now reads the named
  header before deciding whether the row moves: one more header read when it
  does not.
