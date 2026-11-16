// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#33949 codemod] The "Restore on refusal" section of `SchemaRegistry`: the
 * bodies of `restoringOnRefusal`, `recordCurrencyFollowRefusalOfRun`,
 * `followRefusalAsServed`, `recordRestoreOnRefusal`, `noteAppNavContributions`,
 * `noteObjectEntry`, `noteNamespace`, `noteItemType`, `noteItem`,
 * `noteItemOrder`, `notePicklistExtension`, `noteSecurityCatalogClaim`,
 * `noteBareNameClaim`, `noteDefaultRecordPageClaims` moved out of `registry.ts`
 * whole by
 * the #33949 split codemod (PR #34285, kept in its branch history, not committed).
 *
 * A MOVE, not a redesign. {@link RestoreFacet} is a stateless facet of `SchemaRegistry`
 * (ruling 6624345766): each static method of it is the body of the `SchemaRegistry`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class as a one-call stub with
 * its signature, so the published surface, an instance spy and a subclass
 * override are what they were. A public or protected method keeps its
 * docblock on the class, the contract; a private method's docblock moved here
 * with its body. The state stays on `SchemaRegistry`.
 *
 * The bodies reach the class through {@link RestoreHost}: exactly the
 * `SchemaRegistry` members they read, private ones included. Every stub hands
 * its body, by a `.call`, the same host: `restoreHost` in
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

import type { ObjectOwnership, ServiceObject } from '@objectstack/spec/data';
import { isTenantAuthored } from '@objectstack/metadata-core';
import type { SecurityCatalogType } from '@objectstack/core';
import type { BareNameOneHolderType } from './bare-name-one-holder.js';
import { recordCurrencyFollowRefusalOverEnvironmentObjects } from './record-currency-aggregate-door.js';
import type { RecordCurrencyFollowRefusedError } from './record-currency-aggregate-door.js';
import type { FollowDoorLayer } from './registry-top-level.js';
import { RegistrationRestorePoint } from './registry.js';
import type { SchemaRegistry } from './registry.js';

/**
 * The `SchemaRegistry` members the bodies of {@link RestoreFacet} read — every one of
 * them, and no other. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too. `readonly` members are the getters; the others are fields a body
 * assigns.
 */
export interface RestoreHost {
  readonly appNavContributions: SchemaRegistry['appNavContributions'];
  readonly bareNameClaims: SchemaRegistry['bareNameClaims'];
  readonly bareNameHoldersAreSealed: SchemaRegistry['bareNameHoldersAreSealed'];
  closeObjectEntry: SchemaRegistry['closeObjectEntry'];
  readonly defaultRecordPageClaims: SchemaRegistry['defaultRecordPageClaims'];
  followRefusalAsServed: SchemaRegistry['followRefusalAsServed'];
  getAllObjects: SchemaRegistry['getAllObjects'];
  getObject: SchemaRegistry['getObject'];
  invalidateAll: SchemaRegistry['invalidateAll'];
  readonly mergedObjectCache: SchemaRegistry['mergedObjectCache'];
  readonly metadata: SchemaRegistry['metadata'];
  readonly namespaceRegistry: SchemaRegistry['namespaceRegistry'];
  readonly objectContributors: SchemaRegistry['objectContributors'];
  readonly picklistExtensionContributions: SchemaRegistry['picklistExtensionContributions'];
  recordCurrencyFollowRefusalOf: SchemaRegistry['recordCurrencyFollowRefusalOf'];
  recordCurrencyFollowRefusalOfRun: SchemaRegistry['recordCurrencyFollowRefusalOfRun'];
  resolveObjectKey: SchemaRegistry['resolveObjectKey'];
  resolveOwnerLayer: SchemaRegistry['resolveOwnerLayer'];
  restorePoint: SchemaRegistry['restorePoint'];
  readonly securityCatalogClaims: SchemaRegistry['securityCatalogClaims'];
}

/** The bodies of the "Restore on refusal" section of `SchemaRegistry`: a stateless facet, called by the class's stubs. */
export class RestoreFacet {
  /** The body of `SchemaRegistry#restoringOnRefusal`; the method's docblock there is its contract. */
  static restoringOnRefusal<T>(this: Pick<RestoreHost, 'invalidateAll' | 'recordCurrencyFollowRefusalOfRun' | 'restorePoint'>, register: () => T): T {
    const open = this.restorePoint;
    const point = new RegistrationRestorePoint();
    this.restorePoint = point;
    try {
      const result = register();
      if (result instanceof Promise) {
        throw new TypeError('[Registry] restoringOnRefusal takes a synchronous registration; it was handed one that returned a promise.');
      }
      if (open) {
        open.adopt(point);
      } else {
        const follow = this.recordCurrencyFollowRefusalOfRun(point);
        if (follow) throw follow;
      }
      return result;
    } catch (err) {
      point.restore();
      this.invalidateAll();
      throw err;
    } finally {
      this.restorePoint = open;
    }
  }

