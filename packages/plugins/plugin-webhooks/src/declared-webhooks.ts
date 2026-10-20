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
 * ## The switch: regime C (ADR-0131 D6)
 *
 * A declared webhook is read-only. It is switched on or off for the deployment
 * by one `sys_metadata_activation` row of type {@link WEBHOOK_ACTIVATION_TYPE},
 * written through the activation door (`POST /api/v1/security/_activation/
 * webhook/:name`), and changed by a clone under a new name — an organization's
 * own `sys_webhook` row. A ledger row overrides the declared `isActive` in both
 * directions, so a webhook shipped inactive is activated by a row with
 * `active: true`. No row means the declared default. The read follows the
 * sharing-rule reader's rules: a composition with no ledger object issues no
 * read, and a read that fails switches nothing for this pass.
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

/** The subscription id (and delivery `ref_id`) of the declared webhook `name`. */
export function declaredWebhookRefId(name: string): string {
    return `${DECLARED_WEBHOOK_REF_PREFIX}${name}`;
}

/** The declared webhook name a delivery `ref_id` addresses, or `undefined` for a row's. */
export function declaredWebhookNameOfRefId(refId: string): string | undefined {
    return refId.startsWith(DECLARED_WEBHOOK_REF_PREFIX)
        ? refId.slice(DECLARED_WEBHOOK_REF_PREFIX.length) || undefined
        : undefined;
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
    /** In force on this deployment: the ledger row's `active` when one exists, else the declared `isActive`. */
    active: boolean;
}

/**
 * The read side the dispatcher, the redelivery veto and the activation door
 * share — one reader, so the three cannot disagree about which declared
 * webhooks exist or which are switched on.
 */
export interface DeclaredWebhookReader {
    /** Every valid declaration, each with its switch resolved. */
    list(): Promise<DeclaredWebhook[]>;
    /** The declaration named `name`, switched on or off, or `null` when nothing declares it. */
    declaredWebhookNamed(name: string): Promise<DeclaredWebhook | null>;
}

/**
 * [#24910] Whether a declared webhook switched ON is delivered on this
 * deployment at all — the question the activation door asks before it answers
 * `enabled: true`. Its own interface, beside {@link DeclaredWebhookReader}
 * rather than inside it: the dispatcher and the redelivery veto read
 * declarations, and only the door asks about dispatch.
 */
