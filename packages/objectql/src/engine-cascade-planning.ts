// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29986 codemod] The "Cascade and referential delete planning" section of
 * `ObjectQL`: the bodies of `planCascadeAtomicity`, `warnCascadeNotAtomic`,
 * `storedReferenceIncludes`, `remainderAfterMemberRemoval`,
 * `referenceCheckContext`, `dependentCountIsDisclosable`,
 * `cascadeDeleteRelations`, `cascadeRelationBehavior`,
 * `fileReferenceCheckElevation`, `referenceProbeFilterOfSet`,
 * `probeReferencingRowsOfSet`, `walkReferencingRelations`,
 * `isTenantColumnSetNull`, `outlivesOrganization`,
 * `keepsOrganizationReference`, `countReferencingRowsOutside`,
 * `organizationCountContext`, `organizationCountIsDisclosable`,
 * `refuseOrganizationDeleteWhileOwned`, `organizationOwnedRowCounts` moved out
 * of `engine.ts` whole by `scripts/codemod-split-engine.mjs`.
 *
 * A MOVE, not a redesign. {@link CascadePlanningFacet} is a stateless facet of `ObjectQL`
 * (ruling 6624345766): each static method of it is the body of the `ObjectQL`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class as a one-call stub with
 * its signature, so the published surface, an instance spy and a subclass
 * override are what they were. A public or protected method keeps its
 * docblock on the class, the contract; a private method's docblock moved here
 * with its body. The state stays on `ObjectQL`.
 *
 * The bodies reach the class through {@link CascadePlanningHost}: exactly the
 * `ObjectQL` members they read, private ones included. Every stub hands its
 * body, by a `.call`, the same host: `cascadePlanningHost` in
 * `engine-facet-hosts.ts`, built once per engine by the class's static block.
 * Methods go as closures that call them on the engine at call time, so a
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

import type { ServiceObject } from '@objectstack/spec/data';
import { SystemFieldName } from '@objectstack/spec/system';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { isMissingTableError } from '@objectstack/metadata/errors';
import { ORGANIZATION_OBJECT, resolveTenantFieldName } from './tenancy/system-write-organization.js';
import { isFederatedUnprovisionedInjectedColumn } from './federated-object.js';
import {
  cascadeMemberKey, cascadeSetAdd, cascadeSetHas, declaredMultiValued, deleteWalkTargetOf, statesDeleteSemantics,
} from './engine-top-level.js';
import type { CascadeDeleteSet } from './engine-top-level.js';
import { ObjectQLStatics as ObjectQL } from './engine.js';
import type { ObjectQL as ObjectQLClass } from './engine.js';

/**
 * The `ObjectQL` members the bodies of {@link CascadePlanningFacet} read — every one of
 * them, and no other. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too. `readonly` members are the getters; the others are fields a body
 * assigns.
 */
export interface CascadePlanningHost {
  readonly _registry: ObjectQLClass['_registry'];
  readonly cascadeDeleteSets: ObjectQLClass['cascadeDeleteSets'];
  readonly cascadeIssuedDeletes: ObjectQLClass['cascadeIssuedDeletes'];
  readonly cascadeNotAtomicReported: ObjectQLClass['cascadeNotAtomicReported'];
  cascadeRelationBehavior: ObjectQLClass['cascadeRelationBehavior'];
  collectCascadeDeleteSet: ObjectQLClass['collectCascadeDeleteSet'];
  count: ObjectQLClass['count'];
  countReferencingRowsOutside: ObjectQLClass['countReferencingRowsOutside'];
  readonly defaultDriver: ObjectQLClass['defaultDriver'];
  delete: ObjectQLClass['delete'];
  deleteRestrictedError: ObjectQLClass['deleteRestrictedError'];
  readonly drivers: ObjectQLClass['drivers'];
  fileReferenceCheckElevation: ObjectQLClass['fileReferenceCheckElevation'];
  find: ObjectQLClass['find'];
  getDriver: ObjectQLClass['getDriver'];
  isTenantColumnSetNull: ObjectQLClass['isTenantColumnSetNull'];
  readonly logger: ObjectQLClass['logger'];
  organizationCountIsDisclosable: ObjectQLClass['organizationCountIsDisclosable'];
  probeReferencingRows: ObjectQLClass['probeReferencingRows'];
  probeReferencingRowsOfSet: ObjectQLClass['probeReferencingRowsOfSet'];
  recordReferenceCheckElevation: ObjectQLClass['recordReferenceCheckElevation'];
  referenceProbeFilter: ObjectQLClass['referenceProbeFilter'];
  referenceProbeFilterOfSet: ObjectQLClass['referenceProbeFilterOfSet'];
  refuseOrganizationDeleteWhileOwned: ObjectQLClass['refuseOrganizationDeleteWhileOwned'];
  refuseRestrictsInsideOwnCascade: ObjectQLClass['refuseRestrictsInsideOwnCascade'];
  resolveObjectName: ObjectQLClass['resolveObjectName'];
  update: ObjectQLClass['update'];
  walkReferencingRelations: ObjectQLClass['walkReferencingRelations'];
}

