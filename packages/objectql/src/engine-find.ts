// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29986 codemod] The "Query lowering, search, find and findOne" section of
 * `ObjectQL`: the bodies of `resolveRelateThenLowerWhere`, `withResolvedWhere`,
 * `expandSearchOnAst`, `expandSearchOnOptions`, `fillQueryAstDefaults`,
 * `requireFindOnePredicate`, `find`, `reportFindFailure`, `findOne` moved out
 * of `engine.ts` whole by `scripts/codemod-split-engine.mjs`.
 *
 * A MOVE, not a redesign. {@link FindFacet} is a stateless facet of `ObjectQL`
 * (ruling 6624345766): each static method of it is the body of the `ObjectQL`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class as a one-call stub with
 * its signature, so the published surface, an instance spy and a subclass
 * override are what they were. A public or protected method keeps its
 * docblock on the class, the contract; a private method's docblock moved here
 * with its body. The state stays on `ObjectQL`.
 *
 * The bodies reach the class through {@link FindHost}: exactly the `ObjectQL`
 * members they read, private ones included. Every stub hands its body, by a
 * `.call`, the same host: `findHost` in `engine-facet-hosts.ts`, built once per
 * engine by the class's static block. Methods go as closures that call them on
 * the engine at call time, so a subclass override or an instance spy is still
 * the one reached; fields and accessors go as GETTERS, read when the body reads
 * them, as they were on the class, and a field a body assigns goes with a
 * SETTER that assigns it on the engine.
 *
 * The module imports `engine.ts` for types only, so the two modules form no
 * evaluation cycle. `index.ts` re-exports nothing from this module.
 */

import { SortNodeSchema, lowerFilterCondition, resolveSearchFieldResolution } from '@objectstack/spec/data';
import type { EngineAggregateOptions, EngineCountOptions, EngineQueryOptions, FilterLoweringOptions, HookContext, QueryAST, QueryInput, ServiceObject } from '@objectstack/spec/data';
import { mergeDriverOptionsIntoHookView } from './engine-driver-options.js';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { isMissingTableError } from '@objectstack/metadata/errors';
import { collectCredentialFields, collectInternalReadFields } from './secret-fields.js';
import { expandSearchToFilter, normalizeSearch } from './search-filter.js';
import { FindHookResultNotArrayError } from './find-hook-result-shape.js';
import { FindOneHookResultNotRecordError, isFindOneResultShape } from './verb-hook-result-shape.js';
import { rejectCredentialEvaluation } from './credential-evaluation-guard.js';
import { rejectInternalFieldEvaluation } from './internal-field-evaluation-guard.js';
import { assertProjectionNamesAField, refuseProjectionOfUnknownColumns } from './empty-projection-door.js';
import { PLATFORM_PROVISIONED_COLUMNS, declaredColumnSet, rowsWithDeclaredColumnsOnly, rowsWithSelectedColumnsAnswered, selectedStoredColumns, withDeclaredColumnsOnly, withSelectedColumnsAnswered } from './declared-read-columns.js';
import {
  ENGINE_FIND_OPTION_KEYS, ENGINE_QUERY_SLOTS, ENGINE_WIRE_ONLY_SLOTS, applyFormulaPlan,
  assertOrderByIsMaterializable, assertProjectionHasNoDottedPaths, declaredDatetimeLowering, emptySearchSetError,
  foldEngineOptionAliases, lowerWhereFilterArray, mergeReadContext, planFormulaProjection,
  refuseSearchOverrideNamingNoField, refuseSearchOverrideNamingNoSearchableField, rejectUnknownEngineOptions,
  resolveWhereFilterTokens, rowsWithoutFormulaWidening, whereResolvedTokenJudge, withFileOwnerKey,
  withoutFormulaWidening, writeFailureLogMeta,
} from './engine-top-level.js';
import type { EngineReadOptions, OperationContext } from './engine-top-level.js';
import type { ObjectQL } from './engine.js';

/**
 * The `ObjectQL` members the bodies of {@link FindFacet} read — every one of
 * them, and no other. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too. `readonly` members are the getters; the others are fields a body
 * assigns.
 */
export interface FindHost {
  readonly _registry: ObjectQL['_registry'];
  buildDriverOptions: ObjectQL['buildDriverOptions'];
  buildHookApi: ObjectQL['buildHookApi'];
  buildProvenance: ObjectQL['buildProvenance'];
  buildSession: ObjectQL['buildSession'];
  buildUser: ObjectQL['buildUser'];
  composeReadableIdsAtBoundary: ObjectQL['composeReadableIdsAtBoundary'];
  executeWithMiddleware: ObjectQL['executeWithMiddleware'];
  expandRelatedRecords: ObjectQL['expandRelatedRecords'];
  expandSearchOnAst: ObjectQL['expandSearchOnAst'];
  /** The engine itself: a moved body reads `this.facade` where the method read a bare `this` (#30020). */
  readonly facade: ObjectQL;
  fillQueryAstDefaults: ObjectQL['fillQueryAstDefaults'];
  formulaFaultSink: ObjectQL['formulaFaultSink'];
  formulaOptionLabels: ObjectQL['formulaOptionLabels'];
  getDriver: ObjectQL['getDriver'];
  readonly logger: ObjectQL['logger'];
  lowerRelationConditions: ObjectQL['lowerRelationConditions'];
  maskSecretFields: ObjectQL['maskSecretFields'];
  permissionResolution: ObjectQL['permissionResolution'];
  readonly relatedSchemaOf: ObjectQL['relatedSchemaOf'];
  reportFindFailure: ObjectQL['reportFindFailure'];
  requireFindOnePredicate: ObjectQL['requireFindOnePredicate'];
  resolveFileReferences: ObjectQL['resolveFileReferences'];
  resolveFormulaPermissions: ObjectQL['resolveFormulaPermissions'];
  resolveFormulaRelated: ObjectQL['resolveFormulaRelated'];
  resolveObjectName: ObjectQL['resolveObjectName'];
  resolveRelateThenLowerWhere: ObjectQL['resolveRelateThenLowerWhere'];
  resolveSearchQueryableFields: ObjectQL['resolveSearchQueryableFields'];
  resolveWhereTokens: ObjectQL['resolveWhereTokens'];
  stripSearchCompanionFromRead: ObjectQL['stripSearchCompanionFromRead'];
  triggerHooks: ObjectQL['triggerHooks'];
}

