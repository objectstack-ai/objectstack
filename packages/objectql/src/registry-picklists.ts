// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#33949 codemod] The "Plugins, kinds, shared picklists and reset" section of
 * `SchemaRegistry`: the bodies of `getAllPlugins`, `getAllKinds`,
 * `registerPicklistExtension`, `resolvePicklistOptions`,
 * `withPendingManifests`, `findUnresolvedPicklistReferences`,
 * `findOrphanPicklistExtensions`, `findOutsideClosurePicklistReferences`,
 * `sealPicklistVocabulary`, `refusePicklistArrival`,
 * `registeringPicklistArrival`, `admitPicklistArrival`,
 * `refusePicklistItemArrival`, `picklistArrivalRefusal`,
 * `findDisagreeingPicklistReferences`, `auditPicklistReferences`,
 * `judgePicklistReference`, `picklistContributions`,
 * `assertPicklistValuesDistinct`, `resolvePicklistFields`,
 * `resolveFieldPicklistOptions`, `unregisterPicklistExtensionsByPackage`,
 * `invalidate`, `invalidateAll`, `reset` moved out of `registry.ts` whole by
 * the #33949 split codemod (PR #34285, kept in its branch history, not committed).
 *
 * A MOVE, not a redesign. {@link PicklistsFacet} is a stateless facet of `SchemaRegistry`
 * (ruling 6624345766): each static method of it is the body of the `SchemaRegistry`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class as a one-call stub with
 * its signature, so the published surface, an instance spy and a subclass
 * override are what they were. A public or protected method keeps its
 * docblock on the class, the contract; a private method's docblock moved here
 * with its body. The state stays on `SchemaRegistry`.
 *
 * The bodies reach the class through {@link PicklistsHost}: exactly the
 * `SchemaRegistry` members they read, private ones included. Every stub hands
 * its body, by a `.call`, the same host: `picklistsHost` in
 * `registry-facet-hosts.ts`, built once per registry by the class's static
 * block. Methods go as closures that call them on the registry at call time, so
 * a subclass override or an instance spy is still the one reached; fields and
 * accessors go as GETTERS, read when the body reads them, as they were on the
 * class, and a field a body assigns goes with a SETTER that assigns it on the
 * registry.
 *
 * The module imports `registry.ts` for types only, so the two modules form no
 * evaluation cycle. `index.ts` re-exports nothing from this module.
 */

import { isTenantAuthored } from '@objectstack/metadata-core';
import type { InstalledPackage, ObjectStackManifest } from '@objectstack/spec/kernel';
import { artifactPackageId } from '@objectstack/core';
import { collectManifestPicklistNames, collectPicklistReferences, describePicklistReferencesBrokenByInstall, describeUnresolvedPicklistReferences, duplicatePicklistValueError, findDuplicatePicklistValue, mergePicklistOptions, resolvePicklistFieldsOnto } from './picklist-resolution.js';
import type { DisagreeingPicklistReference, PicklistArrivalAct, PicklistContribution, PicklistOptionLike, UnresolvedPicklistExtension, UnresolvedPicklistReference } from './picklist-resolution.js';
import type { PackageScopedHolder, PackageScopedRefusal, PackageScopedRegistry } from './package-scoped-resolver.js';
import { NO_PACKAGE_REFERRER, picklistReferrerOf, sameHolder } from './registry-top-level.js';
import type { PicklistReferrer } from './registry-top-level.js';
import type { SchemaRegistry } from './registry.js';

/**
 * The `SchemaRegistry` members the bodies of {@link PicklistsFacet} read — every one of
 * them, and no other. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too. `readonly` members are the getters; the others are fields a body
 * assigns.
 */
