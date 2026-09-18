// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { FilterConditionSchema, FilterArraySchema, parseFilterAST } from './filter.zod';
import type { FilterArray, FilterCondition } from './filter.zod';
import { SortNodeSchema, QuerySchema, FullTextSearchSchema, FieldNodeSchema, AggregationNodeSchema, GroupByNodeSchema, QUERY_CURSOR_REMOVED, QUERY_DISTINCT_REMOVED } from './query.zod';
import type { QueryAST, QueryInput } from './query.zod';
import { retiredKey } from '../shared/retired-key';
import { ExecutionContextSchema } from '../kernel/execution-context.zod';

/**
 * Data Engine Protocol
 * 
 * Defines the standard interface for data persistence engines in ObjectStack.
 * This protocol abstracts the underlying storage mechanism (SQL, NoSQL, API, Memory),
 * allowing the ObjectQL engine to execute standardized CRUD and Aggregation operations
 * regardless of where the data resides.
 * 
 * The Data Engine acts as the "Driver" layer in the Hexagonal Architecture.
 */

// ==========================================================================
// 1. Shared Definitions
// ==========================================================================

/**
 * Data Engine Query filter conditions
 * Supports simple key-value map or complex Logic/Field expressions (DSL)
 */
import { lazySchema } from '../shared/lazy-schema';
export const DataEngineFilterSchema = lazySchema(() => z.union([
  z.record(z.string(), z.unknown()),
  FilterConditionSchema
]).describe('Data Engine query filter conditions'));

/**
 * Sort order definition
 * Supports:
 * - { name: 'asc' }
 * - { name: 1 }
 * - [{ field: 'name', order: 'asc' }]
 */
export const DataEngineSortSchema = lazySchema(() => z.union([
  z.record(z.string(), z.enum(['asc', 'desc'])), 
  z.record(z.string(), z.union([z.literal(1), z.literal(-1)])),
  z.array(SortNodeSchema)
]).describe('Sort order definition'));

// ==========================================================================
// 1b. Base Engine Options (shared context)
// ==========================================================================

/**
 * Base Engine Options
 * 
 * All Data Engine operation options extend this schema to carry
 * an optional ExecutionContext for identity, tenant, and transaction propagation.
 */
export const BaseEngineOptionsSchema = lazySchema(() => z.object({
  /**
   * Execution context (identity, tenant, transaction) — any SUBSET of the
   * envelope.
   *
   * `ExecutionContextSchema` gives `positions`/`permissions`/`isSystem`
   * parse-time defaults, which makes them REQUIRED in its inferred output
   * type. On a caller-supplied option that asserts something untrue: that
   * every data-engine context carries a principal. Callers routinely pass a
   * slice — `{ isSystem: true }` for a system read — and a flow run that
   * resolves no identity passes provenance alone (`{ flowRunId }`, #3712), a
   * context deliberately carrying no principal at all. `.partial()` states the
   * real contract: supply what you have, the engine reads what it needs.
   */
  context: ExecutionContextSchema.partial().optional(),
}));

// ==========================================================================
// 2. method: FIND (QueryAST-aligned)
// ==========================================================================

/**
 * Engine Query Options — QueryAST-aligned parameters for IDataEngine.find/findOne.
 * 
 * Uses standard QueryAST field names (where/fields/orderBy/limit/offset/expand)
 * so that no mechanical translation is needed between the Engine and Driver layers.
 * 
 * @example
 * ```ts
 * engine.find('account', {
 *   where: { status: 'active' },
 *   fields: ['id', 'name', 'email'],
 *   orderBy: [{ field: 'name', order: 'asc' }],
 *   limit: 10,
 *   offset: 20,
 *   expand: { owner: { object: 'user', fields: ['name'] } },
 * });
 * ```
 */
export const EngineQueryOptionsSchema = lazySchema(() => BaseEngineOptionsSchema.extend({
  /** Filter conditions (WHERE) — standard QueryAST `where` */
  where: z.union([z.record(z.string(), z.unknown()), FilterConditionSchema]).optional(),

  /** Fields to retrieve (SELECT) — standard QueryAST `fields` */
  fields: z.array(FieldNodeSchema).optional(),

  /** Sorting instructions (ORDER BY) — standard QueryAST `orderBy` */
  orderBy: z.array(SortNodeSchema).optional(),

  /** Max records to return (LIMIT) */
  limit: z.number().optional(),

  /** Records to skip (OFFSET) — standard QueryAST `offset` */
  offset: z.number().optional(),

  /** Alias for limit (OData compatibility) */
  top: z.number().optional(),

  /** Keyset cursor — REMOVED (#4286); same tombstone as `QuerySchema.cursor`. */
  cursor: retiredKey(QUERY_CURSOR_REMOVED),

  /**
   * Full-Text Search.
   *
   * The bare string IS the canonical Tier-1 contract (ADR-0061 D1: "the
   * client sends only the query text; the server resolves which fields to
   * search from object metadata") — it is what every surface sends, what the
   * engine's `$search` expansion actually serves, and what the dogfood HTTP
   * proof (`showcase-search.dogfood.test.ts`) pins. The structured
   * `FullTextSearchSchema` form remains for the declared Tier-2 knobs.
   *
   * The union is schema-side drift REPAIR, not a new dialect — the same
   * repair `BaseQuerySchema.search` (`query.zod.ts`) already carries, and for
   * the same reason: this schema declared only the object form while the
   * executor and the ADR's own conformance ledger served the string. Here the
   * divergence surfaced as a type error rather than a validation failure
   * (#7178): `DriverQuery` (= `Omit<QueryAST, 'object'>`, which inherits the
   * union) was not assignable to `EngineQueryOptionsParsed` purely because of
   * this key, so every engine caller wanting the canonical spelling had to
   * `as any` the whole query — switching off `where`/`orderBy`/`fields`
   * checking too, and, since this schema is not `.strict()`, arming exactly
   * the silent-key-drop that `check:query-options-erasure` exists to stop.
   */
  search: z.union([z.string(), FullTextSearchSchema]).optional(),

  /**
   * Fields the `search` expansion may match against — intersected with the
   * object's declared/derived searchable set (ADR-0061). Read by the engine's
   * `$search` → cross-field `$or` expansion and sent by the protocol layer
   * ever since; it was enforced but undeclared until #4371 (option 2) made
   * the engine reject undeclared option keys.
   */
  searchFields: z.array(z.string()).optional(),

  /**
   * Recursive relation loading map (expand).
   * 
   * Keys are lookup/master_detail field names; values are nested QueryAST
   * objects that control select, filter, sort, and further expansion on
   * the related object. The engine resolves expand via batch $in queries
   * (driver-agnostic) with a default max depth of 3.
   */
  expand: z.lazy(() => z.record(z.string(), QuerySchema)).optional(),

  /** SELECT DISTINCT — REMOVED (#4286); same tombstone as `QuerySchema.distinct`. */
  distinct: retiredKey(QUERY_DISTINCT_REMOVED),
}).describe('QueryAST-aligned query options for IDataEngine.find() operations'));

// --------------------------------------------------------------------------
// Legacy: DataEngineQueryOptionsSchema (DEPRECATED)
// --------------------------------------------------------------------------

/**
 * @deprecated Use `EngineQueryOptionsSchema` instead.
 * This schema uses legacy parameter names (filter/select/sort/skip/populate)
 * that require mechanical translation to QueryAST. Migrate to the
 * QueryAST-aligned `EngineQueryOptionsSchema` (where/fields/orderBy/offset/expand).
 */
export const DataEngineQueryOptionsSchema = lazySchema(() => BaseEngineOptionsSchema.extend({
  /** @deprecated Use `where` (EngineQueryOptionsSchema) */
  filter: DataEngineFilterSchema.optional(),
  /** @deprecated Use `fields` (EngineQueryOptionsSchema) */
  select: z.array(z.string()).optional(),
  /** @deprecated Use `orderBy` (EngineQueryOptionsSchema) */
  sort: DataEngineSortSchema.optional(),
  limit: z.number().int().min(1).optional(),
  /** @deprecated Use `offset` (EngineQueryOptionsSchema) */
  skip: z.number().int().min(0).optional(),
  top: z.number().int().min(1).optional(),
  /** @deprecated Use `expand` (EngineQueryOptionsSchema) */
  populate: z.array(z.string()).optional(),
}).describe('Query options for IDataEngine.find() operations'));

// ==========================================================================
// 3. method: INSERT
// ==========================================================================

export const DataEngineInsertOptionsSchema = lazySchema(() => BaseEngineOptionsSchema.extend({
  /** 
   * Return the inserted record(s)? 
   * Some drivers support RETURNING clause for efficiency.
   * Default: true
   */
  returning: z.boolean().default(true).optional(),
}).describe('Options for DataEngine.insert operations'));

// ==========================================================================
// 4. method: UPDATE (QueryAST-aligned)
// ==========================================================================

