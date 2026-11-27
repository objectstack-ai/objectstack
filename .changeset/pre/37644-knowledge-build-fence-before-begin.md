---
'@objectstack/service-knowledge': patch
---

fix(service-knowledge): a build checks its lease before `beginBuild` and before each purge deletion

Clause-②: no
Metadata-protocol: none

- **A build cancelled or lease-lost while it waits its turn no longer begins.** A build queued behind another walk of the same source used to call the adapter's `beginBuild` once that walk ended, even when the build had meanwhile been cancelled (`timed-out`) or had lost its cluster lease. On pgvector that call takes the store's builder lock, which then stayed held until it went idle. The build now checks its lease first: it calls neither `beginBuild` nor anything after it, writes nothing, and its record ends `timed-out` or `lease-lost` as before, with a message that says it stopped before its build began.
- **A build that loses its lease during its purge stops at the next deletion.** Before, a lost lease was noticed only once the whole purge had run, just before the completion. Each purge deletion now checks the lease first, so the purge stops before the next one, nothing is completed, and the record reads `lease-lost` with the number of deletions made. A build cancelled during its purge likewise deletes nothing further once the deletion it stopped waiting on answers.

No export or adapter contract changes.
