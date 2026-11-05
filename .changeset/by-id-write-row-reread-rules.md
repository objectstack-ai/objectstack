---
'@objectstack/plugin-security': patch
---

fix(plugin-security): a by-id write's row re-read propagates a store fault, and judges the platform's own predicates without the caller-predicate guard

Clause-②: yes (widening)
Metadata-protocol: none

Before an update or delete by id, the security middleware re-reads the addressed row under the caller's context with the platform's write predicates for that row (the tenancy wall and the row-level write predicates). Two rules now hold for that re-read, and for the controlled-by-parent master read a detail write asks:

- **A store fault propagates as raised.** A re-read the store cannot answer (an unavailable datasource, a driver failure) is the write's answer, unchanged — for `ERR_DATASOURCE_UNAVAILABLE` the transports answer `503` — and nothing is written. Only a declared refusal (a 4xx) keeps the record-level `403 PERMISSION_DENIED`, one answer whatever the id names. Before, every failure of the re-read was answered `403`. The controlled-by-parent master read keeps its `403` for every failure.
- **The platform's own predicates are not the caller's predicate.** The field-level predicate guard refuses a caller's filter on a field its field rules do not let it read; it no longer judges the predicates the platform composes onto the re-read. Under the `group` and `isolated` tenancy postures, a caller whose field rules hide the organization column now updates and deletes the records of its organization by id, and writes a controlled-by-parent detail under a master of its organization, where before each write was refused `403`. A record of another organization and an id that names no record answer that caller exactly as they answer any other caller.

Unchanged: a caller's own filter on a field it cannot read is refused as before, on a read and on a predicate write; a record the caller reads but may not write keeps its `403`; a system write is not the gate's.
