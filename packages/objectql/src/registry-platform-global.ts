// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#33949 codemod] The "Platform-global declaration and uninstall checks"
 * section of `SchemaRegistry`: the bodies of
 * `setDeploymentPlatformGlobalObjects`, `applyDeploymentTenancy`,
 * `stripDeploymentTenancyFrom`, `deploymentWithholdsTenant`,
 * `stripProvisionedTenantIndexFrom`, `stripProvisionedPrimaryFrom`,
 * `subtractExtenderContributions`, `resolveOwnerLayer`, `getObject`,
 * `resolveObjectKey`, `getAllObjects`, `getObjectContributors`,
 * `getObjectExtensionsOf`, `getObjectOwner`, `getPackagedObjectOwner`,
 * `getPackagedObjectBase`, `extendContributionRefusal`,
 * `registerObjectExtension`, `extensionTargetKey`, `withdrawObjectExtension`,
 * `removeObjectOverlay`, `assertSingleOwnerPerObject`,
 * `unregisterObjectsByPackage`, `unregisterObject` moved out of `registry.ts`
 * whole by
 * the #33949 split codemod (PR #34285, kept in its branch history, not committed).
 *
 * A MOVE, not a redesign. {@link PlatformGlobalFacet} is a stateless facet of `SchemaRegistry`
 * (ruling 6624345766): each static method of it is the body of the `SchemaRegistry`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class as a one-call stub with
 * its signature, so the published surface, an instance spy and a subclass
 * override are what they were. A public or protected method keeps its
 * docblock on the class, the contract; a private method's docblock moved here
 * with its body. The state stays on `SchemaRegistry`.
 *
 * The bodies reach the class through {@link PlatformGlobalHost}: exactly the
 * `SchemaRegistry` members they read, private ones included. Every stub hands
 * its body, by a `.call`, the same host: `platformGlobalHost` in
 * `registry-facet-hosts.ts`, built once per registry by the class's static
 * block. Methods go as closures that call them on the registry at call time, so
 * a subclass override or an instance spy is still the one reached; fields and
 * accessors go as GETTERS, read when the body reads them, as they were on the
 * class, and a field a body assigns goes with a SETTER that assigns it on the
 * registry.
 *
 * Values that stayed in `registry.ts` are imported from it (lever (a) of
 * ruling 6591753301); every use is inside a function body, so the import
 * cycle is never read at evaluation time. `index.ts` re-exports nothing from
 * this module.
 */

import { isInjectedColumnDefinition, provisionPrimary, resolveInjectedSystemColumns } from '@objectstack/spec/data';
import type { ServiceObject } from '@objectstack/spec/data';
import { TENANT_SCOPE_FIELD_DEF, isCodeArtifactBody } from '@objectstack/metadata-core';
import { DEFAULT_EXTENDER_PRIORITY, applyFieldPatches, ownFieldNamesOf, packagedAddedFields, stableStringify, withoutField } from './registry-top-level.js';
import type { ObjectContributor, ObjectExtensionBody, ObjectExtensionFoldOptions } from './registry-top-level.js';
import { TENANT_SCOPE_INDEX, extendContributionRefusal, provisionTenantScopeIndex } from './registry.js';
import type { SchemaRegistry } from './registry.js';

/**
 * The `SchemaRegistry` members the bodies of {@link PlatformGlobalFacet} read — every one of
 * them, and no other. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too. `readonly` members are the getters; the others are fields a body
 * assigns.
 */
export interface PlatformGlobalHost {
  _objectRevision: SchemaRegistry['_objectRevision'];
  applyDeploymentTenancy: SchemaRegistry['applyDeploymentTenancy'];
  assertPackageUninstallable: SchemaRegistry['assertPackageUninstallable'];
  closeObjectEntry: SchemaRegistry['closeObjectEntry'];
  deploymentPlatformGlobalObjects: SchemaRegistry['deploymentPlatformGlobalObjects'];
  deploymentWithholdsTenant: SchemaRegistry['deploymentWithholdsTenant'];
  readonly extensionSpellingWarned: SchemaRegistry['extensionSpellingWarned'];
  foldExtenders: SchemaRegistry['foldExtenders'];
  getObjectOwner: SchemaRegistry['getObjectOwner'];
  getPackagedObjectBase: SchemaRegistry['getPackagedObjectBase'];
  getPackagedObjectOwner: SchemaRegistry['getPackagedObjectOwner'];
  invalidateAll: SchemaRegistry['invalidateAll'];
  isPackageDisabled: SchemaRegistry['isPackageDisabled'];
  log: SchemaRegistry['log'];
  readonly mergedObjectCache: SchemaRegistry['mergedObjectCache'];
  readonly multiTenant: SchemaRegistry['multiTenant'];
  readonly objectContributors: SchemaRegistry['objectContributors'];
  readonly objectKeysByShortName: SchemaRegistry['objectKeysByShortName'];
  packagedRules: SchemaRegistry['packagedRules'];
  registerObject: SchemaRegistry['registerObject'];
  resolveObject: SchemaRegistry['resolveObject'];
  resolveObjectKey: SchemaRegistry['resolveObjectKey'];
  resolveObjectLeavingExtensionsOut: SchemaRegistry['resolveObjectLeavingExtensionsOut'];
  stripProvisionedTenantIndexFrom: SchemaRegistry['stripProvisionedTenantIndexFrom'];
}

