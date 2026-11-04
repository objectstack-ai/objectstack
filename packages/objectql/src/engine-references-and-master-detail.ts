// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29986 codemod] The
 * "Realtime, i18n, home amounts, validation messages, references, master-detail"
 * section of `ObjectQL`: the bodies of `setRealtimeService`, `setI18nService`,
 * `setHomeLocalizationResolver`, `homeAmountOrganizationOf`,
 * `previewHomeAmounts`, `projectHomeAmountsOntoPatch`,
 * `masterDetailHeaderExists`, `materializeParentHeader`,
 * `masterDeclaredFields`, `inspectCascadeDelete`, `getCascadeDeleteObjects`
 * moved out of `engine.ts` whole by `scripts/codemod-split-engine.mjs`.
 *
 * A MOVE, not a redesign. {@link ReferencesAndMasterDetailFacet} is a stateless facet of `ObjectQL`
 * (ruling 6624345766): each static method of it is the body of the `ObjectQL`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class as a one-call stub with
 * its signature, so the published surface, an instance spy and a subclass
 * override are what they were. A public or protected method keeps its
 * docblock on the class, the contract; a private method's docblock moved here
 * with its body. The state stays on `ObjectQL`.
 *
 * The bodies reach the class through {@link ReferencesAndMasterDetailHost}:
 * exactly the `ObjectQL` members they read, private ones included. Every stub
 * hands its body, by a `.call`, the same host: `referencesAndMasterDetailHost`
 * in `engine-facet-hosts.ts`, built once per engine by the class's static
 * block. Methods go as closures that call them on the engine at call time, so a
 * subclass override or an instance spy is still the one reached; fields and
 * accessors go as GETTERS, read when the body reads them, as they were on the
 * class, and a field a body assigns goes with a SETTER that assigns it on the
 * engine.
 *
 * `ObjectQL` here is `ObjectQLStatics` (imported AS `ObjectQL`): forwarders to the
 * statics the bodies read, private ones included, which the class fills in a
 * static block; the class as a type is `ObjectQLClass`.
 *
 * Values that stayed in `engine.ts` are imported from it (lever (a) of
 * ruling 6591753301); every use is inside a function body, so the import
 * cycle is never read at evaluation time. `index.ts` re-exports nothing from
 * this module.
 */

import type { IRealtimeService } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { homeAmountsTouched, planHomeAmounts, projectHomeAmounts } from './home-amount-projection.js';
import type { HomeAmountPlanEntry, HomeAmountServing, HomeLocalizationResolver } from './home-amount-projection.js';
import { materializeDeclaredFields } from './declared-fields.js';
import { collectCascadeDeleteObjects } from './engine-delete-cascade.js';
import { ObjectQLStatics as ObjectQL } from './engine.js';
import type { ObjectQL as ObjectQLClass } from './engine.js';

/**
 * The `ObjectQL` members the bodies of {@link ReferencesAndMasterDetailFacet} read — every one of
 * them, and no other. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too. `readonly` members are the getters; the others are fields a body
 * assigns.
 */
export interface ReferencesAndMasterDetailHost {
  readonly _registry: ObjectQLClass['_registry'];
  cascadeRelationBehavior: ObjectQLClass['cascadeRelationBehavior'];
  collectCascadeDeleteSet: ObjectQLClass['collectCascadeDeleteSet'];
  homeAmountServing: ObjectQLClass['homeAmountServing'];
  homeLocalizationResolver: ObjectQLClass['homeLocalizationResolver'];
  i18nService: ObjectQLClass['i18nService'];
  readonly logger: ObjectQLClass['logger'];
  masterDeclaredFields: ObjectQLClass['masterDeclaredFields'];
  masterDetailHeadersCallerReads: ObjectQLClass['masterDetailHeadersCallerReads'];
  realtimeService: ObjectQLClass['realtimeService'];
  referenceExists: ObjectQLClass['referenceExists'];
  resolveObjectName: ObjectQLClass['resolveObjectName'];
}

/** The bodies of the "Realtime, i18n, home amounts, validation messages, references, master-detail" section of `ObjectQL`: a stateless facet, called by the class's stubs. */
export class ReferencesAndMasterDetailFacet {
  /** The body of `ObjectQL#setRealtimeService`; the method's docblock there is its contract. */
  static setRealtimeService(this: Pick<ReferencesAndMasterDetailHost, 'logger' | 'realtimeService'>, service: IRealtimeService): void {
    this.realtimeService = service;
    this.logger.info('RealtimeService configured for data events');
  }

  /** The body of `ObjectQL#setI18nService`; the method's docblock there is its contract. */
  static setI18nService(this: Pick<ReferencesAndMasterDetailHost, 'i18nService' | 'logger'>, service: {
    t?: (key: string, locale: string, params?: Record<string, unknown>) => string;
    getLocales?: () => string[];
    getTranslations?: (locale: string) => Record<string, unknown>;
    getFallbackLocale?: () => string | undefined;
    getDefaultLocale?: () => string | undefined;
  }): void {
    this.i18nService = service;
    this.logger.info('I18nService configured for validation messages');
  }