/** The bodies of the "Query lowering, search, find and findOne" section of `ObjectQL`: a stateless facet, called by the class's stubs. */
export class FindFacet {
  /**
   * [#20802] Stage 2 of `where` admission on every verb, whole: resolve the
   * placeholders, then LOWER EACH NESTED-RELATION CONDITION
   * ({@link lowerRelationConditions}), then run the shared lowering
   * ({@link resolveThenLowerWhere}'s second half, `lowerFilterCondition`).
   *
   * The order is ADR-0053 D-D1 item 3's, extended by one step: tokens first,
   * so a condition on the related object carries the resolved values (one
   * instant for the whole filter) into the related read; the relation step
   * before the shared lowering, so that lowering reads the `$in` / `$contains`
   * the relation step produced — including the NULL-safe `$not` over it — and
   * never a nested object whose columns belong to another object.
   */
  static async resolveRelateThenLowerWhere<W>(this: Pick<FindHost, '_registry' | 'lowerRelationConditions'>, object: string, operation: string, where: W, execCtx: ExecutionContext | undefined, lowering: FilterLoweringOptions): Promise<W> {
    const resolved = resolveWhereFilterTokens(
      where, execCtx, whereResolvedTokenJudge(object, operation, this._registry.getObject(object)),
    );
    const related = await this.lowerRelationConditions(object, operation, resolved, execCtx);
    return lowerFilterCondition(related, lowering);
  }

  /**
   * The write-path counterpart of {@link resolveWhereTokens}: return `options`
   * with `where` placeholders expanded (#3810).
   *
   * Returns the SAME object when nothing resolved — `resolveFilterTokens`
   * returns its input by reference on a placeholder-free tree, so the common
   * path allocates nothing. When something does resolve, a shallow copy is
   * made rather than assigning through: `options` belongs to the caller, and
   * writing back would bake one request's user id into a filter object the
   * caller may reuse (view metadata and flow node config both get reused).
   *
   * [ADR-0053 D-D1, amended — #5930] …and lowered, in the same stage
   * ({@link resolveThenLowerWhere}), with the object's declared-type reader.
   * The lowering is copy-on-write too, so a `where` it rewrites lands on the
   * copy, never on the caller's object.
   */
  static async withResolvedWhere<T extends { where?: unknown; context?: ExecutionContext } | undefined>(this: Pick<FindHost, 'resolveRelateThenLowerWhere'>, object: string, operation: string, options: T, lowering: FilterLoweringOptions): Promise<T> {
    if (!options || options.where == null) return options;
    // [#20157] Through the stage function the judge also calls. [#20802] …with
    // the nested-relation step between resolution and the shared lowering.
    const resolved = await this.resolveRelateThenLowerWhere(object, operation, options.where, options.context, lowering);
    return resolved === options.where ? options : ({ ...options, where: resolved } as T);
  }

  /**
   * ADR-0061: expand `search` into a server-resolved cross-field `$or` of
   * `$icontains`, AND it with any caller `where`, then strip the search keys off
   * the AST.
   *
   * Shared by `find` and `findOne` (#4419). It lived inline in `find` and
   * nowhere else, while `ENGINE_FIND_OPTION_KEYS` — the one legal-key set BOTH
   * methods are checked against (see {@link ENGINE_OPTION_KEY_SETS}) — declares
   * `search`/`searchFields` for both. So `findOne({ search })` passed the gate,
   * rode onto the AST verbatim, and reached a driver: no driver reads
   * `ast.search` (the expansion is the engine's job by ADR-0061), so the
   * predicate vanished and the forced `limit: 1` turned it into the first row of
   * the WHOLE object — a real, plausible-looking record unrelated to the search.
   * That is #4419's reported failure exactly, under a different key than the
   * `filter` #4346 closed; one expander, called from both, is what stops the
   * pair drifting again.
   *
   * Field resolution is server-side (declared `searchableFields` →
   * auto-default); the optional `searchFields` override is intersected with the
   * allowed set, never widened. All drivers already execute `$or`/`$icontains`,
   * so this needs no driver changes.
   *
   * [#29394] A resolved field whose declared type can never hold a string (the
   * #15661 door's verdict) gets no clause — `expandSearchToFilter` skips it —
   * because that door judges only the caller's `where`, above, and never this
   * expansion. The set itself is not narrowed, so the refusals below judge it
   * as before, and a set of only such fields answers no rows.
   *
   * The keys are deleted whether or not anything expanded — leaving them on
   * would hand the driver a key it does not read, which is the same silent drop
   * one layer down.
   */
  static async expandSearchOnAst(this: Pick<FindHost, 'resolveSearchQueryableFields'>, ast: QueryAST, schema: ServiceObject | undefined, context: ExecutionContext | undefined): Promise<void> {
    // The `$search`/`$searchFields` OData spellings are NOT read here: the
    // protocol layer normalizes them to the bare keys before the engine
    // (protocol.ts findData), and a direct engine call carrying one is an
    // unknown option — rejected at the entry point, not silently dropped
    // (#4371).
    const raw = (ast as any).search;
    // [#27732] An override naming no field is refused, never read as absent.
    // Judged before the expansion and so before any driver read, whether or
    // not a search term rode along, on both slots, as the door does.
    refuseSearchOverrideNamingNoField(ast.object, (ast as any).searchFields, 'searchFields');
    if (raw !== null && typeof raw === 'object') refuseSearchOverrideNamingNoField(ast.object, raw.fields, 'search.fields');
    if (raw != null && schema?.fields) {
      const requestedFields = (ast as any).searchFields
        ?? (typeof raw === 'object' ? raw?.fields : undefined);
      // [#22646] A `search` never scans an `internal: true` column. The flag's
      // promise ("the value is never returned on a generic data exit") is a
      // withhold on the read path (the row strip) and a refusal everywhere the
      // value would be revealed by evaluation; `$search` is such a position —
      // a cross-field `$icontains` that confirms a guessed prefix of a withheld
      // credential, matching the row only when the guess is right. The field is
      // dropped from the set the expansion resolves over (a WITHHOLD, like the
      // auto-default's `hidden`/credential-type exclusions one layer down), so
      // the default set never scans it, for every verb that reaches here
      // (`find` / `findOne` / `aggregate`, and `searchAll` through them). An
      // EXPLICIT `$searchFields` naming one is refused loudly at the generic
      // data door instead (`assertSearchFieldsAreSearchable`,
      // `@objectstack/metadata-protocol`), the #4254 posture — an unhonoured
      // narrowing must be a 400, not a silent widening. A direct engine caller
      // naming one beside a searchable field has it intersected away here, the
      // engine's existing tolerant posture for an unknown requested search
      // field; naming only such fields is refused below (#28120).
      // [ADR-0100] …and never a `secret` / `password` column either, by the
      // collector the credential guards read: the auto-default already skips
      // those types, and an author-declared `searchableFields` naming one is
      // withheld here the same way, so a search term is never evaluated over
      // a value the read path masks.
      const internalFields = [...new Set([...collectInternalReadFields(schema), ...collectCredentialFields(schema)])];
      const scanFields = internalFields.length === 0
        ? (schema.fields as any)
        : Object.fromEntries(
            Object.entries(schema.fields as Record<string, unknown>)
              .filter(([name]) => !internalFields.includes(name)),
          );
      const expandOptions = {
        fields: scanFields,
        searchableFields: (schema as any).searchableFields,
        requestedFields,
        // [ADR-0079] `nameField` is the canonical primary-title pointer;
        // `displayNameField` is the deprecated alias (still honored).
        displayField: (schema as any).nameField ?? (schema as any).displayNameField,
      };
      // [#28120] An override naming none of the fields the expansion would
      // scan is refused, never widened back to the whole set.
      refuseSearchOverrideNamingNoSearchableField(
        ast.object, requestedFields, (ast as any).searchFields != null ? 'searchFields' : 'search.fields',
        resolveSearchFieldResolution(expandOptions).allowed,
      );
      // [#25672] …and never a column the CALLER may not query. The field-read
      // predicate guard (plugin-security) runs after this expansion and judges
      // the expanded `$or` as the caller's own predicate, so one hidden column
      // in the server-resolved set refused the whole search with 403 —
      // `sys_user`'s `role` / `ban_reason` / `last_login_ip` broke every user
      // picker for members. The set is narrowed to the security service's
      // `getQueryableFields` answer, the published complement of what that
      // guard refuses (one derivation, no second field-permission rule here),
      // asked with the context the middleware will see. A field the caller
      // NAMED in `searchFields` is not withheld, so the guard still refuses it
      // loudly. The guard itself is unchanged, and still judges every
      // predicate the caller wrote.
      const queryableFields = normalizeSearch(raw).query.trim()
        ? await this.resolveSearchQueryableFields(ast.object, context)
        : undefined;
      const searchFilter = expandSearchToFilter(raw, { ...expandOptions, queryableFields });
      if (searchFilter) {
        ast.where = ast.where ? { $and: [ast.where, searchFilter] } : searchFilter;
      } else if (normalizeSearch(raw).query.trim()) {
        // [#24284] A non-blank term that expanded to nothing means the RESOLVED
        // search set is empty: `expandSearchToFilter` answers `null` for
        // exactly two reasons, and the other one (a blank term) is excluded
        // here. Leaving `where` untouched would answer the search with EVERY
        // row, indistinguishable from "everything matched" — the silent
        // widening #4254 refuses on the explicit-override axis. Judged on the
        // set the expansion itself resolved (no second resolver), so it holds
        // for every verb that reaches here (`find` / `findOne` / `aggregate` /
        // the count) and every door (REST, dispatcher, SDK, a hook's
        // `ctx.api`). An explicit override intersected to nothing is refused
        // before the expansion (#28120) unless the allowed set is empty too, so
        // it reaches this only then. [#25672] A set the caller's
        // queryable fields withheld down to nothing gets the same answer: the
        // declared set expands without the narrowing, so the refusal says so.
        const withheld = queryableFields !== undefined && expandSearchToFilter(raw, expandOptions) !== null;
        throw emptySearchSetError(ast.object, schema, internalFields.length > 0, withheld);
      }
    }
    delete (ast as any).search;
    delete (ast as any).searchFields;
  }

