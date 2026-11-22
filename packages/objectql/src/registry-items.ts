// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#33949 codemod] The "Generic metadata items and package bodies" section of
 * `SchemaRegistry`: the bodies of `keepPackagelessActionOwnerKeys`,
 * `packagelessActionEntryToRetire`, `retirePackagelessActionSlot`, `validate`,
 * `unregisterItemsByPackage`, `replacingPackageBody`,
 * `withdrawPackageBodyItemsNotShipped`, `withdrawPackageClaimsNotDeclared`,
 * `getItem` moved out of `registry.ts` whole by
 * the #33949 split codemod (PR #34285, kept in its branch history, not committed).
 *
 * A MOVE, not a redesign. {@link ItemsFacet} is a stateless facet of `SchemaRegistry`
 * (ruling 6624345766): each static method of it is the body of the `SchemaRegistry`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class as a one-call stub with
 * its signature, so the published surface, an instance spy and a subclass
 * override are what they were. A public or protected method keeps its
 * docblock on the class, the contract; a private method's docblock moved here
 * with its body. The state stays on `SchemaRegistry`.
 *
 * The bodies reach the class through {@link ItemsHost}: exactly the
 * `SchemaRegistry` members they read, private ones included. Every stub hands
 * its body, by a `.call`, the same host: `itemsHost` in
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

import { ObjectSchema } from '@objectstack/spec/data';
import { ITEM_KEY_DISCRIMINATORS } from '@objectstack/metadata-core';
import { InstalledPackageSchema, ManifestSchema } from '@objectstack/spec/kernel';
import type { ObjectStackManifest } from '@objectstack/spec/kernel';
import { AppSchema } from '@objectstack/spec/ui';
import { declaredSecurityCatalogNames } from './security-catalog-namespace.js';
import { declaredBareNames, isBareNameRegistryType } from './bare-name-one-holder.js';
import {
  collectBundle, entriesOfMember, isStoredActionRow, overlaySlotEntriesOf, packageBodySlot, packagelessActionOwnerKey,
  packagelessActionSlotEntriesOf, packagelessActionSlotKey,
} from './registry-top-level.js';
import type { ObjectContributor } from './registry-top-level.js';
import type { SchemaRegistry } from './registry.js';

/**
 * The `SchemaRegistry` members the bodies of {@link ItemsFacet} read — every one of
 * them, and no other. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too. `readonly` members are the getters; the others are fields a body
 * assigns.
 */
export interface ItemsHost {
  readonly bareNameClaims: SchemaRegistry['bareNameClaims'];
  getObject: SchemaRegistry['getObject'];
  invalidateAll: SchemaRegistry['invalidateAll'];
  log: SchemaRegistry['log'];
  readonly metadata: SchemaRegistry['metadata'];
  readonly objectContributors: SchemaRegistry['objectContributors'];
  noteBareNameClaim: SchemaRegistry['noteBareNameClaim'];
  noteItem: SchemaRegistry['noteItem'];
  noteItemOrder: SchemaRegistry['noteItemOrder'];
  noteSecurityCatalogClaim: SchemaRegistry['noteSecurityCatalogClaim'];
  openPackageBody: SchemaRegistry['openPackageBody'];
  orderedOverlayTier: SchemaRegistry['orderedOverlayTier'];
  readonly packageBodyExtensions: SchemaRegistry['packageBodyExtensions'];
  readonly packageBodyItems: SchemaRegistry['packageBodyItems'];
  readonly restorePoint: SchemaRegistry['restorePoint'];
  readonly securityCatalogClaims: SchemaRegistry['securityCatalogClaims'];
  unregisterPicklistExtensionsByPackage: SchemaRegistry['unregisterPicklistExtensionsByPackage'];
  withdrawObjectExtension: SchemaRegistry['withdrawObjectExtension'];
  withdrawPackageBodyItemsNotShipped: SchemaRegistry['withdrawPackageBodyItemsNotShipped'];
  withdrawPackageClaimsNotDeclared: SchemaRegistry['withdrawPackageClaimsNotDeclared'];
}

/**
 * [#35609] Each object `packageId` holds an `extend` layer of, by key: the
 * layer itself, so a caller can tell a layer it saw from one written since.
 */