/** The bodies of the "Platform-global declaration and uninstall checks" section of `SchemaRegistry`: a stateless facet, called by the class's stubs. */
export class PlatformGlobalFacet {
  /** The body of `SchemaRegistry#setDeploymentPlatformGlobalObjects`; the method's docblock there is its contract. */
  static setDeploymentPlatformGlobalObjects(this: Pick<PlatformGlobalHost, 'applyDeploymentTenancy' | 'deploymentPlatformGlobalObjects' | 'deploymentWithholdsTenant' | 'invalidateAll' | 'objectContributors' | 'stripProvisionedTenantIndexFrom'>, names: Iterable<string>): {
    readonly replanned: readonly string[];
    readonly keptAuthoredColumn: readonly string[];
  } {
    this.deploymentPlatformGlobalObjects = new Set(names);
    const replanned = new Set<string>();
    const keptAuthoredColumn = new Set<string>();
    if (this.deploymentPlatformGlobalObjects.size === 0) {
      return { replanned: [], keptAuthoredColumn: [] };
    }
    for (const contributors of this.objectContributors.values()) {
      for (const contributor of contributors) {
        const before = contributor.definition;
        const name = (before as { name?: unknown })?.name;
        if (typeof name !== 'string') continue;
        const orgField = (before.fields as Record<string, unknown> | undefined)?.organization_id;
        const authoredColumn = orgField !== undefined && !isInjectedColumnDefinition(orgField, TENANT_SCOPE_FIELD_DEF);
        // Asked of the body WITHOUT its column: the plan decides whether the
        // deployment withholds one, and the column's presence is not an input.
        if (!this.deploymentWithholdsTenant(withoutField(before, 'organization_id'))) continue;
        if (authoredColumn) {
          keptAuthoredColumn.add(name);
          continue;
        }
        // [#24314] An `extend` layer has nothing to re-plan: `registerObject`
        // plans base layers only, so it carries no platform column or index.
        if (contributor.ownership === 'extend') continue;
        // The tenant index comes off FIRST, while the body is still in the
        // state it was stamped in (the strip re-stamps to prove the entry is
        // the platform's own).
        const unindexed = this.stripProvisionedTenantIndexFrom(before);
        const after = this.applyDeploymentTenancy(unindexed);
        if (after !== before) {
          contributor.definition = after;
          replanned.add(name);
        }
      }
    }
    this.invalidateAll();
    return { replanned: [...replanned].sort(), keptAuthoredColumn: [...keptAuthoredColumn].sort() };
  }

  /**
   * [ADR-0131 D7] Record the deployment's platform-global declaration on one
   * base-layer body: a declared object carries no `organization_id` here and
   * declares `systemFields.tenant: false`.
   *
   * Why the record and not only the missing column: `systemFields.tenant:
   * false` is the vocabulary every reader of a registered object already
   * answers "no organization column" from — the security layer's
   * `tenancyDisabled` (so Layer 0 composes nothing and a wildcard
   * `organization_id` policy is not applicable, with no second reading of the
   * declaration), the tenant-index predicate above, the lifecycle's
   * provenance (`absent`), and the `/meta` read exits' own injection pass,
   * which re-plans a served body WITHOUT the deployment and would otherwise
   * add the column back. The object is then exactly what a deployment-level
   * object that declares the key itself is (ADR-0131 D7: governed by object
   * permission, not by the wall), on this deployment only.
   *
   * Withheld — `schema` returned by reference — when the object is not
   * declared, when its own declaration already plans no tenant column, and
   * when it DECLARES its own `organization_id` (not the platform's
   * definition, byte for byte): an authored column is the author's, and the
   * object stays walled on it. The decision reads only the body, so the read
   * exits ({@link materializeServedObjectOnto}) reach the same answer.
   */
  static applyDeploymentTenancy(this: Pick<PlatformGlobalHost, 'deploymentWithholdsTenant'>, schema: ServiceObject): ServiceObject {
    if (!this.deploymentWithholdsTenant(schema)) return schema;
    const fields = schema.fields as Record<string, unknown> | undefined;
    const orgField = fields?.organization_id;
    if (orgField !== undefined && !isInjectedColumnDefinition(orgField, TENANT_SCOPE_FIELD_DEF)) return schema;
    const sf = (schema as { systemFields?: unknown }).systemFields;
    const out = withoutField(schema, 'organization_id') as ServiceObject & { systemFields?: unknown };
    return {
      ...out,
      systemFields: {
        ...(sf && typeof sf === 'object' && !Array.isArray(sf) ? (sf as Record<string, unknown>) : {}),
        tenant: false,
      },
    } as ServiceObject;
  }

