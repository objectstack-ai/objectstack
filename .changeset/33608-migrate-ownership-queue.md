---
'@objectstack/cli': patch
---

fix(cli): `os migrate` boots a stack that declares queues and assignment rules

Clause-②: no
Metadata-protocol: none

A stack that declares `queues` or `assignmentRules` needs the `ownership-queue` service, and the engine refuses to boot without it. `os serve` mounts it, because sharing is on its always-on slate. The one-shot boot that every `os migrate` subcommand takes did not, so on a queue-using app `os migrate summary-nulls` and the rest of the data family refused to start with "declares queues (N) and assignmentRules (N), but no 'ownership-queue' service is registered". No data migration could run on such an app.

When the boot carries no sharing provider, it now registers the ownership-queue service itself. This is the same `OwnershipQueueService` that `SharingServicePlugin` registers under `os serve`, and the boot registers nothing else of sharing. No sharing object is declared, so the tables a migration examines and creates do not change. No sharing read filter, share-rule hook, record-share hook or boot backfill is armed. A composition that already brings the provider, such as the served platform that `os migrate plan` and `apply` compose, is left as it was.

On this boot a declared queue resolves as it does under `os serve`. Authored queues and members (`sys_queue`, `sys_queue_member`) are not readable here, so the service warns once and answers from the declarations. Only an insert into an object with assignment rules reaches it. An update never evaluates a rule, so `summary-nulls` routes nothing.

Nothing to change in an app or its configuration.
