// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29986 codemod] The
 * "Package, app, plugin, driver and datasource registration" section of
 * `ObjectQL`: the bodies of `registerPackageBody`,
 * `registerMetadataCollections`, `supplyFileColumnsMovedResolver`,
 * `unregisterDriver`, `registerDatasourceDef`, `applyExternalDriverFloor`,
 * `listDatasourceDefs`, `markDatasourceUnavailable`,
 * `clearDatasourceUnavailable`, `getDefaultDriverName`,
 * `listUnavailableDatasources`, `assertWriteAllowed` moved out of `engine.ts`
 * whole by `scripts/codemod-split-engine.mjs`.
 *
 * A MOVE, not a redesign. {@link RegistrationFacet} is a stateless facet of `ObjectQL`
 * (ruling 6624345766): each static method of it is the body of the `ObjectQL`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class as a one-call stub with
 * its signature, so the published surface, an instance spy and a subclass
 * override are what they were. A public or protected method keeps its
 * docblock on the class, the contract; a private method's docblock moved here
 * with its body. The state stays on `ObjectQL`.
 *
 * The bodies reach the class through {@link RegistrationHost}: exactly the
 * `ObjectQL` members they read, private ones included. Every stub hands its
 * body, by a `.call`, the same host: `registrationHost` in
 * `engine-facet-hosts.ts`, built once per engine by the class's static block.
 * Methods go as closures that call them on the engine at call time, so a
 * subclass override or an instance spy is still the one reached; fields and
 * accessors go as GETTERS, read when the body reads them, as they were on the
 * class, and a field a body assigns goes with a SETTER that assigns it on the
 * engine.
 *
 * The module imports `engine.ts` for types only, so the two modules form no
 * evaluation cycle. `index.ts` re-exports nothing from this module.
 */

import type { ServiceObject } from '@objectstack/spec/data';
import type { InstalledPackageSource } from '@objectstack/spec/kernel';
import type { IDataDriver } from '@objectstack/core';
import type { DatasourceUnavailableInfo, DatasourceUnavailableKind } from './driver-connect-errors.js';
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
 * The `ObjectQL` members the bodies of {@link RegistrationFacet} read — every one of
 * them, and no other. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too. `readonly` members are the getters; the others are fields a body
 * assigns.
 */
export interface RegistrationHost {
  readonly _registry: ObjectQL['_registry'];
  applyExternalDriverFloor: ObjectQL['applyExternalDriverFloor'];
  readonly datasourceDefs: ObjectQL['datasourceDefs'];
  defaultDriver: ObjectQL['defaultDriver'];
  readonly drivers: ObjectQL['drivers'];
  haveFileColumnsMoved: ObjectQL['haveFileColumnsMoved'];
  readonly logger: ObjectQL['logger'];
  registerMetadataCollections: ObjectQL['registerMetadataCollections'];
  registerPlugin: ObjectQL['registerPlugin'];
  resolveNavObjectNames: ObjectQL['resolveNavObjectNames'];
  readonly unavailableDatasources: ObjectQL['unavailableDatasources'];
}

