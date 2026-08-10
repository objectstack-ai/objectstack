// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { IAnalyticsService, AnalyticsResult, CubeMeta } from '@objectstack/spec/contracts';
import type { Cube, AnalyticsQuery } from '@objectstack/spec/data';
// [#6520] `$icontains`' ASCII-only fold, from the spec's one definition.
import { asciiCaseInsensitiveRegexSource } from '@objectstack/spec/data';
import type { InMemoryDriver } from './memory-driver.js';
import { Logger, createLogger, nextUtcCalendarDay } from '@objectstack/core';
import {
  assertFilterConditionShape,
  uncompilableCombinatorError,
  uncompilableFieldOperatorError,
  type FilterFaceCapabilities,
} from './filter-refusal.js';

/**
 * [#5345] The Filter Protocol operators this face can LOWER into a cube-style
 * `{member, operator, values}` entry — and, because
 * {@link ANALYTICS_FILTER_CAPABILITIES} is derived from its keys, the complete
 * statement of what the face accepts.
 *
 * That derivation is the point. This table used to be a `switch` with
 * `default: return null`, and the caller answered `null` with `continue` — so
 * the vocabulary was declared nowhere and enforced nowhere, and the five
 * declared operators missing from it (`$between`, `$startsWith`, `$endsWith`,
 * `$null`, `$regex`) vanished out of any `where` that carried them. Keeping the
 * gate's vocabulary and the compiler's table as one object makes adding a row
 * here the only way to widen what this face accepts, and makes forgetting to
 * add one a loud refusal rather than a wrong number.
 *
 * A row here used to mean only that the face ATTEMPTS the operator, not that the
 * predicate it builds is correct. Both halves of that caveat are now closed:
 * #5373 removed the `string[]` comparand round-trip that lost booleans and
 * `null` (see {@link NormalizedCubeFilter}), and #5374 replaced the
 * operator-name→operator-name mapping — under which `notContains` compiled to a
 * bare mingo `{$not: 'x'}` that constrains nothing — with
 * {@link CUBE_OPERATOR_TO_MONGO_PREDICATE}, which builds the whole predicate.
 *
 * The literal `as const` is load-bearing, not style: it makes
 * {@link CubeOperator} the exact union of this table's values, and that union is
 * the key type of the predicate table. Adding a row here without teaching the
 * compiler how to build its predicate is therefore a TYPE ERROR rather than a
 * wrong number — which is the whole point of #5345 keeping the gate's vocabulary
 * and the compiler's table as one statement.
 */
const MONGO_TO_CUBE_OPERATOR = Object.freeze({
  $eq: 'equals',
  $ne: 'notEquals',
  $gt: 'gt',
  $gte: 'gte',
  $lt: 'lt',
  $lte: 'lte',
  $in: 'in',
  $nin: 'notIn',
  $contains: 'contains',
  $notContains: 'notContains',
  // [#6520] This face lowers `$icontains` too, so the analytics/cube surface
  // answers it like the driver's other two. Leaving it out would have been a
  // LOUD refusal (`uncompilableFieldOperatorError` — "declared, but this face
  // cannot compile it"), not a silent drop; it is added because the cube
  // pipeline can express it, and one driver answering one operator two ways by
  // entry point is the divergence class #5374 closed for `$contains`.
  $icontains: 'icontains',
  $exists: 'set',
} as const);

/**
 * [#5374] The cube-style operator names this face lowers into — exactly the
 * values of {@link MONGO_TO_CUBE_OPERATOR}, derived rather than restated so the
 * two cannot drift.
 */
type CubeOperator = (typeof MONGO_TO_CUBE_OPERATOR)[keyof typeof MONGO_TO_CUBE_OPERATOR];

/**
 * [#5345] What the analytics (cube) face compiles, for the shared filter walk.
 *
 * `$and` is the one combinator: {@link MemoryAnalyticsService.flattenFilterCondition}
 * folds its branches into the same implicit-AND list the top level already is.
 * `$or` and `$not` have no expression in a flat `{member, operator, values}`
 * pipeline at all — which is why they were being skipped, and why refusing is
 * the answer here rather than a lowering nobody can write.
 */
export const ANALYTICS_FILTER_CAPABILITIES: FilterFaceCapabilities = Object.freeze({
  face: "driver-memory's analytics (cube) face",
  fieldOperators: new Set<string>(Object.keys(MONGO_TO_CUBE_OPERATOR)),
  combinators: new Set<string>(['$and']),
});

/**
 * [#5373] One lowered constraint: the private intermediate between
 * {@link MemoryAnalyticsService.normalizeFilters} and the two exits that consume
 * it (`query()` → a mingo `$match`, `generateSql()` → a SQL literal).
 *
 * # Why `values` is `unknown[]` and not `string[]`
 *
 * It was `string[]`, because the cube WIRE format serialises filter values as
 * strings. So every comparand made a JS value → string → JS value round trip,
 * and that round trip is lossy for everything that is not already a string:
 *
 * | authored | stringified | recovered | compared against | result |
 * |---|---|---|---|---|
 * | `true` | `'1'` | `1` (the `/^-?\d+$/` arm wins) | stored `true` | **0 rows** |
 * | `null` | `''` | `''` | stored `null` | `$ne` matched everything |
 * | `'100'` (text column) | `'100'` | `100` | stored `'100'` | **0 rows** |
 *
 * mingo compares across JS types the way MongoDB compares across BSON types —
 * never equal — so each of those is a wrong row set rather than an error. The
 * encoding's own justification (booleans as `'1'`/`'0'`, "so downstream
 * consumers expecting SQLite-style numeric booleans match correctly") was true
 * for the SQL-generating exit and false for the in-memory one, and both exits
 * shared the one encoding. There is no string form that is correct for both.
 *
 * So the round trip is gone rather than made lossless: the value stays whatever
 * the author wrote, and each exit converts at ITS boundary, where it knows what
 * it needs — `toSqlLiteral` in `generateSql()`, nothing at all in `query()`.
 *
 * This is an INTERNAL representation, which is what makes that affordable.
 * `AnalyticsQuery.where` is a `FilterCondition` and nothing else (#5375 removed
 * the leg that also accepted a cube-style array as input), and the API layer
 * actively REJECTS a `{member, operator, values}` array on the wire — so no
 * caller, no spec schema and no serialized form observes this triple's shape.
 */