  /**
   * [ADR-0144 D2 and D6, amended] The record-currency follow door, asked of
   * one whole registration run at its end: the refusal of the first object
   * layer the run registered that the door refuses, or `undefined`.
   *
   * A single save asks the door before its one body registers
   * ({@link objectRegistrationRefusal}'s `againstRegistry`). A run registers
   * several, in an order a later one can still complete — a package's
   * `objectExtensions` after its `objects`, a later package of the artifact,
   * its residual, on a reload the new version of an object an earlier body
   * follows — so no registration inside it can ask. Its end can: each layer is
   * asked as a single save of it would be, with the registry holding the whole
   * run, as its object is served ({@link servedFoldWithLayer}), and against
   * the object as it was served with what the run replaced in the layer's slot:
   * a pair the run leaves as it found it is not the run's to answer for
   * (#33593 ruling R7). A pair with an end outside the run is judged against the
   * object that is registered, as a single save judges it. Where that object
   * is the environment's own, lying over a package's, and only it earns the
   * refusal, the refusal says so ({@link followRefusalAsServed}).
   *
   * ⛔ Asked only of a layer the served object reads. An owner under a
   * tenant's overlay is not one: the overlay's body is the base that is
   * served ({@link resolveObject}), the run did not register it, and asking
   * the owner beneath it would refuse a package over a code field the served
   * object holds. Nor is a layer a later write of the run took
   * out again (the same package registered twice).
   *
   * Asked only once the cold boot has sealed the registry, for the reason the
   * single save's question is: before that an `extend` contribution or the
   * other end can still register (AGENTS.md, startup registry reads). D6's
   * roll-up half is not asked again: {@link registerObject} asked it of every
   * layer as it registered.
   */
  static recordCurrencyFollowRefusalOfRun(this: Pick<RestoreHost, 'bareNameHoldersAreSealed' | 'followRefusalAsServed' | 'getAllObjects' | 'objectContributors' | 'recordCurrencyFollowRefusalOf'>, point: RegistrationRestorePoint): Error | undefined {
    if (!this.bareNameHoldersAreSealed) return undefined;
    const layers = point.registeredObjects();
    if (layers.length === 0) return undefined;
    // One read for the whole question: nothing registers while it is asked.
    const all = this.getAllObjects();
    for (const { fqn, schema, contributor, replaced } of layers) {
      const sitting = this.objectContributors.get(fqn);
      if (!sitting?.includes(contributor)) continue;
      if (contributor.ownership === 'own' && sitting.some((c) => c.ownership === 'overlay')) continue;
      const layer: FollowDoorLayer = { packageId: contributor.packageId, priority: contributor.priority, before: replaced };
      const refusal = this.recordCurrencyFollowRefusalOf(schema, contributor.ownership, layer, () => all);
      if (refusal) return this.followRefusalAsServed(refusal, schema, contributor.ownership, layer, all);
    }
    return undefined;
  }

