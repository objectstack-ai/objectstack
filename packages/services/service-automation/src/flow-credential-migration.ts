// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * # The one-time move of stored flow credentials into the write-only channel (#20790)
 *
 * From this release the metadata save door stores a flow's credentials in the
 * write-only flow credential channel (`flow-credential-channel.ts`) and keeps
 * none in the stored definition. Flows stored BEFORE it still carry their
 * inbound hook secret and their `http` nodes' signing secrets in cleartext in
 * their stored row. This moves them, once:
 *
 *  - **Through the same door.** Each stored flow row that still carries an
 *    explicit credential is re-saved through the protocol's `saveMetaItem` at
 *    its own state and package binding, with the server-stated
 *    `source: 'migrate-stored'` (the platform healing its own storage, not an
 *    author publishing). The door's channel step moves the value and stores
 *    the definition without it — no second write path, and no new copy: the
 *    history row the re-save appends carries no credential.
 *  - **Rotate, don't scrub (Q1 B).** The version-history rows and audit
 *    snapshots written before this move keep what they recorded — both are
 *    append-only, and a scrub would not un-expose a value an administrator
 *    could already read. Each moved flow gets a loud notice, per flow, that its
 *    credential was exposed at rest before the move and must be rotated. The
 *    notice names the flow and the credential's CLASS, never the value.
 *  - **Packaged flows are not moved (Q3 A).** Only stored rows are read; a
 *    packaged flow's literal stays its author's source of truth.
 *  - **Fail-closed and idempotent.** With no crypto provider the first save is
 *    refused before anything is written, the run stops and reports itself
 *    deferred, and the next crypto-provider registration runs it again. A row
 *    with no explicit credential is skipped, so a later run finds nothing.
 *  - **A receipt.** A run that moved or failed to move anything records itself
 *    in the `sys_migration` deployment ledger, the seed-tenancy repair's
 *    receipt convention: `verified_at: null` (no self-check certifies it) and
 *    `blocking: 0` (it gates nothing). Its details name flows, never values.
 */

import { DATA_MIGRATION_FLAG_OBJECT, type DataMigrationFlag } from '@objectstack/spec/system';
import { explicitFlowCredentials, FLOW_CREDENTIAL_UNAVAILABLE_CODE } from './flow-credential-channel.js';
import { FLOW_METADATA_TYPE, flowCredentialClassList } from './flow-credential-projection.js';

/** The receipt's id in `sys_migration` — read by an operator, gated on by nothing. */
export const FLOW_CREDENTIAL_MIGRATION_ID = 'flow-credential-channel';

/** The stored-row table the migration reads (ADR-0008's one repository table). */
const STORED_ROW_OBJECT = 'sys_metadata';

const SYSTEM_CONTEXT = { isSystem: true, positions: [], permissions: [] } as const;

