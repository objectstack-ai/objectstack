// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#33949 codemod] The "Package-scoped addressing" section of `SchemaRegistry`:
 * the bodies of `overlaySlotBinding`, `overlayRowBinding`, `pairRowBinding`,
 * `ownersHoldingAName`, `compositeHoldersOf`, `packageScopedHoldersOf`,
 * `bundleMembersHeldBy`, `gateSlotBinding`, `getPackageScopedItem`,
 * `getEnvironmentScopedItem`, `getEnvironmentScopedActions`, `readsByPackage`,
 * `readBareDoc`, `bareSlotEntriesOf`, `rankedForPackage`,
 * `removePackageOverlaySlots`, `orderedOverlayTier`, `getArtifactItem`,
 * `removeRuntimeShadow`, `removeOverlayEntry`, `listItems`,
 * `isPackageDisabled`, `isObjectPackageDisabled`, `isFlowOfDisabledPackage`,
 * `isActionWithheldByDisabledPackage`, `hasDisabledPackage`,
 * `getRegisteredTypes` moved out of `registry.ts` whole by
 * the #33949 split codemod (PR #34285, kept in its branch history, not committed).
 *
 * A MOVE, not a redesign. {@link PackageAddressingFacet} is a stateless facet of `SchemaRegistry`
 * (ruling 6624345766): each static method of it is the body of the `SchemaRegistry`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class as a one-call stub with
 * its signature, so the published surface, an instance spy and a subclass
 * override are what they were. A public or protected method keeps its
 * docblock on the class, the contract; a private method's docblock moved here
 * with its body. The state stays on `SchemaRegistry`.
 *
 * The bodies reach the class through {@link PackageAddressingHost}: exactly the
 * `SchemaRegistry` members they read, private ones included. Every stub hands
 * its body, by a `.call`, the same host: `packageAddressingHost` in
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

import { ITEM_KEY_DISCRIMINATORS, readDiscriminatorValue as discriminatorValue, isCodeArtifactBody, isTenantAuthored } from '@objectstack/metadata-core';
import { customizationBasePackageId } from '@objectstack/spec/kernel';
import { PackageScopedNameRefusedError, packageScopedRefusalMessage } from '@objectstack/core';
import type { PackageScopedResolvableType } from '@objectstack/core';
import { isPackageScopedReadType } from './package-scoped-read.js';
import type { PackageScopedRefusal } from './package-scoped-resolver.js';
import {
  OVERLAY_SLOT_MARK, bundleBaseKey, collectBundle, entriesOfMember, overlaySlotEntriesOf,
  packagelessActionSlotEntriesOf, parseOverlaySlotKey, pickBundleMember, storedRowPackageOf,
} from './registry-top-level.js';
import type { BundleEntry, ObjectExtensionFoldOptions } from './registry-top-level.js';
import {
  NOT_A_PAIR_ROW_OF_A_HOLDER, actionHoldersOnOwnerKeyOf, declaredOverrideBase, pairRowDeclaresAnotherHolder,
} from './registry.js';
import type { SchemaRegistry } from './registry.js';

/**
 * The `SchemaRegistry` members the bodies of {@link PackageAddressingFacet} read — every one of
 * them, and no other. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too. `readonly` members are the getters; the others are fields a body
 * assigns.
 */
export interface PackageAddressingHost {
  bareSlotEntriesOf: SchemaRegistry['bareSlotEntriesOf'];
  bundleMembersHeldBy: SchemaRegistry['bundleMembersHeldBy'];
  compositeHoldersOf: SchemaRegistry['compositeHoldersOf'];
  gateSlotBinding: SchemaRegistry['gateSlotBinding'];
  getAllObjects: SchemaRegistry['getAllObjects'];
  getItem: SchemaRegistry['getItem'];
  getObjectOwner: SchemaRegistry['getObjectOwner'];
  getPackage: SchemaRegistry['getPackage'];
  getPackageScopedItem: SchemaRegistry['getPackageScopedItem'];
  hasDisabledPackage: SchemaRegistry['hasDisabledPackage'];
  invalidateAll: SchemaRegistry['invalidateAll'];
  isBundleAddition: SchemaRegistry['isBundleAddition'];
  isFlowOfDisabledPackage: SchemaRegistry['isFlowOfDisabledPackage'];
  isObjectPackageDisabled: SchemaRegistry['isObjectPackageDisabled'];
  isPackageDisabled: SchemaRegistry['isPackageDisabled'];
  log: SchemaRegistry['log'];
  readonly metadata: SchemaRegistry['metadata'];
  noteItem: SchemaRegistry['noteItem'];
  readonly objectContributors: SchemaRegistry['objectContributors'];
  overlaySlotBinding: SchemaRegistry['overlaySlotBinding'];
  ownersHoldingAName: SchemaRegistry['ownersHoldingAName'];
  packageScopedHoldersOf: SchemaRegistry['packageScopedHoldersOf'];
  packagelessActionEntryToRetire: SchemaRegistry['packagelessActionEntryToRetire'];
  pairRowBinding: SchemaRegistry['pairRowBinding'];
  rankedForPackage: SchemaRegistry['rankedForPackage'];
  resolveObjectKey: SchemaRegistry['resolveObjectKey'];
  resolveOwnerLayer: SchemaRegistry['resolveOwnerLayer'];
  retirePackagelessActionSlot: SchemaRegistry['retirePackagelessActionSlot'];
  settledPairRowBinding: SchemaRegistry['settledPairRowBinding'];
}