export interface PicklistsHost {
  _objectRevision: SchemaRegistry['_objectRevision'];
  readonly appNavContributions: SchemaRegistry['appNavContributions'];
  auditPicklistReferences: SchemaRegistry['auditPicklistReferences'];
  getAllPackages: SchemaRegistry['getAllPackages'];
  getEnvironmentScopedItem: SchemaRegistry['getEnvironmentScopedItem'];
  getPackage: SchemaRegistry['getPackage'];
  getPackageScopedItem: SchemaRegistry['getPackageScopedItem'];
  invalidateAll: SchemaRegistry['invalidateAll'];
  judgePicklistArrival: SchemaRegistry['judgePicklistArrival'];
  judgePicklistReference: SchemaRegistry['judgePicklistReference'];
  listItems: SchemaRegistry['listItems'];
  log: SchemaRegistry['log'];
  readonly mergedObjectCache: SchemaRegistry['mergedObjectCache'];
  readonly metadata: SchemaRegistry['metadata'];
  readonly namespaceRegistry: SchemaRegistry['namespaceRegistry'];
  notePicklistExtension: SchemaRegistry['notePicklistExtension'];
  readonly objectContributors: SchemaRegistry['objectContributors'];
  readonly objectKeysByShortName: SchemaRegistry['objectKeysByShortName'];
  packageScopedHoldersOf: SchemaRegistry['packageScopedHoldersOf'];
  picklistArrivalDepth: SchemaRegistry['picklistArrivalDepth'];
  picklistArrivalRefusal: SchemaRegistry['picklistArrivalRefusal'];
  picklistContributions: SchemaRegistry['picklistContributions'];
  readonly picklistExtensionContributions: SchemaRegistry['picklistExtensionContributions'];
  picklistReferenceVerdict: SchemaRegistry['picklistReferenceVerdict'];
  picklistVocabularySealed: SchemaRegistry['picklistVocabularySealed'];
  refusePicklistArrival: SchemaRegistry['refusePicklistArrival'];
  refusePicklistItemArrival: SchemaRegistry['refusePicklistItemArrival'];
  registeringPicklistArrival: SchemaRegistry['registeringPicklistArrival'];
  readonly residualOwnerDependencies: SchemaRegistry['residualOwnerDependencies'];
  residualOwnerDependenciesOf: SchemaRegistry['residualOwnerDependenciesOf'];
  resolveFieldPicklistOptions: SchemaRegistry['resolveFieldPicklistOptions'];
  resolvePicklistOptions: SchemaRegistry['resolvePicklistOptions'];
}

/** The bodies of the "Plugins, kinds, shared picklists and reset" section of `SchemaRegistry`: a stateless facet, called by the class's stubs. */
export class PicklistsFacet {
  /** The body of `SchemaRegistry#getAllPlugins`; the method's docblock there is its contract. */
  static getAllPlugins(this: Pick<PicklistsHost, 'listItems'>): ObjectStackManifest[] {
    return this.listItems<ObjectStackManifest>('plugin');
  }

  /** The body of `SchemaRegistry#getAllKinds`; the method's docblock there is its contract. */
  static getAllKinds(this: Pick<PicklistsHost, 'listItems'>): { id: string; description?: string }[] {
    return this.listItems('kind');
  }

  /** The body of `SchemaRegistry#registerPicklistExtension`; the method's docblock there is its contract. */
  static registerPicklistExtension(this: Pick<PicklistsHost, 'invalidateAll' | 'log' | 'notePicklistExtension' | 'picklistContributions' | 'picklistExtensionContributions' | 'refusePicklistItemArrival'>, extension: { extend: string; options: readonly PicklistOptionLike[] }, packageId?: string): void {
    const target = extension.extend;
    // [ADR-0150 D3, #31700; epic seat ruling R2-A, 6812862622] After the
    // seal, an extension registered on its own (outside an install judged as
    // a whole) meets the one re-judge first: its target, judged caller-less,
    // must be one list ({@link refusePicklistItemArrival}).
    this.refusePicklistItemArrival(
      packageId,
      { picklistExtensions: [extension] },
      `a \`picklistExtensions\` entry of package '${packageId}' extending picklist '${target}'`,
    );
    const packageKey = packageId ?? '';
    const own = this.picklistExtensionContributions.get(target)?.get(packageKey);
    const merged = new Map<string, PicklistOptionLike>(own?.options);
    for (const option of extension.options ?? []) {
      if (option && typeof option === 'object' && option.value !== undefined) merged.set(String(option.value), option);
    }
    const candidate: PicklistContribution = { packageId, kind: 'extension', options: [...merged.values()] };
    const others = this.picklistContributions(target).filter(
      (c) => !(c.kind === 'extension' && (c.packageId ?? '') === packageKey),
    );
    // The candidate's own list first: a value repeated INSIDE this one entry
    // is refused too, and against the owner's values it then reads in merge
    // order (the list first, this extension second).
    const repeated = findDuplicatePicklistValue([{ ...candidate, options: extension.options ?? [] }]);
    const duplicate = repeated ?? findDuplicatePicklistValue([...others, candidate]);
    if (duplicate) throw duplicatePicklistValueError(target, duplicate);

    let byPackage = this.picklistExtensionContributions.get(target);
    if (!byPackage) this.picklistExtensionContributions.set(target, byPackage = new Map());
    this.notePicklistExtension(target, packageKey);
    byPackage.set(packageKey, { packageId, options: merged });
    this.invalidateAll();
    this.log(`[Registry] Registered picklist extension: ${target} (+${extension.options?.length ?? 0}) from ${packageId}`);
  }

