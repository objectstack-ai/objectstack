---
'@objectstack/cli': patch
---

fix(cli): `os migrate` value walks name the columns they skip because the package that adds them is disabled

Clause-②: no
Metadata-protocol: none

`os migrate blank-single-values`, `blank-multi-values`, `option-codes`, `text-scalars` and `value-shapes` read each object as it is served. While a module package is disabled, the fields its `objectExtensions` add are withheld from that object (their columns and values are kept), so these runs could not read those columns and their reports read as if they had. Each report now lists every such column as `object.field (package ID)`, and the `--json` document carries the same list as `withheldColumns`. Enable the package and re-run to cover them. Nothing else changes: the runs still read and rewrite only what the served object declares.
