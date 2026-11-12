// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Declared webhooks, read from the registry — ADR-0131 D2 and D6, as the
 * ruling on the declared-webhook seeder decided (Q2 A: the seeder retires and
 * the dispatcher reads the declaration).
 *
 * A stack's `webhooks:` are code. They used to be COPIED into `sys_webhook` on
 * every boot by `bootstrapDeclaredWebhooks`, one `managed_by: 'package'` row per
 * declaration. That seeder is retired: a fresh boot writes no `sys_webhook` row
 * for a declared webhook, and the dispatcher ({@link AutoEnqueuer}) reads the
 * declaration itself, here, on every cache refresh. `sys_webhook` holds only the
 * webhooks an organization authors — plus, on a database an 18.0 install
 * created, the seeded rows the ownership ceremony leaves (below).
 *
 * ## Where the declaration is read
 *
 * The two in-process readers the seeder read, in the same order:
 *
 *  1. ObjectQL's `SchemaRegistry` (`engine._registry.listItems('webhook')`),
 *     which manifest decomposition fills from every stack's TOP-LEVEL
 *     `webhooks:` collection. A connector's nested `webhooks[]` is never one of
 *     these items: that key is retired under ADR-0049 (`integration/
 *     connector.zod.ts`), and widening this reader to walk connectors would
 *     resurrect it. `declared-webhooks.connector-nested.test.ts` pins the
 *     absence.
 *  2. The kernel `metadata` service (`list('webhook')`), only when the registry
 *     holds no webhook at all — the registry-less host. A promise-returning
 *     `list` is not awaited, as the seeder did not await it.
 *
 * Both readers hand back the authoring document itself, so each item is parsed
 * through `WebhookSchema` — defaults for `method` / `isActive` / `timeoutMs`
 * applied, a malformed item skipped with one warning per name per process,
 * never a crashed refresh.
 *
 * ## One declaration per `(package, name)` slot (ADR-0150 D3/D4/D5, #31699)
 *
 * A webhook is addressed by `(package, name)`, and two packages of two
 * namespaces may each declare one name (`webhook` is one of
 * `NAMESPACE_SCOPED_BARE_NAME_TYPES`). {@link DeclaredWebhookReader.list}
 * answers one entry per SLOT: each package holder's own declaration (the
 * registry's `getPackageScopedItem`, its overlay included), and the
 * environment's own (`getEnvironmentScopedItem`). The dispatcher subscribes
 * each slot under its own id, `declared:PKG/NAME` for a package's and
 * `declared:NAME` for the environment's ({@link declaredWebhookRefId}), so
 * two holders of one name are two webhooks, each with its own URL, secret and
 * switch, and a delivery's `ref_id` names the slot that produced it.
 *
 * A by-name read that names no package
 * ({@link DeclaredWebhookReader.declaredWebhookNamed}: the activation door's
 * bare address, the name guard, a delivery made before the package
 * coordinate) asks the ONE package-scoped resolver
 * (`resolvePackageScopedName`, `@objectstack/objectql`) as a caller with no
 * package: the environment's own item, else the unique package holder, else
 * {@link DeclaredWebhookAmbiguousError} naming every candidate, never the
 * first listed. {@link DeclaredWebhookReader.declaredWebhookAt} reads one
 * slot exactly. Items the registry does not hold (the metadata service's, on
 * a host whose registry holds no webhook) are slotted by their `_packageId`:
 * each package's item of a name is its slot, and a name listed twice for one
 * holder, or for the environment beside a package, is refused the same way,
 * never first-picked.
 *
 * ## The switch: regime C (ADR-0131 D6)
 *
 * A declared webhook is read-only. It is switched on or off for the deployment
 * by one `sys_metadata_activation` row of type {@link WEBHOOK_ACTIVATION_TYPE},
 * written through the activation door (`POST /api/v1/security/_activation/
 * webhook/:name`, or `webhook/:ns/:name` for one namespace's), and changed by
 * a clone under a new name — an organization's own `sys_webhook` row. A
 * ledger row overrides the declared `isActive` in both directions, so a
 * webhook shipped inactive is activated by a row with `active: true`. No row
 * means the declared default. The read follows the sharing-rule reader's
 * rules: a composition with no ledger object issues no read, and a read that
 * fails switches nothing for this pass.
 *
 * Each slot's switch is its OWN row, `(package_id, name)` (ADR-0150 D4; the
 * environment's row names no package). A slot with no row of its own reads
 * the name's other rows, those naming no package (when the environment does
 * not hold the name) or a package that holds no slot of it any more, as the
 * flow engine reads them ({@link webhookSlotSwitch}): while the name has one
 * slot they are its switch (D8: the row a name-keyed reader wrote before;
 * the boot backfill binds a package-less one); under two or more slots they
 * are no slot's own, so a row switched off keeps every such slot off and a
 * row switched on turns none on (epic red line 1), said once per name.
 *
 * ## Every posture: deployment-wide
 *
 * A declared webhook is the deployment's under `single`, `group` and
 * `isolated` alike (the epic's ruling A, record 6278609968 on #24580): switched
 * on, it receives every organization's events, and each `sys_http_delivery`
 * row is stamped with its event's organization, so delivery history is walled
 * like any other organization-stamped row. There is one switch, the ledger row
 * above — deployment-level, and the platform operator's under a wall (the
 * activation door's ADR-0126 §5 posture rule); an organization administrator
 * is refused there.
 *
 * ## A row holding a declared name: the row answers (regime C)
 *
 * A `sys_webhook` row that holds a declared webhook's name — any row, whatever
 * its provenance — answers as itself, and the declaration is withheld for the
 * whole deployment, reported once per name per process. No write may take a
 * declared name ({@link bindDeclaredWebhookNameGuard}), so such a row is one
 * that held the name before a package declared it.
 *
 * The 18.0 seeder's copies are not read apart from that any more. The
 * ownership ceremony settles every one of them before a database is certified
 * (18.x step 5a, ADR-0131 D10 fate 2): a pristine copy is deleted with its
 * deliveries re-sourced to the declaration, a switch-only edit becomes the
 * declaration's activation row, any other edit becomes a clone under a new
 * name; and the v18 boot guard refuses a database the ceremony has not
 * certified. What 5a leaves is a seeded row whose name no installed package
 * declares — an ordinary webhook, dispatching as itself, as it did on 18.0. If
 * a package declares that name later, the row withholds the declaration like
 * any other row: rename or delete the row to let the declaration answer.
 */

import { WebhookSchema, type WebhookParsed } from '@objectstack/spec/automation';
import { METADATA_ACTIVATION_TABLE } from '@objectstack/core';
import {
    packageScopedRefusalMessage,
    resolvePackageScopedName,
    type PackageScopedHolder,
    type PackageScopedRefusal,
    type PackageScopedRegistry,
} from '@objectstack/objectql';

/** System read context — the dispatcher reads its own configuration. */
const SYSTEM_CTX = { isSystem: true } as const;

/**
 * [ADR-0131 D6 regime C] The `sys_metadata_activation.metadata_type` a declared
 * webhook's switch is recorded under — one row per webhook name, no tenant
 * column.
 */
export const WEBHOOK_ACTIVATION_TYPE = 'webhook';

/**
 * The prefix of a declared webhook's subscription id, which is also the
 * `sys_http_delivery.ref_id` its deliveries carry. A declared name is a
 * `SnakeCaseIdentifierSchema` value and cannot hold a colon, and no row id this
 * plugin or the engine mints starts this way, so a delivery's `ref_id` says by
 * itself whether a declaration or a row produced it.
 */
export const DECLARED_WEBHOOK_REF_PREFIX = 'declared:';

/**
 * The subscription id (and delivery `ref_id`) of a declared webhook slot
 * (ADR-0150 D5, #31699): `declared:PKG/NAME` for package `packageId`'s
 * declaration, `declared:NAME` for the environment's own. Neither a webhook
 * name (`SnakeCaseIdentifierSchema`) nor a package id (`MANIFEST_ID_PATTERN`)
 * can hold a `/`, so the first one splits the two.
 */
export function declaredWebhookRefId(name: string, packageId?: string): string {
    return `${DECLARED_WEBHOOK_REF_PREFIX}${packageId ? `${packageId}/` : ''}${name}`;
}

/**
 * The declaration a delivery `ref_id` addresses, or `undefined` for a row's:
 * `{ packageId, name }` for `declared:PKG/NAME`, and `{ name }` for
 * `declared:NAME` — the environment's own declaration, or a delivery written
 * before the package coordinate (the 18.x ceremony's re-source among them),
 * which a reader resolves as a caller with no package. Split at the first
 * `/`: a malformed tail (`declared:/x`, `declared:a/b/c`) keeps what it says,
 * so it addresses no slot and reads as no longer declared.
 */
export function declaredWebhookAddressOfRefId(refId: string): { packageId?: string; name: string } | undefined {
    if (!refId.startsWith(DECLARED_WEBHOOK_REF_PREFIX)) return undefined;
    const rest = refId.slice(DECLARED_WEBHOOK_REF_PREFIX.length);
    if (!rest) return undefined;
    const slash = rest.indexOf('/');
    return slash < 0 ? { name: rest } : { packageId: rest.slice(0, slash), name: rest.slice(slash + 1) };
}

/**
 * [ADR-0150 D5, #31699] The activation door's address of one declared
 * webhook slot, as a remedy names it: `webhook/NS/NAME` for a package's
 * declaration whose namespace is known, which answers whatever else declares
 * the name, and the bare `webhook/NAME` for the environment's own.
 */
export function declaredWebhookActivationPath(name: string, namespace?: string): string {
    return `/api/v1/security/_activation/${WEBHOOK_ACTIVATION_TYPE}/${namespace ? `${namespace}/` : ''}${name}`;
}

interface Logger {
    warn?: (msg: string, meta?: unknown) => void;
}

/** One declared webhook, parsed, with its switch resolved. */
export interface DeclaredWebhook {
    /** The parsed declaration, defaults applied. */
    webhook: WebhookParsed;
    /** The package that ships it (the registry item's `_packageId`), when one does. */
    packageId?: string;
    /** That package's namespace, when the registry knows it: the door's `webhook/NS/NAME` (#31699). */
    namespace?: string;
    /** In force on this deployment: the ledger row's `active` when one exists, else the declared `isActive`. */
    active: boolean;
}

/**
 * The read side the dispatcher, the redelivery veto and the activation door
 * share — one reader, so the three cannot disagree about which declared
 * webhooks exist or which are switched on.
 */
export interface DeclaredWebhookReader {
    /** Every valid declaration, one per `(package, name)` slot, each with its switch resolved. */
    list(): Promise<DeclaredWebhook[]>;
    /**
     * The declaration named `name` for a caller with no package, switched on
     * or off, or `null` when nothing declares it. Throws
     * {@link DeclaredWebhookAmbiguousError} when the name resolves to no single
     * declaration (ADR-0150 D3).
     */
    declaredWebhookNamed(name: string): Promise<DeclaredWebhook | null>;
    /**
     * [ADR-0150 D5] Exactly the declaration package `packageId` holds under
     * `name` (`null`: the environment's own), switched on or off, or `null`
     * when that holder declares none. Never another holder's.
     */
    declaredWebhookAt(packageId: string | null, name: string): Promise<DeclaredWebhook | null>;
    /**
     * [#31699 round 2] Every holder of `name` (`null`: the environment's), a
     * DISABLED package's included, or none when nothing declares it. The
     * three reads above answer the served set; a durable write counts every
     * holder (the activation door's `adoptPackageless`), so the ledger row a
     * disabled co-holder shares is never re-attributed to the enabled one.
     */
    holdersOf?(name: string): Promise<ReadonlyArray<string | null>>;
}

/**
 * [ADR-0150 D3, epic #31527 red line 2] A declared webhook name that resolves
 * to no single declaration: two packages declare it, and nothing picks one.
 * `code` + `status` are the conflict envelope (409 `RESOURCE_CONFLICT`, the
 * catalogue's code for a 409, the status ADR-0150 D5 gives an ambiguous bare
 * name); `candidates` names every holder, and so does the message.
 */
export class DeclaredWebhookAmbiguousError extends Error {
    readonly code = 'RESOURCE_CONFLICT';
    readonly status = 409;
    /** The declared webhook name. */
    readonly webhook: string;
    /** Every holder of the name, in the resolver's order. */
    readonly candidates: readonly PackageScopedHolder[];
    /** The resolver's refusal, which a door answers `409` with (#31699: was a `503`). */
    readonly refusal: PackageScopedRefusal;
    constructor(refusal: PackageScopedRefusal) {
        super(refusal.message);
        this.name = 'DeclaredWebhookAmbiguousError';
        this.webhook = refusal.name;
        this.candidates = refusal.candidates;
        this.refusal = refusal;
    }
}

/**
 * The engine's `SchemaRegistry`, when it carries the slice the package-scoped
 * resolver reads, in two readings (#31699 round 2, epic red line 1):
 *
 *  - `served`: a DISABLED package is no holder, as the merged listings and the
 *    by-name read withhold its item (#25308; the registry's own served slice in
 *    `refuseAmbiguousObjectLessAction`). Dispatch, the bare read, the
 *    redelivery veto and the name guard judge this one, so a disabled
 *    co-holder's declaration is neither delivered nor redelivered, and never
 *    makes the enabled holder's bare read refuse.
 *  - `every`: every holder, disabled or not. The activation ledger's row
 *    ownership reads this one: a row is durable and outlives a disable, so a
 *    disabled holder's own row stays its own, and a row naming no package is
 *    no holder's while two packages declare the name (ADR-0150 D4), whichever
 *    of them is enabled.
 */
function packageScopedRegistryOf(engine: unknown): { served: PackageScopedRegistry; every: PackageScopedRegistry } | undefined {
    let reg: unknown;
    try {
        reg = (engine as { _registry?: unknown } | undefined)?._registry;
    } catch {
        return undefined;
    }
    const r = reg as (Partial<Record<keyof PackageScopedRegistry, unknown>> & { isPackageDisabled?: unknown }) | undefined;
    if (!(typeof r?.packageScopedHoldersOf === 'function'
        && typeof r.getPackageScopedItem === 'function'
        && typeof r.getEnvironmentScopedItem === 'function'
        && typeof r.getPackage === 'function'
        && typeof r.getAllPackages === 'function')) return undefined;
    const raw = reg as PackageScopedRegistry;
    // [#32183] The registry's own holder read answers the SERVED holders, a
    // disabled package left out; the durable reading asks it for every holder.
    const every: PackageScopedRegistry = {
        getPackage: (id) => raw.getPackage(id),
        getAllPackages: () => raw.getAllPackages(),
        packageScopedHoldersOf: (type, name, callerPackageId, options) =>
            raw.packageScopedHoldersOf(type, name, callerPackageId, { ...options, includeDisabledPackages: true }),
        getPackageScopedItem: (type, name, packageId, member) => raw.getPackageScopedItem(type, name, packageId, member),
        getEnvironmentScopedItem: (type, name, member) => raw.getEnvironmentScopedItem(type, name, member),
    };
    const isDisabled = typeof r.isPackageDisabled === 'function'
        ? (packageId: string) => (r.isPackageDisabled as (id: string) => boolean).call(reg, packageId) === true
        : () => false;
    const served: PackageScopedRegistry = {
        getPackage: (id) => every.getPackage(id),
        getAllPackages: () => every.getAllPackages(),
        packageScopedHoldersOf: (type, name) => every.packageScopedHoldersOf(type, name).filter((id) => !isDisabled(id)),
        getPackageScopedItem: (type, name, packageId, member) =>
            isDisabled(packageId) ? undefined : every.getPackageScopedItem(type, name, packageId, member),
        getEnvironmentScopedItem: (type, name, member) => every.getEnvironmentScopedItem(type, name, member),
    };
    return { served, every };
}

/** Every holder of `name` the registry holds, a disabled package's included (`null`: the environment). */
function everyHolderOf(every: PackageScopedRegistry, name: string): Array<string | null> {
    return [
        ...(every.getEnvironmentScopedItem('webhook', name) !== undefined ? [null] : []),
        ...every.packageScopedHoldersOf('webhook', name).filter((packageId) => every.getPackageScopedItem('webhook', name, packageId) !== undefined),
    ];
}

/** The namespace package `packageId` declares, when the registry holds the package. */
function namespaceOf(registry: PackageScopedRegistry | undefined, packageId: string): string | undefined {
    const namespace = (registry?.getPackage(packageId) as { manifest?: { namespace?: unknown } } | undefined)?.manifest?.namespace;
    return typeof namespace === 'string' && namespace !== '' ? namespace : undefined;
}

/** One `(package, name)` slot of a declared name: its raw item and its holder (`null`: the environment). */
interface DeclaredSlot {
    readonly raw: unknown;
    readonly packageId: string | null;
}

/** The holder a listed item names: its `_packageId`, or `null` (none, `''`, or the `sys_metadata` overlay sentinel). */
function listedHolderOf(item: unknown): string | null {
    const pkg = (item as { _packageId?: unknown })?._packageId;
    return typeof pkg === 'string' && pkg !== '' && pkg !== 'sys_metadata' ? pkg : null;
}

/** The refusal of a name no single listed declaration answers, naming every holder. */
function listedRefusal(name: string, holders: ReadonlyArray<string | null>): PackageScopedRefusal {
    const refusal = {
        status: 'refused' as const,
        reason: 'ambiguous-in-environment' as const,
        type: 'webhook' as const,
        name,
        callerPackageId: null,
        candidates: holders.map((h): PackageScopedHolder => (h === null ? { kind: 'environment' } : { kind: 'package', packageId: h })),
    };
    return { ...refusal, message: packageScopedRefusalMessage(refusal) };
}

/**
 * The slots of `name` (module doc), and the one a caller with no package is
 * served (ADR-0150 D3): `{ packageId }` (`null`: the environment's), or the
 * refusal naming every candidate. The registry answers when it holds the
 * name; else the listed items do, one slot per holder, and a holder listed
 * twice, or the environment beside a package, refuses the whole name.
 */
function slotsOf(
    name: string,
    listed: readonly unknown[],
    registry: { served: PackageScopedRegistry; every: PackageScopedRegistry } | undefined,
): {
    slots: DeclaredSlot[];
    holders: Array<string | null>;
    bare?: { packageId: string | null } | { refusal: PackageScopedRefusal };
} {
    if (registry) {
        const { served, every } = registry;
        const env = served.getEnvironmentScopedItem('webhook', name);
        const slots: DeclaredSlot[] = env !== undefined ? [{ raw: env, packageId: null }] : [];
        for (const packageId of served.packageScopedHoldersOf('webhook', name)) {
            const raw = served.getPackageScopedItem('webhook', name, packageId);
            if (raw !== undefined) slots.push({ raw, packageId });
        }
        const holders = everyHolderOf(every, name);
        if (slots.length > 0) {
            const resolved = resolvePackageScopedName(served, { type: 'webhook', name });
            if (resolved.status === 'refused') return { slots, holders, bare: { refusal: resolved } };
            if (resolved.status === 'not-found') return { slots, holders };
            return { slots, holders, bare: { packageId: resolved.holder.kind === 'package' ? resolved.holder.packageId : null } };
        }
        // Every holder the registry knows is disabled: nothing is served, never the listed items.
        if (holders.length > 0) return { slots: [], holders };
        // Not the registry's (the metadata service's items): slotted as listed.
    }
    const byHolder = new Map<string | null, unknown[]>();
    for (const item of listed) {
        const holder = listedHolderOf(item);
        byHolder.set(holder, [...(byHolder.get(holder) ?? []), item]);
    }
    const holders = [...byHolder.keys()];
    if ([...byHolder.values()].some((items) => items.length > 1) || (byHolder.has(null) && holders.length > 1)) {
        return { slots: [], holders, bare: { refusal: listedRefusal(name, holders) } };
    }
    const slots = [...byHolder].map(([packageId, [raw]]) => ({ raw, packageId }));
    return { slots, holders, bare: slots.length === 1 ? { packageId: slots[0].packageId } : { refusal: listedRefusal(name, holders) } };
}

/**
 * [ADR-0131 D6, ADR-0150 D4/D8] The switch of slot `slot` of a name whose
 * holders are `slots` (`null`: the environment's; every holder, a disabled
 * package's included, since a row outlives a disable), from the name's ledger rows
 * by package (`null`: a row naming no package): `undefined` is the declared
 * `isActive`. The slot's own row answers. With none, the rows that are no
 * slot's own (naming no package while the environment declares nothing of the
 * name, or naming a package that holds no slot of it) answer while the name
 * has one slot, as the name-keyed reader read them (a row switched off by any
 * of them is off); under two or more slots a row switched off keeps the slot
 * off and one switched on turns nothing on (epic red line 1).
 */
export function webhookSlotSwitch(
    rows: ReadonlyMap<string | null, boolean> | undefined,
    slot: string | null,
    slots: ReadonlyArray<string | null>,
): boolean | undefined {
    if (!rows) return undefined;
    const own = rows.get(slot);
    if (own !== undefined) return own;
    const unowned = [...rows].filter(([packageId]) => !slots.includes(packageId)).map(([, active]) => active);
    if (unowned.length === 0) return undefined;
    if (slots.length <= 1) return unowned.every(Boolean);
    return unowned.every(Boolean) ? undefined : false;
}

/**
 * The raw declared `webhook` items, registry first, metadata service second.
 * Never throws: a reader that cannot answer yields nothing from that reader.
 */
export function readDeclaredWebhookItems(engine: unknown, metadataService: unknown): unknown[] {
    try {
        const reg = (engine as { _registry?: { listItems?: (type: string) => unknown[] } } | undefined)?._registry;
        if (typeof reg?.listItems === 'function') {
            const items = (reg.listItems('webhook') ?? []).filter(Boolean);
            if (items.length > 0) return items;
        }
    } catch {
        /* fall through to the metadata service */
    }
    try {
        const listed = (metadataService as { list?: (type: string) => unknown } | undefined)?.list?.('webhook');
        const arr = typeof (listed as { then?: unknown } | undefined)?.then === 'function' ? [] : (listed ?? []);
        return Array.isArray(arr) ? arr.filter(Boolean) : [];
    } catch {
        return [];
    }
}

/**
 * [#24910] The distinct `name`s of the raw declared items — what the boot
 * report names when the auto-enqueuer cannot run, so nothing declared would be
 * delivered. Read the way {@link readDeclaredWebhookItems} reads them; never
 * throws.
 */
export function readDeclaredWebhookNames(engine: unknown, metadataService: unknown): string[] {
    const names = new Set<string>();
    for (const raw of readDeclaredWebhookItems(engine, metadataService)) {
        const name = (raw as { name?: unknown })?.name;
        if (typeof name === 'string' && name) names.add(name);
    }
    return [...names];
}

/**
 * The reader the plugin binds: the declarations from
 * {@link readDeclaredWebhookItems}, one per slot, the switch from the
 * activation ledger.
 */
export class DeclaredWebhookSource implements DeclaredWebhookReader {
    /** Names already reported as failing validation — said once per process. */
    private readonly invalidReported = new Set<string>();
    /** Names already reported as resolving to no slot at all — said once per process. */
    private readonly refusalReported = new Set<string>();
    /** Names already reported as switched by a row no slot owns, under two slots — said once per process. */
    private readonly unownedReported = new Set<string>();
    /** The names the last read refused to a caller with no package (ADR-0150 D3), each with its refusal. */
    private refusals = new Map<string, PackageScopedRefusal>();
    /** Per name, the slot a caller with no package is served: its package, `null` for the environment's. */
    private bare = new Map<string, string | null>();
    /** Per name, every holder the last read found, a disabled package's included (`null`: the environment). */
    private holders = new Map<string, Array<string | null>>();

    constructor(
        private readonly engine: unknown,
        private readonly metadataService: unknown,
        private readonly logger?: Logger,
    ) {}

    async list(): Promise<DeclaredWebhook[]> {
        const parsed = this.parseDeclared();
        if (parsed.length === 0) return [];
        const ledger = await readWebhookActivation(this.engine, this.logger);
        for (const [name, rows] of ledger) this.reportUnownedRows(name, rows);
        return parsed.map(({ webhook, packageId, namespace }) => ({
            webhook,
            ...(packageId !== undefined ? { packageId } : {}),
            ...(namespace !== undefined ? { namespace } : {}),
            active: webhookSlotSwitch(ledger.get(webhook.name), packageId ?? null, this.holders.get(webhook.name) ?? [])
                ?? webhook.isActive !== false,
        }));
    }

    async declaredWebhookNamed(name: string): Promise<DeclaredWebhook | null> {
        if (!name) return null;
        const declared = await this.list();
        const refusal = this.refusals.get(name);
        if (refusal) throw new DeclaredWebhookAmbiguousError(refusal);
        if (!this.bare.has(name)) return null;
        const holder = this.bare.get(name);
        return declared.find((d) => d.webhook.name === name && (d.packageId ?? null) === holder) ?? null;
    }

    async declaredWebhookAt(packageId: string | null, name: string): Promise<DeclaredWebhook | null> {
        if (!name) return null;
        const declared = await this.list();
        return declared.find((d) => d.webhook.name === name && (d.packageId ?? null) === packageId) ?? null;
    }

    async holdersOf(name: string): Promise<ReadonlyArray<string | null>> {
        if (!name) return [];
        const registry = packageScopedRegistryOf(this.engine);
        const held = registry ? everyHolderOf(registry.every, name) : [];
        if (held.length > 0) return held;
        // Not the registry's (the metadata service's items): the holders as listed.
        this.parseDeclared();
        return [...(this.holders.get(name) ?? [])];
    }

    /** A row no slot owns, under two or more slots (module doc, "The switch"): said once per name. */
    private reportUnownedRows(name: string, rows: ReadonlyMap<string | null, boolean>): void {
        const slots = this.holders.get(name) ?? [];
        const unowned = [...rows.keys()].filter((packageId) => !slots.includes(packageId));
        if (slots.length < 2 || unowned.length === 0 || this.unownedReported.has(name)) return;
        this.unownedReported.add(name);
        const rowsNamed = unowned.map((p) => (p === null ? 'naming no package' : `naming package "${p}"`)).join(', ');
        const holders = slots.map((p) => (p === null ? 'the environment' : `"${p}"`)).join(', ');
        this.logger?.warn?.(
            `[webhook] declared webhook '${name}' has an activation row that is no holder's own (${rowsNamed}), and ` +
                `${slots.length} holders declare it (${holders}). Such a row switched the name's one holder; under two ` +
                'nothing says which, so a row switched off keeps every holder with no row of its own off, and one ' +
                'switched on turns none on (ADR-0150 D4). Switch each holder through its own address: POST ' +
                `/api/v1/security/_activation/webhook/<namespace>/${name}.`,
            { name, holders: slots, rows: unowned },
        );
    }

    private parseDeclared(): Array<{ webhook: WebhookParsed; packageId?: string; namespace?: string }> {
        const out: Array<{ webhook: WebhookParsed; packageId?: string; namespace?: string }> = [];
        const listedByName = new Map<string, unknown[]>();
        const nameless: unknown[] = [];
        for (const raw of readDeclaredWebhookItems(this.engine, this.metadataService)) {
            const name = (raw as { name?: unknown })?.name;
            if (typeof name !== 'string' || name === '') nameless.push(raw);
            else listedByName.set(name, [...(listedByName.get(name) ?? []), raw]);
        }
        const registry = packageScopedRegistryOf(this.engine);
        const refusals = new Map<string, PackageScopedRefusal>();
        const bare = new Map<string, string | null>();
        const holdersByName = new Map<string, Array<string | null>>();
        for (const [name, listed] of listedByName) {
            const { slots, holders, bare: served } = slotsOf(name, listed, registry);
            holdersByName.set(name, holders);
            if (served && 'refusal' in served) {
                refusals.set(name, served.refusal);
                if (slots.length === 0 && !this.refusalReported.has(name)) {
                    this.refusalReported.add(name);
                    this.logger?.warn?.(
                        `[webhook] declared webhook '${name}' is not dispatched: ${served.refusal.message}`,
                        { name, candidates: served.refusal.candidates },
                    );
                }
            } else if (served) {
                bare.set(name, served.packageId);
            }
            for (const { raw, packageId } of slots) {
                const webhook = this.parseItem(raw);
                if (!webhook) continue;
                const namespace = packageId !== null ? namespaceOf(registry?.every, packageId) : undefined;
                out.push({ webhook, ...(packageId !== null ? { packageId } : {}), ...(namespace ? { namespace } : {}) });
            }
        }
        for (const raw of nameless) this.parseItem(raw);
        this.refusals = refusals;
        this.bare = bare;
        this.holders = holdersByName;
        return out;
    }

    /** One raw item through `WebhookSchema`, or `undefined` with one warning per name per process. */
    private parseItem(raw: unknown): WebhookParsed | undefined {
        try {
            return WebhookSchema.parse(raw);
        } catch (err: any) {
            const name = String((raw as { name?: unknown })?.name ?? '');
            if (!this.invalidReported.has(name)) {
                this.invalidReported.add(name);
                this.logger?.warn?.('[webhook] declared webhook failed validation — not dispatched', {
                    name: name || undefined,
                    error: err?.message ?? String(err),
                });
            }
            return undefined;
        }
    }
}

/**
 * [ADR-0131 D6 regime C, ADR-0150 D4] The declared webhooks the activation
 * ledger switches: per name, per the package each row names (`null`: none),
 * `true` on, `false` off; a name with no row is absent. Read as the
 * sharing-rule reader reads the same ledger: a composition with no ledger
 * object issues no read, and a read that fails switches nothing for this pass.
 */
export async function readWebhookActivation(
    engine: unknown,
    logger?: Logger,
): Promise<Map<string, Map<string | null, boolean>>> {
    const out = new Map<string, Map<string | null, boolean>>();
    const ql = engine as {
        registry?: { getObject?: (name: string) => unknown };
        find?: (object: string, query: unknown) => Promise<unknown>;
    } | undefined;
    if (typeof ql?.find !== 'function') return out;
    if (typeof ql.registry?.getObject === 'function' && !ql.registry.getObject(METADATA_ACTIVATION_TABLE)) return out;
    try {
        const rows = await ql.find(METADATA_ACTIVATION_TABLE, {
            filter: { metadata_type: WEBHOOK_ACTIVATION_TYPE },
            fields: ['metadata_type', 'name', 'package_id', 'active'],
            limit: 100000,
            context: SYSTEM_CTX,
        });
        type Row = { metadata_type?: unknown; name?: unknown; package_id?: unknown; active?: unknown };
        for (const row of (Array.isArray(rows) ? rows : []) as Row[]) {
            if (row.metadata_type !== undefined && row.metadata_type !== WEBHOOK_ACTIVATION_TYPE) continue;
            if (typeof row.name !== 'string' || !row.name) continue;
            const packageId = typeof row.package_id === 'string' && row.package_id !== '' ? row.package_id : null;
            const byPackage = out.get(row.name) ?? new Map<string | null, boolean>();
            byPackage.set(packageId, !(row.active === false || row.active === 0));
            out.set(row.name, byPackage);
        }
    } catch (err: any) {
        logger?.warn?.(
            `[webhook] ${METADATA_ACTIVATION_TABLE} read failed — declared webhooks keep their declared isActive for this pass`,
            { error: err?.message ?? String(err) },
        );
    }
    return out;
}

/**
 * The provenance values a seeded copy carries: `package` and `platform`, the
 * same pair the provenance hook stamps `customized` on
 * (`webhook-provenance.ts`) and the upgrade ceremony settles.
 */
export function isSeededProvenance(managedBy: unknown): boolean {
    return managedBy === 'package' || managedBy === 'platform';
}

/**
 * [ADR-0131 D6 regime C] A `sys_webhook` row — new, or renamed — that would
 * take a declared webhook's name.
 *
 * A declared webhook is read-only and clonable: it is customised by a CLONE
 * under a new name, with the declaration switched off through the activation
 * ledger. A row holding a declared name withholds the declaration for the
 * whole deployment (the dispatcher's `heldByRow`), so under a wall one
 * organization's same-name row would silence a deployment-wide declaration
 * for every organization. No write may take a declared name — Setup's New, a
 * script, an AI tool, the `/data` door — and every such write is refused
 * before it lands.
 *
 * `code` + `status` are the declared envelope a door answers at its own status
 * (409 `RESOURCE_CONFLICT`, the catalogue's code for a 409 —
 * `HttpStatusErrorCodeMap`): the name is taken by a declaration, which is a
 * conflict, not a missing capability. The same shape as the sharing rules'
 * `DeclaredSharingRuleNameConflictError`.
 */
export class DeclaredWebhookNameConflictError extends Error {
    readonly code = 'RESOURCE_CONFLICT';
    readonly status = 409;
    /** The declared webhook whose name the write would take. */
    readonly webhook: string;
    /**
     * @param switches - The activation door's address of each declaration of
     *   the name ({@link declaredWebhookActivationPath}): a package's names its
     *   namespace (#31699), so a name two packages declare gets one per holder.
     */
    constructor(name: string, write: 'create' | 'rename', switches: readonly string[] = [declaredWebhookActivationPath(name)]) {
        super(
            `webhook '${name}' is declared by the application, so `
                + (write === 'create' ? 'a new webhook cannot take its name' : 'no webhook can be renamed to it')
                + `. Declared webhooks are read-only: to customise '${name}', create your own webhook under another `
                + (switches.length > 1
                    ? `name and switch the declared ones off (${switches.map((path) => `POST ${path}`).join(', ')}, each `
                    : `name and switch the declared one off (POST ${switches[0] ?? declaredWebhookActivationPath(name)} `)
                + 'with { "enabled": false }).',
        );
        this.name = 'DeclaredWebhookNameConflictError';
        this.webhook = name;
    }
}

/** Package id of {@link bindDeclaredWebhookNameGuard}'s hooks. */
export const DECLARED_WEBHOOK_NAME_GUARD_PACKAGE = 'plugin-webhooks:declared-name-guard';

/**
 * [ADR-0131 D6 regime C] Bind the guard above on `sys_webhook` writes: an
 * insert of a declared name is refused, and so is an update that CHANGES
 * `name` onto one; an update that leaves the name alone passes — so a row that
 * held a name before a package declared it stays editable exactly as it was.
 *
 * System writes pass: they are the platform's own machinery (the boot sweep,
 * the ownership ceremony, migrations), never an author taking a name.
 */
export function bindDeclaredWebhookNameGuard(
    engine: {
        registerHook(event: string, handler: (ctx: any) => any, options?: Record<string, any>): void;
        unregisterHooksByPackage?(packageId: string): number;
    },
    declared: Pick<DeclaredWebhookReader, 'declaredWebhookNamed'> & Partial<Pick<DeclaredWebhookReader, 'list'>>,
    object: string = 'sys_webhook',
): void {
    engine.unregisterHooksByPackage?.(DECLARED_WEBHOOK_NAME_GUARD_PACKAGE);
    const guard = (insert: boolean) => async (ctx: any) => {
        if ((ctx?.session as any)?.isSystem) return;
        const data = ctx?.input?.data;
        if (!data || typeof data !== 'object' || Array.isArray(data)) return;
        if (typeof data.name !== 'string') return;
        // An update is a rename only against its pre-image (`ctx.previous`, the
        // `HookContext` contract both update shapes bind before `beforeUpdate`): a
        // full-form save re-sends the name it already has.
        if (!insert) {
            const previous = ctx?.previous as Record<string, unknown> | undefined;
            if (!previous || typeof previous !== 'object' || data.name === previous.name) return;
        }
        // [ADR-0150 D3, #31699] A name two packages declare is declared: the
        // by-name read refuses to pick one of them, and the write is refused
        // for the name, as for one holder's, naming each holder's address.
        const switches = await declared.declaredWebhookNamed(data.name).then(
            (d) => (d ? [declaredWebhookActivationPath(d.webhook.name, d.namespace)] : undefined),
            async (err: unknown) => {
                if (!(err instanceof DeclaredWebhookAmbiguousError)) throw err;
                const slots = (await declared.list?.())?.filter((d) => d.webhook.name === data.name) ?? [];
                return slots.length > 0
                    ? slots.map((d) => declaredWebhookActivationPath(d.webhook.name, d.namespace))
                    : [declaredWebhookActivationPath(data.name, '<namespace>')];
            },
        );
        if (switches) throw new DeclaredWebhookNameConflictError(data.name, insert ? 'create' : 'rename', switches);
    };
    const opts = { object, packageId: DECLARED_WEBHOOK_NAME_GUARD_PACKAGE, priority: 100 };
    engine.registerHook('beforeInsert', guard(true), opts);
    engine.registerHook('beforeUpdate', guard(false), opts);
}
