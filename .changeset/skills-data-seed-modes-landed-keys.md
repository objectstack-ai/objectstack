---
'@objectstack/skills': patch
---

docs(skills): the objectstack-data seeds reference now teaches the seed modes the loader runs: `ignore` is the default (create-only), `replace` deletes nothing (it inserts into a table the caller cleared), and `insert` duplicates on each replay. It also says that AppPlugin's boot and organization replays do not re-insert a seed row a person deleted (a publish or package install keeps no record, so the row comes back there), and that `seed-replayer` with `{ reseed: true }` restores it. The data-modeling seed guide teaches the same rule and names the loads that keep no record.

Clause-②: no
Metadata-protocol: none
