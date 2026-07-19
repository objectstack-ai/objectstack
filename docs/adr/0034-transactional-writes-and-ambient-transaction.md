# ADR-0034: Robust multi-write transactions (ambient transaction context)

**Status**: Accepted — implemented (v8.0.0) (calibrated 2026-06-12)
**Author**: surfaced while implementing the cross-object atomic batch (issue #1604) + autonumber sequence (issue #1603)
**Affects**: `@objectstack/objectql` (engine), `@objectstack/driver-sql` (and every driver), `@objectstack/rest`

---

## TL;DR

The runtime cannot reliably perform **multiple writes inside one transaction**.
A `engine.transaction(async () => { await insert(A); await insert(B); })`
**deadlocks** on the SQLite single-connection pool and leaves the connection
wedged. This blocks every feature that needs atomic multi-object writes —
master-detail save (#1604), approvals, automation chains, bulk actions. It must
be fixed at the foundation **before** those features can be correct.

---

## Context

### Reproduction (confirmed)

A cross-object batch endpoint (`POST /api/v1/batch`) that wraps N operations in
`ql.transaction(...)` was implemented and joint-tested against app-showcase:

- ✅ single write commits;
- ✅ a batch whose later op throws **rolls back** (true atomicity);
- ❌ **two successful writes + commit hangs**, and the hung transaction holds
  the one SQLite connection, so every subsequent write (even single-op) also
  hangs until the server is restarted.

The endpoint was reverted — shipping a route that can wedge the backend is
unacceptable — and the finding documented in issue #1604.

### Root cause

`app-showcase` (and the default standalone runtime) use **knex +
better-sqlite3** with a **single-connection pool** (SQLite is single-writer).

`engine.transaction()` threads the open transaction into the driver options of
the *top-level* write via `buildDriverOptions` (`engine.ts`, which even warns
about this deadlock around L1811). But internal reads/writes performed **during**
a write — FK / reference checks, hook `api` calls, any helper query — do **not**
all reuse the transaction's connection. Such a query asks the pool for a
connection, the pool is exhausted (the transaction holds the only one), and it
waits forever → deadlock.

The single top-level threading is necessary but **not sufficient**: correctness
requires that *every* data operation issued while a transaction is open runs on
that transaction's connection.

### Relevant existing facts

- `driver-sql` already has the right *local* pattern for nested work:
  `getNextSequenceValue` uses `runner = parentTrx ?? this.knex` and opens a
  savepoint on the parent transaction (`sql-driver.ts` L561-563). The gap is
  that this discipline isn't applied *globally* to every engine→driver call.
- `driver-sql` already implements a **persistent, atomic sequence**
  (`SEQUENCES_TABLE` + `getNextSequenceValue` with `forUpdate` + seed-from-max,
  L548-600). See "Autonumber (#1603)" below — this is mostly already solved at
  the driver level.

---

## Decision

### 1. Ambient transaction context (the foundation)

Make the active transaction **ambient** rather than passed by hand. Use Node's
`AsyncLocalStorage` to store the current transaction handle for the duration of
`engine.transaction(callback)`. Every driver call reads the ambient transaction
and binds its query to it (`.transacting(trx)`) automatically — no caller, hook,
validation predicate, or internal helper can forget to thread it.

```ts
// engine
private readonly txStore = new AsyncLocalStorage<{ transaction: unknown }>();

async transaction(cb, baseContext) {
  const trx = await driver.beginTransaction();
  return this.txStore.run({ transaction: trx }, async () => {
    try { const r = await cb({ ...baseContext, transaction: trx }); await driver.commit(trx); return r; }
    catch (e) { await driver.rollback(trx); throw e; }
  });
}

// buildDriverOptions / driver: prefer explicit opts.transaction, else fall back
// to the ambient one.
const trx = opts.transaction ?? engine.txStore.getStore()?.transaction;
```

This keeps the explicit `options.transaction` path working and makes the
*implicit* internal queries correct.

### 2. Per-transaction connection

For pooled drivers, a transaction must own a connection for its lifetime
(knex transactions already do). The fix above guarantees that no *other* query
competes for it. For SQLite specifically, keep `pool.max = 1` and rely on (1)
so nothing else asks for a connection mid-transaction; for Postgres/MySQL the
pool naturally hands each transaction its own connection.

### 3. Autonumber (#1603) — consolidate, don't rebuild

`driver-sql` already provides a persistent, atomic, gap-tolerant sequence.
The engine-level in-memory counter added for the validation-order fix is
redundant and itself issues a non-transactional seed query. Plan: have the
engine **defer autonumber generation to the driver's sequence** (keeping the
"generate before required-validation" ordering), and delete the in-memory
counter. Gaps on rollback are accepted (industry-standard for sequences).

### 4. Then unblock the features

Once (1)+(2) land and a multi-write transaction test suite is green:
- Re-add `POST /api/v1/data/batch` (cross-object, `$ref` for intra-batch parent
  references) — the implementation from #1604 is ready.
- Point ObjectUI `masterDetailTx` at it and delete the client-side best-effort
  cleanup (a smell that exists only because server atomicity was missing).

> **Status (framework side: done).** The endpoint landed as
> `POST {basePath}/batch` (`rest-server.ts` `registerBatchEndpoints`, spec
> contract `CrossObjectBatchRequestSchema` in `spec/src/api/batch.zod.ts`),
> and the SDK exposes it as `client.data.batchTransaction(operations)`
> (plus the environment-scoped mirror). The SDK method is always atomic and
> exposes no `atomic` flag — non-atomic per-object bulk writes stay on
> `data.batch()`/`createMany`/`updateMany`, so any best-effort fallback must
> be isolated in the caller's adapter. Remaining (objectui repo): repoint
> `masterDetailTx` at `batchTransaction` and delete the client-side
> best-effort cleanup, keeping the non-atomic fallback inside the
> `data-objectstack` adapter only.

---

## Consequences

- **Positive**: atomic multi-write becomes a platform guarantee; master-detail,
  approvals, automations, bulk actions become correct by construction; the SDUI
  client gets thinner.
- **Risk**: (1) touches the engine's shared write path — must land with a
  cross-driver multi-write commit/rollback test suite (the absence of which let
  this bug exist) and careful review. This is a dedicated, reviewed PR, not a
  drive-by change.

## Test plan (the missing coverage)

Add an integration suite (per driver: memory, sql/sqlite, and at least one
networked DB in CI) asserting:
1. `transaction(() => { insert A; insert B; })` commits both;
2. a throwing op rolls back **all** prior writes;
3. a write whose validation/hook performs an internal read does not deadlock;
4. master-detail create (parent + children referencing it) is atomic.