  /** The body of `ObjectQL#setHomeLocalizationResolver`; the method's docblock there is its contract. */
  static setHomeLocalizationResolver(this: Pick<ReferencesAndMasterDetailHost, 'homeLocalizationResolver'>, resolver: HomeLocalizationResolver | undefined): void {
    this.homeLocalizationResolver = resolver;
  }

  /**
   * [ADR-0144 D5] The organization a written row belongs to, for its home
   * projection: the row's own `organization_id`, else the writer's active
   * organization, else the organization a system insert resolved — the
   * assignment seam's reading, so both seams convert and route one row under
   * one organization.
   */
  static homeAmountOrganizationOf(row: Record<string, unknown> | null | undefined, context: ExecutionContext | undefined, derived?: string | undefined): string | undefined {
    const own = row?.organization_id;
    if (own !== undefined && own !== null && own !== '') return String(own);
    if (context?.tenantId) return String(context.tenantId);
    return derived ?? undefined;
  }

  /**
   * [ADR-0144 D5] The `validate()` preview's run of the home projection: the
   * write's own computation over the preview's image (the insert row, or the
   * stored row with the patch over it), answering nothing and writing
   * nothing — it throws exactly the refusal the write would.
   */
  static async previewHomeAmounts(this: Pick<ReferencesAndMasterDetailHost, 'homeAmountServing'>, object: string, schema: unknown, mode: 'insert' | 'update', row: Record<string, unknown>, image: Record<string, unknown>, context: ExecutionContext | undefined, recordId: unknown): Promise<void> {
    const plan = planHomeAmounts(schema);
    const entries = mode === 'insert' ? plan : homeAmountsTouched(plan, row);
    if (entries.length === 0) return;
    await projectHomeAmounts(entries, image, this.homeAmountServing(context), {
      object,
      operation: mode,
      organizationId: ObjectQL.homeAmountOrganizationOf(image, context),
      recordId,
    });
  }

  /**
   * [ADR-0144 D5] Project a by-id update's home amounts onto its FINAL patch:
   * only the declarations the patch touches ({@link homeAmountsTouched}),
   * computed over the stored row with the patch laid over it. Shared by the
   * write and its `validate()` preview, so a dry run refuses what the write
   * refuses.
   */
  static async projectHomeAmountsOntoPatch(this: Pick<ReferencesAndMasterDetailHost, 'homeAmountServing'>, object: string, plan: readonly HomeAmountPlanEntry[], prior: Record<string, unknown> | null | undefined, patch: Record<string, unknown>, context: ExecutionContext | undefined, recordId: unknown, serving: HomeAmountServing = this.homeAmountServing(context)): Promise<void> {
    const touched = homeAmountsTouched(plan, patch);
    if (touched.length === 0) return;
    const image = { ...(prior ?? {}), ...patch };
    Object.assign(patch, await projectHomeAmounts(touched, image, serving, {
      object,
      operation: 'update',
      organizationId: ObjectQL.homeAmountOrganizationOf(image, context),
      recordId,
    }));
  }

  /**
   * [#22519] The write's reference check for a `master_detail` field: does `id`
   * name a header THIS CALLER can read? The write's two header reads, as
   * {@link resolveMasterDetailParent} reads them: the caller's read door
   * ({@link masterDetailHeadersCallerReads}), then the elevated, tenant-kept
   * {@link referenceExists} for a header it returned. A header the read door
   * does not return is `false` — `reference_not_found`, exactly as a header
   * that exists nowhere.
   *
   * `null` (fail-open) only where {@link referenceExists} answers it, and for
   * an unregistered master, which has no read door to ask either. A SYSTEM
   * caller reaches it only as a flow run's elevated write, or a write that
   * write sets off (#28881): its read door returns every header
   * ({@link masterDetailHeadersCallerReads}), so the header's existence in the
   * caller's tenant is what is asked.
   *
   * ⛔ `master_detail` only — the plain `lookup` probe is not this rule's.
   */
  static async masterDetailHeaderExists(this: Pick<ReferencesAndMasterDetailHost, '_registry' | 'masterDetailHeadersCallerReads' | 'referenceExists' | 'resolveObjectName'>, target: string, id: unknown, context: ExecutionContext | undefined): Promise<boolean | null> {
    const master = this.resolveObjectName(target);
    if (!this._registry.getObject(master)) return null;
    const readable = await this.masterDetailHeadersCallerReads(master, [id], context);
    if (!readable.has(String(id))) return false;
    return this.referenceExists(target, id, context);
  }

