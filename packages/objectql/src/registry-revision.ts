// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34206, ADR-0156 D2] The schema registry's own change counter:
 * `SchemaRegistry#revision`, moved by every call to a public method that can
 * change what the registry answers.
 *
 * ## Why a classification of the public surface, and not a list of bump sites
 *
 * The registry's state is a dozen maps and sets spread over a dozen facet
 * files, and the existing `objectRevision` covers the object set only. A
 * counter bumped by hand at each mutation would be a list of call sites inside
 * the source: a new mutation path that forgets the bump is invisible. Instead
 * every public method of `SchemaRegistry` is classified here, once, as a
 * `read` or a `write`, and every `write` is wrapped so that the call moves the
 * counter, before and after it runs (and after it settles, should one ever
 * return a promise). Private methods are not wrapped: they run only inside a
 * public call, which is the boundary.
 *
 * The classification is exhaustive BY TYPE: {@link SCHEMA_REGISTRY_METHOD_KINDS}
 * is a `Record` over every public method name of the class, so a new public
 * method fails the type check until someone writes down which kind it is. The
 * safe answer for a method nobody has read is `write`: it costs cache hits
 * (a consumer sees a move where nothing it reads changed), never staleness.
 *
 * ⛔ `read` means "changes nothing any registry answer is a function of". A
 * method that fills a derived cache (`getObject` fills the merged-object
 * cache) or records a diagnostic nobody's item answer reads
 * (`applyNavContributions` notes a missing nav group for
 * `getAppNavDiagnostics`) is a `read`. A judge that only throws or answers a
 * refusal is a `read`. Anything that registers, removes, enables, disables,
 * seals, claims, records an ownership fact or a listener is a `write`.
 *
 * What the counter cannot see: a caller that mutates, in place, an object the
 * registry handed it. That is outside the registry's own code, and no
 * confirmation observes it either, so a cache keyed on this counter may serve
 * the earlier compile until something else moves. The compile cache bounds
 * it only by its age cap (`META_COMPILE_CACHE_MAX_AGE_BOUNDS`,
 * `@objectstack/metadata-protocol`); a caller must not edit what the registry
 * hands out.
 */

import type { SchemaRegistry } from './registry.js';
import { FIND_BOUND_ACTION_COLLISIONS } from './registry-top-level.js';

/** Every public method key of `SchemaRegistry`, symbol keys included (accessors and fields excluded). */
export type SchemaRegistryMethodName = {
  [K in keyof SchemaRegistry]: SchemaRegistry[K] extends (...args: any[]) => any ? K : never;
}[keyof SchemaRegistry];

/**
 * The kind of every public `SchemaRegistry` method. See the module header for
 * what `read` admits. Exhaustive by type: adding a public method to the class
 * without a row here is a compile error.
 */
