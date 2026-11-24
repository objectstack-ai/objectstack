// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#33949 codemod] The
 * "Namespaces, default record pages and security catalog names" section of
 * `SchemaRegistry`: the bodies of `registerNamespace`, `unregisterNamespace`,
 * `getNamespaceOwner`, `getNamespaceOwners`, `defaultRecordPageSlots`,
 * `defaultRecordPageHoldersOf`, `otherDefaultRecordPageHolders`,
 * `refuseDefaultRecordPageConflicts`, `recordDefaultRecordPageClaims`,
 * `forgetDefaultRecordPageClaims`, `securityCatalogHoldersOtherThan`,
 * `refuseSecurityCatalogNameConflicts`, `recordSecurityCatalogClaims`,
 * `forgetSecurityCatalogClaims`, `securityCatalogNamesHeldBy`,
 * `environmentHeldSecurityCatalogConflicts`, `packageHeldSecurityCatalogNames`,
 * `securityCatalogPackageHolders` moved out of `registry.ts` whole by
 * the #33949 split codemod (PR #34285, kept in its branch history, not committed).
 *
 * A MOVE, not a redesign. {@link NamespacesAndClaimsFacet} is a stateless facet of `SchemaRegistry`
 * (ruling 6624345766): each static method of it is the body of the `SchemaRegistry`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class as a one-call stub with
 * its signature, so the published surface, an instance spy and a subclass
 * override are what they were. A public or protected method keeps its
 * docblock on the class, the contract; a private method's docblock moved here
 * with its body. The state stays on `SchemaRegistry`.
 *
 * The bodies reach the class through {@link NamespacesAndClaimsHost}: exactly
 * the `SchemaRegistry` members they read, private ones included. Every stub
 * hands its body, by a `.call`, the same host: `namespacesAndClaimsHost` in
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

import { isTenantAuthored } from '@objectstack/metadata-core';
import type { ObjectStackManifest } from '@objectstack/spec/kernel';
import { permissionSetHoldersMeet } from '@objectstack/core';
import type { SecurityCatalogType } from '@objectstack/core';
import { BUILT_IN_SECURITY_CATALOG_NAMES, ENVIRONMENT_HELD_SECURITY_CATALOG_TYPES, declaredSecurityCatalogNames, securityCatalogHolderKey } from './security-catalog-namespace.js';
import type { SecurityCatalogHolder } from './security-catalog-namespace.js';
import { declaredDefaultRecordPages, defaultRecordPageHolderKey, holdsRecordPageSlot, misplacedDefaultPages, recordPageSlotKey } from './default-record-page.js';
import type { DefaultRecordPageHolder, RecordPageSlot } from './default-record-page.js';
import { overlaySlotEntriesOf, parseOverlaySlotKey, storedRowPackageOf } from './registry-top-level.js';
import type { DefaultRecordPageConflict, SecurityCatalogNameConflict } from './registry-top-level.js';
import {
  DefaultRecordPageConflictError, MisplacedDefaultPageError, SecurityCatalogNameConflictError,
} from './registry.js';
import type { SchemaRegistry } from './registry.js';

/**
 * The `SchemaRegistry` members the bodies of {@link NamespacesAndClaimsFacet} read — every one of
 * them, and no other. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too. `readonly` members are the getters; the others are fields a body
 * assigns.
 */
export interface NamespacesAndClaimsHost {
  bareNameHolderNamespace: SchemaRegistry['bareNameHolderNamespace'];
  readonly defaultRecordPageClaims: SchemaRegistry['defaultRecordPageClaims'];
  defaultRecordPageSlots: SchemaRegistry['defaultRecordPageSlots'];
  forgetDefaultRecordPageClaims: SchemaRegistry['forgetDefaultRecordPageClaims'];
  log: SchemaRegistry['log'];
  readonly metadata: SchemaRegistry['metadata'];
  readonly namespaceRegistry: SchemaRegistry['namespaceRegistry'];
  noteDefaultRecordPageClaims: SchemaRegistry['noteDefaultRecordPageClaims'];
  noteNamespace: SchemaRegistry['noteNamespace'];
  noteSecurityCatalogClaim: SchemaRegistry['noteSecurityCatalogClaim'];
  otherDefaultRecordPageHolders: SchemaRegistry['otherDefaultRecordPageHolders'];
  packageHeldSecurityCatalogNames: SchemaRegistry['packageHeldSecurityCatalogNames'];
  readonly securityCatalogClaims: SchemaRegistry['securityCatalogClaims'];
  securityCatalogHoldersOtherThan: SchemaRegistry['securityCatalogHoldersOtherThan'];
  securityCatalogPackageHolders: SchemaRegistry['securityCatalogPackageHolders'];
}

