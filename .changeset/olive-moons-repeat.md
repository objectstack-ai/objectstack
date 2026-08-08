---
'@objectstack/objectql': patch
---

fix(objectql): the insert-path runtime-owned strip now drops the value the CALLER submitted, not whatever value the key holds when it runs

`stripRuntimeOwnedFields` runs after `beforeInsert`, but decided what to delete
from a snapshot of the caller's KEY NAMES. Those are different facts the moment a
hook writes to a runtime-owned column: `delete result[name]` took the hook's
value with it whenever the caller's payload happened to carry the same key. The
insert-side twin of the update-path defect fixed in the previous release, and
wrong for the identical reason.

Measured, one object `{ title: text, code: autonumber }` and one `beforeInsert`
hook assigning `ctx.input.data.code`:

- the caller omits `code` — the committed record holds the hook's value
- the caller sends `code` — the committed record holds `"1"`, the sequence value,
  because the hook's write was deleted

The two calls differ in nothing but whether the caller's payload happened to
carry a same-named key, and the first outcome is what the strip's own warning
text promises every hook author: "A beforeInsert/beforeUpdate hook does NOT need
either — hook-written keys are not caller-supplied." So this brings the code to
its own documented contract. Behaviour change — a whole-record POST (read a
template, edit fields, submit everything back) necessarily echoes the record
number it just read, so a hook that re-issues or normalizes that number no longer
loses its write to the sequence.

The entry snapshot now carries the caller's values — as an explicit shallow copy
taken ahead of the hooks, so a hook mutating `ctx.input.data` in place cannot
rewrite the record of what the caller sent — and a runtime-owned key is stripped
only while it still holds the caller's own value.

Not a relaxation of the runtime-owned write rule: a caller-seeded record number
that no hook overwrote is dropped exactly as before, on both the single-row and
batch insert paths, with the same warning, the same `onFieldsDropped` event and
the same `strictReadonlyWrites` refusal. `isSystem` and `preserveAudit` are
untouched. The comparison is `Object.is`, so a caller-forged `NaN` is still
recognised as the caller's own value and dropped.
