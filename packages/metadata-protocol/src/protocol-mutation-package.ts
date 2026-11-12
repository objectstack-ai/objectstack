// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32451, ADR-0150 D4/D8] The `packageId` coordinate of a
 * {@link MetadataMutationEvent}: how a producer stamps it, and how a receiver
 * reads it. The epic ruling on #32451 fixes both readings:
 *
 * - a producer stamps the binding its write RESOLVED, through
 *   `boundPackageOf`: a package id, or `null` for a row bound to no package
 *   (the store's `''` and `'sys_metadata'` spellings of "none" included);
 * - a receiver judges absence by `=== undefined`, never by key presence (a key
 *   carrying `undefined` over an in-process bus is absent, as it is after a
 *   JSON hop); `null`, `''` and `'sys_metadata'` read as "no package"; any
 *   other non-string value reads as absent, never as a package.
 *
 * Not re-exported: the event's docblock is the published contract.
 */

import { boundPackageOf } from './protocol-package-bindings.js';
import { overlayMemberWhere } from './migrations/overlay-index.js';
import type { MetadataMutationEvent } from './protocol-mutation-events.js';
import type { ProtocolHost } from './protocol-host.js';

/** The event's `packageId` for a row the write resolved as bound to `packageId` (`null`: no package). */
export function mutationEventPackage(packageId: unknown): { packageId: string | null } {
    return { packageId: boundPackageOf(packageId) ?? null };
}

/**
 * The binding a received event names: a package id, `null` (a row known to be
 * bound to no package), or `undefined` (the producer did not say).
 */
export function inboundMutationPackage(evt: Pick<MetadataMutationEvent, 'packageId'>): string | null | undefined {
    const value: unknown = evt.packageId;
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value !== 'string') return undefined;
    return boundPackageOf(value) ?? null;
}

/**
 * [#32451, ruling Q2-A] The distinct bindings of the active rows at
 * `(type, name, member)`, sorted, `null` (no package) last: what an unstamped
 * signal's peer counts before it converges by name. One read, every row,
 * never the first one.
 */
export async function activeRowBindings(
    host: Pick<ProtocolHost, 'findEnvironmentRows'>,
    type: string,
    name: string,
    member: string | undefined,
): Promise<Array<string | null>> {
    const rows = await host.findEnvironmentRows('sys_metadata', {
        where: { type, name, state: 'active', ...overlayMemberWhere(type, member) },
        fields: ['id', 'package_id'],
        // Platform plumbing, as the repository's own reads.
        context: { isSystem: true },
    });
    const packages = new Set<string>();
    let unbound = false;
    for (const row of (rows ?? []) as ReadonlyArray<{ package_id?: unknown }>) {
        const bound = boundPackageOf(row?.package_id);
        if (bound === undefined) unbound = true;
        else packages.add(bound);
    }
    return [...[...packages].sort(), ...(unbound ? [null] : [])];
}

/**
 * [#32451, ruling Q2-A] The one `error` line of a peer that stops converging an
 * unstamped signal (a writer that predates `packageId`) because several
 * bindings hold active rows of the address: the consequence, then the fix.
 */
export function unstampedSignalStoppedMessage(
    type: string,
    name: string,
    member: string | undefined,
    bindings: ReadonlyArray<string | null>,
): string {
    const item = `${type} '${name}'${member !== undefined ? ` (member '${member}')` : ''}`;
    const holders = bindings.map((b) => (b === null ? 'no package' : `'${b}'`)).join(', ');
    return `[Protocol] cluster metadata convergence stopped for ${item}: the peer's signal names no package `
        + `(a replica running an earlier release wrote it), and ${bindings.length} bindings hold active rows of `
        + `this address (${holders}), so this replica cannot tell which row changed and reads none of them. It keeps `
        + 'serving the entry it held, which may be another package\'s item than the one the writer serves, and keeps '
        + 'looking healthy. To converge it, re-save the item from an upgraded replica, or restart this replica; the '
        + 'next cluster resync re-reads it too.';
}
