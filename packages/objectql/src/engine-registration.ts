// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29986 codemod] The
 * "Package, app, plugin, driver and datasource registration" section of
 * `ObjectQL`: the bodies of `registerPackageBody`,
 * `registerMetadataCollections`, `supplyFileColumnsMovedResolver`,
 * `registerDatasourceDef`, `applyExternalDriverFloor`, `assertWriteAllowed`
 * moved out of `engine.ts` whole by `scripts/codemod-split-engine.mjs`.
 *
 * A MOVE, not a redesign. Each function below is the body of the `ObjectQL`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class with its docblock and
 * signature, so the published `dist/*.d.ts`, an instance spy and a subclass
 * override are what they were; the docblock there is the contract.
 *
 * The bodies reach the class through {@link RegistrationHost}: exactly the
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
import type { InstalledPackageSource } from '@objectstack/spec/kernel';
import type { IDataDriver } from '@objectstack/core';
import { ExternalWriteForbiddenError, pluralToSingular } from '@objectstack/spec/shared';
import type { ArtifactInstallScope } from './registry.js';
import { ASSEMBLED_VIEW_ITEMS_KEY, AssembledViewArtifactSchema, expandViewContainer, isAggregatedViewContainer } from '@objectstack/spec';
import { createExternalDriverFloor, isExternalDriverFloor, needsExternalDriverFloor, unwrapExternalDriverFloor } from './external-driver-floor.js';
import {
  METADATA_ARRAY_KEYS, assembledViewItemRefusal, noteRegistrationStamp, registerAppNotingStamp,
  resolveMetadataItemName, stampObjectPackage, stampPackage,
} from './engine-top-level.js';
import type { DatasourceDef } from './engine-top-level.js';
import type { ObjectQL } from './engine.js';

/**
 * The `ObjectQL` members the functions below read — every one of them, and
 * no other. Each is typed AS the class member (an indexed access on the
 * class), so a change to a member's signature on the class is a change here
 * too. `readonly` members are the getters.
 */
export interface RegistrationHost {
  readonly _registry: ObjectQL['_registry'];
  applyExternalDriverFloor: ObjectQL['applyExternalDriverFloor'];
  readonly datasourceDefs: ObjectQL['datasourceDefs'];
  readonly drivers: ObjectQL['drivers'];
  haveFileColumnsMoved: ObjectQL['haveFileColumnsMoved'];
  readonly logger: ObjectQL['logger'];
  registerMetadataCollections: ObjectQL['registerMetadataCollections'];
  registerPlugin: ObjectQL['registerPlugin'];
  resolveNavObjectNames: ObjectQL['resolveNavObjectNames'];
}