function packageExtensionLayers(
  objectContributors: ReadonlyMap<string, readonly ObjectContributor[]>,
  packageId: string,
): Map<string, ObjectContributor> {
  const layers = new Map<string, ObjectContributor>();
  for (const [fqn, contributors] of objectContributors) {
    const layer = contributors.find((c) => c.ownership === 'extend' && c.packageId === packageId);
    if (layer) layers.set(fqn, layer);
  }
  return layers;
}

/** The bodies of the "Generic metadata items and package bodies" section of `SchemaRegistry`: a stateless facet, called by the class's stubs. */
export class ItemsFacet {
  /**
   * [ADR-0150 D4] Before a package-less action `incoming` takes the bare slot
   * of `name`, the name's package-less actions it does not replace keep their
   * own owner keys: the bare slot's present item, when its owner key is
   * another, moves to that key's own slot ({@link packagelessActionSlotKey}).
   * So the platform's action bound to `lead` and the environment's object-less
   * action of the name are both kept, in either registration order, and each
   * is read on its own key.
   *
   * What `incoming` replaces: the item of its own owner key (one key, one
   * item; the later registration stays, as in the bare slot), and, when it is
   * a stored row ({@link isStoredActionRow}), the name's stored row on any key
   * — the environment's store holds one row of a name, so a row saved again
   * bound to another object is that row, never a second item.
   */
  static keepPackagelessActionOwnerKeys(this: Pick<ItemsHost, 'log' | 'noteItem'>, collection: Map<string, any>, name: string, incoming: unknown): void {
    const ownerKey = packagelessActionOwnerKey(incoming);
    const replaces = (item: unknown): boolean =>
      packagelessActionOwnerKey(item) === ownerKey || (isStoredActionRow(incoming) && isStoredActionRow(item));
    for (const { key, item } of packagelessActionSlotEntriesOf(collection, name)) {
      if (!replaces(item)) continue;
      this.noteItem('action', key);
      collection.delete(key);
    }
    const occupant = collection.get(name);
    if (occupant === undefined || replaces(occupant)) return;
    const aside = packagelessActionSlotKey(packagelessActionOwnerKey(occupant), name);
    this.noteItem('action', aside);
    collection.set(aside, occupant);
    this.log(`[Registry] Kept package-less action ${name} on ${packagelessActionOwnerKey(occupant)} beside the one on ${ownerKey}`);
  }

  /**
   * [ADR-0150 D4] The slot a removal of the package-less action `name`'s own
   * entry retires ({@link removeRuntimeShadow}, {@link removeOverlayEntry}):
   * the bare slot, unless another owner key's slot holds the name's one stored
   * row ({@link isStoredActionRow}, the row the removal heals) while the bare
   * slot holds code's.
   */
  static packagelessActionEntryToRetire(collection: Map<string, any>, name: string): string {
    const aside = packagelessActionSlotEntriesOf(collection, name);
    if (aside.length === 0 || isStoredActionRow(collection.get(name))) return name;
    const rows = aside.filter(({ item }) => isStoredActionRow(item));
    return rows.length === 1 ? rows[0].key : name;
  }

  /**
   * [ADR-0150 D4] Retire one package-less action slot of `name`. When it is
   * the bare slot, the first other owner key's item takes it, so the bare
   * slot holds a package-less action of the name whenever one is kept.
   */
  static retirePackagelessActionSlot(this: Pick<ItemsHost, 'noteItem'>, collection: Map<string, any>, name: string, key: string): void {
    collection.delete(key);
    if (key !== name) return;
    const [next] = packagelessActionSlotEntriesOf(collection, name);
    if (next === undefined) return;
    this.noteItem('action', next.key);
    collection.delete(next.key);
    this.noteItem('action', name);
    collection.set(name, next.item);
  }

  /** The body of `SchemaRegistry#validate`; the method's docblock there is its contract. */
  static validate(type: string, item: any): unknown {
    if (type === 'object') {
      return ObjectSchema.parse(item);
    }
    if (type === 'app') {
      return AppSchema.parse(item);
    }
    if (type === 'package') {
      return InstalledPackageSchema.parse(item);
    }
    if (type === 'plugin') {
      return ManifestSchema.parse(item);
    }
    return true;
  }

