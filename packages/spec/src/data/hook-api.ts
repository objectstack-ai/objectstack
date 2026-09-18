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
 * `limit`.
 *
 * DECIDED at contract review, not left open: `top` stays omitted. The ruling
 * names `filter` only, so the question was whether this type may be narrower
 * than the ruling's letter — and the measurement says it is not narrower at
 * all. `ENGINE_FIND_OPTION_KEYS` itself has no `top`: the alias is folded and
 * DELETED before the legal-key check runs, which is why objectql's own drift
 * pin skips it. So `HookQuery` carries the engine's accepted set verbatim, and
 * re-adding `top` would put the published face out of step with the engine
 * while re-opening for `{ limit, top }` exactly the coin toss the ruling closed
 * for `{ where, filter }`. It is also the reversible direction: adding a key
 * later is additive, removing one is breaking.
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

/**
 * A record payload a hook write carries.
 *
 * DECIDED at contract review: this stays `Record` of `string` to `unknown`,
 * and is NOT widened to the `any`-valued or `object`-valued form.
 *
 * What the narrow form costs, measured: a payload whose type is an INTERFACE is
 * refused — `TS2345: Index signature for type 'string' is missing in type 'X'`
 * — because TypeScript grants an implicit index signature to a type alias and
 * not to an interface. The engine and `IScopedObjectRepository` both accept it,
 * so this is the one shape in this file that sits narrower than the seam.
 *
 * Kept anyway, for three reasons. It fails LOUDLY and at the authoring site,
 * never silently at the driver. The remedy is one word at the call site —
 * declare the payload as a `type` rather than an `interface`, or spread it
 * (`insert({ ...record })`, which is what a hook writing from `ctx.input`
 * already does, and which compiles today). And it is the REVERSIBLE direction:
 * widening later is additive, while narrowing later would break every consumer
 * that had annotated a value as `HookDoc` and indexed it — the same structural
 * argument that settled `top` above.
 */
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

/**
 * [BLOCKING finding of this card's contract review] The types this entry's own
 * public declarations reference STRUCTURALLY, re-exported so they are nameable
 * from the entry that publishes them.
 *
 * The governing text is the maintainer ruling of 2026-08-23 on #11350, recorded
 * in `packages/spec/scripts/check-entry-nameability.ts` and chartered
 * 2026-08-25 on #11709: a type that appears structurally in an entry's public
 * declarations must be nameable from that same entry.
 *
 * Measured in the consumer shape this card exists to serve — a program that
 * imports ONLY `@objectstack/spec/data` and emits declarations:
 *
 * ```
 * export const inTx = (api: HookApi) =>
 *   api.transaction(async (tx, info) => ({ tx, info }));
 *
 * error TS2883: The inferred type of 'inTx' cannot be named without a
 * reference to 'EngineTransactionInfo'. This is likely not portable.
 * ```
 *
 * The second position — `transaction`'s `opts` — answers the same way for
 * `EngineTransactionOptions`. Those two are what this card owes, and they are
 * what this file exports: they are names THIS card's own new declarations
 * introduced to the entry.
 *
 * ⛔ A THIRD instance of the same defect is deliberately NOT closed here, and
 * the reason is a measurement rather than a scope reflex. `HookContext.api` has
 * leaked `IScopedContext` off this entry since #5945 — pre-existing, present on
 * this card's base and unchanged by it. Closing it is not the one-line job it
 * looks like:
 *
 *   - It needs TWO names, not one. `IScopedContext.object(name)` returns
 *     `IScopedObjectRepository`, so with `IScopedContext` exported alone a
 *     consumer writing `ctx.api.object('deal')` still answers TS2883 on the
 *     repository — measured, at head, with the three-name variant applied. A
 *     one-name patch publishes a HALF closure that READS closed, which is the
 *     declared-not-enforced shape this repo refuses.
 *   - The second of those two names is not free. Adding
 *     `IScopedObjectRepository` to this entry moves the dts bundler's module
 *     order enough to reorder members inside object type literals in the
 *     UNRELATED `ui` shard: 330 lines, which `check:api-surface-declarations`
 *     reports as "33 reshaped" and asks a reviewer to rule on. Measured as
 *     order-only — identical token multiset, identical line count, nothing
 *     added, removed or renamed — and the generator is stable against a fixed
 *     dist, so it is noise rather than drift. But it is a verdict somebody has
 *     to read, in a shard this card does not touch.
 *
 * Two names with a clean surface delta, or four names plus an adjudication in
 * someone else's shard: that is a trade for its own card and its own review,
 * not a rider on a FAIL remediation. The pre-existing leak is reported with
 * both measurements so that card can be written without re-deriving them.
 *
 * ⛔ `check:entry-nameability` is NOT the instrument that answers this. By its
 * own docblock it probes the CALL surface of VALUE exports that have a call
 * signature; `HookApi` is a type, so no probe of that gate ever reaches
 * `api.transaction(...)`. It runs green here and is blind to this by
 * construction — the reachable radius is value exports, and these three names
 * are a known target outside it. The instrument that answers is a consumer
 * program with `declaration` emit, which is what the excerpt above is.
 *
 * Type-only re-exports: they add two names to this entry and no runtime byte,
 * and each is ONE declaration reachable from two entries rather than two
 * declarations sharing a name, which is what `check:dual-source-exports` asks.
 */
export type { EngineTransactionInfo, EngineTransactionOptions } from '../contracts/objectql-engine';
