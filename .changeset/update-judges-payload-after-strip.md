---
'@objectstack/objectql': patch
---

fix(objectql): an update's multi-value wrap and first value check run on the payload left after the read-only strips

Clause-②: no
Metadata-protocol: none

An update now takes out of the payload the fields a read-only strip removes (a static `readonly` field, a runtime-owned field, a field whose `readonlyWhen` holds). Only after that does it put each remaining multi-valued field into its stored list form and run the first value check on what is left. The insert path already uses this order. It now applies on the by-id path and the bulk path alike. A `readonlyWhen` predicate still reads multi-valued fields in their stored list form.

What callers see: a value on a field that either read-only strip removes is no longer checked. A malformed value there is now dropped and reported through `onFieldsDropped`, or refused under `strictReadonlyWrites`. Before this change it failed the whole update with `VALIDATION_FAILED`. Values on writable fields are checked exactly as before.

The update-mode validation preview does not run this order. For such a field it can therefore refuse a row that the update now accepts. For that field the preview is stricter than the update, which is the safe direction.