export interface DeclaredWebhookDispatch {
    /**
     * Why no declared webhook is delivered on this deployment — the
     * auto-enqueuer is disabled because a service it needs is missing — in one
     * sentence that names the composition fix; `null` when it runs. Also `null`
     * when the host turned auto-enqueue off itself (`autoEnqueue: false`): that
     * is a deliberate composition whose own code enqueues, and redelivery reads
     * the switch there.
     */
    dispatchUnavailable(): string | null;
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
 * [#24910] The distinct `name`s of the raw declared items — what a boot report
 * names when the declared webhooks cannot be dispatched. Read the way
 * {@link readDeclaredWebhookItems} reads them; never throws.
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
 * {@link readDeclaredWebhookItems}, the switch from the activation ledger, and
 * (for the activation door) whether this deployment dispatches them at all.
 */
export class DeclaredWebhookSource implements DeclaredWebhookReader, DeclaredWebhookDispatch {
    /** Names already reported as failing validation — said once per process. */
    private readonly invalidReported = new Set<string>();

    /**
     * @param dispatchGap - [#24910] Why the auto-enqueuer is not running on
     *   this kernel, or `null` when it runs. The plugin decides it at
     *   `kernel:ready`, BEFORE this reader is bound, so the door never reads a
     *   verdict the boot has not reached yet.
     */
    constructor(
        private readonly engine: unknown,
        private readonly metadataService: unknown,
        private readonly logger?: Logger,
        private readonly dispatchGap: string | null = null,
    ) {}

    dispatchUnavailable(): string | null {
        return this.dispatchGap;
    }

    async list(): Promise<DeclaredWebhook[]> {
        const parsed = this.parseDeclared();
        if (parsed.length === 0) return [];
        const switched = await readWebhookActivation(this.engine, this.logger);
        return parsed.map(({ webhook, packageId }) => ({
            webhook,
            ...(packageId !== undefined ? { packageId } : {}),
            active: switched.get(webhook.name) ?? webhook.isActive !== false,
        }));
    }

    async declaredWebhookNamed(name: string): Promise<DeclaredWebhook | null> {
        if (!name) return null;
        return (await this.list()).find((d) => d.webhook.name === name) ?? null;
    }

    private parseDeclared(): Array<{ webhook: WebhookParsed; packageId?: string }> {
        const out: Array<{ webhook: WebhookParsed; packageId?: string }> = [];
        const seen = new Set<string>();
        for (const raw of readDeclaredWebhookItems(this.engine, this.metadataService)) {
            let webhook: WebhookParsed;
            try {
                webhook = WebhookSchema.parse(raw);
            } catch (err: any) {
                const name = String((raw as { name?: unknown })?.name ?? '');
                if (!this.invalidReported.has(name)) {
                    this.invalidReported.add(name);
                    this.logger?.warn?.('[webhook] declared webhook failed validation — not dispatched', {
                        name: name || undefined,
                        error: err?.message ?? String(err),
                    });
                }
                continue;
            }
            // Two registrations of one name: the first wins, as the seeder's
            // name-keyed upsert let the first one hold the row.
            if (seen.has(webhook.name)) continue;
            seen.add(webhook.name);
            const pkg = (raw as { _packageId?: unknown })._packageId;
            out.push({ webhook, ...(typeof pkg === 'string' && pkg ? { packageId: pkg } : {}) });
        }
        return out;
    }
}

/**
 * [ADR-0131 D6 regime C] The declared webhooks the activation ledger switches,
 * by name: `true` on, `false` off; a name with no row is absent. Read as the
 * sharing-rule reader reads the same ledger: a composition with no ledger object
 * issues no read, and a read that fails switches nothing for this pass.
 */
export async function readWebhookActivation(engine: unknown, logger?: Logger): Promise<Map<string, boolean>> {
    const out = new Map<string, boolean>();
    const ql = engine as {
        registry?: { getObject?: (name: string) => unknown };
        find?: (object: string, query: unknown) => Promise<unknown>;
    } | undefined;
    if (typeof ql?.find !== 'function') return out;
    if (typeof ql.registry?.getObject === 'function' && !ql.registry.getObject(METADATA_ACTIVATION_TABLE)) return out;
    try {
        const rows = await ql.find(METADATA_ACTIVATION_TABLE, {
            filter: { metadata_type: WEBHOOK_ACTIVATION_TYPE },
            fields: ['metadata_type', 'name', 'active'],
            limit: 100000,
            context: SYSTEM_CTX,
        });
        for (const row of (Array.isArray(rows) ? rows : []) as Array<{ metadata_type?: unknown; name?: unknown; active?: unknown }>) {
            if (row.metadata_type !== undefined && row.metadata_type !== WEBHOOK_ACTIVATION_TYPE) continue;
            if (typeof row.name !== 'string' || !row.name) continue;
            out.set(row.name, !(row.active === false || row.active === 0));
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
    constructor(name: string, write: 'create' | 'rename') {
        super(
            `webhook '${name}' is declared by the application, so `
                + (write === 'create' ? 'a new webhook cannot take its name' : 'no webhook can be renamed to it')
                + `. Declared webhooks are read-only: to customise '${name}', create your own webhook under another `
                + `name and switch the declared one off (POST /api/v1/security/_activation/${WEBHOOK_ACTIVATION_TYPE}/${name} `
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
    declared: Pick<DeclaredWebhookReader, 'declaredWebhookNamed'>,
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
        if (await declared.declaredWebhookNamed(data.name)) {
            throw new DeclaredWebhookNameConflictError(data.name, insert ? 'create' : 'rename');
        }
    };
    const opts = { object, packageId: DECLARED_WEBHOOK_NAME_GUARD_PACKAGE, priority: 100 };
    engine.registerHook('beforeInsert', guard(true), opts);
    engine.registerHook('beforeUpdate', guard(false), opts);
}
