---
'@objectstack/plugin-security': patch
---

fix(plugin-security): a by-id write's row re-read propagates a store fault, and judges the platform's own predicates without the caller-predicate guard

Clause-②: yes (widening)
Metadata-protocol: none

Before an update or delete by id, the security middleware re-reads the addressed row under the caller's context with the platform's write predicates for that row (the tenancy wall and the row-level write predicates). Two rules hold for that re-read, and the second for the controlled-by-parent master read a detail write asks as well:

- **A store fault propagates as raised.** A re-read the store cannot answer (an unavailable datasource, a driver failure) is the write's answer, unchanged — for `ERR_DATASOURCE_UNAVAILABLE` the transports answer `503` — and nothing is written. Only a declared refusal (a 4xx) keeps the record-level `403 PERMISSION_DENIED`, one answer whatever the id names. The controlled-by-parent master read keeps its `403` for every failure.
- **The platform's own predicates are not the caller's predicate.** The field-level predicate guard refuses a caller's filter on a field its field rules do not let it read, and judges only the caller's predicate: a predicate subtree the platform composed and marked as its own is not judged. That holds for every such subtree that reaches the guard inside a caller-context read — the by-id write re-read and the controlled-by-parent master read, the analytics read-scope merge handed to an aggregate under the caller's context, and a record-sharing read scope composed before the security middleware. Only platform-composed predicates are exempt; nothing the caller writes is. Under the `group` and `isolated` tenancy postures, a caller whose field rules hide the organization column updates and deletes the records of its organization by id, writes a controlled-by-parent detail under a master of its organization, and aggregates over the records of its organization. A record of another organization and an id that names no record answer that caller exactly as they answer any other caller.

Unchanged: a caller's own filter on a field it cannot read is refused, on a read, an analytics query and a predicate write; a record the caller reads but may not write keeps its `403`; a system write is not the gate's.