interface NormalizedCubeFilter {
  member: string;
  operator: CubeOperator;
  /**
   * The comparands, as authored. Temporal values are put into the field's
   * storage form at the exits ({@link MemoryAnalyticsService.comparandsFor}),
   * never here — that rule needs the resolved field path, which only an exit has.
   */
  values: unknown[];
}

/**
 * [#5374] What one lowered entry gives its predicate builder.
 *
 * Two comparand lists, not one, because the driver's own translation makes the
 * same split and for the same reason (#4047, `normalizeFieldOperators`): a
 * VALUE COMPARISON must be put into the field's storage form or mingo's
 * cross-type comparison drops every row, while an operand that is not a
 * comparand — a `$exists` flag, a `$regex` pattern — must NOT be, because
 * "storage form" is meaningless for it and applying it corrupts the operand.
 *
 * That was not hypothetical here. This face ran every operand through the
 * comparand conversion, so on a declared `datetime` column
 * `{made_at: {$contains: '2026-01-01T00:00:00Z'}}` had its PATTERN rewritten to
 * canonical `'2026-01-01T00:00:00.000Z'` and then matched the row, where
 * `find()` — which never rewrites a pattern — matched nothing.
 */
interface MongoPredicateInput {
  /** Comparands in the field's storage form (#4047). For value comparisons. */
  readonly comparands: readonly unknown[];
  /** The operands as authored. For operands that are not comparands. */
  readonly raw: readonly unknown[];
  /**
   * A comparand as a case-insensitive literal-substring pattern, built by the
   * DRIVER's own rule (`filterSubstringPattern`) rather than re-derived here.
   */
  readonly substring: (value: unknown) => RegExp;
  /**
   * [#6520] A comparand as an ASCII-case-insensitive literal-substring pattern —
   * `$icontains`' fold, which is NOT {@link substring}'s.
   *
   * The two are deliberately separate functions rather than one with a flag.
   * `substring` folds the whole Unicode range (the driver's `i` flag), which is
   * the open defect #6682 tracks for the `$contains` family on this face; this
   * one folds `A-Z` only, which is what the protocol says `$icontains` means
   * (#4706 Q1 = A). Collapsing them would silently give one of the two operators
   * the other's answer.
   */
  readonly asciiSubstring: (value: unknown) => RegExp;
}

type MongoPredicateBuilder = (input: MongoPredicateInput) => Record<string, unknown>;

/**
 * [#5374] How each cube operator becomes a mingo field predicate — the whole
 * `{$op: …}` object, not the name of an operator.
 *
 * # Why the shape changed
 *
 * This was `convertOperatorToMongo(operator): string`, a name→name map, and the
 * call site filled the name in as `matchStage[field] = {[name]: comparand}`.
 * That shape can express "compare this field to this value" and NOTHING else,
 * so the two entries that need to WRAP their comparand were forced through it
 * anyway:
 *
 *   - `notContains` → `'$not'` became `{name: {$not: 'et'}}`. mingo's `$not`
 *     takes a regex or an operator expression; given a bare scalar it
 *     constrains nothing, so the predicate was emitted, looked present in the
 *     pipeline, and passed the whole table (#5374: 3 rows where `find()`
 *     returns 2). A predicate that is emitted and inert is indistinguishable
 *     from a correct one at the author's end, and widens in the #3948
 *     direction.
 *   - `contains` → `'$regex'` became `{name: {$regex: 'a.p'}}` — the right
 *     operator, but the comparand went in raw, so it was neither escaped nor
 *     case-folded and meant something other than what `find()` means by it.
 *
 * A builder can say `{$not: {$regex: …}}`, so the class of "this operator needs
 * a structure and the table can only hold a name" is gone rather than this one
 * instance of it. `$in`/`$nin`/`$lte`/`$exists`, which the call site had grown
 * an `if` chain for, are ordinary rows here for the same reason.
 *
 * # Why it is a `Record<CubeOperator, …>`
 *
 * Because the missing-entry case had a `|| '$eq'` fallback, and a misspelled or
 * unmapped operator silently became an EQUALITY comparison — the exact
 * silent-wrong-answer shape #5345, #5373 and this issue have each been closing.
 * After #5345 that fallback was unreachable (`mongoOperatorToCubeOperator`
 * refuses anything not in {@link MONGO_TO_CUBE_OPERATOR}, and both exits consume
 * only `normalizeFilters` output), but only until someone widened the vocabulary
 * — which #5345 deliberately made a ONE-LINE edit to that table. Keying this
 * table by {@link CubeOperator} makes that edit fail to compile until the
 * predicate exists, so the fallback is not merely unreachable, it is
 * unnecessary: the totality is proven, not defended.
 *
 * Two entries were deleted rather than kept. `'notSet': '$exists'` and
 * `'inDateRange': '$gte'` were both unreachable (nothing lowers to either name)
 * and both wrong if they ever had been: the first inverts — the call site would
 * have compiled `notSet` to `{$exists: true}` — and the second answers a
 * two-ended range with a one-ended `>=`, which its own comment conceded ("Will
 * need special handling") and which nothing implemented. Dead code that is
 * ALSO wrong is a trap primed for whoever widens the vocabulary next; the type
 * error they now get instead says so at the only moment it helps.
 */
