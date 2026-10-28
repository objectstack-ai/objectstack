// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25522 cut 18] Two bodies of the `ObjectQL` "count / aggregate" section:
 * `count` (the counting door, `find`'s sequence up to the driver's `count`)
 * and `rejectCredentialAggregation` (`aggregate()`'s fail-closed guard against
 * grouping or aggregating a field withheld on the generic read path), moved
 * out of `engine.ts`.
 *
 * A MOVE, not a redesign. Each exported function below is the body of the
 * `ObjectQL` method of the same name as it stood, re-indented one level and
 * otherwise unedited. Each method's docblock stays on the method in
 * `engine.ts`, which is still the contract.
 *
 * ## How the moved bodies reach the class
 *
 * The shape #23050 set for `rest-server.ts`, applied as
 * `engine-driver-options.ts` applies it. The class keeps each method with
 * name, modifiers, signature, docblock and position; its body becomes one
 * literal of exactly the {@link CountAggregateHost} members it reads, plus a
 * `.call`. The fields read (`_registry`, `relatedSchemaOf`) go as GETTERS, so
 * each read happens when the body makes it, as it did; no body assigns a
 * field. The methods called go as late-bound closures over the instance, so a
 * double or spy set on the engine is still the one a call reaches.
 * `aggregate` stays in the class: `packages/spec/liveness/query.json` names
 * `engine.ts#aggregate` as a producer.
 *
 * ## Module helpers
 *
 * `count` reads seven top-level helpers that `find`, `findOne`, `update`,
 * `delete` or `aggregate` read too: `foldEngineOptionAliases`,
 * `ENGINE_WHERE_SLOTS`, `rejectUnknownEngineOptions`,
 * `ENGINE_COUNT_OPTION_KEYS`, `lowerWhereFilterArray`, `mergeReadContext` and
 * `declaredDatetimeLowering`. One home each: they stay declared in
 * `engine.ts`, exported in place, and are imported here, never copied.
 * Nothing re-exports them from the package entry, so the published surface
 * does not move.
 *
 * That import is a run-time module cycle (`engine.ts` imports this module,
 * this module imports `engine.ts`). Nothing here runs at module evaluation,
 * only declarations, and the helpers are read only when a body runs, after
 * both modules have evaluated. `engine.ts` imports this module right after
 * `./secret-fields.js`, the one other module this one imports, so the
 * evaluation order of every module is what it was; the
 * `@objectstack/spec/api` import that left `engine.ts` with
 * `rejectCredentialAggregation` was not that package's first load. The
 * published build bundles both files into one, where the cycle does not
 * exist.
 */

import type { EngineAggregateOptions, EngineCountOptions, QueryAST } from '@objectstack/spec/data';
// [#22646] The ADR-0112 catalog — `rejectCredentialAggregation`'s refusal
// envelope carries `INVALID_FIELD` from it rather than a bare `Error`.
import { StandardErrorCode } from '@objectstack/spec/api';
import {
  collectInternalReadFields,
  collectCredentialFields,
} from './secret-fields.js';
import {
  ENGINE_COUNT_OPTION_KEYS,
  ENGINE_WHERE_SLOTS,
  declaredDatetimeLowering,
  foldEngineOptionAliases,
  lowerWhereFilterArray,
  mergeReadContext,
  rejectUnknownEngineOptions,
} from './engine.js';
import type { EngineReadOptions, ObjectQL, OperationContext } from './engine.js';

/**
 * The `ObjectQL` members the functions below read — every one of them, and no
 * other; each function's `this` is the `Pick` of the members IT reads. Each is
 * typed AS the class member (an indexed access on the class), so a change to a
 * member's type on the class is a change here too, and naming a member the
 * class does not have is a compile error. See the module header for which
 * members are getters.
 */
export interface CountAggregateHost {
  readonly _registry: ObjectQL['_registry'];
  readonly relatedSchemaOf: ObjectQL['relatedSchemaOf'];
  resolveObjectName: ObjectQL['resolveObjectName'];
  expandSearchOnOptions: ObjectQL['expandSearchOnOptions'];
  getDriver: ObjectQL['getDriver'];
  resolveWhereTokens: ObjectQL['resolveWhereTokens'];
  executeWithMiddleware: ObjectQL['executeWithMiddleware'];
  buildDriverOptions: ObjectQL['buildDriverOptions'];
  composeReadableIdsAtBoundary: ObjectQL['composeReadableIdsAtBoundary'];
  find: ObjectQL['find'];
}