/**
 * Exported (like {@link QUERY_CURSOR_REMOVED}) because ONE prescription serves
 * three rejection sites: both update-options schemas below re-declare the key
 * as a tombstone, and the objectql engine's unknown-option gate
 * (`ENGINE_RETIRED_OPTION_MESSAGES` in `engine.ts`) quotes the same string at
 * the runtime entry point, where the untyped option bag never parses.
 *
 * No `os migrate meta` sentence, deliberately: an ADR-0087 D2 conversion
 * rewrites an authored source or a stored `sys_metadata` row, and this key is
 * call-time only — nobody authors an engine option bag and nothing persists
 * one. The removal reaches consumers as the protocol-17 semantic migration
 * `engine-update-upsert-retired` plus this tombstone (the
 * `BatchOptions.validateOnly` / `ListNotificationsRequest.cursor` disposition).
 */
export const ENGINE_UPDATE_UPSERT_REMOVED =
  '`update.options.upsert` was removed in @objectstack/spec 17 (ADR-0049) — it was '
  + 'declared and allowlisted but never implemented: no engine or driver path ever read it, so '
  + '`{ upsert: true }` was accepted and silently dropped and the update stayed a plain update. '
  + 'Delete the key. Express create-if-absent explicitly: a by-id update whose id names no row '
  + 'throws RECORD_NOT_FOUND (the by-id not-found gate) rather than inserting, so read the row '
  + 'first (`findOne`) and call `insert` or `update` on what you find. A first-class upsert, if '
  + 'ever built, must reconcile with that gate by design rather than through this silent flag.';

export const EngineUpdateOptionsSchema = lazySchema(() => BaseEngineOptionsSchema.extend({
  /** Filter conditions to identify records to update — standard QueryAST `where` */
  where: z.union([z.record(z.string(), z.unknown()), FilterConditionSchema]).optional(),
  /** Upsert flag — REMOVED (#8057): declared-but-unenforced (ADR-0049); the tombstone carries the prescription. */
  upsert: retiredKey(ENGINE_UPDATE_UPSERT_REMOVED),
  /** Update multiple records? If false, only the first match is updated. Default: false */
  multi: z.boolean().default(false).optional(),
  /** Return the updated record(s)? Default: false (returns update count/status) */
  returning: z.boolean().default(false).optional(),
}).describe('QueryAST-aligned options for DataEngine.update operations'));

// --------------------------------------------------------------------------
// Write observability: silently-dropped write fields (#3407)
// --------------------------------------------------------------------------

/**
 * One strip event on a write path: the engine dropped caller-supplied field(s)
 * from the payload for a LEGAL reason — a read-only lock (static `readonly`
 * (#2948) or a TRUE `readonlyWhen` predicate (#3042)), or the primary-key strip
 * that keeps a ruled-non-key payload value out of the id column (#6437) — and
 * completed the write without them. The write itself still succeeds —
 * stripping is legitimate semantics, not an error — but callers that report
 * success per requested field (e.g. a flow's `update_record` step) need to know
 * which fields never landed (#3407).
 *
 * `reason` is an OPEN vocabulary in the sense that matters to a consumer: it
 * grows as the write path gains legal strips, and it is widened deliberately
 * rather than force-fitted. Reusing an existing arm for a new strip class would
 * make `reason` LIE, which is strictly worse than the silence it replaces — the
 * judgement PR #6433 recorded in a code comment and #6437 discharged by adding
 * `primary_key`. A consumer that branches on `reason` must therefore be
 * exhaustive (a `Record<DroppedFieldsEvent['reason'], …>` tsc re-checks), never
 * a binary test whose `else` arm silently relabels every future value as
 * read-only.
 *
 * Delivered in-process via the `onFieldsDropped` listener on the write options
 * (see `WriteObservabilityOptions` in `contracts/data-engine.ts`). The
 * listener itself is deliberately NOT part of this serializable options
 * schema: a function is unrepresentable in JSON Schema and cannot cross the
 * RPC (Virtual Data Engine) boundary.
 */
export const DroppedFieldsEventSchema = lazySchema(() => z.object({
  /** Object the write targeted (resolved object name). */
  object: z.string().describe('Object the write targeted (resolved object name)'),
  /** Caller-supplied field names the engine removed from the write payload. */
  fields: z.array(z.string()).describe('Caller-supplied field names the engine removed from the write payload'),
  /**
   * Why the fields were dropped:
   * - `readonly` — static `readonly: true` fields, caller-supplied writes are
   *   stripped for non-system contexts (#2948);
   * - `readonly_when` — a `readonlyWhen` predicate locked the field for the
   *   target record's state; on a multi-row update this is "locked in ≥1
   *   matched row" semantics (#3042);
   * - `primary_key` — the field is the object's primary key and the engine had
   *   ALREADY RULED the submitted value is not one, so writing it would have
   *   overwritten the identity of the row(s) the call actually targets
   *   (#6262 / PR #6433 on the multi branch, #6435 on the by-id branch; #6437).
   *   The row is identified by the `id` argument or by the predicate, never by
   *   this payload key. NOT a read-only lock: a TRUTHY SCALAR `data.id` IS the
   *   bound key and is left in place, so this reason names the strip of a
   *   payload `id` the update-dispatch ruling (`resolveEngineUpdateDispatch`)
   *   has already classified as *not* an identifier — an authoring error the
   *   write survives without.
   *
   * `primary_key` names the FIELD's role, not the offending value's shape, on
   * purpose: `not_a_primary_key` would describe the value and become false the
   * day the strip widens to the same-value truthy-scalar no-op the engine
   * currently leaves alone. `primary_key` stays true either way, and sits in
   * the same register as the two read-only arms — each answers "what about this
   * FIELD caused the strip?".
   */
  reason: z.enum(['readonly', 'readonly_when', 'primary_key']).describe('Why the fields were dropped: static readonly, a TRUE readonlyWhen predicate, or the primary-key strip of a payload id the engine ruled is not an identifier'),
}).describe('A write-path strip event: caller-supplied fields legally dropped from the payload'));

// --------------------------------------------------------------------------
// Legacy: DataEngineUpdateOptionsSchema (DEPRECATED)
// --------------------------------------------------------------------------

/**
 * @deprecated Use `EngineUpdateOptionsSchema` instead.
 * Migrate `filter` → `where`.
 */
export const DataEngineUpdateOptionsSchema = lazySchema(() => BaseEngineOptionsSchema.extend({
  /** @deprecated Use `where` (EngineUpdateOptionsSchema) */
  filter: DataEngineFilterSchema.optional(),
  /** Upsert flag — REMOVED (#8057); same tombstone as `EngineUpdateOptionsSchema.upsert`. */
  upsert: retiredKey(ENGINE_UPDATE_UPSERT_REMOVED),
  multi: z.boolean().default(false).optional(),
  returning: z.boolean().default(false).optional(),
}).describe('Options for DataEngine.update operations'));

// ==========================================================================
// 5. method: DELETE (QueryAST-aligned)
// ==========================================================================

export const EngineDeleteOptionsSchema = lazySchema(() => BaseEngineOptionsSchema.extend({
  /** Filter conditions to identify records to delete — standard QueryAST `where` */
  where: z.union([z.record(z.string(), z.unknown()), FilterConditionSchema]).optional(),
  /** Delete multiple records? If false, only the first match is deleted. Default: false */
  multi: z.boolean().default(false).optional(),
}).describe('QueryAST-aligned options for DataEngine.delete operations'));

// --------------------------------------------------------------------------
// Legacy: DataEngineDeleteOptionsSchema (DEPRECATED)
// --------------------------------------------------------------------------

/**
 * @deprecated Use `EngineDeleteOptionsSchema` instead.
 * Migrate `filter` → `where`.
 */
export const DataEngineDeleteOptionsSchema = lazySchema(() => BaseEngineOptionsSchema.extend({
  /** @deprecated Use `where` (EngineDeleteOptionsSchema) */
  filter: DataEngineFilterSchema.optional(),
  multi: z.boolean().default(false).optional(),
}).describe('Options for DataEngine.delete operations'));

// ==========================================================================
// 6. method: AGGREGATE (QueryAST-aligned)
// ==========================================================================

