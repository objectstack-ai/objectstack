// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#33949 codemod] The "Bare names, one name one package holder" section of
 * `SchemaRegistry`: the bodies of `warnAddressLiteralNamespaceOnce`,
 * `bareNamePackageHolders`, `bareNameRenameFor`, `bareNameHolderNamespace`,
 * `bareNameHoldersOtherThan`, `bareNameBundleAdditionMeets`,
 * `refuseBareNameConflicts`, `recordBareNameClaims`, `forgetBareNameClaims`,
 * `claimBareNameFunctions`, `releaseBareNameFunctions`, `sealBareNameHolders`
 * moved out of `registry.ts` whole by
 * the #33949 split codemod (PR #34285, kept in its branch history, not committed).
 *
 * A MOVE, not a redesign. {@link BareNamesFacet} is a stateless facet of `SchemaRegistry`
 * (ruling 6624345766): each static method of it is the body of the `SchemaRegistry`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class as a one-call stub with
 * its signature, so the published surface, an instance spy and a subclass
 * override are what they were. A public or protected method keeps its
 * docblock on the class, the contract; a private method's docblock moved here
 * with its body. The state stays on `SchemaRegistry`.
 *
 * The bodies reach the class through {@link BareNamesHost}: exactly the
 * `SchemaRegistry` members they read, private ones included. Every stub hands
 * its body, by a `.call`, the same host: `bareNamesHost` in
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

import { ITEM_KEY_DISCRIMINATORS } from '@objectstack/metadata-core';
import type { ObjectStackManifest } from '@objectstack/spec/kernel';
import { BARE_NAME_ONE_HOLDER_TYPES, BUILT_IN_BARE_NAMES, bareNameHolderKey, bareNameHoldersMeet, declaredBareNames, declaredBuiltInBoundActions, declaredBundleMembers, handlerOwnerPackageId, holdsBareName, isBareNameRegistryType, isBundleAdditionPair, isOverridableBaseline, suggestedBareNameRename } from './bare-name-one-holder.js';
import type { BareNameHolder, BareNameOneHolderType, BundleHolding } from './bare-name-one-holder.js';
import { bundleBaseKey } from './registry-top-level.js';
import type { BareNameConflict, BundleArrival } from './registry-top-level.js';
import { BareNameConflictError, isShareableNamespace } from './registry.js';
import type { SchemaRegistry } from './registry.js';

/**
 * The `SchemaRegistry` members the bodies of {@link BareNamesFacet} read — every one of
 * them, and no other. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too. `readonly` members are the getters; the others are fields a body
 * assigns.
 */
export interface BareNamesHost {
  readonly addressLiteralNamespaceWarned: SchemaRegistry['addressLiteralNamespaceWarned'];
  bareNameBundleAdditionMeets: SchemaRegistry['bareNameBundleAdditionMeets'];
  readonly bareNameClaims: SchemaRegistry['bareNameClaims'];
  bareNameHolderNamespace: SchemaRegistry['bareNameHolderNamespace'];
  bareNameHoldersOtherThan: SchemaRegistry['bareNameHoldersOtherThan'];
  bareNameHoldersSealed: SchemaRegistry['bareNameHoldersSealed'];
  bareNamePackageHolders: SchemaRegistry['bareNamePackageHolders'];
  bareNameRenameFor: SchemaRegistry['bareNameRenameFor'];
  declaredBundleHolding: SchemaRegistry['declaredBundleHolding'];
  getAllPackages: SchemaRegistry['getAllPackages'];
  getPackage: SchemaRegistry['getPackage'];
  readonly metadata: SchemaRegistry['metadata'];
  noteBareNameClaim: SchemaRegistry['noteBareNameClaim'];
  registeredBundleHolding: SchemaRegistry['registeredBundleHolding'];
}

