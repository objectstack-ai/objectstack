---
'@objectstack/service-job': patch
---

docs(service-job): state the scheduler leader-election guarantee with its window (#14619)

Documentation only — no runtime change, no type change, no accept/reject
behaviour moves. It ships as a patch because the docblocks are **published
bytes**: `tsup`'s declaration rollup carries `CronJobAdapter.runScheduled`'s
docblock and `DbJobAdapter.schedule`'s routing docblock into `dist/index.d.ts`
/ `dist/index.d.cts` (measured: with all comments stripped, the before/after
declaration files are byte-identical — no exported symbol moved, no signature
changed).

`CronJobAdapter.runScheduled()` holds its cluster lock for the duration of a
scheduled fire (acquired, then released in `finally`), not for the scheduling
deadline. The two docblocks stated the guarantee — "only the node that
acquires the per-job lock runs the handler" — without that window, which reads
as exactly-once per deadline. It is exactly-once only when replica clocks
agree to within the handler's runtime (the normal case on an NTP-synced
deployment); a replica whose clock lags past that window finds the lock
already released and reruns the job. `once` schedules are the sharpest case,
since a one-shot has no later tick during which a business-level
de-duplication marker could self-correct that away. The multi-node section of
[Self-Hosted Deployment](/docs/deployment/self-hosting) states the same
caveat.

⛔ The mechanism is deliberately unchanged: holding the lease keyed to the
deadline (plus takeover semantics for a leader that dies mid-fire) is a
distributed-design item with zero measured pull and no measured
skew-to-runtime ratio — this is bookkeeping, not closure. If a real
duplicate-fire incident is measured on a `once` schedule, that remedy returns
as its own card.
