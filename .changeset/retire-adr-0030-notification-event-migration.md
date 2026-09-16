---
'@objectstack/metadata': minor
'@objectstack/spec': minor
---

**BREAKING** — retire the `adr-0030-notification-event` data migration.

`migrateSysNotificationToEvent` had no way to be run: zero production callers
anywhere in the repo, and no `os migrate` sub-command, while the two sibling
members of `CREATION_ATTESTED_MIGRATION_IDS` had both. The runner, its barrel
export, its tests, the ruled `sys_migration` receipt-claim matrix, that matrix's
pin, and the id's membership in `CREATION_ATTESTED_MIGRATION_IDS` are removed
together. Pre-ADR-0030 `sys_notification` rows are not carried by the platform
on this line.

## What is gone, and what an upgrader does about it

⭐ **Nothing is renamed and nothing replaces it**, so there is no new spelling to
adopt — every item below is a deletion, and the fix is to stop using it.

- `migrateSysNotificationToEvent` (`@objectstack/metadata/migrations`) — deleted.
  No replacement exists, and none is coming: an `os migrate notification-event`
  sub-command was considered and refused. Delete the call. The compiler delivers
  this one: the import fails to resolve.
- `SysNotificationMigrationResult`, `SysNotificationMigrationOptions` and
  `SysNotificationMigrationReceipt` (same entry point) — deleted with it. They
  described that runner's own result, options and receipt and nothing else.
- `CREATION_ATTESTED_MIGRATION_IDS` (`@objectstack/spec/system`) — was a
  three-member tuple and is now a two-member one holding
  `'adr-0104-file-references'` and `'adr-0104-value-shapes'`. Both ADR-0104 ids
  keep their sub-commands, their receipt rows and their birth attestation; only
  the notification id left. Code typed against
  `(typeof CREATION_ATTESTED_MIGRATION_IDS)[number]` that names the notification
  id no longer compiles — delete that arm.

`NOTIFICATION_EVENT_MIGRATION_ID` (`@objectstack/spec/system`) is **kept**. A
deployment attested at birth, or one that made the operator call while the runner
shipped, still holds a `sys_migration` row keyed `'adr-0030-notification-event'`,
and the constant is that row's name. Nothing writes or reads a row under it any
more — `attestFreshDatastore` no longer includes it — and it is not a
registration: it gates nothing and never did.

## Reversal path

Two answers were considered and both refused: an `os migrate notification-event`
sub-command is a permanent operator surface for a migration with no measured
demand, and a boot-time invoker is an unattended data rewrite nobody asked for.
⚠️ Nobody has measured whether any live deployment carries pre-ADR-0030
`sys_notification` rows. If a **named** deployment turns out to hold rows it
needs, the migration returns as an operator-runnable sub-command shaped exactly
like `files-to-references` / `value-shapes` — dry-run default, `--apply` gate,
documented consequence — under its own card.

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable moves and nothing is renamed: no spec key, no config field, no stored-metadata shape, and no replacement spelling for anyone to adopt. The removed surfaces are one runtime function on `@objectstack/metadata/migrations`, its three own result/option/receipt types, and one member of a constant tuple — none of which appears in any authorable document, so `objectstack migrate meta` has nothing it could rewrite and a ledger entry would prescribe a rewrite that does not exist. The consumer-side action is a deletion, delivered by the compiler on the import and by the barrel tombstone beside it. -->
