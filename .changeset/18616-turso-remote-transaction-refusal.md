---
"@objectstack/driver-turso": minor
---

`TursoDriver` in **remote** mode now **refuses** transactions with `NOT_IMPLEMENTED` / `501` instead of accepting them and silently doing nothing with them. Local and embedded-replica modes are unchanged — they inherit `SqlDriver`'s knex transactions and still honour `options.transaction`.

**What was wrong.** `@objectstack/spec`'s `driver.zod.ts` states the delivery mechanism verbatim: *"A transaction handle to be passed to subsequent operations via `options.transaction`."* On the remote transport nothing could receive it. `RemoteTransport` names a transaction in exactly three members (`beginTransaction()`, `commit(t)`, `rollback(t)`) and **zero** of its data methods take an `options` argument at all — against 13 data methods present in the file, which is what makes that zero a reading. So a write issued between `beginTransaction()` and `rollback()` executed on the plain connection, was **already durable**, and the rollback resolved having undone nothing. Every step reported success.

**What refuses now**, on the remote arm only:

- `beginTransaction()`, `commit()` and `rollback()` — the capability is never handed out, so the sequence above cannot start.
- Any driver method that arrives carrying `options.transaction` — `find`, `findOne`, `count`, `aggregate`, `create`, `update`, `upsert`, `delete`, the three bulk methods, `updateMany`, `deleteMany`, `execute`, `syncSchema`, `syncSchemasBatch`, `dropTable`. This second door is not redundant: the engine's `buildDriverOptions` reads `execCtx.transaction` **first**, so a handle threaded through `ExecutionContext` reaches a data method without ever passing through `beginTransaction()`.

The refusal fires on the **handle**, not on remote mode: a remote call with no transaction in it is untouched, which is every call the platform makes today. It is raised before any statement is built, so a refused call costs no round trip and leaves no partial write.

**If this refusal now fires for you, it is telling you that you never had the transaction.** The remedies, in order: use the **local or embedded-replica** transport for work that needs atomicity; or take the non-transactional path deliberately — `engine.transaction()` without `require: true` on a driver with no transactions runs the callback with no rollback and says so (ADR-0119 D1). `NOT_IMPLEMENTED` / `501` rather than a `400` because the request is spelled correctly and the spec declares the members: the gap is the backend's, the same two-class taxonomy this driver already applies to remote `auto_number`, aggregate functions and date buckets.

Implementing real transactions on the remote transport is a separate, larger piece of work and is deliberately **not** part of this change.