/** The bodies of the "Cascade and referential delete planning" section of `ObjectQL`: a stateless facet, called by the class's stubs. */
export class CascadePlanningFacet {
  /**
   * Can the by-id delete of `object` and its whole cascade run as ONE unit of
   * work? [#7413]
   *
   * `delete()`'s by-id branch ran `cascadeDeleteRelations` and then
   * `driver.delete` with no transaction around either, and the cascade
   * RE-ENTERS `this.delete()` / `this.update()` per dependent row — so every
   * child committed on its own. A refusal partway (the `restrict` branch below,
   * a child's permission check, a later child's `beforeDelete` hook) left an
   * arbitrary PREFIX of the children deleted while the caller received 409/403
   * and reasonably read it as "nothing happened". #4620 already ruled the
   * principle for the batch path — *atomic honoured for real, or refused; a
   * partial delete has no natural undo* — and this path never got it.
   *
   * Three verdicts, because "wrap it in a transaction" is only unconditionally
   * right in one of them:
   *
   * - **`'none'`** — no registered object declares a relation of the delete
   *   family ({@link statesDeleteSemantics}: `master_detail` / `lookup` /
   *   `tree`) pointing at `object`, so `cascadeDeleteRelations` cannot write anything
   *   and there is no multi-write unit to make atomic. The delete runs exactly
   *   as it did before this card: one `driver.delete`, no transaction opened,
   *   no degrade warning. A plain non-cascade delete is the CONTROL for this
   *   change and must stay byte-identical.
   * - **`'split'`** — dependents exist, but at least one participant (the
   *   parent or a transitively-referencing child) resolves to a driver other
   *   than the engine's DEFAULT one. `transaction()` opens on the default
   *   driver and covers that connection alone (ADR-0119 D1 — no two-phase
   *   commit on `IDataDriver`), so opening one here would not buy atomicity; it
   *   would REFUSE the cascade outright, because `enforceTransactionOrigin`
   *   throws {@link CrossDatasourceTransactionWriteError} for a business write
   *   inside a transaction that does not cover it (#5351 / #5696 point 2, the
   *   2026-08-06 ruling). A cross-datasource cascade delete works today, and
   *   turning it into a hard refusal is a strictly worse answer than the
   *   non-atomic one it has always had. So it keeps that answer and says so
   *   once — see {@link warnCascadeNotAtomic}.
   * - **`'atomic'`** — dependents exist and every participant sits on the
   *   default driver. This is the shape the card measured and the shape
   *   virtually every deployment has; the caller gets one unit of work.
   *
   * A pure registry walk — no I/O, no driver call. It answers from the SCHEMA
   * (which objects *could* be reached), never from row counts, so the verdict
   * is stable for a given schema and costs nothing on the common path. The walk
   * is the transitive closure of "objects referencing X" because a cascade
   * recurses into each child's own cascade; it is bounded by
   * {@link ObjectQL.MAX_CASCADE_DEPTH}, the ceiling the recursion itself carries.
   *
   * Fails toward `'split'` on anything it cannot resolve WITHIN the walk (an
   * unregistered reference, a `getDriver` throw): the degrade is today's
   * behaviour, while a wrong `'atomic'` would manufacture the refusal this
   * verdict exists to avoid.
   *
   * [#9002] That fail-toward rule is about resolving individual PARTICIPANTS.
   * It never covered the registry read that produces the participant list in
   * the first place, and the `catch → 'none'` that used to sit there was not an
   * instance of it: `'none'` is the one verdict that asserts something positive
   * about the schema — *nothing references this object* — and an unreadable
   * registry cannot support that claim. The swallow's own comment argued the
   * direction from `cascadeDeleteRelations` returning on the same failure, so
   * that nothing was left un-cascaded to make atomic; once that seam propagates
   * the premise is gone, and this one propagates with it. Note the ORDER makes
   * this seam the first to speak: `delete()` calls this before it runs the
   * cascade, so an unreadable registry now fails the delete before any row is
   * touched.
   */
  static planCascadeAtomicity(this: Pick<CascadePlanningHost, '_registry' | 'defaultDriver' | 'drivers' | 'getDriver' | 'resolveObjectName'>, object: string): 'none' | 'split' | 'atomic' {
    const objects: ServiceObject[] = this._registry.getAllObjects();

    // Which objects reference `name` via a relation the cascade would follow.
    // The family test ({@link statesDeleteSemantics}) + `reference` test is
    // `cascadeDeleteRelations`'s own, so the two cannot disagree about who
    // participates. `restrict` fields are INCLUDED deliberately: a restrict
    // refusal is the card's core repro, and it must roll back the siblings
    // already cascaded before it.
    //
    // [#22957] A `tree` takes part since it joined the family. Its reference
    // names the object that declares it, so an object whose only relation is
    // its own hierarchy now plans `'atomic'` rather than `'none'`: a subtree
    // cascade is several deletes, and a refusal from a node deep in it must
    // roll back the nodes deleted before it.
    const referencing = (name: string): string[] => {
      const out: string[] = [];
      for (const child of objects) {
        const childName = (child as any)?.name as string | undefined;
        const fields = (child as any)?.fields as Record<string, any> | undefined;
        if (!childName || !fields) continue;
        for (const [fieldName, fdef] of Object.entries(fields)) {
          if (!statesDeleteSemantics(fdef)) continue;
          // [#18550] The carrier is read through the ONE arbiter, so a
          // `reference` no reader can read REFUSES here instead of reading as
          // "this child does not reference `name`". The two answers stay
          // different on purpose:
          //
          //  - ABSENCE (`undefined` / `null` / `''`) is unchanged and still
          //    silent. `referenceCarrierOf` answers `undefined` for all three
          //    and this `continue` skips the field, which is what a field that
          //    names no target legitimately means (`FieldSchema.reference` is
          //    `.optional()`, `StrictField` declares it nullable).
          //  - UNREADABILITY is the loud one. An object- or array-valued
          //    carrier was TRUTHY here and then failed both name comparisons
          //    below, so the relation was dropped from the set silently — and
          //    this function's `'none'` is, by its own docblock above, the one
          //    verdict that asserts something POSITIVE about the schema
          //    ("nothing references this object"). An unreadable carrier can
          //    no more support that claim than an unreadable registry can.
          const ref = deleteWalkTargetOf(fdef, 'ObjectQL.planCascadeAtomicity');
          if (!ref) continue;
          let resolvedRef: string | undefined;
          try { resolvedRef = this.resolveObjectName(ref); } catch { resolvedRef = undefined; }
          if (ref !== name && resolvedRef !== name) continue;
          // [#21910, #21918] The scan skips every column the registry injected
          // into a federated object and the object does not provision, so this
          // walk does too: the participant test stays the scan's own, as the
          // comment above requires. A federated object this walk still reaches
          // through a relation its author declared keeps the verdict
          // `'split'`, because the scan probes that relation.
          if (isFederatedUnprovisionedInjectedColumn(child, fieldName)) continue;
          out.push(childName);
          break;
        }
      }
      return out;
    };

    const firstLevel = referencing(object);
    if (firstLevel.length === 0) return 'none';

    const defaultDriver = this.defaultDriver ? this.drivers.get(this.defaultDriver) : undefined;
    if (!defaultDriver) return 'split';
    const onDefaultDriver = (name: string): boolean => {
      try { return this.getDriver(name) === defaultDriver; } catch { return false; }
    };

    if (!onDefaultDriver(object)) return 'split';
    const seen = new Set<string>([object]);
    let frontier = firstLevel;
    for (let depth = 0; depth < ObjectQL.MAX_CASCADE_DEPTH && frontier.length > 0; depth++) {
      const next: string[] = [];
      for (const name of frontier) {
        if (seen.has(name)) continue;
        seen.add(name);
        if (!onDefaultDriver(name)) return 'split';
        next.push(...referencing(name));
      }
      frontier = next;
    }
    return 'atomic';
  }

  /**
   * The `'split'` verdict of {@link planCascadeAtomicity}, said out loud — once
   * per object per engine instance (#7413).
   *
   * Same reasoning as {@link warnTransactionUnsupported}, which this mirrors
   * deliberately: a capability is not available, so the delete keeps the
   * non-atomic behaviour it has always had. `warn`, not `error` — at this
   * moment nothing claimed-persisted has failed to land; what is missing is the
   * ability to undo the cascade if a later child refuses. Escalating it would
   * train readers to skim `error`, which AGENTS.md names as the mirror-image
   * mistake.
   */
  static warnCascadeNotAtomic(this: Pick<CascadePlanningHost, 'cascadeNotAtomicReported' | 'defaultDriver' | 'logger'>, object: string): void {
    if (this.cascadeNotAtomicReported.has(object)) return;
    this.cascadeNotAtomicReported.add(object);
    this.logger.warn(
      `Cascade delete of '${object}' cannot run as one unit of work: the cascade reaches an object routed ` +
        `to a datasource other than the default one ('${this.defaultDriver ?? '<none>'}'), and a transaction ` +
        "covers one driver's connection only (ADR-0119 D1 — no two-phase commit). The cascade therefore runs " +
        'UNWRAPPED, as every cascade did before a single-datasource cascade was made one transaction: if a ' +
        'later dependent refuses the delete, the rows already ' +
        'removed stay removed while the call rejects. Route the cascading objects to one datasource to get the ' +
        'atomic path. Reported once per object per engine instance.',
      { object, defaultDatasource: this.defaultDriver ?? undefined },
    );
  }

  /**
   * [#9362] Does this STORED reference value point at `id`? The exact answer
   * the `$contains` pushdown in {@link ObjectQL.referenceProbeFilter} can only
   * approximate.
   *
   * Element-wise over the array, comparing `String(v)` — the same reading
   * `dangling-reference-audit.ts` already applies to a stored reference
   * (`Array.isArray(raw) ? raw : [raw]`), so the two integrity surfaces cannot
   * disagree about what "this row references that record" means. An EXPANDED
   * record in the slot is a read shape rather than an id write, and is skipped
   * there for that reason; it is skipped here too.
   *
   * A non-array value is still compared rather than dismissed. A
   * `multiple: true` slot holding a bare scalar is off-shape, and the two
   * dispositions available are not symmetric: reading it as "references
   * nothing" would drop a `restrict` refusal and let a referenced record be
   * deleted — the fail-OPEN direction #8895 ruled out for this same guard —
   * while reading it as a reference at most refuses a delete loudly.
   */
  static storedReferenceIncludes(stored: unknown, id: string | number): boolean {
    const wanted = String(id);
    const values = Array.isArray(stored) ? stored : [stored];
    for (const v of values) {
      if (v == null || typeof v === 'object') continue;
      if (String(v) === wanted) return true;
    }
    return false;
  }

  /**
   * [#9688] What a `multiple: true` reference slot holds once the deleted
   * record's membership is removed — the ONE computation behind both the
   * per-row `required` judgement in {@link ObjectQL.cascadeDeleteRelations}
   * and the `set_null` write that judgement gates.
   *
   * One function rather than two readings that happen to match, because the
   * judgement decides whether the write may run at all: a predicate computing
   * the remainder differently could clear a delete and then have the write
   * land the empty required set the judgement exists to refuse — or refuse a
   * delete whose write would have produced a perfectly legal non-empty set.
   *
   * `String(v) !== String(id)` is the same reading
   * {@link ObjectQL.storedReferenceIncludes} applies when narrowing
   * `dependents`, so the member removed is exactly the member that made the
   * row a dependent. A non-array value is normalized to the array spelling
   * rather than dismissed, for the same reason the narrowing compares it: an
   * off-shape bare scalar in a `multiple: true` slot is still a reference.
   *
   * [#27004] `cleared` are the members this cascade has already removed from
   * the relation ({@link CascadeDeleteSet.cleared}): a row read once for a
   * whole root set may still list them, and they are not written back.
   */
  static remainderAfterMemberRemoval(stored: unknown, id: string | number, cleared?: ReadonlySet<string>): unknown[] {
    const current: unknown[] = Array.isArray(stored) ? stored : [stored];
    return current.filter((v) => String(v) !== String(id) && !cleared?.has(String(v)));
  }