const CUBE_OPERATOR_TO_MONGO_PREDICATE: Readonly<Record<CubeOperator, MongoPredicateBuilder>> = Object.freeze({
  equals: ({ comparands }) => ({ $eq: comparands[0] }),
  notEquals: ({ comparands }) => ({ $ne: comparands[0] }),
  gt: ({ comparands }) => ({ $gt: comparands[0] }),
  gte: ({ comparands }) => ({ $gte: comparands[0] }),
  lt: ({ comparands }) => ({ $lt: comparands[0] }),
  // A bare-day `lte` bound means "through that whole day" (#4042; the SQL twin
  // is #3777): compile half-open so timestamp values on the final day stay in.
  // Order-equivalent to `$lte` for plain `YYYY-MM-DD` values.
  lte: ({ comparands }) => {
    const nextDay = nextUtcCalendarDay(comparands[0]);
    return nextDay != null ? { $lt: nextDay } : { $lte: comparands[0] };
  },
  // The list operators take the WHOLE list. An empty one is a real predicate —
  // `$in: []` selects nothing, `$nin: []` selects everything — and saying so
  // here is what retires the call site's `values.length > 0` guard, under which
  // `{code: {$in: []}}` emitted no predicate at all and answered with the whole
  // table while `find()` answered with none of it.
  in: ({ comparands }) => ({ $in: [...comparands] }),
  notIn: ({ comparands }) => ({ $nin: [...comparands] }),
  // A pattern, not a comparand: `raw`, and the driver's own substring rule.
  contains: ({ raw, substring }) => ({ $regex: substring(raw[0]) }),
  // [#6520] The case-INSENSITIVE twin, folding ASCII and nothing else. It takes
  // `asciiSubstring`, not `substring`: the neighbour above folds Unicode, so
  // reusing it here would answer `CAFÉ` for `café` on this face while the SQL
  // family answered no rows — the divergence #6520 closed.
  icontains: ({ raw, asciiSubstring }) => ({ $regex: asciiSubstring(raw[0]) }),
  // The fix this issue is about. `{$not: <scalar>}` constrains nothing; the
  // negation has to wrap a pattern, which is exactly what the live query path
  // builds for `$notContains` (`memory-driver.ts` `normalizeFieldOperators`).
  notContains: ({ raw, substring }) => ({ $not: { $regex: substring(raw[0]) } }),
  // A presence flag, not a comparand. The `raw.length === 0` arm keeps the old
  // call site's reading of a valueless `set` ("does it exist" → true).
  set: ({ raw }) => ({ $exists: raw.length > 0 ? Boolean(raw[0]) : true }),
});

/**
 * Configuration for MemoryAnalyticsService
 */
export interface MemoryAnalyticsConfig {
  /** The data driver instance to use for queries */
  driver: InMemoryDriver;
  /** Cube definitions for the semantic layer */
  cubes: Cube[];
  /** Optional logger */
  logger?: Logger;
}

/**
 * Memory-Based Analytics Service
 * 
 * Implements IAnalyticsService using InMemoryDriver's aggregation capabilities.
 * Provides a semantic layer (Cubes, Metrics, Dimensions) on top of in-memory data.
 * 
 * Features:
 * - Cube-based semantic modeling
 * - Measure calculations (count, sum, avg, min, max, count_distinct)
 * - Dimension grouping
 * - Filter support
 * - Time dimension handling
 * - SQL generation (for debugging/transparency)
 * 
 * This implementation is suitable for:
 * - Development and testing
 * - Local-first analytics
 * - Small to medium datasets
 * - Prototyping BI applications
 */
export class MemoryAnalyticsService implements IAnalyticsService {
  private driver: InMemoryDriver;
  private cubes: Map<string, Cube>;
  private logger: Logger;

  constructor(config: MemoryAnalyticsConfig) {
    this.driver = config.driver;
    this.cubes = new Map(config.cubes.map(c => [c.name, c]));
    this.logger = config.logger || createLogger({ level: 'info', format: 'pretty' });
    this.logger.debug('MemoryAnalyticsService initialized', { cubeCount: this.cubes.size });
  }

