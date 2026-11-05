// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29986 codemod] The
 * "Realtime, i18n, home amounts, validation messages, references, master-detail"
 * section of `ObjectQL`: the bodies of `setRealtimeService`, `setI18nService`,
 * `setHomeLocalizationResolver`, `homeAmountOrganizationOf`,
 * `previewHomeAmounts`, `projectHomeAmountsOntoPatch`, `referenceExists`,
 * `masterDetailHeaderExists`, `resolveMasterDetailParent`,
 * `resolveMasterDetailParents`, `materializeParentHeader`,
 * `masterDeclaredFields`, `inspectDanglingReferences`, `inspectCascadeDelete`,
 * `getCascadeDeleteObjects` moved out of `engine.ts` whole by
 * `scripts/codemod-split-engine.mjs`.
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

import type { EngineQueryOptions } from '@objectstack/spec/data';
import type { IRealtimeService } from '@objectstack/spec/contracts';
import { isStoredMetadataBodyObject } from '@objectstack/spec/kernel';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { postureUsesUnionScope } from '@objectstack/spec/security';
import { homeAmountsTouched, planHomeAmounts, projectHomeAmounts } from './home-amount-projection.js';
import type { HomeAmountPlanEntry, HomeAmountReads, HomeAmountServing, HomeLocalizationResolver } from './home-amount-projection.js';
import { resolveMasterDetailRelation } from './master-detail.js';
import { materializeDeclaredFields } from './declared-fields.js';
import { collectCascadeDeleteObjects } from './engine-delete-cascade.js';
import { auditDanglingReferences } from './integrity/dangling-reference-audit.js';
import type { AuditableObject, DanglingReferenceAuditOptions, DanglingReferenceReport } from './integrity/dangling-reference-audit.js';
import { masterIdOf } from './engine-top-level.js';
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
  find: ObjectQLClass['find'];
  findOne: ObjectQLClass['findOne'];
  homeAmountServing: ObjectQLClass['homeAmountServing'];
  homeLocalizationResolver: ObjectQLClass['homeLocalizationResolver'];
  i18nService: ObjectQLClass['i18nService'];
  readonly logger: ObjectQLClass['logger'];
  masterDeclaredFields: ObjectQLClass['masterDeclaredFields'];
  masterDetailHeadersCallerReads: ObjectQLClass['masterDetailHeadersCallerReads'];
  materializeParentHeader: ObjectQLClass['materializeParentHeader'];
  realtimeService: ObjectQLClass['realtimeService'];
  referenceExists: ObjectQLClass['referenceExists'];
  referenceRow: ObjectQLClass['referenceRow'];
  resolveEnginePosture: ObjectQLClass['resolveEnginePosture'];
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

  /** The body of `ObjectQL#homeAmountReadsFor`; the method's docblock there is its contract. */
  static homeAmountReadsFor(this: Pick<ReferencesAndMasterDetailHost, 'homeAmountServing'>, context: ExecutionContext | undefined): HomeAmountReads {
    return {
      serving: this.homeAmountServing(context),
      organizationOf: (row) => ObjectQL.homeAmountOrganizationOf(row, context),
    };
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
   * Does `id` name a row in `target`? `false` only when the probe RAN and found
   * nothing; `null` when it could not run at all (see the fail-open note on
   * {@link assertReferencesResolve}).
   *
   * `context` is the CALLER's execution context. The probe runs under
   * {@link ObjectQL.referenceCheckContext} — the same `sudo()`-shaped elevation
   * the pre-delete reference check uses, so the two reference checks share one
   * spelling: RLS/FLS bypassed, the caller's `tenantId` (and, under the `group`
   * posture, its membership set) forwarded to the driver by
   * `buildDriverOptions`. A row outside the caller's tenant scope is therefore
   * `false` here, exactly like a row that exists nowhere (#19808).
   *
   * Without a `context` the elevation is the bare `{ isSystem: true }` and the
   * probe spans every organization. {@link inspectDanglingReferences}, which
   * has no caller, passes the SCANNED row's own organization as the context's
   * `tenantId` instead (#19837), and no context only for a row that carries
   * none or under a union (`group`) posture — so outside `group` the audit
   * reports a stored reference into another organization, the class this guard
   * now refuses.
   */
  static async referenceExists(this: Pick<ReferencesAndMasterDetailHost, 'referenceRow'>, target: string, id: unknown, context?: ExecutionContext): Promise<boolean | null> {
    const row = await this.referenceRow(target, id, context, []);
    return row === null ? null : row !== false;
  }

  /**
   * [#30205] {@link referenceExists}'s probe, answering the row it found:
   * `id` plus whichever of `extraFields` the target declares, `false` when the
   * probe ran and found nothing, `null` when it could not run. Same read, same
   * elevation, so a check that needs a column of the target (a user's ban
   * state) costs no read of its own.
   */
  static async referenceRow(this: Pick<ReferencesAndMasterDetailHost, '_registry' | 'findOne' | 'resolveObjectName'>, target: string, id: unknown, context: ExecutionContext | undefined, extraFields: readonly string[]): Promise<Record<string, unknown> | false | null> {
    try {
      const resolved = this.resolveObjectName(target);
      const schema = this._registry.getObject(resolved) as { fields?: Record<string, unknown> } | undefined;
      if (!schema) return null;
      const declared = schema.fields ?? {};
      const row = await this.findOne(resolved, {
        where: { id },
        fields: ['id', ...extraFields.filter((f) => f !== 'id' && f in declared)],
        context: ObjectQL.referenceCheckContext(context),
      });
      return row ? row as Record<string, unknown> : false;
    } catch {
      return null;
    }
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
   * [#4889] The master-detail header a detail row's `parent`-scoped
   * `readonlyWhen` reads, or `null` when this write cannot resolve one.
   *
   * `readonlyWhen: parent.status == 'paid'` is a documented **server**
   * guarantee (ADR-0124 D1 puts enforcement here; the client grid is
   * courtesy), but the strip is a pure function over the payload and the prior
   * row — it has no driver and cannot fetch a header. So the engine resolves it
   * and passes it in.
   *
   * The header id comes from the payload first, then the prior row: a write that
   * REPOINTS the detail at another master must be judged against the master it
   * is landing on, not the one it is leaving.
   *
   * ## Two reads: may the caller see the header, then what it holds (#22519)
   *
   * A write of a detail whose header the caller cannot read answers exactly
   * what a write naming a header that exists nowhere answers — for every
   * detail, `controlled_by_parent` or not, on insert, update (a repoint
   * included) and the bulk paths. The caller's right to write the detail does
   * NOT settle its right to read the header: ADR-0055 §3 gates a detail write
   * on its header (master edit, which implies read) only for a
   * `controlled_by_parent` detail, and a detail with a sharing model of its own
   * meets no header check on write. So the header is read twice, each read
   * answering one question, in the shape the preview reads it in
   * ({@link resolvePreviewParents}):
   *
   *  1. ⛔ MAY THIS CALLER SEE THE HEADER — the read door, under the caller's
   *     own context ({@link masterDetailHeadersCallerReads}). A header it does
   *     not return binds as a missing header binds: `null`, so a parent-scoped
   *     `requiredWhen` / `readonlyWhen` meets an unbound `parent`, and the
   *     reference check answers `reference_not_found` for it
   *     ({@link masterDetailHeaderExists}).
   *  2. WHAT THE HEADER HOLDS — the write's own ELEVATED read below, for a
   *     header read 1 returned only. The lock is a data-integrity property of
   *     the header's state, so a header the caller can read is judged on its
   *     STORED values, a column field-level security hides from or masks for
   *     this caller included: author-defined integrity rules run on true data.
   *     The preview's per-column masking is the preview's own, not the write's.
   *
   * A SYSTEM caller (seed replay, boot) asks no read door: read 2 alone, as
   * before.
   *
   * ## The elevation keeps the tenant wall (#19837)
   *
   * Read 2's argument is about the VALUES of a header the caller may see, never
   * about TENANCY, so the
   * read runs under {@link ObjectQL.referenceCheckContext} — the `sudo()`-shaped
   * `{ ...context, isSystem: true }` both reference checks share — and never a
   * bare `{ isSystem: true }`. The bare spelling carried no `tenantId`, so the
   * header was found in ANY organization and a `parent.*` predicate was judged
   * against another organization's row: an org-bound caller naming that row's
   * id learned one bit of it per write (`requiredWhen` answered `required` for a
   * `locked` header and `reference_not_found` for an `open` one; `readonlyWhen`
   * dropped or kept the field). With the caller's context spread first,
   * `buildDriverOptions` forwards its `tenantId` (and, under the `group`
   * posture, its membership set as `tenantIds`), a header stamped with an
   * organization outside that scope — another organization, or under `group`
   * one outside the caller's membership set — is not found, and it binds
   * exactly as a header that exists nowhere does — absent. The tenancy exemptions stay where they are decided:
   * a `tenancy.enabled: false` or federated master gets no `tenantId`. A
   * header with no organization is no tenant's (ADR-0131 D1): the driver's
   * scope carries no `IS NULL` arm, so a scoped read does not find it. A system
   * caller with no `tenantId` (seed replay, boot) still reads unscoped.
   *
   * `null` on any failure — no relation, no id, header not returned by the
   * caller's read door, header gone or outside the caller's tenant scope, read
   * threw. It is NOT read as "unlocked": an
   * unresolved binding leaves `parent` unbound, and `isReadonlyWhenLocked`
   * treats a predicate that needs it as LOCKED.
   *
   * [#6457] A header that IS resolved is handed over TOTAL over the MASTER
   * object's declared fields — see {@link materializeParentHeader} for why that
   * had to happen here and nowhere else, and for the verdict table it moves.
   */
  static async resolveMasterDetailParent(this: Pick<ReferencesAndMasterDetailHost, 'findOne' | 'logger' | 'masterDetailHeadersCallerReads' | 'materializeParentHeader'>, schema: any, data: Record<string, unknown> | null | undefined, priorRow: Record<string, unknown> | null | undefined, context: ExecutionContext | undefined): Promise<Record<string, unknown> | null> {
    const rel = resolveMasterDetailRelation(schema);
    if (!rel) return null;
    // [#24358] ⛔ A header in the stored-metadata-body family is never read,
    // under either authority. Read 2 below is a whole-row read the family's
    // projection never reaches, so a `parent.*` predicate would be judged over
    // the stored body and its content hash unprojected: one bit of material the
    // family's own door withholds, per write. `parent` stays unbound, the
    // fail-closed signal (#4889) an unreadable header already gives, so the
    // verdict says nothing about the row.
    if (isStoredMetadataBodyObject(rel.master)) return null;
    const parentId = masterIdOf(rel.fk, data, priorRow);
    if (parentId == null) return null;
    // [#22519] 1. The caller's read door: a header it does not return binds as
    // a missing header binds.
    const readable = await this.masterDetailHeadersCallerReads(rel.master, [parentId], context);
    if (!readable.has(String(parentId))) return null;
    // 2. The write's own elevated, tenant-kept read, for a header read 1 returned.
    try {
      const row = await this.findOne(rel.master, { where: { id: parentId }, context: ObjectQL.referenceCheckContext(context) });
      // `null` stays `null` — the fail-CLOSED signal (#4889) is the ABSENCE of
      // the binding, and materialising a row we do not have would destroy it.
      return row == null ? null : this.materializeParentHeader(rel.master, row as Record<string, unknown>);
    } catch (err) {
      this.logger?.warn?.('readonlyWhen parent lookup failed — parent stays unbound', {
        object: rel.master, id: parentId, error: err,
      });
      return null;
    }
  }

  /**
   * Bulk counterpart of {@link resolveMasterDetailParent}: one read for the
   * whole matched set, then a per-row lookup for
   * `stripReadonlyWhenFieldsMulti`. A bulk update of N details under M masters
   * costs ONE extra query, not N — the same "read the match set once" discipline
   * the #3106 prior-row fetch follows.
   *
   * [#4977] Serves three callers now, unchanged: the bulk `readonlyWhen` strip,
   * the bulk `requiredWhen` evaluation, and the INSERT path — where `data` is
   * passed as `null` and each inserted row supplies its own FK, so
   * `masterIdOf(fk, null, row)` reads `row[fk]` and the batch costs one header
   * read for the whole `insert()` call.
   *
   * [#6457] Every header this resolves is materialised over the MASTER's
   * declared fields, exactly as the single-id twin does — the declared-field
   * table is read ONCE for the batch, not per row. A row this map has no entry
   * for still answers `null` (unbound, fail-CLOSED for `readonlyWhen`).
   *
   * [#19837] Read under the same tenant-keeping elevation as the single-id twin,
   * for the same reason: a header outside the caller's tenant scope gets no
   * entry here, so it binds as absent rather than lending its fields to a
   * `parent.*` predicate.
   *
   * [#22519] The same two reads as the single-id twin, each once for the batch:
   * the caller's read door ({@link masterDetailHeadersCallerReads}), then the
   * elevated read for the headers it returned only. A header the read door does
   * not return gets no entry, so it binds as a missing header binds.
   */
  static async resolveMasterDetailParents(this: Pick<ReferencesAndMasterDetailHost, 'find' | 'logger' | 'masterDeclaredFields' | 'masterDetailHeadersCallerReads'>, schema: any, data: Record<string, unknown> | null | undefined, priorRows: ReadonlyArray<Record<string, unknown>> | null | undefined, context: ExecutionContext | undefined): Promise<(row: Record<string, unknown> | undefined) => Record<string, unknown> | null> {
    const unbound = () => null;
    const rel = resolveMasterDetailRelation(schema);
    if (!rel) return unbound;
    // [#24358] ⛔ The single-id twin's family guard, for the batch: a
    // stored-metadata-body header is never read, and every row binds unbound.
    if (isStoredMetadataBodyObject(rel.master)) return unbound;
    const ids = new Set<string>();
    for (const row of priorRows ?? []) {
      const id = masterIdOf(rel.fk, data, row);
      if (id != null) ids.add(String(id));
    }
    if (ids.size === 0) return unbound;
    // [#22519] 1. The caller's read door, once for the batch.
    const readable = await this.masterDetailHeadersCallerReads(rel.master, [...ids], context);
    if (readable.size === 0) return unbound;
    const byId = new Map<string, Record<string, unknown>>();
    try {
      // 2. The write's own elevated, tenant-kept read, for the headers read 1 returned.
      const rows = await this.find(rel.master, {
        where: { id: { $in: [...readable] } },
        context: ObjectQL.referenceCheckContext(context),
      }) as Array<Record<string, unknown>>;
      // [#6457] One declared-field lookup for the whole batch, then one shallow
      // copy per header. A master the registry does not know leaves `fields`
      // undefined and every header passes through untouched — see
      // {@link materializeParentHeader}.
      const masterFields = this.masterDeclaredFields(rel.master);
      for (const row of Array.isArray(rows) ? rows : []) {
        if (row?.id != null) byId.set(String(row.id), materializeDeclaredFields({ ...row }, masterFields));
      }
    } catch (err) {
      this.logger?.warn?.('readonlyWhen parent lookup failed — parent stays unbound', {
        object: rel.master, error: err,
      });
      return unbound;
    }
    return (row) => {
      const id = masterIdOf(rel.fk, data, row);
      return id == null ? null : (byId.get(String(id)) ?? null);
    };
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

  /** The body of `ObjectQL#inspectDanglingReferences`; the method's docblock there is its contract. */
  static async inspectDanglingReferences(this: Pick<ReferencesAndMasterDetailHost, '_registry' | 'find' | 'logger' | 'referenceExists' | 'resolveEnginePosture'>, options?: DanglingReferenceAuditOptions): Promise<DanglingReferenceReport> {
    // Read once per run, live — the posture IN FORCE, by the engine's one reader.
    const unionScope = postureUsesUnionScope(this.resolveEnginePosture());
    return auditDanglingReferences(
      {
        objects: () => this._registry.getAllObjects() as unknown as AuditableObject[],
        // The port's options are the audit's own `{ fields, limit, context }`
        // read; the published port spells them `Record<string, unknown>`, so
        // the hand-over names the engine contract they are read under.
        find: (object, opts) => this.find(object, opts as EngineQueryOptions) as Promise<Array<Record<string, unknown>>>,
        probe: (target, id, organization) => this.referenceExists(
          target, id, organization == null || unionScope ? undefined : ({ tenantId: organization } as ExecutionContext),
        ),
        warn: (msg, meta) => this.logger?.warn?.(msg, meta as any),
      },
      options,
    );
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