/** The body of `ObjectQL#registerPackageBody`; the method's docblock there is its contract. */
export function registerPackageBody(this: Pick<RegistrationHost, '_registry' | 'logger' | 'registerMetadataCollections' | 'registerPlugin' | 'resolveNavObjectNames'>, manifest: any, id: string, namespace: string | undefined, version: string | undefined, source: Exclude<InstalledPackageSource, 'authored'>, scope: ArtifactInstallScope | undefined): void {
      // 1. Register the Package (manifest + lifecycle state).
      // [ADR-0130 D1/D3] `scope` is the artifact's own package list, passed by
      // the load path that read the artifact. It is what lets the install gate
      // tell a CO-OWNER (another package from this same artifact) from a
      // stranger — the question D1 corrected the gate to ask. Absent for every
      // single-package caller, where the gate behaves exactly as before (D7).
      this._registry.installPackage(manifest, source, undefined, scope);
      this.logger.debug('Installed Package', { id: manifest.id, name: manifest.name, namespace });

      // 2. Register owned objects
      if (manifest.objects) {
          if (Array.isArray(manifest.objects)) {
             this.logger.debug('Registering objects from manifest (Array)', { id, objectCount: manifest.objects.length });
             for (const objDef of manifest.objects) {
                const fqn = this._registry.registerObject(stampObjectPackage(objDef, id, version), id, namespace, 'own');
                this.logger.debug('Registered Object', { fqn, from: id });
             }
          } else {
             this.logger.debug('Registering objects from manifest (Map)', { id, objectCount: Object.keys(manifest.objects).length });
             // `manifest` is `any` (a raw authored manifest), so the map branch
             // widens its values to `unknown`. State the contract once, on the
             // entries, rather than casting the argument at the call: the map
             // values ARE authored `ServiceObject`s — the INPUT shape, which is
             // what `registerObject` takes since ADR-0122 phase 2 (commit 53068c130).
             for (const [name, objDef] of Object.entries(manifest.objects) as [string, ServiceObject][]) {
                // Ensure name in definition matches key
                objDef.name = name;
                const fqn = this._registry.registerObject(stampObjectPackage(objDef, id, version), id, namespace, 'own');
                this.logger.debug('Registered Object', { fqn, from: id });
             }
          }
      }

      // 2b. Register object extensions (fields added to objects owned by other packages)
      if (Array.isArray(manifest.objectExtensions) && manifest.objectExtensions.length > 0) {
          this.logger.debug('Registering object extensions', { id, count: manifest.objectExtensions.length });
          for (const ext of manifest.objectExtensions) {
              const targetFqn = ext.extend;
              const priority = ext.priority ?? 200;
              // Create a partial object definition for the extension
              const extDef = {
                  name: targetFqn, // Use the target FQN as name
                  fields: ext.fields,
                  // [ADR-0146 D10, second rule] The per-field display patches,
                  // the slot as `ObjectExtensionSchema.fieldPatches` declares
                  // it — applied by the registry's `mergeObjectDefinitions`,
                  // whose fold every object read shares.
                  fieldPatches: ext.fieldPatches,
                  label: ext.label,
                  pluralLabel: ext.pluralLabel,
                  description: ext.description,
                  validations: ext.validations,
                  indexes: ext.indexes,
              };
              // Register as extension (namespace is undefined since we're targeting by FQN)
              this._registry.registerObject(stampPackage(extDef, id, version), id, undefined, 'extend', priority);
              this.logger.debug('Registered Object Extension', { target: targetFqn, priority, from: id });
          }
      }

      // 3. Register apps (UI navigation definitions) as their own metadata type
      //    Resolve short objectName references in navigation to FQN so the
      //    Console UI can match them against the object registry.
      if (Array.isArray(manifest.apps) && manifest.apps.length > 0) {
          this.logger.debug('Registering apps from manifest', { id, count: manifest.apps.length });
          for (const app of manifest.apps) {
              const appName = app.name || app.id;
              if (appName) {
                  const resolved = namespace ? this.resolveNavObjectNames(app, namespace) : app;
                  registerAppNotingStamp(this._registry, resolved, id, version);
                  this.logger.debug('Registered App', { app: appName, from: id });
              }
          }
      }

      // 4. If manifest itself looks like an App (has navigation), also register as app
      //    This handles the case where the manifest IS the app definition (legacy/simple packages)
      if (manifest.name && manifest.navigation && !manifest.apps?.length) {
          const resolved = namespace ? this.resolveNavObjectNames(manifest, namespace) : manifest;
          registerAppNotingStamp(this._registry, resolved, id, version);
          this.logger.debug('Registered manifest-as-app', { app: manifest.name, from: id });
      }

      // (Navigation contributions, ADR-0029 D7, register in `registerApp`
      // once this body has registered whole.)

      // 5. Register all other metadata types generically — the SAME seam the
      //    nested-plugin path uses (`registerMetadataCollections`), so the two
      //    entry points cannot answer differently for one collection (#7163).
      this.registerMetadataCollections(manifest, id, 'manifest', version);

      // 6. Register seed data as metadata (keyed by target object name)
      const seedData = (manifest as any).data;
      if (Array.isArray(seedData) && seedData.length > 0) {
          this.logger.debug('Registering seed data datasets', { id, count: seedData.length });
          for (const dataset of seedData) {
              if (dataset.object) {
                  // [#28534] The collection loop's owner-stamp refusal for the
                  // one collection filed outside it was judged before anything
                  // registered ({@link packageBodySeedDataRefusal}).
                  const stampBefore = (dataset as { _packageId?: unknown })._packageId;
                  this._registry.registerItem('data', stampPackage(dataset, id, version), 'object' as any, id);
                  noteRegistrationStamp(dataset, stampBefore);
              }
          }
      }

      // (Contributed kinds register in `registerApp` once this body has
      // registered whole: they belong to no package, so no restore of a
      // refused body could take them back.)

      // 7. Recursively register nested plugins
      if (Array.isArray(manifest.plugins) && manifest.plugins.length > 0) {
          this.logger.debug('Processing nested plugins', { id, count: manifest.plugins.length });
          for (const plugin of manifest.plugins) {
              if (plugin && typeof plugin === 'object') {
                  const pluginName = plugin.name || plugin.id || 'unnamed-plugin';
                  this.logger.debug('Registering nested plugin', { pluginName, parentId: id });
                  this.registerPlugin(plugin, id, namespace, version);
              }
          }
      }
  }