  /**
   * [ADR-0131 D7] The write-side inverse of {@link applyDeploymentTenancy}:
   * take the recorded `systemFields.tenant: false` back off a declared
   * object's body on its way IN, so a Studio GET → edit → PUT on the declaring
   * deployment persists the body the author wrote (#4326), not a deployment
   * fact that would outlive the declaration in `sys_metadata`.
   *
   * Exact in the way its siblings are: only a declared object, only the
   * `tenant: false` member, and the `systemFields` key itself only when that
   * member was all it held. The trade is theirs too — an author who wrote
   * `systemFields: { tenant: false }` on a declared object has it dropped on
   * the first save that carries it, and on this deployment the answer is
   * re-derived at every load, so nothing it provisions changes.
   *
   * Returns `base` by reference when nothing was owed.
   */
  static stripDeploymentTenancyFrom<T>(this: Pick<PlatformGlobalHost, 'deploymentWithholdsTenant'>, base: T): T {
    if (base === null || typeof base !== 'object') return base;
    const sf = (base as { systemFields?: unknown }).systemFields;
    if (!sf || typeof sf !== 'object' || Array.isArray(sf)) return base;
    if ((sf as { tenant?: unknown }).tenant !== false) return base;
    const { tenant: _tenant, ...restSystemFields } = sf as Record<string, unknown>;
    const out = { ...(base as Record<string, unknown>) };
    if (Object.keys(restSystemFields).length === 0) delete out.systemFields;
    else out.systemFields = restSystemFields;
    // Redundant with the derivation only where the deployment's plan withholds
    // the column from the body without the record — i.e. on a declared object.
    return this.deploymentWithholdsTenant(out as unknown as ServiceObject) ? (out as unknown as T) : base;
  }

  /**
   * [ADR-0131 D7] Does the deployment's declaration — and nothing else — plan
   * this body with no tenant column? The ONE reading of the declaration in
   * this registry: the spec's plan answers it, with and without the
   * deployment input, so the registry never re-derives which objects are
   * declared.
   */
  static deploymentWithholdsTenant(this: Pick<PlatformGlobalHost, 'deploymentPlatformGlobalObjects'>, schema: ServiceObject): boolean {
    if (this.deploymentPlatformGlobalObjects.size === 0) return false;
    return (
      resolveInjectedSystemColumns(schema).tenant &&
      !resolveInjectedSystemColumns(schema, { platformGlobalObjects: this.deploymentPlatformGlobalObjects }).tenant
    );
  }

  /**
   * [#8375] Remove the tenant-scope index entry {@link materializeBaseLayer}
   * appended — and only that one.
   *
   * ## Why this strip is harder than the two beside it
   *
   * `indexes` is a CONCATENATING key under `mergeObjectDefinitions`, not a
   * last-writer-wins scalar like `nameField` or a keyed record like `fields`.
   * The two existing strips can ask "is this value the platform's?" of a single
   * slot; here the platform's entry sits in a list beside the author's, entries
   * may legitimately repeat, and a strip that removes "any entry that looks like
   * the platform's" silently deletes an author's own declaration, while a strip
   * that removes nothing bakes a phantom index into `sys_metadata.metadata`, its
   * checksum and every history diff on the first Studio GET → edit → PUT
   * (#4326).
   *
   * ## The bound, and why it is exact in BOTH directions
   *
   * Not "does an entry match" but "would the seam have produced EXACTLY this
   * list": remove the LAST entry identical to the platform's own (the seam
   * APPENDS, so its entry is the last matching one), re-stamp the remainder
   * through `provisionTenantScopeIndex` — the stamping function itself, so the
   * strip and the stamp cannot drift — and keep the removal only when the
   * re-stamped list is byte-identical to the list that arrived. Anything else
   * returns `base` untouched.
   *
   * That single comparison decides every case correctly, and each of these was
   * measured:
   *
   *  - the platform's appended entry on a body with no `indexes` of its own →
   *    removed, and the KEY is deleted rather than left as `indexes: []`, so the
   *    round trip is byte-identical and not merely equivalent;
   *  - an author's own `{ fields: ['organization_id'] }` on a SINGLE-TENANT
   *    deployment → the re-stamp adds nothing, the lists differ, kept;
   *  - an author's own tenant index declared BEFORE their other indexes → the
   *    re-stamp appends at the end, the ORDER differs, kept;
   *  - a named entry (`{ name: 'my_tenant_idx', fields: [...] }`) or a composite
   *    → not identical to the platform's entry, never a candidate, kept.
   *
   * ⚠️ The one case it cannot separate, stated plainly because it is the same
   * trade {@link stripProvisionedPrimaryFrom} documents: an author who declares
   * `{ fields: ['organization_id'] }` as their LAST index on a MULTI-TENANT
   * deployment has written exactly what the seam appends, so it is dropped on
   * the first save that carries it. What bounds the harm is identical: the entry
   * is RE-DERIVED at every load — `registerObject` runs this seam over every
   * base layer — so the resolved answer, and the index the driver materializes,
   * is the same with or without the stored entry, now and at every future boot.
   *
   * Returns `base` by reference when nothing was owed.
   */
  static stripProvisionedTenantIndexFrom<T>(this: Pick<PlatformGlobalHost, 'multiTenant'>, base: T): T {
    if (base === null || typeof base !== 'object') return base;
    const present = (base as { indexes?: unknown }).indexes;
    if (!Array.isArray(present) || present.length === 0) return base;

    const platformEntry = stableStringify(TENANT_SCOPE_INDEX);
    let at = -1;
    for (let i = present.length - 1; i >= 0; i--) {
      if (stableStringify(present[i]) === platformEntry) { at = i; break; }
    }
    if (at === -1) return base;

    const kept = present.filter((_entry, i) => i !== at);
    const without = { ...(base as Record<string, unknown>) };
    // An emptied list is the ABSENCE of the key, not an empty array: the seam
    // added `indexes` to a body that had none, so the inverse must take the key
    // away again or the round trip stores a shape the author never wrote.
    if (kept.length === 0) delete without.indexes;
    else without.indexes = kept;

    const restamped = provisionTenantScopeIndex(without as never, {
      multiTenant: this.multiTenant,
    }) as { indexes?: unknown };
    if (stableStringify(restamped.indexes) !== stableStringify(present)) return base;

    return without as unknown as T;
  }