export const EngineAggregateOptionsSchema = lazySchema(() => BaseEngineOptionsSchema.extend({
  /** Filter conditions (WHERE) — standard QueryAST `where` */
  where: z.union([z.record(z.string(), z.unknown()), FilterConditionSchema]).optional(),
  /**
   * GROUP BY targets — standard {@link GroupByNodeSchema}, same as
   * `QuerySchema.groupBy`: a bare field name, or a
   * `{ field, dateGranularity?, alias? }` bucket object for date bucketing.
   * The engine has always read both spellings (#8032 caught the declaration
   * up to the enforced contract); the string form stays the canonical
   * short-hand and validates unchanged.
   */
  groupBy: z.array(GroupByNodeSchema).optional().describe('GROUP BY targets (strings or `{field, dateGranularity?}` objects for date bucketing)'),
  /**
   * Aggregation definitions — uses standard AggregationNodeSchema (`function` key).
   * e.g. [{ function: 'sum', field: 'amount', alias: 'total' }]
   */
  aggregations: z.array(AggregationNodeSchema).optional(),
  /**
   * HAVING — a FilterCondition over the AGGREGATED rows, so its namespace is
   * the aggregated row's own columns: aggregation aliases + groupBy
   * projections. Enforced ENGINE-side after aggregation (#4286 step 3) —
   * identical semantics on the native-driver and in-memory paths; drivers do
   * not receive authority over it.
   */
  having: FilterConditionSchema.optional().describe('HAVING — filter over the aggregated rows (aggregation aliases + groupBy projections); applied engine-side after aggregation'),
  /**
   * Reference timezone (IANA name) for date bucketing (ADR-0053 Phase 2).
   * When set to a non-UTC zone, `groupBy` items carrying a `dateGranularity`
   * bucket on that zone's calendar days. Unset or `'UTC'` keeps the UTC
   * fast path (native driver `date_trunc`).
   */
  timezone: z.string().optional(),
}).describe('QueryAST-aligned options for DataEngine.aggregate operations'));

// --------------------------------------------------------------------------
// Legacy: DataEngineAggregateOptionsSchema (DEPRECATED)
// --------------------------------------------------------------------------

/**
 * @deprecated Use `EngineAggregateOptionsSchema` instead.
 * Migrate `filter` → `where`, aggregation `method` → `function`.
 */
export const DataEngineAggregateOptionsSchema = lazySchema(() => BaseEngineOptionsSchema.extend({
  /** @deprecated Use `where` (EngineAggregateOptionsSchema) */
  filter: DataEngineFilterSchema.optional(),
  groupBy: z.array(z.string()).optional(),
  /** 
   * @deprecated Use `EngineAggregateOptionsSchema` with standard AggregationNodeSchema (`function` key).
   */
  aggregations: z.array(z.object({
    field: z.string(),
    method: z.enum(['count', 'sum', 'avg', 'min', 'max', 'count_distinct']),
    alias: z.string().optional()
  })).optional(),
}).describe('Options for DataEngine.aggregate operations'));

// ==========================================================================
// 7. method: COUNT (QueryAST-aligned)
// ==========================================================================

export const EngineCountOptionsSchema = lazySchema(() => BaseEngineOptionsSchema.extend({
  /** Filter conditions — standard QueryAST `where` */
  where: z.union([z.record(z.string(), z.unknown()), FilterConditionSchema]).optional(),
}).describe('QueryAST-aligned options for DataEngine.count operations'));

// --------------------------------------------------------------------------
// Legacy: DataEngineCountOptionsSchema (DEPRECATED)
// --------------------------------------------------------------------------

/**
 * @deprecated Use `EngineCountOptionsSchema` instead.
 * Migrate `filter` → `where`.
 */
export const DataEngineCountOptionsSchema = lazySchema(() => BaseEngineOptionsSchema.extend({
  /** @deprecated Use `where` (EngineCountOptionsSchema) */
  filter: DataEngineFilterSchema.optional(),
}).describe('Options for DataEngine.count operations'));

// ==========================================================================
// 8. Definition (Contract)
// ==========================================================================

export const DataEngineContractSchema = lazySchema(() => z.object({
  find: z.function()
    .input(z.tuple([z.string(), EngineQueryOptionsSchema.optional()]))
    .output(z.promise(z.array(z.unknown()))),
    
  findOne: z.function()
    .input(z.tuple([z.string(), EngineQueryOptionsSchema.optional()]))
    .output(z.promise(z.unknown())),
    
  insert: z.function()
    .input(z.tuple([z.string(), z.union([z.record(z.string(), z.unknown()), z.array(z.record(z.string(), z.unknown()))]), DataEngineInsertOptionsSchema.optional()]))
    .output(z.promise(z.unknown())),
    
  update: z.function()
    .input(z.tuple([z.string(), z.record(z.string(), z.unknown()), EngineUpdateOptionsSchema.optional()]))
    .output(z.promise(z.unknown())),
    
  delete: z.function()
    .input(z.tuple([z.string(), EngineDeleteOptionsSchema.optional()]))
    .output(z.promise(z.unknown())),
    
  count: z.function()
    .input(z.tuple([z.string(), EngineCountOptionsSchema.optional()]))
    .output(z.promise(z.number())),
    
  aggregate: z.function()
    .input(z.tuple([z.string(), EngineAggregateOptionsSchema]))
    .output(z.promise(z.array(z.unknown())))
}).describe('Standard Data Engine Contract'));

// ==========================================================================
// 9. Virtualization & RPC Protocol
// ==========================================================================

/**
 * Data Engine RPC Request (Virtual ObjectQL)
 * 
 * This schema defines the serialized format for executing Data Engine operations
 * via HTTP, Message Queue, or Plugin boundaries.
 * 
 * It enables "Virtual Data Engines" where the implementation resides in a 
 * separate microservice or plugin.
 */

/**
 * One RPC query-options slot: the canonical QueryAST key plus the deprecated
 * alias spellings that fold into it.
 */
export interface QueryAliasSlot {
  /** Canonical QueryAST key the slot's value lands on. */
  canonical: string;
  /** Accepted alias spellings, in report order. */
  aliases: readonly string[];
}

/**
 * A slot whose spellings arrived with different values — irreconcilable,
 * reported instead of silently resolved (see {@link foldQueryAliasSlots}).
 */
export interface QueryAliasConflict {
  /** Canonical key of the slot the spellings collided on. */
  canonical: string;
  /** Every spelling present on the input, canonical first when present. */
  spellings: string[];
}

/**
 * The six alias pairs the RPC query surface accepts (#3795, #4346) — the ONE
 * place the alias → canonical mapping is declared. The schema transform below
 * folds parsed input by this table, the protocol normalizer
 * (`metadata-protocol`) folds raw wire input by the same table, extended with
 * the wire-only spellings `filters` / `$filter` / `$expand` that no schema
 * declares, and the ObjectQL engine folds the slots its own option bags still
 * admit (`where`, `limit`) on every entry point. Before this table existed the
 * precedence lived in prose only, so every reader re-implemented it — the
 * #3713 condition — and the two readers disagreed on three of the five pairs,
 * four of them backwards.
 *
 * `limit`/`top` joined last (#4346): the #3795 sweep scoped it out as "the
 * OData layer", leaving the protocol folding it BACKWARDS (`top` overwrote
 * `limit`) while the engine folded it canonical-wins — `{top: 1, limit: 3}`
 * answered 1 over HTTP and 3 in-process.
 */
export const RPC_QUERY_ALIAS_SLOTS: readonly QueryAliasSlot[] = [
  { canonical: 'where', aliases: ['filter'] },
  { canonical: 'fields', aliases: ['select'] },
  { canonical: 'orderBy', aliases: ['sort'] },
  { canonical: 'offset', aliases: ['skip'] },
  { canonical: 'expand', aliases: ['populate'] },
  { canonical: 'limit', aliases: ['top'] },
];

/**
 * Fold alias spellings into their canonical slot key, in place.
 *
 * Per slot: an alias alone moves to the canonical key; redundant IDENTICAL
 * spellings (by JSON value) collapse into the canonical key; different values
 * for one slot are irreconcilable — merging would invent an intent the caller
 * never expressed, and picking a winner IS the silent drop (#4181) — so the
 * slot is reported via `onConflict` and left unfolded. Alias keys are always
 * deleted on a successful fold, so downstream readers see canonical keys only.
 *
 * An explicit `null` spelling is a WITHDRAWAL, not a value: a null alias is
 * deleted without folding (the `??` / `!= null` guards this fold replaced
 * treated it as absent), and a null canonical stays put for the slot's own
 * value handling to answer — the filter slot rejects it (#4181), the sort
 * slot ignores it (#4226) — so folding never manufactures a conflict out of
 * "this key intentionally carries nothing".
 *
 * Values are moved verbatim — a folded value may still carry the alias's
 * legacy SHAPE (e.g. `sort`'s `{field: 'asc'}` record form), which the caller
 * lowers after folding.
 *
 * Returns the spelling each folded slot's value arrived under
 * (canonical key → spelling), so a later rejection can quote the parameter
 * the caller actually wrote (#4226).
 */
