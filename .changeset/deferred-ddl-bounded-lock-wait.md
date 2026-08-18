---
"@objectstack/driver-sql": patch
---

fix(driver-sql): a blocked `os migrate` now refuses in 120s instead of hanging for a year on a MySQL metadata lock (#9354)

The deferred-DDL flush widens legacy MySQL `TIMESTAMP` columns to `DATETIME(3)`
and `TIME` to `TIME(3)` with `ALTER TABLE … MODIFY COLUMN`, which needs an
**exclusive metadata lock** on the table. That ALTER ran on a session inheriting
MySQL's default `lock_wait_timeout` — **31,536,000 seconds, one year**. A single
other session holding a lock on the table (a long-running transaction, an open
uncommitted session, a stuck report query) parked the ALTER in
`Waiting for table metadata lock` for that long, and nothing printed.

An operator running `os migrate apply` against a busy production table met this
as a command that simply hangs — indistinguishable from a crash, with no output
to diagnose from. It was first measured as a CI stall: a sub-second test blew a
5000ms budget with **no error at all**, because the ALTER just sat in a lock wait
until vitest killed the process.

Two things were wrong, and a bound alone would have fixed neither:

- **Nothing bounded the wait.** `lock_wait_timeout` had zero occurrences
  anywhere in `packages/`.
- **The widening swallows its failures.** That policy is right on boot — a
  migration must never take boot down, and correctness never depended on the
  widening having run — but on the flush it means `os migrate apply` reports
  success for work it did not do.

The flush now runs its widening ALTERs on **one pinned connection**, bounds
`lock_wait_timeout` to **120 seconds** on that same session, and lets exactly one
condition escape the swallow: a metadata-lock timeout is re-thrown as an ADR-0112
envelope — `DATABASE_ERROR` / 500, from the existing closed vocabulary — whose
message names the lock wait, the table, the bound it hit, and how to find the
holder. `os migrate apply` prints that message and exits 1.

The connection pinning is the load-bearing half: `lock_wait_timeout` is a SESSION
variable, so a `SET SESSION` issued through the pool lands on a connection the
ALTER never uses — a no-op that looks exactly like a fix.

**120 seconds** is chosen as a diagnosis deadline, not a capacity knob: three
orders of magnitude above the milliseconds a normal OLTP transaction holds a
metadata lock (so an ordinary busy table never trips it), and still inside the
window where the operator is watching the command. The widening is idempotent,
so the cost of firing too eagerly is one re-run.

Unchanged, deliberately: boot schema-sync still runs unbounded and still
swallows; every non-lock-wait failure during the flush keeps the swallow it had.
No retry logic and no configurability — both wait for measured demand.
