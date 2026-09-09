// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The artifact→enforcer seam: bind the install-time GRANTED permission set an
 * environment artifact carries to the plugins that artifact materializes
 * (ADR-0025 §3.5 step 2 / F4, #11333 option A phase 1).
 *
 * ## What this is the consumer half of
 *
 * `EnvironmentArtifactSchema.grantedPermissions`
 * (`packages/spec/src/system/environment-artifact.zod.ts`) names its consumer
 * verbatim: *"the materialize-time loader, which hands each entry to
 * `PluginPermissionEnforcer.registerGrantedPermissions(pluginName, granted)`"*.
 * This module is that loader half, and `AppPlugin.init()` is its one production
 * caller — the single point where an environment artifact becomes a kernel
 * plugin, on the self-hosted path (`createStandaloneStack`) and on the cloud
 * path (`ArtifactKernelFactory`, which constructs the same `AppPlugin`) alike.
 *
 * ## The binding this creates, and why it did not exist before
 *
 * The map is keyed by the PLUGIN MANIFEST `id` — `com.acme.crm`, the name
 * `artifactPackageId()` gives a package and the name the enforcer is queried
 * with. One `AppPlugin` covers the WHOLE artifact and registers under a single
 * kernel plugin name derived from `manifest.id`, so before this module nothing
 * in the load path could say which of an artifact's packages a given grant
 * entry belonged to. The walk below is that key-to-plugin binding: it resolves
 * the artifact's carried package ids through the platform's one package sorter
 * (`resolveArtifactPackageOrder`, ADR-0130 D4/D5) and registers each entry
 * under the id the sorter names, so a grant entry is bound to a package the
 * artifact actually carries or it is bound to nothing and said so out loud.
 *
 * ## ⛔ Absent is NOT `{}`, in BOTH directions — three states, never two
 *
 * The producer pins all three and the contract forbids collapsing them, so the
 * walk below is driven by the map's OWN KEYS and never by the package list:
 *
 *   1. the artifact carries NO `grantedPermissions` key — no consent record
 *      exists for this environment (first-party stacks, pure-metadata packages,
 *      every artifact built before consent existed). ⇒ NOTHING is registered,
 *      no enforcer is even constructed, and every package loads exactly as it
 *      does today. `declared: false`.
 *   2. the key is present and names this package with `{}` — a consent record
 *      that consented to NOTHING. ⇒ registered, and `buildPermissionsFromGrants`
 *      turns it into a bag that denies every service, hook, host and path.
 *   3. the key is present and does NOT name this package — same as (1) FOR
 *      THAT PACKAGE: no entry, no registration, nothing on the enforcer.
 *
 * ⛔ The tempting spelling — `for (const id of carried)
 * enforcer.registerGrantedPermissions(id, grants[id])` — collapses (3) into (2)
 * silently: `registerGrantedPermissions(id, undefined)` registers a DENY-ALL
 * bag, so every first-party plugin in the artifact would come up denied. That
 * is the boot brick clause 1.3 exists to forbid, and it is one keystroke away
 * from the loop below. Read the keys, never the packages.
 *
 * ## What this does NOT do
 *
 * It registers the consented set; it does not intercept access. Every
 * enforcement surface `PluginPermissionEnforcer` exposes is reached through
 * `SecurePluginContext` — per-plugin context construction, i.e. the ADR-0025
 * materialize seam, which is not this module's to improvise. So an entry
 * registered here is queried by nothing on this tree yet; the binding is the
 * half that had to exist first, and the registry it fills is the thing the
 * materialize seam reads.
 */

import {
    artifactPackageId,
    resolveArtifactPackageOrder,
    type PluginPermissionEnforcer,
} from '@objectstack/core';
import type { Logger } from '@objectstack/spec/contracts';
import type { PluginPermissions as GrantedPermissions } from '@objectstack/spec/kernel';

/** What one artifact's granted-permission map bound to. */
export interface ArtifactGrantBinding {
    /**
     * Did the artifact carry a `grantedPermissions` key at all? `false` is
     * state (1) above — no consent record — and is NOT the same reading as a
     * declared but empty map, which is `true` with an empty {@link registered}.
     */
    readonly declared: boolean;
    /** Package ids this artifact carries, in the order the loader registers them. */
    readonly carried: readonly string[];
    /**
     * Ids that carried a consent record — the set
     * {@link registerArtifactGrantedPermissions} registers on the enforcer, one
     * `registerGrantedPermissions` call each.
     *
     * ⛔ The name says REGISTERED, and must keep saying it. An earlier spelling
     * called this `gated`, which claimed an enforcement that does not exist:
     * registration is ALL that happens here, nothing on this tree queries the
     * registry, and so an id in this list is under no gate whatsoever. Rename it
     * back only together with the code that makes the claim true.
     */
    readonly registered: readonly string[];
    /**
     * Carried ids with NO consent record — nothing is registered for them, and
     * they load byte-for-byte as they do today.
     */
    readonly unregistered: readonly string[];
    /**
     * Map keys naming a package this artifact does NOT carry. The producer pins
     * that this is empty (*"the map never names a plugin the artifact does not
     * carry"*), so a non-empty list is a carrier fault: a consented set that
     * binds to nothing is a security control silently absent.
     */
    readonly unbound: readonly string[];
}

const EMPTY: ArtifactGrantBinding = {
    declared: false, carried: [], registered: [], unregistered: [], unbound: [],
};

/** True for a plain object — the only shape `z.record(...)` produces. */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The package ids one artifact carries, named exactly as the rest of the
 * platform names them.
 *
 * `resolveArtifactPackageOrder` returns each package's manifest BODY for a
 * `packages[]` artifact and the artifact itself for a single-package one, so
 * the id lives at different depths on the two shapes. `body.manifest ?? body`
 * is the same unwrap `AppPlugin`'s constructor performs (`bundle.manifest ||
 * bundle`), which is what keeps this list equal to the names the plugin
 * actually registers under.
 */
export function carriedPackageIds(artifact: unknown): string[] {
    const bodies = resolveArtifactPackageOrder(artifact) as Array<Record<string, unknown> | null | undefined>;
    const out: string[] = [];
    for (const body of bodies) {
        const sys = (body as { manifest?: unknown } | null | undefined)?.manifest ?? body;
        const id = artifactPackageId(sys);
        if (id !== undefined && !out.includes(id)) out.push(id);
    }
    return out;
}

/**
 * Read the artifact's granted-permission map WITHOUT touching an enforcer.
 *
 * Pure, so the three-state distinction above can be pinned on its own, and so
 * the caller can decide whether to construct an enforcer at all.
 */
export function resolveArtifactGrantBinding(artifact: unknown): ArtifactGrantBinding {
    const grants = (artifact as { grantedPermissions?: unknown } | null | undefined)?.grantedPermissions;
    // ⛔ `=== undefined`, never a falsy test: `{}` is a consent record that
    // consented to nothing and must read as DECLARED.
    if (grants === undefined) return EMPTY;
    if (!isPlainRecord(grants)) {
        // Not a shape `z.record(z.string(), PluginPermissionsSchema)` can
        // produce. Reported as declared-with-nothing-bound rather than silently
        // treated as absent: a carrier that ships garbage here is a carrier
        // whose consent records are gone.
        return { declared: true, carried: [], registered: [], unregistered: [], unbound: [] };
    }
    const carried = carriedPackageIds(artifact);
    const registered: string[] = [];
    const unbound: string[] = [];
    // Driven by the MAP's keys — see the header. `Object.keys` reads own
    // enumerable keys only, so nothing on `Object.prototype` can fabricate an
    // entry, and a key present with any value (`{}` included) is an entry.
    for (const key of Object.keys(grants)) {
        if (carried.includes(key)) registered.push(key);
        else unbound.push(key);
    }
    return {
        declared: true,
        carried,
        registered,
        unregistered: carried.filter((id) => !registered.includes(id)),
        unbound,
    };
}

/**
 * Bind an artifact's granted-permission map onto `enforcer`, one
 * `registerGrantedPermissions` call per consent record the artifact carries.
 *
 * @returns What bound — see {@link ArtifactGrantBinding}. On an artifact with no
 *   `grantedPermissions` key this registers nothing and returns `declared:
 *   false`; the enforcer is left exactly as it was handed over.
 */
export function registerArtifactGrantedPermissions(
    artifact: unknown,
    enforcer: PluginPermissionEnforcer,
    opts: { logger?: Logger } = {},
): ArtifactGrantBinding {
    const binding = resolveArtifactGrantBinding(artifact);
    if (!binding.declared) return binding;

    const grants = (artifact as { grantedPermissions?: unknown } | null | undefined)?.grantedPermissions;
    // ⛔ No `?? {}` and no default — both spellings are the erasure this module
    // exists to refuse, and `app-plugin.ts` forbids them by name on this very
    // key. The narrowing below is the type-honest spelling of a fact the walk
    // already established: `registered` is non-empty ONLY on the plain-record
    // branch of `resolveArtifactGrantBinding`, so this reads the carrier's own
    // record or it iterates nothing at all — it never substitutes a stand-in.
    if (isPlainRecord(grants)) {
        for (const id of binding.registered) {
            // The VALUE as the carrier wrote it: `{}` registers a
            // deny-everything bag, a populated entry registers exactly the
            // consented surface.
            enforcer.registerGrantedPermissions(id, grants[id] as GrantedPermissions);
        }
    }

    if (binding.unbound.length > 0) {
        // Absence must be loud (Route & surface ownership §3). This is the
        // "consented set silently fails to bind" failure the artifact contract
        // names as the producer's residual risk; the consumer refuses to let it
        // pass in silence even though it cannot repair it.
        opts.logger?.warn(
            '[grantedPermissions] consent records bound to NO package carried by this artifact — '
            + 'the consented surface for them is enforced nowhere',
            { unbound: [...binding.unbound], carried: [...binding.carried] },
        );
    }
    return binding;
}