  /**
   * [#6457] Make a resolved master-detail header TOTAL over the MASTER
   * object's declared fields, so a `parent.<field>` predicate is evaluable
   * whatever subset of columns the driver echoed back.
   *
   * ## The hole this closes
   *
   * #4953 made the `record` / `previous` roots total at every server seam
   * ({@link ./declared-fields.js#materializeDeclaredFields}); the 2026-08-06
   * ruling deliberately left `parent` out, because `parent` is a row of ANOTHER
   * object and its ABSENCE is #4889's fail-closed signal. What that left behind
   * is the same trap one root over — visible as a THREE-row table, of which
   * only the middle row moves here:
   *
   * | header state | `readonlyWhen: parent.status == null` | before | now |
   * |---|---|---|---|
   * | carries `status` | evaluates | locks per verdict | unchanged |
   * | resolved, no `status` key | `No such key: status` — `parent` IS bound, so `unknownVariableOf` does not match ⇒ ordinary fail-OPEN | **declared lock let through** | evaluates (`status` reads `null`) |
   * | unresolvable (`null`) | `Unknown variable: parent` | LOCKED (#4889) | LOCKED — unchanged |
   *
   * The middle row is the bug: whether a declared lock enforced depended on
   * which columns a driver happened to return, which is not something an author
   * can see or control. `requiredWhen` (#4977) shares the binding and had the
   * mirror of it — fail-open there means the requirement is simply not
   * enforced. One materialisation serves both consumers.
   *
   * ## Why HERE, and not in the strip / the evaluator
   *
   * `stripReadonlyWhenFields*` and `evaluateValidationRules` are pure functions
   * over what they are handed; they hold the DETAIL object's field table and
   * have no way to reach the MASTER's — threading a second field table through
   * their signatures would put the master's schema in four call sites' hands to
   * serve one binding. The engine already holds both the registry and the
   * just-read header at these two seams, so the header arrives at those
   * functions already total and their signatures do not move.
   *
   * ## The fail-CLOSED line is preserved EXACTLY (#4889)
   *
   * This function is only ever reached with a row IN HAND — the persisted-state
   * precondition `declared-fields.ts` states. An UNRESOLVABLE header still
   * returns `null` from the resolvers above, still leaves `parent` unbound,
   * still faults as `Unknown variable: parent`, and is still read as LOCKED. The
   * two cases stay distinguishable by construction: absence is decided before
   * this function is called, materialisation only ever applies to a row that
   * exists.
   *
   * A master the registry cannot resolve yields no field table, and the header
   * passes through unchanged — sparse, i.e. exactly the pre-#6457 behaviour.
   * That is the honest answer: without the declared shape we cannot know which
   * absent keys are fields and which would be fabrication.
   *
   * COPIED before materialising, like every other caller: the row is what
   * `findOne`/`find` returned and may be observed elsewhere; it must not gain
   * materialised nulls behind its reader's back.
   */
  static materializeParentHeader(this: Pick<ReferencesAndMasterDetailHost, 'masterDeclaredFields'>, master: string, row: Record<string, unknown>): Record<string, unknown> {
    return materializeDeclaredFields({ ...row }, this.masterDeclaredFields(master));
  }

  /** The MASTER object's declared-field table, or `undefined` when the registry
   *  does not know it (see {@link materializeParentHeader}). */
  static masterDeclaredFields(this: Pick<ReferencesAndMasterDetailHost, '_registry'>, master: string): Record<string, unknown> | undefined {
    const schema = this._registry.getObject(master) as { fields?: Record<string, unknown> } | undefined;
    const fields = schema?.fields;
    return fields && typeof fields === 'object' ? fields : undefined;
  }

  /** The body of `ObjectQL#inspectCascadeDelete`; the method's docblock there is its contract. */
  static async inspectCascadeDelete(this: Pick<ReferencesAndMasterDetailHost, '_registry' | 'collectCascadeDeleteSet' | 'resolveObjectName'>, object: string, id: string | number): Promise<Array<{ object: string; id: string }>> {
    const resolved = this.resolveObjectName(object);
    const set = await this.collectCascadeDeleteSet(
      resolved, [id], undefined, this._registry.getAllObjects(), { fileElevations: false },
    );
    const root = { object: resolved, id: String(id) };
    const members = [root];
    for (const [memberObject, ids] of set.members) {
      for (const memberId of ids) {
        if (memberObject === root.object && memberId === root.id) continue;
        members.push({ object: memberObject, id: memberId });
      }
    }
    return members;
  }

  /** The body of `ObjectQL#getCascadeDeleteObjects`; the method's docblock there is its contract. */
  static getCascadeDeleteObjects(this: Pick<ReferencesAndMasterDetailHost, '_registry' | 'cascadeRelationBehavior' | 'resolveObjectName'>, object: string): string[] | undefined {
    if (!this._registry.getObject(object)) return undefined;
    const host: ThisParameterType<typeof collectCascadeDeleteObjects> = {
      cascadeRelationBehavior: (...a) => this.cascadeRelationBehavior(...a),
    };
    return collectCascadeDeleteObjects.call(
      host, this.resolveObjectName(object), this._registry.getAllObjects(),
    );
  }
}
