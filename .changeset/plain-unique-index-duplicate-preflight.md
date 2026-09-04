---
"@objectstack/driver-sql": patch
---

A plain unique index over existing duplicate rows no longer kills the boot with the database's raw error, and `os migrate plan` no longer calls that op `safe`.

Declaring a column unique over a table that already holds duplicates had two very different outcomes depending on one branch in the SQL driver, and only one of them was survivable.

- **An organization-scoped unique** (the `unique: 'organization'` default, materialised as the NULL-safe `COALESCE(organization_id, '__global__')` composite) kept the boot up: the driver logged at `error` naming the index, the constraint that is not enforced and the remedy, and the ADR-0120 D4 duplicate pre-flight reported the blocked `create_index` as `category: 'destructive'` / `severity: 'error'` with the conflicting key groups and their row counts.
- **A plain unique** — no organization key part at all, reached by an object with `tenancy: { enabled: false }` or by any explicit `unique: 'global'` — took the process down: `initObjects` threw the database's own error, which names the index and the column and no rows and no remedy, nothing reached the durability channel, and `detectManagedDrift` (what `os migrate plan` reports) classified the very same op `category: 'safe'`, `severity: 'warning'`, so `os migrate apply` and dev `autoMigrate: 'safe'` walked straight into the raw failure.

The plain path now reaches the same posture as the scoped one:

- **The boot survives and says what is not enforced.** `syncDeclaredIndexes` absorbs a uniqueness violation on a plain unique index the way it already absorbed one on the NULL-safe composite: the failure is logged on the durability channel (`error`) naming the index, the conflicting key groups with their row counts, the constraint that is NOT enforced, and `os migrate plan` as the way out. A non-unique index and any failure that is not a uniqueness violation still surface as before.
- **The duplicate pre-flight covers it.** The ADR-0120 D4 probe no longer skips ops whose NULL-safe column set is empty, so a plain unique `create_index` over dirty data is reported `destructive` / `error` with the same row report instead of `safe`. Nothing new probes it: the existing probe already groups by the bare columns when there is no NULL-safe key part, so both key shapes share one pre-flight rather than a second copy that can drift from the first.

Consumers of the classification see the op move from the "Safe" group to "Destructive (requires --allow-destructive)" in `os migrate plan` and `os diff`; `os migrate apply` defers it instead of attempting it; the artifact boot gate refuses with a named destructive-drift refusal instead of crashing; and dev `autoMigrate: 'safe'` leaves it alone. Clean data is unaffected — the probe finds nothing and the index is created exactly as before.
