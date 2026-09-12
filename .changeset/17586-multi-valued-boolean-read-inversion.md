---
'@objectstack/driver-sql': patch
---

A `multiple: true` boolean/toggle column reads back as its stored array, not as a single inverted `true`

`formatOutput` runs its `jsonFields` pass first, which `JSON.parse`s the cell
into a real array, and then its `booleanFields` pass did
`data[field] = Boolean(data[field])`. Every non-empty array is truthy, so a
`multiple: true` `boolean`/`toggle` column presented a single `true` whatever
the array held — a stored `[false]` read back as **`true`**, the opposite of
what is stored, with no error anywhere. `readPresentationKind` hands the same
presenter to the `aggregate()` / `distinct()` doors, so the collapse was not
confined to the row-read door.

**Fixed at the registry fill.** `&& !field.multiple` is the condition the three
neighbouring pushes in both registration blocks already carry (`mediaCols`,
`numericCols`, `numericValueCols`); `booleanCols.push(name)` was the single
omission, in **both** fills (`registerExternalObject` and
`registerManagedObjectMetadata`). A `multiple: true` boolean/toggle is a JSON
column here, and its array is written faithfully — only the read collapsed it.

**What moves for a caller.** A `find()` / `aggregate()` / `distinct()` read of a
`multiple: true` `boolean` or `toggle` column now returns the stored array of JS
booleans (`[false]`, `[true, false]`) where it previously returned `true`. Code
that consumed the old scalar was reading a value that did not reflect storage —
including for an all-`false` array. Scalar `boolean`/`toggle` columns are
unchanged and keep their stored-`1`/`0` → JS `true`/`false` coercion; the
`multiple: true` number and `tags` classes were already correct and do not move.