/** The body of `ObjectQL#registerMetadataCollections`; the method's docblock there is its contract. */
export function registerMetadataCollections(this: Pick<RegistrationHost, '_registry' | 'logger'>, source: any, ownerId: string, sourceLabel: string, ownerVersion?: string) {
      // `ownerVersion` is the owning package's version, stamped like `ownerId`.
      for (const key of METADATA_ARRAY_KEYS) {
          const items = (source as any)?.[key];
          if (!Array.isArray(items) || items.length === 0) continue;
          this.logger.debug(`Registering ${key} from ${sourceLabel}`, { id: ownerId, count: items.length });
          // A `picklistExtensions` entry is not an item: it has no name, only
          // the list it adds to, and the registry merges it there — additive
          // only, a repeated value refused loudly (`registerPicklistExtension`).
          if (key === 'picklistExtensions') {
              for (const extension of items) this._registry.registerPicklistExtension(extension, ownerId);
              continue;
          }
          for (const item of items) {
              const itemName = resolveMetadataItemName(key, item);
              if (!itemName) {
                  this.logger.warn(`Skipping ${pluralToSingular(key)} without a derivable name`, { id: ownerId });
                  continue;
              }
              // [#28697] Every refusal this seam used to raise here — the
              // divergent view container, the permission set's owner, an
              // item's own `_packageId`, a `views:` entry that is not a
              // container — is judged from the body alone, so it is asked
              // before anything of the package registers, with the reasons it
              // exists: {@link packageBodyCollectionRefusal}. Both callers ask
              // it first (`registerApp`, for the body and each nested plugin).
              const toRegister = item.name === itemName ? item : { ...item, name: itemName };
              const stampBefore = (toRegister as { _packageId?: unknown })._packageId;
              this._registry.registerItem(pluralToSingular(key), stampPackage(toRegister, ownerId, ownerVersion), 'name' as any, ownerId);
              noteRegistrationStamp(toRegister, stampBefore);
              // "Object has-many View" (ADR-0017): a `defineView` document
              // aggregates an object's views. Register the container under the
              // bare <object> key (above, back-compat) AND expand it into
              // independent ViewItems registered under <object>.<key>, so
              // `getViewsByObject()` / `GET /meta/view?object=` surface the
              // per-view `package` layer the switcher + Studio consume.
              if (key === 'views' && isAggregatedViewContainer(toRegister)) {
                  for (const vi of expandViewContainer(itemName, toRegister)) {
                      for (const w of vi._diagnostics?.warnings ?? []) {
                          this.logger.warn(`View expansion warning for '${vi.name}': ${w.message}`, { from: ownerId });
                      }
                      this._registry.registerItem('view', stampPackage(vi, ownerId, ownerVersion), 'name' as any, ownerId);
                  }
              }
          }
      }

      // [#5320] The `viewItems:` channel — the declared entry for the
      // NON-container view artifacts a runtime-ASSEMBLED manifest carries
      // (tenant-authored standalone ViewItems, flattened overlays, expanded
      // items a travelling container cannot re-derive). Written by the manifest
      // assemblers (`partitionAssembledViewArtifacts` — package export, the
      // artifact factories); refused at the authoring door (`defineStack` types
      // the key `never`), so only machine-assembled manifests legitimately
      // reach here carrying it. Strictly schema'd: each entry is judged by
      // `AssembledViewArtifactSchema` and the PARSED body is what registers, so
      // an undeclared bag neither passes nor rides through — declared =
      // enforced, in both directions.
      const assembledItems = (source as any)?.[ASSEMBLED_VIEW_ITEMS_KEY];
      if (Array.isArray(assembledItems) && assembledItems.length > 0) {
          this.logger.debug(`Registering ${ASSEMBLED_VIEW_ITEMS_KEY} from ${sourceLabel}`, { id: ownerId, count: assembledItems.length });
          for (const item of assembledItems) {
              // [#28697] The entry's parse refusal and its owner stamp were
              // judged before anything registered ({@link packageBodyCollectionRefusal});
              // the parse is repeated for the body it registers.
              const parsed = AssembledViewArtifactSchema.safeParse(item);
              if (!parsed.success) throw assembledViewItemRefusal(item, parsed.error, sourceLabel, ownerId);
              const body = parsed.data as Record<string, unknown>;
              const itemName = resolveMetadataItemName('views', body);
              if (!itemName) {
                  this.logger.warn('Skipping viewItems entry without a derivable name', { id: ownerId });
                  continue;
              }
              // No {@link noteRegistrationStamp} follows the `registerItem` below, on
              // purpose: what it stamps is `parsed.data`, the parse's own new
              // object, never the caller's entry, so this site leaves no in-place
              // stamp on anything a later registration could be handed
              // (`collection-item-owner-stamp.test.ts` pins the caller's entry
              // unstamped).
              const toRegister = body.name === itemName ? body : { ...body, name: itemName };
              this._registry.registerItem('view', stampPackage(toRegister, ownerId, ownerVersion), 'name' as any, ownerId);
          }
      }
  }