/** The bodies of the "Namespaces, default record pages and security catalog names" section of `SchemaRegistry`: a stateless facet, called by the class's stubs. */
export class NamespacesAndClaimsFacet {
  /** The body of `SchemaRegistry#registerNamespace`; the method's docblock there is its contract. */
  static registerNamespace(this: Pick<NamespacesAndClaimsHost, 'log' | 'namespaceRegistry' | 'noteNamespace'>, namespace: string, packageId: string): void {
    if (!namespace) return;
    this.noteNamespace(namespace);

    let owners = this.namespaceRegistry.get(namespace);
    if (!owners) {
      owners = new Set();
      this.namespaceRegistry.set(namespace, owners);
    }
    owners.add(packageId);
    this.log(`[Registry] Registered namespace: ${namespace} → ${packageId}`);
  }

  /** The body of `SchemaRegistry#unregisterNamespace`; the method's docblock there is its contract. */
  static unregisterNamespace(this: Pick<NamespacesAndClaimsHost, 'log' | 'namespaceRegistry' | 'noteNamespace'>, namespace: string, packageId: string): void {
    const owners = this.namespaceRegistry.get(namespace);
    if (owners) {
      this.noteNamespace(namespace);
      owners.delete(packageId);
      if (owners.size === 0) {
        this.namespaceRegistry.delete(namespace);
      }
      this.log(`[Registry] Unregistered namespace: ${namespace} ← ${packageId}`);
    }
  }

  /** The body of `SchemaRegistry#getNamespaceOwner`; the method's docblock there is its contract. */
  static getNamespaceOwner(this: Pick<NamespacesAndClaimsHost, 'namespaceRegistry'>, namespace: string): string | undefined {
    const owners = this.namespaceRegistry.get(namespace);
    if (!owners || owners.size === 0) return undefined;
    // Return the first registered package for backwards compatibility
    return owners.values().next().value;
  }

  /** The body of `SchemaRegistry#getNamespaceOwners`; the method's docblock there is its contract. */
  static getNamespaceOwners(this: Pick<NamespacesAndClaimsHost, 'namespaceRegistry'>, namespace: string): string[] {
    const owners = this.namespaceRegistry.get(namespace);
    return owners ? Array.from(owners) : [];
  }

  /**
   * Every page holding the default record page of `object`, each tagged with
   * whether it holds through the registry's bare slot (an environment item,
   * which stands in for every slot of its name — module doc, "What is not a
   * second default").
   *
   * Read, per page name: the bare slot when there is one — its own body
   * decides, and the composite slots and claims of that name are shadowed by
   * it; otherwise every composite `PACKAGE:NAME` slot, and every install claim.
   * A bare-slot item carrying a real package stamp is that package's page as
   * overlaid in this environment (the protocol grafts the package's envelope
   * onto an overlay of a packaged page), and is named as that package's page.
   * A disabled package is still installed, and its pages still hold.
   */
  static defaultRecordPageSlots(this: Pick<NamespacesAndClaimsHost, 'defaultRecordPageClaims' | 'metadata'>, slot: RecordPageSlot): Array<{ holder: DefaultRecordPageHolder; bare: boolean }> {
    const found = new Map<string, { holder: DefaultRecordPageHolder; bare: boolean }>();
    const add = (holder: DefaultRecordPageHolder, bare: boolean) => {
      found.set(defaultRecordPageHolderKey(holder), { holder, bare });
    };
    const bareNames = new Set<string>();
    const composites: Array<{ packageId: string; page: string; item: unknown }> = [];
    for (const [key, item] of this.metadata.get('page') ?? []) {
      const sep = key.lastIndexOf(':');
      const stamped = (item as { _packageId?: unknown } | null | undefined)?._packageId;
      if (sep < 0) {
        bareNames.add(key);
        if (!holdsRecordPageSlot(item, slot)) continue;
        const packaged =
          typeof stamped === 'string' && stamped !== '' && stamped !== 'sys_metadata' && !isTenantAuthored(item);
        add(packaged ? { kind: 'package', packageId: stamped, page: key } : { kind: 'environment', page: key }, true);
      } else {
        composites.push({
          packageId: typeof stamped === 'string' && stamped !== '' ? stamped : key.slice(0, sep),
          page: key.slice(sep + 1),
          item,
        });
      }
    }
    for (const { packageId, page, item } of composites) {
      if (bareNames.has(page) || !holdsRecordPageSlot(item, slot)) continue;
      add({ kind: 'package', packageId, page }, false);
    }
    for (const [packageId, page] of this.defaultRecordPageClaims.get(recordPageSlotKey(slot)) ?? []) {
      if (bareNames.has(page)) continue;
      add({ kind: 'package', packageId, page }, false);
    }
    return [...found.values()];
  }