  /**
   * [ADR-0144 D2 and D6, amended] A run's follow refusal that the packages'
   * own definitions would not earn, said as what it is.
   *
   * An object can be served from the environment's own object of the same
   * name, lying over the definition a package ships ({@link resolveObject}'s
   * base). The run's end judges a pair against what is served, so a package
   * that is right in itself is refused when that served object lacks the other
   * end, and the door's sentence then tells its author to correct a declaration
   * that is not wrong. So the question is asked once more with each such
   * object read through its package's definition ({@link resolveOwnerLayer}).
   * Where that clears the refusal, the sentence gains the fact and the objects
   * it is true of ({@link recordCurrencyFollowRefusalOverEnvironmentObjects});
   * the refusal itself, its code and its status stand. Any other refusal is
   * returned as it is. Only a refused run pays for the second question.
   */
  static followRefusalAsServed(this: Pick<RestoreHost, 'getObject' | 'objectContributors' | 'recordCurrencyFollowRefusalOf' | 'resolveObjectKey' | 'resolveOwnerLayer'>, refusal: RecordCurrencyFollowRefusedError, schema: ServiceObject, ownership: ObjectOwnership, layer: FollowDoorLayer, all: readonly ServiceObject[]): RecordCurrencyFollowRefusedError {
    const overPackage: string[] = [];
    for (const [fqn, sitting] of this.objectContributors) {
      const overlay = sitting.find((c) => c.ownership === 'overlay');
      if (overlay && isTenantAuthored(overlay.definition) && sitting.some((c) => c.ownership === 'own')) overPackage.push(fqn);
    }
    if (overPackage.length === 0) return refusal;
    /** Is the layer still refused with `throughPackage` read as their packages define them? */
    const refusedReading = (throughPackage: ReadonlySet<string>): boolean => {
      const read = (object: ServiceObject | undefined): ServiceObject | undefined => {
        const fqn = object === undefined ? undefined : this.resolveObjectKey(object.name);
        return fqn !== undefined && throughPackage.has(fqn) ? this.resolveOwnerLayer(fqn) ?? object : object;
      };
      const objects = all.map((object) => read(object) ?? object);
      return this.recordCurrencyFollowRefusalOf(schema, ownership, layer, () => objects, (name) => read(this.getObject(name))) !== undefined;
    };
    if (refusedReading(new Set(overPackage))) return refusal;
    // The ones that decide it, each on its own; all of them when only together they do.
    const deciding = overPackage.filter((fqn) => !refusedReading(new Set([fqn])));
    return recordCurrencyFollowRefusalOverEnvironmentObjects(refusal, deciding.length > 0 ? deciding : overPackage);
  }

  /** The body of `SchemaRegistry#recordRestoreOnRefusal`; the method's docblock there is its contract. */
  static recordRestoreOnRefusal(this: Pick<RestoreHost, 'restorePoint'>, key: string, capture: () => () => void): void {
    this.restorePoint?.note(`outside\u0000${key}`, capture);
  }

  /** Record one app's list of navigation contributions before its first write. */
  static noteAppNavContributions(this: Pick<RestoreHost, 'appNavContributions' | 'restorePoint'>, app: string): void {
    this.restorePoint?.note(`navContributions\u0000${app}`, () => {
      const saved = this.appNavContributions.get(app);
      const copy = saved ? [...saved] : undefined;
      return () => {
        if (copy) this.appNavContributions.set(app, copy);
        else this.appNavContributions.delete(app);
      };
    });
  }

  /** Record an object's contributor list (and each contributor's mutable slots) before its first write. */
  static noteObjectEntry(this: Pick<RestoreHost, 'closeObjectEntry' | 'mergedObjectCache' | 'objectContributors' | 'restorePoint'>, fqn: string): void {
    this.restorePoint?.note(`object\u0000${fqn}`, () => {
      const list = this.objectContributors.get(fqn);
      if (!list) return () => this.closeObjectEntry(fqn);
      // The late-install branch re-classifies a sitting contributor in place,
      // so its ownership and priority are kept beside the reference.
      const saved = list.map((c) => ({ c, ownership: c.ownership, priority: c.priority }));
      return () => {
        for (const s of saved) {
          s.c.ownership = s.ownership;
          s.c.priority = s.priority;
        }
        list.splice(0, list.length, ...saved.map((s) => s.c));
        this.mergedObjectCache.delete(fqn);
      };
    });
  }

  /** Record a namespace's owner set before its first write. */
  static noteNamespace(this: Pick<RestoreHost, 'namespaceRegistry' | 'restorePoint'>, namespace: string): void {
    this.restorePoint?.note(`namespace\u0000${namespace}`, () => {
      const owners = this.namespaceRegistry.get(namespace);
      const saved = owners ? new Set(owners) : undefined;
      return () => {
        if (saved) this.namespaceRegistry.set(namespace, saved);
        else this.namespaceRegistry.delete(namespace);
      };
    });
  }

  /** Record whether an item type had a store at all, before the run can create one. */
  static noteItemType(this: Pick<RestoreHost, 'metadata' | 'restorePoint'>, type: string): void {
    this.restorePoint?.note(`type\u0000${type}`, () => {
      const hadType = this.metadata.has(type);
      return () => {
        if (!hadType && this.metadata.get(type)?.size === 0) this.metadata.delete(type);
      };
    });
  }

  /** Record one item slot before its first write. */
  static noteItem(this: Pick<RestoreHost, 'metadata' | 'restorePoint'>, type: string, key: string): void {
    this.restorePoint?.note(`item\u0000${type}\u0000${key}`, () => {
      const collection = this.metadata.get(type);
      const had = collection?.has(key) ?? false;
      const value = collection?.get(key);
      return () => {
        const now = this.metadata.get(type);
        if (had) now?.set(key, value);
        else now?.delete(key);
      };
    });
  }