/** The bodies of the "Package-scoped addressing" section of `SchemaRegistry`: a stateless facet, called by the class's stubs. */
export class PackageAddressingFacet {
  /**
   * [ADR-0150 D4, "registry overlay slot (ADR-0005)"] The package a bare-slot
   * entry of `(type, name)` customizes — the per-package overlay slot.
   *
   * The registry still stores ONE bare slot per name (every `sys_metadata`
   * hydration and write-through writes it, and {@link getItem} serves it first
   * to every caller). What changes here is what that entry is BOUND to: an
   * overlay binds to the `(package, name)` it customizes, so a package-scoped
   * read of another package's same-named item never sees it.
   *
   * The binding is the entry's `_packageId` — the stored row's `package_id`
   * column, or the artifact envelope the hydration grafted onto it (ADR-0010
   * §3.3; `withRowBinding` drops a body's own stamp for a package-less row) —
   * read as follows:
   *
   *  - none, `''` or the `sys_metadata` sentinel (a package-less row), when no
   *    package holds the name in a composite slot → `null`: the environment's
   *    own item (ADR-0150 D1 bucket 4);
   *  - a package-less row when exactly one package holds the name → that
   *    package: "a package-less row that bears a package-held name is a
   *    customization, never a second item" (ADR-0150 D3), the ADR-0005
   *    overlay of the one holder, read at call time, so a package installed
   *    after the row was saved makes it that package's overlay;
   *  - a package-less row when two or more packages hold the name →
   *    `undefined`: a customization of a name it cannot say whose, so it binds
   *    to no package and is no environment item either (never a guess);
   *  - a package that holds the name in its composite slot → that package
   *    (an ADR-0005 overlay of its item);
   *  - a customization pair's row, when some holder of the name is a package
   *    the pair customizes (`isPairOf`: the App's pair is shared by every
   *    package of the App, ADR-0146 D3) → {@link pairRowBinding}, the exact
   *    read's owner check (`pairRowOnAddress`, metadata-protocol): the holder
   *    its `overrides.package` declares, else the App whose own pair it is
   *    (#28390 ruling A), else its one owner, else no package;
   *  - a paired `<base>.custom` package holding no composite slot of the name,
   *    whose base does → the base (ADR-0146 D9: the pair's declared override
   *    customizes its base's item);
   *  - any other package → that package: its own stored item of the name.
   *
   * `holders` is the composite holder set, passed in when the caller already
   * has it.
   *
   * [ADR-0150 D4] An `action` is identified by `(package, owning object,
   * name)`, so for a package-less action the holders counted above are only
   * those whose own item has the same owner key ({@link standaloneActionOwnerKey},
   * the router's own test; every object-less spelling is one key): a
   * package-less action on another object customizes no holder's action. It
   * is the environment's own item (`null`) when no holder shares its owner
   * key, that holder's customization when exactly one does, and no package's
   * (`undefined`) when two or more do.
   */
  static overlaySlotBinding(this: Pick<PackageAddressingHost, 'compositeHoldersOf' | 'pairRowBinding'>, type: string, item: unknown, name: string, collection: Map<string, any>, holders?: ReadonlySet<string>): string | null | undefined {
    const stamped = (item as { _packageId?: unknown } | null | undefined)?._packageId;
    const composite = holders ?? new Set(this.compositeHoldersOf(collection, name));
    if (typeof stamped !== 'string' || stamped === '' || stamped === 'sys_metadata') {
      const customized = type === 'action' ? actionHoldersOnOwnerKeyOf(item, name, collection, composite) : [...composite];
      if (customized.length === 0) return null;
      return customized.length === 1 ? customized[0] : undefined;
    }
    if (composite.has(stamped)) return stamped;
    const paired = this.pairRowBinding(type, stamped, item, name, collection, composite);
    if (paired !== NOT_A_PAIR_ROW_OF_A_HOLDER) return paired;
    const base = customizationBasePackageId(stamped);
    if (base !== null && composite.has(base)) return base;
    // [#33127] …or whose base holds it as its own stored row (its package
    // overlay slot): the pair's row customizes that base's item, as beside a
    // composite slot, and is never a holder of its own. One bare slot never
    // held both rows; the package overlay slots keep each.
    if (base !== null && overlaySlotEntriesOf(collection, name, ITEM_KEY_DISCRIMINATORS[type])
      .some(({ key }) => parseOverlaySlotKey(key)?.packageId === base)) return base;
    return stamped;
  }

  /** The body of `SchemaRegistry#overlayRowBinding`; the method's docblock there is its contract. */
  static overlayRowBinding(this: Pick<PackageAddressingHost, 'bareSlotEntriesOf' | 'compositeHoldersOf' | 'isPackageDisabled' | 'metadata' | 'overlaySlotBinding' | 'ownersHoldingAName' | 'settledPairRowBinding'>, type: string, name: string, item: unknown, options?: { includeDisabledPackages?: boolean }): string | null | undefined {
    const collection = this.metadata.get(type);
    if (!collection) return undefined;
    // [#32692] `includeDisabledPackages` counts a disabled holder as served:
    // the read-side hydrator's envelope for a pair row must not move with a
    // reversible disable (ADR-0150 D3).
    const off = (id: string) => !options?.includeDisabledPackages && this.isPackageDisabled(id);
    const composite = new Set(this.compositeHoldersOf(collection, name));
    const servedComposite = new Set([...composite].filter((id) => !off(id)));
    const stamped = (item as { _packageId?: unknown } | null | undefined)?._packageId;
    if (typeof stamped === 'string' && stamped !== '' && stamped !== 'sys_metadata' && !composite.has(stamped)) {
      const holders = new Set(composite);
      for (const { item: entry } of this.bareSlotEntriesOf(type, collection, name)) {
        const bound = this.overlaySlotBinding(type, entry, name, collection, composite);
        if (typeof bound === 'string') holders.add(bound);
      }
      // The pair's own rows bind to it when no composite slot pairs it; it holds no name of its own here.
      const served = new Set([...holders].filter((id) => id !== stamped && !off(id)));
      const settled = this.settledPairRowBinding(stamped, item, served);
      if (Array.isArray(settled)) {
        const named = this.ownersHoldingAName(type, name, collection, settled as readonly string[], item, composite, stamped);
        return named.length === 1 ? named[0] : undefined;
      }
      if (settled !== NOT_A_PAIR_ROW_OF_A_HOLDER) return settled as string | undefined;
    }
    return this.overlaySlotBinding(type, item, name, collection, servedComposite);
  }