  /**
   * The aggregate and count verbs' door into {@link expandSearchOnAst} — ⛔ not
   * a second expander. `QuerySchema.search` (ADR-0061 D1) is declared beside
   * `groupBy` / `aggregations` with no carve-out, so a grouped read under a
   * search groups the SEARCHED rows, and a count under one counts them (#22790:
   * `findData`'s paged `total`): the same cross-field `$or`, resolved from the
   * same server-side searchable set, `internal: true` exclusion and
   * `searchFields` narrowing, ANDed with `where` exactly as on `find` — before
   * the security middlewares run, so an injected RLS predicate composes with it
   * the same way on every verb.
   *
   * The expansion runs on a carrier AST holding only the three keys it reads,
   * and the result is a COPY of `query` with `where` replaced and the two
   * search keys gone: the bag belongs to the caller (view metadata and flow
   * node config are reused), and a search key left on it would ride to
   * `opCtx.options` unexpanded. The common path — no search key — returns the
   * same reference and allocates nothing.
   */
  static async expandSearchOnOptions<T extends EngineAggregateOptions | EngineCountOptions>(this: Pick<FindHost, '_registry' | 'expandSearchOnAst'>, object: string, query: T, options: EngineReadOptions | undefined): Promise<T> {
    if (query.search === undefined && query.searchFields === undefined) return query;
    const { search, searchFields, ...rest } = query;
    const carrier = { object, where: rest.where, search, searchFields } as QueryAST;
    await this.expandSearchOnAst(carrier, this._registry.getObject(object), mergeReadContext(query.context, options?.context));
    if (carrier.where === undefined) return rest as T;
    return { ...rest, where: carrier.where } as T;
  }

  /**
   * [commit 74155c735] Fill the author-state defaults the query schemas declare, so the
   * AST handed to middlewares, hooks and drivers is the PARSED state
   * `QueryAST` (a `z.infer` type) promises.
   *
   * ADR-0122 made `EngineQueryOptions` the author state (`z.input`): a key
   * with a declared `.default()` is optional to write. `find`/`findOne` kept
   * demanding the parsed state anyway (commit 53068c130 pinned them back) because the
   * engine built its AST by bare spread and filled no default — `order:
   * undefined` would have ridden straight to the driver. This is the filling.
   * Each defaulting node is run through ITS OWN schema rather than
   * hand-assigning values, so a default declared in `packages/spec` stays the
   * single source of truth:
   *
   * - `orderBy[]` nodes through `SortNodeSchema` — fills `order: 'asc'`, the
   *   query path's one declared default. Measured before the flip: every
   *   driver already coalesces a missing `order` to `'asc'` (`sql-driver.ts`
   *   `s.order || 'asc'`, `memory-driver.ts`, `mongodb-driver.ts`,
   *   `remote-transport.ts` likewise), so the filled value changes no query's
   *   answer — it makes the AST say what the drivers were already assuming.
   *   Parsing also applies the node's declared strictness to type-BYPASSING
   *   callers: an unknown sort key, or the retired `direction` spelling, is
   *   now refused with the schema's own prescription instead of silently
   *   dropped-or-honored per driver (#4721's defect class) — the same refusal
   *   `normalizeSortNodes` already makes on the wire path.
   * - `expand` values recurse: a nested query is the same authoring surface.
   *   No driver reads `ast.expand` (the engine expands post-fetch), and the
   *   nested read that executes re-enters `find()` — which fills again — so
   *   the recursion keeps the AST's type honest without a cast.
   *
   * `search` is deliberately NOT parsed, though `FullTextSearchSchema` carries
   * three flag defaults (`fuzzy`/`operator`/`highlight`). Two measurements
   * decide it. First, nothing can ever read them off the AST: no executor
   * reads the flags at all (#4286 — the ADR-0061 expansion reads only `query`
   * + `fields`), and {@link expandSearchOnAst} deletes `search` from the AST
   * before middlewares, hooks or the driver see it, so a filled value would be
   * constructed and then discarded unread. Second, parsing would REFUSE input
   * the engine deliberately accepts: the wire path hands this method
   * `search.fields` in the comma-STRING shape (and the `q` spelling) that
   * `resolveSearchFields`/`normalizeSearch` tolerate by design — pinned in
   * `query-expression-conformance.test.ts` — while the schema declares
   * `fields: string[]`. The type-level gap this leaves (author-state `search`
   * inside a `QueryAST`-typed value, until the key is deleted a few lines
   * later) is covered by the same single cast as `expand`, below.
   *
   * `where`/`fields`/`limit`/`offset`/`top` carry no `.default()` or
   * `.transform()` (pinned in `filter.zod.ts`'s own docs) and are not parsed —
   * the cost is one small-object parse per authored sort node / search
   * config, only when the key is present.
   */
  static fillQueryAstDefaults<T extends Pick<QueryInput, 'orderBy' | 'search' | 'expand'>>(this: Pick<FindHost, 'fillQueryAstDefaults'>, query: T): T & Pick<QueryAST, 'orderBy' | 'search'> & { expand?: Record<string, QueryAST> } {
    const out: Record<string, unknown> = { ...query };
    if (Array.isArray(out.orderBy)) {
      out.orderBy = out.orderBy.map((node) => SortNodeSchema.parse(node));
    }
    if (out.expand != null && typeof out.expand === 'object') {
      const expand: Record<string, unknown> = {};
      for (const [field, nested] of Object.entries(out.expand)) {
        expand[field] = this.fillQueryAstDefaults(nested as QueryInput);
      }
      out.expand = expand;
    }
    // The one cast in the flip: `orderBy`/`expand` are rebuilt above; `search`
    // is claimed-but-not-parsed, per the doc — deleted from the AST unread.
    return out as T & Pick<QueryAST, 'orderBy' | 'search'> & { expand?: Record<string, QueryAST> };
  }

