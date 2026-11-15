---
'@objectstack/objectql': patch
---

Clause-②: no
Metadata-protocol: none

perf(objectql): a `controlled_by_parent` read no longer carries the parent-chain subquery when the
reader's scope is unrestricted at every hop and the detail's `master_detail` is required.

For such a reader (an admin with View All on every object of the chain, under a posture whose read
scope adds no row condition), the engine's `ReadableIds` composition drops the required master's
leaf (`fk IN (SELECT id FROM master …)`) instead of compiling it. Admin lists, counts and aggregates
on detail objects run one subquery fewer per hop.

Behaviour change, by maintainer ruling: that reader now also sees detail rows whose required master
is missing or empty (rows a system-context write or a schema change left behind). A reader with any
restricted hop keeps the whole chain and sees exactly what it saw before, an optional master keeps
its leaf, and the tenant wall still bounds every read.
