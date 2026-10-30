---
'@objectstack/core': patch
---

fix(core): an import lookup cell also resolves by the target object's unique fields, an autonumber included

Clause-②: no
Metadata-protocol: none

A data import lookup cell is matched against the target object's id, the lookup's `displayField`, the target's title field and the fixed keys `name`, `title`, `label`, `full_name`, `email`, `username`. A cell holding the target's autonumber (`ACC-000012`) or another unique field matched none of them and answered `reference_not_found`, so a title change broke every export file written before it.

The matcher now also asks, after those candidates and in the target's declared field order, every field whose `unique` declares a constraint (`true`, `'organization'`, `'global'`) and every `autonumber` field that omits `unique` (unique per organization by the spec's default). An autonumber declared `unique: false` is not asked. The existing rules are unchanged: the first field to match wins, an earlier candidate that matches still wins, a field that matches more than one record answers `reference_ambiguous`, and a cell matching nothing answers `reference_not_found`.