  /**
   * Refuse a `findOne` that selects nothing in particular (#4419).
   *
   * The AST reaching here is the CALLER's own intent: aliases folded, unknown
   * keys refused, `search` expanded — but the security/sharing middlewares have
   * not run yet, and that ordering is the point. An injected RLS predicate
   * narrows *which* rows are visible; it does not make "whichever of them comes
   * first" a thing the caller asked for. Judging the post-middleware AST would
   * pass every query on a scoped object and leave the hole open where it is
   * most expensive.
   *
   * "Selects nothing" is read the same way #3896 read an empty sharing
   * criteria: absent, `null`, or `{}` — the three shapes that mean "match every
   * row". This guard closes the one case that is unambiguously
   * match-everything, not everything it cannot prove.
   *
   * [#5158] This comment used to add: "a `where` that is not a plain object (an
   * expression tree) is the DRIVER'S to interpret, and counts as a predicate."
   * That sentence was the engine's blessing of a second filter dialect, and it
   * cost exactly what a blessing costs — `findOne({ where: [] })` counted as a
   * predicate, walked past this guard, and returned an ARBITRARY row: the #4419
   * defect surviving inside #4419's own guard. `FilterArray` is now lowered by
   * {@link lowerWhereFilterArray} at every entry point, so by the time this
   * runs `where` is a `FilterCondition` or nothing. The `Array.isArray` arm
   * below is kept as defence in depth for a subclass or a future caller that
   * reaches this method without lowering — it is no longer a contract.
   *
   * `orderBy` is the other way to be specific, and a legitimate one — "the
   * newest", "the highest priority". It is honored on this path by every
   * driver, so it is a real answer and not a second silent drop.
   */
  static requireFindOnePredicate(object: string, ast: QueryAST): void {
    const where = ast.where as unknown;
    const hasPredicate =
      where != null &&
      (typeof where !== 'object' || Array.isArray(where) || Object.keys(where).length > 0);
    if (hasPredicate) return;
    if (Array.isArray(ast.orderBy) && ast.orderBy.length > 0) return;
    throw new Error(
      `findOne('${object}') selects no particular record: 'where' is absent or empty ` +
      `and the query carries no 'orderBy'. findOne applies limit: 1, so this would return an ` +
      `ARBITRARY row — a real, plausible-looking record unrelated to what was asked for, which ` +
      `no caller's null-check can catch. Pass 'where' (or a 'search' that resolves to ` +
      `one) to select the record; pass 'orderBy' if you mean "the first record in THIS order"; ` +
      `or call find('${object}', { limit: 1 }) if any row will genuinely do.`,
    );
  }

