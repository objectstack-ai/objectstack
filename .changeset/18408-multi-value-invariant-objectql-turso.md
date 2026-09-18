---
'@objectstack/objectql': patch
'@objectstack/driver-turso': patch
---

fix(objectql,driver-turso): "is this field multi-valued" is `isMultiValueField` here too — the `domain:engine` half of the one-definition ruling (#18408)

Maintainer ruling, 2026-09-13 (decision batch #128 item 5, option 1′): there is
ONE definition of 「is this field multi-valued」, `@objectstack/spec`'s
`isMultiValueField`, and storage follows it. `driver-sql` was aligned by #17469
and `os generate migration` by #18199. These four sites were the remainder: they
read `field.multiple` raw, which answers `true` on types the predicate calls
single-valued (`text`, `master_detail`, `tree`, `number`, …) and `false` on the
inherently-multi option types (`multiselect` / `checkboxes` / `tags`) that carry
no flag at all.

**`@objectstack/driver-turso`** — `RemoteTransport.mapFieldTypeToSQL` short-
circuited its whole type switch on the raw flag, so a `{ type: 'number',
multiple: true }` field was declared `TEXT` in remote mode while the SAME
driver's local transport (`SqlDriver`, aligned since #17469) declared `float`:
one declaration, two storage classes, chosen by which URL the deployment
happens to hold. New columns for such a field are now declared by the field's
own type. Genuinely multi-valued fields (`lookup` / `select` / `file` / `image`
/ `user` flagged `multiple`, and the inherently-multi option types with or
without it) are unchanged — still the JSON-array `TEXT` column.

**`@objectstack/objectql`** — three sites, all deciding the SHAPE of a stored
value:

- the option-derived insert default (`resolveOptionDefault`) assembles an array
  for a multi-valued field. A `multiselect` / `checkboxes` / `tags` field with an
  option marked `default: true` and no `multiple` flag was defaulted to a bare
  scalar, which this engine's own validator then refused as
  `invalid_type_array` on the insert the default was resolved for;
- the referential-integrity dependents probe (`referenceProbeFilter`) composes
  `$contains` for a multi-valued reference and bare equality for a scalar one. A
  `master_detail` flagged `multiple` is outside `MULTI_CAPABLE_TYPES`, so every
  aligned storage side builds it a scalar column — the probe now asks that column
  the question it can answer, instead of a substring match repaired afterwards by
  a second narrowing pass;
- the cascade-delete `multiValued` verdict, which that probe, the `set_null`
  write shape and the required-FK escalation all read.

**What a deployment feels.** Only declarations that are already off-spec move:
`FieldSchema` has refused `multiple` on a non-capable type since #17469 (ADR-0087
semantic entry 18), so these shapes now reach the engine and the driver only
through doors that never run it — `registerExternalObject` / `initObjects` and a
driver's own unvalidated input. Existing columns are untouched: the remote
transport only ever declares types for columns it is creating. A deployment
holding one of these shapes should re-declare the field — drop the flag if the
value really is single, or move the field to a multi-capable type if it is not —
which is the same prescription entry 18 already carries.

No export is added, removed or renamed in either package, and no authorable key
changes its name, type or optionality.
