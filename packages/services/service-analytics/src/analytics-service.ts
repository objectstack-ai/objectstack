// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type {
  IAnalyticsService,
  AnalyticsQuery,
  AnalyticsResult,
  CubeMeta,
  DatasetSelection,
} from '@objectstack/spec/contracts';
import { percentScaleOf, type Cube, type FilterCondition } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { Dataset } from '@objectstack/spec/ui';
// [#6761] The ONE shared `I18nLabel → string` resolver (#6765, maintainer
// ruling B). Imported, never re-implemented: a private twin here is exactly the
// fork the ruling exists to prevent — it would render the same authored map
// differently from objectui's `pickLocalized` with neither end erroring.
import { resolveI18nLabel } from '@objectstack/spec/ui';
import type { Logger } from '@objectstack/spec/contracts';
import { createLogger, bucketKeyToCalendarRange, zonedDateStartToUtcMs } from '@objectstack/core';
// [#6615] The Postgres `"x" of relation "y"` phrase, owned once. This is the
// only reason this package depends on `@objectstack/types` — see the module's
// docblock for why the edge is acyclic and why it was worth adding.
import { matchMissingColumnOfRelation } from '@objectstack/types';
import { CubeRegistry } from './cube-registry.js';
import type { AnalyticsStrategy, AnalyticsDriverCapabilities, StrategyContext } from './strategies/types.js';
import { NativeSQLStrategy } from './strategies/native-sql-strategy.js';
import { ObjectQLStrategy } from './strategies/objectql-strategy.js';
// [#5669] The `where` source-field gate reads the filter tree through the SAME
// pair the strategies compile it with, so "the field the gate saw" and "the
// column that reached SQL" cannot be two different things.
import {
  normalizeAnalyticsFilterTree,
  collectFilterLeaves,
  lowerAnalyticsWhere,
  conjunctFieldKeys,
} from './strategies/filter-normalizer.js';
import { compileDataset, type CompiledDataset, type RelationshipResolver } from './dataset-compiler.js';
import { DatasetExecutor, resolveDimensionGranularity, type DateGranularityValue } from './dataset-executor.js';
import {
  resolveDimensionLabels,
  createOrderLabelResolver,
  withLabelFetchCache,
  type DimensionLabelDeps,
} from './dimension-labels.js';
import { evaluateAnalyticsQueryOverRows } from './preview-evaluator.js';
// [#5918] The measure mint refuses a dotted member through the SAME constructor
// the strategies' member-level refusals use — `INVALID_FIELD` / 400, naming the
// member as the request spelled it (see `dataset-refusal.ts`'s header for why
// that code and not `DATASET_INVALID`).
import { invalidMemberError } from './dataset-refusal.js';

/**
 * Analytics result augmented with drill-through metadata (ADR-0021 D2; see
 * queryDataset). Carried alongside `rows` so the host can drill a clicked bucket
 * back to the underlying records without the renderer knowing field mappings.
 */
type AnalyticsResultWithDrill = AnalyticsResult & {
  /** The dataset's base object — the host drills into its records. */
  object?: string;
  /** Selected drillable dimension NAME → underlying object FIELD name. */
  dimensionFields?: Record<string, string>;
  /**
   * RAW grouped values per row, aligned to `rows` by index — each a map of
   * drillable dimension NAME → stored value (BEFORE label resolution rewrote
   * `rows[i][dim]` to the display label). The exact-match drill filter is built
   * from these, never from the display labels.
   */
  drillRawRows?: Array<Record<string, unknown>>;
  /**
   * RAW grouped values for the totals/subtotal rows (#3214), the totals-side
   * companion to `drillRawRows`: `drillRawTotals[i]` aligns to `result.totals[i]`
   * and `drillRawTotals[i][j]` to `result.totals[i].rows[j]`. Each map holds that
   * grouping's DRILLABLE dimension NAME → stored value, snapshotted in the SAME
   * pre-label-resolution pass (the totals loop below overwrites a subtotal row's
   * dimension value with its display label just like the data rows). Restricted
   * to the drillable dims present in the grouping, so the grand-total grouping
   * (`[]`) contributes an empty map per row — which keeps the index alignment
   * intact and correctly drills the whole (unfiltered) object.
   */
  drillRawTotals?: Array<Array<Record<string, unknown>>>;
  /**
   * #1752 — half-open date-range drill scope per row, the RANGE companion to
   * `drillRawRows` (which handles equality dims). A time-bucketed date
   * dimension (`dateGranularity`) groups a SPAN of records into one bucket
   * ("2026-Q2"), so its drill needs `[gte, lt)`, not equality — the humanized
   * bucket can't be exact-matched (which is why date dims are excluded from
   * `dimensionFields`/`drillRawRows`). Aligned to `rows` by index; each entry
   * maps a drillable date-dimension NAME → `{ field, gte, lt }` with `gte`
   * inclusive and `lt` exclusive (bounds as `YYYY-MM-DD`). Present only for
   * buckets whose boundaries are unambiguous — a `datetime` field under a
   * non-UTC reference timezone is omitted (host drills an unscoped superset)
   * until instant-boundary support lands.
   */
  drillRanges?: Array<Record<string, { field: string; gte: string; lt: string }>>;
};

/**
 * [#5717] Does this error carry an ADR-0112 envelope — i.e. did its PRODUCER
 * already classify it?
 *
 * The structural fact, read exactly as `rest-server.ts`'s
 * `/analytics/dataset/query` catch reads it (`envelopeStatus`/`envelopeCode`):
 * a numeric `status` plus a non-empty string `code`. Deliberately the SAME
 * predicate rather than a second dialect of "looks enveloped" — a producer that
 * ships half an envelope has a bug of its own and must be found, not guessed at
 * from either end of the wire.
 *
 * Status RANGE is deliberately not part of it. The 4xx case is the loud one
 * (#5717's own: a `DATASET_INVALID` / 400 refusal must reach the caller as a
 * 400, never as an empty grid), but a DECLARED 5xx — `read-scope-sql.ts`'s
 * `READ_SCOPE_COMPILE_FAILED` / 500 fail-closed refusals — is if anything worse
 * to swallow: an RLS lowering that failed closed, rendered as a confident empty
 * chart, is a server fault nobody is told about. Either way the producer has
 * ANSWERED the classification question, and {@link isMissingSourceError} — a
 * heuristic over DRIVER phrasing — has no business re-opening it.
 */
function hasDeclaredErrorEnvelope(err: unknown): boolean {
  const e = err as { code?: unknown; status?: unknown } | null | undefined;
  return typeof e?.status === 'number' && typeof e?.code === 'string' && e.code.length > 0;
}

/**
 * [#6035] Postgres's MISSING COLUMN wording — the one driver phrase that is a
 * missing-SOURCE phrase by substring while meaning the opposite.
 *
 *   `column "label" of relation "acct" does not exist`   (SQLSTATE 42703)
 *
 * `relation "acct" does not exist` sits inside it verbatim, so both
 * {@link isMissingSourceError} and {@link missingSourceRelation} read it as
 * "the table `acct` is gone" — which would degrade the widget to an empty grid
 * (when `acct` is the dataset's own object) or report a cross-datasource
 * topology error (when it is a joined one). Neither is true: `acct` is right
 * there and a COLUMN NAME IS MISPELLED — precisely the class both docblocks
 * promise to leave as a hard failure.
 *
 * Subtracting it first is the shape `rest-server.ts`'s `mapDataError` has used
 * since #5352 (its `unknownColumn` probe extracts this same phrase ahead of the
 * unknown-object branch, so the REST face answers `400 INVALID_FIELD` rather
 * than `404`; the case is pinned in `rest.test.ts`). This is deliberately that
 * regex rather than a second dialect of it — the two faces must not disagree
 * about what counts as postgres saying "column".
 *
 * Both quotes are required because postgres always emits them here (its errmsg
 * template is `column "%s" of relation "%s" does not exist`), and requiring
 * them is the safe direction of error: a wording this misses merely keeps
 * today's verdict, while one it over-matches would turn a genuinely missing
 * table into a hard failure and regress #5033's deliberate leniency.
 *
 * [#6615] "Deliberately that regex rather than a second dialect of it" is now
 * enforced rather than asserted: the phrase moved to
 * {@link matchMissingColumnOfRelation} in `@objectstack/types`, which
 * `rest-server.ts`'s `mapDataError` and `metadata`'s `MISSING_TABLE.excludes`
 * also read. The two faces can no longer disagree about what postgres says by
 * one of them being edited. Same pattern, byte for byte — only its owner moved.
 */
function isMissingColumnOfRelation(message: string): boolean {
  return matchMissingColumnOfRelation(message) !== undefined;
}

/**
 * Detect the "backing object/table isn't present in this kernel" class of
 * error so a dataset query can degrade to an empty result instead of failing
 * the widget with a 500. Matches the missing-relation signatures across the
 * drivers ObjectStack runs on (sqlite/libsql, postgres, mysql) plus the
 * framework's own unknown-object signal. Deliberately scoped to MISSING SOURCE
 * (table/object/relation) — not column/syntax errors, which stay hard failures
 * so real query bugs still surface.
 *
 * ⚠️ It is a heuristic over driver PHRASING, so it is the SECOND question the
 * degradation path asks, never the first: {@link hasDeclaredErrorEnvelope} runs
 * ahead of it (#5717), and only an error whose producer declared nothing is
 * classified by its words here.
 *
 * [#5717] The postgres limb is ANCHORED to postgres's actual wording
 * (`relation "x" does not exist`, relation name quoted or bare) instead of the
 * `includes('relation') && includes('does not exist')` conjunction it used to
 * be. That conjunction matched any sentence carrying both words — including
 * `dataset-compiler.ts`'s `… includes relationship "R" which does not exist on
 * object "O"`, where the "relation" is inside "relationship" and the missing
 * thing is a RELATIONSHIP, not a table. The anchor is the same pattern the
 * sibling {@link missingSourceRelation} already uses for postgres (and the same
 * shape as `metadata/src/utils/schema-sync-errors.ts`), so "is something
 * missing" and "what is missing" can no longer disagree on this limb.
 *
 * MEASURED over the wordings this repo actually carries — 13 strings: the three
 * driver families' phrasings (including sql-prefixed and schema-qualified
 * forms), the framework's not-registered signals, and this package's own
 * refusals — exactly ONE verdict moves, the compiler refusal above. No driver
 * wording changes, which is what makes this a narrowing rather than a
 * behaviour change for #5033's leniency.
 *
 * [#6035] The residue #5717 left and named here is now closed by
 * {@link isMissingColumnOfRelation}, subtracted BEFORE any limb below runs.
 * The anchor above cannot do it alone, for a reason worth stating plainly: the
 * missing-COLUMN wording literally CONTAINS a well-formed missing-relation
 * wording, so no tightening of "does this say a relation is missing" can ever
 * exclude it — only asking the more specific question FIRST can. That makes the
 * ORDER the fix, not the pattern.
 */