  /** The body of `ObjectQL#find`; the method's docblock there is its contract. */
  static async find(this: Pick<FindHost, '_registry' | 'buildDriverOptions' | 'buildHookApi' | 'buildProvenance' | 'buildSession' | 'buildUser' | 'composeReadableIdsAtBoundary' | 'executeWithMiddleware' | 'expandRelatedRecords' | 'expandSearchOnAst' | 'facade' | 'fillQueryAstDefaults' | 'formulaFaultSink' | 'formulaOptionLabels' | 'getDriver' | 'logger' | 'maskSecretFields' | 'permissionResolution' | 'relatedSchemaOf' | 'reportFindFailure' | 'resolveFileReferences' | 'resolveFormulaPermissions' | 'resolveFormulaRelated' | 'resolveObjectName' | 'resolveWhereTokens' | 'stripSearchCompanionFromRead' | 'triggerHooks'>, object: string, query?: EngineQueryOptions, options?: EngineReadOptions): Promise<any[]> {
    object = this.resolveObjectName(object);
    // Normalize the alias spellings (`filter`→`where`, `top`→`limit`) by the
    // spec's slot table — the driver AST only understands the canonical keys,
    // so an unfolded `{ filter }` would match ALL rows (silent over-grant —
    // surfaced by ADR-0057's sharing/graph read path). Same fold, same
    // conflict rule on every engine entry point (#4346). The wire-only
    // spellings (`sort`/`select`/`skip`/`populate`) are REJECTED instead of
    // folded — a direct call carrying one used to have it silently dropped
    // (#4371, three shipped instances in #4370).
    query = foldEngineOptionAliases(object, 'find', query, ENGINE_QUERY_SLOTS, ENGINE_WIRE_ONLY_SLOTS);
    rejectUnknownEngineOptions(object, 'find', query, ENGINE_FIND_OPTION_KEYS);
    // [#27008] An empty projection is refused, never read as every column.
    assertProjectionNamesAField(object, 'find', query);
    query = lowerWhereFilterArray(object, 'find', query, this._registry.getObject(object), this.relatedSchemaOf);
    this.logger.debug('Find operation starting', { object, query });
    const driver = this.getDriver(object);
    // `object` LAST: the resolved name must win. Spread-first used to let a
    // stray `query.object` overwrite it, splitting the AST's object from the
    // table actually queried (#4371 option-2 survey) — every middleware and
    // hook reading `ast.object` would have been lied to.
    // `context` is dropped HERE rather than `delete`d from the built AST: since
    // ADR-0122 the caller-supplied `context` is the AUTHOR state (every key
    // optional) while `QueryAST` carries the parsed one, so spreading it in and
    // removing it a line later would type the AST with a context it never holds.
    // [commit 74155c735] The rest of the bag is author state too now — the defaults its
    // schemas declare are filled here, before anything downstream reads the AST.
    const { context: _findContext, ...findQuery } = query ?? {};
    const ast: QueryAST = { ...this.fillQueryAstDefaults(findQuery), object };
    // [ADR-0100] A `secret` / `password` column is never a filter or sort key
    // for a non-system caller — judged on the caller's own `where` / `orderBy`
    // / `expand`, before the search term is expanded into `where` and before
    // the middlewares inject their server-authored filters.
    // [internal: true] …and a flagged column is never evaluated for one either,
    // judged first so the refusal is the data door's own (the door asks the
    // same definition before the engine runs).
    rejectInternalFieldEvaluation(object, ast, mergeReadContext(query?.context, options?.context), this.relatedSchemaOf);
    rejectCredentialEvaluation(object, 'find', ast, mergeReadContext(query?.context, options?.context), this.relatedSchemaOf);

    // Plan formula projection: rewrite ast.fields to drop virtual formula
    // names and inject their dependencies, so the driver returns the raw
    // fields needed to compute the formulas after fetch.
    const _findSchema = this._registry.getObject(object);

    await this.expandSearchOnAst(ast, _findSchema, mergeReadContext(query?.context, options?.context));
    // [#7642] The caller's OWN projection, captured before any planning pass
    // rewrites it — the only thing that can answer "did this caller ask for
    // `__search`?". See `stripSearchCompanionFromRead`.
    const _findRequestedFields = Array.isArray(ast.fields) ? [...ast.fields] : undefined;
    // [#7095] Before the projection is planned and before anything is handed to
    // a driver: an ORDER BY this engine cannot materialise is refused, not
    // dropped. `fillQueryAstDefaults` has already normalised `orderBy` into
    // `SortNode[]`, so the names read here are the ones the driver would get.
    assertOrderByIsMaterializable(object, 'find', _findSchema, ast.orderBy);
    // [#7589] The projection's DOTTED leg, judged on the caller's own
    // spellings BEFORE the formula planner rewrites the projection: a dotted
    // entry is structurally unresolvable (no populate step exists — #7601)
    // and is refused loudly instead of riding its head segment into the
    // driver, where the #3821 ladder answered it with EVERY field.
    assertProjectionHasNoDottedPaths(object, 'find', _findSchema, ast.fields);
    const _findFormula = planFormulaProjection(_findSchema, ast.fields);
    // [#26672] …and a file field's owner key — see `withFileOwnerKey`.
    const _findProjection = withFileOwnerKey(_findSchema, ast.fields, _findFormula);
    if (_findProjection.projected) ast.fields = _findProjection.projected;
    // [#22300] The columns that widening added, cut back off the answer at the
    // `return` — see `withoutFormulaWidening`.
    const _findWidened = _findProjection.widened ? new Set(_findProjection.widened) : undefined;

    // Drop any requested PLAIN field that doesn't exist on the schema.
    // Without this, drivers (notably SqlDriver) emit `SELECT unknown_col
    // FROM ...` which the DB rejects ("no such column") — and SqlDriver
    // swallows that error and returns `[]`, making a frontend bug (e.g. a
    // generic view requesting `name`/`due_date` on every object) look like
    // "no records exist". Silently filtering matches the existing OData
    // tolerance and Salesforce/Postgres behavior of `SELECT *` semantics.
    //
    // [#7589] This tolerance is for unknown PLAIN columns ONLY, and it is
    // KEPT deliberately (ruled 2026-08-12): the "no records exist" failure it
    // prevents is real, and the driver-side half of the same tolerance
    // backstops registry-less hosts. A structurally unresolvable (dotted)
    // projection is a different fact and no longer reaches this filter via
    // the engine — `assertProjectionHasNoDottedPaths` above refused it.
    if (_findSchema?.fields && Array.isArray(ast.fields) && ast.fields.length > 0) {
      // Always allow the primary key + audit columns even if not present in
      // schema.fields. Without this, callers requesting `select=id,name`
      // silently get the `id` projected away, breaking record navigation.
      // [#21571] The same three the default projection and the write door
      // admit — `PLATFORM_PROVISIONED_COLUMNS`, one list.
      const known = new Set<string>([...Object.keys(_findSchema.fields), ...PLATFORM_PROVISIONED_COLUMNS]);
      // Whole names, no head-splitting: only plain entries reach here (the
      // dotted refusal above fired on anything carrying a '.').
      const filtered = ast.fields.filter(f => known.has(f));
      // [#27165] Nothing left is an empty projection, refused as `fields: []`
      // is — never read as every column.
      if (filtered.length === 0) refuseProjectionOfUnknownColumns(object, 'find', ast.fields);
      ast.fields = filtered;
    }

    const opCtx: OperationContext = {
      object,
      operation: 'find',
      ast,
      options: query,
      context: mergeReadContext(query?.context, options?.context),
    };
    // [ADR-0053 D-D1, amended — #5930] Resolve, then lower (the shared
    // lowering), against the object's declared field types.
    await this.resolveWhereTokens(opCtx.ast as QueryAST, opCtx.context, declaredDatetimeLowering(_findSchema), 'where', 'find');

    await this.executeWithMiddleware(opCtx, async () => {
      const hookContext: HookContext = {
          object,
          event: 'beforeFind',
          input: { ast: opCtx.ast, options: opCtx.options },
          session: this.buildSession(opCtx.context),
          provenance: this.buildProvenance(opCtx.context),
          user: this.buildUser(opCtx.context),
          api: this.buildHookApi(opCtx.context),
          transaction: opCtx.context?.transaction,
          ql: this.facade
      };
      await this.triggerHooks('beforeFind', hookContext);
      // The driver is handed `driverOptions` — the declared driver options and
      // nothing else; `input.options` stays the hooks' additive view of the bag.
      const driverOptions = this.buildDriverOptions(object, opCtx.context, hookContext.input.options as any, { recordedVerdict: opCtx.tenantLayer0Verdict });
      hookContext.input.options = mergeDriverOptionsIntoHookView(hookContext.input.options, driverOptions);
      // [ADR-0139 D2] The executor boundary: the AST is final here — after the
      // doors, the middleware chain and `beforeFind` — so every `ReadableIds`
      // leaf is composed (or refused) on it, immediately before the driver.
      const driverAst = await this.composeReadableIdsAtBoundary(object, 'find', hookContext.input.ast as QueryAST, opCtx.context);

      try {
          let result = await driver.find(object, driverAst, driverOptions);

          // [#21571] The read's default projection is the DECLARED field set:
          // a column no metadata declares (a field retired in an upgrade,
          // whose column additive sync leaves behind) never leaves the engine.
          // Shaped here, on the rows as the driver returned them, so it holds
          // whichever driver answered and whichever rung of a driver's
          // recovery ladder answered (driver-sql retries `select('*')` when a
          // projected statement names a missing column) — and before formulas,
          // `expand`, file references and the hooks, so all of them see the
          // declared record. See `declared-read-columns.ts`.
          if (Array.isArray(result)) {
            result = rowsWithDeclaredColumnsOnly(result, declaredColumnSet(_findSchema));
            // [#29408] …and answered on every stored declared column the read
            // SELECTED: one the driver returned no key for (a driver that
            // stores only written columns) is `null`, as driver-sql's column
            // answers — the row's persisted state is in hand. Unselected,
            // formula and FLS-refused columns stay absent; see
            // `selectedStoredColumns`.
            result = rowsWithSelectedColumnsAnswered(result, selectedStoredColumns(_findSchema, driverAst?.fields));
          }

          // Post-process: evaluate formula virtual fields against the raw rows.
          // [#20082] With the caller's permission map when a formula calls
          // `can` — one resolution for the whole result set, never per row.
          if (Array.isArray(result)) {
            applyFormulaPlan(_findFormula.plan, result, opCtx.context, await this.resolveFormulaPermissions(
              object, _findFormula.plan, result, opCtx.context, this.permissionResolution(opCtx.context),
            ), this.formulaFaultSink(object), await this.resolveFormulaRelated(
              // [#24197] One batched read per reference field for this PAGE —
              // the rows the driver returned, after limit/offset.
              _findSchema, _findFormula.plan, result, opCtx.context, query,
            ), this.formulaOptionLabels(_findSchema, _findFormula.plan, opCtx.context));
          }

          // Post-process: expand related records if expand is requested
          if (ast.expand && Object.keys(ast.expand).length > 0 && Array.isArray(result)) {
            result = await this.expandRelatedRecords(object, result, ast.expand, 0, opCtx.context);
          }

          // Post-process: resolve file-field id references to their expanded
          // read form (ADR-0104 D3), one of three: the FileValueSchema file
          // object, the bare id when nothing resolves it, or
          // FileRefusedValueSchema's `{ id, metadataRefused: true }` when this
          // caller is refused the `sys_file` read. Always-on but free unless a
          // file field holds an id string; dual-mode-safe (blobs pass through).
          if (Array.isArray(result)) {
            result = await this.resolveFileReferences(object, result, opCtx.context);
          }

          hookContext.event = 'afterFind';
          hookContext.result = result;
          await this.triggerHooks('afterFind', hookContext);

          // [#15823] `find()` GUARANTEES the array, so the one seam that can
          // break the declaration is closed here. An `afterFind` handler may
          // SHAPE a read — mutate rows, drop keys, filter rows out, assign a
          // different ARRAY — but replacing the container is a hook-contract
          // violation, refused loudly rather than returned as an envelope a
          // caller's `Promise<any[]>` says cannot occur (ruled 2026-09-06).
          //
          // ⛔ Placement is load-bearing and not the `return`: `maskSecretFields`
          // and `stripSearchCompanionFromRead` below BOTH assume the array and
          // both run on `hookContext.result`, so the check has to precede them —
          // otherwise the first consumer to walk a replaced container is the
          // one that reports the problem, from the wrong place.
          if (!Array.isArray(hookContext.result)) {
            throw new FindHookResultNotArrayError({
              object,
              event: 'afterFind',
              result: hookContext.result,
            });
          }

          // Never let secret-field plaintext (or its ref) leave through the
          // generic read path — mask after hooks run. Privileged consumers use
          // resolveSecret() against the stored ref instead.
          this.maskSecretFields(object, hookContext.result);

          // [#7642] …and never let the hidden `__search` companion column out
          // through the default projection either. After the hooks, for the
          // same reason the mask is: a server-side `afterFind` handler is not
          // the client this column is hidden from.
          this.stripSearchCompanionFromRead(hookContext.result, _findRequestedFields, opCtx.context);

          return hookContext.result;
      } catch (e) {
          this.reportFindFailure(object, e);
          throw e;
      }
    });

    // [#22300] The formula widening is cut back off the answer here, after the
    // middleware chain — every internal consumer above read the full row.
    return rowsWithoutFormulaWidening(opCtx.result as any[], _findWidened);
  }

