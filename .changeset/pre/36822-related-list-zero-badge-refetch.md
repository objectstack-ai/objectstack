---
'@object-ui/plugin-detail': patch
---

fix(plugin-detail): a related list that already shows 0 keeps showing 0 while it reloads

Clause-②: no
Metadata-protocol: none

A related list on a record page whose count was known to be 0 used to drop its count badge for as long as a reload took (after a delete, a filter change or any other refetch), because an empty list being read looked like a list read for the first time. Once a read the list issued has answered, its count is known, so a later reload keeps drawing that count until the new one lands. A read that fails forgets the count, so its Retry draws no count until it answers, never a false 0; so do rows emptied without a read (the parent record reloading, or no data adapter), so the next parent's read draws no count either. A list's first read, including one that starts only once its parent record has loaded, still draws no count while it is in flight.
