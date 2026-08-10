// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { FilterConditionSchema } from './filter.zod';
import { SortNodeSchema, QuerySchema, FullTextSearchSchema, FieldNodeSchema, AggregationNodeSchema, QUERY_CURSOR_REMOVED, QUERY_DISTINCT_REMOVED } from './query.zod';
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

export const EngineUpdateOptionsSchema = lazySchema(() => BaseEngineOptionsSchema.extend({
  /** Filter conditions to identify records to update — standard QueryAST `where` */
  where: z.union([z.record(z.string(), z.unknown()), FilterConditionSchema]).optional(),
  /** Perform an upsert? If true, insert if not found. */
  upsert: z.boolean().default(false).optional(),
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
  reason: z.enum(['readonly', 'readonly_when', 'primary_key']).describe('Why the fields were dropped: static readonly (#2948), a TRUE readonlyWhen predicate (#3042), or the primary-key strip of a payload id the engine ruled is not an identifier (#6437)'),
}).describe('A write-path strip event: caller-supplied fields legally dropped from the payload (#3407)'));

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
  upsert: z.boolean().default(false).optional(),
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
  /** Group By fields */
  groupBy: z.array(z.string()).optional(),
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