  /**
   * [ADR-0150 D4, epic ruling 6761802819 on #31699 F2, #32408] The holder a
   * customization pair's row `item` (stored under `pairId`, which holds no
   * composite slot of the name) binds to, read as the exact read's one owner
   * check reads it (`pairRowOnAddress`, `@objectstack/metadata-protocol`), so
   * every reader of {@link overlaySlotBinding} — the holder set, a holder's
   * bundle members, a package's item and the environment's item — answers
   * the owner the exact address serves it to:
   *
   *  - the row declares the base it customizes (`overrides.package`, ADR-0146
   *    D2) → that holder when the pair customizes it; a declared holder the
   *    pair does not customize, or a declared package that holds no item of
   *    the name, binds it to no package (it is never the declaring row of
   *    another holder);
   *  - else a holder that is the App whose own pair it is → that App (#28390
   *    ruling A: the App's address keeps its pair's row);
   *  - else exactly one holder the pair customizes → that holder;
   *  - else two or more → no package (`undefined`): the row cannot say whose
   *    it is, never a pick between them.
   *
   * The undeclared arms count the holders the exact read counts
   * (`packageScopedHoldersOf`, which the exact read passes): for a bundled
   * type, a package whose holding is a bundle ADDITION to another holder's
   * bundle holds no name (#28802), so it is no second owner. The
   * addition is judged as {@link packageScopedHoldersOf} judges it, over every
   * holder of the name with every row bound to it ({@link ownersHoldingAName}):
   * a row declaring a package as its base makes that package hold the row's
   * member, so it is no addition when another holder ships that member (an
   * undeclared row beside it is then no package's, as the exact read refuses
   * it naming both). A row that declares an addition's package as its base is
   * still that package's. When the count would read an undeclared row of
   * another shared pair (a binding that waits on that pair's own count), the
   * row binds to no package (epic seat 1's ruling). The exact read adopts
   * this binding ({@link overlayRowBinding}, #32561), so it never serves such
   * a row on a package's address.
   *
   * Every holder is counted, a disabled one included (`composite` is the
   * holder set before {@link packageScopedHoldersOf} filters the served
   * ones): a binding never moves with a reversible disable (ADR-0150 D3,
   * #32183). The exact read counts the served holders, so with one of two
   * owners disabled it serves a row this binds to no package: it adopts this
   * binding over the served holders only ({@link overlayRowBinding}, #32561),
   * as the enabled holder's address keeps the row (epic ruling R4-A).
   *
   * {@link NOT_A_PAIR_ROW_OF_A_HOLDER} when no holder of the name is a package
   * `pairId` customizes: the row keeps the per-package reading of
   * {@link overlaySlotBinding}.
   */
  static pairRowBinding(this: Pick<PackageAddressingHost, 'ownersHoldingAName' | 'settledPairRowBinding'>, type: string, pairId: string, item: unknown, name: string, collection: Map<string, any>, composite: ReadonlySet<string>): string | undefined | typeof NOT_A_PAIR_ROW_OF_A_HOLDER {
    const settled = this.settledPairRowBinding(pairId, item, composite);
    if (!Array.isArray(settled)) return settled as string | undefined | typeof NOT_A_PAIR_ROW_OF_A_HOLDER;
    const named = this.ownersHoldingAName(type, name, collection, settled as readonly string[], item, composite, pairId);
    return named.length === 1 ? named[0] : undefined;
  }

  /**
   * [#28802, #32408] `owners` less every one whose holding of the bundled
   * `(type, name)` is an addition to another holder's bundle
   * ({@link isBundleAddition}), judged as {@link packageScopedHoldersOf}
   * judges it: over EVERY holder of the name (a package outside the App
   * included, so an owner that adds to it is an addition), each holder's
   * members being its composite members and the bare-slot rows that bind to
   * it without this count ({@link bundleMembersHeldBy}) — a pair row
   * declaring the holder, an App's own pair row (#28390 ruling A), a
   * per-package pair's row, the holder's own stored row. The undeclared rows
   * of `pairId`, the pair this arm decides, are left out, since the members
   * they add are what it answers (the exact read adopts the answer, #32561). An
   * undeclared row of ANOTHER shared pair would make this count wait on that
   * pair's, which may wait on this one: then `owners` is answered whole, so
   * the row binds to no package (never a guess; epic seat 1's ruling, which
   * the exact read adopts, #32561). An
   * addition that ships the member `row` is ITS member too, so it stays an
   * owner: the row may customize that package's member, and two owners bind
   * it to no package. `owners` unchanged for a type that is no bundle, or with
   * fewer than two.
   */
  static ownersHoldingAName(this: Pick<PackageAddressingHost, 'bareSlotEntriesOf' | 'isBundleAddition' | 'overlaySlotBinding' | 'settledPairRowBinding'>, type: string, name: string, collection: Map<string, any>, owners: readonly string[], row: unknown, composite: ReadonlySet<string>, pairId: string): readonly string[] {
    const disc = ITEM_KEY_DISCRIMINATORS[type];
    if (!disc || owners.length < 2) return owners;
    const bound = new Map<string, unknown[]>();
    for (const { item } of this.bareSlotEntriesOf(type, collection, name)) {
      const stamped = (item as { _packageId?: unknown } | null | undefined)?._packageId;
      const settled = typeof stamped === 'string' && !composite.has(stamped)
        ? this.settledPairRowBinding(stamped, item, composite)
        : NOT_A_PAIR_ROW_OF_A_HOLDER;
      if (Array.isArray(settled)) {
        if (stamped === pairId) continue;
        return owners;
      }
      const holder = settled !== NOT_A_PAIR_ROW_OF_A_HOLDER
        ? settled as string | undefined
        : this.overlaySlotBinding(type, item, name, collection, composite);
      if (typeof holder === 'string') bound.set(holder, [...(bound.get(holder) ?? []), item]);
    }
    const memberOf = (item: unknown) => discriminatorValue(item, disc.field) || disc.canonical;
    const membersOf = new Map<string, Set<string>>();
    const codeMembersOf = new Map<string, Set<string>>();
    for (const id of new Set([...composite, ...bound.keys()])) {
      const { local } = collectBundle(collection, name, disc, id);
      membersOf.set(id, new Set([...local.map((e) => e.item), ...(bound.get(id) ?? [])].map(memberOf)));
      codeMembersOf.set(id, new Set(local.map((e) => memberOf(e.item))));
    }
    const rowMember = memberOf(row);
    return owners.filter((id) => membersOf.get(id)!.has(rowMember) || !this.isBundleAddition(id, membersOf, codeMembersOf));
  }