function isMissingSourceError(err: unknown): boolean {
  const raw = String((err as { message?: unknown })?.message ?? err ?? '');
  // [#6035] Missing COLUMN is not missing SOURCE — the paragraph above promises
  // column errors stay hard failures, and this is where that promise is kept.
  if (isMissingColumnOfRelation(raw)) return false;
  const msg = raw.toLowerCase();
  return (
    msg.includes('no such table') ||      // sqlite / libsql
    /relation\s+[`"']?[A-Za-z0-9_$.]+[`"']?\s+does not exist/i.test(raw) || // postgres
    msg.includes("doesn't exist") ||      // mysql ("table ... doesn't exist")
    msg.includes('not registered') ||     // framework: object not in registry
    msg.includes('unknown object') ||
    msg.includes('is not a registered object')
  );
}

/**
 * #5033 — the relation a missing-source error NAMES, when it names one.
 *
 * `isMissingSourceError` answers "is something missing"; this answers "what".
 * The distinction decides whether the widget may degrade: a dataset whose OWN
 * backing table is absent is a kernel that never mounted the object (degrade —
 * that is the case the graceful path exists for), while a dataset whose
 * *joined* table is absent on the datasource the base object routed to is a
 * cross-datasource dataset, i.e. a topology error that must be reported as
 * itself instead of hiding behind "backing object … is unavailable".
 *
 * Returns the bare relation name (schema/database qualifiers stripped —
 * `mydb.crm_account` → `crm_account`; Prime Directive #6 makes object name =
 * table name, so the result is comparable to a dataset's `object`), or
 * `undefined` when the driver's phrasing carries no name. Unparseable ⇒ the
 * caller keeps today's degradation, never a louder guess.
 *
 * [#6035] It subtracts {@link isMissingColumnOfRelation} for the same reason
 * its sibling does, and the reason is CONSISTENCY rather than a second bug:
 * measured on `origin/main`, the column wording made this function answer
 * `sys_team`, so fixing only "is something missing" would leave the pair
 * DISAGREEING — one saying nothing is missing, the other naming a table. That
 * disagreement is the exact defect #5717 closed on the postgres limb, and
 * re-opening it here would re-arm the same mine one edit away: today this
 * function is only ever called behind a true `isMissingSourceError`, so the
 * guard is unreachable, but "unreachable" is a property of the CALL ORDER at
 * one call site, not of this function. Guarding both keeps the two answers
 * derivable from the wording alone.
 */
function missingSourceRelation(err: unknown): string | undefined {
  const msg = String((err as { message?: unknown })?.message ?? err ?? '');
  if (isMissingColumnOfRelation(msg)) return undefined;
  const patterns = [
    /no such table:\s*[`"'[]?([A-Za-z0-9_$.]+)/i,                        // sqlite / libsql
    /relation\s+[`"']?([A-Za-z0-9_$.]+)[`"']?\s+does not exist/i,        // postgres
    /table\s+[`"']?([A-Za-z0-9_$.]+)[`"']?\s+doesn't exist/i,            // mysql
    /(?:object|table)\s+[`"']([A-Za-z0-9_$.]+)[`"']\s+is not registered/i, // framework
    /unknown object:?\s*[`"']?([A-Za-z0-9_$.]+)/i,
    /[`"']([A-Za-z0-9_$.]+)[`"']\s+is not a registered object/i,
  ];
  for (const re of patterns) {
    const m = re.exec(msg);
    if (m?.[1]) {
      const parts = m[1].split('.').filter(Boolean);
      const bare = parts[parts.length - 1];
      if (bare) return bare;
    }
  }
  return undefined;
}

/**
 * [#4437] A name that is a plain column/table identifier and nothing else.
 * Anything with a dot, a paren, whitespace or an operator is a SQL EXPRESSION
 * (or a cross-object reference) whose parts this layer cannot attribute to a
 * single field — such measures pass the source-field gate untouched.
 */
const BARE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/i;

/**
 * The `cube.dimensions` / `cube.measures` KEY a member resolves to, mirroring
 * the strategies' own `lookupMember` — including its deliberate LAST case: a
 * dotted member that matches no declared key is a synthetic relation traversal
 * handed to the JOIN machinery, which the source-field gates must not judge
 * (hence `undefined`, read as "nothing to check" rather than "undeclared bare
 * column").
 *
 * `kind` is which bags to consult, and it is NOT cosmetic — it is the difference
 * between the two callers' real resolution rules:
 *
 * - `'dimension'` — {@link AnalyticsService.assertDimensionFields}, matching
 *   `NativeSQLStrategy.resolveDimensionSql` / `ObjectQLStrategy.resolveFieldName
 *   (…, 'dimension')`, which look in `cube.dimensions` only.
 * - `'any'` — {@link AnalyticsService.assertWhereFields}, matching the FILTER
 *   member resolution in `NativeSQLStrategy.resolveFieldSql` and
 *   `ObjectQLStrategy.resolveFieldName(…, 'any')`, which fall through to
 *   `cube.measures`. Consulting dimensions only would have made the where gate
 *   reject a query that works on both strategies today: a cube declaring
 *   `measures.revenue = {sql: 'annual_revenue'}` answers
 *   `where: {revenue: {$gt: 100}}` as `annual_revenue > ?`, and a
 *   dimensions-only lookup would have called `revenue` a missing column.
 *
 * Extracted from #5520's gate so #5669's second caller reads the tree the same
 * way — two open-coded copies of `lookupMember` in one file is exactly how
 * "what the gate sees" and "what reaches SQL" drift apart.
 */
function declaredMemberEntry(
  cube: Cube,
  member: string,
  kind: 'dimension' | 'any',
): { key: string; sql?: unknown } | undefined {
  const bags: Array<Record<string, { sql?: unknown } | undefined>> =
    kind === 'dimension'
      ? [cube.dimensions as Record<string, { sql?: unknown } | undefined>]
      : [
          cube.dimensions as Record<string, { sql?: unknown } | undefined>,
          cube.measures as Record<string, { sql?: unknown } | undefined>,
        ];
  // `key` is spread LAST in every arm: it is the bag key this member RESOLVED
  // to, and a `key` property on the cube entry itself must not shadow it.
  for (const bag of bags) {
    if (bag[member]) return { ...bag[member], key: member };
    if (member.includes('.')) {
      const [first, ...rest] = member.split('.');
      const tail = rest.join('.');
      if (first === cube.name && bag[tail]) return { ...bag[tail], key: tail };
      if (bag[tail]) return { ...bag[tail], key: tail };
      const flat = member.replace(/\./g, '_');
      if (bag[flat]) return { ...bag[flat], key: flat };
    }
  }
  return undefined;
}

/**
 * The cube KEY a member resolves to (for the rejection's suggestion list) and
 * the bare COLUMN it compiles to — `source: null` meaning "nothing this gate can
 * check", which covers every deliberate stand-down at member level: an
 * expression `sql` (`CASE WHEN …`, `*`), and a dotted relation traversal whose
 * join target the gate cannot see.
 *
 * Shared by the dimension gate (#5520) and the `where` gate (#5669) — see
 * {@link declaredMemberEntry} for why `kind` differs between them.
 */
function resolveMemberSource(
  cube: Cube,
  member: string,
  kind: 'dimension' | 'any',
): { key: string; source: string | null } {
  const entry = declaredMemberEntry(cube, member, kind);
  if (entry) {
    const source = typeof entry.sql === 'string' ? entry.sql.trim() : '';
    return { key: entry.key, source: source && BARE_IDENTIFIER.test(source) ? source : null };
  }
  // Undeclared. A dotted spelling is the relation traversal above; a bare one IS
  // the column the strategies will emit.
  if (member.includes('.')) return { key: member, source: null };
  return { key: member, source: BARE_IDENTIFIER.test(member) ? member : null };
}

/**
 * Configuration for AnalyticsService.
 */
export interface AnalyticsServiceConfig {
  /** Pre-defined cube definitions (from manifest). */
  cubes?: Cube[];
  /** Logger instance. */
  logger?: Logger;
  /**
   * Probe driver capabilities for the object that backs a cube.
   * The service calls this function to decide which strategy can handle a query.
   */
  queryCapabilities?: (cubeName: string) => AnalyticsDriverCapabilities;
  /**
   * Execute raw SQL on the driver for a given object.
   * Required for NativeSQLStrategy.
   */
  executeRawSql?: (objectName: string, sql: string, params: unknown[]) => Promise<Record<string, unknown>[]>;
  /**
   * Execute an ObjectQL aggregate query.
   * Required for ObjectQLStrategy.
   */
  executeAggregate?: (objectName: string, options: {
    groupBy?: string[];
    aggregations?: Array<{ field: string; method: string; alias: string }>;
    filter?: Record<string, unknown>;
    /** Reference timezone (IANA) for date bucketing — ADR-0053 Phase 2. */
    timezone?: string;
    /**
     * ADR-0021 D-C (#3602) — the request's ExecutionContext. Bridges MUST
     * forward it to `engine.aggregate` so engine-side RLS applies; see
     * `StrategyContext.executeAggregate` for why this is a second belt rather
     * than a replacement for `getReadScope`.
     */
    context?: ExecutionContext;
  }) => Promise<Record<string, unknown>[]>;
  /**
   * Fallback IAnalyticsService (e.g. MemoryAnalyticsService).
   * Used by InMemoryStrategy.
   */
  fallbackService?: IAnalyticsService;
  /**
   * Custom strategies to add/replace the defaults.
   * They are merged with the built-in strategies and sorted by priority.
   */
  strategies?: AnalyticsStrategy[];
  /**
   * ADR-0021 D-C — context-aware per-object read scope (tenant + RLS). Supplied
   * by the runtime that owns the sharing middleware; receives the current
   * request's ExecutionContext and returns the RLS `FilterCondition` for the
   * object (exactly what `RLSCompiler` emits). The service binds the active
   * context per query and the strategy compiles the filter into alias-qualified
   * SQL injected into every base and joined table.
   *
   * MAY be async: the production bridge resolves RLS from the `security`
   * service's `getReadFilter`, which can hit the database. The service
   * pre-resolves the scope for every base + joined object of a query (before
   * the synchronous SQL builder runs), so a sync return still works unchanged.
   */
  getReadScope?: (
    objectName: string,
    context?: ExecutionContext,
  ) =>
    | FilterCondition
    | null
    | undefined
    | Promise<FilterCondition | null | undefined>;
  /**
   * ADR-0021 D-C — join allowlist per cube (the dataset's declared `include`).
   * Joins outside this set are rejected by the strategy. Compiled datasets
   * (via `queryDataset`/`registerDataset`) supply this automatically; this
   * config hook is a fallback for legacy hand-authored cubes.
   */
  getAllowedRelationships?: (cubeName: string) => Set<string> | undefined;
  /**
   * Coerce a filter comparand to a temporal column's storage form so a
   * relative-date / ISO-string value compares correctly on the active driver
   * (SQLite `Field.datetime` → epoch ms; `Field.date` / native timestamp →
   * unchanged). Threaded into the StrategyContext and consulted by
   * `NativeSQLStrategy` when binding filter values. See the contract docs on
   * `StrategyContext.coerceTemporalFilterValue` for the full rationale.
   */
  coerceTemporalFilterValue?: (objectName: string, fieldName: string, value: unknown) => unknown;
  /**
   * Normalise the COLUMN side of the same comparison to that storage form — the
   * other half of the fix, needed because a SQLite `Field.datetime` holds both an
   * INTEGER epoch (a `Date` write) and ISO TEXT (a REST/JSON write, a `NOW()`
   * default) at once, so coercing only the comparand matches one of them and
   * misses the other (#3912). See `StrategyContext.coerceTemporalFilterColumn`.
   */
  coerceTemporalFilterColumn?: (objectName: string, fieldName: string, columnSql: string) => string;
  /**
   * ADR-0062 D6 — report whether an object is federated (external datasource).
   * Threaded into the StrategyContext so `NativeSQLStrategy` declines external
   * objects (which it would otherwise query against the wrong physical table),
   * routing them to the driver-correct ObjectQL aggregate path instead. See
   * `StrategyContext.isExternalObject`.
   */
  isExternalObject?: (objectName: string) => boolean;
  /**
   * [#5033] The datasource `objectName` is bound to, or `undefined` when it
   * rides the default one (or nothing authoritative can answer).
   *
   * It never selects a driver (that is `engine.execute`'s `object` key, which
   * the `plugin.ts` bridge now passes). It exists so that when a dataset's SQL
   * references a table that is NOT on the datasource its base object routed to,
   * the failure can name the actual cause — *table X is not on datasource Y* —
   * instead of the misleading "backing object … is unavailable" that a
   * cross-datasource join used to produce.
   *
   * [#5115] The same probe now also gates COMPILATION: `registerDataset` hands
   * it to `compileDataset`, which rejects a dataset whose join crosses
   * datasources before any query is ever built. Absence keeps the pre-#5115
   * behaviour exactly ("cannot answer, do not block") — the query-time
   * diagnostic above stays as the backstop.
   *
   * [#5288] "Bound to" above is the whole contract, and it took until #5288 for
   * the built-in host to honour it: `plugin.ts` answered with the object's
   * DECLARED `datasource` — step 1 of the five `ObjectQL.getDriver` routes by —
   * so an object placed by a `datasourceMapping` rule, by the ADR-0057 §3.6
   * lifecycle split, or by its package's `defaultDatasource` reported
   * `'default'` and sent the message above to the wrong database. It now asks
   * `ObjectQL.resolveEffectiveDatasource`. A custom host owes the same answer:
   * the datasource an object is BOUND to, `undefined` when nothing binds it.
   */
  getObjectDatasource?: (objectName: string) => string | undefined;
  /**
   * [#3867] Is `name` a registered object in this kernel's schema registry?
   *
   * Consulted by {@link AnalyticsService.ensureCube} on the auto-inference
   * path only. When no Cube is registered under the queried name, the service
   * infers a minimal one whose `sql` IS that name — the intended "metric over
   * an object" path (an `object-metric` KPI widget queries `crm_account`
   * without anyone authoring a Cube). Without this hook that inference accepts
   * ANY string, so an arbitrary physical table name reached the driver: the
   * analytics-side twin of the data-path gap closed in #3770.
   *
   * Optional, and absence means "skip the check" — same tiering as #3770's
   * `assertObjectRegistered`: with no registry to consult the question cannot
   * be answered, and failing closed would break every embedding that runs
   * analytics without a data engine. The production bridge in `plugin.ts`
   * always wires it.
   */
  isRegisteredObject?: (name: string) => boolean;
  /**
   * [#4437] The FIELD NAMES `objectName` declares, or `undefined` when nothing
   * authoritative can answer.
   *
   * Consulted by {@link AnalyticsService.ensureCube} to validate the SOURCE
   * FIELD a measure resolves to BEFORE any SQL is built. `inferMeasure` maps a
   * suffix convention onto a field name (`ghost_sum` → `SUM(ghost)`) and used
   * to accept any spelling, so a typo'd measure reached the driver as a column
   * and came back as an opaque `500 SQLITE_ERROR` — a driver error class on the
   * wire for a caller-shaped mistake (ADR-0112). The DATA route already refuses
   * the same mistake with a `400 INVALID_FIELD` naming the field (#4315/#4254);
   * this hook is what lets the ANALYTICS route give the same answer.
   *
   * [#5520] The same probe now answers for DIMENSIONS too
   * ({@link AnalyticsService.assertDimensionFields}). #4437 gated only the
   * measure half, so the identical typo one key over — `dimensions:
   * ['bogus_dim']` — still reached the driver as a `GROUP BY` column and came
   * back as the same 500. One probe, one answer, both member kinds.
   *
   * [#5669] …and for the `where` members ({@link AnalyticsService.assertWhereFields}),
   * the third and last request key that carries a field name. `where:
   * {bogus_col: 'x'}` compiled straight into `WHERE bogus_col = $1` for exactly
   * as long as #4437 and #5520 had each closed only their own key. One probe now
   * answers for all three.
   *
   * Same tiering as {@link isRegisteredObject}: absence means "skip the check"
   * (registry-less hosts, engine doubles, external datasources whose columns
   * are not mirrored locally). The production bridge in `plugin.ts` wires it
   * from the same schema registry the data path's gate reads, so "which fields
   * exist" has ONE answer across `/data` and `/analytics`.
   */
  getObjectFieldNames?: (objectName: string) => readonly string[] | undefined;
  /**
   * ADR-0021 — optional object-graph resolver used when compiling datasets:
   * `(baseObject, relationshipName) => relatedObjectName | undefined`. When
   * provided, `queryDataset` validates that every declared `include` exists.
   */
  relationshipResolver?: RelationshipResolver;
  /**
   * Resolve the metadata of a dimension's or measure's SOURCE FIELD on the
   * dataset's base object — the one seam through which display semantics that
   * live on the field reach the result columns. `undefined` for an unknown
   * field. Feeds three chains:
   *
   * - ADR-0053 currency: a monetary measure that omits an explicit `currency`
   *   falls back to the field's declared currency, then the tenant default
   *   (`ctx.currency`). Non-`currency` fields never get a code.
   * - Percent scale (objectui#3136): a measure over a `percent` field inherits
   *   that field's storage scale via `percentScaleOf`, so a renderer scales by
   *   declared metadata instead of guessing from the value.
   * - Date bucketing: a date vs datetime dimension drills by the right bound.
   */
  sourceFieldMeta?: (object: string, field: string) => { type?: string; defaultCurrency?: string; max?: number } | undefined;
  /** Pre-defined datasets to compile + register at construction (ADR-0021). */
  datasets?: Dataset[];
  /**
   * ADR-0021 — resolve raw dimension values to human display labels. When
   * provided, `queryDataset` post-processes result rows so a `select` dimension
   * shows its option label (not the stored value) and a `lookup`/`master_detail`
   * dimension shows the related record's display name (not the FK id). Injected
   * by the plugin from the `data` engine; omit to keep raw values.
   */
  labelResolver?: DimensionLabelDeps;

  /**
   * ADR-0037 Phase 3 — draft data preview. Resolve the PENDING `seed` draft
   * rows for an object (returns null when the object has no pending seed).
   * When provided and `queryDataset` is called with `previewDrafts`, the
   * selection is evaluated over these rows in memory instead of the engine —
   * the Live Canvas charts real numbers from the drafted sample data, and
   * because publish materializes the SAME seed, the numbers are continuous
   * across the publish boundary. Reads only; never touches physical tables.
   */
  draftRowsResolver?: (
    objectName: string,
    context?: ExecutionContext,
  ) => Promise<Record<string, unknown>[] | null>;
}

/**
 * Default capabilities when probing is not configured — assumes in-memory only.
 */
const DEFAULT_CAPABILITIES: AnalyticsDriverCapabilities = {
  nativeSql: false,
  objectqlAggregate: false,
  inMemory: true,
};

/**
 * AnalyticsService — Multi-driver analytics orchestrator.
 *
 * Implements `IAnalyticsService` by delegating to a priority-ordered
 * strategy chain:
 *
 * | Priority | Strategy | Condition |
 * |:---:|:---|:---|
 * | P1 (10) | NativeSQLStrategy | Driver supports raw SQL |
 * | P2 (20) | ObjectQLStrategy | Driver supports aggregate AST |
 * | P3 (30) | (custom / InMemoryStrategy from driver-memory) | Injected by user |
 *
 * When `fallbackService` is configured, an internal delegate strategy
 * is automatically appended at priority 30 as a safety net.
 *
 * The service also owns a `CubeRegistry` for metadata discovery and
 * auto-inference from object schemas.
 */
export class AnalyticsService implements IAnalyticsService {
  private readonly strategies: AnalyticsStrategy[];
  /** Context-independent part of the StrategyContext (no per-request scope). */
  private readonly baseCtx: StrategyContext;
  /** Context-aware read-scope provider (bound to the request's context per call). */
  private readonly readScopeProvider?: AnalyticsServiceConfig['getReadScope'];
  /** Compiled datasets by name — feeds the join allowlist (D-C) and queryDataset. */
  private readonly datasetRegistry = new Map<string, CompiledDataset>();
  /** Optional object-graph resolver used when compiling datasets. */
  private readonly relationshipResolver?: RelationshipResolver;
  private readonly sourceFieldMeta?: AnalyticsServiceConfig['sourceFieldMeta'];
  /** Optional dimension display-label resolver (select options / lookup names). */
  private readonly labelResolver?: DimensionLabelDeps;
  /** ADR-0037 P3: pending-seed row resolver for draft data preview. */
  private readonly draftRowsResolver?: AnalyticsServiceConfig['draftRowsResolver'];
  /** [#3867] Schema-registry probe gating cube auto-inference. */
  private readonly isRegisteredObject?: AnalyticsServiceConfig['isRegisteredObject'];
  /** [#4437] Field-name probe gating measure source-field resolution. */
  private readonly getObjectFieldNames?: AnalyticsServiceConfig['getObjectFieldNames'];
  /**
   * [#5033] Datasource probe for the missing-source triage — and, since #5115,
   * for the compile-time cross-datasource join gate in `compileDataset`.
   */
  private readonly getObjectDatasource?: AnalyticsServiceConfig['getObjectDatasource'];
  /** ADR-0062 D6 — federated-object probe (strategy routing + #5115's gate). */
  private readonly isExternalObject?: AnalyticsServiceConfig['isExternalObject'];
  /** [#3867] One-shot flag for the {@link assertInferableCube} stand-down warning. */
  private warnedNoObjectRegistry = false;
  readonly cubeRegistry: CubeRegistry;
  private readonly logger: Logger;

  constructor(config: AnalyticsServiceConfig = {}) {
    this.logger = config.logger || createLogger({ level: 'info', format: 'pretty' });
    this.cubeRegistry = new CubeRegistry();

    // Register pre-defined cubes
    if (config.cubes) {
      this.cubeRegistry.registerAll(config.cubes);
    }

    this.readScopeProvider = config.getReadScope;
    this.relationshipResolver = config.relationshipResolver;
    this.sourceFieldMeta = config.sourceFieldMeta;
    this.labelResolver = config.labelResolver;
    this.draftRowsResolver = config.draftRowsResolver;
    this.isRegisteredObject = config.isRegisteredObject;
    this.getObjectFieldNames = config.getObjectFieldNames;
    this.getObjectDatasource = config.getObjectDatasource;
    this.isExternalObject = config.isExternalObject;

    // Compile + register pre-defined datasets (ADR-0021).
    if (config.datasets) {
      for (const ds of config.datasets) {
        try {
          this.registerDataset(ds);
        } catch (e) {
          this.logger?.warn?.(`[Analytics] Failed to register dataset "${ds?.name}": ${String((e as Error)?.message ?? e)}`);
        }
      }
    }

    // Build the context-independent strategy context. `getReadScope` is bound
    // per query in `callCtx(context)` so it can resolve the active tenant.
    this.baseCtx = {
      getCube: (name) => this.cubeRegistry.get(name),
      queryCapabilities: config.queryCapabilities || (() => DEFAULT_CAPABILITIES),
      executeRawSql: config.executeRawSql,
      executeAggregate: config.executeAggregate,
      fallbackService: config.fallbackService,
      // Prefer a compiled dataset's declared relationships (D-C join allowlist);
      // fall back to any explicitly-configured provider for legacy cubes.
      getAllowedRelationships: (cubeName: string) =>
        this.datasetRegistry.get(cubeName)?.allowedRelationships
        ?? config.getAllowedRelationships?.(cubeName),
      coerceTemporalFilterValue: config.coerceTemporalFilterValue,
      coerceTemporalFilterColumn: config.coerceTemporalFilterColumn,
      isExternalObject: config.isExternalObject,
    };

    // Build strategy chain (built-in + custom, sorted by priority)
    // InMemoryStrategy is NOT built-in — it lives in @objectstack/driver-memory
    // and should be passed via config.strategies when needed.
    // When fallbackService is configured, an internal delegate is added at P3.
    const builtIn: AnalyticsStrategy[] = [
      new NativeSQLStrategy(),
      new ObjectQLStrategy(),
    ];

    // Auto-add fallback delegate when fallbackService is provided
    if (config.fallbackService) {
      builtIn.push(new FallbackDelegateStrategy());
    }

    const custom = config.strategies || [];
    this.strategies = [...builtIn, ...custom].sort((a, b) => a.priority - b.priority);

    this.logger.info(
      `[Analytics] Initialized with ${this.cubeRegistry.size} cubes, ` +
      `${this.strategies.length} strategies: ${this.strategies.map(s => s.name).join(' → ')}`,
    );
  }

  /**
   * Build a per-call StrategyContext that binds the read-scope provider to the
   * current request's ExecutionContext (ADR-0021 D-C). The strategy then sees a
   * `getReadScope(objectName)` that already knows the active tenant.
   */
  private async callCtx(
    query: AnalyticsQuery,
    context?: ExecutionContext,
  ): Promise<StrategyContext> {
    // #3602 — `context` rides along unconditionally. It is the ENGINE-side belt
    // (forwarded to `engine.aggregate`, where the middleware chain applies its
    // own RLS), so it must not be gated on the analytics-side belt being wired:
    // a deployment with no `getReadScope` provider is exactly the one that most
    // needs the engine to scope for it.
    if (!this.readScopeProvider) return { ...this.baseCtx, context };
    // Pre-resolve the read scope for every object the strategy will scan (base
    // + all declared joins) BEFORE the synchronous SQL builder runs, since the
    // provider may be async (the production `security.getReadFilter` bridge).
    // The strategy then reads each object's filter synchronously from the map.
    const scopes = await this.resolveReadScopes(query, context);
    return {
      ...this.baseCtx,
      context,
      getReadScope: (objectName: string) => scopes.get(objectName) ?? null,
    };
  }

  /**
   * Resolve the read scope (tenant + RLS `FilterCondition`) for the base object
   * AND every joined object of the query's cube, keyed by object name. This is
   * the async pre-pass that lets the synchronous strategy enforce scoping even
   * when the provider (security `getReadFilter`) resolves asynchronously.
   *
   * The object set is `cube.sql` (base) plus every `cube.joins[*].name` — a
   * SUPERSET of what the strategy actually scans (the strategy only joins along
   * declared relationships), so no scanned object is ever left unscoped.
   *
   * Fail-closed: if the provider throws for an object, the whole query is
   * rejected rather than emitting SQL with that object unscoped.
   */
  private async resolveReadScopes(
    query: AnalyticsQuery,
    context?: ExecutionContext,
  ): Promise<Map<string, FilterCondition>> {
    const map = new Map<string, FilterCondition>();
    const provider = this.readScopeProvider;
    if (!provider || !query.cube) return map;
    const cube = this.cubeRegistry.get(query.cube);
    if (!cube) return map;

    const objects = new Set<string>();
    if (typeof cube.sql === 'string' && cube.sql.trim()) {
      objects.add(cube.sql.trim());
    }
    const joins = (cube as { joins?: Record<string, { name?: string }> }).joins;
    if (joins) {
      for (const [alias, j] of Object.entries(joins)) {
        objects.add(j?.name ?? alias);
      }
    }

    for (const object of objects) {
      let filter: FilterCondition | null | undefined;
      try {
        filter = await provider(object, context);
      } catch (e) {
        // Deny the entire query — never fall through to unscoped SQL.
        this.logger.error?.(
          `[Analytics] read-scope resolution failed for object "${object}" — ` +
          `rejecting query (fail-closed, ADR-0021 D-C)`,
          e instanceof Error ? e : new Error(String(e)),
        );
        throw new Error(
          `[Analytics] read-scope resolution failed for "${object}"; query denied (fail-closed).`,
        );
      }
      if (filter != null) map.set(object, filter);
    }
    return map;
  }

  /**
   * Execute an analytical query by delegating to the first capable strategy.
   *
   * A strategy can discover only AT EXECUTION TIME that the underlying driver
   * cannot serve it — the canonical case is NativeSQLStrategy on an in-memory
   * driver, whose `execute()` returns null for raw SQL (the auto-bridge throws
   * `RAW_SQL_UNSUPPORTED`). That is a capability miss, not a query error: fall
   * back to the next capable strategy (e.g. ObjectQLStrategy over the
   * aggregate bridge) instead of failing — or worse, fabricating empty rows.
   * Any other error propagates untouched.
   */
  async query(query: AnalyticsQuery, context?: ExecutionContext): Promise<AnalyticsResult> {
    if (!query.cube) {
      throw new Error('Cube name is required in analytics query');
    }

    this.ensureCube(query);
    const ctx = await this.callCtx(query, context);
    let skip: Set<AnalyticsStrategy> | undefined;
    for (;;) {
      const strategy = this.resolveStrategy(query, ctx, skip);
      this.logger.debug(`[Analytics] Query on cube "${query.cube}" → ${strategy.name}`);
      try {
        return await strategy.execute(query, ctx);
      } catch (e) {
        if ((e as { code?: string })?.code === 'RAW_SQL_UNSUPPORTED') {
          this.logger.warn(
            `[Analytics] ${strategy.name} cannot run on this driver (raw SQL unsupported) — falling back to the next strategy.`,
          );
          (skip ??= new Set()).add(strategy);
          continue;
        }
        throw e;
      }
    }
  }

  /**
   * Compile a `dataset` (ADR-0021) and register its Cube + join allowlist so it
   * can be queried by name. Idempotent (re-registering overwrites). Returns the
   * compiled dataset.
   */
  registerDataset(dataset: Dataset): CompiledDataset {
    // #5115 — the datasource/federation probes turn a cross-datasource join
    // from a query-time explosion into a registration-time rejection. Both are
    // optional and tiered "cannot answer, do not block" inside the compiler.
    const compiled = compileDataset(dataset, this.relationshipResolver, {
      getObjectDatasource: this.getObjectDatasource,
      isExternalObject: this.isExternalObject,
    });
    this.cubeRegistry.register(compiled.cube);
    this.datasetRegistry.set(dataset.name, compiled);
    return compiled;
  }

  /**
   * Execute a semantic-layer dataset (ADR-0021). Compiles the dataset (saved or
   * inline draft — Studio preview), registers its Cube + join allowlist, then
   * runs the selection through the `DatasetExecutor` with the request context so
   * tenant/RLS scoping (D-C) is applied. See {@link IAnalyticsService.queryDataset}.
   */
  async queryDataset(
    dataset: Dataset,
    selection: DatasetSelection,
    context?: ExecutionContext,
    options?: { previewDrafts?: boolean },
  ): Promise<AnalyticsResult> {
    const compiled = this.registerDataset(dataset);
    this.logger.debug(`[Analytics] queryDataset "${dataset.name}" (object=${dataset.object}, include=${(dataset.include ?? []).join(',') || '—'})`);

    // ── ADR-0037 P3 — draft data preview ────────────────────────────────────
    // When the request renders the as-if-published world AND the base object
    // has a PENDING seed draft, evaluate the selection over the seed's rows in
    // memory (a query-evaluating proxy feeds the unchanged DatasetExecutor, so
    // measure filters / compareTo / derived measures all behave identically).
    // No pending seed → fall through to the real engine: published objects
    // keep charting live data even inside a preview.
    if (options?.previewDrafts && this.draftRowsResolver) {
      let seedRows: Record<string, unknown>[] | null = null;
      try {
        seedRows = await this.draftRowsResolver(dataset.object, context);
      } catch (e) {
        this.logger.warn(`[Analytics] draft preview resolver failed for "${dataset.object}" — falling back to live data: ${String((e as Error)?.message ?? e)}`);
      }
      if (seedRows) {
        this.logger.debug(`[Analytics] queryDataset "${dataset.name}" → preview over ${seedRows.length} drafted seed row(s)`);
        const previewService = {
          query: async (q: AnalyticsQuery) => evaluateAnalyticsQueryOverRows(q, compiled.cube, seedRows!),
        } as IAnalyticsService;
        const previewResult = await new DatasetExecutor(previewService).execute(compiled, selection, context);
        // Label resolution is skipped on purpose: drafted seed rows reference
        // lookups by NAME (the seed convention), which already reads well.
        return previewResult;
      }
    }

    // [#6761] The audience's language for THIS request, and the only locale
    // either field-label enrichment site below is entitled to use.
    //
    // `ExecutionContext.locale` is the BCP-47 tag `resolveExecutionContext`
    // resolves per request — the caller's `Accept-Language` when it expressed a
    // preference, else the workspace `localization` setting. It is the same
    // context field the currency chain a few lines down already reads, so both
    // display decisions in this response answer to one request identity.
    //
    // `undefined` (no context, or an anonymous request that skips localization)
    // is passed through deliberately rather than defaulted here: the shared
    // resolver documents nullish as "no locale known" and answers `en`, the
    // platform's source language. Choosing a different default in this file
    // would be this service disagreeing with the renderer about the same map.
    const requestLocale = context?.locale;

    // #3602 — every label lookup in this request (sort keys below, display
    // labels further down) reads the REFERENCED object, so bind that object's
    // own read scope to this request once, up front.
    const provider = this.readScopeProvider;
    const resolveScope = provider
      ? (targetObject: string) => provider(targetObject, context)
      : undefined;
    // #3680 — per-request label-fetch cache. A selection that sorts by a
    // lookup dimension resolves labels twice (pre-window sort keys, then
    // post-window display); the cache makes the display pass reuse the ids the
    // sort already fetched, so label-ordering costs ONE id→name read total.
    const labelDeps = this.labelResolver ? withLabelFetchCache(this.labelResolver) : undefined;
    // #3680 — hand the executor the sort-key label hook so an `order` on a
    // select/lookup dimension sorts by the label the user reads. Built over
    // the SAME capabilities (and read scope) as the display resolution below.
    const orderLabels = labelDeps && dataset.dimensions?.length
      ? createOrderLabelResolver(
          dataset.object,
          dataset.dimensions
            .filter((d) => !!d.field)
            .map((d) => ({ name: d.name, field: d.field as string })),
          labelDeps,
          resolveScope,
          context,
        )
      : undefined;

    // Graceful degradation: a dashboard/report widget whose backing object or
    // table is not present in this kernel (e.g. a platform dashboard like
    // System Overview that charts `sys_audit_log`, opened in an environment
    // that never mounted the audit object) must render as "no data" — NOT
    // crash the widget with a 500. Datasets were the one read surface that
    // hard-failed on a missing source.
    //
    // #5033 — that leniency is scoped to the dataset's OWN source. Once the raw-SQL
    // bridge routes by object (`plugin.ts`), a dataset that JOINS across datasources
    // fails on the base object's datasource with the JOINED table missing. Reporting
    // that as "backing object … is unavailable" would be the misleading old shape
    // wearing a new cause: the base table is right there, and the widget would keep
    // rendering the confident `0` this issue is about. So triage by WHICH relation
    // the driver named, and let a cross-datasource dataset fail loudly.
    //
    // #5717 — and the leniency is scoped to errors NOBODY classified. The
    // triage below reads message text, so before it runs, an error that carries
    // an ADR-0112 envelope is re-thrown untouched: its producer already said
    // what it is, and a `DATASET_INVALID` / 400 turned into `{rows: []}` is the
    // #5033 symptom wearing the opposite disguise — the caller's own mistake
    // reported as "no data", with no exception, no 4xx, no 5xx, just a warn and
    // a confident empty chart. See {@link hasDeclaredErrorEnvelope}.
    let result: AnalyticsResult;
    try {
      result = await new DatasetExecutor(this, orderLabels).execute(compiled, selection, context);
    } catch (err) {
      // The producer answered the classification question — the route's
      // envelope reader serves it (4xx as itself, declared 5xx through the
      // `ANALYTICS_QUERY_FAILED` path). Nothing here may re-judge it by wording.
      if (hasDeclaredErrorEnvelope(err)) throw err;
      if (isMissingSourceError(err)) {
        const missing = missingSourceRelation(err);
        const detail = String((err as Error)?.message ?? err);
        // A named relation that is NOT the dataset's own object is a joined table.
        // If that object IS registered in this kernel, it exists — just not on the
        // datasource this query ran against: a topology error, not an absence.
        // (`isRegisteredObject` absent / unable to answer ⇒ treat as registered,
        // the same "cannot answer, do not block" tiering it carries elsewhere;
        // here the honest report is the loud one, since the base table resolved.)
        const joined = missing && missing.toLowerCase() !== dataset.object.toLowerCase() ? missing : undefined;
        if (joined && (this.isRegisteredObject?.(joined) ?? true)) {
          const baseDs = this.getObjectDatasource?.(dataset.object);
          const joinedDs = this.getObjectDatasource?.(joined);
          const where = baseDs ? `datasource "${baseDs}"` : 'the default datasource';
          const joinedWhere = joinedDs ? `datasource "${joinedDs}"` : 'the default datasource';
          throw new Error(
            `[Analytics] dataset "${dataset.name}" cannot be executed as one statement: table "${joined}" ` +
            `is not on ${where}, which is where its base object "${dataset.object}" lives — ` +
            `"${joined}" is registered on ${joinedWhere}. A dataset JOIN cannot cross datasources. ` +
            `Fix it by binding both objects to the same datasource, or by dropping the cross-datasource ` +
            `relationship from the dataset's \`include\`/dimensions. (driver said: ${detail})`,
          );
        }
        this.logger.warn(
          `[Analytics] dataset "${dataset.name}" backing object "${dataset.object}" is unavailable ` +
          `(${detail}); returning an empty result instead of failing the widget`,
        );
        return { rows: [], fields: [], totals: [] };
      }
      throw err;
    }

    // Selected dimensions resolved against the dataset definition — shared by
    // drill metadata, label resolution, and dimension field-label enrichment.
    const selectedDims = (selection.dimensions ?? [])
      .map((name) => dataset.dimensions?.find((d) => d.name === name))
      .filter((d): d is NonNullable<typeof d> => !!d);

    // ADR-0021 D2 — drill-through metadata. A host (dashboard/report) drills a
    // clicked bucket back to the underlying records, but it only knows the
    // dimension NAMES, and the label resolution below OVERWRITES the raw grouped
    // value in each row with its display label. So before that happens, snapshot
    // the raw grouped values into a PARALLEL array (aligned to `rows` by index —
    // the result rows are NOT mutated) and expose the dataset's `object` +
    // dimension→field mapping so the renderer can build an exact-match filter.
    // Date buckets are excluded — a humanized bucket ("2026-06") can't be
    // exact-matched against the stored timestamp, so they are not drillable.
    const drillDims = selectedDims.filter((d) => !!d.field && d.type !== 'date');
    if (drillDims.length && result.rows.length) {
      (result as AnalyticsResultWithDrill).object = dataset.object;
      (result as AnalyticsResultWithDrill).dimensionFields = Object.fromEntries(
        drillDims.map((d) => [d.name, d.field as string]),
      );
      (result as AnalyticsResultWithDrill).drillRawRows = result.rows.map((row) => {
        const raw: Record<string, unknown> = {};
        for (const d of drillDims) raw[d.name] = row[d.name];
        return raw;
      });
      // #3214 — the totals/subtotal rows (#1753) carry dimension values too and
      // go through the SAME label resolution below, so snapshot their raw
      // grouped values here in the same pre-label pass. Aligned to `result.totals`
      // by index; each grouping is restricted to the drillable dims it actually
      // groups by (the grand-total grouping `[]` keeps empty maps, so a subtotal
      // drill filters by the stored value while the grand total drills unfiltered).
      if (result.totals?.length) {
        (result as AnalyticsResultWithDrill).drillRawTotals = result.totals.map((total) => {
          const groupingDims = drillDims.filter((d) => total.dimensions.includes(d.name));
          return total.rows.map((row) => {
            const raw: Record<string, unknown> = {};
            for (const d of groupingDims) raw[d.name] = row[d.name];
            return raw;
          });
        });
      }
    }

    // #1752 — date-range drill scope. A `dateGranularity` dimension groups a
    // SPAN of records into one bucket, so drilling it needs a half-open range
    // `[gte, lt)`, which the equality `drillRawRows` sidecar can't express
    // (that's exactly why date dims are excluded from `drillDims` above). Emit
    // a parallel range sidecar computed — via the shared inverse util so server
    // and client agree on boundaries — from the canonical bucket KEY, which is
    // still in `rows[i][dim]` here (this runs BEFORE label resolution rewrites
    // it to a display label).
    const rangeTz = selection.timezone ?? context?.timezone ?? 'UTC';
    // Per drillable date+granularity dim, decide how to serialize its bounds
    // (ADR-0053 temporal semantics):
    //   - `datetime` → the reference tz's MIDNIGHT INSTANT (ISO), because the
    //     bucket is defined on that tz's calendar (works under any tz, incl. DST);
    //   - `date` → `YYYY-MM-DD` calendar bounds, a tz-naive calendar day that is
    //     exact under ANY reference tz;
    //   - unknown field type → safe only under UTC (where the calendar day and
    //     its instant coincide); under a non-UTC tz we can't tell whether to
    //     shift, so the dim is omitted and the host drills a superset.
    // The bucket size to invert MUST be the one the query actually grouped by —
    // `selection.dateGranularity` overrides the dataset dimension's default
    // (#3588). Reading `d.dateGranularity` here meant a widget that bucketed by
    // quarter or year got its ranges computed from the dataset's month (or,
    // when the dataset declared none, dropped entirely) — so drilling a bucket
    // opened the wrong span, or the chart lost drill-through altogether.
    const rangeDims: Array<{ d: (typeof selectedDims)[number]; granularity: DateGranularityValue; instant: boolean }> = [];
    for (const d of selectedDims) {
      if (!d.field || d.type !== 'date') continue;
      const granularity = resolveDimensionGranularity(selection, d.name, d.dateGranularity);
      if (!granularity) continue;
      const ftype = this.sourceFieldMeta?.(dataset.object, d.field as string)?.type;
      if (ftype === 'datetime') rangeDims.push({ d, granularity, instant: true });
      else if (ftype === 'date') rangeDims.push({ d, granularity, instant: false });
      else if (rangeTz === 'UTC') rangeDims.push({ d, granularity, instant: false });
      // else: unknown field type under a non-UTC reference tz → omit (superset).
    }
    if (rangeDims.length && result.rows.length) {
      const bound = (ymd: string, instant: boolean): string =>
        instant ? new Date(zonedDateStartToUtcMs(ymd, rangeTz)).toISOString() : ymd;
      (result as AnalyticsResultWithDrill).drillRanges = result.rows.map((row) => {
        const ranges: Record<string, { field: string; gte: string; lt: string }> = {};
        for (const { d, granularity, instant } of rangeDims) {
          // A row in the empty bucket carries `null` here (#3839) and yields no
          // range, so that row simply gets no drill bound — the superset.
          const cal = bucketKeyToCalendarRange(row[d.name] as string | null, granularity);
          if (cal) {
            ranges[d.name] = { field: d.field as string, gte: bound(cal.start, instant), lt: bound(cal.end, instant) };
          }
        }
        return ranges;
      });
      // The equality drill block sets `object` only when a NON-date drill dim
      // exists; a report grouped ONLY by time still needs the base object so the
      // host can open its list. Safe to (re)set to the same dataset object.
      (result as AnalyticsResultWithDrill).object = dataset.object;
    }

    // ADR-0021 — resolve grouped dimension values to human display labels
    // (select option label, lookup related-record name). Charts render the
    // dimension key verbatim, so this is the single place that turns a stored
    // value / FK id into the text a user expects to read.
    if (labelDeps && selectedDims.length) {
      // Same single-source rule as the drill ranges above: a date bucket must be
      // LABELLED with the granularity it was actually grouped by (#3588).
      // Formatting a `year` bucket with the dataset's `month` default rendered
      // it as "1970-01" — the year key re-parsed as an epoch millisecond count.
      const dims = selectedDims
        .filter((d) => !!d.field)
        .map((d) => ({
          name: d.name,
          field: d.field,
          type: d.type,
          dateGranularity: resolveDimensionGranularity(selection, d.name, d.dateGranularity),
        }));
      if (dims.length) {
        // `resolveScope` (hoisted above) binds the referenced object's read
        // scope to THIS request so the label lookup (a per-record read of the
        // related object) cannot surface a record the referenced object's RLS
        // would hide (#3602). `labelDeps` is the per-request cache over the
        // configured resolver, so ids the sort-key pass (#3680) already fetched
        // are not fetched again here.
        try {
          // `context` rides alongside `resolveScope` — the label lookup's SECOND
          // belt. `resolveScope` is this layer's own predicate; the context lets
          // the engine's middleware scope the same per-record read itself.
          await resolveDimensionLabels(dataset.object, dims, result.rows, labelDeps, resolveScope, context);
          // Totals rows (#1753) carry dimension values too (a row subtotal is
          // keyed by its row bucket) — resolve each grouping's own subset.
          for (const total of result.totals ?? []) {
            const subset = dims.filter((d) => total.dimensions.includes(d.name));
            if (subset.length) {
              await resolveDimensionLabels(dataset.object, subset, total.rows, labelDeps, resolveScope, context);
            }
          }
        } catch (e) {
          this.logger?.warn?.(`[Analytics] dimension label resolution failed for "${dataset.name}": ${String((e as Error)?.message ?? e)}`);
        }
      }
    }

    // ADR-0021 — enrich measure columns with their display `label` + `format`
    // so presentations show "Tasks" / "$616,000" instead of the raw measure
    // name "task_count" / "616000". Carried on the result fields; the renderer
    // applies the format (it can't be baked into the numeric row value).
    //
    // [#6761] The label is resolved through the shared `I18nLabel → string`
    // resolver, so BOTH authorized forms reach the wire: a plain string, and the
    // inline locale map `I18nLabelSchema` has authorized since #5728. The old
    // `typeof m.label === 'string'` test dropped the map silently — a dataset
    // written the way the schema documents shipped a column with no header at
    // all. The wire type is unchanged (`fields[].label?: string`, both ends):
    // this resolves TO a string rather than widening the contract.
    if (result.fields?.length && dataset.measures?.length) {
      const measureByName = new Map(dataset.measures.map((m) => [m.name, m]));
      for (const f of result.fields) {
        const m = measureByName.get(f.name) ?? measureByName.get(f.name.replace(/__compare$/, ''));
        if (!m) continue;
        // `undefined` from the resolver means "nothing was picked" — an absent
        // label, or a map with no usable entry. Nothing is written in that case:
        // this enrichment describes columns, it never invents a header.
        if (f.label == null) {
          const label = resolveI18nLabel(m.label, requestLocale);
          if (label !== undefined) f.label = label;
        }
        if (f.format == null && m.format) f.format = m.format;
        // ADR-0053 currency chain. A MONETARY measure resolves its display
        // currency from: explicit measure `currency` → source-field
        // `currencyConfig.defaultCurrency` → tenant default (`ctx.currency`). A
        // measure is monetary if it declares a currency OR aggregates a
        // `currency`-type field; non-monetary measures (count, avg of a plain
        // number) never receive a currency code.
        const fc = f as { currency?: string };
        const mc = m as { currency?: string };
        const meta = m.field ? this.sourceFieldMeta?.(dataset.object, m.field) : undefined;
        if (fc.currency == null) {
          const monetary = !!mc.currency || meta?.type === 'currency';
          if (monetary) {
            const resolved = mc.currency ?? meta?.defaultCurrency ?? context?.currency;
            if (resolved) fc.currency = resolved;
          }
        }
        // Percent scale chain (objectui#3136) — the currency chain's sibling.
        // A `%` format says how to PRINT a number, not what scale it is on, and
        // the two readings collide at exactly 1 ("100%" vs "1%"). Both answers
        // are in metadata, so answer here instead of leaving the renderer to
        // guess from the value's magnitude: a `ratio` is a 0–1 fraction by
        // definition, and any aggregate of a `percent` field (avg/min/max —
        // sum is already rejected as incoherent) keeps that field's own scale.
        if (f.percentScale == null) {
          f.percentScale = m.derived?.op === 'ratio' ? 'fraction' : percentScaleOf(meta);
        }
      }
    }

    // Enrich DIMENSION columns with their display `label` too, so a grouped
    // table header reads "Status" instead of the raw field name "status". The
    // measure-only enrichment above left dimension headers bare (the renderer
    // then fell back to the raw dimension name).
    //
    // This ENRICHES existing entries and deliberately mints none: whether a
    // column exists at all is the query layer's answer, and inventing one here
    // would describe a column the rows may not carry. #5537 was that gap read
    // from the wrong end — a selection whose base measures were ALL
    // filter-scoped ran no primary query, so `DatasetExecutor.runMeasurePass`
    // assembled a grid with dimension columns in every row and no dimension
    // entry in `fields` for this pass to enrich. Fixed where the grid is
    // assembled (see that method's #5537 note), which is also the only place
    // that knows what the active strategy actually projected.
    //
    // #5688 — the set to describe FROM is wider than `selection.dimensions`. A
    // `timeDimensions` entry that resolves a granularity is GROUPED BY, so it is
    // a result column even when the caller never listed it under `dimensions`
    // (#4033's `projectedDimensions`) — and reading `selection.dimensions` alone
    // left exactly that column carrying a `type` and no `label`, the blind spot
    // #5537's PR pinned as a control case. Widening the LOOKUP is not the same
    // as widening the projection: the loop still enriches only entries
    // `result.fields` already carries, so an entry that stays a pure window
    // contributes no column and receives no descriptor.
    //
    // Kept out of `selectedDims` deliberately. Drill metadata and row-value
    // label resolution above answer a different question — which dimensions the
    // caller GROUPED THE GRID BY, i.e. what a click can be turned back into
    // records — and widening those would change drill payloads and row values,
    // not table headers.
    const describableDims = [...selectedDims];
    for (const t of selection.timeDimensions ?? []) {
      if (describableDims.some((d) => d.name === t.dimension)) continue;
      const d = dataset.dimensions?.find((x) => x.name === t.dimension);
      if (d) describableDims.push(d);
    }
    if (result.fields?.length && describableDims.length) {
      const dimByName = new Map(describableDims.map((d) => [d.name, d]));
      const dimByField = new Map(describableDims.filter((d) => !!d.field).map((d) => [d.field as string, d]));
      for (const f of result.fields) {
        if (f.label != null) continue;
        // Result fields may be keyed by the dataset dimension NAME or the
        // underlying cube FIELD depending on strategy — match either.
        const d = dimByName.get(f.name) ?? dimByField.get(f.name);
        if (!d) continue;
        // [#6761] Same resolver, same locale, same "write nothing on a miss"
        // rule as the measure enrichment above.
        const label = resolveI18nLabel(d.label, requestLocale);
        if (label !== undefined) f.label = label;
      }
    }
    return result;
  }

  /**
   * Get cube metadata for discovery.
   */
  async getMeta(cubeName?: string): Promise<CubeMeta[]> {
    // If a fallback service is configured, merge its metadata with the registry
    const cubes = cubeName
      ? [this.cubeRegistry.get(cubeName)].filter(Boolean) as Cube[]
      : this.cubeRegistry.getAll();

    return cubes.map(cube => ({
      name: cube.name,
      title: cube.title,
      measures: Object.entries(cube.measures).map(([key, measure]) => ({
        name: `${cube.name}.${key}`,
        type: measure.type,
        title: measure.label,
      })),
      dimensions: Object.entries(cube.dimensions).map(([key, dimension]) => ({
        name: `${cube.name}.${key}`,
        type: dimension.type,
        title: dimension.label,
      })),
    }));
  }

  /**
   * Generate SQL for a query without executing it (dry-run).
   */
  async generateSql(query: AnalyticsQuery, context?: ExecutionContext): Promise<{ sql: string; params: unknown[] }> {
    if (!query.cube) {
      throw new Error('Cube name is required for SQL generation');
    }

    this.ensureCube(query);
    const ctx = await this.callCtx(query, context);
    const strategy = this.resolveStrategy(query, ctx);
    this.logger.debug(`[Analytics] generateSql on cube "${query.cube}" → ${strategy.name}`);

    return strategy.generateSql(query, ctx);
  }

  // ── Internal ─────────────────────────────────────────────────────

  /**
   * Ensure a cube exists for the given query and that it knows about every
   * measure referenced by the query.
   *
   * - If no cube is registered for `query.cube`, infer a minimal cube from
   *   the query so downstream strategies (which assume `cube.sql` exists)
   *   don't crash.
   * - If a cube exists but the query references measures that aren't in
   *   `cube.measures` (e.g. `amount_sum`, `amount_avg` emitted by dashboard
   *   widget translators), inject suffix-inferred Metric entries so the
   *   strategies pick the right aggregation function and field.
   *
   * It is also where the three SOURCE-FIELD gates run, on every path out of this
   * method and always BEFORE the (possibly augmented) cube is registered:
   * {@link assertMeasureFields} (#4437), {@link assertDimensionFields} (#5520)
   * and {@link assertWhereFields} (#5669) — one per request key that can carry a
   * field name. All three answer the same question — does the object actually
   * have the column this member resolves to — and all three must answer it here,
   * because from the strategy onwards the answer is the driver's `no such
   * column`.
   *
   * They run in request-key order (measures → dimensions/timeDimensions →
   * where), so a query that gets several wrong is answered about one at a time,
   * naming a real mistake either way.
   */
  private ensureCube(query: AnalyticsQuery): void {
    const name = query.cube!;
    let cube = this.cubeRegistry.get(name);

    if (!cube) {
      // [#3867] Auto-inference below sets `cube.sql = name`, so from here on
      // the queried string IS a physical table name. Verify it names a
      // registered object BEFORE that happens — otherwise `/analytics/query`
      // is a way to aggregate over any table the connection can see, exactly
      // the hole #3770 closed on the data path. A registered Cube needs no
      // such check: it was authored, and its `sql` is whatever it declares.
      this.assertInferableCube(name);
      cube = this.inferCubeFromQuery(query);
      // [#4437] Validate the inferred measures' SOURCE FIELDS before the cube
      // is registered — a rejected query must leave no trace in the registry
      // (same rule the #3867 gate above keeps), or a retry would find a
      // "registered" cube carrying the bogus measure and sail straight to SQL.
      this.assertMeasureFields(query, cube, Object.keys(cube.measures));
      // [#5520] …and the dimensions', for exactly the same reason. On this path
      // `cube.dimensions` was minted from the query moments ago, so the bogus
      // spelling is in there — which is why the suggestion list is computed by
      // subtraction inside the gate rather than echoed verbatim.
      this.assertDimensionFields(query, cube, Object.keys(cube.dimensions));
      // [#5669] …and the `where`'s, third and last of the three request keys that
      // carry a field name. Its members are read from the filter TREE, not from
      // `cube.dimensions` — which on this path was minted from this very query,
      // bogus spelling included.
      this.assertWhereFields(query, cube, Object.keys(cube.dimensions));
      this.cubeRegistry.register(cube);
      // A scalar query — only measures, no grouping (no `dimensions`/
      // `timeDimensions`) — is the first-class "metric over an object" path
      // (e.g. the `object-metric` KPI widget). Auto-inferring a count/sum cube
      // is the intended behaviour there, so log at debug. A query that groups
      // by an explicit dimension or time bucket almost certainly meant to hit a
      // registered cube; keep that at warn so a forgotten registration is loud.
      const isScalarMetric =
        (query.dimensions?.length ?? 0) === 0 && (query.timeDimensions?.length ?? 0) === 0;
      const message =
        `[Analytics] No cube registered for "${name}"; auto-inferred a minimal cube ` +
        `(sql="${name}", measures=${Object.keys(cube.measures).join(',') || '(none)'}, ` +
        `dimensions=${Object.keys(cube.dimensions).join(',') || '(none)'}). ` +
        `Define an explicit Cube in your stack for full control.`;
      if (isScalarMetric) this.logger.debug(message);
      else this.logger.warn(message);
      return;
    }

    // Cube exists — check for unknown measures referenced by the query and
    // augment the cube with suffix-inferred Metric definitions so callers
    // that pass `<field>_sum` / `<field>_avg` etc. get the right aggregation.
    //
    // [#5918] This is the SECOND measure mint, and it judges a dotted spelling
    // exactly as the ad-hoc one does — `mintableMeasureKey` owns the rule. It
    // has to: the ad-hoc path REGISTERS what it infers, so from the second
    // request onwards a cube minted moments ago by `inferCubeFromQuery` is
    // "registered" and arrives here. Measured on `origin/main` `01faeb13a`,
    // one service, two queries:
    //
    //   ① measures: ['count']                        → SELECT COUNT(*) … (warms the registry)
    //   ② measures: ['owner.region_count_distinct']   → SELECT COUNT(DISTINCT region) AS "owner.region_count_distinct"
    //
    // i.e. the silent wrong column #5918 reports, reached through this loop
    // instead of that one. Refusing in only one of the two would have closed the
    // cold request and left every warm one exactly as it was.
    //
    // A measure the cube DECLARES is never minted, so it never reaches the
    // rule — including a declared DOTTED key, which `lookupMember` resolves by
    // direct hit and which this loop must therefore check for verbatim FIRST or
    // it would refuse a cube's own authored vocabulary.
    const extraMeasures: Record<string, any> = {};
    for (const m of query.measures || []) {
      if (cube.measures[m] || extraMeasures[m]) continue;
      const key = mintableMeasureKey(m, name);
      if (cube.measures[key] || extraMeasures[key]) continue;
      extraMeasures[key] = inferMeasure(key);
    }
    if (Object.keys(extraMeasures).length > 0) {
      const augmented: Cube = {
        ...cube,
        measures: { ...cube.measures, ...extraMeasures },
      };
      // [#4437] The cube's DECLARED measures are the ones a caller may name;
      // the suffix-inferred entries just added are a convenience, not a
      // vocabulary. Snapshot the declared list BEFORE registering the augmented
      // cube so the rejection can suggest what the caller could have meant —
      // and so a rejected query leaves the registry as it found it.
      this.assertMeasureFields(query, augmented, Object.keys(cube.measures));
      // [#5520] Dimensions are never augmented (nothing infers one), so the
      // authored/compiled list IS the vocabulary a caller may name — and the one
      // the rejection suggests.
      this.assertDimensionFields(query, augmented, Object.keys(cube.dimensions));
      // [#5669] The `where` gate resolves a filter member through dimensions AND
      // measures (that is what the strategies do for a filter member), so it is
      // handed the AUGMENTED cube — a caller filtering on a suffix-inferred
      // measure must be judged against the same bag the strategy will read.
      this.assertWhereFields(query, augmented, Object.keys(cube.dimensions));
      this.cubeRegistry.register(augmented);
      this.logger.debug(
        `[Analytics] Augmented cube "${name}" with inferred measures: ${Object.keys(extraMeasures).join(',')}`,
      );
    } else {
      // No inference happened — every measure is declared. Still validate: an
      // authored cube can declare a measure over a field the object dropped.
      this.assertMeasureFields(query, cube, Object.keys(cube.measures));
      this.assertDimensionFields(query, cube, Object.keys(cube.dimensions));
      this.assertWhereFields(query, cube, Object.keys(cube.dimensions));
    }
  }

  /**
   * [#4437] Reject a measure whose SOURCE FIELD the backing object does not
   * have, BEFORE the strategy compiles it into SQL.
   *
   * `inferMeasure` maps a suffix convention onto a field name and has no way to
   * know whether that field exists: `ghost_sum` happily became `SUM(ghost)`, the
   * driver threw `no such column`, and the caller got
   * `500 {"code":"SQLITE_ERROR","message":"Internal server error"}` — a driver
   * error class on the wire, and nothing actionable, for what is a plain typo.
   * The DATA route has refused the same mistake with a `400 INVALID_FIELD`
   * naming the field since #4315/#4254; this is the analytics half of that
   * answer, and it is deliberately the SAME envelope (`code`/`field`/`object`/
   * `param`) so one mistake has one shape across both routes.
   *
   * What it checks, and what it deliberately does not:
   *
   * - Only when the cube's `sql` is a bare OBJECT NAME. An authored cube whose
   *   `sql` is a real SQL expression has no field list to check against.
   * - Only when {@link AnalyticsServiceConfig.getObjectFieldNames} answers.
   *   Absent hook / unknown object → stand down (see the config field's doc).
   * - Only measures whose source is a BARE COLUMN. `count(*)` has no source
   *   field, and a dotted reference (`account.industry`) resolves through a
   *   join whose target this check cannot see — both pass through untouched.
   * - `id` / `created_at` / `updated_at` are admitted unconditionally, matching
   *   the data path's `resolveQueryFields`: they are engine-assigned rather than
   *   declared, and a gate stricter than the engine it guards would reject
   *   queries that used to work.
   *
   * [#5918] Its `stripPrefix` below is deliberately NOT narrowed the way the two
   * MINTS were. This is a RESOLVER — it mirrors `lookupMember`'s tiers to answer
   * "which Metric will the strategy read", and that tier order did not change.
   * What changed is what can reach it: a dotted measure is now either a
   * `<cube>.` qualifier or a key the cube itself declares, because every other
   * dotted spelling is refused at the mint before this gate runs.
   */
  private assertMeasureFields(query: AnalyticsQuery, cube: Cube, declaredMeasures: string[]): void {
    const probe = this.getObjectFieldNames;
    if (!probe) return;
    const measures = query.measures ?? [];
    if (measures.length === 0) return;

    const object = typeof cube.sql === 'string' ? cube.sql.trim() : '';
    if (!object || !BARE_IDENTIFIER.test(object)) return;
    const fieldNames = probe(object);
    if (!fieldNames || fieldNames.length === 0) return;
    const known = new Set<string>([...fieldNames, 'id', 'created_at', 'updated_at']);

    const stripPrefix = (m: string) => (m.includes('.') ? m.split('.').slice(1).join('.') : m);
    /** The source field a measure aggregates, or null when there is nothing to check. */
    const sourceFieldOf = (measure: string): string | null => {
      const metric = cube.measures[stripPrefix(measure)] as { type?: string; sql?: unknown } | undefined;
      if (!metric) return null;
      // `count(*)` is the one legitimately field-less aggregate.
      if (metric.type === 'count' && (metric.sql === '*' || metric.sql == null)) return null;
      const source = typeof metric.sql === 'string' ? metric.sql.trim() : '';
      if (!source || source === '*' || !BARE_IDENTIFIER.test(source)) return null;
      return source;
    };

    // Two passes so the rejection can suggest the measures that WOULD have
    // worked. On the auto-inference path `cube.measures` already carries the
    // caller's own bogus spelling (it was inferred from the query moments ago),
    // so echoing the cube's measure list verbatim would offer the typo back as
    // a valid alternative — the one suggestion guaranteed to be wrong.
    const invalid = new Set<string>();
    for (const measure of measures) {
      const source = sourceFieldOf(measure);
      if (source && !known.has(source)) invalid.add(stripPrefix(measure));
    }
    if (invalid.size === 0) return;
    const usable = declaredMeasures.filter((m) => !invalid.has(m));

    for (const measure of measures) {
      const source = sourceFieldOf(measure);
      if (!source || known.has(source)) continue;

      const err = new Error(
        `Measure '${measure}' on cube '${cube.name}' aggregates field '${source}', which object ` +
          `'${object}' does not have. ` +
          `Valid measures: ${usable.join(', ') || '(none)'}. ` +
          `Other measures are inferred from the object's OWN fields as ` +
          `'<field>_sum' / '_avg' / '_min' / '_max' / '_count_distinct', so check the spelling of ` +
          `'${source}' — known fields: ${[...fieldNames].sort().join(', ')}.`,
      ) as Error & { code?: string; status?: number; field?: string; object?: string; param?: string; measure?: string };
      err.code = 'INVALID_FIELD';
      err.status = 400;
      err.field = source;
      err.object = object;
      err.param = 'measures';
      err.measure = measure;
      throw err;
    }
  }

  /**
   * [#5520] Reject a DIMENSION whose source field the backing object does not
   * have, BEFORE the strategy compiles it into `GROUP BY`.
   *
   * The symmetric half of {@link assertMeasureFields}. #4437 closed the measure
   * side and stopped there, so the identical mistake one request key over still
   * reached the driver:
   *
   * ```
   * POST /analytics/query {"cube":"crm_account","measures":["account_count"],"dimensions":["bogus_dim"]}
   * → 500 {"code":"SQLITE_ERROR","message":"Internal server error"}
   *
   * POST /analytics/dataset/query {"selection":{"dimensions":["bogus_dim"],…}}
   * → 500 {"code":"ANALYTICS_QUERY_FAILED",
   *        "error":"SELECT bogus_dim AS \"bogus_dim\", … GROUP BY bogus_dim - no such column: bogus_dim"}
   * ```
   *
   * A driver error class as the caller's `error.code` is the ADR-0112 violation
   * #4437 named, and the dataset face additionally echoed the generated
   * statement — physical table and column names — back to the caller. The
   * envelope here is deliberately the SAME as the measure gate's
   * (`INVALID_FIELD`/400 + `field`/`object`/`param`), because "the query names a
   * field the object does not have" is ONE mistake and must have one wire shape
   * whichever member kind carried it.
   *
   * What it checks, and what it deliberately does not:
   *
   * - **Both dimension keys.** `query.dimensions` and `query.timeDimensions`
   *   land in the same `cube.dimensions` bag, are resolved by the same
   *   `lookupMember`, and produced the same 500 (a bogus time dimension became
   *   `date_trunc('month', bogus_at)`); `param` reports which key carried it.
   * - **An UNDECLARED but real field stays legal.** `dimensions: ['phone']` on a
   *   cube that never declared `phone` groups by `phone` today — the dimension
   *   twin of measure auto-inference, and an established contract. So the
   *   question asked is "does the OBJECT have this field", never "did the cube
   *   declare this dimension". An undeclared member is checked against the
   *   object under the name the strategies would use as the column (their own
   *   `resolveDimensionSql`/`resolveFieldName` fallback: the member itself).
   * - Only when the cube's `sql` is a bare OBJECT NAME, only when
   *   {@link AnalyticsServiceConfig.getObjectFieldNames} answers, and only for
   *   sources that are BARE COLUMNS — same three stand-downs as the measure
   *   gate, for the same reasons (no field list to check against; nothing
   *   authoritative to consult; a dotted reference resolves through a join whose
   *   target this gate cannot see, so it belongs to the join allowlist).
   * - `id` / `created_at` / `updated_at` are admitted unconditionally, matching
   *   the data path's `resolveQueryFields`.
   *
   * Runs after the measure gate and before the `where` gate on each `ensureCube`
   * path, so a query that gets several wrong is answered about its measure
   * first — one rejection at a time, naming a real mistake either way.
   */
  private assertDimensionFields(query: AnalyticsQuery, cube: Cube, declaredDimensions: string[]): void {
    const probe = this.getObjectFieldNames;
    if (!probe) return;
    /** Every dimension this query names, tagged with the request key it came from. */
    const members: Array<{ member: string; param: 'dimensions' | 'timeDimensions' }> = [
      ...(query.dimensions ?? []).map((member) => ({ member, param: 'dimensions' as const })),
      ...(query.timeDimensions ?? []).map((td) => ({ member: td.dimension, param: 'timeDimensions' as const })),
    ];
    if (members.length === 0) return;

    const object = typeof cube.sql === 'string' ? cube.sql.trim() : '';
    if (!object || !BARE_IDENTIFIER.test(object)) return;
    const fieldNames = probe(object);
    if (!fieldNames || fieldNames.length === 0) return;
    const known = new Set<string>([...fieldNames, 'id', 'created_at', 'updated_at']);

    /**
     * The `cube.dimensions` key a member resolves to (for the suggestion list)
     * and the column it groups by — `source: null` meaning "nothing to check".
     *
     * [#5669] The body moved to the module-level {@link resolveMemberSource},
     * shared with the `where` gate. `'dimension'` keeps this call site's
     * resolution exactly as #5520 wrote it: `cube.dimensions` only, matching
     * `resolveDimensionSql` / `resolveFieldName(…, 'dimension')`.
     */
    const resolve = (member: string): { key: string; source: string | null } =>
      resolveMemberSource(cube, member, 'dimension');

    // Two passes, for the reason the measure gate has two: on the auto-inference
    // path `cube.dimensions` was minted from this very query, so echoing its keys
    // verbatim would offer the caller their own typo back as a valid alternative.
    const invalid = new Set<string>();
    for (const { member } of members) {
      const { key, source } = resolve(member);
      if (source && !known.has(source)) invalid.add(key);
    }
    if (invalid.size === 0) return;
    const usable = declaredDimensions.filter((d) => !invalid.has(d));

    for (const { member, param } of members) {
      const { source } = resolve(member);
      if (!source || known.has(source)) continue;

      const kind = param === 'timeDimensions' ? 'Time dimension' : 'Dimension';
      const verb = param === 'timeDimensions' ? 'buckets' : 'groups by';
      const err = new Error(
        `${kind} '${member}' on cube '${cube.name}' ${verb} field '${source}', which object ` +
          `'${object}' does not have. ` +
          `Valid dimensions: ${usable.join(', ') || '(none)'}. ` +
          `Any of the object's OWN fields may also be used as a dimension without the cube ` +
          `declaring it, so check the spelling of ` +
          `'${source}' — known fields: ${[...fieldNames].sort().join(', ')}.`,
      ) as Error & { code?: string; status?: number; field?: string; object?: string; param?: string; dimension?: string };
      err.code = 'INVALID_FIELD';
      err.status = 400;
      err.field = source;
      err.object = object;
      err.param = param;
      err.dimension = member;
      throw err;
    }
  }

  /**
   * [#5669] Reject a `where` member whose source field the backing object does
   * not have, BEFORE the strategy compiles it into `WHERE`.
   *
   * The third and last param of one defect. #4437 gated `measures`, #5520 gated
   * `dimensions`/`timeDimensions`, and the filter face — the request key that
   * most often carries a hand-typed field name — had no gate at all:
   *
   * ```
   * POST /analytics/query {"cube":"crm_account","measures":["count"],"where":{"bogus_col":"x"}}
   * → SELECT COUNT(*) AS "count" FROM "crm_account" WHERE bogus_col = $1
   * → 500 {"code":"SQLITE_ERROR","message":"Internal server error"}
   * ```
   *
   * Same envelope as its two siblings (`INVALID_FIELD`/400 + `field`/`object`/
   * `param`), because "the query names a field the object does not have" is ONE
   * mistake whichever request key carried it, and the DATA route has answered it
   * that way since #4315/#4254 (`resolveQueryFields`).
   *
   * # Where the field names come from: the SQL producer's own reader
   *
   * The members are collected through `normalizeAnalyticsFilterTree` +
   * `collectFilterLeaves` — the SAME pair both strategies call to build the
   * predicate. This is deliberate and is the whole reason this gate is not a
   * second filter-tree walker: a hand-rolled walk would have to re-derive
   * `$and`/`$or`/`$not` recursion, `$`-prefixed operator keys, `$between`
   * lowering, the nested-relation dot flattening (`{owner: {region: 'NA'}}` →
   * member `owner.region`) and the #5334 array lowering, and every divergence
   * would show up as "the field the gate saw" not being "the column that reached
   * SQL" — in either direction (a phantom rejection, or a hole).
   * `collectFilterLeaves` discards structure, which is exactly right here:
   * whether a predicate sits under an `$or` changes nothing about whether its
   * column exists. (Its doc's warning — never rebuild a predicate from this list
   * — does not apply; this gate builds nothing.)
   *
   * # Three stand-downs at query level, plus the per-member ones
   *
   * - No {@link AnalyticsServiceConfig.getObjectFieldNames}, cube `sql` that is
   *   not a bare object name, or a probe that cannot answer for the object — the
   *   same three tiers as the measure and dimension gates, for the same reasons.
   * - A `where` the normalizer REFUSES (an unknown operator, a non-array
   *   `$and`, an unlowerable filter array) is not judged here: this gate stands
   *   down and lets the refusal happen where it already does. Those inputs
   *   already answer `INVALID_FILTER`/400 from the strategy (#5352/#5367's
   *   geography, not this gate's), and pulling them forward into `ensureCube`
   *   would newly refuse them on the draft-preview path too, whose
   *   `matchesWhere` never consults the normalizer at all. A field gate that
   *   cannot read the tree has nothing to say about it.
   * - Per member, {@link resolveMemberSource} stands down on an expression `sql`
   *   and on a dotted relation traversal — for the dimension gate's reasons.
   *
   * # Array `where` IS gated, and #5353's fix did not change that
   *
   * Since #5334 an array `where` is lowered by `normalizeAnalyticsFilterTree`
   * and compiles to the identical predicate — a measured fact,
   * `where: [['bogus_col','=','x']]` and `where: {bogus_col: 'x'}` both produce
   * `WHERE bogus_col = $1` and hand `executeAggregate` the same
   * `{bogus_col: 'x'}`. Gating one spelling and not the other would answer one
   * mistake two ways, which is the split this whole gate family exists to close.
   *
   * `inferCubeFromQuery` used to skip an array `where` when minting the ad-hoc
   * cube's `dimensions` — a separate question (the cube's dimension VOCABULARY,
   * not which columns reach the driver), fixed by #5353 by lowering before
   * reading keys. Because this gate reads filter LEAVES rather than
   * `cube.dimensions`, that fix could not change its verdicts, and measurement
   * confirms it did not: the array where's keys now reach `cube.dimensions`, so
   * {@link resolveMemberSource} takes the DECLARED-dimension branch for those
   * members instead of the undeclared-bare-column one — and both branches yield
   * the same `source` for the same member, since the minted dimension's `sql` IS
   * the member name. What did change is the rejection's suggestion list, in the
   * direction that closes the split: `Valid filter members:` now reads the same
   * for both spellings of one filter.
   */
  private assertWhereFields(query: AnalyticsQuery, cube: Cube, declaredDimensions: string[]): void {
    const probe = this.getObjectFieldNames;
    if (!probe) return;
    const where = (query as { where?: unknown }).where;
    if (!where || typeof where !== 'object') return;

    const object = typeof cube.sql === 'string' ? cube.sql.trim() : '';
    if (!object || !BARE_IDENTIFIER.test(object)) return;
    const fieldNames = probe(object);
    if (!fieldNames || fieldNames.length === 0) return;
    const known = new Set<string>([...fieldNames, 'id', 'created_at', 'updated_at']);

    /** Every member the compiled predicate will bind against, structure discarded. */
    let members: string[];
    try {
      members = collectFilterLeaves(normalizeAnalyticsFilterTree(query)).map((leaf) => leaf.member);
    } catch {
      // A `where` this layer refuses outright — see the stand-down note above.
      return;
    }
    if (members.length === 0) return;

    // Two passes, for the reason the measure and dimension gates have two: on the
    // auto-inference path `inferCubeFromQuery` mints the `where`'s own field keys
    // into `cube.dimensions` — since #5353 for the array spelling too — so
    // echoing that bag verbatim would offer the caller their own typo back as a
    // valid filter member.
    const invalid = new Set<string>();
    for (const member of members) {
      const { key, source } = resolveMemberSource(cube, member, 'any');
      if (source && !known.has(source)) invalid.add(key);
    }
    if (invalid.size === 0) return;
    const usable = declaredDimensions.filter((d) => !invalid.has(d));

    for (const member of members) {
      const { source } = resolveMemberSource(cube, member, 'any');
      if (!source || known.has(source)) continue;

      const err = new Error(
        `Filter member '${member}' in 'where' on cube '${cube.name}' constrains field ` +
          `'${source}', which object '${object}' does not have. ` +
          `Valid filter members: ${usable.join(', ') || '(none)'}. ` +
          `Any of the object's OWN fields may also be filtered on without the cube ` +
          `declaring it, so check the spelling of ` +
          `'${source}' — known fields: ${[...fieldNames].sort().join(', ')}.`,
      ) as Error & { code?: string; status?: number; field?: string; object?: string; param?: string; member?: string };
      err.code = 'INVALID_FIELD';
      err.status = 400;
      err.field = source;
      err.object = object;
      err.param = 'where';
      err.member = member;
      throw err;
    }
  }

  /**
   * [#3867] Gate on the cube auto-inference path: a name with no registered
   * Cube may only be inferred into one if it is a registered object.
   *
   * Rejects with `status: 404` / `code: 'CUBE_NOT_FOUND'` so the HTTP boundary
   * answers "no such cube" instead of letting the name reach the driver as a
   * table and surfacing whatever the driver says about it. The message names
   * both ways the request could be made valid, because from here the two are
   * genuinely indistinguishable: register a Cube, or register the object.
   *
   * Skips when `isRegisteredObject` was not supplied — see the config field's
   * doc for why that tier is a deliberate stand-down and not a hole.
   */
  private assertInferableCube(name: string): void {
    const isRegisteredObject = this.isRegisteredObject;
    if (!isRegisteredObject) {
      if (!this.warnedNoObjectRegistry) {
        this.warnedNoObjectRegistry = true;
        this.logger.warn(
          '[Analytics] no object-registry hook configured — the cube-inference existence gate ' +
            '(#3867) is INACTIVE for this service; an unregistered cube name reaches the driver ' +
            'as a raw table name.',
        );
      }
      return;
    }
    if (isRegisteredObject(name)) return;
    const err = new Error(
      `Cube '${name}' not found: no cube is registered under that name, and it is not a ` +
        `registered object either (a cube can only be auto-inferred from a registered object). ` +
        `Define a Cube in your stack, or check the object name.`,
    ) as Error & { code?: string; status?: number; cube?: string };
    err.code = 'CUBE_NOT_FOUND';
    err.status = 404;
    err.cube = name;
    throw err;
  }

  /** Build a minimal Cube from the fields referenced by an AnalyticsQuery. */
  private inferCubeFromQuery(query: AnalyticsQuery): Cube {
    const cubeName = query.cube!;
    const measures: Record<string, any> = {};
    const dimensions: Record<string, any> = {};

    // [#5739] Strip the `<cube>.` QUALIFIER, and nothing else.
    //
    // The predecessor (`stripPrefix`) dropped the first segment of ANY dotted
    // member, which conflated two different facts wearing the same punctuation:
    //
    //   `deal.stage`   — the canonical analytics QUALIFIER. `getMeta` hands
    //                    members out cube-prefixed and callers echo them back,
    //                    so the prefix is noise and stripping it is right.
    //   `owner.region` — a relation TRAVERSAL. Stripping it minted
    //                    `dimensions.region = {sql: 'region'}`, a BASE-TABLE
    //                    column, and `lookupMember`'s "plain second-segment"
    //                    tier then found it BEFORE its synthetic-traversal tier
    //                    could hand the dotted path to the JOIN machinery. Where
    //                    the base table happened to carry a same-named column
    //                    that filtered/grouped the WRONG column with no error to
    //                    read; where it did not, the 400 named `region` for a
    //                    caller who wrote `owner.region`.
    //
    // Only the first is a qualifier, and only the first is stripped. Everything
    // else is minted VERBATIM (`{sql: 'owner.region'}`), which is precisely what
    // `lookupMember`'s synthetic tier already hands the strategies for an
    // undeclared dotted member — so the ad-hoc path now compiles the traversal
    // the array `where` spelling has compiled all along, and the two spellings
    // converge instead of disagreeing. Maintainer ruling, 2026-08-06 (#5739).
    //
    // Scope: this governs the DIMENSION-shaped mints (`dimensions`, the
    // `where`'s field keys, `timeDimensions`), which SERVE a traversal. The
    // measure mint applies the same qualifier rule but ends the other way —
    // `mintableMeasureKey` refuses a non-qualifier dot outright, because the
    // measure side has no traversal to serve (#5918, and the loop below).
    const stripCubeQualifier = (m: string): string => {
      const dot = m.indexOf('.');
      if (dot < 0) return m;
      return m.slice(0, dot) === cubeName ? m.slice(dot + 1) : m;
    };

    // Always provide a default `count` measure
    measures.count = { name: 'count', label: 'Count', type: 'count', sql: '*' };

    for (const m of query.measures || []) {
      // [#5918] MEASURES no longer take the blanket strip #5739 left them with.
      // That strip cast `owner.region_count_distinct` onto the BASE `region`
      // column — silently where the object had one, and as a #4437 400 naming
      // the stripped tail where it did not. Neither is the caller's query.
      //
      // The ruling here is NOT #5739's (mint the traversal verbatim): measures
      // have no traversal tier to converge on, so there is nothing correct to
      // converge to. It is a loud refusal instead — see `mintableMeasureKey`,
      // which owns the rule and the envelope, and which the augmentation mint in
      // `ensureCube` shares so the same spelling gets the same answer on a warm
      // registry. Maintainer ruling, 2026-08-07 (#5918).
      const key = mintableMeasureKey(m, cubeName);
      if (measures[key]) continue;
      const inferred = inferMeasure(key);
      measures[key] = inferred;
    }

    for (const d of query.dimensions || []) {
      const key = stripCubeQualifier(d);
      if (dimensions[key]) continue;
      dimensions[key] = { name: key, label: key, type: 'string', sql: key };
    }

    // The `where`'s field keys seed dimensions too. LOWER FIRST, then read keys:
    // the rule this bag has always followed is "the `where`'s own top-level keys
    // are field names", and the only reason an ARRAY `where` was skipped here is
    // that it was not a filter when the code was written.
    //
    // [#5353] The `!Array.isArray(query.where)` guard this replaces predates
    // #5334. Since #5334 an array `where` IS a filter — lowered by
    // `lowerAnalyticsWhere` and compiling to a byte-identical predicate — so
    // skipping it meant ONE filter, spelled two ways, minted two different
    // cubes: `{stage: 'won'}` seeded `dimensions.stage`, `[['stage','=','won']]`
    // seeded nothing. Lowering first makes the spelling stop mattering, which is
    // the same fix #5334 applied one layer down.
    let lowered: Record<string, unknown> | null = null;
    try {
      lowered = lowerAnalyticsWhere(query);
    } catch {
      // A `where` the lowering REFUSES (an unlowerable array) is not judged
      // here — the same stand-down `assertWhereFields` makes, for the same
      // reason: that refusal already happens in the strategy with an
      // `INVALID_FILTER`/400 envelope (#5352/#5367), and raising it from
      // `ensureCube` instead would move the answer's geography and would newly
      // refuse the draft-preview path, whose `matchesWhere` never consults the
      // normalizer at all. A cube minted without those keys is exactly what a
      // query that is about to be refused needs.
    }
    if (lowered) {
      // `conjunctFieldKeys` descends `$and` — which the LOWERING introduces for a
      // flat array (`[[a,…],[b,…]]` → `{$and: [{a…},{b…}]}`) — and not `$or` /
      // `$not`, which contribute no key on either spelling. Deliberately NOT
      // `collectFilterLeaves`: the leaves answer "what does the compiled
      // predicate BIND", this bag answers "what may a caller NAME", and the two
      // genuinely differ — `{stage: {$in: []}}` lowers to the boolean constant
      // FALSE, binding nothing while still naming `stage`.
      for (const key of conjunctFieldKeys(lowered)) {
        // [#5739] Dotted keys ride this loop too, and that is the FOLD #5353 left
        // for this issue. Until the ruling, a dotted key was skipped here and
        // re-minted from the RAW object `where` by a separate residue loop —
        // stripped to its tail, so one filter got one answer per spelling: the
        // object spelling mis-cast `owner.region` to base `region`, the array
        // spelling minted nothing and compiled the traversal. One loop over the
        // LOWERED condition mints both spellings identically, and
        // `stripCubeQualifier` keeps them a traversal instead of a base column,
        // so the cube AND the compiled SQL now match on either spelling.
        const minted = stripCubeQualifier(key);
        if (dimensions[minted] || measures[minted]) continue;
        dimensions[minted] = { name: minted, label: minted, type: 'string', sql: minted };
      }
    }

    for (const td of query.timeDimensions || []) {
      const key = stripCubeQualifier(td.dimension);
      if (dimensions[key]) continue;
      dimensions[key] = {
        name: key, label: key, type: 'time', sql: key,
        granularities: ['day', 'week', 'month', 'quarter', 'year'],
      };
    }

    return {
      name: cubeName,
      title: cubeName,
      sql: cubeName,
      measures,
      dimensions,
      public: false,
    };
  }

  /**
   * Walk the strategy chain and return the first strategy that can handle the
   * query. `skip` excludes strategies that already proved incapable at
   * execution time (see {@link query}'s RAW_SQL_UNSUPPORTED fallback).
   */
  private resolveStrategy(
    query: AnalyticsQuery,
    ctx: StrategyContext,
    skip?: Set<AnalyticsStrategy>,
  ): AnalyticsStrategy {
    for (const strategy of this.strategies) {
      if (skip?.has(strategy)) continue;
      if (strategy.canHandle(query, ctx)) {
        return strategy;
      }
    }
    throw new Error(
      `[Analytics] No strategy can handle query for cube "${query.cube}". ` +
      `Checked: ${this.strategies.map(s => s.name).join(', ')}${skip?.size ? ` (skipped at runtime: ${[...skip].map((s) => s.name).join(', ')})` : ''}. ` +
      'Ensure a compatible driver is configured or a fallback service is registered.',
    );
  }
}

/**
 * [#5918] The `cube.measures` KEY a request's `measures` entry may be MINTED
 * under — or a loud refusal when the entry is a dotted member.
 *
 * Two mint sites feed {@link inferMeasure}, and both go through here: the
 * ad-hoc mint in {@link AnalyticsService.inferCubeFromQuery} (no cube
 * registered) and the suffix-augmentation loop in
 * {@link AnalyticsService.ensureCube} (a cube exists but does not declare the
 * measure). They are the same act — inventing a Metric out of a request
 * spelling — so they must judge the spelling the same way.
 *
 * ## What is refused, and why it is a refusal rather than a traversal
 *
 * A `<cube>.` QUALIFIER is stripped, exactly as `inferCubeFromQuery`'s
 * `stripCubeQualifier` does for the dimension-shaped mints (#5739): `getMeta`
 * hands members out cube-prefixed and
 * callers echo them back, so that prefix is noise. **Every other dot is
 * refused.** The predecessor dropped the first segment of ANY dotted member,
 * which meant `owner.region_count_distinct` minted
 * `measures.region_count_distinct = {type:'count_distinct', sql:'region'}` — the
 * BASE table's own `region` column — and then:
 *
 * ```
 * NativeSQL → SELECT COUNT(DISTINCT region) AS "owner.region_count_distinct" FROM "crm_account"
 * ObjectQL  → aggregations: [{field:'region', method:'count_distinct', alias:'owner.region_count_distinct'}]
 * ```
 *
 * No JOIN, no error, and a response column LABELLED with a relation attribute
 * whose number came from the base table — a wrong answer the caller cannot see
 * (measured on `origin/main` `01faeb13a`). Where the base object had no
 * same-named column it degraded instead to #4437's `400 INVALID_FIELD` naming
 * the STRIPPED tail (`Measure 'owner.score_sum' … aggregates field 'score'`) —
 * honest about what reached SQL, but naming a string the caller never wrote.
 *
 * #5739 fixed the same punctuation on the three DIMENSION-shaped mints by
 * minting the traversal verbatim, and that ruling deliberately does NOT carry
 * over here: `lookupMember`'s synthetic relation-traversal tier is
 * dimension-only (`if (kind === 'dimension')`), so a dotted measure has no
 * correct traversal answer to converge on. Minting it verbatim would only
 * re-route it into ObjectQL's `cannot evaluate a cross-object measure` — which
 * would be the wrong diagnosis for a plain typo like `total.sum`. Maintainer
 * ruling, 2026-08-07 (#5918, option 3): refuse the dotted measure LOUDLY, with
 * the caller's own spelling in the envelope. A genuine traversal measure
 * (`SUM("owner"."amount")` + LEFT JOIN) would be a capability with its own
 * justification, not a side effect of a strip.
 *
 * The refusal deliberately reaches BOTH the typo (`total.sum`) and the genuine
 * traversal intent (`owner.amount_sum`): the two are lexically indistinguishable
 * on this path, and telling them apart would need field metadata the ad-hoc
 * path does not have (`getObjectFieldNames` answers names, not types or
 * relation targets). One honest 400 for both beats a metadata capability nobody
 * has asked for.
 *
 * A measure the cube DECLARES under a dotted key is not this function's
 * business — it was authored, not minted, and `lookupMember` resolves it by
 * direct hit. Both call sites check that first.
 */
function mintableMeasureKey(member: string, cubeName: string): string {
  const dot = member.indexOf('.');
  if (dot < 0) return member;
  if (member.slice(0, dot) === cubeName) return member.slice(dot + 1);

  throw invalidMemberError(
    `[Analytics] Measure '${member}' on cube '${cubeName}' is a DOTTED member, and ` +
      `measures do not traverse relationships — only dimensions do — so there is no ` +
      `related column for this to aggregate. Until #5918 the prefix was silently ` +
      `dropped, so the aggregate ran against '${cubeName}' itself while the result ` +
      `column kept the label '${member}'. Aggregate one of the object's OWN fields ` +
      `instead ('<field>_sum' / '_avg' / '_min' / '_max' / '_count_distinct'), or ` +
      `declare a Cube whose measure names the related column in its own 'sql'. The ` +
      `only dot a measure may carry is the '${cubeName}.' qualifier.`,
    { member, param: 'measures', cube: cubeName },
  );
}

/**
 * Infer a Metric definition from a measure key name.
 *
 * Recognised suffix conventions (matches dashboard widget translators that
 * emit measures like `<field>_sum`, `<field>_avg`):
 *
 * | Suffix             | Aggregation     |
 * |:-------------------|:----------------|
 * | `count`            | `count(*)`      |
 * | `_sum`             | `sum(field)`    |
 * | `_avg` / `_average`| `avg(field)`   |
 * | `_min`             | `min(field)`    |
 * | `_max`             | `max(field)`    |
 * | `_count_distinct`  | `count(distinct field)` |
 *
 * Anything else is treated as a `sum(<key>)` — best-effort default for an
 * unknown numeric measure.
 */
export function inferMeasure(key: string): { name: string; label: string; type: 'count' | 'sum' | 'avg' | 'min' | 'max' | 'count_distinct'; sql: string } {
  if (key === 'count') {
    return { name: 'count', label: 'Count', type: 'count', sql: '*' };
  }
  const suffixes: Array<[string, 'sum' | 'avg' | 'min' | 'max' | 'count_distinct']> = [
    ['_count_distinct', 'count_distinct'],
    ['_sum', 'sum'],
    ['_avg', 'avg'],
    ['_average', 'avg'],
    ['_min', 'min'],
    ['_max', 'max'],
  ];
  for (const [suffix, type] of suffixes) {
    if (key.endsWith(suffix)) {
      const field = key.slice(0, -suffix.length) || '*';
      return { name: key, label: key, type, sql: field };
    }
  }
  return { name: key, label: key, type: 'sum', sql: key };
}

/**
 * FallbackDelegateStrategy — Internal strategy for fallback service delegation.
 *
 * Automatically added to the strategy chain when `fallbackService` is configured.
 * Not exported — consumers who need explicit in-memory support should use
 * `InMemoryStrategy` from `@objectstack/driver-memory`.
 */
class FallbackDelegateStrategy implements AnalyticsStrategy {
  readonly name = 'FallbackDelegateStrategy';
  readonly priority = 30;

  canHandle(query: AnalyticsQuery, ctx: StrategyContext): boolean {
    if (!query.cube) return false;
    return !!ctx.fallbackService;
  }

  async execute(query: AnalyticsQuery, ctx: StrategyContext): Promise<AnalyticsResult> {
    return ctx.fallbackService!.query(query);
  }

  async generateSql(query: AnalyticsQuery, ctx: StrategyContext): Promise<{ sql: string; params: unknown[] }> {
    if (ctx.fallbackService?.generateSql) {
      return ctx.fallbackService.generateSql(query);
    }
    return {
      sql: `-- FallbackDelegateStrategy: SQL generation not supported for cube "${query.cube}"`,
      params: [],
    };
  }
}