  /** The body of `SchemaRegistry#unregisterItemsByPackage`; the method's docblock there is its contract. */
  static unregisterItemsByPackage(this: Pick<ItemsHost, 'invalidateAll' | 'log' | 'metadata' | 'unregisterPicklistExtensionsByPackage'>, packageId: string): { removed: string[]; orphanedOverlays: string[] } {
    const prefix = `${packageId}:`;
    const removed: string[] = [];
    const orphanedOverlays: string[] = [];

    for (const [type, collection] of this.metadata.entries()) {
      // Collect before deleting — mutating a Map while iterating its own keys
      // is legal but reads as a trap, and the bare-slot probe below wants the
      // collection in its post-removal state to be truthful.
      const owned = [...collection.keys()].filter(key => key.startsWith(prefix));
      for (const key of owned) {
        collection.delete(key);
        removed.push(`${type}/${key}`);
        this.log(`[Registry] Unregistered ${type}: ${key} (package ${packageId} uninstalled)`);
      }
      for (const key of owned) {
        // The bare (overlay) slot for this item is its key without the package
        // prefix — the same `bareKey` the artifact-vs-DB collision warning in
        // `registerItem` compares against, discriminator included.
        const bareSlot = key.slice(prefix.length);
        const label = `${type}/${bareSlot}`;
        if (collection.has(bareSlot) && !orphanedOverlays.includes(label)) {
          orphanedOverlays.push(label);
        }
      }
    }

    if (orphanedOverlays.length > 0) {
      console.warn(
        `[Registry] Package "${packageId}" was uninstalled, but ${orphanedOverlays.length} ` +
        `runtime/DB overlay row(s) layered over its items were KEPT — they are tenant-authored ` +
        `(ADR-0005) and an uninstall does not delete them: ${orphanedOverlays.join(', ')}. ` +
        `Each now overlays nothing — re-install the package that owns it, or delete the ` +
        `sys_metadata row.`,
      );
    }
    if (removed.length > 0) {
      this.log(`[Registry] Unregistered ${removed.length} item(s) from package: ${packageId}`);
    }
    // The package's `picklistExtensions` leave with it, and every resolved
    // object is re-derived without its lists and its added values.
    const droppedExtensions = this.unregisterPicklistExtensionsByPackage(packageId);
    // [#24400] …and so is every object its bound actions were attached to.
    // [#28877] …and every object whose actions a flow of this package withheld.
    if (droppedExtensions || removed.some((r) => r.startsWith('picklist/') || r.startsWith('action/') || r.startsWith('flow/'))) this.invalidateAll();
    return { removed, orphanedOverlays };
  }