  /**
   * The packages holding `(type, name)` through a composite
   * `<packageId>:<name>` slot, in the item store's order — the registry's
   * identity key (ADR-0150 D2), read off the KEY, as {@link getItem}'s
   * prefer-local reads it. A bundled type's members are one holder.
   */
  static compositeHoldersOf(collection: Map<string, any>, name: string): string[] {
    const holders = new Set<string>();
    const suffix = `:${name}`;
    for (const key of collection.keys()) {
      const base = bundleBaseKey(key);
      if (base !== name && base.endsWith(suffix)) holders.add(base.slice(0, -suffix.length));
    }
    return [...holders];
  }

  /** The body of `SchemaRegistry#packageScopedHoldersOf`; the method's docblock there is its contract. */
  static packageScopedHoldersOf(this: Pick<PackageAddressingHost, 'bareSlotEntriesOf' | 'bundleMembersHeldBy' | 'compositeHoldersOf' | 'isBundleAddition' | 'isPackageDisabled' | 'metadata' | 'overlaySlotBinding'>, type: string, name: string, callerPackageId?: string | null, options?: { includeDisabledPackages?: boolean }): string[] {
    const collection = this.metadata.get(type);
    if (!collection) return [];
    const composite = this.compositeHoldersOf(collection, name);
    const holders = new Set(composite);
    const compositeSet = new Set(composite);
    for (const { item } of this.bareSlotEntriesOf(type, collection, name)) {
      const bound = this.overlaySlotBinding(type, item, name, collection, compositeSet);
      if (typeof bound === 'string') holders.add(bound);
    }
    const served = (ids: string[]): string[] => options?.includeDisabledPackages === true
      ? ids
      : ids.filter((id) => id === callerPackageId || !this.isPackageDisabled(id));
    const disc = ITEM_KEY_DISCRIMINATORS[type];
    if (!disc || holders.size < 2) return served([...holders]);
    const membersOf = new Map<string, Set<string>>();
    const codeMembersOf = new Map<string, Set<string>>();
    for (const id of holders) {
      membersOf.set(id, this.bundleMembersHeldBy(type, collection, name, id, compositeSet, disc));
      codeMembersOf.set(id, new Set(collectBundle(collection, name, disc, id).local.map((e) => discriminatorValue(e.item, disc.field) || disc.canonical)));
    }
    return served([...holders].filter((id) => id === callerPackageId || !this.isBundleAddition(id, membersOf, codeMembersOf)));
  }

  /**
   * [#28802] The members (discriminator values) of `name`'s bundle that
   * `packageId` holds: its composite group's, and the bare-slot entries that
   * bind to it ({@link overlaySlotBinding}; with `atGate`, as the bare-name
   * gate reads them, {@link gateSlotBinding}).
   */
  static bundleMembersHeldBy(this: Pick<PackageAddressingHost, 'bareSlotEntriesOf' | 'gateSlotBinding' | 'overlaySlotBinding'>, type: string, collection: Map<string, any>, name: string, packageId: string, holders: ReadonlySet<string>, disc: { field: string; canonical: string }, atGate = false): Set<string> {
    const { local } = collectBundle(collection, name, disc, packageId);
    const bound = this.bareSlotEntriesOf(type, collection, name)
      .filter(({ item }) => (atGate
        ? this.gateSlotBinding(type, item, name, collection, holders)
        : this.overlaySlotBinding(type, item, name, collection, holders)) === packageId);
    return new Set([...local, ...bound].map((e) => discriminatorValue(e.item, disc.field) || disc.canonical));
  }

  /**
   * [#32408, epic ruling 6838245909 option B] A bare-slot row's binding as the
   * bare-name gate reads a holder's members ({@link registeredBundleHolding}:
   * both doors and the cold boot's seal): {@link overlaySlotBinding}'s, except
   * that a row of a customization pair lends its member to a holder only
   * where the per-package reading binds it to that holder too (the pair's
   * base when it holds the name in a composite slot, else the pair itself:
   * the reading every reader applied before {@link pairRowBinding}).
   *
   * Where the pair-row binding moved the row (to X, a package of the App,
   * from the App or from the pair), the gate counts it for no holder. The App
   * no longer holds a locale it shipped none of through a row declared for X
   * (the narrowing the changeset declares), and X does not gain the row's
   * locale either: a package of another namespace on X that ships only that
   * locale stays an addition to X's template, refused at both doors in either
   * registration order and reported by the seal, as before the binding
   * moved. Admitting it waits on the by-name read following the binding (a
   * follow-up under #32408): in that state the by-name read answers by
   * registration order. The reads keep {@link overlaySlotBinding}.
   */
  static gateSlotBinding(this: Pick<PackageAddressingHost, 'overlaySlotBinding'>, type: string, item: unknown, name: string, collection: Map<string, any>, holders: ReadonlySet<string>): string | null | undefined {
    const bound = this.overlaySlotBinding(type, item, name, collection, holders);
    const stamped = (item as { _packageId?: unknown } | null | undefined)?._packageId;
    if (typeof stamped !== 'string' || stamped === '' || stamped === 'sys_metadata' || holders.has(stamped)) return bound;
    const base = customizationBasePackageId(stamped);
    const perPackage = base !== null && holders.has(base) ? base : stamped;
    return bound === perPackage ? bound : undefined;
  }

