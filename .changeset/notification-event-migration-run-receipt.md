---
"@objectstack/metadata": minor
---

A completed run of the ADR-0030 notification cut-over now records itself in the `sys_migration` deployment ledger, per the ruled claim matrix.

`migrateSysNotificationToEvent` reports `migrated` / `already_done` / `not_applicable` / `error` to its caller and — until now — recorded nothing anywhere. Once that line had scrolled, "did this cut-over run here, and when" had no answer in the deployment even in principle. The ledger row is what answers it, and what a run of this migration may claim under `NOTIFICATION_EVENT_MIGRATION_ID` is stated on that constant in `@objectstack/spec/system`:

- `last_run_at` — stamped on every completed non-`error` run (`migrated`, `already_done`, `not_applicable` alike).
- `applied_at` — stamped only on `migrated`. Never cleared: a later `already_done` leaves an earlier backfill's stamp alone, because the backfill really did happen.
- `verified_at` — never written, in either direction. This migration has no self-check, and `verified_at` means a self-check passed. On a store created after the cut-over the row already exists and `attestFreshDatastore` set `verified_at` at birth; that certificate survives a run untouched, because the column is omitted from the update rather than sent as `null`.
- `blocking: 0`, and `details` carrying `{ outcome }` verbatim.
- An `error` run writes no claim at all — it does not know what it did, so it does not say.

**Receipt, not gate.** Nothing reads a row under this id as a precondition and nothing may: a gate would need the self-check that does not exist. The row is what an operator reads, in the shape `sys_migration` already documents for the seed-tenancy repair.

Two additions to the published surface of `@objectstack/metadata/migrations`, both driven by that: a new `SysNotificationMigrationReceipt` type, and a new `receipt` member on `SysNotificationMigrationResult` reporting what became of the claim (`inserted` / `updated` / `not-claimed` / `no-ledger` / `failed`, with a reason on the last two). This directory takes no logger and reports to its caller, so the claim's own fate is reported the same way the migration's is — a receipt that could not be written is never swallowed. Reading a result is unaffected; code that CONSTRUCTS a `SysNotificationMigrationResult` by hand (a test double) now supplies `receipt`.
