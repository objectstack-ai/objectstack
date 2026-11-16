---
'@object-ui/fields': patch
'@object-ui/plugin-form': patch
'@object-ui/plugin-grid': patch
'@objectstack/spec': patch
---

feat(fields): the lookup picker reads `{ $record }` lookupFilters values from the record being edited and sends `orEmpty`

Clause-②: no
Metadata-protocol: none

A `lookupFilters` entry may compare a candidate column with a value of the record being edited, written `{ $record: 'quote_date' }` or, one lookup hop away, `{ $record: 'account.cb_market' }`, and may add `orEmpty: true` so a candidate whose column is null also matches. The schema has accepted both since the previous release; the lookup picker now honours them.

- **The value.** Before the candidate query leaves the browser, the picker puts the value the reference names in its place: the quick-select popover, the table picker and the search-first people picker all send it. A one-hop path reads the lookup's target row once per id, its hop fields alone, unless the record already holds that row expanded. The query waits for that read and goes out once, with the value in it.
- **An empty value.** While the referenced value is empty (null, unset, an empty string, or an unset hop lookup) or cannot be read (the hop's row or field does not come back, no object is named for the hop, or the host has no single-row reader), the entry is left out, the rule an unset `dependsOn` parent follows. A reference that was never resolved is never sent.
- **Re-query.** Changing a referenced field re-queries the open picker once, with the new value. Changing any other field of the record does not.
- **orEmpty.** An entry with `orEmpty: true` is sent as an `$or` of its comparison and a null match on the same column. Several such entries each keep their own alternative.
- **Record forms opt in.** `ObjectForm` and authored form sections stamp such a lookup as drawn for a single record being edited, naming the object each hop's lookup points at (`withRecordBeingEdited`, exported from `@object-ui/fields`), through the spec's `referenceTargetOf`, so a hop through a `user` field, whose target the type fixes, resolves too. The picker resolves `{ $record }` only on that stamp. Any other host, such as a bulk action dialog that hands the widget its sibling parameters, leaves every `{ $record }` entry out. A bulk action parameter cannot claim the stamp by writing it: the bulk dialog never carries `recordBeingEdited` from a parameter onto its widget.
- **Spec.** The `value`, `orEmpty` and `lookupFilters` describes on `FieldSchema` lose their `[PLANNED — not enforced]` markers and say what the picker does. The no-record example now names a bulk action over selected rows in place of a filter panel, which reads no `lookupFilters`.

Literal entries and `dependsOn` query exactly as before.
