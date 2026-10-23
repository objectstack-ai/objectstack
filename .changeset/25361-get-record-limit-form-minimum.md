---
'@objectstack/service-automation': patch
---

fix: the `get_record` designer form no longer offers a `limit` below 1

Clause-②: no
Metadata-protocol: none

The `get_record` node's `limit` is a positive integer, and every flow save door refuses `0`, a negative or a fraction. The executor's form descriptor still declared `limit` as a bare integer, so the designer form offered values the save always refused. The descriptor's `limit` now declares `minimum: 1`, the same floor as the contract. Nothing a flow can store changes; only the form stops offering what the save refuses.
