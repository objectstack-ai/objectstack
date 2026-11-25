---
'@objectstack/skills': patch
---

docs(skills): objectstack-data says `os validate` and `os build` refuse a seed record its object's validation rules refuse

Clause-②: no
Metadata-protocol: none

`references/seeds.md` said `os validate` does not run an object's validation rules on seed rows. Both commands now run them: each exits 1 (`--json` too) on a record a rule refuses, naming the record's location (`data[0].records[1]`), the object, the record index and the rule. A rule the record's literal values cannot decide (it reads a reference, a default, a formula or roll-up, or the object has a `beforeInsert` hook, or the dataset is `update`) is counted and never refused; the load still judges it, and `os verify` still fails on each dropped row. The `externalId` section now says a blank key field fails `os validate` / `os build` as well as the load. Text only; restatement elsewhere in the file is cut to pay for it.