  /**
   * Execute an analytical query using the memory driver's aggregation pipeline
   */
  async query(query: AnalyticsQuery): Promise<AnalyticsResult> {
    this.logger.debug('Executing analytics query', { cube: query.cube, measures: query.measures });

    // Get cube definition
    if (!query.cube) {
      throw new Error('Cube name is required');
    }
    const cube = this.cubes.get(query.cube);
    if (!cube) {
      throw new Error(`Cube not found: ${query.cube}`);
    }

    // Build MongoDB aggregation pipeline
    const pipeline: Record<string, any>[] = [];

    // Stage 1: $match for filters
    // `AnalyticsQuery.where` is a FilterCondition (MongoDB-style — the canonical
    // spec shape, used by dashboard widget metadata directly). It is lowered
    // into the cube-style `{member, operator, values}` list this pipeline
    // consumes, and anything this face cannot lower is refused there rather than
    // dropped (#5345).
    const normalizedFilters = this.normalizeFilters(query);
    if (normalizedFilters.length > 0) {
      const matchStage: Record<string, any> = {};
      for (const filter of normalizedFilters) {
        const fieldPath = this.resolveFieldPath(cube, filter.member);
        // [#5374] The operator decides the WHOLE predicate, not just its name —
        // so `notContains` can say `{$not: {$regex: …}}` instead of being forced
        // into `{$not: <comparand>}`, which mingo reads as no constraint at all.
        //
        // [#5373] `comparands` are the values as authored, in the storage form
        // of the field they are compared against. There is no type recovery step
        // any more, because there is no longer a stringification to recover
        // FROM: a boolean reaches mingo as a boolean and `null` as `null`, so a
        // predicate over `is_active` or `closed_at` selects the same rows
        // `find()` selects instead of none / all of them.
        matchStage[fieldPath] = this.mongoPredicateBuilder(filter.operator)({
          comparands: this.comparandsFor(cube, filter.member, filter.values),
          raw: filter.values,
          substring: (value) => this.driver.filterSubstringPattern(value),
          // [#6520] `$icontains`' fold, from the spec's shared definition rather
          // than from the driver's Unicode-folding `filterSubstringPattern`.
          asciiSubstring: (value) => new RegExp(asciiCaseInsensitiveRegexSource(String(value))),
        });
      }
      if (Object.keys(matchStage).length > 0) {
        pipeline.push({ $match: matchStage });
      }
    }

    // Stage 2: Time dimension filters
    if (query.timeDimensions && query.timeDimensions.length > 0) {
      for (const timeDim of query.timeDimensions) {
        const fieldPath = this.resolveFieldPath(cube, timeDim.dimension);
        if (timeDim.dateRange) {
          const range = Array.isArray(timeDim.dateRange)
            ? timeDim.dateRange
            : this.parseDateRangeString(timeDim.dateRange);

          if (range.length === 2) {
            // The window matches BOTH stored forms of a datetime value — the
            // in-memory table holds whatever the writer produced: `Date`
            // objects from direct JS callers AND ISO strings (the driver's own
            // `created_at` default, every REST/JSON write). Mingo compares
            // cross-type as never-equal, so a single-form bound silently
            // empties the other half — the same disease driver-sql's
            // mixed-storage CASE repair cures, expressed as the `$or` a
            // schemaless store allows.
            //
            // Both spellings are half-open on a bare-day end (#4042; the SQL
            // twin is #3777): a `$lte`-at-midnight upper bound dropped the
            // final day's rows for `Date` values and the string spelling
            // inherits `<= day`'s whole-day intent via `< nextDay`.
            const start = String(range[0]);
            const end = String(range[1]);
            const nextDay = nextUtcCalendarDay(end);
            const stringBounds = nextDay != null
              ? { $gte: start, $lt: nextDay }
              : { $gte: start, $lte: end };
            const dateBounds = nextDay != null
              ? { $gte: new Date(start), $lt: new Date(`${nextDay}T00:00:00.000Z`) }
              : { $gte: new Date(start), $lte: new Date(end) };
            pipeline.push({
              $match: {
                $or: [
                  { [fieldPath]: stringBounds },
                  { [fieldPath]: dateBounds },
                ],
              }
            });
          }
        }
      }
    }

    // Stage 3: $group for measures and dimensions
    const groupStage: Record<string, any> = { _id: {} };
    
    // Add dimensions to _id
    if (query.dimensions && query.dimensions.length > 0) {
      for (const dim of query.dimensions) {
        const fieldPath = this.resolveFieldPath(cube, dim);
        const dimName = this.getShortName(dim);
        groupStage._id[dimName] = `$${fieldPath}`;
      }
    } else {
      groupStage._id = null; // No grouping, aggregate all
    }

    // Add measures as computed fields
    if (query.measures && query.measures.length > 0) {
      for (const measure of query.measures) {
        const measureDef = this.resolveMeasure(cube, measure);
        const measureName = this.getShortName(measure);
        
        if (measureDef) {
          const aggregator = this.buildAggregator(measureDef);
          groupStage[measureName] = aggregator;
        }
      }
    }

    pipeline.push({ $group: groupStage });

    // Stage 4: $project to reshape results (use short names, we'll fix them later)
    const projectStage: Record<string, any> = { _id: 0 };
    if (query.dimensions && query.dimensions.length > 0) {
      for (const dim of query.dimensions) {
        const dimName = this.getShortName(dim);
        projectStage[dimName] = `$_id.${dimName}`;
      }
    }
    if (query.measures && query.measures.length > 0) {
      for (const measure of query.measures) {
        const measureName = this.getShortName(measure);
        projectStage[measureName] = `$${measureName}`;
      }
    }
    pipeline.push({ $project: projectStage });

    // Stage 5: $sort (use short names)
    if (query.order && Object.keys(query.order).length > 0) {
      const sortStage: Record<string, any> = {};
      for (const [field, direction] of Object.entries(query.order)) {
        const shortName = this.getShortName(field);
        sortStage[shortName] = direction === 'asc' ? 1 : -1;
      }
      pipeline.push({ $sort: sortStage });
    }

    // Stage 6: $limit and $skip
    //
    // PRESENCE on the limit, not truthiness (#6577) — the same defect and the
    // same reason as `memory-driver.ts`'s slice: `limit: 0` means "return no
    // records" (#6485), `0` is falsy, so the stage was omitted entirely and an
    // analytics read that asked for none came back with every row. Mingo
    // honours `{ $limit: 0 }` as zero records (measured: 3 in, 0 out), so
    // pushing the stage is sufficient here — no short-circuit needed, unlike
    // the MongoDB driver, whose upstream client defines `0` as "no limit".
    if (query.offset) {
      pipeline.push({ $skip: query.offset });
    }
    if (query.limit !== undefined) {
      pipeline.push({ $limit: query.limit });
    }

    // Execute the aggregation pipeline
    const tableName = this.extractTableName(cube.sql);
    const rawRows = await this.driver.aggregate(tableName, pipeline);

    // Rename fields from short names to full cube.field names
    const rows = rawRows.map(row => {
      const renamedRow: Record<string, unknown> = {};
      
      // Rename dimensions
      if (query.dimensions) {
        for (const dim of query.dimensions) {
          const shortName = this.getShortName(dim);
          if (shortName in row) {
            renamedRow[dim] = row[shortName];
          }
        }
      }
      
      // Rename measures
      if (query.measures) {
        for (const measure of query.measures) {
          const shortName = this.getShortName(measure);
          if (shortName in row) {
            renamedRow[measure] = row[shortName];
          }
        }
      }
      
      return renamedRow;
    });

    // Build field metadata
    const fields: Array<{ name: string; type: string }> = [];
    
    if (query.dimensions) {
      for (const dim of query.dimensions) {
        const dimension = this.resolveDimension(cube, dim);
        fields.push({
          name: dim,
          type: dimension?.type || 'string'
        });
      }
    }
    
    if (query.measures) {
      for (const measure of query.measures) {
        const measureDef = this.resolveMeasure(cube, measure);
        fields.push({
          name: measure,
          type: this.measureTypeToFieldType(measureDef?.type || 'count')
        });
      }
    }

    this.logger.debug('Analytics query completed', { rowCount: rows.length });

    return {
      rows,
      fields,
      sql: this.generateSqlFromPipeline(tableName, pipeline) // For debugging
    };
  }

