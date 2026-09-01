# ADR-0119: Multi-write atomicity is reachable through the contract, `atomic` means atomic or refuses, and migrations too big for one transaction get a journal runner

**Status**: Accepted (2026-08-02) · **Amended** (2026-08-06, #5351/#5696 — D1's two caveats decided; see "Amendment (2026-08-06)" at the end) — D1/D4 implemented in [#4623](https://github.com/objectstack-ai/objectstack/pull/4623): D1 in `packages/spec/src/contracts/objectql-engine.ts` (test `packages/objectql/src/protocol-batch-atomic.test.ts`), D4 in `packages/metadata-protocol/src/protocol.ts` (test `packages/metadata-protocol/src/protocol.batch-atomic.test.ts`). D2 tracked in [#4617](https://github.com/objectstack-ai/objectstack/issues/4617); D3 tracked in [#4618](https://github.com/objectstack-ai/objectstack/issues/4618) — neither is implemented, so this record is *not* wholly "implemented".
**Renumbered**: published for one day as ADR-0118. Renumbered to 0119 because [ADR-0118 (非用户 actor 的平台契约)](./0118-non-user-actor-contract.md) merged first (10:37 vs 12:11 on 2026-08-02) and holds the number. Citations of "ADR-0118 D1/D2/D3/D4" written before 2026-08-03 mean this record.
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0034](./0034-transactional-writes-and-ambient-transaction.md) (the ambient `AsyncLocalStorage` transaction D1 declares — this ADR adds no mechanism to it), [ADR-0067](./0067-commit-history-and-rollback-for-ai-authoring.md) (D2 — the join-don't-nest rule that makes an outer transaction the sole owner of commit/rollback), [ADR-0049](./0049-no-unenforced-security-properties.md) (enforce-or-remove — the disposition method applied to `batch?` in D3 and to the `atomic` flag in D4), [ADR-0087](./0087-metadata-protocol-upgrade-contract.md) (D3's replayable migration chain — the metadata-side analogue of the data-side runner D2 specifies), [ADR-0008](./0008-metadata-repository-and-change-log.md) (the JSONL change log — the journal shape D2 deliberately does *not* reuse), [ADR-0060](./0060-conformance-ledger-platform-pattern.md) (framework-owned ledger pattern — the precedent for `sys_migration_journal`), [ADR-0117](./0117-owning-business-unit-record-stamp.md) (D8 — backfill plus a fail-closed enable gate, the migration posture D2 and D4 both inherit), [ADR-0078](./0078-no-silently-inert-metadata.md) (no silently inert declarations — why D2 rejects a pluggable journal store)
**Consumers**: `@objectstack/spec` (`contracts/objectql-engine.ts`, `api/batch.zod.ts`), `@objectstack/metadata-protocol` (`protocol.ts`, `host-engine.ts`, `sys-metadata-repository.ts`), `@objectstack/objectql` (the implementation — unchanged by D1), `@objectstack/rest` (the `/batch` routes — unchanged), and for D2: `@objectstack/core`, `@objectstack/platform-objects`
**Surfaced by**: [#4612](https://github.com/objectstack-ai/objectstack/issues/4612) — four migration-class tools queued behind the same missing primitive, each hand-rolling journal + compensation

---

## TL;DR

#4612 asks the platform to choose a debt: transactionalize the engine, bless a shared migration-journal primitive, or rule both out. Scoping the question found that the first option's expensive half was paid three majors ago — ADR-0034's ambient transaction is implemented, and hook/validation/internal reads already join it — while the *cheap* half was never done: `transaction` was never declared on the `objectql` slot contract, so plugin-space reaches it through structural casts and tools cannot reach it at all.

So this ADR does not pick one of the three. It separates what the four consumers actually need into what is already built (transactions), what is a five-line contract fix (D1), what genuinely needs new machinery because transactions cannot span it (D2 — the journal runner), and what is rot found on the way (D3, D4).

- **D1** — `transaction` joins `IObjectQLEngine`. The mechanism ships; only the declaration was missing.
- **D2** — a framework-owned migration-journal runner, specified here, implemented in #4617. Transactions are the per-chunk unit; the journal is what survives a crash.
- **D3** — `IDataEngine.batch?` is retired: declared, implemented by nobody, called by nobody (#4618).
- **D4** — `batchData`'s `atomic` flag becomes real or refuses. It opened no transaction; it broke a loop.

## Context

### The premise that did not survive scoping

#4612 prices option 1 as "a real design project, not a plumbing task", naming middleware/hook semantics inside a transaction, cache invalidation on rollback, and cross-driver support. That was the correct price in the abstract. It is not the price here, because ADR-0034 already paid it:

`ObjectQL.transaction()` (`packages/objectql/src/engine.ts#transaction`) opens a driver transaction and runs the callback inside an `AsyncLocalStorage` store; `buildDriverOptions` (`#buildDriverOptions`) lifts that ambient handle onto **every** driver call. The consequence is precisely the hard part the issue budgets for: a hook body, a validation predicate, an FK-resolution read, or any nested `engine.*` call issued during a transactional write automatically binds to that transaction's connection. ADR-0034 exists because *not* doing this deadlocked SQLite's single-connection pool — the failure was found, fixed, and pinned.

The issue's second premise is also stale in this repo: it cites `driver-turso` primitives at `turso-driver.ts:764-776` <!-- anchor-exempt: HISTORICAL --> and `remote-transport.ts:430-443` <!-- anchor-exempt: HISTORICAL --> as evidence the capability exists but is unsurfaced. There is no Turso driver here — only `docs/design/driver-turso.md` (Status: Proposal). The in-repo drivers need no surfacing work either:

> **Editorial note (2026-08-05, #4645):** the sentence above was true when this ADR was written. `@objectstack/driver-turso` has since been migrated back into this repo at `packages/drivers/driver-turso`. The *decision* recorded here is unaffected — Turso extends `SqlDriver` and inherits the same `beginTransaction` / `commit` / `rollback` members the argument turns on, so it needs no surfacing work either.
 `beginTransaction` / `commit` / `rollback` are **required** members of `IDataDriver` (`packages/spec/src/contracts/data-driver.ts#beginTransaction`), implemented by driver-sql (`packages/drivers/driver-sql/src/sql-driver.ts#beginTransaction`), driver-memory, and driver-mongodb.

### The gap that is real: declared reach

`IObjectQLEngine` (`packages/spec/src/contracts/objectql-engine.ts`) is the contract of the `objectql` service slot — what a plugin sees through `ctx.getService('objectql')`. It declares 25 members and not `transaction`. `IDataEngine`, behind the `data` slot, has no transaction member either. So a plugin typed to either contract cannot see the primitive, and the consumers that need it reach around the type system:

- `packages/metadata-protocol/src/protocol.ts` — the `/discovery` capability probe, `typeof (this.engine as { transaction?: unknown })?.transaction === 'function'`;
- `#publishPackageDrafts` — `publishPackageDrafts`' `inTxn`, a `typeof` probe plus `as unknown as { transaction: <R>(fn) => Promise<R> }`;
- `packages/metadata-protocol/src/sys-metadata-repository.ts` — a hand-declared local `transaction?` member on its own engine stub.

Each is an honest but **unchecked** claim about a class none of them import. This is the exact problem the contract file was created to end: its header records seven such local surfaces being merged into one checkable declaration, and states the bar for admitting a member — *"a member is declared here only where a CROSS-PACKAGE consumer already calls it through the service slot … Widening this is for whoever needs more, with the call site to prove it."* Three call sites already prove it. The evidence was there; nobody recorded it.

Below plugin space it is worse. A migration-class tool runs behind `McpDataBridge` (`packages/mcp/src/mcp-http-tools.ts#McpDataBridge`) — one record per call, no transaction, no batch — or behind `IObjectQLEngine`. The wire has an atomic cross-object route (`POST {basePath}/batch`, ADR-0034's D4 deliverable), but a route is not callable in-process. Hence the issue's accurate observation that plugin-visible multi-row mutation is a JS loop of single-row writes.

### Why transactions alone still do not close #4612

Granting every consumer `transaction()` would not let the four queued tools delete their journals:

- A **million-row backfill** (ADR-0117 D8's shape) cannot hold one write transaction for its duration — on SQLite that is the single writer lock for the whole run.
- `driver-memory.beginTransaction` deep-clones the entire database (`packages/drivers/driver-memory/src/memory-driver.ts#beginTransaction`), so it is O(database) per begin.
- `ObjectQL.transaction()` binds only the **default** driver (`packages/objectql/src/engine.ts#transaction`). Objects routed elsewhere by `setDatasourceMapping` are written outside the transaction, silently.
- A **process crash** — as opposed to a thrown error — defeats in-process compensation entirely. The issue says this plainly and it is the decisive point: no amount of transaction plumbing produces recoverability across a `SIGKILL` mid-run.

The honest shape is therefore *both*: the transaction is the unit of atomicity for a chunk; a durable journal is what makes a multi-chunk run recoverable. That is what the four consumers keep independently rediscovering, and what D2 standardizes.

### Rot found on the way

**`IDataEngine.batch?`** (`packages/spec/src/contracts/data-engine.ts#IDataEngine`) — the member #4612 opens with. Optional, so nothing must implement it; no engine does. Its entire specification is the three-word comment `Batch Operations (Transactional)` — nothing about partial failure, ordering, cross-object references, rollback scope, or what `transaction: false` means. `DataEngineRequest` is imported by exactly one non-spec file: the contract declaring it. Its request union (`packages/spec/src/data/data-engine.zod.ts#DataEngineRequest`) even nests batches recursively, a shape nobody designed against because nobody built it. The only test (`packages/spec/src/contracts/data-engine.test.ts`) constructs an ad-hoc literal with a `batch` property and asserts it is defined — it pins the type, not an implementation.

**`batchData`'s `atomic` flag** (`packages/metadata-protocol/src/protocol.ts#batchData`) — advertised as *"rollback entire batch on any failure (transaction mode)"*. It opens no transaction. It breaks the loop :

```ts
if (options?.atomic) {
    // Abort remaining operations on first failure in atomic mode
    break;
}
```

Everything already written stays written, and the response reports those rows `success: true` under a flag whose one job is to guarantee they were undone. This is #4346's class exactly — a write-path guarantee that is declared and not enforced, silent and destructive when it matters — and #4612 cites #4346 as evidence this write path is sharp. It is the same edge.

The declaration is inconsistent with itself too: `BatchOptionsSchema.atomic` declares `.default(true)` (`packages/spec/src/api/batch.zod.ts#BatchOptionsSchema`) while no enforcement site delivers atomicity, and the REST route deliberately forwards the original body rather than the parsed output, so the declared default never reaches the loop. The same file already tombstoned `validateOnly` for this exact shape — a flag promising a data-safety guarantee it did not keep — calling it *"the worst shape of 'declared ≠ enforced'"*.

## Decision

### D1 — `transaction` joins the `objectql` slot contract

`IObjectQLEngine` declares:

```ts
transaction<T>(callback: (trxCtx: any) => Promise<T>, baseContext?: any): Promise<T>;
```

verbatim from the class, so `ObjectQL implements IObjectQLEngine` continues to type-check and **no engine behaviour changes**. The member is REQUIRED, not optional, per the contract's own rule: it describes the slot's actual occupant, not a hypothetical minimal engine, and optional members only push guarded callers back toward the `any` this contract exists to remove. Callers that tolerate test doubles or foreign engines keep their `typeof === 'function'` runtime probes — that is defence the type system does not replace.

The three cast sites drop their casts. The two narrow host surfaces that must stay tolerant of stubs — `MetadataHostEngine` and the sys-metadata repository's engine — declare their member as `transaction?: IObjectQLEngine['transaction']`, optional locally but **typed from the contract**, so a narrow surface can no longer drift from the real signature.

Two caveats are written into the contract TSDoc as part of the member's declared meaning rather than left as behaviour a caller discovers: `transaction()` covers only the **default driver**, and when that driver lacks `beginTransaction` the callback runs **without a transaction and without rollback** (`packages/objectql/src/engine.ts#transaction`). Declaring a caveat is not fixing it; tightening these is #4619. A caller that cannot tolerate silent degradation must fail closed itself — which is what D4 does.

### D2 — the migration-journal runner is framework-owned (specified here, implemented in #4617)

For multi-step data reshaping that cannot fit in one transaction — long backfills, DDL interleaved with DML, steps spanning datasources — the framework owns the runner. Migration tools consume it; they do not hand-roll compensation loops. The design, in enough detail to implement from:

1. **Preflight dry-run.** Each plan step declares a read-only validator. The runner runs all validators before any write and refuses to start if any fails — ADR-0117 D8's fail-closed enable gate, generalized.
2. **Persistent journal.** A `sys_migration_journal` platform object, rows keyed `(run_id, seq)`, event kinds `run_started` (carrying the plan hash and chunk plan), `chunk_started(i)`, `chunk_done(i)`, `compensated(i)`, `run_done`, `run_failed`.
3. **Chunked writes.** Rows are chunked per the `packages/core/src/utils/bulk-write.ts` discipline. Each chunk's writes run inside `engine.transaction()`, and **`chunk_done(i)` is written inside that same transaction**, so `done ⇔ committed` is not a race. `chunk_started(i)` is written autonomously *before* it, making `started ∧ ¬done` mean exactly "outcome unknown" — the state a crash leaves behind.
4. **LIFO compensation.** On failure, walk completed chunks newest-first, running each step's declared `compensate` in its own transaction with a `compensated(i)` marker. A compensation failure journals and halts loudly; it is never swallowed.
5. **Re-entrant forward recovery.** On restart, scan for `run_started ∧ ¬run_done ∧ ¬fully-compensated` and resume forward from the first chunk lacking `chunk_done`, under a per-plan `onCrash: 'resume' | 'compensate'` policy.
6. **At-least-once, with idempotency made the caller's explicit job.** Forward and compensate callbacks receive an `attempt` counter; `attempt > 1` means the previous outcome is unknown and the callback must recheck by natural key before re-writing. This is verbatim the contract `bulk-write.ts` already documents — reuse it rather than re-deriving a second delivery-semantics story.
7. **Capability gate.** The runner refuses to start where real transactions are unavailable, using D4's probe.

The runner lives in `@objectstack/core` beside `bulk-write.ts`, typed against `IObjectQLEngine` (which D1 makes sufficient); the object lives in `@objectstack/platform-objects`.

**The journal is an engine-persisted platform object, not a caller-supplied `JournalStore` interface.** This is a decision, not an implementation detail, on three grounds. Recovery has to be re-entrant and discoverable with **zero host wiring** — a boot scanner needs one authoritative place to look for half-finished migrations, and a pluggable store fragments that authority per caller, which is ADR-0078's silently-inert failure mode in another costume: a journal nobody re-reads is a journal that does not exist. The journal is also data-plane state *about* the data plane, so keeping it in the same store puts it inside the same backup/restore and transaction boundary as the rows it describes — a side-file journal in the ADR-0008 JSONL shape desyncs from the database on restore, and ADR-0008 solved audit, which is a different problem from recovery authority. Finally, framework-owned `sys_*` tables with a registered schema are the established ledger pattern (ADR-0060).

### D3 — `IDataEngine.batch?` is retired

Declared, implemented by no engine, called by no caller, specified by three words. Under ADR-0049's enforce-or-remove posture the choice is implement it or delete it, and there is nothing to preserve: D1 gives in-process callers `transaction()`, D4 gives them an honest object-scoped atomic batch, and `POST {basePath}/batch` has served the wire since ADR-0034. Implementing it would mean designing partial-failure and nesting semantics for a shape no caller has ever asked for.

Mechanical removal is #4618, following the `spec-property-retirement` playbook's contract-member route: it is a TypeScript contract member, not an authorable metadata key, so there is no `retiredKey` tombstone to leave — nothing can author it, and the removal is visible only to TypeScript consumers, who get the FROM → TO prescription in the changeset and upgrade guide.

### D4 — `atomic` is real, or it is refused

`batchData` honours `options.atomic === true` by running the whole batch inside one `engine.transaction()`. The first failure aborts and rolls back every prior write, and — the part that makes it honest — **the response says so**: `succeeded: 0`, and every row reports failure, with rows before the failure marked `ROLLED_BACK:`, the failing row carrying its causal error, and rows never reached marked `NOT_ATTEMPTED:`. A response claiming `success: true` for a row that was rolled back is the bug, not merely a missing transaction.

Where the runtime **cannot** roll back — no `transaction()` on the engine, or a default driver without `beginTransaction` — an atomic request is **refused** with `501 NOT_IMPLEMENTED` rather than silently degrading to best-effort. This follows the cross-object `/batch` route's existing precedent (`packages/rest/src/rest-server.ts#NOT_IMPLEMENTED`) and uses the standard error catalog, so no new code enters the ADR-0112 ledger. Refusing is the whole point: silent degradation is how the flag came to lie in the first place, and a caller that asked for atomicity is exactly the caller who must not receive best-effort without being told.

`atomic` takes precedence over `continueOnError` — whose own description already scopes it to `atomic=false`, making this precedence documented rather than new. In atomic mode the upsert path's defensive `catch { insert }` fallback rethrows instead of retrying, because inside an aborted transaction the fallback insert can only fail with a secondary error that masks the real cause.

The declared default is aligned to the enforced one: `BatchOptionsSchema.atomic` becomes `.default(false)`. The direction matters. Making the runtime honour the declared `true` would flip every existing batch caller's failure semantics silently and fail-close every non-transactional deployment's ordinary batches; aligning the declaration to what every enforcement site already does changes nobody's behaviour, while ending the schema's false claim. Callers who were explicitly sending `atomic: true` now get what they always asked for.

## Alternatives rejected

**Declare `transaction` optional on `IObjectQLEngine`.** The contract header already settled this: optional members turn every guarded call into a `possibly undefined` error and push consumers back to `any`. The slot's occupant implements it; the contract describes that occupant.

**Make the runtime honour `atomic`'s declared `true` default.** Changes the failure semantics of every existing batch caller without opt-in, and turns ordinary batches into hard failures on any deployment whose driver cannot transact. Aligning declaration to enforcement is the change that costs nobody.

**Keep `atomic` best-effort with a documented caveat.** The flag's only job is the guarantee. A documented caveat on a data-safety flag is the `validateOnly` mistake this file already tombstoned.

**A caller-supplied `JournalStore` for D2.** See D2 — it fragments recovery authority and reintroduces the silently-inert failure mode the journal exists to prevent.

**Implement `IDataEngine.batch?` rather than retire it.** No caller has ever wanted its shape; D1 and D4 deliver its stated purpose with semantics somebody actually specified.

**Do nothing and bless the hand-rolled pattern (#4612's option 3).** Rejected on the issue's own evidence: four consumers converging independently on the same shape is a platform gap, and the copies differ in exactly the places that matter — `ImportUndoLog` (`packages/rest/src/import-runner.ts#ImportUndoLog`) journals per-row before-images; the publish path (`packages/metadata-protocol/src/protocol.ts#batchData`) captures a revert plan; `batchData` captured nothing at all and said it did.

## Consequences

- **Positive.** Plugin-space reaches multi-write atomicity through a checked contract rather than three unchecked casts; a rename of the engine method now breaks the build instead of breaking production. `batchData`'s atomic mode either delivers or refuses. The `/discovery` `transactionalBatch` capability becomes a probe clients can trust, because the thing it probes is now contract-declared. The four queued consumers get a specified runner to collapse onto (#4617), and D13 can proceed on its hand-rolled pattern meanwhile, as #4612 anticipated.
- **Negative / cost.** Callers who were sending `atomic: true` and silently getting best-effort will now see rollbacks and `501`s — that is the fix working, but it is a behaviour change for anyone who had adapted to the bug. `@objectstack/spec` and `@objectstack/metadata-protocol` take a minor bump.
- **Risk.** D4's rolled-back response asserts prior operations were undone, which is locally guaranteed only when `batchData` **owns** the transaction. Under ADR-0067 D2 a nested call joins an outer transaction and does not own its rollback; today every `batchData` caller is top-level, so the claim holds, but nothing enforces that it keeps holding — tracked as part of #4619.
- **Deferred, deliberately.** `transaction()`'s silent degrade, default-driver-only scope, and missing owned-vs-joined signal (#4619); the same fake-atomic in `deleteManyData` and `updateManyData`, plus the per-row result shape's divergence from `BatchOperationResultSchema` (#4620). Declaring D1 must not wait on perfecting the caveats.

## Test plan

Unit (`packages/metadata-protocol/src/protocol.batch-atomic.test.ts`):

1. Atomic batch whose second operation throws → the transaction is rolled back; the response reports `succeeded: 0` with `ROLLED_BACK:` / causal / `NOT_ATTEMPTED:` rows and no row reporting success; the third operation is never attempted.
2. Atomic batch that succeeds → committed once, and every operation received the open transaction handle in its context.
3. Engine without `transaction`, and engine whose default driver lacks `beginTransaction` → both refuse with `501 NOT_IMPLEMENTED`, having attempted **zero** writes.
4. `atomic` beats `continueOnError` when both are set.
5. Non-atomic batches behave exactly as before (no transaction opened; prior successes retained).
6. Atomic upsert whose update throws propagates rather than falling back to insert.

Integration against a real `ObjectQL` with a transaction-capable driver (`packages/objectql/src/protocol-batch-atomic.test.ts`), covering ADR-0034's test-plan spirit end to end:

7. Atomic multi-row batch commits every row, with one commit and one shared handle.
8. A poisoned row rolls back the whole batch — zero rows persisted.
9. An atomic upsert's internal `findOne` runs on the transaction's connection (the no-deadlock pin ADR-0034's absence of coverage originally cost us).
10. The engine typed as `IObjectQLEngine` can call `.transaction` with no cast — a compile-time pin on D1.

---

## Addendum (2026-08-03) — the D4 row marking became structured, and the deferred shape divergence is closed

Two of the items this record deferred are now landed, and one detail of D4's
wording is superseded by them:

- [#4620](https://github.com/objectstack-ai/objectstack/issues/4620) (PR #4798)
  extended D4's real-or-refused `atomic` to `deleteManyData` / `updateManyData`
  through one shared runner.
- [#4793](https://github.com/objectstack-ai/objectstack/issues/4793) closed the
  per-row result shape's divergence from `BatchOperationResultSchema` — the
  reconciliation D4 deliberately kept off its bug fix. The rows of all three
  bulk-write endpoints now deliver the declared shape (`errors: ApiError[]`,
  `data`, `index`), pinned by a conformance test
  (`packages/metadata-protocol/src/protocol.batch-row-conformance.test.ts`)
  that parses every emitted row against the schema.

With that migration, the `ROLLED_BACK:` / `NOT_ATTEMPTED:` **message-string
prefixes** this record's D4 text and test plan describe are superseded by
**structured codes**: the same two words are now `errors[0].code` values
registered in the ADR-0112 `ERROR_CODE_LEDGER`, with the message carrying only
the human-readable cause and causal row index. The D4 invariant is unchanged —
a rolled-back batch reports zero successes and every row says what happened to
it; only the encoding moved from a prefix convention a client had to regex to a
code a client branches on.

---

## Amendment (2026-08-06, #5351 / #5696) — D1's two caveats are decided: the handle never crosses drivers, business writes across drivers are refused, and system ledgers are carved out

D1 wrote two caveats into the contract TSDoc and said plainly that "declaring a
caveat is not fixing it; tightening these is #4619." Both are now tightened.
This amendment records what they became and, as importantly, the one thing that
turned out to be **factually wrong** in the original wording.

### The caveat text was wrong about what actually happened

D1's TSDoc said that objects routed elsewhere by `setDatasourceMapping` "are
written outside" the transaction. They were not. `buildDriverOptions` lifted the
ambient handle onto **every** driver call without asking which driver was about
to receive it, so the second driver was handed the FIRST driver's transaction
object. On the in-memory doubles that is invisible; on knex it means
`.transacting(trx)` sends the statement down the owner's connection, into a
database that may not even contain the table.

That is what #5351 measured on a real boot: `sys_audit_log` — routed to the
dedicated `telemetry` datasource by ADR-0057 §3.6 — took 52 insert attempts, 50
succeeded, and the 2 failures were exactly the 2 whose stack carried a knex
`trxClient.query` frame, failing `no such table: sys_audit_log` against the
primary database. Every audited write performed **inside a transaction** lost
its compliance row, silently, with no retry: the business write succeeded, the
API returned 200, and only the record of who did it was gone. PR #5724
reproduced the same handle crossing on pure in-memory doubles with no lifecycle
routing at all (`expected { __trx: 'primary' } to be undefined`), proving the
defect belongs to the transaction seam and not to audit or to SQL.

### D1-R1 — a transaction handle never reaches a driver that does not own it

`TransactionScope` (#4619 / PR #5724) already records the owning driver by
**instance identity** — names collide transiently in `registerDriver`, and
identity is what decides which connection a statement rides.
`buildDriverOptions` now consults it: the handle is threaded only when the
resolved driver IS the owner. This is structural and verb-agnostic — it covers
reads as well as writes, which had the same defect and no diagnostic of their
own.

### D1-R2 — a cross-driver BUSINESS write inside a transaction is refused

`CrossDatasourceTransactionWriteError` (`ERR_CROSS_DATASOURCE_TRANSACTION_WRITE`),
thrown at the top of `insert`/`update`/`delete` before any hook, default or
validation runs, so a refusal has cost the caller nothing. The message names
both datasources and both remedies: keep one transaction on one datasource, or
split into per-datasource units the caller reconciles.

This is #5696 point 2 and it is **not** cross-driver atomicity. Two-phase commit
is not in `IDataDriver` and is deliberately out of scope (#4619 excludes it);
opening a companion transaction on the second driver would replace a known
durability risk with a worse one — two stores that can contradict each other
when the second commit fails.

### D1-R3 — append-only SYSTEM LEDGERS are carved out, and may be orphaned

Objects whose `lifecycle.class` is `audit`, `telemetry` or `event` — the
append-only ledgers ADR-0057 §3.6 routes to a dedicated datasource — are
**executed outside** the ambient transaction, on their own connection, rather
than refused. They therefore **survive a rollback** of the business
transaction: an audit row may describe a write that was undone.

That cost is accepted deliberately, and the direction matters more than the
count. For an append-only compliance ledger a spurious row is a **reconcilable**
nuisance — it can be checked against the business data that is or is not there
— while a **missing** row for a write that DID commit is an unrecoverable
compliance hole, and the missing row is what was shipping. Refusal is also not
available here even in principle: the write is made by an `afterInsert` audit
hook whose `try/catch` turns any refusal back into a log line and drops the row
exactly as before. That coupling is why #5696's refusal and this carve-out had
to land in one batch rather than in PR order.

The discriminator is the object's **declared** `lifecycle.class`, not the
routing mechanism that moved it. An audit ledger pinned to its own datasource by
an explicit `datasource:` binding is the same append-only ledger with the same
reason to be carved out; judging by mechanism would make a compliance guarantee
depend on which of three equivalent configurations an operator happened to
write. The class tuple lives in exactly one place
(`ObjectQL.SYSTEM_LEDGER_LIFECYCLE_CLASSES`), read by both the ADR-0057 §3.6
routing step and this gate, because two copies would drift by one class and lose
precisely the row this change exists to save.

### D1-R4 — `opts.require` makes the degrade a caller's choice

The other caveat — a driver with no `beginTransaction` runs the callback with no
transaction and no rollback — keeps its default behaviour exactly (warn once,
#4619). `transaction(cb, base, { require: true })` turns it into a throw
(`TransactionUnsupportedError`, `ERR_TRANSACTION_UNSUPPORTED`) for callers whose
only reason to open a transaction is the rollback. This generalizes D4's
real-or-refused posture from `batchData` into the primitive itself.

### D1-R5 — the callback is told whether it owns the transaction

`transaction(cb, base, opts?)` passes `{ owned: boolean }` as the callback's
second argument: `true` when this call opened the transaction, `false` when it
JOINED an outer one (ADR-0067 D2) or ran on the degrade path where there is no
transaction to own. D4's rollback guarantee, and any caller guarantee phrased as
"this whole unit rolls back together", holds only for the owner; before this
signal a joined callback had no way to know which it was.

### The declared LIMIT of the same-origin gate

The gate judges only handles it can attribute. `TransactionScope` exists for
every transaction the engine opens, and an explicitly-threaded handle is matched
back to the store entry by identity — so the dominant path (`transaction()`
hands you `trxCtx`, you thread it as `{ context: trxCtx }`) is covered.

**Not covered**, by decision rather than oversight: `ScopedContext`'s discrete
`beginTransaction`/`commit`/`rollback` trio, which threads its handle across
`setImmediate` boundaries where AsyncLocalStorage does not survive and therefore
never populates `txStore`; and any handle an outside caller obtained elsewhere
and passed in as `execCtx.transaction`. For those the engine holds an opaque
driver object with no back-reference to its owner, so there is no honest
comparison available. Guessing — assuming an unattributed handle belongs to the
default driver — would refuse legitimate single-datasource work on one side and
carve out genuinely-covered writes on the other. The pre-#5351 behaviour stands
on that path, is pinned as such in
`packages/objectql/src/engine-transaction-same-origin.test.ts`, and closing it
requires handle ownership to become discoverable on `IDataDriver` — a
driver-contract change, tracked separately.

### Consumer impact

Single-datasource deployments — the overwhelming majority — see no change of any
kind: no refusal, no carve-out, and nothing logged. The gate is reachable only
where a second datasource is registered AND an object routes to it AND a
transaction is open.

**Decided by**: the maintainer, 2026-08-06, on #5351 (plan A + this revision)
and #5696 (P2, batched forward to the same implementation). **Implemented in**:
`packages/spec/src/contracts/objectql-engine.ts`,
`packages/objectql/src/engine.ts`,
`packages/objectql/src/transaction-errors.ts`. **Pinned by**:
`engine-transaction-same-origin.test.ts` (18 cases) and
`engine-transaction-contract.test.ts` (15 cases). The `error`-level split
diagnostic PR #5724 added is retired by D1-R2/R3 — there is no longer a split to
report — and its section of `engine-transaction-observability.test.ts` moved to
the same-origin file, re-asked against the decided verdict.