export const SCHEMA_REGISTRY_METHOD_KINDS: Readonly<Record<SchemaRegistryMethodName, 'read' | 'write'>> = Object.freeze({
  // Package enablement and lifecycle listeners
  setInitialDisabledPackageIds: 'write',
  onPackageEnabled: 'write',
  onPackageUninstalled: 'write',
  restoringOnRefusal: 'write',
  recordRestoreOnRefusal: 'write',
  // Namespaces and claims
  registerNamespace: 'write',
  unregisterNamespace: 'write',
  getNamespaceOwner: 'read',
  getNamespaceOwners: 'read',
  defaultRecordPageHoldersOf: 'read',
  securityCatalogNamesHeldBy: 'read',
  claimBareNameFunctions: 'write',
  releaseBareNameFunctions: 'write',
  sealBareNameHolders: 'write',
  // Objects
  objectRegistrationRefusal: 'read',
  registerObject: 'write',
  resolveObject: 'read',
  getStorageObject: 'read',
  getAllStorageObjects: 'read',
  findUnboundActionTargets: 'read',
  tenantRuleCopyRefusal: 'read',
  foldObjectExtendersOnto: 'read',
  materializeServedObjectOnto: 'read',
  provisionSearchCompanionOnto: 'read',
  stripProvisionedSearchCompanionFrom: 'read',
  stripMaterializedStampsFrom: 'read',
  setDeploymentPlatformGlobalObjects: 'write',
  getObject: 'read',
  getAllObjects: 'read',
  getObjectContributors: 'read',
  getWithheldExtensionFields: 'read',
  getRelatedListsArrangement: 'read',
  getObjectExtensionsOf: 'read',
  getObjectOwner: 'read',
  getPackagedObjectOwner: 'read',
  getPackagedObjectBase: 'read',
  getPackagedFieldPatchBases: 'read',
  extendContributionRefusal: 'read',
  registerObjectExtension: 'write',
  withdrawObjectExtension: 'write',
  removeObjectOverlay: 'write',
  assertSingleOwnerPerObject: 'read',
  assertPackageUninstallable: 'read',
  unregisterObjectsByPackage: 'write',
  unregisterObject: 'write',
  // Items
  registerItem: 'write',
  validate: 'read',
  unregisterItem: 'write',
  unregisterItemsByPackage: 'write',
  replacingPackageBody: 'write',
  getItem: 'read',
  overlayRowBinding: 'read',
  packageScopedHoldersOf: 'read',
  getPackageScopedItem: 'read',
  getEnvironmentScopedItem: 'read',
  getEnvironmentScopedActions: 'read',
  readsByPackage: 'read',
  resolveItem: 'read',
  refuseAmbiguousObjectLessAction: 'read',
  removePackageOverlaySlots: 'write',
  getArtifactItem: 'read',
  removeRuntimeShadow: 'write',
  removeOverlayEntry: 'write',
  listItems: 'read',
  isPackageDisabled: 'read',
  isObjectPackageDisabled: 'read',
  isFlowOfDisabledPackage: 'read',
  isActionWithheldByDisabledPackage: 'read',
  getRegisteredTypes: 'read',
  // Packages
  installPackage: 'write',
  refuseResidualNamespaceNameConflicts: 'read',
  recordResidualNamespaceHolder: 'write',
  uninstallPackage: 'write',
  getPackage: 'read',
  recordResidualOwnerDependencies: 'write',
  residualOwnerDependenciesOf: 'read',
  getAllPackages: 'read',
  enablePackage: 'write',
  disablePackage: 'write',
  updatePackageManifest: 'write',
  // Apps and navigation
  registerApp: 'write',
  getApp: 'read',
  getAllApps: 'read',
  registerAppNavContribution: 'write',
  setPackageNavContributions: 'write',
  getAppNavContributions: 'read',
  applyNavContributions: 'read',
  getAppNavDiagnostics: 'read',
  // Plugins and kinds
  registerPlugin: 'write',
  getAllPlugins: 'read',
  registerKind: 'write',
  getAllKinds: 'read',
  // Picklists
  registerPicklistExtension: 'write',
  resolvePicklistOptions: 'read',
  picklistReferenceVerdict: 'read',
  findUnresolvedPicklistReferences: 'read',
  findOrphanPicklistExtensions: 'read',
  findOutsideClosurePicklistReferences: 'read',
  sealPicklistVocabulary: 'write',
  refusePicklistArrival: 'write',
  registeringPicklistArrival: 'write',
  admitPicklistArrival: 'write',
  judgePicklistArrival: 'write',
  findDisagreeingPicklistReferences: 'read',
  // The boot audit of bound code actions, under its symbol key
  [FIND_BOUND_ACTION_COLLISIONS]: 'read' as const,
  // Cache drops and reset
  invalidate: 'write',
  invalidateAll: 'write',
  reset: 'write',
});

/** The counter of each registry, held beside it rather than on it. */
const revisions = new WeakMap<object, number>();

/** The revision of `registry`: `0` until its first write. */
export function schemaRegistryRevisionOf(registry: object): number {
  return revisions.get(registry) ?? 0;
}

function bump(registry: object): void {
  revisions.set(registry, (revisions.get(registry) ?? 0) + 1);
}

/**
 * Wrap every `write` method of `registryClass.prototype` so that a call moves
 * the instance's revision. Called once, by `registry.ts`, right after the
 * class is defined. Idempotent per class.
 */
export function installSchemaRegistryRevision(registryClass: { prototype: object }): void {
  const proto = registryClass.prototype as Record<PropertyKey, unknown>;
  if (installed.has(proto)) return;
  installed.add(proto);
  for (const name of Reflect.ownKeys(SCHEMA_REGISTRY_METHOD_KINDS)) {
    if ((SCHEMA_REGISTRY_METHOD_KINDS as Record<PropertyKey, string>)[name] !== 'write') continue;
    const descriptor = Object.getOwnPropertyDescriptor(proto, name);
    const original = descriptor?.value;
    if (typeof original !== 'function') {
      throw new Error(`[ADR-0156] SchemaRegistry has no method '${String(name)}' to count; update SCHEMA_REGISTRY_METHOD_KINDS.`);
    }
    Object.defineProperty(proto, name, {
      ...descriptor,
      value: function countedWrite(this: object, ...args: unknown[]): unknown {
        bump(this);
        let result: unknown;
        try {
          result = original.apply(this, args);
        } finally {
          bump(this);
        }
        if (result instanceof Promise) {
          return result.finally(() => bump(this));
        }
        return result;
      },
    });
  }
}

const installed = new WeakSet<object>();
