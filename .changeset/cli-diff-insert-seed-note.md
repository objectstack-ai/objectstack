---
'@objectstack/cli': patch
---

fix(cli): `os diff` now says what a replay does to a seed dataset in mode `insert`, as it already did for `replace`: a replay inserts its records again, and a row the database refuses is that row's error. The loader's `insert` arm inserts every record without looking for a match, so the plan no longer reads an `insert` dataset as harmless.

Clause-②: no
Metadata-protocol: none
