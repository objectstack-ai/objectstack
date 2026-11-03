// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25522 cut 17] The package registration bodies of `ObjectQL` that a
 * registration door shares: `convertPackageBodyForward` (ADR-0087 D2's forward
 * conversion of a package body that declares its protocol range),
 * `registerPlugin` (a nested plugin's objects, plugin-as-app and stack
 * collections, registered under the parent package) and
 * `resolveNavObjectNames` (the navigation `objectName` resolution both
 * registration seams run), moved out of `engine.ts`.
 *
 * A MOVE, not a redesign. Each exported function below is the body of the
 * `ObjectQL` method of the same name as it stood, re-indented one level and
 * otherwise unedited. Each method's docblock stays on the method in
 * `engine.ts`, which is still the contract.
 *
 * ## How the moved bodies reach the class
 *
 * The shape #23050 set for `rest-server.ts`, applied as
 * `engine-driver-options.ts` applies it. The class keeps each method with
 * name, modifiers, signature, docblock and position; its body becomes one
 * literal of exactly the {@link PackageRegistrationHost} members it reads,
 * plus a `.call`. The fields read (`registrationConversionWarned`, `logger`,
 * `_registry`) go as GETTERS, so each read happens when the body makes it, as
 * it did; no body assigns a field. The methods called
 * (`resolveNavObjectNames`, `registerMetadataCollections`) go as late-bound
 * closures over the instance, so a double or spy set on the engine is still
 * the one a call reaches. `registerApp`, `registerMetadataCollections` and
 * `registerDriver` stay in the class: the first and last are public with an
 * inferred return type, and `registerMetadataCollections` is named by path
 * as a producer in `packages/spec/liveness/`.
 *
 * ## Module helpers
 *
 * Two helpers are read by `registerPlugin` AND by bodies that stay:
 * `stampObjectPackage` (`registerApp`) and `stampPackage` (`registerApp`,
 * `registerMetadataCollections`, `stampObjectPackage`). One home each: they
 * stay declared in `engine.ts`, exported in place, and are imported here,
 * never copied. Nothing re-exports them from the package entry, so the
 * published surface does not move. [#28697] Two more follow the same rule:
 * `packageBodyObjectAndAppOwnerStampRefusal` and `registerAppNotingStamp`
 * (`registerApp` and `registerPlugin`); the plugin-as-app now reaches
 * `stampPackage` through `registerAppNotingStamp`, so this module no longer
 * imports `stampPackage` itself.
 *
 * That import is a run-time module cycle (`engine.ts` imports this module,
 * this module imports `engine.ts`). Nothing here runs at module evaluation,
 * only declarations, and `engine.ts` imports this module after every module
 * this one imports, so the engine's evaluation order is what it was. The
 * published build bundles both files into one, where the cycle does not
 * exist.
 */

import type { ServiceObject } from '@objectstack/spec/data';
import { applyArtifactForwardConversions, resolveDeclaredRange } from '@objectstack/metadata-core';
import { computeFQN } from './registry.js';
import {
  packageBodyObjectAndAppOwnerStampRefusal,
  registerAppNotingStamp,
  stampObjectPackage,
} from './engine.js';
import type { ObjectQL } from './engine.js';

/**
 * The `ObjectQL` members the functions below read — every one of them, and no
 * other; each function's `this` is the `Pick` of the members IT reads. Each is
 * typed AS the class member (an indexed access on the class), so a change to a
 * member's type on the class is a change here too, and naming a member the
 * class does not have is a compile error. See the module header for which
 * members are getters, and which one also has a setter.
 */
export interface PackageRegistrationHost {
  readonly registrationConversionWarned: ObjectQL['registrationConversionWarned'];
  readonly logger: ObjectQL['logger'];
  readonly _registry: ObjectQL['_registry'];
  resolveNavObjectNames: ObjectQL['resolveNavObjectNames'];
  registerMetadataCollections: ObjectQL['registerMetadataCollections'];
}

/** The body of `ObjectQL#convertPackageBodyForward`; the method's docblock there is its contract. */
export function convertPackageBodyForward(
  this: Pick<PackageRegistrationHost, 'registrationConversionWarned' | 'logger'>,
  body: any,
): any {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
    if (resolveDeclaredRange(body) === null) return body;
    const result = applyArtifactForwardConversions(body);
    if (result.notices.length === 0) return result.definition;

    const id = String(body.id || body.name || '(unnamed)');
    const byConversion = new Map<string, { count: number; firstPath: string; message: string }>();
    for (const n of result.notices) {
        const existing = byConversion.get(n.conversionId);
        if (existing) existing.count += 1;
        else byConversion.set(n.conversionId, { count: 1, firstPath: n.path, message: n.message });
    }
    const retiredAfter = new Map(result.replayedRetirements.map((r) => [r.conversionId, r.retiredAfter]));
    for (const [conversionId, agg] of byConversion) {
        const key = `${id}|${conversionId}`;
        if (this.registrationConversionWarned.has(key)) continue;
        this.registrationConversionWarned.add(key);
        const pastFloor = retiredAfter.get(conversionId);
        this.logger.warn(
            `[ObjectQL] package '${id}' registered with declared protocol floor ${result.authoredFloor ?? '(unreadable)'} `
            + `on @objectstack/spec ${result.runtimeSpecVersion ?? '(unknown)'} (${result.verdict}) — ADR-0087 conversion `
            + `'${conversionId}'${pastFloor !== undefined ? ` (a retirement this runtime enforces past the body's floor; the shape was last accepted by @objectstack/spec ${pastFloor})` : ''} `
            + `converted ${agg.count} site(s) forward (first at ${agg.firstPath}). ${agg.message} `
            + `The installed body itself is unchanged, so it converts again at every registration until the package `
            + `is rebuilt ('os build') and re-published with tooling from a release that ships this retirement.`,
        );
    }
    return result.definition;
}

/** The body of `ObjectQL#resolveNavObjectNames`; the method's docblock there is its contract. */
export function resolveNavObjectNames(
  app: any,
  namespace: string,
): any {
    if (!app.navigation) return app;

    const resolveItems = (items: any[]): any[] =>
        items.map((item: any) => {
            const resolved = { ...item };
            if (resolved.objectName && !resolved.objectName.includes('__')) {
                resolved.objectName = computeFQN(namespace, resolved.objectName);
            }
            if (Array.isArray(resolved.children)) {
                resolved.children = resolveItems(resolved.children);
            }
            return resolved;
        });

    return { ...app, navigation: resolveItems(app.navigation) };
}

/** The body of `ObjectQL#registerPlugin`; the method's docblock there is its contract. */
export function registerPlugin(
  this: Pick<PackageRegistrationHost, 'logger' | '_registry' | 'resolveNavObjectNames' | 'registerMetadataCollections'>,
  plugin: any,
  parentId: string,
  parentNamespace?: string,
  parentVersion?: string,
) {
    // `parentVersion` is the owning package's version, stamped like `parentId`.
    const pluginName = plugin.name || plugin.id || 'unnamed';
    const pluginNamespace = plugin.namespace || parentNamespace;

    // Use parentId as the owning package for namespace consistency.
    // The parent package already claimed the namespace — nested plugins
    // contribute objects UNDER the parent's ownership.
    const ownerId = parentId;

    // [#28697] The owner-stamp refusal for the objects and the plugin-as-app
    // below, before anything of the plugin registers and outside the two
    // `try` blocks, which log a registry failure and go on: a body stamp is
    // refused as the collection seam refuses it, not logged past.
    {
        const refusal = packageBodyObjectAndAppOwnerStampRefusal(plugin, ownerId, {
            apps: false,
            selfAsApp: Boolean(plugin.name && plugin.navigation),
        });
        if (refusal) throw refusal;
    }

    // Register objects (supports both Array and Map formats)
    if (plugin.objects) {
        try {
            if (Array.isArray(plugin.objects)) {
                this.logger.debug('Registering plugin objects (Array)', { pluginName, count: plugin.objects.length });
                for (const objDef of plugin.objects) {
                    const fqn = this._registry.registerObject(stampObjectPackage(objDef, ownerId, parentVersion), ownerId, pluginNamespace, 'own');
                    this.logger.debug('Registered Object', { fqn, from: pluginName });
                }
            } else {
                // Same contract statement as the manifest map branch above —
                // authored `ServiceObject`s (INPUT shape, ADR-0122 phase 2).
                const entries = Object.entries(plugin.objects) as [string, ServiceObject][];
                this.logger.debug('Registering plugin objects (Map)', { pluginName, count: entries.length });
                for (const [name, objDef] of entries) {
                    objDef.name = name;
                    const fqn = this._registry.registerObject(stampObjectPackage(objDef, ownerId, parentVersion), ownerId, pluginNamespace, 'own');
                    this.logger.debug('Registered Object', { fqn, from: pluginName });
                }
            }
        } catch (err: any) {
            this.logger.warn('Failed to register plugin objects', { pluginName, error: err.message });
        }
    }

    // Register plugin as app if it has navigation (for sidebar display)
    if (plugin.name && plugin.navigation) {
        try {
            const resolved = pluginNamespace ? this.resolveNavObjectNames(plugin, pluginNamespace) : plugin;
            registerAppNotingStamp(this._registry, resolved, ownerId, parentVersion);
            this.logger.debug('Registered plugin-as-app', { app: plugin.name, from: pluginName });
        } catch (err: any) {
            this.logger.warn('Failed to register plugin as app', { pluginName, error: err.message });
        }
    }

    // Register metadata arrays (actions, views, triggers, etc.) through the
    // SAME seam the manifest path uses — same stamping seam, one level down: a
    // nested plugin's declarations must carry the parent package's ADR-0010
    // provenance too, or the declared-≠-enforced hole reopens for packages
    // that ship a collection from a nested plugin (`capabilities` #5870;
    // `jobs` / `emailTemplates` / `tools` / `skills` #7049, which is why the
    // list is no longer copied here to be patched one name at a time; the
    // aggregated-view expansion, #7163, for why the loop BODY is no longer
    // copied here either).
    this.registerMetadataCollections(plugin, ownerId, 'nested plugin', parentVersion);
}
