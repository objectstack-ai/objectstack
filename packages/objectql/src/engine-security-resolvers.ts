// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29986 codemod] The
 * "Registration seams, readable-ids security, formula and default permissions"
 * section of `ObjectQL`: the bodies of `registerHeldFileResolver`,
 * `registerFieldOwnedFileReadAuthorizer`, `registerWriteGateProbe`,
 * `registerWriteWallVerdict`, `registerEffectiveObjectPermissionsResolver`,
 * `registerInsertRecomputeListener`, `resolveReadableIdsSecurity`,
 * `composeReadableIdsAtBoundary`, `refuseUncomposableReadableIdsClasses`,
 * `uncomposableReadableIdsParent`, `resolveFormulaRelated`,
 * `serveFormulaField`, `formulaOptionLabels`, `formulaFaultSink` moved out of
 * `engine.ts` whole by `scripts/codemod-split-engine.mjs`.
 *
 * A MOVE, not a redesign. {@link SecurityResolversFacet} is a stateless facet of `ObjectQL`
 * (ruling 6624345766): each static method of it is the body of the `ObjectQL`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class as a one-call stub with
 * its signature, so the published surface, an instance spy and a subclass
 * override are what they were. A public or protected method keeps its
 * docblock on the class, the contract; a private method's docblock moved here
 * with its body. The state stays on `ObjectQL`.
 *
 * The bodies reach the class through {@link SecurityResolversHost}: exactly the
 * `ObjectQL` members they read, private ones included. Every stub hands its
 * body, by a `.call`, the same host: `securityResolversHost` in
 * `engine-facet-hosts.ts`, built once per engine by the class's static block.
 * Methods go as closures that call them on the engine at call time, so a
 * subclass override or an instance spy is still the one reached; fields and
 * accessors go as GETTERS, read when the body reads them, as they were on the
 * class, and a field a body assigns goes with a SETTER that assigns it on the
 * engine.
 *
 * The module imports `engine.ts` for types only, so the two modules form no
 * evaluation cycle. `index.ts` re-exports nothing from this module.
 */

import { referenceTargetOf } from '@objectstack/spec/data';
import type { EngineQueryOptions, QueryAST } from '@objectstack/spec/data';
import { collectComposableReadableIds, describeReadableIdsLeaf, readableIdsRefusalError } from './filter-comparand-shape.js';
import type { ComposableReadableIdsSite } from './filter-comparand-shape.js';
import { isStoredMetadataBodyObject } from '@objectstack/spec/kernel';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { EvalOptionLabels } from '@objectstack/formula';
import { declaredOptionLabels, readerOptionLabels } from './formula-option-labels.js';
import { SECURITY_SERVICE_SOURCE_SLOT, applyFormulaPlan, computeStoredExpressions, planFormulaProjection, planStoredExpressions, undeclaredRelatedFields } from './engine-top-level.js';
import type {
  FieldOwnedFileReadAuthorizer, FormulaFaultSink, FormulaPlanEntry, FormulaRelated, HeldFileResolver,
  ReadableIdsChain, ReadableIdsSecurity, ReadableIdsSecurityResolution, WriteWallVerdict,
} from './engine-top-level.js';
import type { ObjectQL } from './engine.js';

/**
 * The `ObjectQL` members the bodies of {@link SecurityResolversFacet} read — every one of
 * them, and no other. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too. `readonly` members are the getters; the others are fields a body
 * assigns.
 */