  /**
   * Get available cube metadata for discovery
   */
  async getMeta(cubeName?: string): Promise<CubeMeta[]> {
    const cubes = cubeName 
      ? [this.cubes.get(cubeName)].filter(Boolean) as Cube[]
      : Array.from(this.cubes.values());

    return cubes.map(cube => ({
      name: cube.name,
      title: cube.title,
      measures: Object.entries(cube.measures).map(([key, measure]) => ({
        name: `${cube.name}.${key}`,
        type: measure.type,
        title: measure.label
      })),
      dimensions: Object.entries(cube.dimensions).map(([key, dimension]) => ({
        name: `${cube.name}.${key}`,
        type: dimension.type,
        title: dimension.label
      }))
    }));
  }

  /**
   * Generate SQL representation for debugging/transparency
   */
  async generateSql(query: AnalyticsQuery): Promise<{ sql: string; params: unknown[] }> {
    if (!query.cube) {
      throw new Error('Cube name is required');
    }
    const cube = this.cubes.get(query.cube);
    if (!cube) {
      throw new Error(`Cube not found: ${query.cube}`);
    }

    const tableName = this.extractTableName(cube.sql);
    const selectClauses: string[] = [];
    const groupByClauses: string[] = [];

    // Build SELECT for dimensions
    if (query.dimensions && query.dimensions.length > 0) {
      for (const dim of query.dimensions) {
        const fieldPath = this.resolveFieldPath(cube, dim);
        selectClauses.push(`${fieldPath} AS "${dim}"`);
        groupByClauses.push(fieldPath);
      }
    }

    // Build SELECT for measures
    if (query.measures && query.measures.length > 0) {
      for (const measure of query.measures) {
        const measureDef = this.resolveMeasure(cube, measure);
        if (measureDef) {
          const aggSql = this.measureToSql(measureDef);
          selectClauses.push(`${aggSql} AS "${measure}"`);
        }
      }
    }

    // Build WHERE clause
    const whereClauses: string[] = [];
    const normalizedFilters = this.normalizeFilters(query);
    if (normalizedFilters.length > 0) {
      for (const filter of normalizedFilters) {
        const fieldPath = this.resolveFieldPath(cube, filter.member);
        const sqlOp = this.operatorToSql(filter.operator);
        if (filter.values && filter.values.length > 0) {
          const comparand = this.comparandsFor(cube, filter.member, filter.values)[0];
          // [#5373] A null comparand is a NULLNESS test, not a comparison. SQL's
          // `= NULL` is never true (and `!= NULL` never true either), so emitting
          // one would move the very loss this issue is about from the mingo exit
          // to this one: `{closed_at: null}` would compile to a WHERE that
          // selects nothing while `query()` selects the two null rows. The two
          // exits have to mean the same thing.
          if (comparand == null && (filter.operator === 'equals' || filter.operator === 'notEquals')) {
            whereClauses.push(`${fieldPath} IS ${filter.operator === 'notEquals' ? 'NOT ' : ''}NULL`);
          } else {
            whereClauses.push(`${fieldPath} ${sqlOp} ${this.toSqlLiteral(comparand)}`);
          }
        }
      }
    }

    let sql = `SELECT ${selectClauses.join(', ')} FROM ${tableName}`;
    if (whereClauses.length > 0) {
      sql += ` WHERE ${whereClauses.join(' AND ')}`;
    }
    if (groupByClauses.length > 0) {
      sql += ` GROUP BY ${groupByClauses.join(', ')}`;
    }
    if (query.order) {
      const orderClauses = Object.entries(query.order).map(([field, dir]) => 
        `"${field}" ${dir.toUpperCase()}`
      );
      sql += ` ORDER BY ${orderClauses.join(', ')}`;
    }
    // PRESENCE, not truthiness (#6577) — the third site of the same shape in
    // this package. `limit: 0` means "return no records" (#6485), and a dropped
    // `LIMIT 0` widens the statement to the whole table.
    if (query.limit !== undefined) {
      sql += ` LIMIT ${query.limit}`;
    }
    if (query.offset) {
      sql += ` OFFSET ${query.offset}`;
    }

    return { sql, params: [] };
  }

