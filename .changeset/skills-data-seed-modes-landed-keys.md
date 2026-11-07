---
'@objectstack/skills': patch
---

docs(skills): the objectstack-data seeds reference now teaches the seed modes the loader runs: `ignore` is the default (create-only), `replace` deletes nothing (it inserts into a table the caller cleared), and `insert` duplicates on each replay. It also says that a boot or organization replay does not re-insert a seed row a person deleted, and that `seed-replayer` with `{ reseed: true }` restores it. The data-modeling seed guide teaches the same rule.

Clause-②: no
Metadata-protocol: none