export interface SecurityResolversHost {
  _effectiveObjectPermissionsResolver: ObjectQL['_effectiveObjectPermissionsResolver'];
  _fieldOwnedFileReadAuthorizer: ObjectQL['_fieldOwnedFileReadAuthorizer'];
  _heldFileResolver: ObjectQL['_heldFileResolver'];
  readonly _registry: ObjectQL['_registry'];
  _writeGateProbe: ObjectQL['_writeGateProbe'];
  _writeWallVerdict: ObjectQL['_writeWallVerdict'];
  composeReadableIdsChain: ObjectQL['composeReadableIdsChain'];
  /** The engine itself: a moved body reads `this.facade` where the method read a bare `this` (#30020). */
  readonly facade: ObjectQL;
  formulaFaultSink: ObjectQL['formulaFaultSink'];
  readonly formulaHopReads: ObjectQL['formulaHopReads'];
  formulaOptionLabels: ObjectQL['formulaOptionLabels'];
  hasObjectMiddleware: ObjectQL['hasObjectMiddleware'];
  readonly i18nService: ObjectQL['i18nService'];
  readonly insertRecomputeListeners: ObjectQL['insertRecomputeListeners'];
  readonly logger: ObjectQL['logger'];
  permissionResolution: ObjectQL['permissionResolution'];
  readonly readableIdsSecurityReported: ObjectQL['readableIdsSecurityReported'];
  reportFormulaFault: ObjectQL['reportFormulaFault'];
  resolveDatasourceBinding: ObjectQL['resolveDatasourceBinding'];
  resolveFormulaPermissions: ObjectQL['resolveFormulaPermissions'];
  resolveFormulaRelated: ObjectQL['resolveFormulaRelated'];
  resolveOneHopRelated: ObjectQL['resolveOneHopRelated'];
  resolveReadableIdsSecurity: ObjectQL['resolveReadableIdsSecurity'];
  uncomposableReadableIdsParent: ObjectQL['uncomposableReadableIdsParent'];
}

/** The bodies of the "Registration seams, readable-ids security, formula and default permissions" section of `ObjectQL`: a stateless facet, called by the class's stubs. */
export class SecurityResolversFacet {
  /** The body of `ObjectQL#registerHeldFileResolver`; the method's docblock there is its contract. */
  static registerHeldFileResolver(this: Pick<SecurityResolversHost, '_heldFileResolver' | 'logger'>, fn: HeldFileResolver): void {
    this._heldFileResolver = fn;
    this.logger.debug('Registered held-file resolver for sys_file hydration');
  }

  /** The body of `ObjectQL#registerFieldOwnedFileReadAuthorizer`; the method's docblock there is its contract. */
  static registerFieldOwnedFileReadAuthorizer(this: Pick<SecurityResolversHost, '_fieldOwnedFileReadAuthorizer' | 'logger'>, fn: FieldOwnedFileReadAuthorizer): void {
    this._fieldOwnedFileReadAuthorizer = fn;
    this.logger.debug('Registered field-owned file read authorizer for refused sys_file hydration');
  }

  /** The body of `ObjectQL#registerWriteGateProbe`; the method's docblock there is its contract. */
  static registerWriteGateProbe(this: Pick<SecurityResolversHost, '_writeGateProbe' | 'logger'>, fn: (
      object: string,
      operation: 'insert' | 'update',
      context: unknown,
      data: unknown,
    ) => Promise<boolean>): void {
    this._writeGateProbe = fn;
    this.logger.debug('Registered write-gate probe for validate() relationship resolution');
  }

  /** The body of `ObjectQL#registerWriteWallVerdict`; the method's docblock there is its contract. */
  static registerWriteWallVerdict(this: Pick<SecurityResolversHost, '_writeWallVerdict' | 'logger'>, fn: WriteWallVerdict): void {
    this._writeWallVerdict = fn;
    this.logger.debug('Registered write-wall verdict for validate() organization judgement');
  }

  /** The body of `ObjectQL#registerEffectiveObjectPermissionsResolver`; the method's docblock there is its contract. */
  static registerEffectiveObjectPermissionsResolver(this: Pick<SecurityResolversHost, '_effectiveObjectPermissionsResolver' | 'logger'>, fn: (context: unknown) => Promise<unknown>): void {
    this._effectiveObjectPermissionsResolver = fn;
    this.logger.debug('Registered effective object-permission resolver for current_user.can()');
  }

  /** The body of `ObjectQL#registerInsertRecomputeListener`; the method's docblock there is its contract. */
  static registerInsertRecomputeListener(this: Pick<SecurityResolversHost, 'insertRecomputeListeners' | 'logger'>, id: string, fn: (event: { object: string; row: Record<string, unknown>; fields: string[] }) => void | Promise<void>): void {
    this.insertRecomputeListeners.set(id, fn);
    this.logger.debug('Registered insert recompute listener', { id });
  }