/** The bodies of the "Bare names, one name one package holder" section of `SchemaRegistry`: a stateless facet, called by the class's stubs. */
export class BareNamesFacet {
  /**
   * [ADR-0150 D5, child G1] Warn, once per package, that an installed
   * package's namespace spells an address-grammar literal: it keeps booting,
   * its items are read with `?package=<id>`, and the remedy is a rename.
   */
  static warnAddressLiteralNamespaceOnce(this: Pick<BareNamesHost, 'addressLiteralNamespaceWarned'>, packageId: string, refusal: string): void {
    if (this.addressLiteralNamespaceWarned.has(packageId)) return;
    this.addressLiteralNamespaceWarned.add(packageId);
    console.warn(
      `[Registry] Package '${packageId}' is installed under a namespace the address grammar reads as a route. `
        + `${refusal} It keeps booting: its items are read with \`?package=${packageId}\`, and a new install `
        + `of this namespace is refused. Renaming the namespace gives the package its qualified address.`,
    );
  }

  /**
   * The packages holding `(type, name)`, in registration order — the item
   * store's order (whose first is the holder a caller with no package is
   * served by {@link getItem}), then any holder by claim alone. A package holds
   * a name through an item registered under it (its composite
   * `<packageId>:<name>` slot, when the item is one the rule covers —
   * `holdsBareName`: an action bound to an object holds nothing) or its claim:
   * recorded at install, or, for a function, at the hook binder's bind
   * ({@link claimBareNameFunctions}). ⛔ Never the bare slot: that is the
   * environment catalog (the ADR-0005 overlay), whatever `_packageId` its
   * hydrated row wears. ⛔ Never a type's overridable baseline
   * ({@link isOverridableBaseline}): the platform's copies, which the
   * consumer serves another package's item over by contract. A bundled type's
   * key carries its member (`pkg:name@locale`, `bundleBaseKey`): the NAME is
   * what is held, so every member of one package's bundle is that one holder.
   */
  static bareNamePackageHolders(this: Pick<BareNamesHost, 'bareNameClaims' | 'metadata'>, type: BareNameOneHolderType, name: string): string[] {
    const holders = new Set<string>();
    if (isBareNameRegistryType(type)) {
      const suffix = `:${name}`;
      for (const [key, item] of this.metadata.get(type) ?? []) {
        const base = bundleBaseKey(key);
        if (base === name || !base.endsWith(suffix) || !holdsBareName(type, item)) continue;
        const stamped = (item as { _packageId?: unknown } | null | undefined)?._packageId;
        holders.add(typeof stamped === 'string' && stamped !== '' ? stamped : base.slice(0, -suffix.length));
      }
    }
    for (const claimant of this.bareNameClaims.get(type)?.get(name) ?? []) holders.add(claimant);
    return [...holders].filter((packageId) => !isOverridableBaseline(type, packageId));
  }

  /**
   * The rename a refusal carries for `name` in `packageId` — its namespace
   * prefixed ({@link suggestedBareNameRename}) — read from the manifest the
   * door holds, else from the installed record. None for a shareable platform
   * namespace (`base` / `system` / `sys`): it names no one package.
   */
  static bareNameRenameFor(this: Pick<BareNamesHost, 'getPackage'>, packageId: string, name: string, namespace?: string): string | undefined {
    const ns = namespace ?? this.getPackage(packageId)?.manifest?.namespace;
    if (!ns || isShareableNamespace(ns)) return undefined;
    return suggestedBareNameRename(ns, name);
  }

  /**
   * [ADR-0150 D2/D9, child B] The namespace a package holder declares — its
   * installed record's `manifest.namespace` — or `undefined`: no record, or
   * none declared. What {@link bareNameHoldersMeet} compares for a type whose
   * rule has narrowed to the namespace.
   */
  static bareNameHolderNamespace(this: Pick<BareNamesHost, 'getPackage'>, packageId: string): string | undefined {
    const namespace = this.getPackage(packageId)?.manifest?.namespace;
    return typeof namespace === 'string' && namespace !== '' ? namespace : undefined;
  }