  /**
   * [#33050] Record the ORDER of one item type's slots before the run's first
   * removal from it ({@link replacingPackageBody}). A removed slot put back by
   * {@link noteItem} alone would come back last, and the store's order is read:
   * it is the order {@link listItems} answers and the first composite match a
   * caller naming no package is served. Put back after every later write of
   * the run is undone, so the slots come back where they stood.
   */
  static noteItemOrder(this: Pick<RestoreHost, 'metadata' | 'restorePoint'>, type: string): void {
    this.restorePoint?.note(`itemOrder\u0000${type}`, () => {
      const saved = [...(this.metadata.get(type) ?? [])];
      return () => {
        const now = this.metadata.get(type);
        if (!now) return;
        now.clear();
        for (const [key, value] of saved) now.set(key, value);
      };
    });
  }

  /** Record this package's extension of one picklist before its first write. */
  static notePicklistExtension(this: Pick<RestoreHost, 'picklistExtensionContributions' | 'restorePoint'>, target: string, packageKey: string): void {
    this.restorePoint?.note(`picklistExtension\u0000${target}\u0000${packageKey}`, () => {
      const byPackage = this.picklistExtensionContributions.get(target);
      const saved = byPackage?.get(packageKey);
      return () => {
        let now = this.picklistExtensionContributions.get(target);
        if (saved) {
          if (!now) this.picklistExtensionContributions.set(target, now = new Map());
          now.set(packageKey, saved);
        } else if (now) {
          now.delete(packageKey);
          if (now.size === 0) this.picklistExtensionContributions.delete(target);
        }
      };
    });
  }

  /** Record who holds one security catalog name before its first write. */
  static noteSecurityCatalogClaim(this: Pick<RestoreHost, 'restorePoint' | 'securityCatalogClaims'>, type: SecurityCatalogType, name: string): void {
    this.restorePoint?.note(`catalogClaim\u0000${type}\u0000${name}`, () => {
      const saved = this.securityCatalogClaims.get(type)?.get(name);
      const copy = saved ? new Set(saved) : undefined;
      return () => {
        let byName = this.securityCatalogClaims.get(type);
        if (copy !== undefined) {
          if (!byName) this.securityCatalogClaims.set(type, byName = new Map());
          byName.set(name, copy);
        } else {
          byName?.delete(name);
        }
      };
    });
  }

  /** Record who holds one bare name (`bare-name-one-holder.ts`) before its first write. */
  static noteBareNameClaim(this: Pick<RestoreHost, 'bareNameClaims' | 'restorePoint'>, type: BareNameOneHolderType, name: string): void {
    this.restorePoint?.note(`bareNameClaim\u0000${type}\u0000${name}`, () => {
      const saved = this.bareNameClaims.get(type)?.get(name);
      const copy = saved ? new Set(saved) : undefined;
      return () => {
        let byName = this.bareNameClaims.get(type);
        if (copy !== undefined) {
          if (!byName) this.bareNameClaims.set(type, byName = new Map());
          byName.set(name, copy);
        } else {
          byName?.delete(name);
        }
      };
    });
  }

  /**
   * Record the default record page claims before `packageId`'s first rewrite
   * of them ({@link recordDefaultRecordPageClaims} drops all of the package's
   * claims, then adds what the manifest declares). Put back per object, and
   * only for the objects `packageId` held a claim on before or after, each in
   * its holders' original order.
   */
  static noteDefaultRecordPageClaims(this: Pick<RestoreHost, 'defaultRecordPageClaims' | 'restorePoint'>, packageId: string): void {
    // Keyed by slot (`recordPageSlotKey`): an object's default, or one app's
    // page of it. Every slot is put back the same way.
    this.restorePoint?.note(`defaultPageClaims\u0000${packageId}`, () => {
      const saved = new Map<string, Map<string, string>>();
      for (const [object, byPackage] of this.defaultRecordPageClaims) saved.set(object, new Map(byPackage));
      return () => {
        const objects = new Set<string>();
        for (const [object, byPackage] of saved) if (byPackage.has(packageId)) objects.add(object);
        for (const [object, byPackage] of this.defaultRecordPageClaims) if (byPackage.has(packageId)) objects.add(object);
        for (const object of objects) {
          const before = saved.get(object);
          if (before) this.defaultRecordPageClaims.set(object, new Map(before));
          else this.defaultRecordPageClaims.delete(object);
        }
      };
    });
  }
}