  /** The body of `SchemaRegistry#getPackageScopedItem`; the method's docblock there is its contract. */
  static getPackageScopedItem<T>(this: Pick<PackageAddressingHost, 'bareSlotEntriesOf' | 'compositeHoldersOf' | 'metadata' | 'overlaySlotBinding' | 'rankedForPackage'>, type: string, name: string, packageId: string, member?: string): T | undefined {
    const collection = this.metadata.get(type);
    if (!collection) return undefined;
    const holders = new Set(this.compositeHoldersOf(collection, name));
    // [#33127] Every stored row bound to it, in the order its stored-row read serves them ({@link rankedForPackage}).
    const bound = this.rankedForPackage(this.bareSlotEntriesOf(type, collection, name)
      .filter(({ item }) => this.overlaySlotBinding(type, item, name, collection, holders) === packageId
        && !pairRowDeclaresAnotherHolder(item, packageId, holders)), packageId);
    const disc = ITEM_KEY_DISCRIMINATORS[type];
    if (disc) {
      const { local } = collectBundle(collection, name, disc, packageId);
      return pickBundleMember<T>([...bound, ...local], disc, member);
    }
    if (bound.length > 0) return bound[0].item as T;
    return collection.get(`${packageId}:${name}`) as T | undefined;
  }

  /** The body of `SchemaRegistry#getEnvironmentScopedItem`; the method's docblock there is its contract. */
  static getEnvironmentScopedItem<T>(this: Pick<PackageAddressingHost, 'bareSlotEntriesOf' | 'compositeHoldersOf' | 'metadata' | 'overlaySlotBinding'>, type: string, name: string, member?: string): T | undefined {
    const collection = this.metadata.get(type);
    if (!collection) return undefined;
    const holders = new Set(this.compositeHoldersOf(collection, name));
    const unbound = this.bareSlotEntriesOf(type, collection, name)
      .filter(({ item }) => this.overlaySlotBinding(type, item, name, collection, holders) === null);
    const disc = ITEM_KEY_DISCRIMINATORS[type];
    if (disc) return pickBundleMember<T>(unbound, disc, member);
    return unbound[0]?.item as T | undefined;
  }

  /** The body of `SchemaRegistry#getEnvironmentScopedActions`; the method's docblock there is its contract. */
  static getEnvironmentScopedActions<T>(this: Pick<PackageAddressingHost, 'bareSlotEntriesOf' | 'compositeHoldersOf' | 'metadata' | 'overlaySlotBinding'>, name: string): T[] {
    const collection = this.metadata.get('action');
    if (!collection) return [];
    const holders = new Set(this.compositeHoldersOf(collection, name));
    return this.bareSlotEntriesOf('action', collection, name)
      .filter(({ item }) => this.overlaySlotBinding('action', item, name, collection, holders) === null)
      .map(({ item }) => item as T);
  }

  /** The body of `SchemaRegistry#readsByPackage`; the method's docblock there is its contract. */
  static readsByPackage(type: string): boolean {
    return isPackageScopedReadType(type);
  }

  /**
   * [ADR-0150 D1 bucket 1, ruling 6893582352 option A] The by-name read of a
   * `doc` that names no package. `doc` keeps its literal global name and its
   * addressing (bucket 1); what changes is the context-free read's answer
   * when two or more ENABLED packages hold the name: a `409
   * RESOURCE_CONFLICT` naming every holder (`ambiguous-in-environment`), in
   * place of {@link getItem}'s first composite, which is a registration-order
   * pick (ADR-0146 D8; the bare save, delete, publish and layered read refuse
   * the same address already).
   *
   * Unchanged: one holder; a package-less bare-slot entry (the environment's
   * own item) answers first, as {@link getItem} serves it; a disabled package
   * holds no name ({@link packageScopedHoldersOf}), so beside one enabled
   * holder the read serves that holder's item, never the disabled one's.
   * `MetadataFacade.get` serves this answer; the protocol's by-name read asks
   * it before any layer for its refusal only (`protocol-meta-item-reads.ts`).
   *
   * @throws {PackageScopedNameRefusedError} two or more enabled holders.
   */
  static readBareDoc<T>(this: Pick<PackageAddressingHost, 'getItem' | 'getPackageScopedItem' | 'metadata' | 'packageScopedHoldersOf'>, name: string, member?: string): T | undefined {
    const bare = this.metadata.get('doc')?.get(name) as { _packageId?: unknown } | undefined;
    const stamp = bare?._packageId;
    if (bare !== undefined && (typeof stamp !== 'string' || stamp === '' || stamp === 'sys_metadata')) {
      return this.getItem<T>('doc', name, undefined, member);
    }
    const served = this.packageScopedHoldersOf('doc', name);
    if (served.length >= 2) {
      const base: Omit<PackageScopedRefusal, 'message'> = {
        status: 'refused',
        reason: 'ambiguous-in-environment',
        type: 'doc' as PackageScopedResolvableType,
        name,
        callerPackageId: null,
        candidates: served.map((packageId) => ({ kind: 'package' as const, packageId })),
      };
      throw new PackageScopedNameRefusedError({ ...base, message: packageScopedRefusalMessage(base) });
    }
    if (served.length === 1 && this.packageScopedHoldersOf('doc', name, null, { includeDisabledPackages: true }).length > 1) {
      return this.getPackageScopedItem<T>('doc', name, served[0], member);
    }
    return this.getItem<T>('doc', name, undefined, member);
  }

  /**
   * The bare-slot entries of `(type, name)`: one, or a bundle's members, canonical first.
   * [#33127, ADR-0150 D4] …then its package overlay slots ({@link overlaySlotKey}): every
   * stored row of the name, each bound to its package, read as the bare slot's entry is.
   * [ADR-0150 D4] An action's package-less items of the other owner keys
   * ({@link packagelessActionSlotKey}) follow the bare slot's: each is one
   * more package-less item of the name, judged as the bare slot's is.
   */
  static bareSlotEntriesOf(type: string, collection: Map<string, any>, name: string): BundleEntry[] {
    const disc = ITEM_KEY_DISCRIMINATORS[type];
    const bare = disc
      ? collectBundle(collection, name, disc).bare
      : collection.has(name) ? [{ key: name, item: collection.get(name) }] : [];
    const otherOwnerKeys = type === 'action' ? packagelessActionSlotEntriesOf(collection, name) : [];
    return [...bare, ...otherOwnerKeys, ...overlaySlotEntriesOf(collection, name, disc)];
  }