export function foldQueryAliasSlots(
  options: Record<string, unknown>,
  slots: readonly QueryAliasSlot[],
  onConflict: (conflict: QueryAliasConflict) => void,
): Record<string, string> {
  const arrivedAs: Record<string, string> = {};
  for (const slot of slots) {
    const spellings = [slot.canonical, ...slot.aliases];
    const present = spellings.filter((s) => options[s] != null);
    if (present.length > 1) {
      const distinct = new Set(present.map((s) => JSON.stringify(options[s])));
      if (distinct.size > 1) {
        // Left as-is: the caller either throws (wire) or fails the parse
        // (schema transform), so the unfolded state is never observed.
        onConflict({ canonical: slot.canonical, spellings: present });
        continue;
      }
    }
    if (present.length > 0) {
      const value = options[present[0]];
      options[slot.canonical] = value;
      arrivedAs[slot.canonical] = present[0];
    }
    for (const spelling of spellings) {
      if (spelling !== slot.canonical) delete options[spelling];
    }
  }
  return arrivedAs;
}

/** The `where` slot alone — for RPC options that accept only the `filter` alias. */
const RPC_WHERE_SLOT: readonly QueryAliasSlot[] = RPC_QUERY_ALIAS_SLOTS.filter(
  (slot) => slot.canonical === 'where',
);

function aliasConflictIssue(conflict: QueryAliasConflict): {
  code: 'custom';
  path: string[];
  message: string;
} {
  return {
    code: 'custom',
    path: [conflict.canonical],
    message:
      `Conflicting query parameters: ${conflict.spellings.map((s) => `'${s}'`).join(', ')} ` +
      `are spellings of the same parameter (canonical '${conflict.canonical}') and were ` +
      'given different values. Send exactly one.',
  };
}

/**
 * RPC backward-compatibility mixin — shared `@deprecated filter` field.
 * The parse transform folds `filter` into `where` and drops it; both spellings
 * with different values fail the parse (see `RpcQueryOptionsSchema`).
 */
const RpcLegacyFilterMixin = {
  /** @deprecated Use `where` */
  filter: DataEngineFilterSchema.optional(),
};

/**
 * Parse-time fold for options that accept only the `filter` alias
 * ({@link RpcLegacyFilterMixin}): `filter` lands on `where` and is dropped
 * from the parsed output, so `filter` is absent from the inferred type and a
 * TS consumer reading it fails to compile instead of silently reading
 * `undefined` (the #3742 / #3764 shape, one layer down).
 */
function foldRpcLegacyFilter<T extends { filter?: unknown }>(
  input: T,
  ctx: z.core.$RefinementCtx,
): Omit<T, 'filter'> {
  const bag: Record<string, unknown> = { ...input };
  foldQueryAliasSlots(bag, RPC_WHERE_SLOT, (conflict) => ctx.addIssue(aliasConflictIssue(conflict)));
  return bag as Omit<T, 'filter'>;
}

/**
 * Parse-time fold for the full RPC query options: each legacy alias lands on
 * its canonical key (with the alias's legacy value shape lowered to the
 * canonical one) and is dropped from the parsed output.
 */
function foldRpcQueryOptions(input: object, ctx: z.core.$RefinementCtx): EngineQueryOptions {
  const bag = { ...(input as Record<string, unknown>) };
  foldQueryAliasSlots(bag, RPC_QUERY_ALIAS_SLOTS, (conflict) => ctx.addIssue(aliasConflictIssue(conflict)));
  // A folded `sort` may carry the record spellings `DataEngineSortSchema`
  // allows; canonical `orderBy` declares `SortNode[]` only, so lower them.
  if (bag.orderBy !== undefined && bag.orderBy !== null && !Array.isArray(bag.orderBy)) {
    bag.orderBy = Object.entries(bag.orderBy as Record<string, 'asc' | 'desc' | 1 | -1>).map(
      ([field, order]) => ({ field, order: order === 'asc' || order === 1 ? 'asc' : 'desc' }),
    );
  }
  // A folded `populate` is a relation-name list; canonical `expand` is a
  // `{name: QueryAST}` record.
  if (Array.isArray(bag.expand)) {
    bag.expand = Object.fromEntries(
      (bag.expand as string[]).map((rel) => [rel, { object: rel }]),
    );
  }
  return bag as EngineQueryOptions;
}

/**
 * RPC query options that accept BOTH new (where/fields/orderBy) and
 * legacy (filter/select/sort/skip/populate) parameter names.
 *
 * **One slot, one value (#3795):** each legacy alias is folded into its
 * canonical key at parse — `filter`→`where`, `select`→`fields`,
 * `sort`→`orderBy`, `skip`→`offset`, `populate`→`expand`, `top`→`limit`
 * ({@link RPC_QUERY_ALIAS_SLOTS}) — and the alias is dropped from the parsed
 * output, so consumers only ever read canonical QueryAST keys. Sending both
 * spellings with the SAME value is redundant and tolerated; sending DIFFERENT
 * values for one slot is irreconcilable — picking either would silently drop
 * the other (#4181) — and fails the parse. The protocol normalizer applies
 * the same table to raw wire input, so mixed vocabularies resolve identically
 * on every path.
 */
const RpcQueryOptionsSchema = EngineQueryOptionsSchema.extend({
  ...RpcLegacyFilterMixin,
  /** @deprecated Use `fields` */
  select: z.array(z.string()).optional(),
  /** @deprecated Use `orderBy` */
  sort: DataEngineSortSchema.optional(),
  /** @deprecated Use `offset` */
  skip: z.number().int().min(0).optional(),
  /** @deprecated Use `expand` */
  populate: z.array(z.string()).optional(),
}).transform((options, ctx) => foldRpcQueryOptions(options, ctx));

// ==========================================================================
// 2c. The QUERY TRANSPORT dialect — the FLATTENED SPELLING of the QueryAST
// ==========================================================================
//
// One vocabulary, two spellings, ONE semantics — and "one semantics" is a
// claim about VALUES, not only about keys. Everything below is a key-level
// alias of a canonical QueryAST slot, and every spelling of a slot accepts
// the SAME set of value shapes: each accepted shape is lowered to the
// canonical member's declared shape before the parse returns, and a shape
// that cannot be lowered without parsing the spec must not do is REFUSED at
// the parse rather than emitted under the AST type.
//
// ⛔ A spelling that would need its own meaning does not belong here — it
// belongs in the AST or nowhere. ⛔ A value shape that only ONE spelling of a
// slot admits does not belong here either: that is the same second contract
// one layer down, selected by spelling instead of by key.

/**
 * The transport-only alias spellings, by canonical QueryAST key — the ones a
 * transport boundary speaks that {@link RPC_QUERY_ALIAS_SLOTS} does not carry.
 *
 * `filters` is the documented plural of the `filter` transport parameter;
 * `$filter` / `$expand` are the OData spellings that fold STRAIGHT onto a
 * canonical key rather than onto a bare one, which is why they are slot
 * aliases here and not rows in {@link QUERY_TRANSPORT_DOLLAR_ALIASES}.
 */
const QUERY_TRANSPORT_ONLY_SLOT_ALIASES: Readonly<Record<string, readonly string[]>> = {
  where: ['filters', '$filter'],
  expand: ['$expand'],
};

/**
 * {@link RPC_QUERY_ALIAS_SLOTS} extended with the transport-only spellings —
 * the alias table every transport boundary folds by, declared ONCE.
 *
 * Before this export the extension was re-declared inside
 * `@objectstack/metadata-protocol` as a module-private `WIRE_QUERY_ALIAS_SLOTS`,
 * so the `findData` door accepted a vocabulary no schema named: two dialects
 * on one slot, one of them declared. A caller speaking the transport spelling
 * was unverifiable at build time and unrejected at runtime. The table is the
 * single source now; the normalizer folds by THIS array.
 */
export const QUERY_TRANSPORT_ALIAS_SLOTS: readonly QueryAliasSlot[] = RPC_QUERY_ALIAS_SLOTS.map(
  (slot) => ({
    canonical: slot.canonical,
    aliases: [...slot.aliases, ...(QUERY_TRANSPORT_ONLY_SLOT_ALIASES[slot.canonical] ?? [])],
  }),
);

/**
 * The OData `$`-prefixed spelling of each BARE transport parameter, as
 * `[dollarSpelling, bareSpelling]` pairs.
 *
 * NOT derivable by prefixing `$`: `sort` is `$orderby`. These fold in TWO hops
 * — `$top` lands on `top`, which {@link QUERY_TRANSPORT_ALIAS_SLOTS} then folds
 * onto `limit` — so a reader comparing only the slot table would miss them.
 *
 * `count` is the one bare spelling here that is not a QueryAST slot at all: it
 * is the response's total-count flag, read beside the query rather than inside
 * it — but it is TRANSPORTED inside it (`findData` reads `options.count` off
 * the same bag), so it is declared on the parsed output too. See
 * {@link QueryWithTransportParsed}.
 *
 * ⚠️ A `$` spelling never overwrites a bare spelling already present, and the
 * `$` key is dropped either way: `{top: 6, $top: 5}` folds to `limit: 6` and
 * the `5` is discarded without a diagnostic. That is byte-equal to what the
 * `findData` door has always done and it is left alone deliberately — raising
 * it here and not there would make the POST body and the GET querystring
 * answer the same request differently.
 */