/** The bodies of the "Package, app, plugin, driver and datasource registration" section of `ObjectQL`: a stateless facet, called by the class's stubs. */
export class RegistrationFacet {
  /**
   * [#28697] The part of {@link registerApp} a registry verb can refuse
   * part-way: the package record, its objects, extensions, apps, collections,
   * seed data and nested plugins, in that order. Every body-only refusal was
   * judged before this runs; what is written after it is in `registerApp`.
   */
  static registerPackageBody(this: Pick<RegistrationHost, '_registry' | 'logger' | 'registerMetadataCollections' | 'registerPlugin' | 'resolveNavObjectNames'>, manifest: any, id: string, namespace: string | undefined, version: string | undefined, source: Exclude<InstalledPackageSource, 'authored'>, scope: ArtifactInstallScope | undefined): void {
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

  /**
   * Register one source's stack collections into the registry — the SINGLE
   * body both registration seams run.
   *
   * ## Why this is one method and not two loops (#7163)
   *
   * It used to be two, and #7049 only got halfway: that card hoisted the
   * ENUMERATION (`METADATA_ARRAY_KEYS`) out of the two seams after they had
   * drifted four collections apart, and measured the loop bodies against each
   * other on the way past — recording that they still differed in a per-key
   * `debug` line, the manifest seam's aggregated-view expansion, and its
   * warn-on-nameless-item. Sharing the list made "which collections does a
   * seam see?" unanswerable-differently; it left "what does a seam DO with a
   * collection both see?" still answered in two places.
   *
   * `views` is where that cost was measurable. "Object has-many View"
   * (ADR-0017 §2, §3.2) makes the loader **dual-read**: an aggregated
   * `defineView` container is registered under the bare `<object>` key for
   * back-compatible reads AND expanded into independent `ViewItem`s under
   * `<object>.<viewKey>`. Only the expanded items carry `viewKind`, and
   * `getViewsByObject()` (`metadata-manager.ts`) filters on exactly that — so
   * a container that is registered but never expanded is invisible to it, and
   * to `GET /meta/view?object=` and the view switcher above it. The manifest
   * seam expanded; the nested-plugin seam did not, so one container registered
   * `['account', 'account.all_accounts', 'account.form']` through the manifest
   * and `['account']` through a nested plugin. No refusal, no diagnostic: a
   * package shipping its views through `manifest.plugins[]` simply had no
   * views, as far as every reader of the expanded layer was concerned.
   *
   * Both differences had the same structure — a loop body copied, then
   * improved on one side only — so the body is shared rather than reconciled,
   * for the reason #7049 gave for the list: a divergence that cannot be
   * written down cannot be re-introduced by the next hand patch. What legally
   * varies between the seams is passed in: which object is read, which package
   * id is stamped (both resolve to the SAME owning package — a nested plugin
   * contributes under its parent's ownership), and the label the `debug` line
   * names the source with.
   *
   * @param source   The manifest or nested-plugin config to read collections from.
   * @param ownerId  The owning package id — stamped as ADR-0010 provenance.
   * @param sourceLabel Human-readable source name for the `debug` line.
   */
  static registerMetadataCollections(this: Pick<RegistrationHost, '_registry' | 'logger'>, source: any, ownerId: string, sourceLabel: string, ownerVersion?: string) {
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

  /**
   * Hand a freshly-registered driver the ADR-0104 media arm — the kernel→driver
   * supply seam (#15989, sequencing step 2 of ADR-0104's 2026-09-05 addendum).
   *
   * ## Why here, and why a closure rather than a value
   *
   * `registerDriver` is the one funnel every driver this engine will ever
   * route to passes through, and it is early: the resolver is installed before
   * `init()` connects and long before schema sync calls `initObjects`, which
   * is where a SQL driver asks the closure exactly once and freezes the
   * answer. A VALUE could not be supplied here at all — the fact lives in a
   * `sys_migration` row this very driver has not connected to yet — so what is
   * handed over is the question, not the answer.
   *
   * ## Duck-typed, and silent when the driver has no such seam
   *
   * A driver with no media arm (memory, mongodb, a third-party one) exposes no
   * `setFileColumnsMovedResolver` and is left alone. That is not a degradation
   * to report: a driver that never asks the question keeps whatever encoding
   * it always had.
   *
   * ## ⛔ A host declaration WINS — this only ever fills an empty slot
   *
   * If the host passed `fileColumnsMoved` to the driver's own config, the
   * driver refuses this resolver and says so on its own terms. The asymmetry
   * is deliberate and the safety argument runs one way only: a host that
   * declared `true` while the ledger says otherwise is a host that knows
   * something about its own storage that the ledger does not yet record, and
   * the engine silently overruling it to `false` would have the driver write
   * JSON into columns that have already been retyped. The reverse — the engine
   * overruling a declared `false` to `true` — writes bare ids into a JSON
   * column, which is the failure direction the whole mechanism exists to
   * prevent. Neither is acceptable, so the more specific authority wins and
   * the engine never contradicts an explicit composition.
   */
  static supplyFileColumnsMovedResolver(this: Pick<RegistrationHost, 'haveFileColumnsMoved' | 'logger'>, driver: IDataDriver): void {
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

  /** The body of `ObjectQL#unregisterDriver`; the method's docblock there is its contract. */
  static unregisterDriver(this: Pick<RegistrationHost, 'datasourceDefs' | 'defaultDriver' | 'drivers' | 'logger'>, name: string): boolean {
    const removed = this.drivers.delete(name);
    // Cleared regardless of `removed`: a datasource that never connected has a
    // def and no driver, so keying this off the driver entry would strand
    // exactly the rows a failed datasource leaves behind.
    this.datasourceDefs.delete(name);
    if (this.defaultDriver === name) {
      this.defaultDriver = null;
      this.logger.info(
        'Evicted the DEFAULT driver — this engine has no default until one is registered',
        { driverName: name },
      );
    }
    if (removed) this.logger.info('Unregistered driver', { driverName: name });
    return removed;
  }

  /** The body of `ObjectQL#registerDatasourceDef`; the method's docblock there is its contract. */
  static registerDatasourceDef(this: Pick<RegistrationHost, 'applyExternalDriverFloor' | 'datasourceDefs'>, def: DatasourceDef): void {
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

  /**
   * [#27277] Put the registered driver of datasource `name` behind the engine's
   * correctness floor when its definition calls for one, or take it back out
   * when a later definition no longer does (`external-driver-floor.ts`).
   *
   * Called from both doors — {@link registerDriver} and
   * {@link registerDatasourceDef} — because either can come first. The floored
   * driver REPLACES the entry in `drivers`, once, so every reader of the map
   * (`getDriver`, `getDriverByName`, the default-driver and transaction-scope
   * identity checks) holds one instance.
   */
  static applyExternalDriverFloor(this: Pick<RegistrationHost, '_registry' | 'datasourceDefs' | 'drivers' | 'logger'>, name: string): void {
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

  /** The body of `ObjectQL#listDatasourceDefs`; the method's docblock there is its contract. */
  static listDatasourceDefs(this: Pick<RegistrationHost, 'datasourceDefs'>): DatasourceDef[] {
    return Array.from(this.datasourceDefs, ([name, def]) => ({
      name,
      ...(def.driver !== undefined ? { driver: def.driver } : {}),
      ...(def.schemaMode !== undefined ? { schemaMode: def.schemaMode } : {}),
      ...(def.external ? { external: { ...def.external } } : {}),
    }));
  }

  /** The body of `ObjectQL#markDatasourceUnavailable`; the method's docblock there is its contract. */
  static markDatasourceUnavailable(this: Pick<RegistrationHost, 'unavailableDatasources'>, info: { name: string; kind: DatasourceUnavailableKind; publicDetail?: string }): void {
    if (!info?.name) return;
    this.unavailableDatasources.set(info.name, {
      kind: info.kind,
      ...(info.publicDetail ? { publicDetail: info.publicDetail } : {}),
    });
  }

  /** The body of `ObjectQL#clearDatasourceUnavailable`; the method's docblock there is its contract. */
  static clearDatasourceUnavailable(this: Pick<RegistrationHost, 'unavailableDatasources'>, name: string): void {
    this.unavailableDatasources.delete(name);
  }

  /** The body of `ObjectQL#getDefaultDriverName`; the method's docblock there is its contract. */
  static getDefaultDriverName(this: Pick<RegistrationHost, 'defaultDriver'>): string | undefined {
    return this.defaultDriver ?? undefined;
  }

  /** The body of `ObjectQL#listUnavailableDatasources`; the method's docblock there is its contract. */
  static listUnavailableDatasources(this: Pick<RegistrationHost, 'unavailableDatasources'>): Array<{ name: string } & DatasourceUnavailableInfo> {
    return Array.from(this.unavailableDatasources, ([name, info]) => ({ name, ...info }));
  }

  /**
   * Write gate — Gate 3 of ADR-0015 §5.3.
   *
   * Blocks insert/update/delete against a federated datasource
   * (`schemaMode !== 'managed'`) unless BOTH the datasource opts in
   * (`external.allowWrites`) AND the object opts in (`external.writable`).
   * Managed datasources (the common case, including the absence of any
   * definition) are unaffected.
   */
  static assertWriteAllowed(this: Pick<RegistrationHost, '_registry' | 'datasourceDefs'>, objectName: string, operation: 'insert' | 'update' | 'delete'): void {
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
}