  /**
   * [#12166] The identity the pre-delete reference CHECK runs under — system,
   * unconditionally (maintainer ruling 2026-08-26, option A).
   *
   * `sudo()`-shaped, never a bare `{ isSystem: true }`. The full reasoning sits
   * at the one call site (`cascadeDeleteRelations`'s dependents probe); the
   * short form is that the spread carries three things the bare spelling would
   * drop — the caller's transaction handle, the TENANT scope, and `userId`,
   * which is the audit ledger's triggered-by half beside `isSystem`'s
   * executed-as half.
   *
   * A helper rather than an inline spread because the disclosure re-probe below
   * has to be able to say "the caller's OWN context" by contrast, and because a
   * second inline spelling is how one of the two would later gain a key the
   * other lacks.
   */
  static referenceCheckContext(context?: ExecutionContext): ExecutionContext {
    return { ...(context ?? {}), isSystem: true } as ExecutionContext;
  }

  /**
   * [#12166, ruling constraint 2] May the refusal disclose HOW MANY rows
   * reference this record?
   *
   * The elevation above is what makes this question exist. Before it, the
   * dependents probe ran as the caller, so every number the `DELETE_RESTRICTED`
   * envelope reported (`dependentCount`, the localized message's `count`, the
   * developerMessage) was derived from rows the caller could read by
   * definition. After it, the probe sees rows the caller may have no grant on
   * at all — and shipping that count back would hand a caller with NO read
   * permission on `childName` an exact, repeatable cardinality oracle over it:
   * delete-probe each record of `object`, read the count off the 409, and
   * reconstruct the hidden table's reference histogram without ever being
   * allowed to read a row.
   *
   * The ruling closes that: the error names the referenced OBJECT and nothing
   * about rows — "one notch more conservative than Salesforce". It does NOT ask
   * for the count to be dropped for everyone, and dropping it would be its own
   * regression (the count is what makes the refusal actionable, and it predates
   * this card for callers who could always compute it). So the count is
   * disclosed on exactly one condition: **the caller's own identity would have
   * produced the same rows.**
   *
   * The comparison is on ROW IDENTITY, not on length. Two different sets can
   * have the same size, and RLS narrowing is precisely the case that produces
   * one — a caller who may read `childName` at the object level but whose
   * row-level filter hides two of three referencing rows must not be told
   * "three" either. Comparing id sets makes the object-level denial and the
   * row-level narrowing the same answer, which is what they are.
   *
   * Costs one extra query, and only on the refusal path — the delete is being
   * aborted anyway, so this is not on any successful delete's critical path.
   *
   * Fails CLOSED, on the DISCLOSURE axis: any throw at all (a genuine
   * permission denial, an outage, a driver error) answers "not disclosable".
   * That direction is deliberate and is the opposite of #8895's stance for the
   * integrity probe itself — an integrity guard that cannot run must not
   * silently pass, but a DISCLOSURE that cannot be justified must not silently
   * happen. The two guards face opposite ways because a wrong answer costs
   * opposite things: there, a permitted delete that should have been refused;
   * here, a leak. Nothing about the refusal itself depends on this — an
   * unanswerable probe still refuses the delete, just without the number.
   */
  static async dependentCountIsDisclosable(this: Pick<CascadePlanningHost, 'find' | 'logger'>, childName: string, probeWhere: Record<string, unknown>, probedIds: readonly string[], fieldName: string, multiValued: boolean, id: string | number, context?: ExecutionContext): Promise<boolean> {
    // The caller IS the system (seed replay, migration, an internal cascade
    // recursion). Nothing was elevated PAST them, so there is nothing to
    // withhold — and withholding here would strip the count from the engine's
    // own internal paths for no gain.
    if (context?.isSystem === true) return true;
    try {
      // Typed through the DECLARED options type rather than cast: `where` is
      // `Record<string, unknown>` on `EngineQueryOptionsSchema` and `context`
      // rides `BaseEngineOptions`, so nothing here needs erasing
      // (`check:query-options-erasure` — the grandfathered `as any` on the
      // elevated probe above is a pre-existing site this card does not sweep,
      // tracked in #4918).
      let own: any[] = await this.find(childName, { where: probeWhere, context });
      // The SAME narrowing the elevated probe applied (#9362), or the two sets
      // would be compared through different definitions of "references this
      // record" and a multi-value relation would read as non-disclosable
      // always.
      if (multiValued && own) {
        own = own.filter((row: any) => ObjectQL.storedReferenceIncludes(row?.[fieldName], id));
      }
      const ownIds = new Set((own ?? []).map((r: any) => String(r?.id)));
      return ownIds.size === probedIds.length && probedIds.every((rid) => ownIds.has(rid));
    } catch (error) {
      // Says something rather than rethrowing, and the asymmetry is the point
      // (`check:durability-read-invention` accepts either — "say something, or
      // ask the error's type").
      //
      // Rethrowing is WRONG here specifically. The integrity answer is already
      // in hand: the elevated probe succeeded, the dependents are known, and
      // this delete is being refused either way. Propagating a failure of the
      // DISCLOSURE probe would convert a correct `409 DELETE_RESTRICTED` into a
      // `500` — a worse answer for the caller, produced by a query that exists
      // only to decide how much detail the refusal carries.
      //
      // Nor is the invented value a durability hazard of the class that rule
      // guards: no declared set is being read, and `false` withholds. The
      // failure mode of getting this wrong is a slightly less informative
      // refusal, never a permitted delete and never an over-disclosure.
      //
      // The one thing that WOULD be wrong is doing it silently — an operator
      // seeing count-free refusals has no way to tell "withheld on purpose"
      // from "the disclosure probe has been failing for a week".
      this.logger.warn(
        `[reference-cleanup] could not determine whether the caller may be told how many '${childName}' ` +
        `record(s) reference this one; withholding the count from the refusal (the refusal itself stands)`,
        { object: childName, error: (error as Error)?.message ?? String(error) },
      );
      return false;
    }
  }