export const QUERY_TRANSPORT_DOLLAR_ALIASES: readonly (readonly [string, string])[] = [
  ['$top', 'top'],
  ['$skip', 'skip'],
  ['$orderby', 'orderBy'],
  ['$select', 'select'],
  ['$count', 'count'],
  ['$search', 'search'],
  ['$searchFields', 'searchFields'],
];

/**
 * Every `$`-prefixed spelling the transport declares — the two-hop ones in
 * table order, then the slot aliases in slot order.
 *
 * This is the set a boundary quotes when it refuses an UNDECLARED `$` name. A
 * `$`-prefixed key can never be a field name, so anything outside this set is
 * refused loudly instead of falling into the implicit-field-filter bucket,
 * where it matched zero rows under a 200 and no caller could see it.
 */
export const QUERY_TRANSPORT_DOLLAR_PARAMS: readonly string[] = [
  ...QUERY_TRANSPORT_DOLLAR_ALIASES.map(([dollar]) => dollar),
  ...QUERY_TRANSPORT_ALIAS_SLOTS.flatMap((slot) => slot.aliases.filter((a) => a.startsWith('$'))),
];

/**
 * The value set EVERY spelling of the `where` slot accepts — a filter
 * condition, or the input-only `FilterArray` sugar.
 *
 * The array arm is here because the DOOR serves it on the canonical key too:
 * `findData({query: {where: ['status', '=', 'open']}})` reaches the engine as
 * `{status: 'open'}`. Declaring it on `$filter` alone would have left `where`
 * refusing at the schema what the door accepts at runtime — two acceptance
 * grammars for one slot, selected by spelling.
 *
 * ⛔ It is NOT declared on `QuerySchema.where`. #5158's ruling C is explicit:
 * `FilterArray` is input-only sugar, the wire/storage contract stays exactly
 * as it is, and every arrival is lowered through the ONE sink
 * ({@link parseFilterAST}) — option A, widening `where` so every driver and
 * transport maintains two filter compilers, was rejected. That negative is
 * pinned in `filter-array-declaration.test.ts`. So the sugar is accepted HERE,
 * at the transport boundary, and lowered before the AST is produced.
 */
const TransportFilterValueSchema = lazySchema(() => z.union([FilterArraySchema, DataEngineFilterSchema]));

/**
 * The value set the `count` spellings accept: the boolean, or the two strings
 * a querystring can carry it as. Lowered to the boolean by the fold, because
 * {@link QueryWithTransportParsed} declares a boolean — and because
 * `findData`'s opt-out test is `options.count === false`, under which an
 * unlowered `'false'` reads as "count anyway".
 */
const TransportCountValueSchema = lazySchema(() => z.union([z.boolean(), z.enum(['true', 'false'])]));

/**
 * The transport query parameters — every spelling the two tables above name
 * that is not itself a QueryAST key: the `$`-prefixed forms, the plural
 * `filters`, the bare aliases (`filter` / `select` / `sort` / `skip` /
 * `populate`) and the response-flag pair `count` / `$count`. Each carries the
 * value of the canonical slot it folds onto.
 *
 * `top` is the one alias the tables name that is NOT here: `BaseQuerySchema`
 * already declares it beside `limit`, and re-declaring it would widen a
 * canonical member rather than a transport one.
 *
 * ⛔ This is NOT the hint table `@objectstack/metadata-protocol` keeps for
 * near-miss suggestions; nothing in that table is accepted as input and it
 * stays that way. This one IS accepted — it is what the `findData` door has
 * folded since #3795, declared at last.
 *
 * Every member is nullable-optional (an explicit `null` is a WITHDRAWAL, which
 * the fold deletes rather than folds) and every value type is the set the
 * boundary already serves on that slot, LOWERED to the canonical member's
 * declared shape by {@link foldQueryTransportBag}: the structured form a JSON
 * body sends, the comma list a querystring sends (`?$select=a,b`), the
 * stringly-typed number (`?$top=50` arrives as `'50'`), the relation-name list
 * on `$expand`, and the `FilterArray` sugar on the filter spellings.
 *
 * ⛔ Three shapes are deliberately NOT declared, because lowering them means
 * PARSING — and a second parser beside the door's is how one rule gets two
 * implementations that disagree: a JSON-encoded `$filter` string, the OData
 * `$orderby` / `sort` expression string (`'name desc'`, `'-created_at'`) and
 * its `string[]` form. They fail the parse at the member that carries them
 * rather than reaching the AST as a string the engine would have to re-read.
 *
 * ⚠️ [#18977] `$orderby` is declared a SECOND time, and the other declaration
 * accepts exactly the two shapes this one refuses: `ODataQuerySchema.$orderby`
 * (`../api/odata.zod.ts`) is `string | string[]` and refuses this one's record
 * maps and `SortNode[]`. It cannot contradict this schema at a DOOR — measured
 * on this tree, nothing parses through it: its only consumers are its own
 * `OData.buildUrl` helper and its own unit test. It contradicts it in a READER,
 * which is the cost already paid: objectui#9554 was filed, triaged and
 * dispatched against a shipped producer that had been sending the canonical
 * shape all along, because a competent seat read the OTHER declaration, quoted
 * it correctly, and had no signal that this one exists. The two accept sets are
 * disjoint and pinned as such in
 * `../api/odata-orderby-dual-declaration.test.ts`.
 *
 * ⛔ Closing that gap by widening either side is a decision, not a tidy-up —
 * and widening THIS one is precisely the second parser the paragraph above
 * refuses. What serves the string forms is `normalizeSortNodes` at the
 * `@objectstack/metadata-protocol` ingress (the GET querystring path, the
 * export route and in-process `findData`), not a schema.
 *
 * ⛔ Declaring the narrower structured form ALONE would have turned live
 * traffic into a `400` — measured: the body-form AST array on
 * `POST /data/:object/query`, pinned by `#7390 §3` in
 * `rest-server-repeated-filter-param.test.ts`, which is exactly the repair
 * #15866's parent thread closed for this reason.
 */
export const QueryTransportParamsSchema = lazySchema(() => z.object({
  /** OData spelling of `where`. */
  $filter: TransportFilterValueSchema.nullable().optional()
    .describe('Transport spelling of `where` (OData `$filter`)'),
  /** Documented plural of the `filter` transport parameter; folds onto `where`. */
  filters: TransportFilterValueSchema.nullable().optional()
    .describe('Transport spelling of `where` (plural of `filter`)'),
  /** OData spelling of `limit` (two hops: `$top` to `top` to `limit`). */
  $top: z.union([z.number(), z.string()]).nullable().optional()
    .describe('Transport spelling of `limit` (OData `$top`) — a number, or the digits a querystring carries it as'),
  /** OData spelling of `offset` (two hops: `$skip` to `skip` to `offset`). */
  $skip: z.union([z.number(), z.string()]).nullable().optional()
    .describe('Transport spelling of `offset` (OData `$skip`) — a number, or the digits a querystring carries it as'),
  /** OData spelling of `orderBy`. */
  $orderby: DataEngineSortSchema.nullable().optional()
    .describe('Transport spelling of `orderBy` (OData `$orderby`)'),
  /** OData spelling of `fields` (two hops: `$select` to `select` to `fields`). */
  $select: z.union([z.string(), z.array(FieldNodeSchema)]).nullable().optional()
    .describe('Transport spelling of `fields` (OData `$select`)'),
  /** OData spelling of `expand`. */
  $expand: z.union([z.string(), z.array(z.string()), z.record(z.string(), QuerySchema)]).nullable().optional()
    .describe('Transport spelling of `expand` (OData `$expand`)'),
  /** OData spelling of `search`. */
  $search: z.union([z.string(), FullTextSearchSchema]).nullable().optional()
    .describe('Transport spelling of `search` (OData `$search`)'),
  /** OData spelling of `searchFields`. */
  $searchFields: z.union([z.string(), z.array(z.string())]).nullable().optional()
    .describe('Transport spelling of `searchFields` (OData `$searchFields`)'),
  /** OData spelling of the response total-count flag. */
  $count: TransportCountValueSchema.nullable().optional()
    .describe('Transport spelling of the response total-count flag (OData `$count`)'),
  /** Bare spelling of the response total-count flag; only an explicit `false` opts out. */
  count: TransportCountValueSchema.nullable().optional()
    .describe('Response total-count flag — only an explicit `false` skips the COUNT query'),
  /** Bare transport spelling of `where` — the RPC table's own alias. */
  filter: TransportFilterValueSchema.nullable().optional()
    .describe('Transport spelling of `where`'),
  /** Bare transport spelling of `fields`. */
  select: z.union([z.string(), z.array(z.string())]).nullable().optional()
    .describe('Transport spelling of `fields`'),
  /** Bare transport spelling of `orderBy`. */
  sort: DataEngineSortSchema.nullable().optional()
    .describe('Transport spelling of `orderBy`'),
  /** Bare transport spelling of `offset`. */
  skip: z.union([z.number(), z.string()]).nullable().optional()
    .describe('Transport spelling of `offset`'),
  /** Bare transport spelling of `expand`. */
  populate: z.union([z.string(), z.array(z.string())]).nullable().optional()
    .describe('Transport spelling of `expand`'),
}).describe('Transport spellings of the QueryAST slots — folded to canonical keys at the boundary'));

