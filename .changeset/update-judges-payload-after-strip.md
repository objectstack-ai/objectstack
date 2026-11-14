---
'@objectstack/objectql': patch
---

fix(objectql): an update judges and stores the payload left after the fields the caller may not write are removed

Clause-②: no
Metadata-protocol: none

An update now takes the fields the caller may not write (a static `readonly` field, a field whose `readonlyWhen` holds) out of the payload first, and only then puts each remaining multi-valued field into its stored list form and checks the remaining values. That is the order the insert path already uses, on the by-id path and the bulk path alike. A `readonlyWhen` lock on a multi-valued field now holds whatever form the caller writes the value in. A `readonlyWhen` predicate still reads multi-valued fields in their stored list form.

One visible change: a value on a field whose `readonlyWhen` holds is removed before the value check runs. A malformed value there is now dropped and reported through `onFieldsDropped` (or refused under `strictReadonlyWrites`), where it used to fail the whole update with `VALIDATION_FAILED`. Values on writable fields are checked exactly as before.