  /** The body of `SchemaRegistry#defaultRecordPageHoldersOf`; the method's docblock there is its contract. */
  static defaultRecordPageHoldersOf(this: Pick<NamespacesAndClaimsHost, 'defaultRecordPageSlots'>, object: string, app?: string): DefaultRecordPageHolder[] {
    return this.defaultRecordPageSlots(app === undefined ? { object } : { object, app }).map(({ holder }) => holder);
  }

  /**
   * The holders of `object`'s default record page that a package registering
   * `page` as that default would meet as a SECOND default — every holder but
   * the package's own pages and the bare-slot item of the same name (the
   * environment's overlay of the very page being registered).
   */
  static otherDefaultRecordPageHolders(this: Pick<NamespacesAndClaimsHost, 'defaultRecordPageSlots'>, slot: RecordPageSlot, page: string, packageId: string): DefaultRecordPageHolder[] {
    return this.defaultRecordPageSlots(slot)
      .filter(({ holder, bare }) => {
        if (holder.kind === 'package' && holder.packageId === packageId) return false;
        return !(bare && holder.page === page);
      })
      .map(({ holder }) => holder);
  }

  /**
   * The package door's half of the rule: refuse a package whose declared
   * default record pages meet another holder — a second page of the same
   * manifest for the same object, or a page another package or the environment
   * holds — ahead of every mutation {@link installPackage} makes, so a refused
   * package leaves no record, no namespace ownership and no claim behind.
   *
   * Every conflict is collected, so one refusal reports all of them. A package
   * with no identity (`artifactPackageId` answers nothing) registers under no
   * package at all and has nothing to hold; it is not judged here.
   *
   * @throws {DefaultRecordPageConflictError} ADR-0112 envelope, naming both
   *   pages of each conflict.
   */
  static refuseDefaultRecordPageConflicts(this: Pick<NamespacesAndClaimsHost, 'otherDefaultRecordPageHolders'>, manifest: ObjectStackManifest, selfId: string | undefined): void {
    // `isDefault: true` on a page that is not a record page bound to an object
    // is refused on its own account first (maintainer ruling A on
    // objectstack#23610) — whatever the package's identity, since the page
    // itself, not a holder, is what is wrong.
    const misplaced = misplacedDefaultPages(manifest);
    if (misplaced.length > 0) throw new MisplacedDefaultPageError(selfId, misplaced);
    if (selfId === undefined) return;
    const conflicts: DefaultRecordPageConflict[] = [];
    // slot → the first page this manifest declares for it.
    const firstDeclared = new Map<string, string>();
    for (const { page, ...slot } of declaredDefaultRecordPages(manifest)) {
      const incoming: DefaultRecordPageHolder = { kind: 'package', packageId: selfId, page };
      const key = recordPageSlotKey(slot);
      const first = firstDeclared.get(key);
      if (first === undefined) {
        firstDeclared.set(key, page);
        for (const existing of this.otherDefaultRecordPageHolders(slot, page, selfId)) {
          conflicts.push({ ...slot, incoming, existing });
        }
      } else if (first !== page) {
        // Two pages of one manifest for one slot. One page declared twice
        // under one name is one page (the stack contract refuses the repeat).
        conflicts.push({ ...slot, incoming, existing: { kind: 'package', packageId: selfId, page: first } });
      }
    }
    if (conflicts.length > 0) throw new DefaultRecordPageConflictError(conflicts);
  }

