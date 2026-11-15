---
'@objectstack/objectql': patch
---

Clause-②: no
Metadata-protocol: none

perf(objectql): a `controlled_by_parent` read no longer carries the parent-chain subquery for a
reader who holds View All on the detail and whose scope is unrestricted at every master hop, when the
detail's `master_detail` is required.

For that reader (an admin with View All on the detail and on every object of the chain, under a
posture whose read scope adds no row condition), the engine's `ReadableIds` composition drops the
required master's leaf (`fk IN (SELECT id FROM master …)`) instead of compiling it. Admin lists,
counts and aggregates on detail objects run one subquery fewer per hop.

Behaviour change, by maintainer ruling: totals, counts and aggregates for that reader may include
orphan rows, which are detail rows whose required master is missing or empty (rows that a
system-context write or a schema change left behind), inside the reader's own tenant wall. Every
other reader keeps the whole chain and sees exactly what it saw before. That includes a reader with
any restricted hop, a reader with View All on the detail only, and a plain member. An optional master
keeps its leaf. Under walled tenancy a tenant admin's master scope is the tenant wall, so nothing is
dropped there.