  /**
   * [#8268] Remove an ADR-0079 title designation that is REDUNDANT WITH THE
   * DERIVATION — the pointer {@link materializeServedObjectOnto} adds, and only
   * that one.
   *
   * Same EXACTNESS discipline as {@link stripProvisionedSearchCompanionFrom},
   * and recomputed from `provisionPrimary` itself rather than transcribed, so
   * the strip and the stamp cannot drift: the pointer comes off only when it is
   * identical to what the seam would designate for a body carrying no pointer
   * at all. A pointer naming any OTHER field is the author's own deliberate
   * choice — it overrides the derivation, which is the entire reason to write
   * one — and is kept untouched.
   *
   * ⚠️ The narrow case this trades away, stated plainly because it is real and
   * it is NOT the same trade `stripProvisionedSearchCompanionFrom` makes. That
   * one removes a value byte-identical to a platform-canonical FIELD
   * DEFINITION, where coincidence with an author's own writing is implausible.
   * This one compares a single string, so an author who explicitly declared the
   * field the derivation would have picked anyway loses that declaration on a
   * round trip. What bounds the harm is that the two are indistinguishable by
   * construction — the read serves one body, and "the author wrote
   * `nameField: 'name'`" and "the read derived `nameField: 'name'`" are the
   * same bytes — and that the stripped pointer is REDERIVED on every load:
   * `registerObject` runs `provisionPrimary` over every base layer, so the
   * resolved answer is identical with or without the stored key, now and at
   * each future boot. The designation is only ever lost if a later edit changes
   * which field the derivation picks, and that edit re-serves and re-stores the
   * new designation through this same pair.
   */
  static stripProvisionedPrimaryFrom<T>(base: T): T {
    if (base === null || typeof base !== 'object') return base;
    const present = (base as { nameField?: unknown }).nameField;
    if (typeof present !== 'string' || present === '') return base;

    // Re-stamp a copy WITHOUT the pointer and compare: the canonical answer
    // comes from the provisioning function itself, and an object the seam would
    // designate nothing for yields no stamp and therefore no removal.
    const withoutPointer = { ...(base as Record<string, unknown>) };
    delete withoutPointer.nameField;
    const restamped = provisionPrimary(withoutPointer as never, { synthesize: false }) as unknown as
      { nameField?: unknown };
    if (restamped.nameField !== present) return base;

    return withoutPointer as unknown as T;
  }

  /**
   * [#8027] Remove from `base` the `indexes` entries the `extend` contributors
   * are about to contribute — the half of {@link foldObjectExtendersOnto} that
   * makes the fold idempotent.
   *
   * Only the CONCATENATING key is considered; `fields` and the scalar props
   * already re-apply cleanly. Matching is by deep value equality on the
   * serialised entry, so it fires only on an entry byte-identical to the one
   * the extender declares.
   *
   * [ADR-0029 D9.2a, 2026-10-30 note] `validations` are no longer subtracted
   * here: the fold merges them BY NAME ({@link mergeValidationsByName}), which
   * removes every base copy of an extender's rule name — reworded or not —
   * before appending the extender's rule, so a folded base re-folds to itself
   * with nothing taken off first. Subtracting first would also take the
   * tenant's `message` / `active` off a reworded copy before the fold could
   * read them.
   *
   * Returns `base` BY REFERENCE when nothing matched, which is the ordinary
   * case (an unfolded base), so the pre-#8027 body is preserved exactly.
   */
  static subtractExtenderContributions(contributors: ObjectContributor[], base: ServiceObject): ServiceObject {
    const key = (entry: unknown): string => stableStringify(entry);
    let out: ServiceObject | undefined;
    for (const listKey of ['indexes'] as const) {
      const baseList = (base as Record<string, unknown>)[listKey];
      if (!Array.isArray(baseList) || baseList.length === 0) continue;
      const contributed = new Set<string>();
      for (const contrib of contributors) {
        if (contrib.ownership !== 'extend') continue;
        const list = (contrib.definition as unknown as Record<string, unknown>)[listKey];
        if (Array.isArray(list)) for (const entry of list) contributed.add(key(entry));
      }
      if (contributed.size === 0) continue;
      const kept = baseList.filter((entry) => !contributed.has(key(entry)));
      if (kept.length === baseList.length) continue;
      out ??= { ...base };
      (out as unknown as Record<string, unknown>)[listKey] = kept;
    }
    return out ?? base;
  }

