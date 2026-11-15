---
'@object-ui/components': patch
'@object-ui/console': patch
---

fix(components): record page header-action predicates wait for the record instead of reporting "No such key" for fields the object has

Clause-②: no
Metadata-protocol: none

A record page binds its record id at once and its row only when the read answers. Until then the `page:header` actions evaluated their `visible`, `hidden`, `disabled` and `pressed` predicates against an empty record, so every `record.<field>` predicate faulted, and the console said "A conditional predicate failed to evaluate … No such key: status … Check the field names and CEL" once per action on every page load, for a field the object has. Nothing was wrong with the metadata.

A record that is bound but not loaded is now its own state. Each predicate answers its key's safe default (hidden, not hidden, disabled, not pressed) and reports nothing; a `disabled` action does not claim it is "not available for this record" while there is no record yet. Once the record arrives the predicates run as before, and the warning still fires when a key is really missing from the loaded record. A header with no record bound at all evaluates as before.