  /** The body of `SchemaRegistry#resolvePicklistOptions`; the method's docblock there is its contract. */
  static resolvePicklistOptions(this: Pick<PicklistsHost, 'picklistContributions'>, name: string, callerPackageId?: string | null): PicklistOptionLike[] | undefined {
    const contributions = this.picklistContributions(name, callerPackageId);
    if (!contributions.some((c) => c.kind === 'picklist')) return undefined;
    return mergePicklistOptions(contributions);
  }

  /**
   * The registry as R reads it once `manifests` (an artifact the install door
   * is judging, not yet registered) are installed: each manifest answers
   * `getPackage` for its own id — its `dependencies` and `namespace`, which is
   * all the closure reads — ahead of an installed version of it, and each
   * `picklist` a manifest declares is held by that manifest's package, next
   * to the registry's holders. So a reference to a list a sibling in the
   * artifact declares is judged by R's one rule — reached through the
   * referrer's declared closure, else refused naming every holder — exactly as
   * the served field will be once the artifact registers (epic seat review on
   * #31731). ⛔ No closure is computed here; R computes it from this view.
   *
   * [#31700, ruling R2-A] `replaces: false` (a per-item seam,
   * {@link judgePicklistArrival}): the manifest adds lists to a package and
   * stands for no version of it, so `getPackage` keeps answering the
   * installed record. A manifest with no package id registers its lists as
   * the environment's (`registerItem` with no package), so the view holds
   * them there.
   */
  static withPendingManifests(this: Pick<PicklistsHost, 'getAllPackages' | 'getEnvironmentScopedItem' | 'getPackage' | 'getPackageScopedItem' | 'packageScopedHoldersOf' | 'residualOwnerDependenciesOf'>, manifests: readonly unknown[], options: { replaces?: boolean } = {}): PackageScopedRegistry {
    const pending = new Map<string, InstalledPackage>();
    const pendingLists = new Map<string, Set<string>>();
    const pendingEnvironmentLists = new Set<string>();
    for (const manifest of manifests) {
      const id = artifactPackageId(manifest);
      if (id === undefined) {
        for (const name of collectManifestPicklistNames(manifest)) pendingEnvironmentLists.add(name);
        continue;
      }
      if (options.replaces !== false) pending.set(id, { manifest } as unknown as InstalledPackage);
      for (const name of collectManifestPicklistNames(manifest)) {
        let holders = pendingLists.get(name);
        if (!holders) pendingLists.set(name, holders = new Set());
        holders.add(id);
      }
    }
    const pendingHolders = (type: string, name: string): ReadonlySet<string> =>
      (type === 'picklist' ? pendingLists.get(name) : undefined) ?? new Set();
    // A residual owner's declared dependencies (ADR-0130 D4) are read by the
    // one closure walk through the registry it is handed — this view too.
    const view: PackageScopedRegistry & Pick<SchemaRegistry, 'residualOwnerDependenciesOf'> = {
      residualOwnerDependenciesOf: (id) => this.residualOwnerDependenciesOf(id),
      getPackage: (id) => pending.get(id) ?? this.getPackage(id),
      getAllPackages: () => [
        ...this.getAllPackages().filter((row) => !pending.has(artifactPackageId(row.manifest) ?? '')),
        ...pending.values(),
      ],
      // [#32183] The asked holder set (served, or every holder for a
      // durable judgment such as {@link picklistReferenceVerdict}), with the
      // artifact's own lists beside it.
      packageScopedHoldersOf: (type, name, callerPackageId, options) => [
        ...new Set([...this.packageScopedHoldersOf(type, name, callerPackageId, options), ...pendingHolders(type, name)]),
      ],
      getPackageScopedItem: <T>(type: string, name: string, packageId: string, member?: string): T | undefined =>
        pendingHolders(type, name).has(packageId)
          ? ({ name, _packageId: packageId } as unknown as T)
          : this.getPackageScopedItem<T>(type, name, packageId, member),
      getEnvironmentScopedItem: <T>(type: string, name: string, member?: string): T | undefined =>
        type === 'picklist' && pendingEnvironmentLists.has(name)
          ? ({ name } as unknown as T)
          : this.getEnvironmentScopedItem<T>(type, name, member),
    };
    return view;
  }

