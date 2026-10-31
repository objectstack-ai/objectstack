---
'@objectstack/spec': minor
'@objectstack/driver-sql': minor
'@objectstack/metadata-core': minor
---

feat(spec): a lookup field declares which fields a pick fills (`lookupAutofill`)

Clause-②: yes (widening)
Metadata-protocol: added

A single-value `lookup` / `master_detail` field can now declare `lookupAutofill`: a list of `{ target, source, overwrite? }` pairs. A pick in the lookup copies the picked record's `source` field (a field of the referenced object) into the record's `target` field. A quote line's product lookup declares `[{ target: 'unit_price', source: 'list_price' }]`, so the sales price can fill from the product as soon as the product is picked, instead of only after save.

- **The overwrite rule.** By default (`overwrite` absent or false), a pick never replaces a value somebody wrote. The target is filled only while it is empty or still holds the value an earlier pick filled in, so a typed value, or one the record already stored, stays. A pair that declares `overwrite: true` replaces the target on every pick.
- **One home for the form and the grid.** The declaration lives on the field, so the record form and a line-item grid column over the field both read it. The grid column key `autofill` is unchanged: it still governs only the grid's same-named copy, on by default. A declared pair takes its target out of that copy.
- **Client-side only.** It fills the form. Nothing on the write path reads it, so an import or API write that sets the lookup fills nothing.
- **Refused at parse:** the key on anything but a single-value relationship; a target that is the lookup itself, not a field of the object, `readonly`, computed (`formula`, `summary`, `autonumber`, or a field with an `expression`), or named twice; an unknown key in a pair.
- **Refused by `os validate` / `os build`** (`STACK_CROSS_REFERENCE_INVALID`): a source the referenced object does not declare, an `internal` source, and a source whose value the target cannot hold (the same type and multiplicity, a string into a plain text field, `number` and `currency` into each other, or a relationship over the same object).
- **Every-key tables classify the new key.** `@objectstack/driver-sql` classifies it `presentation` in `FIELD_KEY_STORAGE_CLASS`: no column DDL reads it. `@objectstack/metadata-core`'s field-level-security scrub (`FIELD_REFERENCE_POSITIONS`) drops a pair whose `target` is a field the caller cannot read, and deletes a list left empty. Each `source` names a field of the referenced object, which that object's own projection governs, so it is kept.

The form and grid that write the declared targets on pick ship in a follow-up. Until then the declaration is checked and stored, and fills nothing. Nothing to do for existing metadata.
