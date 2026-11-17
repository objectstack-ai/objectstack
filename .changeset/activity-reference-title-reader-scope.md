---
'@objectstack/plugin-audit': patch
---

fix(plugin-audit): an activity text that names a referenced record by its title is served only to a reader who may read that title

Clause-②: no
Metadata-protocol: none

**The rule.** An activity row names a referenced record by its title in three places: the record label of an object whose `nameField` is a lookup or `user` field, a tracked reference field's change, and a fired milestone's reference token. Each such text is served to a reader only when that reader may read the title of the object the reference points at, the reader `$expand` would serve the title to:

- the reader is served the target object's title field (its ADR-0079 `nameField`) unmasked, by the security service's field answer, which also withholds a formula title computed from a field the reader may not read; and
- the security service admits the reader to the target object. A reference field that declares `referenceNameVisible` lifts this object-level admission and never the field-level rule, as it does on `$expand`.

Otherwise the text is served the way any activity text composed from a field the reader is not served already is: the row keeps its `record_id`, and the label or summary is left out of the row. A row whose provenance is unknown is judged against every reference field of its object. A reader who may read the title, and every system read, are served the row as before.

The judgement is made at read time from the security service's answers, once per referenced object per read; no row is read for it, and rows already written are judged the same way.
