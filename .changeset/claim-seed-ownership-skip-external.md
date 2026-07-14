---
"@objectstack/plugin-security": patch
---

`claimSeedOwnership` now skips **external (federated) objects** — those with an `external` remote-table binding (ADR-0015) — the same way it already skips `managedBy` and `sys_*` objects.

The seed-ownership backfill walks every registered object that exposes an `owner_id` column and re-owns its unowned rows to the first admin. Federated objects get `owner_id` auto-injected into their schema, so they passed the filter and the backfill issued `select id from <remote_table> where owner_id is null` against a read-only remote datasource whose table may not be provisioned yet at boot — producing startup errors like `Find operation failed … no such table: customers`. External objects are read-only (DDL forbidden, writes double-opt-in) and their ownership is not the platform's to reassign, so they are excluded from the scan entirely.
