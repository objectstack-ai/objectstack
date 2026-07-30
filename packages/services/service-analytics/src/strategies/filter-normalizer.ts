// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Filter Normalization for the Analytics Layer
 *
 * The analytics endpoint accepts filters via the canonical `where`
 * field per the unified Query DSL (`spec/data/query.zod.ts`):
 *
 *   - MongoDB-style FilterCondition: `{ field: value }` /
 *     `{ field: { $op: value } }` / `{ $and: [...] }` — defined in
 *     `spec/data/filter.zod.ts` and used by `find()`, dashboard
 *     widget `filter`, RLS, etc.
 *
 * `normalizeAnalyticsFilters` flattens the FilterCondition tree into
 * the internal array form used by the SQL/Mongo pipeline strategies.
 * Strategies stay simple — they only need to know one shape — and the
 * spec is honoured: dashboard metadata is authored once in the
 * canonical MongoDB form and the server normalizes at the boundary.
 *
 * # Coverage — a dropped predicate WIDENS the query, so nothing is dropped
 *
 * Failing to map an operator is not "not supporting" it: the predicate simply
 * disappears, the compiled SQL stays valid, and the query returns rows the
 * author excluded. It reads as a chart drawn over the whole dataset (#3650's
 * symptom) and is invisible to any test that asserts the emitted SQL string.
 * `$between`, `$startsWith`, `$endsWith` and `$null` each sat broken that way
 * (#4128), so what this maps is now a complete capability claim over
 * `filter.zod.ts`'s authorable vocabulary:
 *
 *   - mapped 1:1 — `$eq` `$ne` `$gt` `$gte` `$lt` `$lte` `$in` `$nin`
 *     `$contains` `$notContains` `$startsWith` `$endsWith`;
 *   - value-DEPENDENT, so resolved explicitly rather than through the map —
 *     `$null` and `$exists`, whose meaning flips with their boolean;
 *   - lowered — `$and` (flattened in place), and `$between`, which becomes its
 *     two bounds so each strategy's existing upper-bound handling applies the
 *     calendar-day whole-day rule (see the note at the lowering);
 *   - anything else THROWS. An operator outside the vocabulary is a caller
 *     error, and a loud one beats a silently widened read — the call
 *     driver-memory made for the same shape in #3948.
 *
 * The one remaining gap is declared, not silent: the `$or` / `$not`
 * combinators are still skipped, because expressing them needs a recursive
 * WHERE builder rather than this flat array. Row-result cover for everything
 * above lives in `filter-operator-coverage.test.ts`.
 */

export interface NormalizedAnalyticsFilter {
  member: string;
  operator: string;
  values: string[];
}

/**
 * The value-INDEPENDENT operators: the pipeline name depends only on the key.
 *
 * `$null` and `$exists` are deliberately absent — their meaning flips with
 * their boolean value, which a key→name map cannot express. Putting `$exists`
 * here anyway is what made `{$exists: false}` compile to `IS NOT NULL`, the
 * exact inverse of what it asks for; both are handled explicitly below.
 */
const MONGO_TO_CUBE_OP: Record<string, string> = {
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
  $startsWith: 'startsWith',
  $endsWith: 'endsWith',
};

/**
 * Stringify a filter value as the internal pipeline requires `values: string[]`.
 *
 * Booleans serialize as the tokens `'true'`/`'false'` (NOT `'1'`/`'0'`) so the
 * boolean identity survives the string roundtrip: the consuming strategies can
 * recover a real boolean for the ObjectQL engine (which compares against the
 * stored boolean type) while still binding `1`/`0` for SQL. Stringifying to
 * `'1'`/`'0'` was indistinguishable from a numeric 1/0 and made every boolean
 * equality filter / boolean group-by compare a number against a boolean — and
 * never match.
 */
function stringifyForCube(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function flattenCondition(cond: Record<string, unknown>, out: NormalizedAnalyticsFilter[]): void {
  for (const [key, raw] of Object.entries(cond)) {
    if (raw === undefined) continue;

    if (key === '$and' && Array.isArray(raw)) {
      for (const sub of raw) {
        if (sub && typeof sub === 'object') {
          flattenCondition(sub as Record<string, unknown>, out);
        }
      }
      continue;
    }
    // Logical $or / $not require recursive WHERE building which the
    // current strategies don't yet support; ignore so partial queries
    // still run.
    if (key === '$or' || key === '$not') continue;

    if (raw === null) {
      out.push({ member: key, operator: 'notSet', values: [] });
      continue;
    }

    if (typeof raw === 'object' && !Array.isArray(raw) && !(raw instanceof Date)) {
      const wrapper = raw as Record<string, unknown>;
      const opKeys = Object.keys(wrapper).filter(k => k.startsWith('$'));
      if (opKeys.length > 0) {
        for (const opKey of opKeys) {
          // `$between [min, max]` LOWERS to its two bounds rather than getting a
          // `between` operator of its own. Both strategies already carry the
          // calendar-day whole-day rule on their upper bound — NativeSQLStrategy
          // compiles a bare-day `lte` half-open (#3777), ObjectQLStrategy hands
          // `$lte` to the driver, which does the same — so a range's max
          // inherits that rule by construction instead of needing a second
          // implementation to keep in step. (The preview evaluator's `$between`
          // gap was closed the same way, sharing its `$lte` helper.)
          //
          // Before this, `$between` was simply absent from the operator map and
          // fell to the `continue` below: the predicate VANISHED from the WHERE
          // clause, so a dashboard widget carrying a range filter charted the
          // entire dataset — #3650's symptom, on the surface #3650 was about.
          // The temporal conformance matrix caught it as row results
          // (`native-sql-temporal-conformance.test.ts`).
          if (opKey === '$between') {
            const v = wrapper[opKey];
            if (!Array.isArray(v) || v.length !== 2) {
              // Never drop it: an unbounded read is the failure mode this whole
              // branch exists to prevent, and it is indistinguishable from a
              // legitimately wide query. Same stance driver-memory took for the
              // same shape (#3948).
              throw new Error(
                `[analytics] "$between" on "${key}" needs a two-element [min, max] array, got ` +
                `${JSON.stringify(v)}. Dropping the predicate would silently widen the query to every row.`,
              );
            }
            out.push({ member: key, operator: 'gte', values: [stringifyForCube(v[0])] });
            out.push({ member: key, operator: 'lte', values: [stringifyForCube(v[1])] });
            continue;
          }

          // The two null predicates read their BOOLEAN, not just their key —
          // which is why neither can live in MONGO_TO_CUBE_OP. `$null: true`
          // asks for IS NULL (`notSet`), `$null: false` for IS NOT NULL
          // (`set`); `$exists` is the mirror image. `$null` is the shape the
          // console emits for an "is empty" / "is not empty" filter
          // (`is_null`/`is_not_null` normalise to it in `filter.zod.ts`), so
          // dropping it silently meant such a widget showed every row.
          if (opKey === '$null' || opKey === '$exists') {
            const isNull = opKey === '$null' ? wrapper[opKey] === true : wrapper[opKey] === false;
            out.push({ member: key, operator: isNull ? 'notSet' : 'set', values: [] });
            continue;
          }

          const cubeOp = MONGO_TO_CUBE_OP[opKey];
          if (!cubeOp) {
            // NEVER drop: a missing predicate does not narrow the query, it
            // WIDENS it — the compiled SQL stays valid and simply returns rows
            // the author excluded, which is indistinguishable from a
            // legitimately broad query and invisible to any test that asserts
            // the emitted SQL. That failure mode is #3650's, and skipping
            // unmapped operators is how `$between` reproduced it (#4128).
            // driver-memory made the same call for the same reason in #3948.
            throw new Error(
              `[analytics] Unsupported filter operator "${opKey}" on "${key}". ` +
              `Supported: ${Object.keys(MONGO_TO_CUBE_OP).join(', ')}, $between, $null, $exists ` +
              `(and $and; $or/$not are not yet compiled by the analytics strategies). ` +
              `Dropping it would silently widen the query to rows the filter excludes.`,
            );
          }
          const v = wrapper[opKey];
          const values = Array.isArray(v)
            ? v.map(stringifyForCube)
            : [stringifyForCube(v)];
          out.push({ member: key, operator: cubeOp, values });
        }
        continue;
      }
      // Nested relation (e.g. {profile: {verified: true}}). Flatten with
      // dot-prefixed keys so cube field path resolution still works.
      for (const [nestedKey, nestedVal] of Object.entries(wrapper)) {
        flattenCondition({ [`${key}.${nestedKey}`]: nestedVal }, out);
      }
      continue;
    }

    // Implicit equality / array → in
    if (Array.isArray(raw)) {
      out.push({ member: key, operator: 'in', values: raw.map(stringifyForCube) });
    } else {
      out.push({ member: key, operator: 'equals', values: [stringifyForCube(raw)] });
    }
  }
}

/**
 * Normalize an analytics query's `where` (FilterCondition) into the
 * internal array form used by all strategies.
 */
export function normalizeAnalyticsFilters(query: { where?: unknown } | unknown): NormalizedAnalyticsFilter[] {
  if (!query || typeof query !== 'object') return [];

  const out: NormalizedAnalyticsFilter[] = [];
  const where = (query as { where?: unknown }).where;

  if (where && typeof where === 'object' && !Array.isArray(where)) {
    flattenCondition(where as Record<string, unknown>, out);
  }

  return out;
}

/** Recover a finite number from a purely-numeric token, else undefined. */
function recoverNumber(s: string): number | undefined {
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/**
 * Coerce a stringified filter value back into a runtime type for SQL
 * parameter binding. Better-sqlite3 (and most drivers) cannot bind a JS
 * boolean, so booleans are recovered as `1`/`0` integers; numbers are
 * recovered as numbers — avoiding string-vs-number mismatches against typed
 * columns.
 */
export function coerceFilterValueForSql(s: string): unknown {
  if (s === 'true') return 1;
  if (s === 'false') return 0;
  if (s === 'null') return null;
  return recoverNumber(s) ?? s;
}

/**
 * Coerce a stringified filter value back into a runtime type for the ObjectQL
 * aggregate engine. Unlike the SQL path, the engine compares against the
 * *stored* runtime type, so a boolean field holds a real `true`/`false` — bind
 * the boolean itself, NOT `1`/`0`, or the equality never matches.
 */
export function coerceFilterValueForObjectQL(s: string): unknown {
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null') return null;
  return recoverNumber(s) ?? s;
}