  /** The body of `SchemaRegistry#findUnresolvedPicklistReferences`; the method's docblock there is its contract. */
  static findUnresolvedPicklistReferences(this: Pick<PicklistsHost, 'auditPicklistReferences'>): UnresolvedPicklistReference[] {
    return this.auditPicklistReferences().unresolved;
  }

  /** The body of `SchemaRegistry#findOrphanPicklistExtensions`; the method's docblock there is its contract. */
  static findOrphanPicklistExtensions(this: Pick<PicklistsHost, 'picklistExtensionContributions' | 'picklistReferenceVerdict'>): UnresolvedPicklistExtension[] {
    const orphans: UnresolvedPicklistExtension[] = [];
    for (const [target, byPackage] of this.picklistExtensionContributions) {
      const verdict = this.picklistReferenceVerdict(target, null);
      if (verdict.status === 'resolved') continue;
      for (const entry of byPackage.values()) {
        orphans.push(verdict.status === 'refused'
          ? { picklist: target, packageId: entry.packageId, refusal: verdict.message }
          : { picklist: target, packageId: entry.packageId });
      }
    }
    return orphans;
  }

  /** The body of `SchemaRegistry#findOutsideClosurePicklistReferences`; the method's docblock there is its contract. */
  static findOutsideClosurePicklistReferences(this: Pick<PicklistsHost, 'auditPicklistReferences'>): UnresolvedPicklistReference[] {
    return this.auditPicklistReferences().outsideClosure;
  }

  /** The body of `SchemaRegistry#sealPicklistVocabulary`; the method's docblock there is its contract. */
  static sealPicklistVocabulary(this: Pick<PicklistsHost, 'picklistVocabularySealed'>): void {
    this.picklistVocabularySealed = true;
  }

  /** The body of `SchemaRegistry#refusePicklistArrival`; the method's docblock there is its contract. */
  static refusePicklistArrival(this: Pick<PicklistsHost, 'picklistArrivalDepth' | 'picklistArrivalRefusal' | 'picklistVocabularySealed'>, manifests: readonly unknown[], options: { act?: PicklistArrivalAct } = {}): void {
    if (!this.picklistVocabularySealed || this.picklistArrivalDepth > 0) return;
    const refusal = this.picklistArrivalRefusal(manifests, { replaces: true, ownRefusals: 'all', act: options.act ?? 'install' });
    if (refusal) throw refusal;
  }

  /** The body of `SchemaRegistry#registeringPicklistArrival`; the method's docblock there is its contract. */
  static registeringPicklistArrival<T>(this: Pick<PicklistsHost, 'picklistArrivalDepth'>, register: () => T): T {
    this.picklistArrivalDepth += 1;
    try {
      return register();
    } finally {
      this.picklistArrivalDepth -= 1;
    }
  }

  /** The body of `SchemaRegistry#admitPicklistArrival`; the method's docblock there is its contract. */
  static admitPicklistArrival<T>(this: Pick<PicklistsHost, 'refusePicklistArrival' | 'registeringPicklistArrival'>, manifests: readonly unknown[], register: () => T, options: { act?: PicklistArrivalAct } = {}): T {
    this.refusePicklistArrival(manifests, options);
    return this.registeringPicklistArrival(register);
  }

