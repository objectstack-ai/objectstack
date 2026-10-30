// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25522 cut 20] Three bodies of the `ObjectQL` query-lowering stage, the
 * head of the "Data Access Methods" section: `resolveWhereTokens` (every read
 * verb's filter-position stage: resolve the placeholders, then lower),
 * `lowerRelationConditions` (the nested-relation step, which reads the related
 * object as the caller) and `resolveSearchQueryableFields` (the fields a
 * `search` may scan for the caller), moved out of `engine.ts`.
 *
 * A MOVE, not a redesign. Each exported function below is the body of the
 * `ObjectQL` method of the same name as it stood, re-indented one level and
 * otherwise unedited. Each method's docblock stays on the method in
 * `engine.ts`, which is still the contract.
 *
 * ## How the moved bodies reach the class
 *
 * The shape #23050 set for `rest-server.ts`, applied as
 * `engine-count-aggregate.ts` applies it. The class keeps each method with
 * name, modifiers, signature, docblock and position; its body becomes one
 * literal of exactly the {@link QueryLoweringHost} members it reads, plus a
 * `.call`. The fields read (`_registry`, `relatedSchemaOf`) go as GETTERS, so
 * each read happens when the body makes it, as it did; no body assigns a
 * field. The methods called (`resolveRelateThenLowerWhere`, `find`) go as
 * late-bound closures over the instance, so a double or spy set on the engine
 * is still the one a call reaches.
 *
 * `resolveSearchQueryableFields` reads one more member: the engine's
 * {@link SECURITY_SERVICE_SOURCE_SLOT}, a symbol-keyed slot the kernel sets on
 * the instance and the class does not declare. It goes as a getter too, keyed
 * by the same symbol, so the body still reads the slot at use and never a
 * copy; its type is `unknown`, the type the body reads it as.
 *
 * The rest of the stage stays in the class: `resolveRelateThenLowerWhere`,
 * `withResolvedWhere` and `expandSearchOnOptions` are bodies no longer than
 * the host literal that would replace them, and `expandSearchOnAst` and
 * `fillQueryAstDefaults` are named as `engine.ts#…` producers in
 * `packages/spec/liveness/` (the first by `docs/qa/` too).
 *
 * ## Module helpers
 *
 * `resolveWhereTokens` reads `resolveThenLowerWhere` and
 * `lowerRelationConditions` reads `relationSitesOf`; `aggregate` and the
 * `where` admission judge read them too. One home each: they stay declared in
 * `engine.ts`, exported in place, and are imported here, never copied.
 * `SECURITY_SERVICE_SOURCE_SLOT` was already exported. Nothing re-exports any
 * of them from the package entry, so the published surface does not move.
 *
 * That import is a run-time module cycle (`engine.ts` imports this module,
 * this module imports `engine.ts`). Nothing here runs at module evaluation,
 * only declarations, and the helpers are read only when a body runs, after
 * both modules have evaluated. `engine.ts` imports this module after every
 * module this one imports, so the evaluation order of every module is what it
 * was. The published build bundles both files into one, where the cycle does
 * not exist.
 */

import type { FilterCondition, FilterLoweringOptions, QueryAST } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { ISecurityService } from '@objectstack/spec/contracts';
import { assertHavingResolvedTemporalTokensInRange } from './temporal-comparand-door.js';
import { mapRelationConditions } from './number-comparand-declared-type-door.js';
import {
  lowerRelationSite,
  RELATION_FILTER_ID_CAP,
  relationFilterCapError,
  type RelationReplacement,
} from './relation-filter-lowering.js';
import { aggregatedRowColumnClasses } from './having-filter.js';
import { relationSitesOf, resolveThenLowerWhere, SECURITY_SERVICE_SOURCE_SLOT } from './engine.js';
import type { ObjectQL } from './engine.js';

/**
 * The `ObjectQL` members the functions below read — every one of them, and no
 * other; each function's `this` is the `Pick` of the members IT reads. Each
 * declared member is typed AS the class member (an indexed access on the
 * class), so a change to a member's type on the class is a change here too,
 * and naming a member the class does not have is a compile error. The one
 * exception is the security-service slot, which the class does not declare
 * (module header). See the module header for which members are getters.
 */
export interface QueryLoweringHost {
  readonly _registry: ObjectQL['_registry'];
  readonly relatedSchemaOf: ObjectQL['relatedSchemaOf'];
  readonly [SECURITY_SERVICE_SOURCE_SLOT]: unknown;
  resolveRelateThenLowerWhere: ObjectQL['resolveRelateThenLowerWhere'];
  find: ObjectQL['find'];
}

/** The body of `ObjectQL#resolveWhereTokens`; the method's docblock there is its contract. */
export async function resolveWhereTokens(
  this: Pick<QueryLoweringHost, '_registry' | 'resolveRelateThenLowerWhere'>,
  ast: QueryAST | undefined,
  execCtx: ExecutionContext | undefined,
  lowering: FilterLoweringOptions,
  position: 'where' | 'having' = 'where',
  operation = 'find',
): Promise<void> {
  if (!ast || ast[position] == null) return;
  // [#20157] Through the stage function the judge also calls.
  if (position === 'having') {
    // [#20844] The year range of a resolved date macro, by each aggregated
    // column's class — the reading the `having` temporal door takes. Built
    // only when something resolved.
    ast[position] = resolveThenLowerWhere(ast[position], execCtx, lowering, (written, resolved) => {
      const fields = (this._registry.getObject(ast.object) as { fields?: Record<string, unknown> } | undefined)?.fields;
      assertHavingResolvedTemporalTokensInRange(
        ast.object, written, resolved, aggregatedRowColumnClasses(ast.groupBy, ast.aggregations, fields), ast,
      );
    });
    return;
  }
  // [#20802] `where` serves the nested-relation form: resolve, then lower
  // each relation condition (a read of the related object, as the caller),
  // then the shared lowering — {@link resolveRelateThenLowerWhere}.
  ast[position] = await this.resolveRelateThenLowerWhere(
    ast.object, operation, ast[position], execCtx, lowering,
  );
}

/** The body of `ObjectQL#lowerRelationConditions`; the method's docblock there is its contract. */
export async function lowerRelationConditions<W>(
  this: Pick<QueryLoweringHost, '_registry' | 'relatedSchemaOf' | 'find'>,
  object: string,
  operation: string,
  where: W,
  execCtx: ExecutionContext | undefined,
): Promise<W> {
  if (where == null) return where;
  const schema = this._registry.getObject(object);
  const sites = relationSitesOf(object, operation, where, schema, this.relatedSchemaOf);
  if (sites.length === 0) return where;
  const context = `${operation}('${object}')`;
  const replacements: RelationReplacement[] = [];
  for (const site of sites) {
    const rows = await this.find(site.target, {
      where: site.condition as FilterCondition,
      fields: ['id'],
      limit: RELATION_FILTER_ID_CAP + 1,
      ...(execCtx ? { context: execCtx } : {}),
    });
    const matched = Array.isArray(rows) ? rows : [];
    if (matched.length > RELATION_FILTER_ID_CAP) {
      throw relationFilterCapError(site, context, RELATION_FILTER_ID_CAP);
    }
    replacements.push(lowerRelationSite(
      site,
      matched.map((row) => (row as { id?: unknown } | null)?.id).filter((id) => id !== undefined && id !== null),
    ));
  }
  let next = 0;
  return mapRelationConditions(object, operation, schema, where, {
    schemaOf: this.relatedSchemaOf,
    replace: () => replacements[next++],
  });
}

/** The body of `ObjectQL#resolveSearchQueryableFields`; the method's docblock there is its contract. */
export async function resolveSearchQueryableFields(
  this: Pick<QueryLoweringHost, typeof SECURITY_SERVICE_SOURCE_SLOT>,
  object: string,
  context: ExecutionContext | undefined,
): Promise<ReadonlySet<string> | undefined> {
  if (context === undefined) return undefined;
  // Read from the engine slot at use (see SECURITY_SERVICE_SOURCE_SLOT), never cached.
  const source = (this as unknown as Record<symbol, unknown>)[SECURITY_SERVICE_SOURCE_SLOT];
  if (typeof source !== 'function') return undefined;
  let svc: Partial<Pick<ISecurityService, 'getQueryableFields'>> | undefined;
  try {
    svc = source() ?? undefined;
  } catch {
    // The in-repo kernels throw on a name nothing registered: no service.
    return undefined;
  }
  if (typeof svc?.getQueryableFields !== 'function') return undefined;
  const queryable = await svc.getQueryableFields(object, context as any);
  return queryable === undefined ? undefined : new Set(queryable);
}