  /**
   * Replace `packageId`'s claims with what `manifest` declares (see
   * {@link defaultRecordPageClaims} for why a re-install replaces).
   */
  static recordDefaultRecordPageClaims(this: Pick<NamespacesAndClaimsHost, 'defaultRecordPageClaims' | 'forgetDefaultRecordPageClaims' | 'noteDefaultRecordPageClaims'>, packageId: string, manifest: ObjectStackManifest): void {
    this.noteDefaultRecordPageClaims(packageId);
    this.forgetDefaultRecordPageClaims(packageId);
    for (const { page, ...slot } of declaredDefaultRecordPages(manifest)) {
      const key = recordPageSlotKey(slot);
      let byPackage = this.defaultRecordPageClaims.get(key);
      if (!byPackage) {
        byPackage = new Map();
        this.defaultRecordPageClaims.set(key, byPackage);
      }
      if (!byPackage.has(packageId)) byPackage.set(packageId, page);
    }
  }

  /** Drop every default record page claim `packageId` holds. */
  static forgetDefaultRecordPageClaims(this: Pick<NamespacesAndClaimsHost, 'defaultRecordPageClaims'>, packageId: string): void {
    for (const [object, byPackage] of this.defaultRecordPageClaims) {
      byPackage.delete(packageId);
      if (byPackage.size === 0) this.defaultRecordPageClaims.delete(object);
    }
  }

  /**
   * Every holder of `(type, name)` other than `exceptPackageId` — the ONE
   * predicate both refusals ({@link refuseSecurityCatalogNameConflicts} at the
   * package door, the item seam in {@link registerItem}) ask.
   *
   * Read, in this order: a built-in (only when `builtIns` — see
   * {@link BUILT_IN_SECURITY_CATALOG_NAMES} for why the item seam does not ask);
   * the bare slot (an override a package bound to itself, else an
   * environment-authored item — the latter only when `environment`); every
   * composite `<packageId>:<name>` slot; every package overlay slot (a stored
   * item bound to a package is that package's holding, #32780); the package
   * claims. A package that
   * holds the name more than one way is one holder. A disabled package is still
   * installed, and still holds its names.
   *
   * [ADR-0150 D2/D9, #31698] For a permission set, a package holder counts only
   * when it meets the incoming package under {@link permissionSetHoldersMeet}
   * (`incomingNamespace`, the namespace the incoming package declares): two
   * packages of two namespaces each hold their own set of the name. Positions
   * and capabilities keep one holder per name.
   */
  static securityCatalogHoldersOtherThan(this: Pick<NamespacesAndClaimsHost, 'bareNameHolderNamespace' | 'metadata' | 'securityCatalogClaims'>, type: SecurityCatalogType, name: string, exceptPackageId: string | undefined, opts: { builtIns: boolean; environment: boolean; incomingNamespace: string | undefined }): SecurityCatalogHolder[] {
    const found = new Map<string, SecurityCatalogHolder>();
    const add = (holder: SecurityCatalogHolder) => {
      if (holder.kind === 'package' && holder.packageId === exceptPackageId) return;
      if (holder.kind === 'package' && type === 'permission'
        && !permissionSetHoldersMeet(opts.incomingNamespace, this.bareNameHolderNamespace(holder.packageId), name)) return;
      found.set(securityCatalogHolderKey(holder), holder);
    };
    if (opts.builtIns && BUILT_IN_SECURITY_CATALOG_NAMES[type].has(name)) add({ kind: 'built-in' });
    const suffix = `:${name}`;
    for (const [key, item] of this.metadata.get(type) ?? []) {
      const stamped = (item as { _packageId?: unknown } | null | undefined)?._packageId;
      if (key === name) {
        if (typeof stamped === 'string' && stamped !== '') add({ kind: 'package', packageId: stamped });
        else if (opts.environment) add({ kind: 'environment' });
      } else if (key.endsWith(suffix)) {
        add({
          kind: 'package',
          packageId: typeof stamped === 'string' && stamped !== '' ? stamped : key.slice(0, -suffix.length),
        });
      } else {
        // [#32780] A package's overlay slot counts as a holder of its name:
        // the stored set bound to that package is its holding.
        const slot = parseOverlaySlotKey(key);
        if (slot !== undefined && slot.bareKey === name) add({ kind: 'package', packageId: slot.packageId });
      }
    }
    for (const claimant of this.securityCatalogClaims.get(type)?.get(name) ?? []) add({ kind: 'package', packageId: claimant });
    return [...found.values()];
  }