  // ===================================
  // Helper Methods
  // ===================================

  /**
   * Normalize a query's `where` into the cube-style array the pipeline consumes.
   *
   * Accepts a MongoDB-style `FilterCondition` (per spec/data/filter.zod.ts) —
   * the canonical `AnalyticsQuery.where` shape, and the only one the schema
   * declares:
   *   - implicit equality:  `{is_active: true}`
   *   - operator wrapper:   `{stage: {$nin: [...]}}`
   *   - mixed:              `{stage: 'won', amount: {$gte: 100}}`
   *   - `$and`:             folded into the same implicit-AND list
   * → flattened into one cube-style entry per (field, operator) pair.
   *
   * [#5345] Everything outside {@link ANALYTICS_FILTER_CAPABILITIES} is REFUSED
   * with `INVALID_FILTER` / 400, by the same walk the query path and the
   * reference matcher use. It used to be dropped, and the direction of that drop
   * is what made it a defect rather than a limitation: fewer predicates means
   * MORE rows, so a widget filtered on `{$or: [...]}` aggregated the whole table
   * and looked like a working widget. `$not` made it a permission bug on top —
   * `cel-to-filter.ts` compiles a CEL `!expr` RLS read scope into exactly that
   * shape, so dropping it put unreadable rows into the numbers.
   *
   * The gate runs HERE, before a single key is lowered, for the reason
   * `assertFilterConditionShape` documents at length: a refusal raised partway
   * through a lowering fires or does not fire depending on key order and on
   * which sibling branch was walked first. Both public entry points (`query()`
   * and `generateSql()`) go through this method, so both refuse identically.
   */
  private normalizeFilters(query: unknown): NormalizedCubeFilter[] {
    if (!query || typeof query !== 'object') return [];

    const out: NormalizedCubeFilter[] = [];
    const where = (query as { where?: unknown }).where;

    if (where && typeof where === 'object' && !Array.isArray(where)) {
      assertFilterConditionShape(where, 'where', ANALYTICS_FILTER_CAPABILITIES);
      this.flattenFilterCondition(where as Record<string, unknown>, out, 'where');
    }

    return out;
  }

  private flattenFilterCondition(
    cond: Record<string, unknown>,
    out: NormalizedCubeFilter[],
    path: string,
  ): void {
    for (const [key, raw] of Object.entries(cond)) {
      const here = `${path}.${key}`;

      // [#5373] There is deliberately no `if (raw == null) continue` here.
      //
      // There was, and it was the more dangerous half of this issue: `null` is a
      // COMPARAND, not an absent constraint, so `{closed_at: null}` produced no
      // cube entry at all and the predicate simply vanished. One fewer
      // constraint means MORE rows — a "closed_at is empty" widget silently
      // aggregated the whole table, including the closed records it was written
      // to exclude, and a widened chart looks exactly like a working chart. That
      // is the #3948 direction, and on an RLS read scope it is an unauthorized
      // read rather than a wrong number.
      //
      // `undefined` falls through with it, matching the live query path, which
      // has never distinguished the two (`normalizeFilterCondition` sends both
      // to `toStorageForm` and lets mingo's null-equality rule decide). Agreeing
      // with that path is the invariant (#5240); inventing a third reading of
      // `{field: undefined}` here would break it in the other direction.

      // Logical combinators. `$and` folds into the same implicit-AND list; the
      // gate above has already proven it is an array of filter nodes.
      if (key === '$and') {
        for (const sub of raw as unknown[]) {
          this.flattenFilterCondition(sub as Record<string, unknown>, out, here);
        }
        continue;
      }
      // [#5345] Unreachable via normalizeFilters — the gate refuses these for
      // this face before the lowering starts. Kept as a throw rather than left
      // implicit so that the `continue` which caused #5345 cannot come back, and
      // so a future caller that lowers a condition without gating it first fails
      // loudly instead of silently widening the result set.
      if (key === '$or' || key === '$not') {
        throw uncompilableCombinatorError(key, here, ANALYTICS_FILTER_CAPABILITIES);
      }

      // Operator wrapper: { field: { $op: value, ... } }
      //
      // `raw !== null` carries real weight now that the blanket `raw == null`
      // skip above is gone: `typeof null === 'object'`, so a null comparand
      // would otherwise be read as an operator map and reach `Object.keys(null)`.
      // It is a comparand — it belongs to the implicit-equality arm below.
      if (raw !== null && typeof raw === 'object' && !Array.isArray(raw) && !(raw instanceof Date)) {
        const wrapper = raw as Record<string, unknown>;
        const opEntries = Object.keys(wrapper).filter(k => k.startsWith('$'));
        if (opEntries.length > 0) {
          for (const opKey of opEntries) {
            const cubeOp = this.mongoOperatorToCubeOperator(opKey, key, `${here}.${opKey}`);
            const v = wrapper[opKey];
            out.push({ member: key, operator: cubeOp, values: Array.isArray(v) ? [...v] : [v] });
          }
          continue;
        }
        // Otherwise treat as nested relation (e.g. {profile: {verified: true}}).
        // Flatten with dot-prefixed keys.
        for (const [nestedKey, nestedVal] of Object.entries(wrapper)) {
          this.flattenFilterCondition({ [`${key}.${nestedKey}`]: nestedVal }, out, here);
        }
        continue;
      }

      // Implicit equality: { field: scalar | array }
      out.push({
        member: key,
        operator: Array.isArray(raw) ? 'in' : 'equals',
        values: Array.isArray(raw) ? [...raw] : [raw],
      });
    }
  }