  /**
   * [#33127, ADR-0150 D4] `entries`, the stored rows that bind to `packageId`
   * ({@link overlaySlotBinding}), in the order the stored-row read serves them
   * for that package (`servedOverlayRowCandidates`, metadata-protocol): the
   * declared override of its customization pair (a row of another package
   * whose `overrides.package` names it), then its own row, then the
   * package-less row, then any other row bound to it (a pair's undeclared
   * row). Ties keep the store's order. So the item the registry answers for a
   * package does not follow the order its rows were registered in.
   */
  static rankedForPackage(entries: readonly BundleEntry[], packageId: string): BundleEntry[] {
    const rank = (entry: BundleEntry): number => {
      const rowPackage = storedRowPackageOf(entry);
      if (rowPackage === packageId) return 1;
      if (rowPackage === undefined) return 2;
      return declaredOverrideBase(entry.item) === packageId ? 0 : 3;
    };
    return entries.map((entry, index) => ({ entry, index, rank: rank(entry) }))
      .sort((a, b) => a.rank - b.rank || a.index - b.index)
      .map(({ entry }) => entry);
  }

  /** The body of `SchemaRegistry#removePackageOverlaySlots`; the method's docblock there is its contract. */
  static removePackageOverlaySlots(this: Pick<PackageAddressingHost, 'invalidateAll' | 'log' | 'metadata' | 'noteItem'>, type: string, name: string, member: string | undefined, select: (packageId: string) => boolean): string[] {
    const collection = this.metadata.get(type);
    if (!collection) return [];
    const disc = ITEM_KEY_DISCRIMINATORS[type];
    const slots = overlaySlotEntriesOf(collection, name, disc);
    const removed = new Set<string>();
    for (const { key } of disc && member !== undefined ? entriesOfMember(slots, disc, member) : slots) {
      const packageId = parseOverlaySlotKey(key)!.packageId;
      if (!select(packageId)) continue;
      this.noteItem(type, key);
      collection.delete(key);
      removed.add(packageId);
      this.log(`[Registry] Removed package overlay slot ${type}: ${name} of ${packageId} (its stored row is gone)`);
    }
    if (removed.size > 0 && (type === 'picklist' || type === 'action')) this.invalidateAll();
    return [...removed];
  }

  /**
   * [#33127] The overlay tier of a read naming no package ({@link getItem}),
   * when the bare slot is empty and package overlay slots hold rows of the
   * name: the rows of `preferred` first ({@link rankedForPackage}), then each
   * other package's, holder by holder in the item store's order (the code
   * holders, as the composite fallback reads them), then by package id. Never
   * the order the rows were registered in.
   */
  static orderedOverlayTier(this: Pick<PackageAddressingHost, 'compositeHoldersOf' | 'overlaySlotBinding' | 'rankedForPackage'>, type: string, collection: Map<string, any>, name: string, entries: readonly BundleEntry[], preferred?: string): BundleEntry[] {
    if (entries.length <= 1) return [...entries];
    const composite = new Set(this.compositeHoldersOf(collection, name));
    const byHolder = new Map<string, BundleEntry[]>();
    for (const entry of entries) {
      const bound = this.overlaySlotBinding(type, entry.item, name, collection, composite);
      const holder = typeof bound === 'string' ? bound : `${OVERLAY_SLOT_MARK}${storedRowPackageOf(entry) ?? ''}`;
      byHolder.set(holder, [...(byHolder.get(holder) ?? []), entry]);
    }
    const order = [...composite];
    const holders = [...byHolder.keys()].sort((a, b) => {
      if (a === preferred || b === preferred) return a === preferred ? -1 : 1;
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      if (ia !== ib) return ia === -1 ? 1 : ib === -1 ? -1 : ia - ib;
      return a < b ? -1 : a > b ? 1 : 0;
    });
    return holders.flatMap((holder) => this.rankedForPackage(byHolder.get(holder)!, holder));
  }

  /** The body of `SchemaRegistry#getArtifactItem`; the method's docblock there is its contract. */
  static getArtifactItem<T>(this: Pick<PackageAddressingHost, 'metadata' | 'resolveObjectKey' | 'resolveOwnerLayer'>, type: string, name: string, currentPackageId?: string, member?: string): T | undefined {
    if (type === 'object' || type === 'objects') {
      // [ADR-0029 D9.6] Artifact identity is read from the OWNER contributor's
      // layer, NEVER from the merged body. The merged body deliberately keeps
      // the overlay's `_provenance: 'org'` (D9.2 — the resolved schema must
      // not move), so applying the artifact test to it answers about whichever
      // layer is on top rather than about the code layer, which is exactly how
      // this predicate came to answer `false` for a name a code package still
      // ships (#6853 P3) and silently disarmed `saveMetaItem`'s overlay gate
      // and tier 3 of the delete heal.
      //
      // What comes BACK is the code-layer body (owner + its extenders), which
      // is what every consumer of this lookup wants — the packaged baseline an
      // overlay customizes, and the `_lock`/`_packageId`/`_provenance`
      // envelope that must win over an overlay (ADR-0010 §3.3). With no
      // overlay registered it is byte-for-byte the previous answer.
      const fqn = this.resolveObjectKey(name);
      const ownerLayer = fqn === undefined ? undefined : this.resolveOwnerLayer(fqn);
      return ownerLayer && isCodeArtifactBody(ownerLayer) ? (ownerLayer as T) : undefined;
    }
    const collection = this.metadata.get(type);
    if (!collection) return undefined;

    // [#7730] Bundle-aware form of the three tiers below, for a type whose
    // identity is (name, discriminator). Same order — prefer-local composite,
    // then any composite, then the bare-key fallback with its package check —
    // over bundle GROUPS instead of single keys, with the canonical member
    // first inside each group.
    const disc = ITEM_KEY_DISCRIMINATORS[type];
    if (disc) {
      const { bare, local, other } = collectBundle(collection, name, disc, currentPackageId);
      const narrow = (entries: BundleEntry[]) => (member === undefined ? entries : entriesOfMember(entries, disc, member));
      for (const { item } of narrow([...local, ...other])) {
        if (isCodeArtifactBody(item)) return item as T;
      }
      for (const { item } of narrow(bare)) {
        if (isCodeArtifactBody(item) && (!currentPackageId || item._packageId === currentPackageId)) return item as T;
      }
      return undefined;
    }

    // ADR-0048 prefer-local: when the caller resolves within a package, the
    // artifact owned by that package wins over a first-match composite scan,
    // so two installed packages shipping the same name don't resolve by Map
    // iteration order.
    if (currentPackageId) {
      const local = collection.get(`${currentPackageId}:${name}`) as any;
      if (local && local._packageId && local._packageId !== 'sys_metadata' && !isTenantAuthored(local)) return local as T;
    }
    for (const [key, item] of collection) {
      if (key !== name && key.endsWith(`:${name}`)) {
        const it = item as any;
        if (it && it._packageId && it._packageId !== 'sys_metadata' && !isTenantAuthored(it)) return item as T;
      }
    }
    // Bare-key fallback: a runtime/DB overlay rehydrated under the plain name.
    // ADR-0048 (#1828) — when the caller resolves *within a package*, only accept
    // this entry if it belongs to that package. The bare slot holds a single
    // row (last hydrate wins), so once the unscoped list stopped collapsing
    // colliding rows, an overlay from package A hydrated here would otherwise be
    // grafted as the "artifact" of package B's same-name row — mislabeling its
    // `_packageId`/lock. A package-less caller (`currentPackageId` omitted) keeps
    // the legacy best-effort first-match.
    const direct = collection.get(name) as any;
    if (
      direct && direct._packageId && direct._packageId !== 'sys_metadata' && !isTenantAuthored(direct) &&
      (!currentPackageId || direct._packageId === currentPackageId)
    ) {
      return direct as T;
    }
    return undefined;
  }

