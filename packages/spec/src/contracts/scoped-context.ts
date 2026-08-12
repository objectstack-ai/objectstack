// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `IScopedContext` — the cross-object data channel a hook is handed as
 * `HookContext.api`, and the repository face it hands back.
 *
 * ## Why this exists (#5945, maintainer ruling C of 2026-08-07)
 *
 * `HookContext.api` was `z.unknown()`, so `HookContext['api']` inferred as
 * `unknown` and a handler typed the way every document teaches —
 * `handler: async (ctx: HookContext) => …` — could not call the channel those
 * same documents point it at:
 *
 *     error TS18046: 'ctx.api' is of type 'unknown'.    // ctx.api.object('x')
 *
 * The JSDoc on the key itself carried a two-line example that did not compile,
 * and the one doc block already under `check:skill-examples`
 * (`content/docs/kernel/runtime-services/examples.mdx`) could only get there by
 * declaring a private `type CrossObjectApi = { object(name): { findOne(…) } }`
 * and writing `ctx.api as CrossObjectApi` — a consumer-side cast standing in
 * for a contract, with no one checking its shape against the object the engine
 * actually binds. That is the direction contract-first exists to refuse: N
 * consumers, N hand-rolled slices, N chances to be wrong in a different way.
 *
 * The object the engine binds is ObjectQL's `ScopedContext`
 * (`packages/objectql/src/engine.ts`, built by `buildHookApi` at every hook
 * dispatch); `object(name)` returns its `ObjectRepository`. That class declares
 * `implements IScopedContext`, so every member below is verified against the
 * implementation on every objectql build — this is a checked contract, not a
 * seventh private slice with better manners.
 *
 * ## The evidence bar — what is declared here, and why not more
 *
 * A member is declared when the CORPUS CONTAINS A CALL of it on a hook's
 * `ctx.api` — a call being the thing that has to compile. That bar is the
 * ruling's, and it is the same "declare what has evidence" discipline
 * `IDataEngine` was argued into being under (#4251): the contract records what
 * is consumed, not a transcription of the class.
 *
 * Measured over `skills/`, `content/docs/`, `examples/`, `apps/` and this
 * file's own JSDoc, hook `ctx.api` call sites reach exactly seven members
 * (per-member file:line evidence is in PR #5945's body):
 *
 *   - `object(name)`   — every site; the only way into a repository.
 *   - `transaction(cb)` — `content/docs/api/error-handling-server.mdx`,
 *     `skills/objectstack-data/references/data-hooks.md` (the `api.transaction`
 *     capability row).
 *   - repo `findOne` / `find` / `count` / `insert` / `update` / `updateById`.
 *
 * DELIBERATELY NOT DECLARED, each with the reason, so the next reader can tell
 * "measured and excluded" from "overlooked":
 *
 *   - `upsert`, `delete`, `aggregate` on the repository. Real methods, but they
 *     appear in the corpus only inside METHOD/CAPABILITY TABLES
 *     (`data-hooks.md`'s repo table and its `api.write` row,
 *     `hook-bodies.mdx`'s capability table). A table row is prose: it never
 *     goes through a compiler, so declaring these buys nothing for the reason
 *     this interface exists. `create` and `delete` do occur as call text, but
 *     only inside `packages/lint`'s hook/action body-source FIXTURE STRINGS,
 *     which are inputs to a lint rule and likewise never type-checked.
 *   - `create` (an `insert` alias), `deleteById`, `execute` — no call site at
 *     all outside those fixtures.
 *   - `sudo()`. The one exclusion with a real cross-package caller — plugin-audit's
 *     `persistAuditTrailRow` and `resolveLookupTitles` both reach
 *     `api.sudo()` — and it is excluded ON PURPOSE rather than for lack of
 *     evidence, which is why it is called out instead of listed above. Every
 *     one of those callers holds the value as `any` (`api: any`,
 *     `(ctx as any).api`), i.e. none is a typed consumer this declaration would
 *     unblock; and `sudo()` is PRIVILEGE ESCALATION — putting it on the
 *     documented hook-author surface would advertise "bypass record-level
 *     permissions" as part of the first-hook vocabulary, which no document
 *     teaches and #5945's ruling did not authorize. The engine's own privileged
 *     writers reach it as the engine, not as a hook. Declaring it is a
 *     maintainer call, not a measurement.
 *   - The discrete `beginTransaction` / `commitTransaction` / `rollbackTransaction`
 *     trio, which exists for the sandbox RUNNER — it drives a body's
 *     `ctx.api.transaction(fn)` across host event-loop turns where the ambient
 *     `AsyncLocalStorage` does not survive — and not for hook authors, who get
 *     the callback form above (see the class doc in objectql).
 *   - `userId` / `tenantId` / `spaceId` / `roles` / `isSystem` /
 *     `transactionHandle` getters. A hook reads the caller from
 *     `ctx.session`, which is declared, typed, and carries the ADR-0090 D3
 *     vocabulary; routing that through a second spelling here would be a
 *     second dialect of one fact — and `roles` is a name ADR-0090 D3 bans
 *     outright (see the `HookContext.session.roles` tombstone).
 *
 * Growing this is a two-line change plus the call site that proves it: add the
 * member, add its evidence to the list above. Option A of #5945 — the full
 * repository face declared up front — was explicitly deferred to that rule
 * rather than taken now.
 *
 * ## Why the parameter types are loose, and what would be WRONG here
 *
 * The repository forwards its query straight to `IDataEngine`
 * (`{ ...query, context }`), so the obvious move is to type these parameters
 * with spec's own `EngineQueryOptions` / `EngineUpdateOptions`. That would be a
 * FALSE narrowing. The engine folds documented alias spellings before it reads
 * a query — `filter` → `where`, `top` → `limit` (`RPC_QUERY_ALIAS_SLOTS`,
 * applied in `find`, `findOne` and `update`) — and `data-hooks.md` teaches
 * `filter` as a tolerated object-valued alias, with a live snippet using it.
 * `EngineQueryOptions` declares no `filter`, so an object literal spelling it
 * would be rejected by excess-property checking: a compile error over a call
 * the runtime accepts and the docs teach. Contract-first cuts the other way
 * here — the option VOCABULARY is `EngineQueryOptions`' to own and the engine's
 * to enforce (it rejects undeclared option keys since #4371); this interface's
 * job is the METHOD FACE. So the query bag is an object, the returns mirror
 * `IDataEngine`'s (`Promise<any[]>` / `Promise<any>`), and nothing here claims
 * to be the query schema.
 */

import type { EngineTransactionInfo, EngineTransactionOptions } from './objectql-engine.js';

/**
 * A repository bound to one object AND to the calling hook's execution context
 * (user, organization, and the ambient transaction) — what
 * `IScopedContext.object(name)` returns.
 *
 * Scoping is the whole point: a write through here goes down the engine's
 * normal path and is therefore gated by the TARGET object's permission and
 * sharing rules, not by whoever happens to be elevated. An admin is not exempt;
 * the gate is `canEdit`. See `data-hooks.md` "cross-object writes obey the
 * target's sharing model".
 */
export interface IScopedObjectRepository {
    /**
     * Read every record the query selects.
     *
     * An unpredicated `find` is legitimate — returning every row is an honest
     * answer to a question that asked for every row.
     */
    find(query?: Record<string, unknown>): Promise<any[]>;

    /**
     * Read the ONE record the query selects, or `null`.
     *
     * The query MUST say which record it wants — a `where`, a `search` that
     * expands to one, or an `orderBy` meaning "the first in this order". A
     * query with none of those is REJECTED at runtime (#4419): `findOne` reads
     * a single row, so an empty predicate does not come back empty, it comes
     * back as the object's FIRST row — a real, plausible-looking record with
     * nothing to do with what was asked, which no `if (!row)` can catch. When
     * any row genuinely will do, that is `find({ limit: 1 })`, which says so.
     */
    findOne(query?: Record<string, unknown>): Promise<any>;

    /** Count the records the query selects. */
    count(query?: Record<string, unknown>): Promise<number>;

    /** Insert one record (or an array of records). */
    insert(data: any): Promise<any>;

    /**
     * Update records.
     *
     * The single-record form puts the primary key INSIDE `data` —
     * `update({ id, ...fieldsToChange })` — because the repository reads the
     * key out of the payload. The bulk form is `update(data, { where, multi: true })`;
     * there is no `updateMany`.
     */
    update(data: any, options?: Record<string, unknown>): Promise<any>;

    /** Update a single record by id — the id travels as the first argument. */
    updateById(id: string | number, data: any): Promise<any>;
}

/**
 * The scoped cross-object API a hook reaches through `ctx.api`.
 *
 * It carries NO top-level `insert` / `update` / `find`: a caller names the
 * object first and operates on the repository that comes back
 * (`ctx.api.object('task').insert(…)`). `content/docs/api/error-handling-server.mdx`
 * states that shape explicitly, and it is what makes the scoping legible —
 * every operation is addressed to a named object.
 */
export interface IScopedContext {
    /** The repository for `name`, bound to this context. */
    object(name: string): IScopedObjectRepository;

    /**
     * Run `callback` inside one driver transaction: committed when it returns,
     * rolled back when it throws.
     *
     * The callback receives a NEW `IScopedContext` whose operations share the
     * transaction handle — reach objects through THAT context (`tx.object(…)`),
     * not the outer one, or the writes land outside the transaction.
     *
     * ## Why the callback's second parameter is declared even though no corpus
     * site reads it
     *
     * The evidence bar above governs WHICH MEMBERS exist, not what a declared
     * member's signature is allowed to say. A parameter list describes what the
     * PRODUCER hands the callback, and the producer hands it two arguments
     * unconditionally (`ScopedContext.transaction`, #5696): declaring one would
     * be a false statement that additionally makes `async (tx, info) => …`
     * — legal, working code — a compile error. Contravariance means the
     * zero-argument and one-argument callbacks the corpus actually writes still
     * satisfy this, so the truthful signature is also the more permissive one.
     * {@link EngineTransactionInfo} is reused rather than re-spelled, for the
     * same reason `opts` is: ADR-0119 D1 and #5696 rule that this surface is a
     * second IMPLEMENTATION of `IObjectQLEngine.transaction`, never a second
     * DIALECT of it — `opts.require`'s fail-closed refusal is honoured here
     * identically, and a contract that omitted it would re-open in declaration
     * the dialect the implementation was made to close.
     */
    transaction<T>(
        callback: (trxCtx: IScopedContext, info: EngineTransactionInfo) => Promise<T>,
        opts?: EngineTransactionOptions,
    ): Promise<T>;
}