  /**
   * [ADR-0139 D2] The three resolutions of the `security` service, kept apart
   * because they are logged apart — and answered alike: only `usable` is
   * asked anything.
   *
   *  - **absent** — no source is in the engine slot, or it answered nothing;
   *  - **unusable** — the slot holds something that is not a function, the
   *    source threw (the in-repo kernels throw on a name nothing registered),
   *    or the service exposes no `getReadFilter`, or neither `canReadObject`
   *    nor `explain`;
   *  - **usable** — ask it.
   */
  static resolveReadableIdsSecurity(this: Pick<SecurityResolversHost, 'facade'>): ReadableIdsSecurityResolution {
    // Read from the engine slot at use (see SECURITY_SERVICE_SOURCE_SLOT), never cached.
    const source = (this.facade as unknown as Record<symbol, unknown>)[SECURITY_SERVICE_SOURCE_SLOT];
    if (source === undefined || source === null) return { kind: 'absent' };
    if (typeof source !== 'function') {
      return { kind: 'unusable', why: `the security-service source slot holds ${Array.isArray(source) ? 'an array' : `a ${typeof source}`}, not a function` };
    }
    let svc: unknown;
    try {
      svc = source();
    } catch (e) {
      return { kind: 'unusable', why: `resolving the "security" service threw (${String((e as Error)?.message ?? e)})` };
    }
    if (svc === undefined || svc === null) return { kind: 'absent' };
    const candidate = svc as Partial<ReadableIdsSecurity>;
    if (typeof candidate.getReadFilter !== 'function') {
      return { kind: 'unusable', why: 'the registered "security" service exposes no getReadFilter()' };
    }
    if (typeof candidate.canReadObject !== 'function' && typeof candidate.explain !== 'function') {
      return { kind: 'unusable', why: 'the registered "security" service exposes neither canReadObject() nor explain()' };
    }
    return { kind: 'usable', svc: candidate as ReadableIdsSecurity };
  }

  /**
   * [ADR-0139 D2, D5] The executor boundary: every `ReadableIds` leaf in the
   * FINAL `where` of a read is replaced by its composed form immediately
   * before the driver call — after the comparand doors, the middleware chain
   * and the before-hooks, so a leaf the caller, a middleware or a hook wrote
   * meets the same composition. Returns `ast` by reference when it holds no
   * leaf, which is every read today; otherwise a shallow copy whose `where` is
   * rewritten copy-on-write (the hooks' `input.ast` is never edited).
   *
   * Per parent object `P`, once per call, in this order:
   *
   *  1. **D5's two remaining classes are refused, by name** (`INTERNAL_ERROR`
   *     / 500), before the security service is asked anything: a parent an
   *     object-scoped read middleware narrows ({@link hasObjectMiddleware}); a
   *     parent bound to another datasource than `object`
   *     ({@link resolveDatasourceBinding}).
   *  2. **A parent the registry does not hold** ⇒ `$in: []`, unasked.
   *  3. **The security service** — absent or unusable ⇒ `$in: []`.
   *  4. **`canReadObject(P)`** (its `explain` fallback when the method is
   *     absent) — false or a throw ⇒ `$in: []`.
   *  5. **`getReadFilter(P)`** — `undefined` ⇒ composed, no row restriction;
   *     the deny sentinel `RLS_DENY_FILTER`, by identity, or a throw ⇒
   *     `$in: []`; any other filter ⇒ composed with it as the scope, marked
   *     `'policy'` and otherwise passed exactly as `P`'s own read passes its
   *     injected scope. The tenant wall is the driver's (D3).
   *
   * [ADR-0139 D5.1, as amended] A **delegated (on-behalf-of) caller** is
   * composed, not refused: both halves are asked with the caller's context
   * exactly as it stands — `onBehalfOf` intact — and the security service
   * answers each half for the delegated principal, which under ADR-0090 D10
   * is the INTERSECTION of the principal's leg and the delegator's. The
   * engine composes what it is answered and derives no second intersection
   * of its own: it has one context, the delegated one, and the delegator's
   * grants are the security service's to resolve. A service that cannot
   * answer that context answers the deny sentinel, and step 5 turns it into
   * `$in: []`, closed.
   *
   * [ADR-0139 D6, as amended — the nested master chain] A scope the service
   * answers in step 5 may itself carry a leaf: a parent whose own read scope
   * is derived from ITS master (a `controlled_by_parent` detail whose master
   * is `controlled_by_parent` too) is scoped `{ master_fk: { $in:
   * ReadableIds.of(G) } }`, and a leaf handed to a driver uncomposed is
   * refused there (D3), never read as "no restriction". So every leaf a
   * composed scope carries is composed the same way, BEFORE the leaf that
   * encloses it — the same five steps, the same caller context at every level,
   * recursively ({@link composeReadableIdsChain}). The driver then receives one
   * composed leaf whose scope holds composed leaves, and compiles one statement
   * with the subqueries nested. Each parent is asked once per read, at
   * whichever level it first appears; a chain that returns to a parent already
   * on its branch, or runs deeper than {@link READABLE_IDS_MAX_CHAIN_DEPTH}
   * scopes, is refused by name (D5's envelope), not composed partway.
   *
   * Nothing is memoised across calls. `aggregate`'s `having` and its
   * aggregations' own filters are judged here too, so a leaf a middleware
   * wrote there is refused rather than evaluated in memory.
   */
  static async composeReadableIdsAtBoundary<A extends QueryAST>(this: Pick<SecurityResolversHost, 'composeReadableIdsChain' | 'logger' | 'readableIdsSecurityReported' | 'resolveReadableIdsSecurity'>, object: string, operation: 'find' | 'findOne' | 'count' | 'aggregate', ast: A, context: ExecutionContext | undefined): Promise<A> {
    if (operation === 'aggregate') {
      collectComposableReadableIds(object, operation, ast.having, 'having');
      const aggregations = Array.isArray(ast.aggregations) ? ast.aggregations : [];
      aggregations.forEach((agg, i) => {
        collectComposableReadableIds(object, operation, (agg as { filter?: unknown } | undefined)?.filter, `aggregations[${i}].filter`);
      });
    }
    const sites = collectComposableReadableIds(object, operation, ast.where, 'where');
    if (sites.length === 0) return ast;

    const security = this.resolveReadableIdsSecurity();
    if (security.kind !== 'usable' && !this.readableIdsSecurityReported.has(security.kind)) {
      this.readableIdsSecurityReported.add(security.kind);
      this.logger.warn(
        `[ObjectQL] ${operation}('${object}') composes a ReadableIds leaf with no usable "security" service ` +
        `(${security.kind === 'absent' ? 'none is registered' : security.why}): every such leaf is answered ` +
        '$in: [], no row of its parent, fail-closed. Register a security service for the leaf to serve rows. ' +
        'Reported once for this engine; later leaves are answered the same way.',
      );
    }
    const chain: ReadableIdsChain = { object, operation, security, context, answers: new Map() };
    const where = await this.composeReadableIdsChain(chain, ast.where, sites, []);
    return { ...ast, where };
  }

