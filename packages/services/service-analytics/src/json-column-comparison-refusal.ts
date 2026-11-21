// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#36168] A scalar comparison or text operator aimed at a field the host
 * DECLARES multi-valued or JSON-stored, refused on the analytics `where` door
 * of `NativeSQLStrategy` (`buildFilterClause`) with the refusal every other
 * face of the platform gives it.
 *
 * ## The defect
 *
 * Such a column stores the serialization `["a","b"]`. The native compiler sent
 * every operator except the membership pair (`contains-membership-sql.ts`)
 * through the plain comparison, so `{ tags: { $in: ['a'] } }` compiled to
 * `tags IN ('a')` and counted nothing, `$nin` / `$ne` counted the rows they
 * were asked to exclude, the orderings compared the serialization as text, and
 * `$startsWith` / `$endsWith` / `$icontains` matched it as text. Each answered
 * `200`. `POST /api/v1/data/:object/query` refuses the same filter `400`
 * `INVALID_FILTER` (`driver-sql`'s `where`, `driver-memory`'s filter gate and
 * the engine's per-aggregation `filter`), and so does this door's ObjectQL
 * strategy, which hands the leaf to the engine and its driver.
 *
 * ## One set, one sentence, one population
 *
 * - The operators are `@objectstack/core`'s `JSON_COLUMN_INCOMPATIBLE_OPERATORS`,
 *   read through the spelling each leaf was lowered from
 *   (`CUBE_TO_MONGO_OP`, the inverse of the normaliser's own operator map), so
 *   no second list exists here. `$contains` / `$notContains` (membership) and
 *   the null predicates are absent from that set and keep answering.
 * - The words are `jsonColumnOperatorRefusalText`'s DIAGNOSTIC, which names the
 *   field and the operator and prescribes `$contains`. The filters this compiler
 *   compiles are the caller's `where` (the dataset door's `runtimeFilter`
 *   arrives merged into it), the dataset's own `filter` and its measures'
 *   `filter`s; the ObjectQL strategy marks those `'author'` before the engine,
 *   so `driver-sql` puts the same diagnostic on the wire there. The read scope is
 *   compiled by `read-scope-sql.ts` and never reaches this function.
 * - The population is `isJsonStoredShape` over the host's declared value shape,
 *   the predicate the `$contains` membership branch asks, so this door judges
 *   one column one way for every operator. A host that names no declaration is
 *   not judged, as there.
 *
 * Every dialect is judged: the comparison is wrong whatever engine runs it. A
 * datasource whose dialect the host cannot name (memory, mongodb) never
 * reaches this compile with such a leaf: `NativeSQLStrategy.canHandle` declines
 * it to the ObjectQL strategy, whose engine answers through its own driver (the
 * #20987 decline, which reads the same population).
 */

import { JSON_COLUMN_INCOMPATIBLE_OPERATORS, jsonColumnOperatorRefusalText } from '@objectstack/core';
import type { StrategyContext } from '@objectstack/spec/contracts';
import { isJsonStoredShape } from './contains-membership-sql.js';
import { declaredValueShapeResolver } from './empty-operator-sql.js';
import { CUBE_TO_MONGO_OP, invalidFilterError } from './strategies/filter-normalizer.js';

/**
 * The `$` spelling of a normalised leaf operator when it is one
 * `JSON_COLUMN_INCOMPATIBLE_OPERATORS` refuses on a JSON column, else
 * `undefined`.
 */
export function jsonColumnRefusedSpelling(leafOperator: string): string | undefined {
  const spelling = CUBE_TO_MONGO_OP[leafOperator];
  return spelling !== undefined && JSON_COLUMN_INCOMPATIBLE_OPERATORS.has(spelling) ? spelling : undefined;
}

/**
 * Throw `INVALID_FILTER` / 400 when `operator` (a normalised leaf operator) is
 * one the JSON-column refusal covers and the (object, field) the leaf binds
 * against is declared multi-valued or JSON-stored. Returns otherwise, having
 * bound nothing.
 */
export function refuseWhereJsonColumnComparison(req: {
  ctx: StrategyContext;
  /** The (object, column) the leaf's member binds against. */
  target: { object: string; field: string };
  operator: string;
}): void {
  const spelling = jsonColumnRefusedSpelling(req.operator);
  if (spelling === undefined) return;
  const shape = declaredValueShapeResolver(req.ctx, req.target.object)?.(req.target.field);
  if (!isJsonStoredShape(shape)) return;
  throw invalidFilterError(jsonColumnOperatorRefusalText(req.target.field, spelling, false).diagnostic);
}