  /**
   * [ADR-0029 D9.6] The CODE-LAYER resolution of an object: the OWNER's
   * declaration with its extenders folded on, deliberately ignoring any tenant
   * `overlay` layer.
   *
   * This is what artifact identity has to be read from, and it is NOT implied
   * by D9.2 — D9.2 leaves the merged body identical on purpose, `_provenance:
   * 'org'` included, so asking the MERGED body "does a code package ship
   * this?" answers about whatever last overwrote the base rather than about
   * the code layer. That is precisely how `isArtifactBacked` came to answer
   * `false` for a name a package still ships (#6853 P3), disarming both gates
   * that read it.
   *
   * With no overlay registered this is byte-for-byte `resolveObject`'s answer,
   * which is why the honest predicate costs nothing on the common shape.
   *
   * Uncached on purpose: a second cache would have to stay correct at every
   * one of `mergedObjectCache`'s invalidation points, and the fold is a
   * shallow spread over a contributor list that is almost always length 1.
   */
  static resolveOwnerLayer(this: Pick<PlatformGlobalHost, 'foldExtenders' | 'objectContributors'>, fqn: string): ServiceObject | undefined {
    const contributors = this.objectContributors.get(fqn);
    if (!contributors || contributors.length === 0) return undefined;
    const ownerContrib = contributors.find(c => c.ownership === 'own');
    if (!ownerContrib) return undefined;
    return this.foldExtenders(contributors, ownerContrib, 'code');
  }

  /** The body of `SchemaRegistry#getObject`; the method's docblock there is its contract. */
  static getObject(this: Pick<PlatformGlobalHost, 'resolveObject' | 'resolveObjectKey'>, name: string): ServiceObject | undefined {
    const fqn = this.resolveObjectKey(name);
    return fqn === undefined ? undefined : this.resolveObject(fqn);
  }

  /**
   * [#6808] The name→FQN half of {@link getObject}, extracted so the READ and
   * the name-addressed REMOVAL ({@link unregisterObject}) cannot disagree
   * about which contributor entry a bare name addresses.
   *
   * That disagreement is not hypothetical — it is the shape of the bug this
   * was extracted for: `deleteMetaItem`'s registry heal reached one of the two
   * places an `object` lives, and the surface data CRUD dispatches on
   * (`getObject`) kept serving a deleted object. A remover that resolved names
   * its own way would re-open the same seam one layer down: it could remove an
   * entry `getObject` never served, leaving the served one behind.
   *
   * Returns `undefined` when nothing is registered under the name, so
   * `getObject` keeps its exact previous behaviour: `resolveObject` on an
   * unknown FQN also answered `undefined`.
   *
   * [#10945] The short-name half is answered from {@link objectKeysByShortName}
   * rather than by scanning every contributor key. That keeps the extraction
   * above intact where it matters most — BOTH paths still resolve through this
   * one method, so they read one index and cannot diverge — while removing the
   * full-registry walk that made kernel boot quadratic in stored metadata.
   */
  static resolveObjectKey(this: Pick<PlatformGlobalHost, 'objectContributors' | 'objectKeysByShortName'>, name: string): string | undefined {
    // Canonical: short name lookup. O(1) via {@link objectKeysByShortName},
    // whose array IS the list the pre-#10945 full-registry scan built — same
    // members, same order — so `matches[0]` still names the first key
    // registered under an ambiguous short name and the warning still names
    // every one of them.
    const matches = this.objectKeysByShortName.get(name);
    if (matches !== undefined && matches.length > 0) {
      if (matches.length > 1) {
        console.warn(
          `[SchemaRegistry] Ambiguous short name "${name}" matches: ${matches.join(', ')}. ` +
          `Returning first match. Use FQN to disambiguate.`
        );
      }
      return matches[0];
    }

    // Fallback: explicit FQN
    return this.objectContributors.has(name) ? name : undefined;
  }

  /** The body of `SchemaRegistry#getAllObjects`; the method's docblock there is its contract. */
  static getAllObjects(this: Pick<PlatformGlobalHost, 'getObjectOwner' | 'objectContributors' | 'resolveObjectLeavingExtensionsOut'>, packageId?: string, options?: ObjectExtensionFoldOptions): ServiceObject[] {
    const results: ServiceObject[] = [];

    for (const fqn of this.objectContributors.keys()) {
      // If filtering by package, check if this package contributes
      if (packageId) {
        const contributors = this.objectContributors.get(fqn);
        const hasContribution = contributors?.some(c => c.packageId === packageId);
        if (!hasContribution) continue;
      }

      const merged = this.resolveObjectLeavingExtensionsOut(fqn, options);
      if (merged) {
        // Tag with contributor info for UI
        (merged as any)._packageId = this.getObjectOwner(fqn)?.packageId;
        results.push(merged);
      }
    }

    return results;
  }

  /** The body of `SchemaRegistry#getObjectContributors`; the method's docblock there is its contract. */
  static getObjectContributors(this: Pick<PlatformGlobalHost, 'objectContributors'>, fqn: string): ObjectContributor[] {
    return this.objectContributors.get(fqn) || [];
  }