  /** The body of `SchemaRegistry#replacingPackageBody`; the method's docblock there is its contract. */
  static replacingPackageBody<T>(this: Pick<ItemsHost, 'log' | 'objectContributors' | 'openPackageBody' | 'packageBodyExtensions' | 'packageBodyItems' | 'restorePoint' | 'withdrawObjectExtension' | 'withdrawPackageBodyItemsNotShipped' | 'withdrawPackageClaimsNotDeclared'>, packageId: string | undefined, manifest: ObjectStackManifest, register: () => T): T {
    if (!packageId) return register();
    const open = this.openPackageBody;
    const body = { packageId, written: new Set<string>() };
    // [#35609] The package's extension layers before the body registers. The
    // extend splice replaces a package's layer of a target with a NEW
    // contributor, so a layer still the same object afterwards is one this
    // body did not write.
    const extensionsBefore = packageExtensionLayers(this.objectContributors, packageId);
    this.openPackageBody = body;
    let result: T;
    try {
      result = register();
    } finally {
      this.openPackageBody = open;
    }
    const extended = new Map<string, ObjectContributor>();
    for (const [fqn, layer] of packageExtensionLayers(this.objectContributors, packageId)) {
      if (extensionsBefore.get(fqn) !== layer) extended.set(fqn, layer);
    }
    const previous = this.packageBodyItems.get(packageId);
    if (previous !== undefined) {
      this.withdrawPackageBodyItemsNotShipped(packageId, previous, body.written);
      this.withdrawPackageClaimsNotDeclared(packageId, manifest);
    }
    // [#35609] …and the extension layers the previous body wrote of a target
    // this one does not extend, through the per-target withdrawal the
    // `object_extension` item delete uses. Only the layer that body wrote:
    // one another door has since put in the package's slot is not the body's.
    const previousExtensions = this.packageBodyExtensions.get(packageId);
    if (previousExtensions !== undefined) {
      const withdrawn: string[] = [];
      for (const [fqn, layer] of previousExtensions) {
        if (extended.has(fqn) || !this.objectContributors.get(fqn)?.includes(layer)) continue;
        if (this.withdrawObjectExtension(fqn, packageId)) withdrawn.push(fqn);
      }
      if (withdrawn.length > 0) {
        this.log(
          `[Registry] Withdrew ${withdrawn.length} object extension(s) package ${packageId}'s new body no longer declares: ${withdrawn.join(', ')}`,
        );
      }
    }
    this.restorePoint?.note(`packageBodyExtensions\u0000${packageId}`, () => {
      const had = this.packageBodyExtensions.has(packageId);
      const saved = this.packageBodyExtensions.get(packageId);
      return () => {
        if (had && saved !== undefined) this.packageBodyExtensions.set(packageId, saved);
        else this.packageBodyExtensions.delete(packageId);
      };
    });
    this.packageBodyExtensions.set(packageId, extended);
    this.restorePoint?.note(`packageBody\u0000${packageId}`, () => {
      const had = this.packageBodyItems.has(packageId);
      const saved = this.packageBodyItems.get(packageId);
      return () => {
        if (had && saved !== undefined) this.packageBodyItems.set(packageId, saved);
        else this.packageBodyItems.delete(packageId);
      };
    });
    this.packageBodyItems.set(packageId, body.written);
    // A body of the same package registered inside another one's run (none
    // does today) ships its slots as part of that one.
    if (open?.packageId === packageId) for (const slot of body.written) open.written.add(slot);
    return result;
  }

  /** The slots `previous` names that `written` does not, withdrawn (see {@link replacingPackageBody}). */
  static withdrawPackageBodyItemsNotShipped(this: Pick<ItemsHost, 'invalidateAll' | 'log' | 'metadata' | 'noteItem' | 'noteItemOrder'>, packageId: string, previous: ReadonlySet<string>, written: ReadonlySet<string>): void {
    const removed: string[] = [];
    for (const slot of previous) {
      if (written.has(slot)) continue;
      const separator = slot.indexOf('\u0000');
      const type = slot.slice(0, separator);
      const key = slot.slice(separator + 1);
      const collection = this.metadata.get(type);
      if (!collection?.has(key)) continue;
      this.noteItemOrder(type);
      this.noteItem(type, key);
      collection.delete(key);
      removed.push(`${type}/${key}`);
    }
    if (removed.length === 0) return;
    this.log(
      `[Registry] Withdrew ${removed.length} item(s) package ${packageId}'s new body no longer ships: ${removed.join(', ')}`,
    );
    // The read caches {@link unregisterItemsByPackage} drops for the same types.
    if (removed.some((r) => r.startsWith('picklist/') || r.startsWith('action/') || r.startsWith('flow/'))) this.invalidateAll();
  }