  /**
   * Apply referential delete behavior for relations pointing AT this record,
   * before it is removed. For every registered object with a `master_detail`,
   * `lookup` or `tree` field, or a `user` field that declares a
   * `deleteBehavior` ({@link statesDeleteSemantics}), referencing
   * `object`, honor the field's `deleteBehavior`:
   *   - `cascade`  → delete the dependent rows (recursively, so grandchildren
   *                  are handled by each child's own delete),
   *   - `set_null` → clear the foreign key. On a MULTI-VALUED field
   *                  ([#18408] {@link declaredMultiValued}, ⛔ not the raw
   *                  flag) the FK is a SET, so "clear" means remove the
   *                  deleted MEMBER and keep the rest; an emptied set on
   *                  an optional field is stored as `null`, the same as one
   *                  never set — the representation `FieldSchema` pins
   *                  (`packages/spec/src/data/field.zod.ts`, the `multiple`
   *                  doc block, ruling A on #29343, record 6591577985,
   *                  amending #9447),
   *   - `restrict` → refuse the delete when dependents exist.
   * `master_detail` defaults to `cascade` (the parent owns the child
   * lifecycle); `lookup` and `tree` default to `set_null` — except a `set_null` default
   * on a REQUIRED lookup escalates to `restrict` (you can't null a NOT NULL
   * FK; restricting with a clear dependent-count message beats a misleading
   * "<field> is required" 400 from the child) — and on a `multiple: true`
   * required lookup that escalation is decided per ROW after the dependents
   * probe (#9688): a row that keeps another member takes the member removal,
   * a row the removal would EMPTY keeps the refusal, and the refusal counts
   * only those rows. A by-id delete runs it for its one record; a predicate
   * delete (`multi: true`) runs it for every row it matched ([#26871], see
   * `delete()`'s predicate arm).
   *
   * [#27004] It takes a ROOT SET: the by-id delete passes a set of one, the
   * predicate arm the ids it matched. Every phase below reads a relation once
   * per {@link REFERENCE_PROBE_BATCH} records of the set
   * ({@link probeReferencingRowsOfSet}), not once per record, and judges and
   * writes per record as before. One walk of one set: a matched row another
   * matched row's cascade reaches is in the set like any other member, so it
   * refuses nothing and is cleared of nothing (#22305), and the predicate
   * arm's own `deleteMany` removes it.
   *
   * [#22305] Two phases, so the walk knows its own set before it judges
   * anything:
   *   1. {@link collectCascadeDeleteSet} — read-only. Every record the cascade
   *      deletes, transitively, across every CASCADING relation, the root
   *      included.
   *   2. {@link walkReferencingRelations} — the walk above, unchanged in
   *      order, except that a `restrict` (authored, or the escalated
   *      required `set_null`) and a `set_null` write consider only rows
   *      OUTSIDE the set. A row in the set is about to be deleted by this same
   *      cascade: it cannot be left dangling, so it refuses nothing, and
   *      clearing its reference would be a write against a row about to go.
   * [#26718] Between the two, {@link refuseRestrictsInsideOwnCascade}, also
   * read-only: an AUTHORED `restrict` held by a member the cascade reaches
   * only THROUGH the record that restrict protects (a child holding a
   * master_detail and a restrict lookup to one parent; a grandchild under it)
   * refuses the delete before the first write. The row is in the set, so phase
   * 2 alone would let the cascade delete it.
   *
   * Before this, the outcome depended on registration order: with the
   * contacts registered ahead of the contracts, deleting an account refused
   * on a contract's required lookup to a contact, a contract the same delete
   * was about to remove; the other order deleted. A refusal from a row outside
   * the set is unchanged, and so is the unit of work: the set is collected
   * inside the transaction that `delete()` opens for the cascade.
   *
   * A nested `delete()` the walk makes for a member joins the ambient set
   * ({@link cascadeDeleteSets}); any other delete reaching here — a hook's,
   * say — is the root of its own cascade, as before.
   */
  static async cascadeDeleteRelations(this: Pick<CascadePlanningHost, '_registry' | 'cascadeDeleteSets' | 'collectCascadeDeleteSet' | 'refuseRestrictsInsideOwnCascade' | 'walkReferencingRelations'>, object: string, ids: ReadonlyArray<string | number>, context?: ExecutionContext, depth = 0): Promise<void> {
    const roots: Array<string | number> = [];
    const seen = new Set<string>();
    for (const id of ids) {
      if (id == null || seen.has(String(id))) continue;
      seen.add(String(id));
      roots.push(id);
    }
    if (roots.length === 0 || depth >= ObjectQL.MAX_CASCADE_DEPTH) return;
    // [#9002] The registry read is UNGUARDED, deliberately — and this is the
    // statement that decides whether the cascade runs AT ALL.
    //
    // It used to sit behind a bare `catch { return; }`, which is the #8895
    // shape one layer up: #8895's `catch` invented "no dependents" for ONE
    // relation whose probe could not run; this one invented "no relations" for
    // EVERY relation at once, before the per-relation probe was ever reached —
    // no `restrict` refusal, no `set_null`, no `cascade`, nothing logged, and
    // the caller told the delete succeeded.
    //
    // #8895 ruled the family *discriminate or propagate*. Discrimination needs
    // a benign failure class — there it was the unprovisioned child TABLE,
    // which genuinely cannot hold a referencing row. Here there is none: an
    // unreadable registry is never truthfully "no relations", so `propagate`
    // is the whole answer and the `catch` has nothing left to do.
    //
    // No new error code and no new response field: whatever the registry read
    // raised reaches the caller with its envelope intact, exactly as #8895's
    // probe failure does.
    const objects: ServiceObject[] = this._registry.getAllObjects();
    // [#22305] A member of a cascade already in progress joins that cascade's
    // set. Any other delete is the root of its own cascade, and collects the
    // set first: before one refusal is judged and before one row is written.
    const inherited = this.cascadeDeleteSets.getStore();
    const joining = inherited ? roots.filter((id) => cascadeSetHas(inherited.members, object, id)) : [];
    if (inherited && joining.length > 0) {
      await this.walkReferencingRelations(object, joining, context, objects, inherited);
    }
    const fresh = joining.length > 0 ? roots.filter((id) => !cascadeSetHas(inherited!.members, object, id)) : roots;
    if (fresh.length === 0) return;
    const cascadeSet = await this.collectCascadeDeleteSet(object, fresh, context, objects);
    // [#26718] Every restrict a member's own cascade would override is judged
    // here, before the first write.
    await this.refuseRestrictsInsideOwnCascade(cascadeSet, fresh.map((id) => ({ object, id })), context, objects);
    await this.cascadeDeleteSets.run(cascadeSet, () =>
      this.walkReferencingRelations(object, fresh, context, objects, cascadeSet),
    );
  }

  /**
   * Does `fieldName` on `child` point at `object` as a relation the cascade
   * walk follows, and with which behaviour? `undefined` when it does not. The
   * behaviour is the RESOLVED one, before the required-`set_null` escalation,
   * which also reads the field's `multiple` and, on a multi-value field, the
   * rows themselves.
   *
   * [#22305] Lifted out of the walk so both phases of
   * {@link cascadeDeleteRelations} read relations one way: the set the first
   * collects is the set the second deletes.
   */
  static cascadeRelationBehavior(this: Pick<CascadePlanningHost, 'resolveObjectName'>, object: string, child: ServiceObject, fieldName: string, fdef: any): string | undefined {
    // [#22957] The family test is the shared predicate, so this reader, the
    // two walks that read it and `planCascadeAtomicity` admit one family.
    if (!statesDeleteSemantics(fdef)) return undefined;
    // [#18550] Same arbiter, same absence-vs-unreadability split as
    // {@link ObjectQL.planCascadeAtomicity} states above — and this is the
    // seam where the silence was measurable end to end: an unreadable
    // carrier made the relation invisible to the cascade, so `delete()`
    // removed the parent, left a `master_detail` child behind, and
    // reported success. No `restrict` refusal, no `set_null`, nothing
    // logged. Absence still skips the field here exactly as before.
    const ref = deleteWalkTargetOf(fdef, 'ObjectQL.cascadeDeleteRelations');
    if (!ref) return undefined;
    // Match the target object by raw or resolved name.
    let resolvedRef: string | undefined;
    try { resolvedRef = this.resolveObjectName(ref); } catch { resolvedRef = undefined; }
    if (ref !== object && resolvedRef !== object) return undefined;

    // [#21910, #21918] A lookup the registry INJECTED into a federated
    // object, and the object does not provision, is not a reference to
    // anything, so it is not a relation to probe. That is the tenant
    // anchor `organization_id`, the ADR-0117 D1 anchor
    // `owning_business_unit_id`, and the owner and audit lookups
    // `owner_id` / `created_by` / `updated_by`. On a federated object each
    // exists in the registered schema and nowhere else: the probe below
    // was refused by the driver (`INVALID_FILTER`, no such column), its
    // catch propagated the refusal as #8895 rules for a missing column,
    // and deleting the organization, business unit or user it names was
    // refused on a deployment with a federated object bound.
    // `buildDriverOptions` and the related-record read already refuse this
    // reading of the tenant column.
    // {@link isFederatedUnprovisionedInjectedColumn} reads which columns
    // those are from the registry's own provenance, never from a list of
    // names, and {@link ObjectQL.planCascadeAtomicity} asks it too.
    //
    // ⛔ The probe's catch ({@link probeReferencingRows}) is deliberately NOT
    // widened to pass a missing column as benign. That would invert #8895's
    // discriminate or propagate for every object, not just these injected
    // columns: a lookup the author declared on a federated object, including
    // an author's own `organization_id` or `owner_id`, stays in the scan, and
    // its probe failure still propagates.
    if (isFederatedUnprovisionedInjectedColumn(child, fieldName)) return undefined;

    // A master-detail parent owns its children: cascade by default (the
    // child FK is typically required, so set_null would be invalid). Only
    // an explicit `restrict` deviates. A plain lookup honors its
    // configured deleteBehavior (default set_null).
    //
    // [#22957] A `tree` reads like a `lookup`: the spec materializes the same
    // `set_null` default on it, and an authored `cascade` / `restrict` is
    // honoured as written. Its `cascade` is a subtree delete, and a cycle in
    // the data (a corrupt row pointing at its own descendant) terminates on
    // the cascade set, the same membership test any self-reference has.
    //
    // [#29253] A `user` field reaches here only with an authored value
    // ({@link statesDeleteSemantics}), and reads it as a `lookup` reads its
    // own: the `|| 'set_null'` fallback below is never what a `user` gets.
    //
    // [#9625] "Only an explicit `restrict` deviates" is the whole of it:
    // every other value a master_detail can declare — including an
    // explicit `deleteBehavior: 'set_null'` — resolves to `cascade` here,
    // silently. Measured and pinned (`engine-cascade-delete.test.ts`).
    return fdef.type === 'master_detail'
      ? (fdef.deleteBehavior === 'restrict' ? 'restrict' : 'cascade')
      : (fdef.deleteBehavior || 'set_null');
  }

