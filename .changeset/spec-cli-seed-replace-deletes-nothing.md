---
'@objectstack/spec': patch
'@objectstack/cli': patch
---

docs(spec,cli): the seed mode text now says what the loader does. `replace` deletes nothing: it inserts every record with no match, for a table the caller cleared, and `insert` inserts every record again on each replay. The `mode` docstring and `.describe()` name the landed-keys rule: the loads AppPlugin runs for an organization (the single-tenant boot seed, the `seed-replayer` replay, the dev hot reload) do not insert again an `ignore` or `upsert` row that landed once and was later deleted, a seed publish or package install keeps no such record, and `seed-replayer(organizationId, { reseed: true })` inserts every missing row. `os diff`'s note on a `replace` dataset no longer says a replay deletes every row of the object.

Clause-②: no
Metadata-protocol: none