  /**
   * [ADR-0150 D3, #31700; epic seat ruling R2-A, 6812862622] The per-item
   * seams' half: one picklist, extension or object body registered under
   * `packageId` on its own, after the seal and outside an arrival judged as a
   * whole. Judged as an ADDITION to what the package holds
   * (`replaces: false`): its installed items stay, and its identity and
   * dependencies are the installed record's. Its own reference or extension
   * is refused only when the resolver refuses it as ambiguous — the class two
   * namespaces' holders open; a name nothing holds, or holds only outside the
   * package's closure, keeps the seam's answer (served no options, named by
   * the boot audit). What it does to everyone else's references is judged in
   * full. ⛔ Never a registration with no package: the environment catalog
   * (`sys_metadata`), whose stored row is not refused here. A tenant-authored
   * list under a package is judged as any list of it (seat ruling R3-A); a
   * tenant-authored object layer is not asked, as it writes no package's
   * reference ({@link registerObject}).
   */
  static refusePicklistItemArrival(this: Pick<PicklistsHost, 'picklistArrivalDepth' | 'picklistArrivalRefusal' | 'picklistVocabularySealed'>, packageId: string | undefined, part: Record<string, unknown>, subject: string): void {
    if (!this.picklistVocabularySealed || this.picklistArrivalDepth > 0 || !packageId) return;
    const refusal = this.picklistArrivalRefusal([{ id: packageId, ...part }], {
      replaces: false,
      ownRefusals: 'ambiguous',
      act: 'register',
      subject,
    });
    if (refusal) throw refusal;
  }

  /** The refusal {@link judgePicklistArrival}'s verdict amounts to, or `undefined`. */
  static picklistArrivalRefusal(this: Pick<PicklistsHost, 'judgePicklistArrival'>, manifests: readonly unknown[], options: { replaces: boolean; ownRefusals: 'all' | 'ambiguous'; act: PicklistArrivalAct; subject?: string }): Error | undefined {
    const verdict = this.judgePicklistArrival(manifests, options);
    return describeUnresolvedPicklistReferences(verdict.unresolved, verdict.orphans)
      ?? describePicklistReferencesBrokenByInstall(
        manifests.map((m) => artifactPackageId(m)).filter((id): id is string => id !== undefined),
        verdict.references,
        verdict.extensions,
        verdict.disagreeing,
        { act: options.act, subject: options.subject },
      );
  }

