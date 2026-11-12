// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D5, epic child G1] The address grammar of the `/automation`
 * by-name doors: a flow, and a connector instance's connection, are named
 * bare (`/automation/:name/…`, `/automation/connectors/:name/connection`) or
 * qualified, with an installed namespace or the reserved `_env` segment in
 * front of the name:
 *
 *  - `/automation/:ns/:name[/trigger | /toggle | /clone | /runs …]`
 *  - `/automation/trigger/:ns/:name`
 *  - `/automation/connectors/:ns/:name/connection`
 *
 * ## The read: once, before every gate
 *
 * {@link readAutomationAddress} reads the namespace position in the router's
 * documented order (`readNamespacePositionSegment`, `@objectstack/spec/kernel`):
 * the grammar's literals (`trigger`, `hooks`, `connectors`, `actions`,
 * `_status`; `credential-refs` and `oauth` under `connectors`) first, then
 * `_env`, then an installed namespace (the registry's `getNamespaceOwners`,
 * G2's mapping, never a second one), else the bare grammar. An addressed path
 * comes back as the bare path after its qualifier, so every gate of the domain,
 * which reads `parts[]` by position, judges exactly the shape it judged
 * before (seat ruling Q3 = A).
 *
 * A first segment followed by no name is no address: `/automation/:seg` alone
 * keeps its bare reading. A sub-resource literal in the name position keeps
 * its bare route too ({@link AUTOMATION_FLOW_SUBRESOURCE_SEGMENTS}, seat ruling
 * Q1 = A, as the metadata door's): `/automation/crm/runs` is the runs of the
 * flow `crm`, never the flow `runs` of namespace `crm`, so a flow named like an
 * installed namespace keeps every bare door. A flow whose name is one of those
 * sub-resource literals is reached bare, or under `_env`.
 *
 * A qualifier followed by one of the door's own literals
 * ({@link AUTOMATION_DOOR_LITERALS}: `actions`, `_status`, `connectors`,
 * `hooks`, `trigger`) is no address and no bare route: it is declined
 * (`declined`). Stripped, it would hand a literal arm (the catalog, the legacy
 * trigger) a path whose admission was judged against a flow of that name.
 *
 * ## The admission: after the gates, before the service
 *
 * {@link admitAutomationAddress} judges the qualifier against the registry, the
 * holder table the resolver reads, so it is asked only once the caller has
 * passed every gate (a refused caller learns nothing about who holds the name;
 * whether the namespace is installed is read before the gates, so a caller the
 * gates refuse can tell an installed namespace from none, as on every door
 * that reads one):
 *
 *  - a namespace names, among its packages, the ones holding the name. Two —
 *    a shareable namespace's co-owners (ADR-0150 D2) — are refused naming
 *    each (`ambiguous-in-namespace`). None is refused naming the holders there
 *    are (`not-held-by-qualifier`), or answered `404` when nothing holds it:
 *    the metadata door's exact qualifier answers the same (part (a));
 *  - `_env` names the environment's own item, or a name no package holds;
 *    a name only packages hold is refused naming them (`not-held-by-qualifier`).
 *
 * An admitted address serves the bare name's item when the bare name,
 * resolved by the resolver the engine itself asks (`resolvePackageScopedName`,
 * a caller with no package), IS the addressed holder: the address is then its
 * bare path. An environment overlay of package P's flow is P's item (D4),
 * which the bare door already serves, so P's address serves it too.
 *
 * [ADR-0150 D4/D9, #31696] A FLOW name two packages hold (two namespaces may,
 * since the flow's one-holder rule narrowed to the namespace) is refused bare,
 * and the engine holds each holder's flow in its own slot. Its address names
 * one holder, so it is admitted to that holder's slot
 * ({@link AutomationAddressSlot}): the domain serves the door from the slot
 * (`../flow-slot-view.ts`), and from nothing else. The address still narrows
 * the candidates to one holder and never widens what is reached. Any other
 * bare name the address's holder is not is refused with the resolution's
 * candidates.
 *
 * {@link bareNameRefusal} is the same resolution for a bare address: a bare
 * name the resolver refuses is answered `409` naming every candidate (D5), on
 * the doors whose own answer was no such `409`.
 */

import {
    ENVIRONMENT_ADDRESS_SEGMENT,
    NAMESPACE_POSITION_LITERALS,
    readNamespacePositionSegment,
    type AddressDoor,
} from '@objectstack/spec/kernel';
import {
    packageScopedRefusalMessage,
    type PackageScopedHolder,
    type PackageScopedRefusal,
    type PackageScopedResolvableType,
} from '@objectstack/core';
import { resolvePackageScopedName, type PackageScopedRegistry } from '@objectstack/objectql';

/**
 * [ADR-0150 D5, child G1] The literal segments a flow-scoped `/automation` door
 * serves right AFTER the flow's name — `/automation/:name/<segment>…`. The
 * qualified form `/automation/:ns/:name…` puts the name in that position, so a
 * path whose second segment is one of these keeps its bare reading (seat ruling
 * Q1 = A on #31691, the rule `META_ITEM_SUBRESOURCE_SEGMENTS` states for the
 * metadata door). `route-ledger.conformance.test.ts` pins it against the
 * `ROUTE_LEDGER` rows, so a sub-resource a new row adds joins it.
 */
export const AUTOMATION_FLOW_SUBRESOURCE_SEGMENTS: readonly string[] = Object.freeze(['clone', 'runs', 'toggle', 'trigger']);

/**
 * [ADR-0150 D5, child G1] The `/automation` door's own literal segments, read
 * from the one grammar table (`NAMESPACE_POSITION_LITERALS`). After a
 * qualifier they are declined; a bare one-segment `GET` of one is the literal's
 * route (the catalog, `_status`) or a flow of that name, never the bare
 * by-name `409`.
 */
export const AUTOMATION_DOOR_LITERALS: readonly string[] = NAMESPACE_POSITION_LITERALS.automation.literals;

/** The qualifier an addressed `/automation` path carried. */
export type AutomationAddressQualifier =
    | { readonly kind: 'namespace'; readonly namespace: string }
    | { readonly kind: 'environment' };

/** What {@link readAutomationAddress} read off a path. */
export interface AutomationAddressReading {
    /** The path's segments, the qualifier removed: the bare shape every gate reads. */
    readonly parts: string[];
    /** The qualifier, or `undefined` for a bare path. */
    readonly qualifier?: AutomationAddressQualifier;
    /** The item the qualifier names, and its type, for {@link admitAutomationAddress}. */
    readonly item?: { readonly type: 'flow' | 'connector'; readonly name: string };
    /** A qualifier followed by one of the door's literals: no address, no route. */
    readonly declined?: true;
}

/** The slice of the ObjectQL registry the address reads: the namespace table and the holders. */
export interface AutomationAddressRegistry extends Partial<PackageScopedRegistry> {
    getNamespaceOwners?(namespace: string): string[];
}

/** The registry the ObjectQL service holds, or `undefined` when it holds none that can answer. */
export function automationAddressRegistryOf(ql: unknown): AutomationAddressRegistry | undefined {
    const registry = (ql as { registry?: AutomationAddressRegistry } | null | undefined)?.registry;
    return registry && typeof registry === 'object' ? registry : undefined;
}

function readSegment(door: AddressDoor, segment: string, registry: AutomationAddressRegistry | undefined): AutomationAddressQualifier | undefined {
    const reading = readNamespacePositionSegment(door, segment, (ns) =>
        typeof registry?.getNamespaceOwners === 'function' && (registry.getNamespaceOwners(ns) ?? []).length > 0);
    if (reading.reading === 'environment') return { kind: 'environment' };
    if (reading.reading === 'namespace') return { kind: 'namespace', namespace: reading.namespace };
    return undefined;
}

/** A connector segment as its door decodes it; an escape that does not decode stays raw (it names nothing). */
function decodedSegment(segment: string): string {
    try {
        return decodeURIComponent(segment);
    } catch {
        return segment;
    }
}

/**
 * Read the address of an `/automation` path (segments after `/automation`).
 * See the module note: the grammar's literals first, then `_env`, then an
 * installed namespace; a path with no qualifier comes back unchanged.
 */
export function readAutomationAddress(parts: readonly string[], registry: AutomationAddressRegistry | undefined): AutomationAddressReading {
    const bare = { parts: [...parts] };
    if (parts.length === 0) return bare;
    // `/automation/trigger/:ns/:name` — the legacy trigger door's qualified form.
    if (parts[0] === 'trigger') {
        if (parts.length !== 3) return bare;
        const qualifier = readSegment('automationTrigger', parts[1], registry);
        return qualifier
            ? { parts: ['trigger', parts[2]], qualifier, item: { type: 'flow', name: parts[2] } }
            : bare;
    }
    // `/automation/connectors/:ns/:name/connection` — the connection door's.
    if (parts[0] === 'connectors') {
        if (parts.length !== 4 || parts[3] !== 'connection') return bare;
        const qualifier = readSegment('connectors', parts[1], registry);
        return qualifier
            ? { parts: ['connectors', parts[2], 'connection'], qualifier, item: { type: 'connector', name: decodedSegment(parts[2]) } }
            : bare;
    }
    // A first segment with no name after it is no address.
    if (parts.length < 2) return bare;
    const qualifier = readSegment('automation', parts[0], registry);
    if (!qualifier) return bare;
    // A sub-resource literal in the name position keeps its bare route after a
    // namespace (ruling Q1).
    if (qualifier.kind === 'namespace' && AUTOMATION_FLOW_SUBRESOURCE_SEGMENTS.includes(parts[1])) return bare;
    // One of the door's own literals after a qualifier is no address.
    if (AUTOMATION_DOOR_LITERALS.includes(parts[1])) return { ...bare, declined: true };
    return { parts: parts.slice(1), qualifier, item: { type: 'flow', name: parts[1] } };
}

/** A refusal of an address: the `404` of a name nothing there holds, or a `409` naming every candidate. */
export type AutomationAddressRefusal =
    | { readonly status: 404; readonly message: string }
    | { readonly status: 409; readonly refusal: PackageScopedRefusal };

/**
 * [ADR-0150 D4/D9, #31696] An address admitted to one holder's slot: the flow
 * name is one two packages hold, which the bare doors refuse (`refusal`), and
 * the address names `packageId`, one of them. The domain serves it from that
 * package's slot, or answers `refusal` where it cannot (a door that writes the
 * definition, an engine with no slot entries).
 */
export interface AutomationAddressSlot {
    readonly status: 'slot';
    readonly packageId: string;
    readonly refusal: PackageScopedRefusal;
}

function refused(
    reason: PackageScopedRefusal['reason'],
    type: 'flow' | 'connector',
    name: string,
    callerPackageId: string | null,
    candidates: readonly PackageScopedHolder[],
): AutomationAddressRefusal {
    const base = {
        status: 'refused' as const,
        reason,
        type: type as PackageScopedResolvableType,
        name,
        callerPackageId,
        candidates,
    };
    return { status: 409, refusal: { ...base, message: packageScopedRefusalMessage(base) } };
}

/** [#32183] The served holders; `options` reaches the registry's read as given. */
function holdersOf(
    registry: AutomationAddressRegistry, type: string, name: string,
    options?: { includeDisabledPackages?: boolean },
): string[] {
    return typeof registry.packageScopedHoldersOf === 'function' ? registry.packageScopedHoldersOf(type, name, null, options) ?? [] : [];
}

function canResolve(registry: AutomationAddressRegistry): registry is AutomationAddressRegistry & PackageScopedRegistry {
    return typeof registry.packageScopedHoldersOf === 'function'
        && typeof registry.getPackageScopedItem === 'function'
        && typeof registry.getEnvironmentScopedItem === 'function';
}

/**
 * The bare name's refusal: the resolver the engine asks, for a caller with no
 * package (`resolvePackageScopedName`), refuses `name` — two packages hold
 * it — or `undefined` when it resolves, names nothing, or the registry cannot
 * answer. Read-only.
 */
export function bareNameRefusal(
    registry: AutomationAddressRegistry | undefined,
    type: 'flow' | 'connector',
    name: string,
): PackageScopedRefusal | undefined {
    if (!registry || !canResolve(registry)) return undefined;
    const resolution = resolvePackageScopedName(registry, { type, name, callerPackageId: null });
    return resolution.status === 'refused' ? resolution : undefined;
}

/**
 * Judge an addressed path's qualifier (see the module note). `undefined`
 * admits it: the path is then served as its bare path, whose item is the
 * address's. An {@link AutomationAddressSlot} admits it to one holder's slot
 * of a flow name two packages hold. A registry that cannot answer admits
 * nothing it could not judge: a namespace was read through it, so it answers;
 * `_env` with no registry is the bare path.
 */
export function admitAutomationAddress(
    registry: AutomationAddressRegistry | undefined,
    qualifier: AutomationAddressQualifier,
    item: { readonly type: 'flow' | 'connector'; readonly name: string },
): AutomationAddressRefusal | AutomationAddressSlot | undefined {
    const { type, name } = item;
    const noun = type === 'flow' ? 'Flow' : 'Connector';
    if (!registry || !canResolve(registry)) {
        return qualifier.kind === 'environment'
            ? undefined
            : { status: 404, message: `${noun} '${name}' not found in namespace '${qualifier.namespace}'` };
    }
    const holders = holdersOf(registry, type, name);
    let holder: PackageScopedHolder;
    if (qualifier.kind === 'environment') {
        if (registry.getEnvironmentScopedItem(type, name) !== undefined || holders.length === 0) return undefined;
        return refused('not-held-by-qualifier', type, name, null, holders.map((packageId) => ({ kind: 'package' as const, packageId })));
    } else {
        const owners = typeof registry.getNamespaceOwners === 'function' ? registry.getNamespaceOwners(qualifier.namespace) ?? [] : [];
        const holding = owners.filter((owner) => holders.includes(owner));
        if (holding.length > 1) {
            return refused('ambiguous-in-namespace', type, name, null, holding.map((packageId) => ({ kind: 'package' as const, packageId })));
        }
        if (holding.length === 0) {
            if (holders.length === 0) return { status: 404, message: `${noun} '${name}' not found in namespace '${qualifier.namespace}'` };
            const candidates: PackageScopedHolder[] = holders.map((packageId) => ({ kind: 'package' as const, packageId }));
            return refused('not-held-by-qualifier', type, name, owners[0] ?? null, candidates);
        }
        holder = { kind: 'package', packageId: holding[0] };
    }
    // The bare door serves the bare name's item: the address is its bare path
    // only when that item is the addressed holder's.
    const bare = resolvePackageScopedName(registry, { type, name, callerPackageId: null });
    if (bare.status === 'refused') {
        // [#31696] A flow name two packages hold: each holder's flow is its own
        // slot, and the address names one holder of it.
        return type === 'flow' && holder.kind === 'package'
            ? { status: 'slot', packageId: holder.packageId, refusal: bare }
            : { status: 409, refusal: bare };
    }
    if (bare.status === 'resolved' && bare.holder.kind === 'package' && bare.holder.packageId === holder.packageId) return undefined;
    const served: PackageScopedHolder[] = bare.status === 'resolved' ? [bare.holder] : [];
    return refused('ambiguous-in-environment', type, name, null, [holder, ...served]);
}

/** The reserved environment segment, re-exported for the domain's messages. */
export { ENVIRONMENT_ADDRESS_SEGMENT };

/**
 * [ADR-0150 D5, child G1] The verbs the `/automation` routes serve on the bare
 * shape `parts` (the segments after `/automation`, the qualifier already
 * stripped), as the dispatcher mounts them and `route-ledger.ts` lists them —
 * `route-ledger.conformance.test.ts` pins every `/automation` row against it.
 *
 * Why the domain needs it: the addressed shapes are mounted with a parameter
 * in every position (`/automation/:ns/:name`), so every verb on a
 * two-segment path now reaches this domain, which answers a shape it serves
 * under another verb `405` with this `Allow` — the answer the transport gave
 * the same path before those mounts existed — instead of the transport
 * building its `Allow` from mounts that match the path only by their
 * parameters. Empty: no route has this shape — and the domain root, whose
 * retired `GET` the domain declines (#19543): its answer stays the host's.
 */
export function automationRouteAllow(parts: readonly string[]): string[] {
    const allow = new Set<string>();
    const [a, b, c, d] = parts;
    switch (parts.length) {
        case 1:
            for (const verb of ['GET', 'PUT', 'DELETE']) allow.add(verb);
            break;
        case 2:
            if (a === 'trigger') allow.add('POST');
            if (b === 'trigger' || b === 'toggle' || b === 'clone') allow.add('POST');
            if (b === 'runs') allow.add('GET');
            if (a === 'connectors' && b === 'credential-refs') allow.add('GET');
            break;
        case 3:
            if (b === 'runs') allow.add('GET');
            if (a === 'connectors' && b === 'credential-refs') { allow.add('PUT'); allow.add('DELETE'); }
            if (a === 'connectors' && c === 'connection') for (const verb of ['GET', 'POST', 'DELETE']) allow.add(verb);
            if (a === 'connectors' && b === 'oauth' && c === 'callback') allow.add('GET');
            if (a === 'hooks') allow.add('POST');
            break;
        case 4:
            if (b === 'runs' && d === 'screen') allow.add('GET');
            if (b === 'runs' && (d === 'resume' || d === 'cancel' || d === 'restore-suspension')) allow.add('POST');
            break;
        default:
            break;
    }
    return ['GET', 'POST', 'PUT', 'DELETE'].filter((verb) => allow.has(verb));
}
