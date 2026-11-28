---
'@objectstack/service-knowledge': patch
---

feat(service-knowledge): a scheduled reconcile keeps every knowledge index equal to its source, daily and soon after a predicate write

Clause-②: no
Metadata-protocol: none

Record events keep an index fresh; the reconcile now keeps it correct (ADR-0161 K1). `KnowledgeService.reconcileSources()` walks every source whose store lists its documents with the complete build the boot and `os knowledge rebuild` already run — same cluster lease and fence, same skip, same purge, same `completeBuild`, trigger `reconcile` — so the documents of rows inserted or changed without an event are written, those of rows deleted or moved out of `where` by a predicate write, or built from an insert that rolled back, are purged, and nothing is embedded again for a row that did not change.

- `KnowledgeServicePlugin` schedules one job, `knowledge:reconcile`, on the platform's job service, daily at 03:00 UTC. The new plugin option `reconcile` moves it (`{ cron, timezone }`) or turns it off (`false`). A run that could not finish a source is `degraded` in the job's run history, naming the source. With no job service composed, the plugin says so once at boot.
- A `data.records.updated` / `data.records.deleted` event (a `multi: true` write) now asks for a reconcile of every source over the object, started once the object has had no further predicate write for two minutes, at the latest ten minutes after the first; its warning says so. A source on an adapter without `listDocuments` is never reconciled: the reconcile says so once at `warn`, and the predicate-write warning keeps its old text for it.
- A source whose index fingerprint or recipe moved while the server runs (a split or embedder setting saved) is built as a new generation by the next reconcile instead of at the next restart.
- `KnowledgeBuildTrigger` gains `'reconcile'`; new exports `KnowledgeReconcileReport`, `KnowledgeReconcileEntry`, `KnowledgeReconcileRequest`, `RECONCILE_JOB`, `RECONCILE_DEFAULT_CRON`, `RECONCILE_QUIET_MS` and `RECONCILE_MAX_WAIT_MS`; `KnowledgeService.requestReconcile(object)`.

No migration: nothing an author writes changes, and a deployment that wants no scheduled walk sets `reconcile: false`.