/** The slice of the data engine the migration reads stored rows and writes its receipt through. */
export interface FlowCredentialMigrationEngine {
    find(object: string, query?: Record<string, unknown>): Promise<unknown>;
    findOne(object: string, query?: Record<string, unknown>): Promise<Record<string, unknown> | null>;
    insert(object: string, data: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
    update(object: string, data: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
    getObject?(name: string): unknown;
}

/** The slice of the metadata protocol the migration re-saves through. */
export interface FlowCredentialMigrationProtocol {
    saveMetaItem(request: {
        type: string;
        name: string;
        item: unknown;
        mode: 'draft' | 'publish';
        packageId: string | null;
        organizationId?: string;
        source: string;
    }): Promise<unknown>;
}

interface MigrationLogger {
    info(msg: string, meta?: unknown): void;
    warn(msg: string, meta?: unknown): void;
    error(msg: string, error?: Error, meta?: unknown): void;
}

export interface FlowCredentialMigrationResult {
    /**
     * `applied` — every row that carried a credential was attempted;
     * `nothing-to-move` — no stored flow row carries one;
     * `deferred` — no crypto provider yet: nothing was written, and the next
     * provider registration runs it again.
     */
    status: 'applied' | 'nothing-to-move' | 'deferred';
    /** Stored rows that carried an explicit credential. */
    found: number;
    /** `name (state)` of every row moved. */
    migrated: string[];
    /** Rows left as they were, with the refusal's code. */
    failed: Array<{ flow: string; state: string; code: string }>;
}

function rowsOf(found: unknown): Record<string, unknown>[] {
    if (Array.isArray(found)) return found as Record<string, unknown>[];
    const env = found as { data?: unknown; records?: unknown; value?: unknown } | null | undefined;
    for (const candidate of [env?.data, env?.records, env?.value]) {
        if (Array.isArray(candidate)) return candidate as Record<string, unknown>[];
    }
    return [];
}

function parseBody(raw: unknown): unknown {
    if (typeof raw !== 'string') return raw;
    try {
        return JSON.parse(raw);
    } catch {
        return undefined;
    }
}

/**
 * The rotation notice for one moved row (Q1 B). Exported so the pin reads the
 * one sentence the log carries. Names the flow and the credential classes —
 * never a value, a node id or a path.
 */
export function flowCredentialRotationNotice(flow: string, state: string, keys: Iterable<string>): string {
    const distinct = new Set(keys);
    const classes = flowCredentialClassList(distinct);
    const plural = distinct.size > 1;
    return (
        `[Automation] flow '${flow}' (${state}): ${classes} ${plural ? 'were' : 'was'} stored in cleartext in the flow ` +
        `definition before this release — in its stored row and its version history, where an administrator could read ` +
        `${plural ? 'them' : 'it'}. ${plural ? 'They are' : 'It is'} now held by the write-only flow credential store and ` +
        'no longer stored in the definition; the copies already written stay in the append-only version history and ' +
        'audit trail. ROTATE: save the flow with a new value for each, and give the new secret to whoever signs posts ' +
        'to this hook or verifies these deliveries.'
    );
}

/** The receipt row for one run — pure. See the module header for the field reading. */
export function buildFlowCredentialReceipt(result: FlowCredentialMigrationResult, now: string): DataMigrationFlag {
    return {
        id: FLOW_CREDENTIAL_MIGRATION_ID,
        last_run_at: now,
        applied_at: now,
        verified_at: null,
        blocking: 0,
        advisory: result.failed.length,
        details: JSON.stringify({
            status: result.status,
            found: result.found,
            migrated: result.migrated,
            failed: result.failed,
        }),
    };
}

async function persistReceipt(engine: FlowCredentialMigrationEngine, flag: DataMigrationFlag): Promise<void> {
    const existing = await engine.findOne(DATA_MIGRATION_FLAG_OBJECT, { where: { id: flag.id }, context: SYSTEM_CONTEXT });
    const row: Record<string, unknown> = { ...flag, updated_at: flag.last_run_at };
    if (existing?.id === flag.id) {
        await engine.update(DATA_MIGRATION_FLAG_OBJECT, row, { context: SYSTEM_CONTEXT });
        return;
    }
    await engine.insert(DATA_MIGRATION_FLAG_OBJECT, { ...row, created_at: flag.last_run_at }, { context: SYSTEM_CONTEXT });
}

/**
 * Move every stored flow credential into the channel. Never throws: a boot
 * hook and a crypto-provider listener call it, and neither may be broken by
 * it. What it could not do it reports — per flow, and in the receipt.
 */
export async function migrateFlowCredentialsIntoChannel(deps: {
    engine: FlowCredentialMigrationEngine;
    protocol: FlowCredentialMigrationProtocol;
    logger: MigrationLogger;
}): Promise<FlowCredentialMigrationResult> {
    const { engine, protocol, logger } = deps;
    const result: FlowCredentialMigrationResult = { status: 'nothing-to-move', found: 0, migrated: [], failed: [] };

    let rows: Record<string, unknown>[];
    try {
        rows = rowsOf(
            await engine.find(STORED_ROW_OBJECT, { where: { type: FLOW_METADATA_TYPE }, context: SYSTEM_CONTEXT }),
        );
    } catch (err) {
        logger.warn(
            '[Automation] the stored flow credential move could not read the stored flow rows; it runs again at the ' +
                'next boot or crypto-provider registration.',
            { error: (err as Error)?.message ?? String(err) },
        );
        return result;
    }

    const notices: Array<{ flow: string; state: string; keys: string[] }> = [];
    for (const row of rows) {
        const name = row.name;
        if (typeof name !== 'string' || name === '') continue;
        const body = parseBody(row.metadata);
        const explicit = explicitFlowCredentials(body);
        if (explicit.length === 0) continue;
        const state = row.state === 'draft' ? 'draft' : 'active';
        result.found += 1;
        const organizationId = typeof row.organization_id === 'string' && row.organization_id !== ''
            ? row.organization_id
            : undefined;
        try {
            await protocol.saveMetaItem({
                type: FLOW_METADATA_TYPE,
                name,
                item: body,
                mode: state === 'draft' ? 'draft' : 'publish',
                packageId: typeof row.package_id === 'string' && row.package_id !== '' ? row.package_id : null,
                ...(organizationId ? { organizationId } : {}),
                source: 'migrate-stored',
            });
            result.migrated.push(`${name} (${state})`);
            notices.push({ flow: name, state, keys: explicit.map((p) => p.key) });
        } catch (err) {
            const code = typeof (err as { code?: unknown })?.code === 'string' ? (err as { code: string }).code : 'ERROR';
            if (code === FLOW_CREDENTIAL_UNAVAILABLE_CODE && result.migrated.length === 0 && notices.length === 0) {
                // No crypto provider (yet): the door refused before writing
                // anything, and every other row would be refused the same way.
                result.status = 'deferred';
                // Functional, not a loss: nothing was written, and the move
                // runs when the provider registers — `info`, every boot.
                logger.info(
                    '[Automation] stored flow credentials wait for a crypto provider: their move into the write-only ' +
                        'flow credential store runs when one is registered.',
                );
                return result;
            }
            result.failed.push({ flow: name, state, code });
            // A security property the platform claims — no flow credential in a
            // stored definition — does not hold for this row, and nothing else
            // looks wrong: `error`, with the consequence and the fix.
            logger.error(
                `[Automation] flow '${name}' (${state}): its credential could not be moved into the write-only flow ` +
                    `credential store (${code}), so its stored definition STILL CARRIES IT IN CLEARTEXT, readable ` +
                    'wherever the stored row is. Fix the cause and restart, or save the flow with a new value — and ' +
                    'rotate it.',
                err instanceof Error ? err : undefined,
                { flow: name, state, code },
            );
        }
    }

    if (result.found === 0) return result;
    result.status = 'applied';
    for (const notice of notices) logger.warn(flowCredentialRotationNotice(notice.flow, notice.state, notice.keys));

    if (typeof engine.getObject === 'function' && !engine.getObject(DATA_MIGRATION_FLAG_OBJECT)) {
        logger.warn(
            `[Automation] the stored flow credential move ran, but ${DATA_MIGRATION_FLAG_OBJECT} is not registered on this ` +
                'kernel, so the deployment ledger holds no receipt of it. Compose PlatformObjectsPlugin, or keep this ' +
                "boot's log: the rotation notices above are the only record.",
        );
        return result;
    }
    try {
        await persistReceipt(engine, buildFlowCredentialReceipt(result, new Date().toISOString()));
    } catch (e: unknown) {
        const detail = e instanceof Error ? e.message : String(e);
        const message =
            `[Automation] the stored flow credential move ran, but writing its receipt to ${DATA_MIGRATION_FLAG_OBJECT} ` +
            `failed (${detail}). The move itself is not retried — the rows no longer carry the credentials — so the ` +
            "rotation notices above are the only record of which flows must rotate. Keep this boot's log.";
        logger.error(message, e instanceof Error ? e : new Error(detail));
    }
    return result;
}