  /**
   * Lower a Filter Protocol `$op` key to the cube-style operator name
   * `convertOperatorToMongo` / `operatorToSql` accept.
   *
   * [#5345] An operator with no row in {@link MONGO_TO_CUBE_OPERATOR} is
   * REFUSED, not skipped. The gate in `normalizeFilters` refuses the same set
   * one step earlier, so for a top-level or `$and`-nested constraint this throw
   * is unreachable — but the nested-relation branch above re-enters this
   * function with a synthesised `{'a.b': spec}` node the gate never saw, and
   * that is a real path to an unmapped operator. It used to `continue`.
   */
  private mongoOperatorToCubeOperator(op: string, field: string, path: string): CubeOperator {
    const cubeOp = (MONGO_TO_CUBE_OPERATOR as Record<string, CubeOperator | undefined>)[op];
    if (!cubeOp) throw uncompilableFieldOperatorError(op, field, path, ANALYTICS_FILTER_CAPABILITIES);
    return cubeOp;
  }

  /**
   * [#5373] The comparands of one lowered entry, in the storage form of the
   * field they are compared against — the ONE place either exit converts a
   * value, so the two exits cannot drift apart.
   *
   * The only conversion left is the temporal one (#4047): a `datetime` column
   * holds canonical UTC ISO text, so a `Date` comparand has to become that text
   * or mingo's cross-type comparison drops every row. That rule is keyed on the
   * DECLARED field kind and belongs to the driver, so it is borrowed from the
   * driver rather than re-derived here — a second derivation of it is the
   * in-package divergence #5240 ruled against.
   *
   * Everything else passes through untouched. That is the point of #5373: a
   * boolean stays a boolean, `null` stays `null`, and a text column's `'100'`
   * stays the string `'100'` instead of becoming the number `100`.
   */
  private comparandsFor(cube: Cube, member: string, values: unknown[]): unknown[] {
    const table = this.extractTableName(cube.sql);
    const fieldPath = this.resolveFieldPath(cube, member);
    return values.map(v => this.driver.filterComparandStorageForm(table, fieldPath, v));
  }

  /**
   * [#5373] A JS comparand as a SQL literal — the one point where a value is
   * stringified, and the reason it may be.
   *
   * This used to take the cube-stringified `string`, which meant it could only
   * guess the original type back out of the text: `'100'` from a TEXT column
   * looked exactly like `100` from a numeric one, and it emitted both unquoted
   * (`WHERE code = 100`). Given the real value there is nothing to guess.
   *
   * Booleans keep the SQLite-style `1`/`0` spelling the old encoding chose —
   * that justification was always sound for THIS half, and only wrong because
   * the in-memory half was forced to share it.
   *
   * A `null` comparand never reaches here from `equals`/`notEquals`; the WHERE
   * builder emits `IS NULL` / `IS NOT NULL` for those. `NULL` is the honest
   * literal for the remaining operators, which cannot be satisfied by it.
   */
  private toSqlLiteral(v: unknown): string {
    if (v == null) return 'NULL';
    if (typeof v === 'boolean') return v ? '1' : '0';
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
    if (typeof v === 'bigint') return String(v);
    const text = v instanceof Date
      ? v.toISOString()
      : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return `'${text.replace(/'/g, "''")}'`;
  }

  private resolveFieldPath(cube: Cube, member: string): string {
    // Handle both "cube.field" and "field" formats
    const parts = member.split('.');
    const fieldName = parts.length > 1 ? parts[1] : parts[0];

    // Check if it's a dimension
    const dimension = cube.dimensions[fieldName];
    if (dimension) {
      // Extract field path from SQL expression
      return dimension.sql.replace(/^\$/, ''); // Remove $ prefix if present
    }

    // Check if it's a measure (for filters)
    const measure = cube.measures[fieldName];
    if (measure) {
      return measure.sql.replace(/^\$/, '');
    }

    return fieldName;
  }

  private resolveMeasure(cube: Cube, measureName: string) {
    const parts = measureName.split('.');
    const fieldName = parts.length > 1 ? parts[1] : parts[0];
    const direct = cube.measures[fieldName];
    if (direct) return direct;

    // Accept `${field}_${type}` aliases (e.g. 'amount_sum') for measures whose
    // canonical name is just `${field}` (e.g. measure 'amount' of type 'sum').
    // This matches the convention used by the data-objectstack adapter and
    // other clients that build measure names from (field, function) pairs.
    const aggTypes = ['count', 'sum', 'avg', 'min', 'max', 'count_distinct'];
    for (const type of aggTypes) {
      const suffix = `_${type}`;
      if (fieldName.endsWith(suffix)) {
        const baseField = fieldName.slice(0, -suffix.length);
        const candidate = cube.measures[baseField];
        if (candidate && candidate.type === type) {
          return candidate;
        }
      }
    }
    return undefined;
  }

  private resolveDimension(cube: Cube, dimensionName: string) {
    const parts = dimensionName.split('.');
    const fieldName = parts.length > 1 ? parts[1] : parts[0];
    return cube.dimensions[fieldName];
  }

