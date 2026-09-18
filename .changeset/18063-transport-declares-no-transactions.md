---
"@objectstack/spec": minor
"@objectstack/objectql": minor
"@objectstack/driver-sql": minor
"@objectstack/driver-turso": minor
---

feat(spec,objectql,driver-sql,driver-turso): a transport can declare it has no transactions, and the engine gates on the declaration instead of method presence (#18063)

Maintainer ruling, decision batch #148 item 3, letter B, 「同意」 2026-09-17, verbatim and untranslated:

> `packages/spec`: the driver contract gains a way for a transport to **declare 「no transactions」** (the dev picks the smallest spelling the existing capability/contract surface already has — a capability bit is preferred over a new key), and the engine's transaction gating reads the declaration instead of method presence.

**`DriverCapabilities` gains one live bit, `transactionsUnsupported`.** A transport sets it to say that a handle it issued would be a FALSE SUCCESS rather than a missing feature: the caller gets a handle, the writes execute and are already durable, `rollback()` resolves and undoes nothing. Absence means `false`, exactly like `batchSchemaSync`, so a driver that declares nothing keeps the behaviour it has today.

**⛔ This is not `DriverCapabilities.transactions` un-retired, and the difference is not cosmetic.** That key was tombstoned in 17.0.0 under ADR-0049 enforce-or-remove and STAYS tombstoned — writing it is still a compile error and still a parse refusal carrying its prescription. It claimed "I support transactions" and nothing read it; this one declares "my transport cannot honour one" and the engine dispatches on it. Reviving the name would have inverted the record's own `absence = false` convention into a tri-state, turned a documented refusal into silent acceptance of a value whose meaning had changed underneath it, and made the tombstone's published text ("no code in any repository ever read it") false. A new key costs one bit; the name costs all of that.

**Adding a bit to a record enforce-or-remove has pruned SATISFIES that ADR rather than reversing it.** The audit removed thirty-one bits for one stated reason — no code anywhere read them — and kept the three where method presence provably cannot carry the signal. This change is the creation of the missing reader: `driverSupportsTransactions()` (exported from `@objectstack/spec`) is the one definition of the gate, and every transaction entrance in the engine calls it. The bit arrives WITH its reader, in the same change, which is the honest order the ADR asks for.

**Why method presence could not carry it.** `TursoDriver extends SqlDriver`, whose `beginTransaction()` opens a real knex transaction, so the inherited method reported the libSQL REMOTE transport as transactional. It is not — `RemoteTransport`'s data methods take no `options` argument at all, so a handle cannot reach the statement that would have to join it. A subclass cannot opt out of a door it did not open. This is the mirror of `batchSchemaSync`, which exists because a subclass can inherit `syncSchemasBatch` from a base whose transport batches while its own cannot.

**What changes for a caller.** On a datasource whose driver declares the bit, `engine.transaction()` now takes the DECLARED non-transactional path (ADR-0119 D1) instead of opening a transaction it cannot honour: the degrade warns once per datasource — naming the declaration, not a missing method — and `{ require: true }` throws `TransactionUnsupportedError` before the callback writes anything. `ScopedContext.transaction` and the discrete begin/commit/rollback trio read the same predicate; the trio's `begin` returns `null`. Both are the answers a driver with no `beginTransaction` already received.

**`driver-turso`.** The remote face declares `transactionsUnsupported: true`; local and embedded-replica inherit `false` from the base and are untouched. `TursoDriver.beginTransaction()` publishes the inherited declaration instead of `Promise<any>` — the annotation the earlier `any` was masking an LSP violation to avoid, dissolved rather than widened: the remote arm returns `never` (it refuses), so the only arm that still returns is the base's. `SqlDriver.beginTransaction()` keeps its narrow `Promise<Knex.Transaction>`; nothing in the base was widened.

**`RemoteTransport` loses `beginTransaction()`, `commit()` and `rollback()`.** They are a published surface, and this is **minor** rather than major on the ruling's own stated ground: that transport never honoured a transaction, so no working behaviour is withdrawn. They had already become unreachable from every caller in the repository when the driver started refusing them; they are now gone, and the declaration keeps them gone by design rather than by audit.