  /**
   * Report a failed {@link find} at the level its CAUSE earns — then leave the
   * throw exactly where it was.
   *
   * ## The two facts this frame used to merge
   *
   * "The table has not been created yet" and "the read failed" are different
   * facts, and until commit 3a86a65e7 this line reported both at `error`, with a stack.
   * The first one is the ordinary state of a database nobody has migrated yet,
   * and every caller on that path already treats it as a normal answer and says
   * so in its own code: {@link readMigrationFlagVerified} ("an unreadable table
   * … → false"), `ObjectQLPlugin.readAuthoredHookRows` /
   * `readAuthoredActionRows` (report `authoredRows: 0` and carry on),
   * `readAuthoredTranslationLayer`, and `ObjectStoreActionActivationStore.probe`
   * (whose caller already follows this frame with a `warn` stating the
   * consequence in operator terms).
   *
   * Measured, on `os migrate plan --database-url file:<an unmigrated db>`: five
   * ERROR records with full stack traces, out of a command that EXITS 0 and
   * prints a correct plan. Four stack traces are the first thing an operator
   * sees when planning a database whose whole point is that it is not migrated
   * yet — and an `error` channel that fires on a routine state is the
   * over-application `sql-driver.ts` already names on a nearby line: it trains
   * everyone to skim `error`.
   *
   * ## ⛔ What this is NOT is a broadened catch
   *
   *   * The throw is UNCHANGED on both branches. No caller's control flow, no
   *     caller's `catch`, and no error envelope moves — this method decides a
   *     log level and nothing else.
   *   * Only the class that positively identifies as "relation does not exist"
   *     is demoted, asked through the shared {@link isMissingTableError}
   *     predicate (`@objectstack/metadata/errors`, #4825) — the same call
   *     {@link probeInstallOrganizations} and {@link resolveFileReferences}
   *     make, never a hand-rolled `code === '42P01'` copy. That predicate earns
   *     a benign verdict rather than defaulting to one: a connection drop, a
   *     timeout, a permission denial, a query fault — and, through its
   *     `excludes`, Postgres' `column "x" of relation "y" does not exist`,
   *     which contains a legal missing-table phrase but is a column fault on a
   *     table that EXISTS — all stay on the loud branch, with the stack (at
   *     `warn`; the last section says why not `error`).
   *   * The fault stays visible without this frame: the driver's own refusal
   *     envelope (`SqlDriver.backendStatementFault` → `logger.warn`) carries
   *     the table, the dialect reason and the compiled statement, and is
   *     untouched here. That is deliberately the surviving loud half, and it is
   *     the half `runtime/src/expected-read-refusal-noise.ts` already documents
   *     as "where this class of fault can still be picked up".
   *
   * `debug` rather than `warn` for exactly that reason: the driver already puts
   * one warn-level line per refusal in front of a reader, so a second would
   * move this noise rather than remove it. What the demotion drops is the
   * duplicate and its stack; the classification survives in the meta.
   *
   * The `debug` demotion is READS only: a write to a table that does not exist
   * is not a normal answer for any caller, and takes the write doors' `warn`
   * like every other write fault does (#17052).
   *
   * ## The loud branch is `warn`, not `error` — the caller is told
   *
   * [#17212] Every cause the predicate does NOT earn a benign verdict for is
   * reported at `warn`, with its message and stack, and `find`'s `catch` then
   * rethrows it — `throw e` is that catch's only exit. That is AGENTS.md's
   * third legal answer (*Degradation log levels*): "a failure handed to the
   * CALLER is not a degradation at all … Do not bolt a `logger.error` onto
   * such a site". The requester IS told — the throw is the answer — so an
   * `error` line is a second, louder report of a fact the caller already has.
   * The write doors moved for the same reason (#17052): their catches rethrow
   * too.
   *
   * ⛔ Demoted, not deleted — only the level moved. The message and the stack
   * survive through {@link writeFailureLogMeta}: `warn(message, meta?)` has no
   * `Error` slot, and an Error handed over AS meta serializes to `{}` (its
   * `message`/`stack` are non-enumerable). On the SQL read path the fault is
   * also reported one frame down on the driver's own `warn` —
   * `SqlDriver.backendStatementFault` for every backend fault it measured
   * (connection, timeout and ACL included), `unresolvableFilterColumnRefusal`
   * for an unresolvable WHERE column. The filter COMPILER's refusals
   * (`uncompilableFieldReferenceError` and its siblings) have no driver line:
   * they are raised before the statement runs, as refusals carrying a declared
   * `400` — a rejected request, answered to its caller.
   */
  static reportFindFailure(this: Pick<FindHost, 'logger'>, object: string, error: unknown): void {
    if (isMissingTableError(error, object)) {
      this.logger.debug('Find operation failed', {
        object,
        reason: 'table-not-provisioned',
        error: (error as { message?: unknown } | null | undefined)?.message,
      });
      return;
    }
    // [#17212] `warn`, not `error`: `find`'s `catch` rethrows, so the caller
    // is told — see the docblock's last section.
    this.logger.warn('Find operation failed', writeFailureLogMeta(error, { object }));
  }