  private getShortName(fullName: string): string {
    const parts = fullName.split('.');
    return parts.length > 1 ? parts[1] : parts[0];
  }

  private buildAggregator(measure: { type: string; sql: string; filters?: any[] }): any {
    const fieldPath = measure.sql.replace(/^\$/, '');

    switch (measure.type) {
      case 'count':
        return { $sum: 1 };
      case 'sum':
        return { $sum: `$${fieldPath}` };
      case 'avg':
        return { $avg: `$${fieldPath}` };
      case 'min':
        return { $min: `$${fieldPath}` };
      case 'max':
        return { $max: `$${fieldPath}` };
      case 'count_distinct':
        return { $addToSet: `$${fieldPath}` }; // Will need post-processing for count
      default:
        return { $sum: 1 }; // Default to count
    }
  }

  private measureTypeToFieldType(measureType: string): string {
    switch (measureType) {
      case 'count':
      case 'sum':
      case 'count_distinct':
        return 'number';
      case 'avg':
      case 'min':
      case 'max':
        return 'number';
      case 'string':
        return 'string';
      case 'boolean':
        return 'boolean';
      default:
        return 'number';
    }
  }

  /**
   * [#5374] The mingo predicate builder for one lowered operator.
   *
   * Total by construction: {@link CUBE_OPERATOR_TO_MONGO_PREDICATE} is keyed by
   * {@link CubeOperator}, and `filter.operator` IS a `CubeOperator`, so the
   * lookup cannot miss without a type error somewhere first. The throw is the
   * totality floor that keeps the old `|| '$eq'` from coming back — the two
   * tables drifting must fail loudly, never compile a filter into an equality
   * comparison nobody wrote. It is not a user-input path: everything the author
   * can get wrong was already refused by {@link ANALYTICS_FILTER_CAPABILITIES}.
   */
  private mongoPredicateBuilder(operator: CubeOperator): MongoPredicateBuilder {
    const build = (CUBE_OPERATOR_TO_MONGO_PREDICATE as Record<string, MongoPredicateBuilder | undefined>)[operator];
    if (!build) {
      throw new Error(
        `[driver-memory] analytics face: no mingo predicate for cube operator '${operator}'. ` +
        `MONGO_TO_CUBE_OPERATOR and CUBE_OPERATOR_TO_MONGO_PREDICATE have drifted — ` +
        `add the missing builder rather than letting the operator compile to something else.`,
      );
    }
    return build;
  }

  private operatorToSql(operator: string): string {
    const opMap: Record<string, string> = {
      'equals': '=',
      'notEquals': '!=',
      'contains': 'LIKE',
      'notContains': 'NOT LIKE',
      // [#6520] Needed because the `|| '='` fallback below is not a default, it
      // is a wrong ANSWER: without this row `icontains` would render as `=`, an
      // EQUALITY, in a statement offered to the author as a description of a
      // containment query. `LIKE` is also the semantically right construct here
      // — this exit emits SQLite-shaped SQL, and SQLite's `LIKE` folds ASCII
      // only, which is exactly `$icontains`' domain (#4706 Q1 = A).
      'icontains': 'LIKE',
      'gt': '>',
      'gte': '>=',
      'lt': '<',
      'lte': '<=',
    };
    return opMap[operator] || '=';
  }

  private measureToSql(measure: { type: string; sql: string }): string {
    const fieldPath = measure.sql.replace(/^\$/, '');
    
    switch (measure.type) {
      case 'count':
        return 'COUNT(*)';
      case 'sum':
        return `SUM(${fieldPath})`;
      case 'avg':
        return `AVG(${fieldPath})`;
      case 'min':
        return `MIN(${fieldPath})`;
      case 'max':
        return `MAX(${fieldPath})`;
      case 'count_distinct':
        return `COUNT(DISTINCT ${fieldPath})`;
      default:
        return 'COUNT(*)';
    }
  }

  private extractTableName(sql: string): string {
    // For simple table names, return as-is
    // For complex SQL, this would need more sophisticated parsing
    return sql.trim();
  }

  private parseDateRangeString(range: string): string[] {
    // Simple parser for common date range strings
    // In production, this would use a proper date range parser
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    if (range === 'today') {
      return [today.toISOString(), new Date(today.getTime() + 86400000).toISOString()];
    } else if (range.startsWith('last ')) {
      const parts = range.split(' ');
      const num = parseInt(parts[1]);
      const unit = parts[2];
      const start = new Date(today);
      
      if (unit.startsWith('day')) {
        start.setDate(start.getDate() - num);
      } else if (unit.startsWith('week')) {
        start.setDate(start.getDate() - num * 7);
      } else if (unit.startsWith('month')) {
        start.setMonth(start.getMonth() - num);
      } else if (unit.startsWith('year')) {
        start.setFullYear(start.getFullYear() - num);
      }
      
      return [start.toISOString(), now.toISOString()];
    }
    
    return [range, range]; // Fallback
  }

  private generateSqlFromPipeline(table: string, pipeline: Record<string, any>[]): string {
    // Simplified SQL generation for debugging
    // This is a basic representation of the aggregation pipeline
    const stages = pipeline.map((stage, idx) => {
      const op = Object.keys(stage)[0];
      return `/* Stage ${idx + 1}: ${op} */ ${JSON.stringify(stage[op])}`;
    }).join('\n');
    
    return `-- MongoDB Aggregation Pipeline on table: ${table}\n${stages}`;
  }
}