  /**
   * Every holder `incomingPackageId` would join by holding `(type, name)` —
   * the ONE predicate both doors ask ({@link refuseBareNameConflicts} at the
   * package door, the item seam in {@link registerItem}). Empty before the
   * seal, and empty when `incomingPackageId` already holds the name: a reload,
   * a re-install or an upgrade of a package that came through the boot beside
   * another holder is not a new holder (module doc, "The cold boot"). A
   * built-in name is read only when `builtIns` (the package door), as the
   * security catalog reads its own. A package holder counts only when it
   * meets the incoming package under {@link bareNameHoldersMeet}: for a type
   * narrowed to the namespace, a holder of another namespace does not
   * (`incomingNamespace`, the namespace the incoming package declares) —
   * unless one holding is an addition to the other's bundle
   * ({@link bareNameBundleAdditionMeets}; `incomingHolding`, read only then).
   * `incomingArrival` is what the registration brings (the members it adds):
   * a holder's members are read as if it were registered, so the door judges
   * the state the cold boot's seal would judge (#32408, delta review N1).
   */
  static bareNameHoldersOtherThan(this: Pick<BareNamesHost, 'bareNameBundleAdditionMeets' | 'bareNameHolderNamespace' | 'bareNameHoldersSealed' | 'bareNamePackageHolders'>, type: BareNameOneHolderType, name: string, incomingPackageId: string, opts: {
      builtIns: boolean;
      incomingNamespace: string | undefined;
      incomingHolding?: () => BundleHolding | undefined;
      incomingArrival?: { readonly members: ReadonlySet<string> };
    }): BareNameHolder[] {
    if (!this.bareNameHoldersSealed) return [];
    const packages = this.bareNamePackageHolders(type, name);
    if (packages.includes(incomingPackageId)) return [];
    const found = new Map<string, BareNameHolder>();
    if (opts.builtIns && BUILT_IN_BARE_NAMES[type].has(name)) found.set(bareNameHolderKey({ kind: 'built-in' }), { kind: 'built-in' });
    for (const packageId of packages) {
      if (
        !bareNameHoldersMeet(type, opts.incomingNamespace, this.bareNameHolderNamespace(packageId), name)
        && !this.bareNameBundleAdditionMeets(type, name, opts.incomingHolding, packageId,
          opts.incomingArrival && { packageId: incomingPackageId, ...opts.incomingArrival })
      ) continue;
      const holder: BareNameHolder = { kind: 'package', packageId };
      found.set(bareNameHolderKey(holder), holder);
    }
    return [...found.values()];
  }

  /**
   * [ADR-0150 D9, #31699] Do two package holders of a bundled name meet
   * because one holding is an ADDITION to the other's bundle
   * ({@link isBundleAdditionPair}) — whatever their namespaces, so a type
   * narrowed to the namespace keeps refusing a dependent's added member as
   * it did? `false` for a type that is no bundle, or when the incoming
   * holding cannot be read.
   */
  static bareNameBundleAdditionMeets(this: Pick<BareNamesHost, 'registeredBundleHolding'>, type: BareNameOneHolderType, name: string, incomingHolding: (() => BundleHolding | undefined) | undefined, holderPackageId: string, arrival?: BundleArrival): boolean {
    if (!ITEM_KEY_DISCRIMINATORS[type] || !incomingHolding) return false;
    const incoming = incomingHolding();
    const holder = this.registeredBundleHolding(type, name, holderPackageId, arrival);
    return incoming !== undefined && holder !== undefined && isBundleAdditionPair(incoming, holder);
  }

