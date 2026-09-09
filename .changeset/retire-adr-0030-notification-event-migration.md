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

## What moved, and the one-line fix

| FROM | TO |
|---|---|
| `import { migrateSysNotificationToEvent } from '@objectstack/metadata/migrations'` | **removed** — delete the call; there is no replacement and no `os migrate notification-event` |
| `SysNotificationMigrationResult` / `SysNotificationMigrationOptions` / `SysNotificationMigrationReceipt` (`@objectstack/metadata/migrations`) | **removed** — the runner's own result/option/receipt types went with it |
| `CREATION_ATTESTED_MIGRATION_IDS` — a 3-tuple ending in `'adr-0030-notification-event'` | a **2-tuple**: `['adr-0104-file-references', 'adr-0104-value-shapes']`. Code typed against `(typeof CREATION_ATTESTED_MIGRATION_IDS)[number]` with the notification id no longer compiles — drop that arm |

`NOTIFICATION_EVENT_MIGRATION_ID` (`@objectstack/spec/system`) is **kept**: a
deployment attested at birth, or one that made the operator call while the
runner shipped, still holds a `sys_migration` row under
`'adr-0030-notification-event'`, and the id is that row's name. Nothing writes
or reads a row under it any more — `attestFreshDatastore` no longer includes it
— and it is not a registration: it gates nothing and never did.

## Reversal path

Two answers were considered and both refused: an `os migrate notification-event`
sub-command is a permanent operator surface for a migration with no measured
demand, and a boot-time invoker is an unattended data rewrite nobody asked for.
⚠️ Nobody has measured whether any live deployment carries pre-ADR-0030
`sys_notification` rows. If a **named** deployment turns out to hold rows it
needs, the migration returns as an operator-runnable sub-command shaped exactly
like `files-to-references` / `value-shapes` — dry-run default, `--apply` gate,
documented consequence — under its own card.

<!-- adr-0087: not-required (no-migration-prescription) nothing authorable moves: no spec key, no config field and no stored-metadata shape changes. The removed surfaces are a runtime function on `@objectstack/metadata/migrations` and one member of a constant tuple, neither of which appears in any authorable document, so there is no author input for a conversion-layer entry to rewrite. -->
