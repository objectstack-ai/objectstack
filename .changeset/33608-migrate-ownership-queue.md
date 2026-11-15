---
'@objectstack/cli': patch
---

fix(cli): `os migrate` boots a stack that declares queues and assignment rules

Clause-②: no
Metadata-protocol: none

A stack that declares `queues` or `assignmentRules` needs the `ownership-queue` service, and the engine refuses to boot without it. `os serve` mounts it, because sharing is on its always-on slate. The one-shot boot that every `os migrate` subcommand takes did not, so on a queue-using app `os migrate summary-nulls` and the rest of the data family refused to start with "declares queues (N) and assignmentRules (N), but no 'ownership-queue' service is registered". No data migration could run on such an app.

That boot now composes the provider `os serve` mounts, `SharingServicePlugin`, for its declarations only. Its `init()` runs, so the ownership-queue service and the sharing objects it reads are registered. Its `start()` and lifecycle hooks do not run, so no sharing read filter, no share-rule or record-share write hook and no boot backfill is armed by a migration. A composition that already brings the provider, such as the served platform `os migrate plan` and `apply` compose, is left as it was. An insert a migration makes into an object with assignment rules is routed as `os serve` routes it. An update never evaluates a rule, so `summary-nulls` routes nothing.

Nothing to change in an app or its configuration.
