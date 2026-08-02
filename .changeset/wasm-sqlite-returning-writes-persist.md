---
"@objectstack/driver-sqlite-wasm": patch
---

fix(driver-sqlite-wasm): a `RETURNING` write is a write — persist it (#4518)

A file-backed `sqlite-wasm` database flushed its schema at boot and then
recorded nothing else. Every table was on disk; every row written after schema
sync lived only in the WASM heap and died with the process. Reopening the file
found a complete, empty database.

**Cause.** The Knex dialect picked its execution branch from *"does this
statement return rows"* — and then marked the database dirty only on the other,
row-less branch. `INSERT … RETURNING *` returns rows, so it executed on the
row-returning branch and never set the flag. Since the `on-disconnect` flush is
gated on the same flag, nothing rescued it afterwards either: **both** persist
strategies dropped the write. ObjectQL writes through `RETURNING *` (it hands
the stored row back to the caller), so this covered essentially all business
data, along with `knex.raw('INSERT …')` and any other mutation arriving without
a Knex `method`.

**Fix.** "Does this statement change the database?" is now one exported
predicate — `statementMutatesDatabase(sql, method)` — classifying by Knex method
*and* SQL text, applied at a single funnel after execution. It is independent of
which branch executed the statement, so a mutation can no longer slip through by
returning rows, by arriving without a method, or by taking a branch that forgot
to say so. Transaction control still routes to `noteTransactionControl`, which
keeps deferring flushes until the transaction closes (#1494), and mutating
`PRAGMA` assignments (`auto_vacuum`, `user_version`) now count as writes too.

**What changes for you.** Nothing to author. File-backed wasm SQLite now
actually persists under `on-write` / `debounced:*`, and `disconnect()` is a real
durability boundary: when it returns, committed data is on disk. This is what
`bootStack({ databaseFile })` in `@objectstack/verify` needed to make `stop()` →
second `bootStack` a genuine cold boot — the suspended-run restart proof
ADR-0019 promises is now asserted end to end in the dogfood gate. Expect more
disk writes than before on a file-backed dev database, because previously there
were almost none.

**One internal signature moved.** `WasmSqliteConnection.markDirty(method?)` is
now `markDirty()`. It used to re-filter the caller's Knex method against its own
allowlist, which made "did this mutate?" a decision taken in two places that
could — and did — disagree. If you call it directly, drop the argument; the
dialect classifies, the connection obeys.