  /**
   * The package door's half of the rule: refuse a package whose declared
   * positions, permission sets or capabilities name something another holder
   * already holds — built-ins included — ahead of every mutation
   * {@link installPackage} makes, so a refused package leaves no record, no
   * namespace ownership and no claim behind (the namespace gate's disposition).
   *
   * Every conflict is collected, so one refusal reports all of them. A package
   * with no identity (`artifactPackageId` answers nothing) registers under no
   * package at all and has nothing to hold; it is not judged here.
   *
   * @throws {SecurityCatalogNameConflictError} ADR-0112 envelope, naming both
   *   holders of each conflicting name.
   */
  static refuseSecurityCatalogNameConflicts(this: Pick<NamespacesAndClaimsHost, 'securityCatalogHoldersOtherThan'>, manifest: ObjectStackManifest, selfId: string | undefined): void {
    if (selfId === undefined) return;
    const conflicts: SecurityCatalogNameConflict[] = [];
    const seen = new Set<string>();
    const incomingNamespace = typeof manifest.namespace === 'string' && manifest.namespace !== '' ? manifest.namespace : undefined;
    for (const { type, name } of declaredSecurityCatalogNames(manifest)) {
      // One package declaring one name twice is one holder (an in-package
      // repeat is the package's own business, and not this rule's).
      const key = `${type}|${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      for (const existingHolder of this.securityCatalogHoldersOtherThan(type, name, selfId, { builtIns: true, environment: true, incomingNamespace })) {
        conflicts.push({ catalogType: type, name, incomingPackageId: selfId, existingHolder });
      }
    }
    if (conflicts.length > 0) throw new SecurityCatalogNameConflictError(conflicts);
  }

  /**
   * Record `packageId`'s claims. Additive, like the item store beside it: a
   * re-install does not unregister the items an earlier install of the same
   * package registered, so it does not release their names either — and a
   * re-install whose manifest carries no collections at all (`POST
   * /api/v1/packages` stores the manifest alone) must not strip the names the
   * package's code still declares. {@link uninstallPackage} is what releases
   * them.
   */
  static recordSecurityCatalogClaims(this: Pick<NamespacesAndClaimsHost, 'noteSecurityCatalogClaim' | 'securityCatalogClaims'>, packageId: string, manifest: ObjectStackManifest): void {
    for (const { type, name } of declaredSecurityCatalogNames(manifest)) {
      let byName = this.securityCatalogClaims.get(type);
      if (!byName) {
        byName = new Map();
        this.securityCatalogClaims.set(type, byName);
      }
      this.noteSecurityCatalogClaim(type, name);
      let claimants = byName.get(name);
      if (!claimants) byName.set(name, claimants = new Set());
      claimants.add(packageId);
    }
  }

  /** Drop every claim `packageId` holds. */
  static forgetSecurityCatalogClaims(this: Pick<NamespacesAndClaimsHost, 'securityCatalogClaims'>, packageId: string): void {
    for (const byName of this.securityCatalogClaims.values()) {
      for (const [name, claimants] of byName) {
        claimants.delete(packageId);
        if (claimants.size === 0) byName.delete(name);
      }
    }
  }

  /** The body of `SchemaRegistry#securityCatalogNamesHeldBy`; the method's docblock there is its contract. */
  static securityCatalogNamesHeldBy(this: Pick<NamespacesAndClaimsHost, 'metadata' | 'securityCatalogClaims'>, packageId: string, type: SecurityCatalogType): string[] {
    const names = new Set<string>();
    for (const [name, claimants] of this.securityCatalogClaims.get(type) ?? []) {
      if (claimants.has(packageId)) names.add(name);
    }
    const prefix = `${packageId}:`;
    for (const [key, item] of this.metadata.get(type) ?? []) {
      if (key.startsWith(prefix)) names.add(key.slice(prefix.length));
      else if ((item as { _packageId?: unknown } | null | undefined)?._packageId === packageId) names.add(key);
    }
    return [...names].sort();
  }

  /**
   * The cold-boot half of the rule (`security-catalog-namespace.ts`, "The cold
   * boot"; maintainer ruling letter A on #22307, record 6063176077): every
   * package-held position, permission-set and capability name the environment catalog also
   * holds, as the conflicts {@link SecurityCatalogNameConflictError} reports —
   * the package that declares the name as the incoming side, the environment
   * catalog as the holder. Read-only: it records nothing and refuses nothing;
   * the engine plugin asks it once `sys_metadata` has hydrated, and refuses the
   * boot on any answer.
   *
   * - **The environment's names** are the bare-slot items of the two types the
   *   environment can author ({@link ENVIRONMENT_HELD_SECURITY_CATALOG_TYPES}).
   *   Every bare-slot item is the environment's whatever `_packageId` it wears:
   *   only a registration with no package writes the bare slot, and at a cold
   *   boot hydration grafts the package's envelope onto the stored row (the
   *   protocol's artifact-protection merge), so the stamp names the very
   *   package the row collides with.
   *   A stored row in a package overlay slot ({@link overlaySlotKey}; a stored
   *   permission set bound to a package takes one, #32780) is the environment's
   *   too where it is held against the declaring package: the declarer's own
   *   slot, a slot whose item is served as the declarer's, or, for a permission
   *   set, the slot of a package that meets the declarer under the one
   *   predicate ({@link permissionSetHoldersMeet}). A slot of a package of
   *   another namespace is that package's own set and holds nothing against it.
   * - **A package holds a name** through an item registered under it (its
   *   composite slot) or its install claim — never through the bare slot.
   * - **Built-in names are skipped**, as the item seam skips the environment
   *   holder for them: the platform declares its built-in positions itself
   *   (after this check, in its own `start()`), and an environment item under a
   *   built-in name is a stored definition that shadows the declaration at
   *   read (ADR-0005) — a legitimate shadow, not a second holder.
   *
   * Sorted by type, then name, so two boots of one database report alike.
   *
   * Computed as {@link packageHeldSecurityCatalogNames} met with the bare slot,
   * so the package half is ONE reading: the cold boot asks it here, and
   * `os migrate security-catalog-overlays` asks it through the exported
   * {@link findPackageHeldSecurityCatalogNames} and meets it with the stored rows
   * (maintainer ruling letter B on #22371, record 6074838935).
   *
   * Private, like the rest of this rule's registry half; the engine plugin,
   * which owns the boot sequence it is asked in, reaches it through the
   * module-level {@link findEnvironmentHeldSecurityCatalogNames}, which the
   * package entries do not re-export.
   */
  static environmentHeldSecurityCatalogConflicts(this: Pick<NamespacesAndClaimsHost, 'bareNameHolderNamespace' | 'metadata' | 'packageHeldSecurityCatalogNames'>): SecurityCatalogNameConflict[] {
    const conflicts: SecurityCatalogNameConflict[] = [];
    for (const { catalogType, name, packageIds } of this.packageHeldSecurityCatalogNames()) {
      const collection = this.metadata.get(catalogType);
      // The environment's item: the bare slot, whatever `_packageId` it wears.
      // A held name never contains `:` and is never a built-in, so this is the
      // bare-slot reading the method header states.
      const bare = collection?.has(name) === true;
      const stored = collection === undefined ? [] : overlaySlotEntriesOf(collection, name).map((entry) => ({
        packageId: storedRowPackageOf(entry)!,
        stamped: (entry.item as { _packageId?: unknown } | null | undefined)?._packageId,
      }));
      for (const packageId of packageIds) {
        // [ADR-0048 N.3, #32780] A stored row in a package overlay slot is the
        // environment's too when it is held against the declaring package: the
        // declarer's own slot, a slot whose item is served as the declarer's,
        // or (a permission set) the slot of a package that meets the declarer
        // under the one predicate; any slot for a type of one holder per name.
        const heldAgainst = (slot: { packageId: string; stamped: unknown }) => slot.packageId === packageId
          || slot.stamped === packageId
          || catalogType !== 'permission'
          || permissionSetHoldersMeet(this.bareNameHolderNamespace(packageId), this.bareNameHolderNamespace(slot.packageId), name);
        if (!bare && !stored.some(heldAgainst)) continue;
        conflicts.push({ catalogType, name, incomingPackageId: packageId, existingHolder: { kind: 'environment' } });
      }
    }
    return conflicts;
  }

  /**
   * Every position, permission-set and capability name a package holds, with its holders —
   * the package half of {@link environmentHeldSecurityCatalogConflicts}, and the
   * reading {@link findPackageHeldSecurityCatalogNames} exports.
   *
   * The candidate names are every composite slot's name and every install
   * claim of the types the environment catalog can hold
   * ({@link ENVIRONMENT_HELD_SECURITY_CATALOG_TYPES}); each one's holders are
   * {@link securityCatalogPackageHolders}'s answer, the one predicate. Built-in
   * names are skipped, as the cold boot skips them (see the method above).
   * Sorted by type in that list's order, then name.
   *
   * Also read BY NAME from `@objectstack/metadata-protocol`
   * (`protocol-save-door-refusals.ts`, `registryPackageHoldersOf`): renaming
   * this member means updating that caller and
   * `protocol-permission-set-name-registry-reading.test.ts`.
   */
  static packageHeldSecurityCatalogNames(this: Pick<NamespacesAndClaimsHost, 'metadata' | 'securityCatalogClaims' | 'securityCatalogPackageHolders'>): Array<{ catalogType: SecurityCatalogType; name: string; packageIds: string[] }> {
    const held: Array<{ catalogType: SecurityCatalogType; name: string; packageIds: string[] }> = [];
    for (const type of ENVIRONMENT_HELD_SECURITY_CATALOG_TYPES) {
      const candidates = new Set<string>();
      for (const key of this.metadata.get(type)?.keys() ?? []) {
        const sep = key.lastIndexOf(':');
        if (sep > 0) candidates.add(key.slice(sep + 1));
      }
      for (const name of this.securityCatalogClaims.get(type)?.keys() ?? []) candidates.add(name);
      for (const name of [...candidates].sort()) {
        if (name === '' || BUILT_IN_SECURITY_CATALOG_NAMES[type].has(name)) continue;
        const packageIds = this.securityCatalogPackageHolders(type, name);
        if (packageIds.length > 0) held.push({ catalogType: type, name, packageIds });
      }
    }
    return held;
  }

  /**
   * The packages holding `(type, name)` through an item registered under them
   * (a composite `<packageId>:<name>` slot) or an install claim — the package
   * half of {@link securityCatalogHoldersOtherThan}'s reading, without the bare
   * slot, whose stamp is not a claim (see {@link environmentHeldSecurityCatalogConflicts}).
   */
  static securityCatalogPackageHolders(this: Pick<NamespacesAndClaimsHost, 'metadata' | 'securityCatalogClaims'>, type: SecurityCatalogType, name: string): string[] {
    const holders = new Set<string>();
    const suffix = `:${name}`;
    for (const [key, item] of this.metadata.get(type) ?? []) {
      if (key === name || !key.endsWith(suffix)) continue;
      const stamped = (item as { _packageId?: unknown } | null | undefined)?._packageId;
      holders.add(typeof stamped === 'string' && stamped !== '' ? stamped : key.slice(0, -suffix.length));
    }
    for (const claimant of this.securityCatalogClaims.get(type)?.get(name) ?? []) holders.add(claimant);
    return [...holders];
  }
}