  /** The body of `SchemaRegistry#removeRuntimeShadow`; the method's docblock there is its contract. */
  static removeRuntimeShadow(this: Pick<PackageAddressingHost, 'invalidateAll' | 'log' | 'metadata' | 'packagelessActionEntryToRetire' | 'retirePackagelessActionSlot'>, type: string, name: string, member?: string): boolean {
    const collection = this.metadata.get(type);
    if (!collection) return false;

    // [#7730] For a discriminated type the shadow sits at `name@<discriminator>`
    // — nothing is ever stored under the plain name — so the plain-key test
    // would silently answer "no shadow" for every email template.
    //
    // [#22877] The overlay store now keys a row by its member
    // (`sys_metadata.bundle_member`), so a by-name reset removes ONE member's
    // row and the heal that follows it names that member: resetting `zh-CN`
    // must leave the `en-US` overlay registered, because its row is still
    // stored and still served. Sweeping the group, as this did while the
    // store kept one row per name, dropped every other member's overlay until
    // the next boot. A caller naming no member keeps the group sweep, the
    // shape `unregisterItem` takes for a withdrawal by name.
    const disc = ITEM_KEY_DISCRIMINATORS[type];
    if (disc) {
      const { bare, local, other } = collectBundle(collection, name, disc);
      const shadows = member === undefined ? bare : entriesOfMember(bare, disc, member);
      if (shadows.length === 0) return false;
      // [#23074] A named member's OWN artifact, the test this tier has always
      // made for a name: a shadow is lifted only where a packaged artifact
      // takes its place. An overlay of a member the package does NOT ship has
      // none, so this tier declines, and the heal's last tier retires the
      // entry (`removeOverlayEntry`): the protocol grafts the artifact
      // envelope onto the shipped member alone, so that overlay is registered
      // as the tenant row it is and the retirement takes it. (#22877 stage 2
      // lifted it here on ANY member's artifact, because the bundle's envelope
      // grafted onto it made the retirement refuse it as code.) The group
      // sweep, naming no member, keeps the bundle's artifact, any member's.
      const artifacts = member === undefined ? [...local, ...other] : entriesOfMember([...local, ...other], disc, member);
      const artifact = artifacts.find(({ item }) => item?._packageId && item._packageId !== 'sys_metadata');
      if (!artifact) return false;
      for (const { key } of shadows) {
        collection.delete(key);
        this.log(`[Registry] Removed runtime shadow ${type}: ${key} (artifact ${artifact.item._packageId} restored)`);
      }
      return true;
    }

    if (!collection.has(name)) return false;
    for (const [key, item] of collection) {
      if (key !== name && key.endsWith(`:${name}`)) {
        const it = item as any;
        if (it && it._packageId && it._packageId !== 'sys_metadata') {
          // [ADR-0150 D4] …the package-less action's own entry, which may sit
          // in another owner key's slot ({@link packagelessActionEntryToRetire}).
          if (type === 'action') this.retirePackagelessActionSlot(collection, name, this.packagelessActionEntryToRetire(collection, name));
          else collection.delete(name);
          // [#28356] An object may carry the shadow as a bound action; the
          // artifact it uncovers may bind elsewhere ({@link attachBoundActions}).
          if (type === 'action') this.invalidateAll();
          this.log(`[Registry] Removed runtime shadow ${type}: ${name} (artifact ${it._packageId} restored)`);
          return true;
        }
      }
    }
    return false;
  }