  /**
   * [#12166, ruling constraint 3] File the elevation record for a probe of
   * `childName` made while deleting `object`/`id` — once. One record per
   * referenced OBJECT, not per relation: two lookup fields on the same child
   * pointing at the same parent are one "the platform read object X as
   * system" fact, and filing it twice would make the ledger's row count a
   * function of the child's field layout.
   *
   * [#22305] The dedupe is the cascade's, not one call's: the collection walk
   * and the deleting walk probe the same cascading relations, and between
   * them file one record per deleted record per referenced object, as the
   * single walk did.
   */
  static fileReferenceCheckElevation(this: Pick<CascadePlanningHost, 'recordReferenceCheckElevation'>, set: CascadeDeleteSet, object: string, id: string | number, childName: string, fieldName: string, context: ExecutionContext | undefined): void {
    const key = JSON.stringify([object, String(id), childName]);
    if (set.elevationsFiled.has(key)) return;
    set.elevationsFiled.add(key);
    this.recordReferenceCheckElevation(object, id, childName, fieldName, context);
  }

  /**
   * [#27004] {@link referenceProbeFilter} for a SET of records: the rows that
   * reference any of `ids`. A single-valued reference asks `$in`; a
   * multi-valued one ORs each id's own limbs, the spelling the nested-relation
   * lowering already sends for a multiple lookup. One id is that id's own
   * filter, byte for byte.
   */
  static referenceProbeFilterOfSet(this: Pick<CascadePlanningHost, 'referenceProbeFilter'>, fieldName: string, fdef: { type?: unknown; multiple?: unknown }, ids: ReadonlyArray<string | number>): Record<string, unknown> {
    if (ids.length === 1) return this.referenceProbeFilter(fieldName, fdef, ids[0]);
    if (!declaredMultiValued(fdef)) return { [fieldName]: { $in: [...ids] } };
    return {
      $or: ids.flatMap((id) => {
        const limb = this.referenceProbeFilter(fieldName, fdef, id);
        return Array.isArray(limb.$or) ? (limb.$or as Array<Record<string, unknown>>) : [limb];
      }),
    };
  }