  /**
   * The package door's half of the rule: once sealed, refuse a package whose
   * declared items of a covered registry type bear a name another holder holds,
   * ahead of every mutation {@link installPackage} makes — the security
   * catalog's disposition, for its reasons: every conflict collected into one
   * refusal, no co-owner exemption, no `collisionPolicy` downgrade, and a
   * package with no identity not judged.
   *
   * @throws {BareNameConflictError} ADR-0112 envelope, naming both holders of
   *   each conflicting name and the rename.
   */
  static refuseBareNameConflicts(this: Pick<BareNamesHost, 'bareNameHoldersOtherThan' | 'bareNameHoldersSealed' | 'bareNameRenameFor' | 'declaredBundleHolding' | 'getPackage'>, manifest: ObjectStackManifest, selfId: string | undefined): void {
    if (selfId === undefined || !this.bareNameHoldersSealed) return;
    const conflicts: BareNameConflict[] = [];
    const seen = new Set<string>();
    const incomingNamespace = typeof manifest.namespace === 'string' && manifest.namespace !== '' ? manifest.namespace : undefined;
    for (const { type, name } of declaredBareNames(manifest)) {
      // One package declaring one name twice is one holder.
      const key = `${type}|${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      for (const existingHolder of this.bareNameHoldersOtherThan(type, name, selfId, {
        builtIns: true,
        incomingNamespace,
        incomingHolding: () => this.declaredBundleHolding(manifest, selfId, type, name),
        incomingArrival: { members: declaredBundleMembers(manifest, type, name) },
      })) {
        conflicts.push({
          type,
          name,
          incomingPackageId: selfId,
          existingHolder,
          rename: this.bareNameRenameFor(selfId, name, manifest.namespace),
        });
      }
    }
    // [#31697, contract review G6] An action bound to an object under a key the
    // platform holds (`BUILT_IN_BOUND_ACTION_KEYS`): the platform's own UI posts
    // to that route by its fixed name.
    for (const { name, objectName } of declaredBuiltInBoundActions(manifest)) {
      if (this.getPackage(selfId) !== undefined && declaredBuiltInBoundActions(this.getPackage(selfId)?.manifest)
        .some((held) => held.name === name && held.objectName === objectName)) continue;
      conflicts.push({
        type: 'action', name, objectName, incomingPackageId: selfId, existingHolder: { kind: 'built-in' },
        rename: this.bareNameRenameFor(selfId, name, manifest.namespace),
      });
    }
    if (conflicts.length > 0) throw new BareNameConflictError(conflicts);
  }

  /**
   * Record `packageId`'s bare-name claims — additive, like
   * {@link recordSecurityCatalogClaims} and for its reasons; released by
   * {@link uninstallPackage}. Recorded before the seal too: the cold boot reads
   * them.
   */
  static recordBareNameClaims(this: Pick<BareNamesHost, 'bareNameClaims' | 'noteBareNameClaim'>, packageId: string, manifest: ObjectStackManifest): void {
    for (const { type, name } of declaredBareNames(manifest)) {
      let byName = this.bareNameClaims.get(type);
      if (!byName) this.bareNameClaims.set(type, byName = new Map());
      this.noteBareNameClaim(type, name);
      let claimants = byName.get(name);
      if (!claimants) byName.set(name, claimants = new Set());
      claimants.add(packageId);
    }
  }

  /** Drop every bare-name claim `packageId` holds. */
  static forgetBareNameClaims(this: Pick<BareNamesHost, 'bareNameClaims'>, packageId: string): void {
    for (const byName of this.bareNameClaims.values()) {
      for (const [name, claimants] of byName) {
        claimants.delete(packageId);
        if (claimants.size === 0) byName.delete(name);
      }
    }
  }

  /** The body of `SchemaRegistry#claimBareNameFunctions`; the method's docblock there is its contract. */
  static claimBareNameFunctions(this: Pick<BareNamesHost, 'bareNameClaims' | 'bareNameHolderNamespace' | 'bareNameHoldersOtherThan' | 'bareNameHoldersSealed' | 'bareNameRenameFor'>, owner: string | undefined, names: readonly string[]): void {
    if (!owner || names.length === 0) return;
    const packageId = handlerOwnerPackageId(owner);
    const unique = [...new Set(names.filter((n) => typeof n === 'string' && n !== ''))];
    if (this.bareNameHoldersSealed) {
      const conflicts: BareNameConflict[] = [];
      for (const name of unique) {
        for (const existingHolder of this.bareNameHoldersOtherThan('function', name, packageId, {
          builtIns: true,
          incomingNamespace: this.bareNameHolderNamespace(packageId),
        })) {
          conflicts.push({
            type: 'function', name, incomingPackageId: packageId, existingHolder,
            rename: this.bareNameRenameFor(packageId, name),
          });
        }
      }
      if (conflicts.length > 0) throw new BareNameConflictError(conflicts);
    }
    let byName = this.bareNameClaims.get('function');
    if (!byName) this.bareNameClaims.set('function', byName = new Map());
    for (const name of unique) {
      let claimants = byName.get(name);
      if (!claimants) byName.set(name, claimants = new Set());
      claimants.add(packageId);
    }
  }

  /** The body of `SchemaRegistry#releaseBareNameFunctions`; the method's docblock there is its contract. */
  static releaseBareNameFunctions(this: Pick<BareNamesHost, 'bareNameClaims'>, owner: string | undefined, stillHolds: (name: string) => boolean): void {
    if (!owner) return;
    const byName = this.bareNameClaims.get('function');
    if (!byName) return;
    const packageId = handlerOwnerPackageId(owner);
    for (const [name, claimants] of [...byName]) {
      if (!claimants.has(packageId) || stillHolds(name)) continue;
      claimants.delete(packageId);
      if (claimants.size === 0) byName.delete(name);
    }
  }

  /** The body of `SchemaRegistry#sealBareNameHolders`; the method's docblock there is its contract. */
  static sealBareNameHolders(this: Pick<BareNamesHost, 'bareNameBundleAdditionMeets' | 'bareNameClaims' | 'bareNameHolderNamespace' | 'bareNameHoldersSealed' | 'bareNamePackageHolders' | 'bareNameRenameFor' | 'getAllPackages' | 'metadata' | 'registeredBundleHolding'>): BareNameConflict[] {
    this.bareNameHoldersSealed = true;
    const conflicts: BareNameConflict[] = [];
    for (const type of BARE_NAME_ONE_HOLDER_TYPES) {
      const candidates = new Set<string>();
      if (isBareNameRegistryType(type)) {
        for (const key of this.metadata.get(type)?.keys() ?? []) {
          // A bundled type's key ends `@<member>`: the NAME is the candidate.
          const base = bundleBaseKey(key);
          const sep = base.lastIndexOf(':');
          if (sep > 0) candidates.add(base.slice(sep + 1));
        }
      }
      for (const name of this.bareNameClaims.get(type)?.keys() ?? []) candidates.add(name);
      for (const name of [...candidates].sort()) {
        if (name === '') continue;
        const packages = this.bareNamePackageHolders(type, name);
        if (BUILT_IN_BARE_NAMES[type].has(name)) {
          for (const packageId of packages) {
            conflicts.push({
              type, name, incomingPackageId: packageId, existingHolder: { kind: 'built-in' },
              rename: this.bareNameRenameFor(packageId, name),
            });
          }
          continue;
        }
        // Each later holder against the first earlier one it meets
        // (`bareNameHoldersMeet`): for a type that has not narrowed, always the
        // first-registered; for one narrowed to the namespace, the first of its
        // own namespace, and none when every earlier holder declares another.
        packages.forEach((packageId, index) => {
          const namespace = this.bareNameHolderNamespace(packageId);
          const first = packages
            .slice(0, index)
            .find((earlier) =>
              bareNameHoldersMeet(type, namespace, this.bareNameHolderNamespace(earlier), name)
              || this.bareNameBundleAdditionMeets(type, name, () => this.registeredBundleHolding(type, name, packageId), earlier));
          if (first === undefined) return;
          conflicts.push({
            type, name, incomingPackageId: packageId, existingHolder: { kind: 'package', packageId: first },
            rename: this.bareNameRenameFor(packageId, name),
          });
        });
      }
    }
    // [#31697, contract review G6] A package the boot registered that declares
    // an action bound to a key the platform holds (`BUILT_IN_BOUND_ACTION_KEYS`).
    for (const pkg of this.getAllPackages()) {
      const packageId = pkg.manifest?.id;
      if (typeof packageId !== 'string') continue;
      for (const { name, objectName } of declaredBuiltInBoundActions(pkg.manifest)) {
        conflicts.push({
          type: 'action', name, objectName, incomingPackageId: packageId, existingHolder: { kind: 'built-in' },
          rename: this.bareNameRenameFor(packageId, name),
        });
      }
    }
    return conflicts;
  }
}