  /**
   * [ADR-0139 D5] Refuse D5's two remaining classes (D5.2 and D5.3), by name,
   * and return the distinct parent objects of `sites` the security service is
   * asked about, in walk order (every one but a parent the registry does not
   * hold). Reads the registry and the middleware registrations only — no
   * security call, and no reading of the caller's context: a delegated
   * (on-behalf-of) caller is no longer a class of its own (D5.1, as amended),
   * it is composed like any other through the security service's answers.
   */
  static refuseUncomposableReadableIdsClasses(this: Pick<SecurityResolversHost, '_registry' | 'uncomposableReadableIdsParent'>, object: string, operation: string, sites: readonly ComposableReadableIdsSite[]): string[] {
    const firstSite = new Map<string, ComposableReadableIdsSite>();
    for (const site of sites) if (!firstSite.has(site.leaf.object)) firstSite.set(site.leaf.object, site);
    const refuse = (site: ComposableReadableIdsSite, why: string): Error => readableIdsRefusalError(
      object,
      `${operation}('${object}'): ${describeReadableIdsLeaf(site.at, site.leaf)}, and the engine composes no ` +
      `such leaf ${why}. The query was NOT run and no driver was asked. Read this class through its bounded ` +
      'probe, chosen before the leaf is written.',
    );
    const composable: string[] = [];
    for (const [parent, site] of firstSite) {
      // A parent the registry does not hold has no record anyone may read:
      // its leaf is answered `$in: []` without asking anything, and it is in
      // none of D5's classes.
      if (!this._registry.getObject(parent)) continue;
      const uncomposable = this.uncomposableReadableIdsParent(object, parent);
      if (uncomposable?.class === 'object-scoped-read-middleware') {
        throw refuse(site, `over '${parent}', whose rows an object-scoped read middleware narrows: that WHERE is ` +
          `built at read time and is no part of its read scope, so the composed leaf would be wider than a read of '${parent}'`);
      }
      if (uncomposable?.class === 'other-datasource') {
        throw refuse(site, `over '${parent}', which is bound to datasource '${String(uncomposable.parentDatasource)}' while '${object}' is ` +
          `bound to '${String(uncomposable.objectDatasource)}': no driver evaluates a subquery across two datasources`);
      }
      composable.push(parent);
    }
    return composable;
  }

