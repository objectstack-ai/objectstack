---
"@objectstack/spec": minor
---

`@objectstack/spec/system` now names the ADR-0030 notification cut-over, so "has this deployment run it?" has a place to be answered.

`sys_migration` is the ledger a deployment writes to record that a data migration ran against its own database, and consumers read it instead of the platform version. Its well-known ids were `adr-0104-file-references` and `adr-0104-value-shapes` — the two ADR-0104 scans, both driven by an `os migrate` command that records the row. `migrateSysNotificationToEvent` (`@objectstack/metadata/migrations`) had none. It is destructive and one-way, operators are handed the call verbatim in `docs/handoff/adr-0030-notification-convergence.md`, and it recorded nothing when it ran: a deployment that performed the cut-over and one that never did are indistinguishable from the ledger. A row can only be keyed by an id, so without one the question had nowhere to be answered even in principle.

Added: `NOTIFICATION_EVENT_MIGRATION_ID = 'adr-0030-notification-event'`, exported from `@objectstack/spec/system`. Purely additive — no existing export, schema or predicate changes, and nothing reads the new id yet.

Deliberately NOT decided here, and the constant's docblock says so rather than leaving its silence to be read as an answer: what a `sys_migration` row under this id means. The two ADR-0104 ids get their `last_run_at` / `applied_at` / `verified_at` / `blocking` semantics from a command that scans, self-checks and only then records; this migration has no command and no self-check, and reports `migrated` / `already_done` / `not_applicable` / `error` to its caller instead. Which of those columns one of its runs may claim, whether anything may gate on the row, and whether a datastore created after the cut-over belongs in `CREATION_ATTESTED_MIGRATION_IDS`, are contract questions on this surface and are left open.