/** The body of `ObjectQL#count`; the method's docblock there is its contract. */
export async function count(
  this: Pick<CountAggregateHost, 'resolveObjectName' | '_registry' | 'relatedSchemaOf' | 'expandSearchOnOptions' | 'getDriver' | 'resolveWhereTokens' | 'executeWithMiddleware' | 'buildDriverOptions' | 'composeReadableIdsAtBoundary' | 'find'>,
  object: string,
  query?: EngineCountOptions,
  options?: EngineReadOptions,
): Promise<number> {
   object = this.resolveObjectName(object);
   // Fold the `filter` alias into `where` (#4346) — the AST below reads
   // `query.where` only, so an unfolded `{ filter }` counted the whole table.
   query = foldEngineOptionAliases(object, 'count', query, ENGINE_WHERE_SLOTS);
   rejectUnknownEngineOptions(object, 'count', query, ENGINE_COUNT_OPTION_KEYS);
   query = lowerWhereFilterArray(object, 'count', query, this._registry.getObject(object), this.relatedSchemaOf);
   // [#22790] ADR-0061 `search` → the rows are searched before they are
   // counted, by the one expander `find` runs, at the same point in the
   // sequence — so the count is the number of rows `find` returns for the bag.
   if (query) query = await this.expandSearchOnOptions(object, query, options);
   const driver = this.getDriver(object);

   // The AST must ride on the opCtx so the security/sharing middlewares can
   // inject their read filters (RLS, OWD/sharing scope) into `ast.where` —
   // exactly like find(). Building it locally inside the executor (#2737)
   // discarded every injected filter: `total` counted the RAW table while
   // `records` were scoped, leaking invisible-row counts and breaking
   // pagination.
   const opCtx: OperationContext = {
     object,
     operation: 'count',
     ast: { object, where: query?.where },
     options: query,
     context: mergeReadContext(query?.context, options?.context),
   };
   // [ADR-0053 D-D1, amended — #5930] Resolve, then lower. [#20802] …with
   // the nested-relation step between the two.
   await this.resolveWhereTokens(
     opCtx.ast as QueryAST,
     opCtx.context,
     declaredDatetimeLowering(this._registry.getObject(object)),
     'where',
     'count',
   );
   // The caller's own `where`, placeholders expanded — captured BEFORE the
   // middleware chain scopes `opCtx.ast.where`, so the find() fallback below
   // still passes the unscoped filter (find() applies the read filters itself).
   const callerWhere = (opCtx.ast as QueryAST).where;

   await this.executeWithMiddleware(opCtx, async () => {
     const countOpts = this.buildDriverOptions(object, opCtx.context, undefined, { recordedVerdict: opCtx.tenantLayer0Verdict });
     if (driver.count) {
         // [ADR-0139 D2] The executor boundary, as in `find` (`count` has no
         // before-hook): the AST is final once the chain has run. The
         // `find()` fallback below composes at its own boundary.
         return driver.count(
           object,
           await this.composeReadableIdsAtBoundary(object, 'count', opCtx.ast as QueryAST, opCtx.context),
           countOpts,
         );
     }
     // Fallback to find().length — find() applies the read filters itself,
     // so pass the caller's original where, not the already-scoped ast.
     const res = await this.find(object, { where: callerWhere, fields: ['id'], context: opCtx.context });
     return res.length;
   });

   return opCtx.result as number;
}

/** The body of `ObjectQL#rejectCredentialAggregation`; the method's docblock there is its contract. */
export function rejectCredentialAggregation(
  this: Pick<CountAggregateHost, '_registry'>,
  object: string,
  query: EngineAggregateOptions,
): void {
  const schema = this._registry.getObject(object);
  // Deduped: one field can be reachable through both collectors (a `secret`
  // column that is also flagged `internal`), and it must be named once.
  const protectedFields = [
    ...new Set([...collectCredentialFields(schema), ...collectInternalReadFields(schema)]),
  ];
  if (protectedFields.length === 0) return;

  const referenced = new Set<string>();
  for (const agg of query?.aggregations ?? []) {
    const field = (agg as { field?: string })?.field;
    if (field && field !== '*') referenced.add(field);
  }
  for (const g of query?.groupBy ?? []) {
    const field = typeof g === 'string' ? g : g?.field;
    if (field) referenced.add(field);
  }

  const hit = protectedFields.filter((f) => referenced.has(f));
  if (hit.length > 0) {
    const err = new Error(
      `Cannot aggregate credential field(s) ${hit.map((f) => `"${object}.${f}"`).join(', ')}: `
        + 'secret/password fields are masked on read and `internal: true` fields are omitted '
        + 'outright, so the value never leaves the engine on the generic data path; aggregating '
        + 'them (group-by, min/max, array_agg, …) would surface it. '
        + 'Refusing (fail-closed) — see ADR-0100.',
    ) as Error & { code?: string; status?: number; httpStatus?: number; field?: string; fields?: string[]; object?: string };
    // ADR-0112 envelope, the same number under D5's two spellings — `status`
    // for the HTTP doors, `httpStatus` for a consumer holding the thrown
    // error (the CLI `--json` envelope).
    err.code = StandardErrorCode.enum.INVALID_FIELD;
    err.status = 400;
    err.httpStatus = 400;
    err.field = hit[0];
    err.fields = hit;
    err.object = object;
    throw err;
  }
}