  /** The body of `SchemaRegistry#findDisagreeingPicklistReferences`; the method's docblock there is its contract. */
  static findDisagreeingPicklistReferences(this: Pick<PicklistsHost, 'objectContributors' | 'picklistReferenceVerdict'>): DisagreeingPicklistReference[] {
    const disagreeing: DisagreeingPicklistReference[] = [];
    for (const [fqn, contributors] of this.objectContributors) {
      const referrerOf = picklistReferrerOf(contributors);
      const seen = new Set<string>();
      for (const contributor of contributors) {
        if (contributor.ownership === 'overlay' || isTenantAuthored(contributor.definition)) continue;
        for (const ref of collectPicklistReferences(fqn, contributor.definition, contributor.packageId)) {
          const key = `${ref.field}\u0000${ref.picklist}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const referrers = referrerOf(ref.field, ref.picklist);
          if (referrers.length < 2) continue;
          const reached: { packageId: string | undefined; holder: PackageScopedHolder }[] = [];
          for (const referrer of referrers) {
            const verdict = this.picklistReferenceVerdict(ref.picklist, referrer);
            if (verdict.status !== 'resolved') break;
            reached.push({ packageId: referrer ?? undefined, holder: verdict.holder });
          }
          if (reached.length < referrers.length) continue;
          if (reached.every((r) => sameHolder(r.holder, reached[0].holder))) continue;
          disagreeing.push({ object: fqn, field: ref.field, picklist: ref.picklist, referrers: reached });
        }
      }
    }
    return disagreeing;
  }

  /** The field half of the audit, split by the resolver's verdict (above). */
  static auditPicklistReferences(this: Pick<PicklistsHost, 'judgePicklistReference' | 'objectContributors'>): {
    unresolved: UnresolvedPicklistReference[];
    outsideClosure: UnresolvedPicklistReference[];
  } {
    const unresolved: UnresolvedPicklistReference[] = [];
    const outsideClosure: UnresolvedPicklistReference[] = [];
    for (const [fqn, contributors] of this.objectContributors) {
      for (const contributor of contributors) {
        if (contributor.ownership === 'overlay' || isTenantAuthored(contributor.definition)) continue;
        for (const ref of collectPicklistReferences(fqn, contributor.definition, contributor.packageId)) {
          const judged = this.judgePicklistReference(ref.picklist, ref.packageId);
          if (judged === 'resolved') continue;
          const entry = judged.refusal ? { ...ref, refusal: judged.refusal.message } : ref;
          (judged.outsideClosure ? outsideClosure : unresolved).push(entry);
        }
      }
    }
    return { unresolved, outsideClosure };
  }

  /**
   * One reference, judged: `'resolved'` when the name reaches a list from
   * `callerPackageId`, else what it is — the refusal (when the resolver
   * refused) and whether it refused because every holder is outside the
   * caller's declared closure.
   */
  static judgePicklistReference(this: Pick<PicklistsHost, 'picklistReferenceVerdict'>, name: string, callerPackageId: string | undefined): 'resolved' | { refusal?: PackageScopedRefusal; outsideClosure: boolean } {
    const verdict = this.picklistReferenceVerdict(name, callerPackageId);
    if (verdict.status === 'resolved') return 'resolved';
    if (verdict.status !== 'refused') return { outsideClosure: false };
    return { refusal: verdict, outsideClosure: verdict.reason === 'outside-closure' };
  }

  /**
   * The list `name` reaches from `callerPackageId` (its options, when that is
   * one), followed by every extension of the SAME list.
   *
   * [ADR-0150 D3, child E6; epic seat ruling X on the E6 card, #31678] A
   * `picklistExtensions` entry's `extend` is a CONTRIBUTION to another
   * package's item, not a reference its package reads: it resolves
   * caller-less through R — the environment's own list, else the unique
   * package holder, else a refusal naming every holder — the treatment D3
   * gives an environment overlay. So an extension adds to the list its target
   * names environment-wide, and to a field's list only when that is the same
   * list. Loosens nothing (no first match is picked) and guesses nothing.
   */
  static picklistContributions(this: Pick<PicklistsHost, 'picklistExtensionContributions' | 'picklistReferenceVerdict'>, name: string, callerPackageId?: string | null): PicklistContribution[] {
    const contributions: PicklistContribution[] = [];
    const resolution = this.picklistReferenceVerdict(name, callerPackageId);
    const base = resolution.status === 'resolved' ? resolution : undefined;
    if (base) {
      const item = base.item;
      contributions.push({
        packageId: item?._packageId,
        kind: 'picklist',
        options: Array.isArray(item?.options) ? item.options : [],
      });
    }
    const extended = base ? this.picklistReferenceVerdict(name, null) : undefined;
    if (base && !(extended?.status === 'resolved' && sameHolder(extended.holder, base.holder))) return contributions;
    for (const entry of this.picklistExtensionContributions.get(name)?.values() ?? []) {
      contributions.push({ packageId: entry.packageId, kind: 'extension', options: [...entry.options.values()] });
    }
    return contributions;
  }

  /**
   * The list half of the additive rule: a picklist registered AFTER an
   * extension already added one of its values is refused the same way, so the
   * verdict does not depend on which package registered first.
   */
  static assertPicklistValuesDistinct(this: Pick<PicklistsHost, 'picklistExtensionContributions'>, name: string, picklist: { options?: PicklistOptionLike[] }, packageId: string | undefined): void {
    // The list is not registered yet, so no resolution reaches it: judged
    // against every extension held for the name, as the additive rule reads.
    const extensions: PicklistContribution[] = [...(this.picklistExtensionContributions.get(name)?.values() ?? [])]
      .map((entry) => ({ packageId: entry.packageId, kind: 'extension' as const, options: [...entry.options.values()] }));
    const duplicate = findDuplicatePicklistValue([
      { packageId, kind: 'picklist', options: Array.isArray(picklist?.options) ? picklist.options : [] },
      ...extensions,
    ]);
    if (duplicate) throw duplicatePicklistValueError(name, duplicate);
  }

  /**
   * Resolve every picklist-bound field of a body (by reference when there is
   * none). [ADR-0150 D3, child E6] Each field's list is resolved from the
   * package that WROTE that field's reference (`referrerOf`): the packaged
   * layer whose own declaration carries it, else no package — a reference
   * only an environment-authored body (a tenant overlay, a stored row) writes
   * is the environment's reference, never the package's it customizes (D3).
   */
  static resolvePicklistFields<T>(this: Pick<PicklistsHost, 'resolveFieldPicklistOptions'>, body: T, referrerOf: PicklistReferrer = NO_PACKAGE_REFERRER): T {
    return resolvePicklistFieldsOnto(body, (picklist, field) =>
      this.resolveFieldPicklistOptions(picklist, referrerOf(field, picklist)));
  }

  /**
   * [ADR-0150 D3, child E6; epic seat review on #31731] One field's list, when
   * several packaged layers write its reference: each referrer's resolution
   * is R's, and the field is served only when every one of them resolves to
   * the SAME holder. Any other answer — one of them refused or reaching
   * nothing, or two reaching different holders — serves no options, so the
   * record validator refuses the field's values; the boot audit names each
   * referrer whose own resolution refuses, with R's sentence
   * ({@link findUnresolvedPicklistReferences}). ⛔ No referrer is preferred by
   * fold order.
   */
  static resolveFieldPicklistOptions(this: Pick<PicklistsHost, 'picklistReferenceVerdict' | 'resolvePicklistOptions'>, picklist: string, referrers: readonly (string | null)[]): PicklistOptionLike[] | undefined {
    const [first, ...others] = referrers;
    if (others.length > 0) {
      const verdicts = referrers.map((referrer) => this.picklistReferenceVerdict(picklist, referrer));
      const [head] = verdicts;
      if (head.status !== 'resolved') return undefined;
      if (!verdicts.every((v) => v.status === 'resolved' && sameHolder(v.holder, head.holder))) return undefined;
    }
    return this.resolvePicklistOptions(picklist, first ?? null);
  }

  /** Drop a package's `picklistExtensions`; `true` when it had any. */
  static unregisterPicklistExtensionsByPackage(this: Pick<PicklistsHost, 'picklistExtensionContributions'>, packageId: string): boolean {
    let dropped = false;
    for (const [target, byPackage] of this.picklistExtensionContributions) {
      if (byPackage.delete(packageId)) dropped = true;
      if (byPackage.size === 0) this.picklistExtensionContributions.delete(target);
    }
    return dropped;
  }

  /** The body of `SchemaRegistry#invalidate`; the method's docblock there is its contract. */
  static invalidate(this: Pick<PicklistsHost, '_objectRevision' | 'mergedObjectCache'>, fqnOrName: string): void {
    this._objectRevision += 1;
    if (this.mergedObjectCache.has(fqnOrName)) {
      this.mergedObjectCache.delete(fqnOrName);
      return;
    }
    // Short-name path: drop any cached merge whose FQN ends with `__<name>` or equals `<name>`.
    const suffix = `__${fqnOrName}`;
    for (const fqn of Array.from(this.mergedObjectCache.keys())) {
      if (fqn === fqnOrName || fqn.endsWith(suffix)) {
        this.mergedObjectCache.delete(fqn);
      }
    }
  }

  /** The body of `SchemaRegistry#invalidateAll`; the method's docblock there is its contract. */
  static invalidateAll(this: Pick<PicklistsHost, '_objectRevision' | 'mergedObjectCache'>): void {
    this.mergedObjectCache.clear();
    this._objectRevision += 1;
  }

  /** The body of `SchemaRegistry#reset`; the method's docblock there is its contract. */
  static reset(this: Pick<PicklistsHost, '_objectRevision' | 'appNavContributions' | 'log' | 'mergedObjectCache' | 'metadata' | 'namespaceRegistry' | 'objectContributors' | 'objectKeysByShortName' | 'picklistExtensionContributions' | 'residualOwnerDependencies'>): void {
    this.objectContributors.clear();
    // [#10945] The short-name index is derived from `objectContributors`; a
    // reset that cleared only one of them would resolve names to keys that no
    // longer exist.
    this.objectKeysByShortName.clear();
    this.mergedObjectCache.clear();
    this.namespaceRegistry.clear();
    this.metadata.clear();
    this.appNavContributions.clear();
    this.picklistExtensionContributions.clear();
    this.residualOwnerDependencies.clear();
    this._objectRevision += 1;
    this.log('[Registry] Reset complete');
  }
}