  /** The body of `SchemaRegistry#getObjectExtensionsOf`; the method's docblock there is its contract. */
  static getObjectExtensionsOf(this: Pick<PlatformGlobalHost, 'objectContributors'>, packageId: string): Array<{ extend: string; priority?: number } & Record<string, unknown>> {
    const out: Array<{ extend: string; priority?: number } & Record<string, unknown>> = [];
    for (const [fqn, contributors] of this.objectContributors) {
      const contribution = contributors.find((c) => c.ownership === 'extend' && c.packageId === packageId);
      if (!contribution) continue;
      const body: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(contribution.definition)) {
        if (value === undefined || key === 'name' || key.startsWith('_')) continue;
        body[key] = value;
      }
      out.push({
        extend: fqn,
        ...body,
        ...(contribution.priority !== DEFAULT_EXTENDER_PRIORITY ? { priority: contribution.priority } : {}),
      });
    }
    return out;
  }

  /** The body of `SchemaRegistry#getObjectOwner`; the method's docblock there is its contract. */
  static getObjectOwner(this: Pick<PlatformGlobalHost, 'objectContributors'>, fqn: string): ObjectContributor | undefined {
    const contributors = this.objectContributors.get(fqn);
    return contributors?.find(c => c.ownership === 'own');
  }

  /** The body of `SchemaRegistry#getPackagedObjectOwner`; the method's docblock there is its contract. */
  static getPackagedObjectOwner(this: Pick<PlatformGlobalHost, 'objectContributors' | 'resolveObjectKey'>, name: string): ObjectContributor | undefined {
    const fqn = this.resolveObjectKey(name);
    if (fqn === undefined) return undefined;
    const owner = this.objectContributors.get(fqn)?.find(c => c.ownership === 'own');
    return owner && isCodeArtifactBody(owner.definition) ? owner : undefined;
  }

  /** The body of `SchemaRegistry#getPackagedObjectBase`; the method's docblock there is its contract. */
  static getPackagedObjectBase(this: Pick<PlatformGlobalHost, 'getPackagedObjectOwner' | 'isPackageDisabled' | 'objectContributors' | 'packagedRules' | 'resolveObjectKey'>, name: string): ServiceObject | undefined {
    const owner = this.getPackagedObjectOwner(name);
    if (!owner) return undefined;
    const fqn = this.resolveObjectKey(name);
    const contributors = (fqn === undefined ? undefined : this.objectContributors.get(fqn)) ?? [];
    // [ADR-0029 D9.2a, 2026-10-30 note] By name, as the fold merges them: an
    // extender's rule of a name the owner already ships is one rule, not two.
    const extended = contributors.some((c) =>
      c.ownership === 'extend' && isCodeArtifactBody(c.definition)
      && Array.isArray(c.definition.validations) && c.definition.validations.length > 0);
    // A disabled package's extension is withheld from the served fold, so it
    // adds nothing the served object carries; its field is no packaged one.
    const addedFields = packagedAddedFields(
      owner.definition,
      contributors.filter((c) => !(c.ownership === 'extend' && this.isPackageDisabled(c.packageId))),
    );
    if (!extended && addedFields === undefined) return owner.definition;
    return {
      ...owner.definition,
      ...(extended ? { validations: (this.packagedRules(contributors) ?? []) as ServiceObject['validations'] } : {}),
      ...(addedFields !== undefined
        ? { fields: { ...owner.definition.fields, ...addedFields } as ServiceObject['fields'] }
        : {}),
    };
  }

  /** The body of `SchemaRegistry#getPackagedFieldPatchBases`; the method's docblock there is its contract. */
  static getPackagedFieldPatchBases(this: Pick<PlatformGlobalHost, 'getPackagedObjectBase' | 'getPackagedObjectOwner' | 'isPackageDisabled' | 'objectContributors' | 'resolveObjectKey'>, name: string): Array<{ packageId: string; base: ServiceObject }> {
    const owner = this.getPackagedObjectOwner(name);
    if (!owner) return [];
    const base = this.getPackagedObjectBase(name);
    const fqn = this.resolveObjectKey(name);
    const contributors = (fqn === undefined ? undefined : this.objectContributors.get(fqn)) ?? [];
    if (!base || contributors.length === 0) return [];
    // The patches reach the owner's own fields only, as the fold applies them.
    const ownFields = ownFieldNamesOf(owner.definition);
    const out: Array<{ packageId: string; base: ServiceObject }> = [];
    // Highest precedence first: the fold applies contributors in ascending
    // order, so the last one's patch is the one a slot two packages patch carries.
    for (let index = contributors.length - 1; index >= 0; index -= 1) {
      const contrib = contributors[index];
      const packageId = contrib.packageId;
      if (contrib.ownership !== 'extend' || !isCodeArtifactBody(contrib.definition) || !packageId) continue;
      // A disabled package's extension is withheld from the served fold.
      if (this.isPackageDisabled(packageId)) continue;
      const patches = (contrib.definition as ObjectExtensionBody).fieldPatches;
      if (!patches || typeof patches !== 'object') continue;
      const fields = applyFieldPatches(base.fields, patches, undefined, ownFields);
      if (fields === base.fields) continue;
      out.push({ packageId, base: { ...base, fields } });
    }
    return out;
  }

  /** The body of `SchemaRegistry#extendContributionRefusal`; the method's docblock there is its contract. */
  static extendContributionRefusal(schema: { name?: unknown; defaultRowScope?: unknown; membershipKeys?: unknown }, packageId: string | undefined): Error | undefined {
    return extendContributionRefusal(schema, packageId);
  }

  /** The body of `SchemaRegistry#registerObjectExtension`; the method's docblock there is its contract. */
  static registerObjectExtension(this: Pick<PlatformGlobalHost, 'registerObject'>, extension: { extend: string; priority?: number } & Record<string, unknown>, packageId: string): string {
    const { extend, priority, ...contribution } = extension;
    return this.registerObject(
      { ...contribution, name: extend } as unknown as ServiceObject,
      packageId,
      undefined,
      'extend',
      typeof priority === 'number' ? priority : DEFAULT_EXTENDER_PRIORITY,
    );
  }

  /**
   * [#28858, ADR-0146 D10] The key an extension of `name` is filed under: the
   * key {@link getObject} reads `name` as. That is `name` itself whenever an
   * entry is registered under it, or nothing is registered that `name` folds
   * to. It differs only for a short name `getObject` folds to a legacy
   * `<ns>__<name>` key ({@link resolveObjectKey}); filing such an extension
   * under the short name would open a second, owner-less entry beside the
   * object it meant, which nothing serves and nothing checks.
   *
   * The folded spelling is named once at `warn`, with the key to write. ⛔
   * Never a refusal: the manifest loop and the boot hydration run while
   * packages are still registering (AGENTS.md *Startup registry reads*). The
   * `object_extension` item door refuses the same spelling at save (#28834),
   * where the author is present to fix it. A legacy owner that registers
   * AFTER the extension is not yet there to fold to, so that extension is
   * filed under its own spelling, as before.
   */
  static extensionTargetKey(this: Pick<PlatformGlobalHost, 'extensionSpellingWarned' | 'objectContributors' | 'resolveObjectKey'>, name: string, packageId: string | undefined): string {
    if (name === '' || this.objectContributors.has(name)) return name;
    const resolved = this.resolveObjectKey(name);
    if (resolved === undefined || resolved === name) return name;
    const key = `${name}|${resolved}|${packageId ?? ''}`;
    if (!this.extensionSpellingWarned.has(key)) {
      this.extensionSpellingWarned.add(key);
      console.warn(
        `[Registry] An extension${packageId ? ` from package "${packageId}"` : ''} names its object '${name}', ` +
          `which is registered as '${resolved}': the extension is filed under '${resolved}', the object it ` +
          `reads as. Write \`extend: '${resolved}'\` to name the object by the key it is registered under.`,
      );
    }
    return resolved;
  }

  /** The body of `SchemaRegistry#withdrawObjectExtension`; the method's docblock there is its contract. */
  static withdrawObjectExtension(this: Pick<PlatformGlobalHost, '_objectRevision' | 'closeObjectEntry' | 'log' | 'mergedObjectCache' | 'objectContributors' | 'resolveObjectKey'>, name: string, packageId: string): boolean {
    const fqn = this.resolveObjectKey(name) ?? name;
    const contributors = this.objectContributors.get(fqn);
    if (!contributors) return false;
    const idx = contributors.findIndex(c => c.ownership === 'extend' && c.packageId === packageId);
    if (idx === -1) return false;
    contributors.splice(idx, 1);
    if (contributors.length === 0) this.closeObjectEntry(fqn);
    // The same two invalidations every other contributor mutation performs.
    this.mergedObjectCache.delete(fqn);
    this._objectRevision += 1;
    this.log(`[Registry] Withdrew extend contribution to ${fqn} from ${packageId}`);
    return true;
  }

  /** The body of `SchemaRegistry#removeObjectOverlay`; the method's docblock there is its contract. */
  static removeObjectOverlay(this: Pick<PlatformGlobalHost, '_objectRevision' | 'log' | 'mergedObjectCache' | 'objectContributors' | 'resolveObjectKey'>, name: string): boolean {
    const fqn = this.resolveObjectKey(name);
    if (fqn === undefined) return false;
    const contributors = this.objectContributors.get(fqn);
    if (!contributors) return false;
    const idx = contributors.findIndex(c => c.ownership === 'overlay');
    if (idx === -1) return false;
    const [removed] = contributors.splice(idx, 1);
    // The same two invalidations every other contributor mutation performs.
    this.mergedObjectCache.delete(fqn);
    this._objectRevision += 1;
    this.log(`[Registry] Removed overlay layer of object: ${fqn} (was bound to ${removed.packageId})`);
    return true;
  }

  /** The body of `SchemaRegistry#assertSingleOwnerPerObject`; the method's docblock there is its contract. */
  static assertSingleOwnerPerObject(this: Pick<PlatformGlobalHost, 'objectContributors'>): void {
    const violations: string[] = [];
    for (const [fqn, contributors] of this.objectContributors.entries()) {
      const owners = contributors.filter(c => c.ownership === 'own');
      if (owners.length === 0) {
        // [ADR-0029 D9.5] The ORPHAN OVERLAY class. Reachable by uninstalling
        // the packaged owner while a `sys_metadata` row for its object still
        // exists under a binding `unregisterObjectsByPackage` cannot reach by
        // package id (the sentinel). It must be LOUD rather than silent:
        // `resolveObject` would otherwise warn once and answer `undefined` for
        // a name the tenant can still see in `sys_metadata`.
        const overlays = contributors.filter(c => c.ownership === 'overlay');
        if (overlays.length > 0) {
          const bindings = overlays.map(c => c.packageId).join(', ') || '(none)';
          violations.push(
            `Object "${fqn}" has an orphan overlay layer [${bindings}] and no owner. ` +
            `An overlay layers OVER an owned object — re-install the package that owns it, ` +
            `or delete the sys_metadata row.`
          );
        } else {
          const extenders = contributors.map(c => c.packageId).join(', ') || '(none)';
          violations.push(
            `Object "${fqn}" has no owner — only extend contributions from [${extenders}]. ` +
            `Exactly one package must register it with ownership 'own'.`
          );
        }
      } else if (owners.length > 1) {
        const names = owners.map(c => c.packageId).join(', ');
        violations.push(
          `Object "${fqn}" has ${owners.length} owners [${names}] — exactly one is allowed.`
        );
      }
    }
    if (violations.length > 0) {
      throw new Error(
        `[Registry] single-owner-per-object check failed (ADR-0029):\n  ` +
        violations.join('\n  ')
      );
    }
  }

  /** The body of `SchemaRegistry#unregisterObjectsByPackage`; the method's docblock there is its contract. */
  static unregisterObjectsByPackage(this: Pick<PlatformGlobalHost, '_objectRevision' | 'assertPackageUninstallable' | 'closeObjectEntry' | 'log' | 'mergedObjectCache' | 'objectContributors'>, packageId: string, force: boolean = false): void {
    // [#7970] REFUSAL PASS — see {@link assertPackageUninstallable}, which holds
    // the one copy of the predicate ([#21276] extracted so it can be asked
    // without uninstalling).
    if (!force) this.assertPackageUninstallable(packageId);

    // MUTATION PASS — carries no refusal of its own; the pass above already
    // proved every removal below is allowed. Keep it that way: a second copy of
    // the predicate here is the two-places-that-must-agree shape this ordering
    // fix was chosen over.
    for (const [fqn, contributors] of this.objectContributors.entries()) {
      // Find this package's contributions
      const packageContribs = contributors.filter(c => c.packageId === packageId);

      for (const contrib of packageContribs) {
        // Remove contribution
        const idx = contributors.indexOf(contrib);
        if (idx !== -1) {
          contributors.splice(idx, 1);
          this.log(`[Registry] Removed ${contrib.ownership} contribution to ${fqn} from ${packageId}`);
        }

        // [ADR-0029 D9.7] An overlay layer leaves with the base it layers
        // over. Nothing durable is lost — the layer is a runtime projection of
        // a `sys_metadata` row this does not touch, and a re-install
        // re-hydrates it — whereas leaving it behind would MANUFACTURE the
        // orphan-overlay violation D9.5 names, on every uninstall of a
        // customized packaged object. Keyed off the OWNER's removal, not off
        // the overlay's own binding: a sentinel-bound layer names no package
        // and this walk is addressed by package id.
        if (contrib.ownership === 'own') {
          const overlayIdx = contributors.findIndex(c => c.ownership === 'overlay');
          if (overlayIdx !== -1) {
            const [dropped] = contributors.splice(overlayIdx, 1);
            this.log(
              `[Registry] Removed overlay layer of ${fqn} with its owner ` +
              `(layer was bound to ${dropped.packageId})`
            );
          }
        }
      }

      // Clean up empty contributor lists
      if (contributors.length === 0) {
        this.closeObjectEntry(fqn);
      }

      // Invalidate cache
      this.mergedObjectCache.delete(fqn);
      this._objectRevision += 1;
    }
  }

  /** The body of `SchemaRegistry#unregisterObject`; the method's docblock there is its contract. */
  static unregisterObject(this: Pick<PlatformGlobalHost, '_objectRevision' | 'closeObjectEntry' | 'log' | 'mergedObjectCache' | 'objectContributors' | 'resolveObjectKey'>, name: string, options: { force?: boolean } = {}): boolean {
    const fqn = this.resolveObjectKey(name);
    if (fqn === undefined) return false;
    const contributors = this.objectContributors.get(fqn) ?? [];

    const owner = contributors.find(c => c.ownership === 'own');
    if (!options.force) {
      const otherExtenders = contributors.filter(
        c => c.ownership === 'extend' && c.packageId !== owner?.packageId
      );
      if (otherExtenders.length > 0) {
        throw new Error(
          `Cannot unregister object "${fqn}": it is extended by ` +
          `${otherExtenders.map(c => c.packageId).join(', ')}. Unregister the extenders first.`
        );
      }
    }

    // The whole entry goes: the object no longer exists, so no contribution to
    // it does either. Leaving the extenders behind would be the owner-less
    // state the guard above exists to prevent.
    this.closeObjectEntry(fqn);
    // The same two invalidations every other contributor mutation performs —
    // the merged-object cache would otherwise keep answering `resolveObject`
    // for a name with no contributors, and registry-derived caches (the
    // engine's roll-up summary index) would never learn the set moved.
    this.mergedObjectCache.delete(fqn);
    this._objectRevision += 1;
    // Namespaces are deliberately NOT touched: a namespace is registered per
    // PACKAGE and shared by every object that package ships, so dropping one
    // object must not unregister it. `unregisterObjectsByPackage` leaves it
    // alone too — `uninstallPackage` owns that half.
    this.log(
      `[Registry] Unregistered object: ${fqn} ` +
      `(${contributors.length} contribution(s), owner ${owner?.packageId ?? '(none)'})`
    );
    return true;
  }
}
