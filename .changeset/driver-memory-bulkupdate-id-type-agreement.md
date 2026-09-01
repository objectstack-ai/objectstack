---
"@objectstack/driver-memory": patch
---

fix(driver-memory): `bulkUpdate`'s touched-row set now agrees with its own id resolution, so a mixed id-type batch is no longer false-refused (#13911)

`IDataDriver.bulkUpdate` declares `id: string | number`, and this driver
resolves an id to a row with a loose comparison — the way `update` and
`delete` always have — so naming a stored `1` as `'1'` finds the same row.
The all-or-nothing rework shipped one release earlier then built its
untouched-row set from the *caller's* ids using strict `Set` membership, so
for a mixed-type id the two lookups disagreed: the row was resolved and
updated, yet also stayed in the untouched set carrying its **pre-image**. It
faced the uniqueness check twice — once with the value it was vacating, once
with the value it was taking — and a batch that merely HANDS a unique value
from one row to another was refused with a false `UNIQUE_VIOLATION` / 409.

`bulkUpdate` now resolves every id to its table index first and derives the
touched set from the *resolved rows' own ids*, so both lookups read the same
stored value and cannot drift apart — the property the sibling `updateMany`
gets for free by drawing its target ids from table rows. The loose resolution
is deliberately preserved: tightening it would silently change which ids
resolve at all, a far wider behaviour change than this defect.

A genuine collision is still refused, and the stored id keeps its own type —
naming a row with a differently-typed id does not restamp it. `bulkDelete`
needed no change: it has exactly one id comparison and dedups on the resolved
table index rather than on caller input, so a mixed-type or repeated id
collapses to a single index by construction.
