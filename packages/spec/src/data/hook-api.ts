// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `HookApi` — the typed AUTHORING face of `HookContext.api`, published from
 * `@objectstack/spec/data` so an app's `*.hook.ts` never has to re-derive it.
 *
 * ## Why this exists (#18163, maintainer ruling A of 2026-09-17, batch #147)
 *
 * The platform already implements this surface; it just never published a type
 * an app could import. So every metadata app hand-declared one — the reference
 * third-party app carried ~2,358 authored tokens of it in one file, imported by
 * 17 hook files — and a hand-declared copy of an engine's option vocabulary
 * drifts silently the moment the engine moves. The ruling reads that as a
 * STABILITY item, not a feature: one source of truth for engine semantics.
 *
 * ## What it is NOT: a second dialect of `IScopedContext`
 *
 * `contracts/scoped-context.ts` declares {@link IScopedContext} — the CHECKED
 * IMPLEMENTATION contract. ObjectQL's `ScopedContext` (the class the engine
 * builds at every hook dispatch, `buildHookApi`) and its `ObjectRepository`
 * carry `implements` clauses against it, so it is verified on every objectql
 * build. Its option bags are deliberately `Record<string, unknown>`, and that
 * file argues at length why: typing them with the engine's own option types
 * would make an object literal spelling `filter` a compile error over a call
 * the runtime accepts, because the engine folds `filter` to `where`.
 *
 * This file is the OTHER half of the same fact, and the ruling is what settles
 * the trade-off the older file left open:
 *
 *   - `IScopedContext` answers "what members does the object the engine binds
 *     have?" — evidence-barred, loose in the bags, wired to `implements`.
 *   - `HookApi` answers "what may a hook author WRITE into those bags?" — the
 *     canonical spelling only, so the `where`/`filter` mixing hazard is a
 *     compile error FROM THE PLATFORM'S OWN TYPE instead of a runtime throw.
 *
 * They do not drift, because every option shape below is DERIVED from the very
 * `Engine*Options` schemas the engine's own per-method legal-key sets are
 * pinned against (`ENGINE_OPTION_KEY_SETS` in `packages/objectql/src/engine.ts`,
 * drift-pinned in `engine-unknown-option.test.ts`). A key added to a schema
 * flows into the type the same run it flows into the engine's accepted set.
 * `hook-api.test.ts` pins the relationship in both directions.
 *
 * ## The `where`-only rule, measured
 *
 * `RPC_QUERY_ALIAS_SLOTS` (`data/data-engine.zod.ts`) declares `filter` as the
 * alias of `where` and `top` as the alias of `limit`. Every engine entry point
 * folds the `where` slot; the find-shaped ones (`find`/`findOne`) additionally
 * fold `limit`. `foldQueryAliasSlots` collapses redundant IDENTICAL spellings
 * and REFUSES a slot whose spellings carry DIFFERENT values — the engine turns
 * that conflict into a throw naming both spellings. So `{ where, filter }` is
 * a coin toss decided by whether the two happen to be deep-equal: silent when
 * they agree, a runtime error when they do not.
 *
 * Omitting the alias keys from these types is what makes it neither. It is the
 * ruling's explicit instruction for `filter`, and the SAME measurement carries
 * `top`: both are alias spellings of a canonical key, both throw on a value
 * disagreement, neither adds any expressive power. Authors spell `where` and
 * `limit`. ⚠️ REVIEW POINT — the ruling names `filter`; extending it to `top`
 * is this file's reading of the same rule, and is the one place a reviewer
 * should decide whether the type should be wider than the ruling's letter.
 *
 * ## What else is deliberately off the bags, each with its reason
 *
 *   - `context` — the repository INJECTS it (`{ ...query, context: this.context }`,
 *     spread last), so a caller-supplied `context` is overwritten before the
 *     engine sees it. Declaring a key the seam discards is the declared-≠-enforced
 *     shape AGENTS.md PD #10 refuses.
 *   - `cursor` / `distinct` / `upsert` — `retiredKey()` tombstones. They stay on
 *     the schemas to carry their migration text; the engine rejects them by
 *     quoting that text. They are not part of an authoring surface published
 *     after their retirement.
 *   - `sudo()` — the #5945 exclusion STANDS. It is privilege escalation, no
 *     document teaches it as first-hook vocabulary, and since #14010 the
 *     declared way for a hook to run elevated is `Hook.runAs: 'system'`, which
 *     the engine applies to this very `api`. Publishing it here would be a
 *     maintainer decision, not a measurement.
 *   - `aggregate` / `execute` / `create` / `deleteById` on the repository. Real
 *     methods on the class, outside what this ruling asked to publish;
 *     `execute` additionally dispatches ELEVATED (`{ ...context, isSystem: true }`,
 *     #13866), which puts it in `sudo()`'s register rather than the CRUD one.
 *     They join when a ruling or a measured call site says so.
 */

import type {
  EngineCountOptions,
  EngineDeleteOptions,
  EngineQueryOptions,
  EngineUpdateOptions,
} from './data-engine.zod';
import type { DriverOptions } from './driver.zod';
// Type-only, and it must stay that way, for the reason `hook.zod.ts` states at
// its own `contracts/` import: `contracts/` already imports `data/`, so a VALUE
// import here would close a runtime cycle. `import type` is erased.
import type { WriteObservabilityOptions } from '../contracts/data-engine';
import type {
  EngineTransactionInfo,
  EngineTransactionOptions,
} from '../contracts/objectql-engine';

/**
 * The driver-option keys the engine forwards VERBATIM from a read/write option
 * bag into the driver options — `ENGINE_DRIVER_PASSTHROUGH_KEYS` in
 * `packages/objectql/src/engine.ts`, reused from {@link DriverOptions} rather
 * than re-spelled so there is one declaration of each key's type.
 *
 * ⚠️ They are legal on `find` / `findOne` / `update` / `delete` and NOT on
 * `count`, which forwards no bag at all and whose legal set is `where` alone.
 * That asymmetry is engine behaviour, it is invisible from any document, and it
 * is precisely the kind of thing a hand-written copy gets wrong — which is why
 * {@link HookCountQuery} below is the one shape that does not carry these.
 *
 * `bypassTenantAudit` is diagnostics-only by declaration ("never changes what
 * the write touches") and `preserveAudit` covers historical imports; neither is
 * an authorization switch, so unlike `sudo()` they are ordinary declared
 * vocabulary rather than an escalation this surface would be advertising.
 */
export type HookDriverPassthroughOptions = Pick<
  DriverOptions,
  'transaction' | 'tenantId' | 'tenantIds' | 'timezone' | 'bypassTenantAudit' | 'preserveAudit'
>;

/**
 * The query bag `ctx.api.object(n).find()` / `.findOne()` accept.
 *
 * `EngineQueryOptions` minus the injected `context`, minus the `top` alias and
 * minus the two tombstones, plus the driver pass-through keys the engine
 * forwards. There is NO `filter` key — spell the predicate `where`.
 *
 * `findOne` additionally REFUSES an unpredicated query at runtime (#4419): it
 * reads a single row, so an empty predicate answers the object's FIRST row
 * rather than nothing. Say which row you want with `where`, a `search`, or an
 * `orderBy`; when any row will do, that is `find({ limit: 1 })`.
 */
export type HookQuery = Omit<EngineQueryOptions, 'context' | 'top' | 'cursor' | 'distinct'> &
  HookDriverPassthroughOptions;

/**
 * The query bag `ctx.api.object(n).count()` accepts — `where` and nothing else.
 *
 * ⛔ Not {@link HookQuery} narrowed by habit: `count` never forwards its bag to
 * the driver, so the pass-through keys that are legal on every other method are
 * REJECTED here (`ENGINE_COUNT_OPTION_KEYS` is `{ context, where }`), and so are
 * `limit` / `orderBy` / `fields`, which a count honours nowhere.
 */
export type HookCountQuery = Omit<EngineCountOptions, 'context'>;

/** A record payload a hook write carries. */
export type HookDoc = Record<string, unknown>;

/**
 * The payload `update` / `updateById` take.
 *
 * The single-record `update` form puts the primary key INSIDE the payload —
 * `update({ id, ...fieldsToChange })` — because the repository reads the key
 * out of it. `updateById` takes the id as its own first argument instead.
 */
export type HookUpdateDoc = HookDoc;

/**
 * The options bag `ctx.api.object(n).update()` accepts.
 *
 * `EngineUpdateOptions` minus the injected `context` and the `upsert`
 * tombstone, plus {@link WriteObservabilityOptions} (`onFieldsDropped`,
 * `strictReadonlyWrites` — contract-declared, deliberately outside the
 * serializable schema) and the driver pass-through keys.
 *
 * The bulk form is `update(data, { where, multi: true })`; there is no
 * `updateMany`.
 */
export type HookUpdateOptions = Omit<EngineUpdateOptions, 'context' | 'upsert'> &
  WriteObservabilityOptions &
  HookDriverPassthroughOptions;

/** The options bag `ctx.api.object(n).delete()` accepts. */
export type HookDeleteOptions = Omit<EngineDeleteOptions, 'context'> &
  HookDriverPassthroughOptions;

/**
 * A repository bound to ONE object and to the calling hook's execution context
 * — what `ctx.api.object(name)` hands back.
 *
 * Scoping is the point: a write through here goes down the engine's normal
 * path and is therefore gated by the TARGET object's permission and sharing
 * rules, not by whoever happens to be elevated.
 *
 * Every return shape below MIRRORS the declaration the platform already
 * publishes for the same seam — `IScopedObjectRepository` where it declares the
 * member, `IDataEngine` where it does not (`delete`) — rather than answering
 * the same question a second way.
 */
export interface HookObjectApi {
  /**
   * Read every record the query selects.
   *
   * `Promise<any[]>` mirrors `IScopedObjectRepository.find` and
   * `IDataEngine.find`; narrowing it here would make this face disagree with
   * the two declarations it forwards through.
   */
  find(query?: HookQuery): Promise<any[]>;

  /** Read the ONE record the query selects, or `null`. */
  findOne(query?: HookQuery): Promise<Record<string, any> | null>;

  /** Count the records the query selects. */
  count(query?: HookCountQuery): Promise<number>;

  /** Insert one record, or an array of records. */
  insert(data: HookDoc | HookDoc[]): Promise<any>;

  /**
   * Update records: the record for the single-record form, the affected-row
   * count for the predicate form (`{ where, multi: true }`), `null` when the
   * write matched nothing.
   */
  update(
    data: HookUpdateDoc,
    options?: HookUpdateOptions,
  ): Promise<Record<string, any> | number | null>;

  /**
   * Update a single record by id — the id travels as the first argument.
   *
   * Answers the written record, or `null` when the id matched nothing. A falsy
   * id is not a narrower answer but a REFUSAL: `0` and `''` identify no row, so
   * the dispatch rejects and the call throws.
   */
  updateById(id: string | number, data: HookUpdateDoc): Promise<Record<string, any> | null>;

  /**
   * Delete records — `{ where, multi: true }` for the predicate form.
   *
   * `Promise<boolean | number>` is what `IDataEngine.delete` declares, one door
   * down from this method.
   */
  delete(options?: HookDeleteOptions): Promise<boolean | number>;
}

/**
 * The scoped cross-object API a hook reaches through `ctx.api`.
 *
 * It carries NO top-level `insert` / `update` / `find`: a caller names the
 * object first and operates on the repository that comes back
 * (`ctx.api.object('task').insert(…)`), which is what makes the scoping
 * legible — every operation is addressed to a named object.
 *
 * `ctx.api` is declared `IScopedContext | undefined` on `HookContext`, so a
 * hook narrows to this face at the top of its handler:
 *
 * ```ts
 * import type { HookApi } from '@objectstack/spec/data';
 *
 * const api = ctx.api as HookApi | undefined;
 * if (!api) return;
 * const owner = await api.object('user').findOne({ where: { id: ctx.input.owner } });
 * ```
 */
export interface HookApi {
  /** The repository for `name`, bound to this context. */
  object(name: string): HookObjectApi;

  /**
   * Run `callback` inside one driver transaction: committed when it returns,
   * rolled back when it throws.
   *
   * The callback receives a NEW `HookApi` whose operations share the
   * transaction handle — reach objects through THAT context (`tx.object(…)`),
   * not the outer one, or the writes land outside the transaction.
   *
   * The second parameter is declared because the PRODUCER hands it
   * unconditionally (`ScopedContext.transaction`, #5696). Contravariance keeps
   * the zero- and one-argument callbacks authors actually write assignable, so
   * the truthful signature is also the more permissive one.
   */
  transaction<T>(
    callback: (trxCtx: HookApi, info: EngineTransactionInfo) => Promise<T>,
    opts?: EngineTransactionOptions,
  ): Promise<T>;
}