  /** The body of `ObjectQL#findOne`; the method's docblock there is its contract. */
  static async findOne(this: Pick<FindHost, '_registry' | 'buildDriverOptions' | 'buildHookApi' | 'buildProvenance' | 'buildSession' | 'buildUser' | 'composeReadableIdsAtBoundary' | 'executeWithMiddleware' | 'expandRelatedRecords' | 'expandSearchOnAst' | 'facade' | 'fillQueryAstDefaults' | 'formulaFaultSink' | 'formulaOptionLabels' | 'getDriver' | 'logger' | 'maskSecretFields' | 'permissionResolution' | 'relatedSchemaOf' | 'requireFindOnePredicate' | 'resolveFileReferences' | 'resolveFormulaPermissions' | 'resolveFormulaRelated' | 'resolveObjectName' | 'resolveWhereTokens' | 'stripSearchCompanionFromRead' | 'triggerHooks'>, objectName: string, query?: EngineQueryOptions, options?: EngineReadOptions): Promise<Record<string, any> | null> {
    objectName = this.resolveObjectName(objectName);
    // Same alias fold as find() (#4346). Without it, `findOne({ filter })`
    // matched the first row of the WHOLE table rather than the predicate.
    // `top` folds into `limit` here too, but findOne is single-row by
    // contract, so the literal `limit: 1` below wins over both spellings.
    // Wire-only spellings are rejected, same as find() (#4371) — `sort`
    // matters here too: findOne({ sort }) means "first row of THIS order".
    query = foldEngineOptionAliases(objectName, 'findOne', query, ENGINE_QUERY_SLOTS, ENGINE_WIRE_ONLY_SLOTS);
    rejectUnknownEngineOptions(objectName, 'findOne', query, ENGINE_FIND_OPTION_KEYS);
    // [#27008] Same refusal as find().
    assertProjectionNamesAField(objectName, 'findOne', query);
    query = lowerWhereFilterArray(objectName, 'findOne', query, this._registry.getObject(objectName), this.relatedSchemaOf);
    this.logger.debug('FindOne operation', { objectName });
    const driver = this.getDriver(objectName);
    // `object` after the spread for the same reason as find(); `limit: 1`
    // last — findOne is single-row by contract.
    // Same reason as find(): the caller's `context` is the author state and the
    // AST carries the parsed one, so it leaves before the AST is typed.
    // [commit 74155c735] And the same default-filling as find(), for the same reason.
    const { context: _findOneContext, ...findOneQuery } = query ?? {};
    const ast: QueryAST = { ...this.fillQueryAstDefaults(findOneQuery), object: objectName, limit: 1 };
    // [ADR-0100] Same internal-field and credential-column refusals as `find`, same position.
    rejectInternalFieldEvaluation(objectName, ast, mergeReadContext(query?.context, options?.context), this.relatedSchemaOf);
    rejectCredentialEvaluation(objectName, 'findOne', ast, mergeReadContext(query?.context, options?.context), this.relatedSchemaOf);

    // Plan formula projection (same as find): rewrite ast.fields so the driver
    // returns the raw dependency fields, then evaluate formulas after fetch.
    const _findOneSchema = this._registry.getObject(objectName);
    // Before the guard below, so a `search` that resolves to a real filter
    // counts as the predicate it is (#4419).
    await this.expandSearchOnAst(ast, _findOneSchema, mergeReadContext(query?.context, options?.context));
    this.requireFindOnePredicate(objectName, ast);
    // [#7095] Same refusal as `find`, and it matters MORE here: `findOne`
    // applies `limit: 1`, so `orderBy` is the whole of "which record" — a
    // dropped sort does not merely reorder the answer, it returns a DIFFERENT
    // record, and the one it returns looks exactly as legitimate.
    assertOrderByIsMaterializable(objectName, 'findOne', _findOneSchema, ast.orderBy);
    // [#7589] Same dotted-projection refusal as `find`, same position: on the
    // caller's own spellings, before the formula planner rewrites them. The
    // measured flow chain (`get_record` → `data.findOne`) reaches THIS verb
    // whenever `limit` is absent or 1, so a hole here would be the same hole.
    assertProjectionHasNoDottedPaths(objectName, 'findOne', _findOneSchema, ast.fields);
    // [#7642] Caller's own projection, before planning rewrites it — see `find`.
    const _findOneRequestedFields = Array.isArray(ast.fields) ? [...ast.fields] : undefined;
    const _findOneFormula = planFormulaProjection(_findOneSchema, ast.fields);
    // [#26672] Same as `find`: a file field's owner key is read too.
    const _findOneProjection = withFileOwnerKey(_findOneSchema, ast.fields, _findOneFormula);
    if (_findOneProjection.projected) ast.fields = _findOneProjection.projected;
    // [#22300] Same as `find`: what the widening added is cut at the `return`.
    const _findOneWidened = _findOneProjection.widened ? new Set(_findOneProjection.widened) : undefined;

    // Drop unknown PLAIN fields — see the equivalent block in `find()` for
    // the rationale, and for why this tolerance is plain-columns-only ([#7589]
    // refused any dotted entry above, so none reaches this filter).
    if (_findOneSchema?.fields && Array.isArray(ast.fields) && ast.fields.length > 0) {
      // Always allow the primary key + audit columns even if not present
      // in schema.fields (matches `find()` behavior, one list).
      const known = new Set<string>([...Object.keys(_findOneSchema.fields), ...PLATFORM_PROVISIONED_COLUMNS]);
      const filtered = ast.fields.filter(f => known.has(f));
      // [#27165] Same refusal as `find`.
      if (filtered.length === 0) refuseProjectionOfUnknownColumns(objectName, 'findOne', ast.fields);
      ast.fields = filtered;
    }

    const opCtx: OperationContext = {
      object: objectName,
      operation: 'findOne',
      ast,
      options: query,
      context: mergeReadContext(query?.context, options?.context),
    };
    // [ADR-0053 D-D1, amended — #5930] Resolve, then lower.
    await this.resolveWhereTokens(opCtx.ast as QueryAST, opCtx.context, declaredDatetimeLowering(_findOneSchema), 'where', 'findOne');

    await this.executeWithMiddleware(opCtx, async () => {
      // [#3195] `findOne` fires the SAME `beforeFind`/`afterFind` hooks as
      // `find` — the read event attaches to record materialization, not to the
      // engine method, so one subscription covers every read shape (there is no
      // separate `beforeFindOne`/`afterFindOne`). Mirrors `find()` above.
      const hookContext: HookContext = {
          object: objectName,
          event: 'beforeFind',
          input: { ast: opCtx.ast, options: opCtx.options },
          session: this.buildSession(opCtx.context),
          provenance: this.buildProvenance(opCtx.context),
          user: this.buildUser(opCtx.context),
          api: this.buildHookApi(opCtx.context),
          transaction: opCtx.context?.transaction,
          ql: this.facade
      };
      await this.triggerHooks('beforeFind', hookContext);
      // The driver is handed `driverOptions` alone, as in `find`.
      const driverOptions = this.buildDriverOptions(objectName, opCtx.context, hookContext.input.options as any, { recordedVerdict: opCtx.tenantLayer0Verdict });
      hookContext.input.options = mergeDriverOptionsIntoHookView(hookContext.input.options, driverOptions);
      // [ADR-0139 D2] The executor boundary, as in `find`.
      const driverAst = await this.composeReadableIdsAtBoundary(objectName, 'findOne', hookContext.input.ast as QueryAST, opCtx.context);

      let result = await driver.findOne(objectName, driverAst, driverOptions);

      // [#21571] Same default projection as `find`, same position: the
      // declared field set, applied to the row as the driver returned it.
      result = withDeclaredColumnsOnly(result, declaredColumnSet(_findOneSchema));
      // [#29408] Same answer on the selected stored columns as `find`.
      result = withSelectedColumnsAnswered(result, selectedStoredColumns(_findOneSchema, driverAst?.fields));

      // Post-process: evaluate formula virtual fields against the raw row
      // ([#20082] with the caller's permission map when a formula calls `can`).
      if (result != null) {
        applyFormulaPlan(_findOneFormula.plan, [result], opCtx.context, await this.resolveFormulaPermissions(
          objectName, _findOneFormula.plan, [result], opCtx.context, this.permissionResolution(opCtx.context),
        ), this.formulaFaultSink(objectName), await this.resolveFormulaRelated(
          _findOneSchema, _findOneFormula.plan, [result], opCtx.context, query,
        ), this.formulaOptionLabels(_findOneSchema, _findOneFormula.plan, opCtx.context));
      }

      // Post-process: expand related records if expand is requested
      if (ast.expand && Object.keys(ast.expand).length > 0 && result != null) {
        const expanded = await this.expandRelatedRecords(objectName, [result], ast.expand, 0, opCtx.context);
        result = expanded[0];
      }

      // Post-process: resolve file-field id references (ADR-0104 D3).
      if (result != null) {
        const resolved = await this.resolveFileReferences(objectName, [result], opCtx.context);
        result = resolved[0];
      }

      hookContext.event = 'afterFind';
      hookContext.result = result;
      await this.triggerHooks('afterFind', hookContext);

      // [#16231] `findOne()` now DECLARES what it answers — the one record the
      // query selects, or `null` — so the seam that can break the declaration
      // is closed here, on the terms #15823 set for `find()`. An `afterFind`
      // handler may SHAPE the record (mutate it, drop keys, assign a different
      // RECORD built from it); replacing it with something that is neither a
      // record nor `null` is a hook-contract violation, refused loudly rather
      // than returned as a value the caller's type says cannot occur.
      //
      // ⛔ Placement is load-bearing and not the `return`, exactly as on
      // `find()`: `maskSecretFields` and `stripSearchCompanionFromRead` below
      // both run on `hookContext.result`, so the check has to precede them —
      // otherwise the first consumer to walk a replaced value is the one that
      // reports the problem, from the wrong place.
      if (!isFindOneResultShape(hookContext.result)) {
        throw new FindOneHookResultNotRecordError({
          object: objectName,
          event: 'afterFind',
          result: hookContext.result,
        });
      }

      // Mask secret fields — plaintext never leaves through the read path.
      this.maskSecretFields(objectName, hookContext.result);
      // [#7642] Hidden `__search` companion — same door, same rule as `find`.
      // This is the `GET /data/:object/:id` surface (`getData` reads through
      // findOne), one of the four the issue measured.
      this.stripSearchCompanionFromRead(hookContext.result, _findOneRequestedFields, opCtx.context);

      return hookContext.result;
    });

    // [#22300] Same cut as `find`, same position: after the middleware chain.
    return withoutFormulaWidening(opCtx.result, _findOneWidened);
  }
}
