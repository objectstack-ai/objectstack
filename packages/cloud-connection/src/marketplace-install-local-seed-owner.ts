// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30324 · ruling 6670861426] Who owns an installed package's sample rows.
 *
 * The seed loader writes under `SEED_WRITE_EXECUTION_CONTEXT` (system, no
 * user), so a row it inserts carries no `owner_id` and no `created_by`. Rows
 * nobody owns are invisible to every `readScope: 'own'` grant and editable by
 * nobody below Modify All, and the boot seed's first-admin hand-over
 * (`claimSeedOwnership`, `@objectstack/plugin-security`) never reaches them:
 * the marketplace install's seed emits no `app:seeded`, so that pass's own
 * header leaves it outside.
 *
 * The ruling: a sample row is written with `owner_id` and `created_by` set to
 * the person who seeded it, and from then on it is an ordinary record under the
 * platform's ordinary permission rules. No read rule is added for sample data;
 * under `private` sharing a colleague does not see the installer's rows, as
 * they would not see any other record the installer owns.
 *
 * {@link stampSeedOwner} is that stamp, run by every seeding door of this
 * plugin right after its load, with the person that door names (the install's
 * and the reseed's caller, the ledger's installer for the boot heal, the
 * organization's founder for the per-organization replay).
 *
 * ## Only the rows the load created
 *
 * The selection is the seed claim's discipline (ADR-0138 D1, #23354): only ids
 * the loader reports, never every unowned row. Narrower than the claim's,
 * because it is `insertedIds`, not `landedIds`: a pre-existing row a seed
 * record's key matched (an upsert over a customer's row, a replay over an
 * earlier load's) is the loader's to update and nobody's to re-own here. Inside
 * that set each field is written only where it is still empty, so an owner or
 * creator a seed record authored (`owner_id: cel\`os.user.id\`` bound to a
 * person, a literal id) is kept.
 *
 * ## Why not through the claim
 *
 * The claim runs on an event this seed does not emit, reads its ids from the
 * `seed-settlement` host this plugin does not publish to, writes `owner_id`
 * only, and targets the platform admin, not the person who seeded. Routing
 * through it would need all four changed outside this package. The write shape
 * is borrowed from it instead: predicate writes over bounded chunks of ids,
 * under {@link SEED_OWNER_STAMP_CTX}, yielding between chunks.
 */

import { resolveInjectedColumnProvenance } from '@objectstack/spec/data';
import { SystemUserId } from '@objectstack/spec/system';

/**
 * The stamp's write context: system-elevated, with metadata-bound automation
 * off. The claim's `CLAIM_WRITE_CTX`, for the claim's reason: naming a sample
 * row's owner completes the seed, it is not a user's edit, so no app hook,
 * flow, approval or notification fires for it. Code-registered hooks (the
 * audit writer, the sharing projection, the audit stamp) still run per row.
 */
export const SEED_OWNER_STAMP_CTX = { isSystem: true, skipAutomations: true } as const;

/**
 * Ids one stamp write carries: the claim's hand-over batch (#26825), so a
 * synchronous driver serves a pending request between two writes and an
 * `id IN (…)` list stays far inside any driver's parameter limit and the
 * engine's per-row hook ceiling.
 */
export const SEED_OWNER_STAMP_BATCH = 50;

const OWNER_FIELD = 'owner_id';
const CREATED_BY_FIELD = 'created_by';
const ORGANIZATION_FIELD = 'organization_id';

/** The slice of the engine the stamp uses. */
export interface SeedOwnerStampEngine {
    update(
        objectName: string,
        data: Record<string, unknown>,
        options: { where: Record<string, unknown>; multi: true; context: typeof SEED_OWNER_STAMP_CTX },
    ): Promise<unknown>;
    /** `IObjectQLEngine.getSchema`; the registry's `getObject` is read when it is absent. */
    getSchema?(name: string): unknown;
    registry?: { getObject?(name: string): unknown };
}

/** One object's loaded rows, as `SeedLoadResult` reports them. */
export interface SeedOwnerStampInput {
    object: string;
    insertedIds?: readonly string[];
}

/** What the stamp did to one object's created rows. */
export interface SeedOwnerStampObject {
    object: string;
    /** Rows this load created. */
    created: number;
    /** Rows whose `owner_id` the stamp wrote. */
    owner: number;
    /** Rows whose `created_by` the stamp wrote. */
    createdBy: number;
    /** Rows a write was refused for, each tried on its own. They keep what the seed wrote. */
    refused: number;
    /** The first refusal's message. */
    error?: string;
    /** Why the object was not stamped at all. */
    skipped?: 'no-schema' | 'platform-object' | 'external' | 'no-owner-columns';
}

export interface SeedOwnerStampResult {
    /** The person stamped, or `null` when the door had none and nothing was written. */
    ownerUserId: string | null;
    objects: SeedOwnerStampObject[];
}

function fieldMap(schema: any): Record<string, any> {
    const fields = schema?.fields;
    if (!fields) return {};
    if (Array.isArray(fields)) {
        return Object.fromEntries(fields.filter((f: any) => typeof f?.name === 'string').map((f: any) => [f.name, f]));
    }
    return fields;
}

/** `created_by` with storage behind it: on an ADR-0015 federated object the injected column has none. */
function hasStoredField(schema: any, field: string): boolean {
    if (!(field in fieldMap(schema))) return false;
    return resolveInjectedColumnProvenance(schema, field) !== 'injected-unprovisioned';
}

/** A usable owner: a non-empty id that is not the seed identity (`usr_system` owns nothing a person can sign in as). */
export function isStampableOwner(userId: unknown): userId is string {
    return typeof userId === 'string' && userId.trim() !== '' && userId !== SystemUserId.SYSTEM;
}

function yieldToEventLoop(): Promise<void> {
    return new Promise<void>((resolve) => {
        if (typeof setImmediate === 'function') setImmediate(resolve);
        else setTimeout(resolve, 0);
    });
}

function affected(result: unknown): number {
    return typeof result === 'number' && Number.isFinite(result) ? result : 0;
}

/**
 * Stamp `owner_id` and `created_by` = `ownerUserId` on the rows a seed load
 * created (`insertedIds`), where each is still empty. Total: a refused write
 * is retried row by row (a stored expression reading the owner refuses one
 * predicate write over rows that compute different values; any other refusal
 * is per row too), and a row still refused keeps what the seed wrote and is
 * counted in `refused`. Never throws for a row; a missing engine answers an
 * empty result.
 *
 * `organizationId` (the load's, under a wall) is added to every predicate of an
 * object carrying `organization_id`, so a stamp can only land in the
 * organization the load wrote.
 */
export async function stampSeedOwner(
    engine: SeedOwnerStampEngine | null | undefined,
    loaded: readonly SeedOwnerStampInput[],
    ownerUserId: string | null | undefined,
    options: { organizationId?: string } = {},
): Promise<SeedOwnerStampResult> {
    if (!isStampableOwner(ownerUserId)) return { ownerUserId: null, objects: [] };
    if (!engine || typeof engine.update !== 'function') return { ownerUserId, objects: [] };

    // One id set per object: a multi-pass load can report an object twice.
    const created = new Map<string, Set<string>>();
    for (const r of loaded) {
        if (!r || typeof r.object !== 'string' || !Array.isArray(r.insertedIds)) continue;
        const into = created.get(r.object) ?? new Set<string>();
        for (const id of r.insertedIds) if (typeof id === 'string' && id !== '') into.add(id);
        if (into.size > 0) created.set(r.object, into);
    }

    const objects: SeedOwnerStampObject[] = [];
    for (const [object, idSet] of created) {
        const ids = [...idSet];
        const row: SeedOwnerStampObject = { object, created: ids.length, owner: 0, createdBy: 0, refused: 0 };
        objects.push(row);

        let schema: any;
        try {
            schema = typeof engine.getSchema === 'function' ? engine.getSchema(object) : engine.registry?.getObject?.(object);
        } catch { schema = undefined; }
        // The claim's skips: a platform table's or a managed object's owner is
        // the platform's, and a federated object's columns are a remote's.
        if (!schema) { row.skipped = 'no-schema'; continue; }
        if (object.startsWith('sys_') || schema.managedBy) { row.skipped = 'platform-object'; continue; }
        if (schema.external) { row.skipped = 'external'; continue; }
        const owner = OWNER_FIELD in fieldMap(schema);
        const createdBy = hasStoredField(schema, CREATED_BY_FIELD);
        if (!owner && !createdBy) { row.skipped = 'no-owner-columns'; continue; }
        const scope: Record<string, unknown> = options.organizationId && ORGANIZATION_FIELD in fieldMap(schema)
            ? { [ORGANIZATION_FIELD]: options.organizationId }
            : {};

        // Both empty (every row a seed writes without authoring either), then
        // each alone (a seed that authored the other). Disjoint in this order.
        const arms: Array<{ where: Record<string, unknown>; set: Record<string, unknown>; owner: boolean; createdBy: boolean }> = [];
        if (owner && createdBy) {
            arms.push({ where: { [OWNER_FIELD]: null, [CREATED_BY_FIELD]: null }, set: { [OWNER_FIELD]: ownerUserId, [CREATED_BY_FIELD]: ownerUserId }, owner: true, createdBy: true });
        }
        if (owner) arms.push({ where: { [OWNER_FIELD]: null }, set: { [OWNER_FIELD]: ownerUserId }, owner: true, createdBy: false });
        if (createdBy) arms.push({ where: { [CREATED_BY_FIELD]: null }, set: { [CREATED_BY_FIELD]: ownerUserId }, owner: false, createdBy: true });

        const refusedIds = new Set<string>();
        for (let at = 0; at < ids.length; at += SEED_OWNER_STAMP_BATCH) {
            const chunk = ids.slice(at, at + SEED_OWNER_STAMP_BATCH);
            for (const arm of arms) {
                let n = 0;
                try {
                    n = affected(await engine.update(object, { ...arm.set }, {
                        where: { ...scope, ...arm.where, id: { $in: chunk } },
                        multi: true,
                        context: SEED_OWNER_STAMP_CTX,
                    }));
                } catch {
                    // By row: each is computed from its own row, and one row's
                    // refusal costs only that row. The empty-field term stays,
                    // so a row the chunk did write is not written twice.
                    for (const id of chunk) {
                        try {
                            n += affected(await engine.update(object, { ...arm.set }, {
                                where: { ...scope, ...arm.where, id },
                                multi: true,
                                context: SEED_OWNER_STAMP_CTX,
                            }));
                        } catch (e) {
                            refusedIds.add(id);
                            row.error ??= e instanceof Error ? e.message : String(e);
                        }
                    }
                }
                if (arm.owner) row.owner += n;
                if (arm.createdBy) row.createdBy += n;
            }
            await yieldToEventLoop();
        }
        row.refused = refusedIds.size;
    }
    return { ownerUserId, objects };
}