/**
 * Fold a transport bag onto canonical QueryAST keys, by the two tables above,
 * and lower every folded value onto the canonical member's declared shape.
 *
 * The same two steps, in the same order, that the protocol normalizer runs on
 * raw wire input: `$` spellings onto their bare parameter first (a `$` alias
 * never overwrites a bare spelling that is already present, and an explicit
 * `null` is a WITHDRAWAL rather than a value), then every alias onto its
 * canonical slot via {@link foldQueryAliasSlots}.
 *
 * Deliberately a fold over the shared TABLES rather than a second copy of the
 * normalizer: this is the parse-time application, exactly as
 * `foldRpcQueryOptions` is the parse-time application of
 * {@link RPC_QUERY_ALIAS_SLOTS}.
 *
 * A CONFLICT — two spellings of one slot carrying different values — fails the
 * parse with {@link aliasConflictIssue} at the canonical path, quoting the
 * spelling the caller actually WROTE. `wireSpelling` / `slotParam` here are the
 * same composition the door's `findData` uses for the same reason (#4226):
 * telling someone who sent `?$orderby=…` that "'orderBy' is invalid" names a
 * parameter absent from their request. Leaving the conflict unfolded — the
 * shape this fold shipped with — left BOTH spellings on the parsed bag, so the
 * declared AST output carried a transport key.
 */
function foldQueryTransportBag(
  input: Record<string, unknown>,
  ctx: z.core.$RefinementCtx,
): QueryAstWithCount {
  const bag: Record<string, unknown> = { ...input };
  const wireSpelling: Record<string, string> = {};
  for (const [dollar, bare] of QUERY_TRANSPORT_DOLLAR_ALIASES) {
    if (bag[dollar] != null && bag[bare] == null) {
      bag[bare] = bag[dollar];
      wireSpelling[bare] = dollar;
    }
    delete bag[dollar];
  }
  const spellingFor = (name: string): string => wireSpelling[name] ?? name;
  let refused = false;
  const arrivedAs = foldQueryAliasSlots(bag, QUERY_TRANSPORT_ALIAS_SLOTS, (conflict) => {
    refused = true;
    ctx.addIssue(aliasConflictIssue({
      canonical: conflict.canonical,
      spellings: conflict.spellings.map(spellingFor),
    }));
  });
  const slotParam = (canonical: string): string => spellingFor(arrivedAs[canonical] ?? canonical);
  if (lowerFoldedTransportValues(bag, ctx, slotParam)) refused = true;
  // One diagnostic per defect. A refusal above already named the parameter the
  // caller wrote and why; running the AST parse over the value it refused would
  // add a second issue about the same key, and the REST ingress reports
  // `fields[0]` off that list (`zodIssuesToFields`, #5014).
  if (refused) return z.NEVER;
  // THE OUTPUT IS CONSTRUCTED HERE, and nowhere else. The folded bag is parsed
  // by {@link QueryAstWithCountSchema} and that parse's RESULT is what leaves
  // this transform, so a value the AST does not declare cannot be returned
  // under the AST type — the shape this schema shipped with asserted its output
  // with a cast and validated nothing, and `limit: 'abc'` / `orderBy: 'name'` /
  // `where: 'not json'` / a `$filter` left behind by an unfolded conflict all
  // left the parse wearing it.
  //
  // ⛔ NOT `.transform(fold).pipe(QueryAstWithCountSchema)`, which is the same
  // construction one level out: `build-schemas.ts` publishes a schema's OUTPUT
  // shape whenever that shape has a JSON form and only falls back to the INPUT
  // when it does not, so adding the pipe makes `data/QueryWithTransport.json`
  // publish the canonical AST and unpublishes all 32 transport keys from
  // `authorable-surface/data.json` — measured, and refused by that file's own
  // deletion gate. The authorable surface of this slot IS the transport
  // vocabulary, so the parse is done here instead.
  const parsed = QueryAstWithCountSchema.safeParse(bag);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) ctx.addIssue({ ...issue, path: [...issue.path] });
    return z.NEVER;
  }
  return parsed.data;
}

/**
 * Lower every folded value SHAPE onto the one shape the canonical slot
 * declares — or refuse it, at the canonical path, naming the spelling the
 * caller wrote.
 *
 * This function is what makes the fold TOTAL: after it, every key left on the
 * bag is a QueryAST member (plus `count`) carrying a value that member
 * declares, which is why {@link QueryWithTransportSchema} can PARSE the result
 * with the AST schema instead of asserting it. Nothing here parses: a comma
 * list is split, a numeric string is converted, a sort record is turned into
 * sort nodes, a relation list is turned into an expand map, and the
 * `FilterArray` sugar is handed to {@link parseFilterAST}, the ONE declared
 * lowering sink (#5158 ruling C). Anything that would need a real parser was
 * refused one level up, on the member that declared it.
 *
 * ⚠️ A refusal is reported and the value is LEFT AS IT IS rather than deleted:
 * `ctx.addIssue` already fails the parse, so the bag is never observed — and
 * deleting the key would turn a refused `$top` into a query with no limit,
 * which is the unbounded read this whole declaration exists to close.
 *
 * Returns whether anything was refused, so the caller can skip the AST parse
 * that would otherwise report the same key twice.
 */
