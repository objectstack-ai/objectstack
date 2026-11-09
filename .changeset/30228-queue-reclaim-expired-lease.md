---
'@objectstack/service-queue': patch
---

fix(service-queue): a job whose worker died mid-handler is reclaimed once its lease runs out, instead of staying `running` forever

Clause-②: no — restores the documented `leaseMs` reclaim; no accept set or export widens
Metadata-protocol: none

`DbQueueAdapterOptions.leaseMs` documented a lease "before another worker may reclaim", but the claim read only `pending` rows, so a worker that crashed, was OOM-killed or was redeployed mid-handler left its `sys_job_queue` row `running` for good: never retried, never dead-lettered.

- **Reclaim.** A poll tick reads the table's `running` rows (one read for every queue, at most once per lease window) and returns each whose `locked_until` has passed to the retry path. The lost run counts as an attempt: the row goes back to `pending` on its backoff, or to `dlq` once `maxAttempts` is spent, with `last_error` saying the lease expired. The write is a compare-and-set on the expired lease, so a holder that renewed in the meantime keeps its run.
- **Renewal.** While a handler runs, its worker moves its lease a full window ahead every third of `leaseMs`, so a slow but live handler is never reclaimed and run twice. A handler must not block the event loop for most of a lease window.
- **Sole writer.** With `soleWriter` no other process claims rows, so the reclaim reads once per boot (finding what a crashed previous process left behind) and again only when one of this process's own claims was left unsettled by a failed write and its lease runs out. `nextDueAt` folds in those leases and the earliest live lease the last read saw, at no read of its own, so the loop wakes for them instead of at the idle ceiling.
- **Cost.** Without `soleWriter`, an idle queue pays one more indexed read per lease window (default 30 s): an idle hour at the defaults goes from 125 to 246 reads. With `soleWriter`, one more read per boot: a fresh kernel's first minute goes from 2 to 3 reads, and an idle hour carries no other.