  /**
   * [ADR-0139 D5.2 / D5.3] Which of D5's two remaining classes a leaf over
   * `parent` in a read of `object` falls in, or `undefined` when it falls in
   * neither — the ONE predicate behind both the read-time refusal
   * ({@link refuseUncomposableReadableIdsClasses}) and the boot-time refusal of
   * a `controlled_by_parent` detail over such a master
   * ({@link findUnservableControlledByParentMasters}), so the two rules cannot
   * drift. D5.2 is judged first, as the read path always has.
   */
  static uncomposableReadableIdsParent(this: Pick<SecurityResolversHost, 'hasObjectMiddleware' | 'resolveDatasourceBinding'>, object: string, parent: string): | { class: 'object-scoped-read-middleware' }
    | { class: 'other-datasource'; objectDatasource: string | undefined; parentDatasource: string | undefined }
    | undefined {
    if (this.hasObjectMiddleware(parent)) return { class: 'object-scoped-read-middleware' };
    const objectDatasource = this.resolveDatasourceBinding(object)?.datasource;
    const parentDatasource = this.resolveDatasourceBinding(parent)?.datasource;
    if (parentDatasource !== objectDatasource) return { class: 'other-datasource', objectDatasource, parentDatasource };
    return undefined;
  }

  /**
   * [#24197] The related rows a formula plan reads ONE hop through a
   * reference field, resolved for a whole page of `rows` at once — the
   * formula half of {@link resolveOneHopRelated}, read under the CALLER's
   * own authority.
   *
   * ## What it costs
   *
   * Nothing for a plan that traverses nothing (no query, no closure). For one
   * that does: one batched read per reference field per call — per PAGE of a
   * `find` (the rows the driver returned, after `limit` / `offset`), per row of
   * a `findOne`, per write response — never one per row. A formula whose
   * traversal cannot be served (`hopConflict`) asks for nothing.
   *
   * ## One hop, and only one
   *
   * A `find` that IS a hop read ({@link formulaHopReads}) serves no hop of its
   * own: the related object's own formulas over its own columns are computed,
   * one that reads through a reference of ITS own reads `null` and says so.
   * That is the declared depth (a second hop is not loaded — the lint refuses
   * one written out, this refuses one reached through a formula), and it is
   * what keeps two objects whose titles read each other from recursing.
   */
  static async resolveFormulaRelated(this: Pick<SecurityResolversHost, '_registry' | 'formulaHopReads' | 'resolveOneHopRelated'>, schema: any, plan: readonly FormulaPlanEntry[], rows: ReadonlyArray<Record<string, unknown> | undefined | null>, context: unknown, query?: EngineQueryOptions): Promise<FormulaRelated | undefined> {
    const wanted = new Map<string, Set<string>>();
    for (const entry of plan) {
      if (entry.hopConflict) continue;
      for (const [fk, named] of entry.hops ?? []) {
        let set = wanted.get(fk);
        if (!set) wanted.set(fk, (set = new Set()));
        for (const name of named) set.add(name);
      }
    }
    if (wanted.size === 0) return undefined;
    if (query && this.formulaHopReads.has(query)) {
      return `this object was itself read one hop through a reference by another object's formula, and a `
        + 'formula resolves ONE hop: a formula read this way does not read through a reference of its own '
        + '(a second hop). Store the value on this object as a field of its own to read it from there';
    }
    // [#24410] The read set per reference is the UNION of every formula's
    // columns, and the loader answers a whole reference `undeclared-field` when
    // any column of it is undeclared — so one formula's misspelt column nulled
    // every sibling reading through the same reference. The undeclared columns
    // are taken out of the shared read here and judged per formula
    // ({@link formulaHopScope}); the loader reads the declared rest.
    const fields = (schema?.fields ?? {}) as Record<string, unknown>;
    const undeclared = new Map<string, { object: string; fields: ReadonlySet<string> }>();
    for (const [fk, named] of wanted) {
      const target = referenceTargetOf(fields[fk]);
      // The loader's own verdicts stand for these: no target, or a hop into
      // the stored-metadata-body family, which is never read.
      if (!target || isStoredMetadataBodyObject(target)) continue;
      const declared = (this._registry.getObject(target) as { fields?: Record<string, unknown> } | undefined)?.fields;
      const missing = undeclaredRelatedFields(declared, named);
      if (missing.length === 0) continue;
      undeclared.set(fk, { object: target, fields: new Set(missing) });
      for (const name of missing) named.delete(name);
      if (named.size === 0) wanted.delete(fk);
    }
    const lookup = wanted.size > 0
      ? await this.resolveOneHopRelated(schema, wanted, rows, context, 'caller')
      : () => undefined;
    return { bindings: (row) => lookup(row), undeclared };
  }

