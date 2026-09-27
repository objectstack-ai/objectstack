---
"@objectstack/objectql": patch
---

fix(objectql): a `readonlyWhen` cycle no longer makes an update ignore edits to fields outside it (#19929)

**What happened before.** When an update wrote fields whose `readonlyWhen`
locks read each other in a cycle whose drops did not settle, it gave up
settling the drops for the whole update and kept the first, larger set of
drops for every field. It could then ignore an edit to a field in no cycle
whose own lock was FALSE on the row it stored. With `c: { readonlyWhen:
"previous.c == 'L'" }`, `x: { readonlyWhen: "record.c == 'open'" }`, `y: {
readonlyWhen: "record.x == 'xv'" }`, `a: { readonlyWhen: "record.b == 'x'" }`
and `b: { readonlyWhen: "record.a == 'old_a'" }`, `update(r, { c: 'open', x:
'xv', y: 'yv', a: 'new_a', b: 'x' })` on a row `{ c: 'L', a: 'old_a', b: 'y' }`
ignored all five fields. The row keeps `c: 'L'`, so `x`'s lock is FALSE there,
yet its edit was lost, and a `strictReadonlyWrites` refusal named `x`. The same
happened beside a cycle that two sets of drops agree with, such as `a: {
readonlyWhen: "record.b == 'new_b'" }` and `b: { readonlyWhen: "record.a ==
'new_a'" }` written with `a: 'new_a', b: 'new_b'` on a row holding neither new
value.

**What happens now.** A lock is judged after the locks whose fields it reads,
locks that read each other in a cycle are judged together, and the fallback to
the first, larger set of drops applies only to the fields of the cycle whose
drops do not settle. The update above stores `x: 'xv'` and ignores `c`, `y`,
`a` and `b`. A field whose lock is in no such cycle is ignored exactly when its
lock is TRUE on the row the update stores (on a bulk update, on at least one
matched row); a `parent`-scoped lock counts as reading the master-detail field,
which picks the header. This holds by id and on bulk (`multi: true`) updates,
and for `isSystem` callers. It holds for a master-detail field's own lock too:
with `c` locked by `previous.c == 'L'`, the master-detail `invoice` by
`record.c == 'open'`, `y` by `record.invoice == 'h_open'` and `amt` by
`parent.status == 'paid'`, an update setting all four and `a`/`b` above, on a
line with `c: 'L'` under a paid invoice, used to keep the line there, store `y`
and ignore the other five fields; it now moves the line to `h_open`, stores
`amt`, and ignores `c`, `y`, `a` and `b`.

**What else you may see move:**

- A lock that reads a cycle's field is judged against the value the cycle's
  drops leave on the row. With `z: { readonlyWhen: "record.a == 'new_a'" }`
  beside the cycle `a`/`b` above, `update(r, { a: 'new_a', b: 'x', z: 'zv' })`
  used to ignore `z` too; it now stores `z: 'zv'`, because the row keeps `a:
  'old_a'`. A lock reading `record.a == 'old_a'` there is still ignored.
- A cycle that more than one set of drops agrees with can now reach a
  different one of those sets than before, or keep its first, larger set of
  drops where it used to reach one. Which it reaches now depends only on the
  cycle's own locks and the fields they read, never on the other locks in the
  update.
- A lock whose predicate reads `record` other than as `record.<field>` (for
  example `record['b']` or `size(record)`) counts as reading every field the
  update writes.
- `onFieldsDropped` reports only the fields the update ignored, and a
  `strictReadonlyWrites` refusal names only those. Whether a write is refused
  under that option does not change.
