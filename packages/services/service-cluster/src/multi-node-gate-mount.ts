// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Route-independent mounting of the multi-node authorization gate (#13537).
 *
 * ## The defect this closes
 *
 * `registerMultiNodeGate` used to be reachable from exactly ONE place: the EE
 * app config (`apps/objectos-ee/objectstack.config.ts`, cloud repo) calling it
 * while that file executes. Any boot route on which that file does not execute
 * — a thin-extension host app whose own config runs instead, or the
 * `OS_ARTIFACT_URL` artifact-direct route where no config executes at all —
 * skipped registration entirely, and the gate's then-default of allow turned
 * "the config didn't run" into "multi-node is permitted" on a licensed
 * capability. Measured on a real thin-extension EE deployment: a `maxNodes: 1`
 * trial license booted 3 replicas with full cluster coordination and no
 * warning (cloud#1752).
 *
 * ## The repair, and where each half lives
 *
 * 1. The gate's no-registration default now fails closed for a declared
 *    multi-node topology (`multi-node-gate.ts`, same card).
 * 2. This module makes registration reachable on EVERY route: the boot
 *    surface that is about to consult the gate (`os serve`; cloud's hosted
 *    runtime may do the same) hands over its host importer, and this helper
 *    loads the distribution packages that carry the gate. A carrier registers
 *    at its own module load, so merely being imported mounts the gate — no
 *    app config file needs to execute.
 *
 * ## Why the importer is a PARAMETER
 *
 * The carrier packages are distribution-shipped and app-declared: they live in
 * the served app's `node_modules`, never in this package's or the CLI's own
 * (#4719 — what the host root declares is the contract). The only correct way
 * to reach them is the caller's host-anchored importer, so this helper takes
 * that importer instead of owning any resolution of its own. It never falls
 * back to a bare `import()` — an absent carrier is a normal open-core state,
 * reported, not worked around.
 *
 * ## ⚠️ Effectiveness boundary — the dual-instance split (#13330) stands
 *
 * This registry is module-level singleton state, not `globalThis`-anchored. A
 * carrier whose own `@objectstack/service-cluster` import resolves to a
 * DIFFERENT module instance than the one the boot surface consults registers
 * into the wrong registry, and `hasMultiNodeGate()` here honestly reports
 * "not registered" — the attempt is recorded as `loaded-without-gate` rather
 * than papered over. Fixing that split is #13330's job for the registry class
 * generally; this module deliberately does not anchor one registry by hand.
 * Until it lands, the fail-closed default means a mis-anchored registration is
 * refused loudly instead of running unlicensed silently — and on a deployment
 * that declared multi-node, "refused" means the boot stops (see the gate
 * module's boot-outcome note). ⛔ Not a quiet single-node degrade.
 */

import { hasMultiNodeGate } from './multi-node-gate.js';

/**
 * The distribution packages a boot surface loads to mount the gate, in the
 * order they are tried. Both are `plugins[]`-wired enterprise runtimes the
 * spec roster declares (`PLATFORM_PLUGIN_WIRED_RUNTIMES`,
 * `@objectstack/spec`) — i.e. real, closed-source, licensed-route packages,
 * not fabricated names (#10921). The list is owned HERE, not derived from
 * that roster: the roster records provenance and is by its own contract not a
 * resolution registry; a drift test keeps the two agreeing.
 *
 * A carrier's obligation is: **register the gate as a side effect of module
 * load** (`registerMultiNodeGate` at module scope), so that being imported —
 * by any route — is sufficient to mount it.
 */
export const MULTI_NODE_GATE_CARRIER_PACKAGES: readonly string[] = Object.freeze([
    '@objectstack/security-enterprise',
    '@objectstack/organizations',
]);

/** One carrier import attempt, for the caller's diagnostics. */
export interface MultiNodeGateMountAttempt {
    /** The carrier package specifier that was imported. */
    package: string;
    /**
     * - `registered` — after this import, a gate is registered (mount done;
     *   later carriers are not tried).
     * - `loaded-without-gate` — the import succeeded but no gate appeared on
     *   this module instance: the carrier predates module-load registration,
     *   or its registration landed on another instance (#13330).
     * - `unavailable` — the import failed (not installed, not declared by the
     *   host, or it threw while evaluating); `error` carries the message.
     */
    outcome: 'registered' | 'loaded-without-gate' | 'unavailable';
    /** The import failure, when `outcome` is `unavailable`. */
    error?: string;
}

/** What {@link mountMultiNodeGateFromHost} did, and what state it left. */
export interface MultiNodeGateMountReading {
    /** A gate was already registered before any carrier import — nothing tried. */
    alreadyRegistered: boolean;
    /** A gate is registered (on this module instance) as this reading returns. */
    registered: boolean;
    /** The carrier imports attempted, in order. Empty when `alreadyRegistered`. */
    attempts: readonly MultiNodeGateMountAttempt[];
}

/**
 * Mount the distribution's multi-node gate on whatever boot route is running,
 * by importing the known carrier packages through the CALLER's host importer.
 *
 * Best-effort by contract: never throws. An absent carrier is the normal
 * open-core state; with the gate's fail-closed default, "nothing mounted"
 * resolves to a refused multi-node verdict at the consult that follows, so
 * this helper does not need to be loud on its own.
 *
 * @param importFromHost - the boot surface's host-anchored importer (#4719):
 *   resolves a bare package specifier from the SERVED APP's declaration, the
 *   only base the distribution packages are installed under.
 */
export async function mountMultiNodeGateFromHost(
    importFromHost: (specifier: string) => Promise<unknown>,
): Promise<MultiNodeGateMountReading> {
    if (hasMultiNodeGate()) {
        return { alreadyRegistered: true, registered: true, attempts: [] };
    }

    const attempts: MultiNodeGateMountAttempt[] = [];
    for (const carrier of MULTI_NODE_GATE_CARRIER_PACKAGES) {
        try {
            // Called one specifier at a time, deliberately — never mapped over
            // the importer, whose optional extra parameters (e.g. a host root)
            // must not receive an array index.
            await importFromHost(carrier);
        } catch (err) {
            attempts.push({
                package: carrier,
                outcome: 'unavailable',
                error: err instanceof Error ? err.message : String(err),
            });
            continue;
        }
        if (hasMultiNodeGate()) {
            attempts.push({ package: carrier, outcome: 'registered' });
            return { alreadyRegistered: false, registered: true, attempts };
        }
        attempts.push({ package: carrier, outcome: 'loaded-without-gate' });
    }
    return { alreadyRegistered: false, registered: hasMultiNodeGate(), attempts };
}