  /**
   * The bare-name and security catalog claims `packageId` holds that
   * `manifest` no longer declares, released (see {@link replacingPackageBody}).
   * ⛔ Never a `function` claim: those are the hook binder's
   * ({@link claimBareNameFunctions}), recorded and released by its own bind.
   */
  static withdrawPackageClaimsNotDeclared(this: Pick<ItemsHost, 'bareNameClaims' | 'noteBareNameClaim' | 'noteSecurityCatalogClaim' | 'securityCatalogClaims'>, packageId: string, manifest: ObjectStackManifest): void {
    const bare = new Set(declaredBareNames(manifest).map(({ type, name }) => packageBodySlot(type, name)));
    for (const [type, byName] of this.bareNameClaims) {
      if (!isBareNameRegistryType(type)) continue;
      for (const [name, claimants] of byName) {
        if (!claimants.has(packageId) || bare.has(packageBodySlot(type, name))) continue;
        this.noteBareNameClaim(type, name);
        claimants.delete(packageId);
        if (claimants.size === 0) byName.delete(name);
      }
    }
    const catalog = new Set(declaredSecurityCatalogNames(manifest).map(({ type, name }) => packageBodySlot(type, name)));
    for (const [type, byName] of this.securityCatalogClaims) {
      for (const [name, claimants] of byName) {
        if (!claimants.has(packageId) || catalog.has(packageBodySlot(type, name))) continue;
        this.noteSecurityCatalogClaim(type, name);
        claimants.delete(packageId);
        if (claimants.size === 0) byName.delete(name);
      }
    }
  }

  /** The body of `SchemaRegistry#getItem`; the method's docblock there is its contract. */
  static getItem<T>(this: Pick<ItemsHost, 'getObject' | 'metadata' | 'orderedOverlayTier'>, type: string, name: string, currentPackageId?: string, member?: string): T | undefined {
    // Special handling for 'object' and 'objects' types - use objectContributors
    if (type === 'object' || type === 'objects') {
      return this.getObject(name) as unknown as T | undefined;
    }

    const collection = this.metadata.get(type);
    if (!collection) return undefined;

    // [#7730] A discriminated type's name addresses a BUNDLE, so every tier
    // below is a group rather than a single key. The tiers themselves are
    // unchanged (overlay → prefer-local → first composite).
    //
    // [#22877] A bare-name read answers the CANONICAL member — the one the
    // `/meta` by-name doors address when no member is named — wherever it
    // sits in that tier order. It used to take the first tier that held ANY
    // member and pick canonical-first only inside it, so an overlay of a
    // second locale alone (a template customized in `zh-CN` only) answered a
    // read that named no member. Only a bundle with no canonical member at
    // all still answers its first member, as it always did. A named `member`
    // answers that member, in the same tier order, or nothing.
    const disc = ITEM_KEY_DISCRIMINATORS[type];
    // [#33127] The package overlay slots join the overlay tier, after the bare slot.
    if (disc) {
      const { bare, local, other } = collectBundle(collection, name, disc, currentPackageId);
      const overlays = this.orderedOverlayTier(type, collection, name, overlaySlotEntriesOf(collection, name, disc), currentPackageId);
      const tiers = [...bare, ...overlays, ...local, ...other];
      if (member !== undefined) return (entriesOfMember(tiers, disc, member)[0]?.item as T) ?? undefined;
      return ((entriesOfMember(tiers, disc, disc.canonical)[0] ?? tiers[0])?.item as T) ?? undefined;
    }

    // A bare-key entry (a runtime/DB overlay rehydrated by restoreMetadataFromDb)
    // intentionally shadows the packaged composite item — ADR-0005 overlay
    // precedence (a customization wins over its package default). This is
    // checked before prefer-local so that precedence holds; note an env-wide
    // (package-less) overlay of a name that collides across packages is
    // inherently ambiguous by schema (sys_metadata is unique on type+name+org,
    // not package) and resolves to the single overlay row.
    const direct = collection.get(name);
    if (direct) return direct as T;
    // [#33127, ADR-0150 D4] …and with no package-less row, a stored row bound
    // to a package (its package overlay slot): the caller's package's first,
    // else in the holders' order ({@link orderedOverlayTier}), never in the
    // order the rows were registered. One stored row reads as it did in the
    // bare slot.
    const overlays = overlaySlotEntriesOf(collection, name);
    if (overlays.length > 0) return this.orderedOverlayTier(type, collection, name, overlays, currentPackageId)[0].item as T;

    // Prefer-local: resolve within the caller's package first.
    if (currentPackageId) {
      const local = collection.get(`${currentPackageId}:${name}`);
      if (local) return local as T;
    }

    // Fallback: first composite key matching the bare name (legacy behaviour).
    for (const [key, item] of collection) {
      if (key.endsWith(`:${name}`)) {
        return item as T;
      }
    }
    return undefined;
  }
}