function lowerFoldedTransportValues(
  bag: Record<string, unknown>,
  ctx: z.core.$RefinementCtx,
  slotParam: (canonical: string) => string,
): boolean {
  let refused = false;
  const refuse = (canonical: string, detail: string): void => {
    refused = true;
    ctx.addIssue({
      code: 'custom',
      path: [canonical],
      message: `Query parameter '${slotParam(canonical)}' ${detail}`,
    });
  };
  // `?$top=50` / `?$skip=10` arrive as digits; canonical `limit` / `offset`
  // declare numbers. A string that is not a number is refused rather than
  // passed on: `$top: 'abc'` used to reach the engine as `limit: null` — an
  // UNBOUNDED read under a 200 — and `$top: ''` as `limit: 0`.
  for (const key of ['limit', 'offset'] as const) {
    const value = bag[key];
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    const n = trimmed === '' ? Number.NaN : Number(trimmed);
    if (!Number.isFinite(n)) {
      refuse(key, `carries ${JSON.stringify(value)}, which is not a number.`);
      continue;
    }
    bag[key] = n;
  }
  for (const key of ['fields', 'searchFields'] as const) {
    if (typeof bag[key] === 'string') {
      bag[key] = (bag[key] as string).split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  // A folded `sort` / `$orderby` may carry the record spellings
  // `DataEngineSortSchema` allows; canonical `orderBy` declares `SortNode[]`.
  if (bag.orderBy !== undefined && bag.orderBy !== null
      && !Array.isArray(bag.orderBy) && typeof bag.orderBy === 'object') {
    bag.orderBy = Object.entries(bag.orderBy as Record<string, 'asc' | 'desc' | 1 | -1>).map(
      ([field, order]) => ({ field, order: order === 'asc' || order === 1 ? 'asc' : 'desc' }),
    );
  }
  // The `FilterArray` sugar, on whichever spelling of the slot it arrived
  // under, through the one declared sink. `parseFilterAST` THROWS on a
  // comparand shape it refuses (`assertListComparandShapes`); a throw out of a
  // transform escapes `safeParse` entirely, so it is converted to an issue.
  if (Array.isArray(bag.where)) {
    let lowered: unknown;
    try {
      lowered = parseFilterAST(bag.where);
    } catch (error) {
      refuse('where', `carries a filter array that cannot be lowered: ${(error as Error)?.message ?? String(error)}`);
      lowered = bag.where;
    }
    if (lowered === undefined) {
      refuse('where', 'carries a filter array that lowers to no condition at all.');
    } else {
      bag.where = lowered;
    }
  }
  // A folded `populate` / `$expand` may be a relation-name list or a comma
  // list; canonical `expand` is a `{name: QueryAST}` record.
  const expandNames = typeof bag.expand === 'string'
    ? bag.expand.split(',').map((s) => s.trim()).filter(Boolean)
    : Array.isArray(bag.expand) ? (bag.expand as unknown[]).filter((r): r is string => typeof r === 'string')
      : null;
  if (expandNames) {
    bag.expand = Object.fromEntries(expandNames.map((rel) => [rel, { object: rel }]));
  }
  // `count` is the one folded key whose canonical target is not an AST slot:
  // it is the response's total-count flag, read beside the query and declared
  // on the output beside it ({@link QueryWithTransportParsed}).
  if (bag.count === 'true') bag.count = true;
  else if (bag.count === 'false') bag.count = false;
  return refused;
}

/** The transport query parameters, as an author writes them (ADR-0122). */
export type QueryTransportParams = z.input<typeof QueryTransportParamsSchema>;

/**
 * The transport query parameters after a parse (ADR-0122). Not identical to
 * {@link QueryTransportParams}: `$expand`'s record arm carries nested
 * `QuerySchema` values, whose author and parsed states differ.
 */
export type QueryTransportParamsParsed = z.infer<typeof QueryTransportParamsSchema>;

/**
 * What a query slot that serves a transport boundary DECLARES as its input:
 * the canonical QueryAST, the transport spelling, or a bag carrying both.
 *
 * The third arm is not generosity — it is what the door does. A boundary
 * assembles one bag out of a caller's parameters and its own, so `where` and
 * `$filter` can arrive together; the fold collapses them when they agree and
 * refuses them when they do not. Declaring only the two pure arms would have
 * re-created this card's own defect one size down: a shape the door accepts
 * that the declaration denies.
 *
 * `where` widens to the `FilterArray` sugar here and ONLY here — see
 * {@link TransportFilterValueSchema} for why it is not widened on
 * `QuerySchema`.
 */
export type QueryWithTransport =
  Omit<QueryInput, 'where'>
  & { where?: FilterCondition | FilterArray }
  & Partial<QueryTransportParams>;

/**
 * What a transport-aware query slot parses to: the canonical QueryAST, in every
 * spelling, plus the `count` flag. Module-private because ADR-0122 names the
 * exported pair {@link QueryWithTransport} / {@link QueryWithTransportParsed},
 * and the latter is inferred from the schema this type constructs.
 *
 * `count` is on the output because it is on the WIRE inside this slot and read
 * out of it — `findData` takes its opt-out from `options.count` on the same bag
 * it hands the engine. Folding `$count` and then dropping it would declare a
 * parameter the parse silently discards, which is the phantom-key shape this
 * card was filed about. It is not an AST member and never reaches the engine:
 * the door deletes it before `engine.find`.
 */
type QueryAstWithCount = QueryAST & { count?: boolean };

/**
 * The AST plus the `count` flag — the schema that CONSTRUCTS
 * {@link QueryWithTransportSchema}'s output. Every parsed query is the result
 * of this schema's own parse, so the declared output is a measurement rather
 * than an assertion.
 *
 * Written as an intersection rather than an `extend` so both type arguments
 * come from `QuerySchema`'s own declaration instead of being restated:
 * `QuerySchema` is annotated `z.ZodType<QueryAST, QueryInput>` for its
 * recursion, and `.extend` on it is reachable only through a cast that throws
 * that annotation away.
 */
const QueryAstWithCountSchema: z.ZodType<QueryAstWithCount, QueryInput & { count?: boolean }> =
  lazySchema(() => QuerySchema.and(z.object({
    count: z.boolean().optional()
      .describe('Response total-count flag — only an explicit `false` skips the COUNT query'),
  })));

/**
 * The canonical query object's `ZodObject` face, which `QuerySchema`'s own
 * recursion annotation (`z.ZodType<QueryAST, QueryInput>`) hides.
 *
 * ⛔ This cast asserts nothing about what the schema accepts or emits — it
 * restores the builder surface (`.extend`, `.shape`) on a value that IS a
 * `ZodObject` at run time. The claim about the parsed OUTPUT is made by
 * {@link QueryAstWithCountSchema}'s parse inside the fold, and by nothing else.
 */
const queryObjectFace = (): z.ZodObject<Record<string, z.ZodType>> =>
  QuerySchema as unknown as z.ZodObject<Record<string, z.ZodType>>;

/**
 * `expand` re-described on the extended shape, with the exact text
 * `QuerySchema` gives it — READ from the member, ⛔ never re-typed, because two
 * copies of a description drift.
 *
 * Not decoration. `expand` is RECURSIVE, so `z.toJSONSchema` hoists it into
 * `$defs` and the property renders as a bare `$ref`; a `$ref` carries no
 * sibling `description` unless the property node has one of its own. This slot
 * publishes its INPUT shape — `build-schemas.ts` falls back to `io: 'input'`
 * because the output of a transform has no JSON form — and in that direction
 * the `FindDataRequest.query` / `expand` row rendered with an EMPTY description
 * cell in `content/docs/references/api/protocol.mdx`. Re-describing the member
 * puts the text back beside the `$ref`.
 */
const describedCanonicalExpand = (): z.ZodType => {
  const member = queryObjectFace().shape.expand;
  return member.describe(member.description ?? '');
};

/**
 * A query slot whose declared INPUT is the canonical AST or its transport
 * spelling, and whose OUTPUT is CONSTRUCTED: the folded bag is parsed by
 * {@link QueryAstWithCountSchema} and that parse's result is what the transform
 * returns, so a value the AST does not declare cannot leave this schema. The
 * previous shape asserted the output type with a cast and validated nothing,
 * and every non-AST value the fold could emit — `limit: 'abc'`,
 * `orderBy: 'name'`, `where: 'not json'`, an unfolded `$filter` left behind by
 * a conflict — left the parse wearing the AST type.
 *
 * ⛔ ONE object, not a `z.union` of two, and the difference is a measured
 * contract rather than taste. Wrapping the slot in a union puts zod's own
 * `invalid_union` issue at the head of the list for EVERY malformed query, and
 * the REST ingress reports `fields[0]` off that list — so
 * `query.aggregations.0.function` became a bare `query` and the sentence that
 * says what to fix stopped being the first thing an AI caller reads
 * (`rest-server.ts` `zodIssuesToFields`, pinned by `#5014` and by
 * `list-view-grouping-query-door.test.ts` §9). Extending `QuerySchema` with the
 * transport members instead leaves every canonical member's issue path exactly
 * where it was.
 *
 * The transform folds by {@link QUERY_TRANSPORT_ALIAS_SLOTS} /
 * {@link QUERY_TRANSPORT_DOLLAR_ALIASES} and lowers every legacy value shape,
 * so a transport bag parses to canonical keys. The canonical members keep
 * `QuerySchema`'s own declarations verbatim — except `where`, which accepts the
 * `FilterArray` sugar on every spelling of its slot because the door serves it
 * on every spelling of its slot.
 */
export const QueryWithTransportSchema = lazySchema(
  () => queryObjectFace()
    .extend({
      ...(QueryTransportParamsSchema as unknown as z.ZodObject<z.ZodRawShape>).shape,
      expand: describedCanonicalExpand(),
      // The lowering sink the sentence below names is the one maintainer
      // ruling C on #5158 fixed. The id lives in this comment and not in the
      // prose, which is printed AT the customer, where it resolves to nothing.
      where: TransportFilterValueSchema.optional().describe(
        'Filtering criteria (WHERE) — a filter condition, or the input-only `FilterArray` '
        + "sugar (`['status', '=', 'open']`), which is lowered through `parseFilterAST` "
        + 'before the query is produced.'
      ),
    })
    .transform((bag, ctx) => foldQueryTransportBag(bag as Record<string, unknown>, ctx)),
  // ⚠️ ONE cast, and it restates the INPUT only. The OUTPUT type is inferred
  // from the transform's return type, which is the return type of
  // `QueryAstWithCountSchema.safeParse` — so nothing here asserts what the
  // schema emits. The input has to be restated because `.extend` on the erased
  // object face types it as an open record, which would make `z.input` of this
  // slot admit `$sort` and a query with no `object`.
) as unknown as z.ZodType<QueryAstWithCount, QueryWithTransport>;

/**
 * What a transport-aware query slot PARSES TO (ADR-0122): the canonical
 * QueryAST plus the `count` flag, in every spelling.
 *
 * A consumer reading a parsed query never sees a transport key, and that is
 * now a property of the construction rather than a promise: the fold removes
 * every transport spelling, and {@link QueryAstWithCountSchema} — whose parse
 * produces this value — strips anything that is somehow left.
 */
export type QueryWithTransportParsed = z.infer<typeof QueryWithTransportSchema>;

export const DataEngineFindRequestSchema = lazySchema(() => z.object({
  method: z.literal('find'),
  object: z.string(),
  query: RpcQueryOptionsSchema.optional()
}));

export const DataEngineFindOneRequestSchema = lazySchema(() => z.object({
  method: z.literal('findOne'),
  object: z.string(),
  query: RpcQueryOptionsSchema.optional()
}));

export const DataEngineInsertRequestSchema = lazySchema(() => z.object({
  method: z.literal('insert'),
  object: z.string(),
  data: z.union([z.record(z.string(), z.unknown()), z.array(z.record(z.string(), z.unknown()))]),
  options: DataEngineInsertOptionsSchema.optional()
}));

export const DataEngineUpdateRequestSchema = lazySchema(() => z.object({
  method: z.literal('update'),
  object: z.string(),
  data: z.record(z.string(), z.unknown()),
  id: z.union([z.string(), z.number()]).optional().describe('ID for single update, or use where in options'),
  options: EngineUpdateOptionsSchema.extend(RpcLegacyFilterMixin)
    .transform((options, ctx) => foldRpcLegacyFilter(options, ctx)).optional()
}));

export const DataEngineDeleteRequestSchema = lazySchema(() => z.object({
  method: z.literal('delete'),
  object: z.string(),
  id: z.union([z.string(), z.number()]).optional().describe('ID for single delete, or use where in options'),
  options: EngineDeleteOptionsSchema.extend(RpcLegacyFilterMixin)
    .transform((options, ctx) => foldRpcLegacyFilter(options, ctx)).optional()
}));

export const DataEngineCountRequestSchema = lazySchema(() => z.object({
  method: z.literal('count'),
  object: z.string(),
  query: EngineCountOptionsSchema.extend(RpcLegacyFilterMixin)
    .transform((options, ctx) => foldRpcLegacyFilter(options, ctx)).optional()
}));

export const DataEngineAggregateRequestSchema = lazySchema(() => z.object({
  method: z.literal('aggregate'),
  object: z.string(),
  query: EngineAggregateOptionsSchema.extend(RpcLegacyFilterMixin)
    .transform((options, ctx) => foldRpcLegacyFilter(options, ctx))
}));

/**
 * Data Engine Execute Request (Raw Command)
 * Execute a raw command/query native to the driver (e.g. SQL, Shell, Remote API).
 */
export const DataEngineExecuteRequestSchema = lazySchema(() => z.object({
  method: z.literal('execute'),
  /** The abstract command (string SQL, or JSON object) */
  command: z.unknown(),
  /** Optional options */
  options: z.record(z.string(), z.unknown()).optional()
}));

/**
 * Data Engine Vector Find Request (AI/RAG)
 * Perform a similarity search using vector embeddings.
 */
export const DataEngineVectorFindRequestSchema = lazySchema(() => z.object({
  method: z.literal('vectorFind'),
  object: z.string(),
  /** The vector embedding to search for */
  vector: z.array(z.number()),
  /** Optional pre-filter (Metadata filtering) — standard QueryAST `where` */
  where: z.union([z.record(z.string(), z.unknown()), FilterConditionSchema]).optional(),
  /** Fields to retrieve — standard QueryAST `fields` */
  fields: z.array(z.string()).optional(),
  /** Number of results */
  limit: z.number().int().default(5).optional(),
  /** Minimum similarity score (0-1) or distance threshold */
  threshold: z.number().optional()
}));

// `DataEngineBatchRequestSchema` stood here until ADR-0119 D3 (#4618) retired
// it with the `IDataEngine.batch?` member it existed to describe. Nothing ever
// parsed it: no engine implemented `batch`, no caller invoked it, and the
// wire-side batch route validates with `CrossObjectBatchRequestSchema` /
// `BatchUpdateRequestSchema` from `../api/batch.zod.ts` — a different schema
// entirely. Deleted outright rather than tombstoned with `retiredKey()`,
// because a tombstone's prescription reaches an author through a PARSE, and
// there was no parse to reach: a prescription nobody can receive is noise
// (the spec-property-retirement playbook's third route). Its three
// `authorable-surface.json` baseline lines and its `json-schema.manifest.json`
// entry go with it, deliberately.
//
// The tell that nobody ever designed against it: its `requests` array nested
// the request union recursively, so a batch could contain batches, with no
// statement anywhere about what that meant for ordering or rollback.

/**
 * Unified Data Engine Request Union
 * Use this to validate any incoming "Virtual ObjectQL" request.
 *
 * NOTE (#4618): every arm below now has zero readers in this repo — there is
 * no Virtual Data Engine implementation, only this schema describing one. That
 * makes the whole block an ADR-0049 enforce-or-remove candidate, deliberately
 * left standing here because retiring a published wire protocol is a different
 * decision from retiring `batch?`, and it is tracked separately rather than
 * folded into a removal whose title promised something narrower.
 */
export const DataEngineRequestSchema = lazySchema(() => z.discriminatedUnion('method', [
  DataEngineFindRequestSchema,
  DataEngineFindOneRequestSchema,
  DataEngineInsertRequestSchema,
  DataEngineUpdateRequestSchema,
  DataEngineDeleteRequestSchema,
  DataEngineCountRequestSchema,
  DataEngineAggregateRequestSchema,
  DataEngineExecuteRequestSchema,
  DataEngineVectorFindRequestSchema
]).describe('Virtual ObjectQL Request Protocol'));

// ==========================================================================
// 10. Type Exports
// ==========================================================================

// --- New: QueryAST-aligned types (preferred) ---
/**
 * Trailing options for the READ methods (`find` / `findOne` / `count` /
 * `aggregate`) — the execution context, and nothing else.
 *
 * [#4251] The schema always existed; the exported type did not, so
 * `IDataEngine`'s read methods could not declare the trailing argument their
 * implementation has taken since the split was unified. Reads once took their
 * context INSIDE the query while writes took it in trailing `options.context`,
 * and passing the write shape to a read SILENTLY DROPPED it — an intended
 * `isSystem` bypass just vanished. The engine accepts both channels now
 * (`options.context` wins), but a caller typed to the contract could not reach
 * the trailing one at all, so the callers that use it were reaching it through
 * `any`. Same shape as {@link BaseEngineOptionsSchema} by construction: this is
 * naming what is already there, not widening it. (The type itself is not new —
 * it sat unused under the "legacy/deprecated" heading below, which is why the
 * contract went looking for it and did not find it.)
 */
export type BaseEngineOptions = z.input<typeof BaseEngineOptionsSchema>;
export type EngineQueryOptions = z.input<typeof EngineQueryOptionsSchema>;
/** Post-parse shape of {@link EngineQueryOptions} — defaults applied, transforms run (ADR-0122). */
export type EngineQueryOptionsParsed = z.infer<typeof EngineQueryOptionsSchema>;
export type EngineUpdateOptions = z.input<typeof EngineUpdateOptionsSchema>;
export type DroppedFieldsEvent = z.input<typeof DroppedFieldsEventSchema>;
export type EngineDeleteOptions = z.input<typeof EngineDeleteOptionsSchema>;
export type EngineAggregateOptions = z.input<typeof EngineAggregateOptionsSchema>;
export type EngineCountOptions = z.input<typeof EngineCountOptionsSchema>;

// --- Legacy: deprecated types (kept for backward compatibility) ---
export type DataEngineFilter = z.input<typeof DataEngineFilterSchema>;
/** @deprecated Use standard `SortNode[]` from QueryAST instead. */
export type DataEngineSort = z.input<typeof DataEngineSortSchema>;
/** Post-parse shape of {@link DataEngineSort} — defaults applied, transforms run (ADR-0122). */
export type DataEngineSortParsed = z.infer<typeof DataEngineSortSchema>;
/** @deprecated Use `EngineQueryOptions` instead. */
export type DataEngineQueryOptions = z.input<typeof DataEngineQueryOptionsSchema>;
/** Post-parse shape of {@link DataEngineQueryOptions} — defaults applied, transforms run (ADR-0122). */
export type DataEngineQueryOptionsParsed = z.infer<typeof DataEngineQueryOptionsSchema>;
export type DataEngineInsertOptions = z.input<typeof DataEngineInsertOptionsSchema>;
/** @deprecated Use `EngineUpdateOptions` instead. */
export type DataEngineUpdateOptions = z.input<typeof DataEngineUpdateOptionsSchema>;
/** @deprecated Use `EngineDeleteOptions` instead. */
export type DataEngineDeleteOptions = z.input<typeof DataEngineDeleteOptionsSchema>;
/** @deprecated Use `EngineAggregateOptions` instead. */
export type DataEngineAggregateOptions = z.input<typeof DataEngineAggregateOptionsSchema>;
/** @deprecated Use `EngineCountOptions` instead. */
export type DataEngineCountOptions = z.input<typeof DataEngineCountOptionsSchema>;
export type DataEngineRequest = z.input<typeof DataEngineRequestSchema>;
/** Post-parse shape of {@link DataEngineRequest} — defaults applied, transforms run (ADR-0122). */
export type DataEngineRequestParsed = z.infer<typeof DataEngineRequestSchema>;
export type DataEngineExecuteRequest = z.input<typeof DataEngineExecuteRequestSchema>;
export type DataEngineInsertRequest = z.input<typeof DataEngineInsertRequestSchema>;
export type DataEngineVectorFindRequest = z.input<typeof DataEngineVectorFindRequestSchema>;
