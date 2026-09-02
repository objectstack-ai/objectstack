---
'@objectstack/service-automation': patch
---

Resume a paused flow run from the shared store, not from the replica's own memory of it

On a multi-replica deployment over one database, approving a level of a multi-level
approval flow could re-create the level that was just approved instead of opening the
next one — so the same approver had to approve each level twice, and a three-level flow
produced five approval requests. Landing the same stale read on the final level rolled
the run back to the previous one and left it parked forever instead of completing.

The engine kept paused runs in a per-process map and read that map before the durable
`sys_automation_run` row, so a replica that had handled the run earlier answered from
its own snapshot of the node the run was parked at — a snapshot nothing invalidates.
Whichever replica the next decision reached then traversed forward from a node the run
had already left. A single replica never showed it, because there is only one map and
it is never behind.

The resume path is now store-authoritative: with a `SuspendedRunStore` configured, the
store answers where a run is parked, and the in-memory map is consulted only for a run
whose durable save failed (the existing degradation, which keeps such a run resumable
in-process and reports the lost durability at `error`). The ordering of the resume
itself is unchanged — the suspension is still consumed before downstream traversal.

Two consequences worth knowing: every resume now reads the store, so an unreadable
store is reported as `STORE_UNAVAILABLE` for a run this process parked itself rather
than being served a possibly-stale snapshot; and the approvals pre-flight
(`hasSuspendedRun`) is answered from the same authoritative read, so a decision is no
longer recorded against a run that another replica has already advanced or finished.
