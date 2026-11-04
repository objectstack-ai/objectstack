// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29986 codemod] The "Cascade and referential delete planning" section of
 * `ObjectQL`: the bodies of `warnCascadeNotAtomic`, `cascadeRelationBehavior`,
 * `referenceProbeFilterOfSet`, `isTenantColumnSetNull`,
 * `organizationCountIsDisclosable` moved out of `engine.ts` whole by
 * `scripts/codemod-split-engine.mjs`.
 *
 * A MOVE, not a redesign. Each function below is the body of the `ObjectQL`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class with its docblock and
 * signature, so the published `dist/*.d.ts`, an instance spy and a subclass
 * override are what they were; the docblock there is the contract.
 *
 * The bodies reach the class through {@link CascadePlanningHost}: exactly the
 * `ObjectQL` members they read, private ones included. Each method hands its
 * body one literal of the members that body reads, plus a `.call`: methods go
 * as closures that call them on the engine at call time, so a subclass
 * override or an instance spy is still the one reached; fields and accessors
 * go as GETTERS, read when the body reads them, as they were on the class.
 *
 * The module imports `engine.ts` for types only, so the two modules form no
 * evaluation cycle. `index.ts` re-exports nothing from this module.
 */

import type { ServiceObject } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { ORGANIZATION_OBJECT, resolveTenantFieldName } from './tenancy/system-write-organization.js';
import { isFederatedUnprovisionedInjectedColumn } from './federated-object.js';
import { declaredMultiValued, deleteWalkTargetOf, statesDeleteSemantics } from './engine-top-level.js';
import type { ObjectQL } from './engine.js';

/**
 * The `ObjectQL` members the functions below read — every one of them, and
 * no other. Each is typed AS the class member (an indexed access on the
 * class), so a change to a member's signature on the class is a change here
 * too. `readonly` members are the getters.
 */
export interface CascadePlanningHost {
  readonly cascadeNotAtomicReported: ObjectQL['cascadeNotAtomicReported'];
  count: ObjectQL['count'];
  readonly defaultDriver: ObjectQL['defaultDriver'];
  readonly logger: ObjectQL['logger'];
  referenceProbeFilter: ObjectQL['referenceProbeFilter'];
  resolveObjectName: ObjectQL['resolveObjectName'];
}

/** The body of `ObjectQL#warnCascadeNotAtomic`; the method's docblock there is its contract. */
export function warnCascadeNotAtomic(this: Pick<CascadePlanningHost, 'cascadeNotAtomicReported' | 'defaultDriver' | 'logger'>, object: string): void {
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

/** The body of `ObjectQL#cascadeRelationBehavior`; the method's docblock there is its contract. */
export function cascadeRelationBehavior(this: Pick<CascadePlanningHost, 'resolveObjectName'>, object: string, child: ServiceObject, fieldName: string, fdef: any): string | undefined {
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

/** The body of `ObjectQL#referenceProbeFilterOfSet`; the method's docblock there is its contract. */
export function referenceProbeFilterOfSet(this: Pick<CascadePlanningHost, 'referenceProbeFilter'>, fieldName: string, fdef: { type?: unknown; multiple?: unknown }, ids: ReadonlyArray<string | number>): Record<string, unknown> {
    if (ids.length === 1) return this.referenceProbeFilter(fieldName, fdef, ids[0]);
    if (!declaredMultiValued(fdef)) return { [fieldName]: { $in: [...ids] } };
    return {
      $or: ids.flatMap((id) => {
        const limb = this.referenceProbeFilter(fieldName, fdef, id);
        return Array.isArray(limb.$or) ? (limb.$or as Array<Record<string, unknown>>) : [limb];
      }),
    };
  }

/** The body of `ObjectQL#isTenantColumnSetNull`; the method's docblock there is its contract. */
export function isTenantColumnSetNull(object: string, child: ServiceObject, fieldName: string, behavior: string | undefined): boolean {
    return (
      object === ORGANIZATION_OBJECT &&
      behavior === 'set_null' &&
      resolveTenantFieldName(child) === fieldName
    );
  }

/** The body of `ObjectQL#organizationCountIsDisclosable`; the method's docblock there is its contract. */
export async function organizationCountIsDisclosable(this: Pick<CascadePlanningHost, 'count' | 'logger'>, childName: string, where: Record<string, unknown>, count: number, context: ExecutionContext | undefined): Promise<boolean> {
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