/** The body of `ObjectQL#supplyFileColumnsMovedResolver`; the method's docblock there is its contract. */
export function supplyFileColumnsMovedResolver(this: Pick<RegistrationHost, 'haveFileColumnsMoved' | 'logger'>, driver: IDataDriver): void {
    const sink = driver as unknown as {
      setFileColumnsMovedResolver?: (resolve: () => Promise<boolean>) => void;
    };
    if (typeof sink.setFileColumnsMovedResolver !== 'function') return;
    try {
      sink.setFileColumnsMovedResolver(() => this.haveFileColumnsMoved());
    } catch (e: any) {
      // Installing the question must never break a driver registration. A
      // driver that did not take the resolver keeps its own default, which is
      // the JSON arm — the same place every other way of not knowing lands.
      this.logger.debug('Driver declined the ADR-0104 media-arm resolver', {
        driverName: driver.name,
        error: e?.message ?? String(e),
      });
    }
  }

/** The body of `ObjectQL#registerDatasourceDef`; the method's docblock there is its contract. */
export function registerDatasourceDef(this: Pick<RegistrationHost, 'applyExternalDriverFloor' | 'datasourceDefs'>, def: DatasourceDef): void {
    if (!def?.name) return;
    // [#27277] A def that names no driver keeps the id stored before it: a
    // caller registering only the write-gate facts after a connect must not
    // take the floor back off, so an absent key never reads as "not a plugin
    // driver". It is a keep, not a source: `unregisterDriver` drops the stored
    // def, so a connect that follows an eviction has nothing to keep — the
    // datasource-connection service names `driver` on every registration
    // ([#27666], `EngineDatasourceDef.driver`).
    const driver = def.driver ?? this.datasourceDefs.get(def.name)?.driver;
    this.datasourceDefs.set(def.name, { driver, schemaMode: def.schemaMode, external: def.external });
    this.applyExternalDriverFloor(def.name);
  }

/** The body of `ObjectQL#applyExternalDriverFloor`; the method's docblock there is its contract. */
export function applyExternalDriverFloor(this: Pick<RegistrationHost, '_registry' | 'datasourceDefs' | 'drivers' | 'logger'>, name: string): void {
    const current = this.drivers.get(name);
    if (!current) return;
    const floored = isExternalDriverFloor(current);
    if (needsExternalDriverFloor(this.datasourceDefs.get(name))) {
      if (floored) return;
      this.drivers.set(name, createExternalDriverFloor(current, {
        datasource: name,
        fieldsOf: (object) => this._registry.getObject(object)?.fields,
        // [#29762] Read from the def held NOW, on every read: a redefinition
        // that keeps the floor returns above without re-wrapping the driver.
        rowCap: () => this.datasourceDefs.get(name)?.external?.rowCap,
        logger: this.logger,
      }));
      this.logger.info('Datasource served by a plugin driver: the engine applies each query in memory', {
        datasource: name,
      });
    } else if (floored) {
      this.drivers.set(name, unwrapExternalDriverFloor(current));
    }
  }

/** The body of `ObjectQL#assertWriteAllowed`; the method's docblock there is its contract. */
export function assertWriteAllowed(this: Pick<RegistrationHost, '_registry' | 'datasourceDefs'>, objectName: string, operation: 'insert' | 'update' | 'delete'): void {
    const object = this._registry.getObject(objectName) as any;
    const dsName = object?.datasource;
    if (!dsName || dsName === 'default') return;

    const ds = this.datasourceDefs.get(dsName);
    // No recorded definition, or an explicitly managed one ⇒ allow.
    if (!ds || !ds.schemaMode || ds.schemaMode === 'managed') return;

    const dsAllows = ds.external?.allowWrites ?? false;
    const objAllows = object?.external?.writable ?? false;
    if (!(dsAllows && objAllows)) {
      throw new ExternalWriteForbiddenError(
        `Write '${operation}' blocked on object '${objectName}': datasource '${dsName}' is external ` +
          `(schemaMode=${ds.schemaMode}). Requires datasource.external.allowWrites=true (got ${dsAllows}) ` +
          `AND object.external.writable=true (got ${objAllows}).`,
      );
    }
  }
