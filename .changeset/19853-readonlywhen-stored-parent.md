---
"@objectstack/objectql": patch
---

fix(objectql): a parent-scoped `readonlyWhen` lock is judged against the invoice a line STAYS under, not the one the update names (#19853)

**What a caller could do before.** On a master-detail child whose parent field
is read-only, a caller with edit rights could change a field locked by a
`parent`-scoped `readonlyWhen` by naming a different, unlocked parent in the
same update. With `amount: { readonlyWhen: "parent.status == 'paid'" }` and a
`readonly: true` `invoice` field, `update(line, { amount: 999, invoice:
'open_invoice' })` on a line of a PAID invoice committed `amount = 999`: the
lock was judged against the open invoice the payload named, then the read-only
`invoice` was stripped, so the line stayed under the paid invoice with its
frozen amount rewritten. The same happened when the parent field carried a
`readonlyWhen` lock of its own that kept the line where it was, and on bulk
(`multi: true`) updates for every matched row.

**What happens now.** The engine settles whether the update really moves the
line BEFORE it judges any `parent`-scoped lock, and judges every lock against
the parent the row is stored under afterwards. In the example above `amount` is
dropped as locked, exactly as `update(line, { amount: 999 })` on its own always
was. A legitimate move — the parent field writable, or an `isSystem` /
`preserveAudit` write the read-only strip exempts — is still judged against the
parent it moves to, unchanged.

**What else you may see move, all in the same direction (the parent the row is
stored under decides):**

- Naming a LOCKED parent beside a read-only parent field no longer locks a line
  that stays under an open one — its field now commits.
- `requiredWhen` reads the same parent binding, so a `parent`-scoped requirement
  is also judged against the parent the row stays under: clearing a required
  field on a paid line by naming an open parent is now refused
  (`VALIDATION_FAILED`), and naming a paid parent beside a read-only parent
  field no longer refuses an open line.
- `onFieldsDropped` now reports the locked field (`readonly_when`) beside the
  parent field (`readonly`), and a `strictReadonlyWrites` refusal names both.
- When the parent field carries its own `readonlyWhen`, that lock is still
  judged against the parent the update names, as before.