  /**
   * [#27004] The dependents probe ({@link probeReferencingRows}) for a SET of
   * records of one object: the rows of `childName` referencing each of `ids`,
   * keyed by `String(id)`. One read per {@link REFERENCE_PROBE_BATCH} ids, so a
   * walk over a predicate delete's matched rows costs one probe per relation
   * per batch rather than one per row; a batch of one is the by-id probe,
   * filter and all.
   *
   * Each row is then given to the ids it references: its stored value on a
   * single-valued field, its members on a multi-valued one (the #9362 exact
   * reading, {@link storedReferenceIncludes}). A row of a single-valued field
   * whose value names none of the batch (a driver comparing ids in a way
   * `String()` does not) is never dropped: that batch is asked again id by
   * id, which is the by-id answer.
   */
  static async probeReferencingRowsOfSet(this: Pick<CascadePlanningHost, 'probeReferencingRows' | 'referenceProbeFilter' | 'referenceProbeFilterOfSet'>, childName: string, fieldName: string, fdef: any, ids: ReadonlyArray<string | number>, context: ExecutionContext | undefined): Promise<Map<string, any[]>> {
    const byId = new Map<string, any[]>();
    const multiValued = declaredMultiValued(fdef);
    const batchSize = ObjectQL.REFERENCE_PROBE_BATCH;
    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize);
      const rows = await this.probeReferencingRows(
        childName, fieldName, fdef, batch.length === 1 ? batch[0] : batch,
        this.referenceProbeFilterOfSet(fieldName, fdef, batch), context,
      );
      if (batch.length === 1) {
        byId.set(String(batch[0]), rows);
        continue;
      }
      const found = new Map<string, any[]>(batch.map((id) => [String(id), []]));
      let unattributed = false;
      for (const row of rows) {
        // The members' reading is `storedReferenceIncludes`'s, element by
        // element; a single value is compared as one.
        const stored = row?.[fieldName];
        const values: unknown[] = multiValued && Array.isArray(stored) ? stored : [stored];
        const held = new Set<string>();
        for (const v of values) {
          if (v == null || typeof v === 'object') continue;
          if (found.has(String(v))) held.add(String(v));
        }
        if (held.size === 0) { unattributed = true; break; }
        for (const key of held) found.get(key)!.push(row);
      }
      if (unattributed) {
        for (const id of batch) {
          found.set(String(id), await this.probeReferencingRows(
            childName, fieldName, fdef, id, this.referenceProbeFilter(fieldName, fdef, id), context,
          ));
        }
      }
      for (const [key, held] of found) byId.set(key, held);
    }
    return byId;
  }

  /**
   * [#22305] Phase 2 of {@link cascadeDeleteRelations}, for one record of
   * `cascadeSet`: refuse, clear or cascade each relation that points at it.
   * Unchanged from the single walk it was, but for three readings of the set:
   * a `restrict` and a `set_null` consider only rows OUTSIDE it, and a row the
   * walk has already entered is not cascaded into again.
   */
  static async walkReferencingRelations(this: Pick<CascadePlanningHost, 'cascadeIssuedDeletes' | 'cascadeRelationBehavior' | 'delete' | 'deleteRestrictedError' | 'fileReferenceCheckElevation' | 'isTenantColumnSetNull' | 'logger' | 'probeReferencingRowsOfSet' | 'referenceProbeFilter' | 'refuseOrganizationDeleteWhileOwned' | 'update'>, object: string, ids: ReadonlyArray<string | number>, context: ExecutionContext | undefined, objects: ServiceObject[], cascadeSet: CascadeDeleteSet): Promise<void> {
    // Entered before the first nested `delete()` can come back here: every
    // record of the set, so one member's cascade never deletes another.
    for (const id of ids) cascadeSetAdd(cascadeSet.entered, object, id);
    // [#24948] An organization that still owns rows is refused here, whole,
    // before the first relation below is cascaded or cleared.
    if (object === ORGANIZATION_OBJECT) {
      for (const id of ids) await this.refuseOrganizationDeleteWhileOwned(id, context, objects, cascadeSet);
    }
    for (const child of objects) {
      const childName = (child as any)?.name as string | undefined;
      const fields = (child as any)?.fields as Record<string, any> | undefined;
      if (!childName || !fields) continue;
      for (const [fieldName, fdef] of Object.entries(fields)) {
        const resolvedBehavior = this.cascadeRelationBehavior(object, child, fieldName, fdef);
        if (resolvedBehavior === undefined) continue;
        // [#24948] Judged by `refuseOrganizationDeleteWhileOwned` above, which
        // found no row outside the cascade set: there is nothing to clear, and
        // clearing is not on offer for this column anyway.
        if (this.isTenantColumnSetNull(object, child, fieldName, resolvedBehavior)) continue;
        // [#24948] A reference the organization's delete keeps as it is,
        // naming the deleted organization: never cleared, never counted.
        if (object === ORGANIZATION_OBJECT && resolvedBehavior === 'set_null' &&
            ObjectQL.keepsOrganizationReference(child, fieldName)) continue;
        let relationBehavior: string = resolvedBehavior;

        // [#9689] (maintainer ruling 2026-08-19, Q3 = B): the judgement the
        // #9625 comment in `cascadeRelationBehavior` deferred is now taken — `FieldSchema` REJECTS an
        // authored `deleteBehavior: 'set_null'` on a `master_detail` at parse
        // time, so the value is meaningful again: one that still reaches this
        // site came in around the parse seam (a raw `registerObject`, or a
        // stored/artifact row written before the tightening — the two
        // populations parse-time rejection measurably cannot catch, since the
        // engine registers raw objects and never re-parses). The coercion
        // itself stays: this delete is about to CASCADE children whose
        // declaration asked for them to be kept, and that divergence must be
        // loud and attributable, not silent. Sanctioned logger shape per
        // PR #9750: reach for `error`, fall back to `warn` — NEVER an optional
        // call like `logger.error?.()`, which emits nothing against a sink
        // with no `error`. Caveat, measured (#4447): a built app artifact
        // materializes FieldSchema defaults, so an artifact-loaded BARE
        // master_detail also carries `set_null` and logs here — that residual
        // imprecision is the materialized-default defect tracked as #9784, not
        // a reason to soften this log.
        if (fdef.type === 'master_detail' && fdef.deleteBehavior === 'set_null') {
          for (const id of ids) {
            const msg =
              `[cascade-delete] ${childName}.${fieldName} declares deleteBehavior: 'set_null' on a ` +
              `master_detail referencing '${object}' — that value is NOT honored on master_detail: the ` +
              `delete of ${object}/${String(id)} CASCADES its referencing child rows, the opposite of what ` +
              `the declaration asks (children kept). FieldSchema now rejects this combination at parse time; ` +
              `this row reached the engine around the parse seam (raw registration, or metadata stored ` +
              `before the tightening). Re-declare the field: 'restrict' refuses the parent delete while ` +
              `children exist (no data loss), 'cascade' (or omitting the key) accepts the cascade ` +
              `deliberately, or make it a lookup if children must survive the parent.`;
            if (typeof this.logger.error === 'function') this.logger.error(msg);
            else this.logger.warn(msg);
          }
        }

        // A REQUIRED foreign key cannot be nulled — set_null would issue an
        // UPDATE clearing the FK, which the child's required-field validator
        // rejects with a misleading "<field> is required" 400 (the field isn't
        // even on the object being deleted). That's a contradiction, not the
        // author's intent: a required FK means the child can't exist detached,
        // so deleting the parent must be RESTRICTed (SQL's default for a
        // NOT NULL FK). Authors who want the children gone set
        // deleteBehavior:'cascade' explicitly.
        //
        // [#9625] The test reads the RESOLVED `behavior` (`cascadeRelationBehavior`),
        // which no longer records how the value got there. So it escalates
        // BOTH the defaulted set_null and one the author wrote out as
        // `deleteBehavior: 'set_null'` — the two are indistinguishable here by
        // construction, and both are measured escalating
        // (`engine-cascade-delete.test.ts`). Only `cascade` and `restrict` are
        // untouched. The predecessor of this comment claimed the escalation
        // applied to the *defaulted* set_null alone; that was true of
        // `cascade`/`restrict` and false of an explicit `set_null`, which is
        // the half-truth #9625 measured. Say it the way the code behaves: the
        // escalation is a property of the RESOLVED behavior plus `required`,
        // not of what the author typed.
        //
        // [#9688] The rationale above is also what BOUNDS the escalation, and
        // on a `multiple: true` field it does not reach every row. The
        // set_null limb there does not clear the slot: since #9438 it removes
        // the deleted MEMBER and writes the remainder. So "a cleared required
        // FK trips the child's validator" is true of exactly one case — the
        // row whose set the removal would EMPTY, since `[]` is what the #9447
        // ruling (maintainer, 2026-08-18) says violates `required` on a
        // multi-value field, and what the record validator has rejected since
        // #9476. A row that still holds another live member is written a
        // NON-EMPTY set, which `required` accepts and no validator objects
        // to; refusing its parent's delete was broader than the contract, and
        // refused it citing a failure that could not have happened.
        //
        // Emptiness is a property of a ROW, not of the field — and no row has
        // been read at this point. So the multi-value half of the escalation
        // is DEFERRED to just after the dependents probe (search
        // `requiredSetNull` below), where the rows are known and exactly
        // narrowed. The single-valued half stays here and is unchanged:
        // clearing a scalar FK always writes `null`, so its premise needs no
        // row to hold.
        //
        // The deferral changes WHEN the decision is made, never who it is
        // reported to: a row that does keep the refusal still refuses THIS
        // relation before its own set_null write runs, so the caller is told
        // `DELETE_RESTRICTED` about the record it asked to delete, instead of
        // the child's own `required` 400 naming a field that is not on that
        // record's object at all.
        //
        // [#9362] `multiValued` is declared here rather than at the probe
        // because the probe's filter spelling, the set_null write below and
        // — since #9688 — this escalation all turn on it.
        // [#18408] Was `fdef.multiple === true`. See {@link declaredMultiValued}.
        const multiValued = declaredMultiValued(fdef);
        const requiredSetNull = relationBehavior === 'set_null' && fdef.required === true;
        if (requiredSetNull && !multiValued) {
          relationBehavior = 'restrict';
        }

        // [#12166, ruling constraint 3] File the elevation BEFORE it happens,
        // and file BOTH halves — triggered-by = the deleting operator,
        // executed-as = system (the Salesforce/Dataverse ledger shape).
        //
        // Before the probe rather than after, because the fact being recorded
        // is that the platform read this object under an identity the caller
        // does not hold. That is true whether the probe then finds rows, finds
        // none, refuses the delete, or fails — and a record written only on the
        // success path would be missing exactly the runs an auditor goes
        // looking for.
        for (const id of ids) this.fileReferenceCheckElevation(cascadeSet, object, id, childName, fieldName, context);

        // [#27004] One probe per batch of the set; each record then takes its
        // own rows, in the set's order.
        const referencing = await this.probeReferencingRowsOfSet(childName, fieldName, fdef, ids, context);
        const clearedKey = cascadeMemberKey(childName, fieldName);
        let cleared = cascadeSet.cleared.get(clearedKey);
        if (!cleared) { cleared = new Set(); cascadeSet.cleared.set(clearedKey, cleared); }
        for (const id of ids) {
          let behavior: string = relationBehavior;
          let dependents = referencing.get(String(id)) ?? [];
          if (dependents.length === 0) continue;

          // [#12166] The one record's probe filter: the DISCLOSURE re-probe in
          // `deleteRestrictedError` asks the identical question under the
          // caller's own identity. [#27004] The batched probe above is built from
          // this same filter, id by id ({@link referenceProbeFilterOfSet}), and
          // narrowed by the same reading, so the two cannot disagree about which
          // rows reference this record.
          const probeWhere = this.referenceProbeFilter(fieldName, fdef, id);

          // [#12166] The elevated probe's row IDENTITY, captured here — after the
          // multi-value narrowing and BEFORE the `requiredSetNull && multiValued`
          // narrowing below reduces `dependents` to the emptied subset. This is
          // the set the disclosure decision compares against, and the stage
          // matters: the emptied subset is computed from these rows' own stored
          // values, so a caller who can see exactly these rows can derive the
          // emptied count too, while a caller who cannot see them can derive
          // neither. Comparing at the later stage would leak the difference.
          const probedIds: readonly string[] = dependents.map((r: any) => String(r?.id));

          // [#22305] A row the cascade itself deletes refuses nothing and is
          // cleared of nothing: the triage ruling on #22305 is that a child in the
          // cascade set never restricts a sibling in the same set. Such a row is
          // not left dangling, because this same unit of work removes it, and
          // clearing its reference would be a write against a row about to go.
          // (The one cascade that is not one unit of work is
          // `planCascadeAtomicity`'s `'split'`: there a later refusal can strand
          // such a row, the partial outcome `warnCascadeNotAtomic` already
          // declares for every row that path deletes.) So `restrict` (authored,
          // or either half of the required escalation) and `set_null` judge only
          // the rows OUTSIDE the set, and a relation whose rows are all inside it
          // is done. `cascade` keeps every row: its rows ARE the set, and the
          // walk deletes them below.
          //
          // [#26718] …except an AUTHORED restrict held by a row the cascade reaches
          // only through the record that restrict protects: that one was judged
          // before the cascade wrote anything ({@link refuseRestrictsInsideOwnCascade}),
          // so a row in the set reaching here refuses nothing.
          //
          // After `probedIds`, on purpose: the disclosure check still compares
          // the caller's own view against every row the elevated probe read, so a
          // count is disclosed only to a caller who can see the whole relation,
          // as before; what it counts is the rows that actually refuse.
          if (behavior !== 'cascade') {
            dependents = dependents.filter((row) => !cascadeSetHas(cascadeSet.members, childName, row?.id));
            if (dependents.length === 0) continue;
          }

          // [#9688] The deferred half of the required escalation, decided per
          // ROW now that the rows are read and exactly narrowed — every row
          // here genuinely holds `id`, so its remainder is its set minus that
          // one member.
          //
          // The emptiness question is asked through
          // `remainderAfterMemberRemoval`, which is the SAME computation the
          // set_null write below performs. One function, two call sites, so the
          // judgement cannot predict a shape the write would not produce: a
          // predicate that computed the remainder even slightly differently
          // could clear the delete and then let the write land the very `[]`
          // this judgement exists to prevent.
          //
          // ANY row that would be emptied refuses the WHOLE delete — a delete
          // either happens or it does not, and a partial cascade is not on
          // offer. `dependents` is reduced to those rows first, because every
          // number the refusal reports reads it: `dependentCount`, the
          // localized message's `count`, and the developerMessage. Counting the
          // rows this delete no longer refuses over is the second defect the
          // card names, and it is fixed by the same statement.
          if (requiredSetNull && multiValued) {
            const emptied = dependents.filter(
              (row) => ObjectQL.remainderAfterMemberRemoval(row?.[fieldName], id, cleared).length === 0,
            );
            if (emptied.length > 0) {
              behavior = 'restrict';
              dependents = emptied;
            }
          }

          if (behavior === 'restrict') {
            throw await this.deleteRestrictedError({
              object, id, child, childName, fieldName, fdef, dependents, probeWhere, probedIds, multiValued,
              objects, context,
            });
          }

          for (const dep of dependents) {
            const depId = dep?.id;
            if (depId == null) continue;
            if (behavior === 'cascade') {
              // [#22305] Entered already: an ancestor of this delete, still in
              // progress up the stack (a cycle in the data), or a row an earlier
              // branch of this cascade has deleted (a row reached by two paths).
              // Either way this cascade removes it once, and re-entering would
              // loop forever on the first and answer 404 on the second.
              if (cascadeSetHas(cascadeSet.entered, childName, depId)) continue;
              // Recurse via the public delete so the child's own cascade,
              // hooks and events fire.
              //
              // [#23221] Inside a token naming exactly this child, which that
              // delete claims and projects onto the DECLARED
              // `HookContext.referentialCascadeDelete` (see
              // claimReferentialCascadeDelete): on the real request path the
              // caller's context reaches the child unchanged, so without it a
              // freeze guard cannot tell this delete from a hand delete of the
              // same row. The context is passed as before, by reference and
              // unmarked — see `cascadeIssuedDeletes` for why the marker is not
              // a context key. A grandchild is issued by the child's own walk,
              // inside a token of its own.
              await this.cascadeIssuedDeletes.run(
                { object: childName, id: String(depId), claimed: false },
                () => this.delete(childName, { where: { id: depId }, context } as any),
              );
            } else {
              // [#3023] Clear the FK as an engine-internal referential-integrity
              // write, tagged so plugin-security's ownership-anchor guard (#3004)
              // treats an `owner_id = null` cascade as integrity maintenance, not
              // a user-initiated disown — otherwise deleting the referenced record
              // trips the transfer guard and aborts the cascade mid-way. Marker
              // rides a server-DERIVED context (set here, never from client input
              // — same trust model as `__expandRead`), so it cannot be forged from
              // a request to bypass the guard on an ordinary write.
              //
              // [commit 34ce8e7db] This same marker is what `update()`'s hook-context
              // assembly projects onto the DECLARED `HookContext.
              // referentialFieldClear` (see buildReferentialFieldClear), so an
              // app guard can recognise the cleanup without reading an
              // operation-private key — on the real request path the inherited
              // caller envelope makes the cleanup otherwise indistinguishable
              // from a hand-clear of the same lookup.
              //
              // [#20006] `__referentialFieldClearCause` rides beside it: the
              // delete this cleanup serves and the reference it clears, which a
              // traversing rule's refusal of the cleanup names (see
              // `resolvePredicateRelated`). It authorizes nothing — it is read
              // only where the marker already holds, and only to word a refusal —
              // and the referencing row's id in it never reaches that text.
              const referentialCtx = {
                ...(context ?? {}),
                __referentialFieldClear: true,
                __referentialFieldClearCause: {
                  object, id: String(id), referencingObject: childName, referencingId: String(depId), field: fieldName,
                },
              } as ExecutionContext;
              if (multiValued) {
                // The FK is a SET, so `set_null` clears the deleted MEMBER, not
                // the slot: filter the stored array and write what remains.
                // Nulling the slot instead discarded every other live reference
                // (measured: `["acc_a","acc_b"]` re-read as `null` after
                // `acc_a` was deleted).
                //
                // The residual shape when the last member goes is not this
                // engine's call to make: `FieldSchema` pins it —
                // `packages/spec/src/data/field.zod.ts`, the `multiple` and
                // `required` doc blocks (ruling A on #29343, record
                // 6591577985, amending #9447) — and this write consumes that
                // contract: it hands the write door the `[]` that
                // `Array.prototype.filter` yields, and the door stores an
                // emptied optional set as `null` (`blankAsNullColumns`, reach
                // `'emptyList'`), the same as one never set.
                //
                // [#9688] The remainder is computed by
                // `remainderAfterMemberRemoval`, which the per-row required
                // judgement above calls on the same row: this write is only
                // reached for a row that judgement measured as keeping at least
                // one other member, and the two must agree by construction.
                // The reading it applies — `String(v) !== String(id)`, and an
                // off-shape bare scalar normalized to the array spelling — is
                // documented there.
                const next = ObjectQL.remainderAfterMemberRemoval(dep?.[fieldName], id, cleared);
                await this.update(childName, { id: depId, [fieldName]: next }, { context: referentialCtx } as any);
              } else {
                await this.update(childName, { id: depId, [fieldName]: null }, { context: referentialCtx } as any);
              }
            }
          }
          // [#27004] Every row outside the set has had `id` cleared from it.
          cleared.add(String(id));
        }
      }
    }
  }

  /**
   * [#24948] Is `fieldName` on `child` the TENANT column of `child`, pointing at
   * the organization being deleted with the `set_null` behaviour?
   *
   * The tenant column is the one `resolveTenantFieldName` names: the column
   * the engine stamps and scopes by, whether the registry injected it
   * (`TENANT_SCOPE_FIELD_DEF`) or the object declared its own, as the identity
   * tables do. Every such lookup resolves to `set_null` unless its author wrote
   * something else, and ADR-0131 D1 leaves NULL nothing to mean: a cleared
   * tenant column is an orphan, and on a store whose column is already NOT
   * NULL the clear is a constraint failure halfway through a delete. So the
   * engine never clears one. {@link refuseOrganizationDeleteWhileOwned} refuses
   * the delete instead. An authored `cascade` or `restrict` keeps its own
   * meaning.
   */
  static isTenantColumnSetNull(object: string, child: ServiceObject, fieldName: string, behavior: string | undefined): boolean {
    return (
      object === ORGANIZATION_OBJECT &&
      behavior === 'set_null' &&
      resolveTenantFieldName(child) === fieldName
    );
  }

  /**
   * [#24948] Do `child`'s rows outlive the organization they name? Read from
   * the declaration the object already carries, never from a list of names:
   *
   *   - `managedBy: 'append-only'`, a ledger (the audit bucket: `sys_activity`,
   *     `sys_audit_log`, `sys_email` and their siblings). Such a row is history:
   *     it ages out on its own retention, or is the delivery log of something
   *     that already happened. The organization delete itself writes
   *     `sys_activity` rows, so a ledger that counted would refuse every
   *     organization delete, the empty ones included (seat decision 6305179819).
   *   - `managedBy: 'engine-owned'`, a row the platform writes as a consequence
   *     of records or activity (approval state, automation runs, notification
   *     and HTTP deliveries, mirrored mail, record shares, import jobs,
   *     settings values), which an administrator cannot delete over the data
   *     API. Counting it would make any organization that has been used
   *     undeletable through every door (seat decision 6307135388).
   *
   * Neither refusal counts such a row. It is kept, and so is every reference it
   * holds to the organization: it goes on naming the deleted organization,
   * never NULL (ADR-0131 D1) and never deleted (ADR-0131 §8), and under tenant
   * scoping the row reads as no organization's.
   */
  static outlivesOrganization(child: ServiceObject): boolean {
    const managedBy = (child as { managedBy?: unknown })?.managedBy;
    return managedBy === 'append-only' || managedBy === 'engine-owned';
  }

  /**
   * [#24948] Does an organization delete keep `child.fieldName`, a `set_null`
   * lookup into `sys_organization` that is not `child`'s tenant column, as it
   * is? Two kinds of reference, and only these (seat decisions 6305179819,
   * 6305996369 and 6307135388):
   *
   *   - every such lookup on an object whose rows outlive the organization
   *     ({@link outlivesOrganization}): `sys_audit_log.tenant_id` is the audit
   *     log's attribution, not its tenant column, and history outlives what it
   *     audits;
   *   - an attribution column named `organization_id` on an object whose
   *     tenancy is disabled (`resolveTenantFieldName` answers null): neither
   *     counted nor cleared. No object in this tree declares one today.
   *
   * Everything else keeps its `set_null`: a pointer such as a session's or an
   * API key's `active_organization_id`, or a parent-organization lookup, is
   * cleared exactly as before.
   */
  static keepsOrganizationReference(child: ServiceObject, fieldName: string): boolean {
    if (ObjectQL.outlivesOrganization(child)) return true;
    return fieldName === SystemFieldName.ORGANIZATION_ID && resolveTenantFieldName(child) === null;
  }

  /**
   * [#24948] How many rows of `childName` name the organization `id` through
   * `fieldName`, leaving out the rows the cascade itself deletes. A system
   * `count`, never a row read, for every table the cascade deletes no row of,
   * which is every table but the cascading children of the organization (none
   * on the platform). Only for such a table are the rows probed
   * ({@link probeReferencingRows}), so the cascade's own members can be left
   * out exactly. A table never provisioned holds none.
   */
  static async countReferencingRowsOutside(this: Pick<CascadePlanningHost, 'count' | 'probeReferencingRows' | 'referenceProbeFilter'>, childName: string, fieldName: string, fdef: any, id: string | number, cascadeSet: CascadeDeleteSet, context: ExecutionContext | undefined): Promise<{ where: Record<string, unknown>; count: number }> {
    const where = this.referenceProbeFilter(fieldName, fdef, id);
    if ((cascadeSet.members.get(childName)?.size ?? 0) > 0) {
      const probed = await this.probeReferencingRows(childName, fieldName, fdef, id, where, context);
      return { where, count: probed.filter((row) => !cascadeSetHas(cascadeSet.members, childName, row?.id)).length };
    }
    try {
      return { where, count: await this.count(childName, { where, context: ObjectQL.organizationCountContext(context) }) };
    } catch (error) {
      if (isMissingTableError(error, childName)) return { where, count: 0 };
      throw error;
    }
  }

  /**
   * [#24948] The context an organization's row counts run under: system
   * identity, and nothing of the caller's scope. A `tenantId` carried in from
   * a caller acting in another organization would scope the count to THAT
   * organization and read 0 rows naming this one, so the refusal would pass on
   * an undercount. Only the request's transaction and trace are kept: the
   * count must see the request's own uncommitted writes. The ordinary
   * reference probes keep the caller's scope ({@link referenceCheckContext}).
   */
  static organizationCountContext(context?: ExecutionContext): ExecutionContext {
    return {
      isSystem: true,
      ...(context?.transaction !== undefined ? { transaction: context.transaction } : {}),
      ...(context?.traceId !== undefined ? { traceId: context.traceId } : {}),
    } as ExecutionContext;
  }

  /**
   * [#24948] May the refusal disclose `count` to the caller? Only when the
   * caller's own identity counts the same rows: the elevated count read rows
   * the caller may not see. (A system caller's own count is the elevated one.)
   */
  static async organizationCountIsDisclosable(this: Pick<CascadePlanningHost, 'count' | 'logger'>, childName: string, where: Record<string, unknown>, count: number, context: ExecutionContext | undefined): Promise<boolean> {
    try {
      return (await this.count(childName, { where, context })) === count;
    } catch (error) {
      // The refusal stands either way; only the number is withheld.
      this.logger.warn('[cascade-delete] disclosure count failed; the refusal names the table without a count', {
        object: childName, error: (error as Error)?.message ?? String(error),
      });
      return false;
    }
  }

  /**
   * [#24948] The engine half of organization delete: refuse while any row
   * outside the cascade set still names the organization in its tenant column,
   * a row that outlives the organization excepted ({@link outlivesOrganization}).
   *
   * Runs before the walk touches the first relation, and reads every tenant
   * relation before it throws, so the one refusal names every table that holds
   * rows, each with its count. It is the safety net under plugin-auth's own
   * refusal, which answers the same question before better-auth deletes the
   * organization's members: whatever path reaches a `sys_organization` delete,
   * no row is orphaned to NULL, on a store born with a nullable tenant column
   * or anywhere else.
   *
   * Each relation is COUNTED ({@link countReferencingRowsOutside}: system
   * identity, its elevation filed first, a missing table read as no rows),
   * never read row by row, so a large organization costs one `count` per
   * table. A count reaches the refusal only when the caller's own identity
   * counts the same ({@link organizationCountIsDisclosable}); otherwise the
   * table is named without one. The wire code is the standard catalog's `DELETE_RESTRICTED`,
   * because that is the condition: a delete refused while dependents exist.
   */
  static async refuseOrganizationDeleteWhileOwned(this: Pick<CascadePlanningHost, 'cascadeRelationBehavior' | 'countReferencingRowsOutside' | 'fileReferenceCheckElevation' | 'isTenantColumnSetNull' | 'organizationCountIsDisclosable'>, id: string | number, context: ExecutionContext | undefined, objects: ServiceObject[], cascadeSet: CascadeDeleteSet): Promise<void> {
    const owned: Array<{ object: string; count?: number }> = [];
    for (const child of objects) {
      const childName = (child as any)?.name as string | undefined;
      const fields = (child as any)?.fields as Record<string, any> | undefined;
      // An append-only or engine-owned object's rows outlive the organization: not counted, kept as they are.
      if (!childName || !fields || ObjectQL.outlivesOrganization(child)) continue;
      for (const [fieldName, fdef] of Object.entries(fields)) {
        const behavior = this.cascadeRelationBehavior(ORGANIZATION_OBJECT, child, fieldName, fdef);
        if (!this.isTenantColumnSetNull(ORGANIZATION_OBJECT, child, fieldName, behavior)) continue;
        this.fileReferenceCheckElevation(cascadeSet, ORGANIZATION_OBJECT, id, childName, fieldName, context);
        const { where, count } = await this.countReferencingRowsOutside(childName, fieldName, fdef, id, cascadeSet, context);
        if (count === 0) continue;
        const disclose = await this.organizationCountIsDisclosable(childName, where, count, context);
        owned.push(disclose ? { object: childName, count } : { object: childName });
      }
    }
    if (owned.length === 0) return;
    const named = owned
      .map((o) => (o.count === undefined ? o.object : `${o.object} (${o.count})`))
      .join(', ');
    const err: any = new Error(
      `Cannot delete this organization: it still owns records in ${named}. ` +
        'Delete or move those records first, then delete the organization.',
    );
    err.developerMessage =
      `Cannot delete ${ORGANIZATION_OBJECT} (${id}): rows still reference it through their tenant column ` +
      `in ${named}. The engine never clears a tenant column (ADR-0131 D1), so the delete is refused ` +
      'until those rows are deleted or moved to another organization.';
    err.code = 'DELETE_RESTRICTED';
    err.status = 409;
    err.httpStatus = 409;
    err.object = ORGANIZATION_OBJECT;
    // The first table in the `DELETE_RESTRICTED` envelope's own two keys, and
    // every table in `dependents`.
    err.dependentObject = owned[0].object;
    if (owned[0].count !== undefined) err.dependentCount = owned[0].count;
    err.dependents = owned;
    throw err;
  }

  /** The body of `ObjectQL#organizationOwnedRowCounts`; the method's docblock there is its contract. */
  static async organizationOwnedRowCounts(this: Pick<CascadePlanningHost, '_registry' | 'cascadeRelationBehavior' | 'count' | 'referenceProbeFilter'>, organizationId: string, options?: { exclude?: Iterable<string>; context?: ExecutionContext }): Promise<Array<{ object: string; count: number }>> {
    const exclude = new Set(options?.exclude ?? []);
    const counts: Array<{ object: string; count: number }> = [];
    for (const child of this._registry.getAllObjects()) {
      const childName = (child as any)?.name as string | undefined;
      const fields = (child as any)?.fields as Record<string, any> | undefined;
      if (!childName || !fields || exclude.has(childName) || ObjectQL.outlivesOrganization(child)) continue;
      const tenantField = resolveTenantFieldName(child);
      if (!tenantField || !fields[tenantField]) continue;
      const fdef = fields[tenantField];
      if (this.cascadeRelationBehavior(ORGANIZATION_OBJECT, child, tenantField, fdef) === undefined) continue;
      let count: number;
      try {
        count = await this.count(childName, {
          where: this.referenceProbeFilter(tenantField, fdef, organizationId),
          context: ObjectQL.organizationCountContext(options?.context),
        });
      } catch (error) {
        if (isMissingTableError(error, childName)) continue;
        throw error;
      }
      if (count > 0) counts.push({ object: childName, count });
    }
    return counts;
  }
}
