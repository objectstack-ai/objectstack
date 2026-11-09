---
'@objectstack/core': minor
'@objectstack/platform-objects': patch
'@objectstack/objectql': patch
'@objectstack/driver-sql': patch
---

feat(core): the activation ledger is keyed by `(metadata_type, package_id, name)`, and rows that name no package take their one holder

Clause-②: yes (widening) — `@objectstack/core` exports `backfillActivationLedgerPackages` and the `ActivationLedgerHolder`, `ActivationLedgerUnboundRow`, `ActivationLedgerBackfillReport` and `ActivationLedgerBackfillOptions` types from its root; nothing is removed or renamed, and every door and name-keyed reader answers as before.
Metadata-protocol: none

`sys_metadata_activation` (the switch an administrator throws to turn a packaged flow, action, permission set, sharing rule, webhook, queue or assignment rule off) is now unique on `(metadata_type, package_id, name)` instead of `(metadata_type, name)` (ADR-0150 D4, D8 row R4). Two packages may each hold a row for an item of the same name; one package may not hold two.

At every boot, once the package holders are sealed, a ledger row that names no package is given the package that holds its item, as the package-scoped resolver answers it. Who sees it: an operator whose deployment carries such rows reads one `info` line naming each row bound. A row whose name two packages hold is left as it is and reported in one `warn` line naming every holder; nothing is picked. A row for an item the environment authored, or for a position, keeps naming no package. The backfill writes only `package_id`, never the switch itself, so the next boot finds nothing to change.

Nothing reads the package yet: every flow, action and catalog switch still applies by type and name exactly as before, and the activation doors answer as before.

On an existing SQL database the boot's schema sync creates the new index beside the old one, and `os migrate plan` reports the old `(metadata_type, name)` index as superseded: one `replace_unique_index`, category safe, applied by `os migrate apply` with no `--allow-destructive`. The SQL driver now reads any generated plain UNIQUE whose columns are an in-order proper subsequence of a declared global UNIQUE on the same table this way, because widening a unique key only admits rows the old key refused and drops none; a UNIQUE on other columns still reads as an orphan, as before. Until the replace is applied the old index keeps refusing a second package's row of the same name, which nothing writes yet.
