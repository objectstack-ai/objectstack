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
 * created, the mirror rows that release's seeder left behind (below).
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
 * ## An 18.0 database: the dual read (expand first)
 *
 * The 18.0 seeder's rows stay where they are; deleting them, and re-sourcing
 * their `sys_http_delivery` tails, is the ownership ceremony's step
 * (ADR-0131 D10 fate 2). Until then the reader must not fire a declared webhook
 * twice, and must not undo what an administrator did to a seeded row. So a
 * `sys_webhook` row holding a declared name is judged by what the 18.0 seeder
 * would have done with it on this boot ({@link classifyDeclaredNameHolder}):
 *
 *  - **A pristine mirror** (`managed_by: 'package'`, not `customized`): the
 *    seeder would have overwritten it from the declaration. The row is ignored
 *    and the declaration answers.
 *  - **Any other row** (`customized: true`, or `managed_by: 'admin'`): the
 *    seeder never touched it, and an administrator's `active: false` on a noisy
 *    webhook survived every redeploy. The row answers as itself and the
 *    declaration is withheld, reported once per name per process.
 *
 * A pristine mirror whose declaration is gone is an ordinary row: 18.0 left it
 * in place and dispatching, and so does this release.
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
 * The reader the plugin binds: the declarations from
 * {@link readDeclaredWebhookItems}, the switch from the activation ledger.
 */
export class DeclaredWebhookSource implements DeclaredWebhookReader {
    /** Names already reported as failing validation — said once per process. */
    private readonly invalidReported = new Set<string>();

    constructor(
        private readonly engine: unknown,
        private readonly metadataService: unknown,
        private readonly logger?: Logger,
    ) {}

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
 * How a `sys_webhook` row that holds a declared webhook's name is read — what
 * the 18.0 seeder would have done with it on this boot (see the module doc):
 * `'mirror'` — a pristine seeded copy, ignored in favour of the declaration;
 * `'row'` — customized or administrator-authored, answering as itself while the
 * declaration is withheld.
 */
export function classifyDeclaredNameHolder(row: { managed_by?: unknown; customized?: unknown }): 'mirror' | 'row' {
    return row.managed_by === 'package' && row.customized !== true ? 'mirror' : 'row';
}
