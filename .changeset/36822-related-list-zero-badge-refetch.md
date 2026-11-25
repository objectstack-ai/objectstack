---
'@object-ui/plugin-detail': patch
---

fix(plugin-detail): a related list that already shows 0 keeps showing 0 while it reloads

Clause-②: no
Metadata-protocol: none

A related list on a record page whose count was known to be 0 used to drop its count badge for as long as a reload took (after a delete, a filter change or any other refetch), because an empty list being read looked like a list read for the first time. Once a read has settled, the list's count is known, so a later reload keeps drawing the last count until the new one lands. A list read for the first time still draws no count until it is known, never a false 0.
