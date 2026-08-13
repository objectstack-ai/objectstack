---
"@objectstack/driver-sql": patch
---

fix(driver-sql): the first concurrent autonumber insert from two tenants no longer fails on Postgres with `25P02` (#8269)

On Postgres, two tenants inserting into the same autonumber-bearing object **for
the first time concurrently** failed the whole batch with `25P02 current
transaction is aborted, commands ignored until end of transaction block`. The
counters advanced anyway, so the numbers that attempt had reserved were lost —
a permanent gap at the start of both tenants' sequences. The user-visible story
was *"creating the first records failed; I retried, it worked, and my numbering
starts at 0004."*

`getNextSequenceValue` handled the first-insert race the way the idiom is
usually written — catch the unique violation, then recover **on the same
transaction**:

```ts
try {
  await trx(SEQUENCES_TABLE).insert({ ...insertRow, last_value: initial });
} catch (err) {
  existing = await trx(SEQUENCES_TABLE).where(key).forUpdate().first(); // 25P02
}
```

On Postgres any statement error aborts the entire transaction, so the recovery
`SELECT … FOR UPDATE` **is** the statement that raises the error — the recovery
path could never run there. SQLite and MySQL do not abort on a statement error,
which is why the pattern looked correct, and why the SQLite-backed autonumber
suite could not catch it.

Both speculative statements now run under a `SAVEPOINT`, released on success and
rolled back to on failure, so a failed attempt leaves the surrounding
transaction usable on every dialect. The race handler that was written for this
case now actually runs: the loser of the first-insert race blocks on the
winner's row, reads the committed counter, and takes its number from the UPDATE
path.

**Scope of the second site.** The `SELECT … FOR UPDATE` fallback a few lines
above had the same shape and the same consequence. Its comment attributed it to
dialects that "reject `.forUpdate()` on a missing row" — measured on
`postgres:16`, that does not happen (a missing row returns zero rows), but the
catch is reachable for lock-level failures (deadlock `40P01`, lock/statement
timeout `55P03`/`57014`), and each of those was being masked as an
uninformative `25P02` by the fallback read. It is now under the same savepoint.

**Not multi-org-only.** The report measured single-tenant bursts as safe; they
are only *flakier*. Measured before the fix, 5 rounds each of one tenant × N
cold concurrent inserts failed 0/5 (N=2), 1/5 (N=4), 3/5 (N=6) and 2/5 (N=12)
with the same `25P02`. Two tenants means two cold counter rows, which makes the
window near-certain to be hit rather than occasional — an amplifier, not a
precondition. Single-organization deployments were exposed too.

Unchanged: what happens to numbers on a failed attempt. The reservation still
commits in its own transaction and is not rolled back with the caller's insert,
which is ordinary sequence semantics. SQLite and MySQL behaviour is unchanged —
the savepoint makes Postgres behave the way they already did.
