---
"@objectstack/driver-sql": patch
---

fix(driver-sql): re-seed a stale autonumber counter instead of burning a number per failed create (#5495)

`getNextSequenceValue` bootstraps a counter from the data-table `MAX` exactly
once, in its `if (!existing)` branch; after that the data table is never
consulted again. Any row landing by a path that bypasses `fillAutoNumberFields`
— an `isSystem` seed replay, a `preserveAudit` historical import (both
strip-exempt under #5503 and keeping their explicit numbers), or direct SQL —
therefore never raises the sequence, and once the counter sits below `MAX` it is
permanently behind. Every subsequent create collided, burned a number and failed
the request, until the counter had ground past the seeded range one 409 at a
time. That is the "one-time storm per database" the filing reported from
HotCRM's 17.0 GA sweep: 25 consecutive `409 UNIQUE_VIOLATION`s with the
attempted number climbing by one per failure.

Measured on `main` @ `86e6f6c`, counter seeded at 10 with rows 11–39 landed by a
bypass path: **29 caller-visible 409s before a create succeeded** at
`CASE-00040` on attempt 30. After this change the same fixture serves
`CASE-00040` on the caller's **first** attempt, and `last_value` reaches 40 by
one re-seed rather than 29 burns.

`create()` now re-seeds the counter from the data-table `MAX` and retries
(bounded, 3 attempts) — but only when it can *prove* the collision was that
counter's.

**Why the proof is not the conflicting column.** The obvious predicate ("retry
when the conflicting column is this autonumber field") needs
`uniqueViolationColumn()` (#6544) to name a column, and on a tenanted autonumber
it never does — for two independent reasons, both measured and both pinned by
tests. The filing's own message is a composite
(`UNIQUE constraint failed: crm_case.organization_id, crm_case.case_number`),
which that export refuses by contract; and what this repo builds today is
narrower still — ADR-0120 D3 makes the index
`(COALESCE(organization_id,'__global__'), field)`, an *expression* index, on
which SQLite reports `UNIQUE constraint failed: index 'uniq_…'` and names no
column at all. The "column not determinable" limb is not an edge case on this
path; it is the only limb that ever runs there.

All three of `uniqueViolationColumn()`'s states are handled explicitly, because
collapsing any two of them silently is how a real 409 gets eaten:

1. a column is named and it is one this driver generated → re-seed and retry;
2. a column is named and it is not → the duplicate is on a value the **caller**
   supplied, so the original error is rethrown untouched;
3. no column is determinable → decided from the **data**, not the message: if
   the value this driver just generated is already present in the same tenant
   partition the counter covers, the collision was the counter's. If it is not,
   the error is rethrown. One indexed lookup, on the failure path only — the
   happy path is unchanged.

No fifth dialect word-list: the judgement is `isUniqueViolationError` +
`uniqueViolationColumn` from `@objectstack/types`, per Prime Directive #12 and
the #5841 precedent. The re-seed's `MAX` scan is deliberately not wrapped in a
`catch`, so a read failure propagates instead of being folded into `0` or a
stale value (#6114's rule, #5979's family).

Retrying is confined to the no-caller-transaction case. Inside a caller's
transaction the sequence `UPDATE` shares that transaction and rolls back with
the refused `INSERT`, so no number is burned (measured), and on Postgres a
constraint failure aborts the transaction outright — the caller owns that retry.

The `getNextSequenceValue` docstring is reconciled rather than left to
contradict the code: a rolled-back insert burning a number is still by design,
and that sentence used to read as though it also covered a *persistently
failing* insert, which was the defect.

Inherited by `TursoDriver` (local/replica) and `SqliteWasmDriver`, each pinned
by its own test rather than assumed from the base class (#6203). Turso's
**remote** transport is unaffected in both directions: it overrides `create` and
never enters `fillAutoNumberFields`, so it has neither the defect nor the fix.