  /** The body of `SchemaRegistry#removeOverlayEntry`; the method's docblock there is its contract. */
  static removeOverlayEntry(this: Pick<PackageAddressingHost, 'invalidateAll' | 'log' | 'metadata' | 'packagelessActionEntryToRetire' | 'retirePackagelessActionSlot'>, type: string, name: string, member?: string): boolean {
    const collection = this.metadata.get(type);
    if (!collection) return false;

    // [#7730] Same relocation as {@link removeRuntimeShadow}: a discriminated
    // type's overlay slot is `name@<discriminator>`, so the plain-key read
    // finds nothing and the deleted overlay would keep being served for the
    // life of the process — the very residue #5079 removed. The refusal is
    // still per entry: a bundle member that IS a packaged artifact stays.
    // [#22877] …and a named member retires that member's entry only.
    const disc = ITEM_KEY_DISCRIMINATORS[type];
    if (disc) {
      const { bare } = collectBundle(collection, name, disc);
      let removed = false;
      for (const { key, item } of member === undefined ? bare : entriesOfMember(bare, disc, member)) {
        if (isCodeArtifactBody(item)) continue;
        collection.delete(key);
        this.log(`[Registry] Removed overlay entry ${type}: ${key} (no layer serves it any more)`);
        removed = true;
      }
      return removed;
    }

    if (!collection.has(name)) return false;
    // [ADR-0150 D4] A package-less action's own entry may sit in another
    // owner key's slot beside the bare one ({@link packagelessActionEntryToRetire}).
    const key = type === 'action' ? this.packagelessActionEntryToRetire(collection, name) : name;
    const plain = collection.get(key) as any;
    if (plain && plain._packageId && plain._packageId !== 'sys_metadata' && !isTenantAuthored(plain)) {
      return false;
    }
    if (type === 'action') this.retirePackagelessActionSlot(collection, name, key);
    else collection.delete(name);
    // [#28356] …and an object may carry the retired entry as a bound action
    // ({@link attachBoundActions}): drop the cached folds, as
    // {@link unregisterItem} does, or a deleted runtime action stays listed.
    if (type === 'action') this.invalidateAll();
    this.log(`[Registry] Removed overlay entry ${type}: ${name} (no layer serves it any more)`);
    return true;
  }

  /** The body of `SchemaRegistry#listItems`; the method's docblock there is its contract. */
  static listItems<T>(this: Pick<PackageAddressingHost, 'getAllObjects' | 'isPackageDisabled' | 'metadata'>, type: string, packageId?: string, options?: { includeDisabledPackages?: boolean } & ObjectExtensionFoldOptions): T[] {
    // Special handling for 'object' and 'objects' types - use objectContributors
    if (type === 'object' || type === 'objects') {
      return this.getAllObjects(packageId, {
        withoutExtensionsOf: options?.withoutExtensionsOf,
        onlyExtensionsOf: options?.onlyExtensionsOf,
      }) as unknown as T[];
    }

    const items = Array.from(this.metadata.get(type)?.values() || []) as T[];
    let result = items;
    if (packageId) {
      result = result.filter((item: any) => item._packageId === packageId);
    }
    // Hide metadata owned by a disabled package so the console (app switcher,
    // view lists, dashboards, …) stops surfacing it after a disable. The
    // `package` type itself is never filtered — the Packages page must still
    // list disabled packages so they can be re-enabled. Disable is reversible:
    // items remain registered and reappear on enable.
    if (type !== 'package' && options?.includeDisabledPackages !== true) {
      result = result.filter((item: any) => !this.isPackageDisabled((item as any)?._packageId));
    }
    return result;
  }

  /** The body of `SchemaRegistry#isPackageDisabled`; the method's docblock there is its contract. */
  static isPackageDisabled(this: Pick<PackageAddressingHost, 'getPackage'>, packageId?: string): boolean {
    if (!packageId) return false;
    const pkg = this.getPackage(packageId);
    return pkg?.enabled === false || pkg?.status === 'disabled';
  }

  /** The body of `SchemaRegistry#isObjectPackageDisabled`; the method's docblock there is its contract. */
  static isObjectPackageDisabled(this: Pick<PackageAddressingHost, 'getObjectOwner' | 'isPackageDisabled' | 'resolveObjectKey'>, name: string): boolean {
    const fqn = this.resolveObjectKey(name);
    if (fqn === undefined) return false;
    return this.isPackageDisabled(this.getObjectOwner(fqn)?.packageId);
  }

  /** The body of `SchemaRegistry#isFlowOfDisabledPackage`; the method's docblock there is its contract. */
  static isFlowOfDisabledPackage(this: Pick<PackageAddressingHost, 'isPackageDisabled' | 'metadata'>, name: string): boolean {
    const collection = this.metadata.get('flow');
    if (!collection || typeof name !== 'string' || name === '') return false;
    let found = false;
    for (const [key, flow] of collection) {
      if (key !== name && !key.endsWith(`:${name}`)) continue;
      if (!this.isPackageDisabled((flow as { _packageId?: string } | undefined)?._packageId)) return false;
      found = true;
    }
    return found;
  }

  /** The body of `SchemaRegistry#isActionWithheldByDisabledPackage`; the method's docblock there is its contract. */
  static isActionWithheldByDisabledPackage(this: Pick<PackageAddressingHost, 'hasDisabledPackage' | 'isFlowOfDisabledPackage' | 'isObjectPackageDisabled' | 'isPackageDisabled'>, action: unknown): boolean {
    if (!action || typeof action !== 'object') return false;
    const a = action as { _packageId?: string; objectName?: unknown; type?: unknown; target?: unknown; params?: unknown };
    if (this.isPackageDisabled(a._packageId)) return true;
    if (!this.hasDisabledPackage()) return false;
    if (typeof a.objectName === 'string' && a.objectName !== '' && this.isObjectPackageDisabled(a.objectName)) return true;
    if (a.type === 'flow' && typeof a.target === 'string' && this.isFlowOfDisabledPackage(a.target)) return true;
    if (Array.isArray(a.params)) {
      for (const param of a.params) {
        const override = (param as { objectOverride?: unknown } | null | undefined)?.objectOverride;
        if (typeof override === 'string' && override !== '' && this.isObjectPackageDisabled(override)) return true;
      }
    }
    return false;
  }

  /** [#28877] Whether any installed package is disabled — the cheap gate before the launch walk. */
  static hasDisabledPackage(this: Pick<PackageAddressingHost, 'metadata'>): boolean {
    for (const pkg of this.metadata.get('package')?.values() ?? []) {
      const p = pkg as { enabled?: boolean; status?: string } | undefined;
      if (p?.enabled === false || p?.status === 'disabled') return true;
    }
    return false;
  }

  /** The body of `SchemaRegistry#getRegisteredTypes`; the method's docblock there is its contract. */
  static getRegisteredTypes(this: Pick<PackageAddressingHost, 'metadata' | 'objectContributors'>): string[] {
    const types = Array.from(this.metadata.keys());
    // Always include 'object' even if stored separately
    if (!types.includes('object') && this.objectContributors.size > 0) {
      types.push('object');
    }
    return types;
  }
}
