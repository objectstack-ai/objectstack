---
'@objectstack/service-knowledge': patch
'@objectstack/platform-objects': patch
'@objectstack/spec': patch
'@objectstack/cli': patch
---

feat(service-knowledge): each source's sync state is one durable record, the same on every node

Clause-②: yes (widening)
Metadata-protocol: none

Each knowledge source now has one row in the new system object `sys_knowledge_sync_state` (declared in `@objectstack/platform-objects/system`, listed in the spec's platform object names, registered by `KnowledgeServicePlugin` with its manifest). The row holds the source (name, package, adapter, object), its last build (who started it, how it ended, its start and end times, its counts and one platform sentence) and its record syncs that failed and are not yet repaired (how many, first and last time, one sentence naming the record, the attempts and the kind of error). It never holds a field value or a provider's own error text.

- Every node reads and writes the same row, so `index_status`, `os knowledge status` and Setup answer the same whichever node is asked, and a restart forgets nothing. A build that did not run is not written.
- A build writes its start, its counts at most every ten seconds, and its end, for every trigger. A build left `running` by a node that stopped is closed `interrupted` by the next boot (only while its build lease is free) or by the next node that takes the lease.
- Each dead-lettered record sync adds one failure; a sync that succeeds on a retry adds nothing. The first failure of a source asks for one reconcile of it after the quiet period. A completed reconcile clears the failures recorded before its walk and removes their dead letters; failures during the walk stay.
- `index_status` answers each source's `build` (now the stored shape: `counts` instead of `progress`/`result`, and the status `interrupted`) and `failures`, and the queue's pending count under `queue`.
- Setup gets a **Knowledge Sync Status** entry beside the Knowledge settings, for accounts with `manage_platform_settings`. The object is engine-owned with `get`/`list` only: no data door writes it.
- `os knowledge status` prints the last build, the failed syncs and the queue's pending count without the per-node caveat. `os knowledge rebuild` follows the build through the durable record and no longer infers its end from the index state; a rebuild the server did not start now exits 1 at once. On the `memory` adapter the index stays per process, which the command says when the build ends.
- `@objectstack/service-knowledge` now depends on `@objectstack/platform-objects` at runtime (it was a dev dependency).

Nothing to migrate: the table is created by schema sync, and the first build or failure fills it.