  /** The body of `ObjectQL#serveFormulaField`; the method's docblock there is its contract. */
  static async serveFormulaField(this: Pick<SecurityResolversHost, '_registry' | 'formulaFaultSink' | 'formulaOptionLabels' | 'permissionResolution' | 'resolveFormulaPermissions' | 'resolveFormulaRelated'>, objectName: string, record: Record<string, unknown>, field: string, context?: ExecutionContext): Promise<unknown> {
    const schema = this._registry.getObject(objectName);
    const { plan } = planFormulaProjection(schema, [field]);
    if (plan.length === 0) return undefined;
    const scratch: Record<string, unknown> = { ...record };
    applyFormulaPlan(plan, [scratch], context, await this.resolveFormulaPermissions(
      objectName, plan, [scratch], context, this.permissionResolution(context),
    ), this.formulaFaultSink(objectName), await this.resolveFormulaRelated(schema, plan, [scratch], context),
    this.formulaOptionLabels(schema, plan, context));
    return scratch[field];
  }

  /** The body of `ObjectQL#computeStoredExpressionsOver` (#29961); the method's docblock there is its contract. */
  static async computeStoredExpressionsOver(this: Pick<SecurityResolversHost, '_registry' | 'formulaFaultSink' | 'permissionResolution' | 'resolveFormulaPermissions' | 'resolveFormulaRelated'>, object: string, rows: ReadonlyArray<Record<string, unknown>>, context?: ExecutionContext, onFault?: (field: string, message: string) => void): Promise<Array<Record<string, unknown>>> {
    const schema = this._registry.getObject(object);
    const resolution = this.permissionResolution(context);
    return computeStoredExpressions(planStoredExpressions(schema), rows, context, {
      permissionsFor: (plan, records) => this.resolveFormulaPermissions(object, plan, records, context, resolution),
      onFault: onFault ? (field, error) => onFault(field, error.message) : this.formulaFaultSink(object),
      relatedFor: (plan, records) => this.resolveFormulaRelated(schema, plan, records, context),
      optionLabelsFor: (plan) => declaredOptionLabels(schema, plan),
    });
  }

  /**
   * [#26608] The option labels `label(record.<field>)` reads on a read or a
   * write response of `schema`'s object: in the reader's locale
   * (`ExecutionContext.locale`, which the request's `Accept-Language` sets),
   * translated through the bridged i18n service as `GET /meta/object/:name`
   * serves the object to the same reader — see {@link readerOptionLabels}.
   * `undefined` when no formula of `plan` calls `label()`.
   */
  static formulaOptionLabels(this: Pick<SecurityResolversHost, 'i18nService'>, schema: unknown, plan: FormulaPlanEntry[], context: { locale?: string } | undefined): EvalOptionLabels | undefined {
    return readerOptionLabels(schema, plan, context?.locale, this.i18nService);
  }

  /**
   * [#22019] The sink a read or a write response of `object` hands to
   * {@link applyFormulaPlan}, bound to the object so a report names the pair.
   */
  static formulaFaultSink(this: Pick<SecurityResolversHost, 'reportFormulaFault'>, object: string): FormulaFaultSink {
    return (field, error) => this.reportFormulaFault(object, field, error);
  }
}
