---
'@objectstack/driver-sql': patch
---

fix(driver-sql): the differ's orphan arm keeps a hash-shadow carrier whose key it could not read, instead of offering it as a destructive drop (#32399)

Clause-②: no
Metadata-protocol: none

On MySQL (and anywhere a #11627 hash shadow carries a unique key over a long TEXT column), `os migrate plan` / `apply` no longer offer a `drop_index`, categorized `destructive`, for a shadow-carried unique under an ObjectStack generated name when the shadow's generation expression could not be read. What that index enforces is unknown, so it is kept and nothing is offered: the answer the widening arm and the redefinition arm already give such a carrier. An orphaned carrier whose key was read is still offered as the orphan drop, described by the key it enforced. Measured on a live MySQL 8.0: before this change the unreadable carrier was offered as `drop_index` and `os migrate apply --allow-destructive` removed it; after it, the carrier stays and the resolved one beside it is still dropped.
