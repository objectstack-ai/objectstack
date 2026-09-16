---
'@objectstack/platform-objects': minor
---

A datastore created from empty now attests **two** creation-attested migration ids, not
three.

`attestFreshDatastore` (`@objectstack/platform-objects/system`) writes one `sys_migration`
row per id in `CREATION_ATTESTED_MIGRATION_IDS` (`@objectstack/spec/system`) at the moment
a store is created from empty. That tuple lost `'adr-0030-notification-event'` when the
ADR-0030 notification cut-over was retired, so a store born on this version is attested for
`'adr-0104-file-references'` and `'adr-0104-value-shapes'` alone.

## What an operator sees

- A fresh deployment's `sys_migration` table holds **two** creation-attested rows where it
  held three. Nothing else about them moves: both carry the same
  `attested: 'datastore-created-empty'` marker in `details`, and both ADR-0104 gates are
  enabled from birth exactly as before.
- **No row is written under `'adr-0030-notification-event'` any more, and nothing reads
  one.** A deployment that already holds such a row keeps it, untouched —
  `NOTIFICATION_EVENT_MIGRATION_ID` (`@objectstack/spec/system`) survives as that row's
  name so the table stays readable by an operator. The id gates nothing, and never did.
- Nothing this package exports is renamed, removed or re-signed. `attestFreshDatastore`
  takes the same arguments and answers the same shape; a caller passing its own
  `migrationIds` is unaffected, because only the default moved.

There is nothing to adopt and no command to run. Pre-ADR-0030 `sys_notification` rows are
not carried by the platform on this line, so a store created from empty has nothing the
retired id could have attested.
