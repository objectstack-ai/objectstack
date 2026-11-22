// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `sys_notification_preference.digest`: the stored `none` that meant "nobody
 * chose" → empty, ONCE per deployment (ruling 7073270426 on #35123, item 4).
 *
 * ## What changed underneath these rows
 *
 * The field used to declare `defaultValue: 'none'`, so every row nobody chose
 * a digest for stored `none`, and the resolver read `none` as "no opinion":
 * the walk went on to the organization's default. From this release the field
 * has three states (see `parseDigest` in `preference-resolver.ts`): empty is
 * "not set" and walks on; `none` is a person's explicit "send each one right
 * away" and decides. Left alone, every legacy `none` would turn into an
 * opt-out from the organization's digest that nobody made.
 *
 * A stored `none` never took effect before this release, so rewriting every
 * one to empty changes no one's effective digest at upgrade. Someone who
 * picked `none` by hand in the Setup grid hoping to opt out (it did not work)
 * has to pick it again.
 *
 * ## Why ONCE, and why the ledger
 *
 * After this release a stored `none` is a real choice. A conversion that ran
 * on every boot — the shape `preference-user-conversion.ts` can afford,
 * because nothing writes its old value any more — would erase those choices
 * at the next restart. So the pass records itself in `sys_migration`, the
 * deployment-level ledger that answers "has THIS deployment run this data
 * migration" (`plugin-auth`'s `membership-backfill-ledger.ts` is the
 * precedent), and every later boot reads that row and does nothing.
 *
 *  - The row is CLAIMED before the first rewrite: once a rewrite has
 *    happened, a later boot must never run again, whatever else fails.
 *  - `verified_at: null` (no self-check certifies it), `blocking: 0` (it
 *    gates nothing); `details` says what the pass did.
 *  - No ledger on the kernel, or a ledger that cannot be read: the pass does
 *    NOT run, because it could not be recorded and would repeat.
 *
 * Every organization's rows: the read is the platform's own, not a tenant's.
 * Each rewrite is addressed by id AND the stored `none`, under the row's own
 * organization, so a value written since the read is left alone.
 */

import type { IDataEngine } from '@objectstack/spec/contracts';
import { DATA_MIGRATION_FLAG_OBJECT, type DataMigrationFlag } from '@objectstack/spec/system';
import { isMissingTableError } from '@objectstack/types';
import { PREFERENCE_OBJECT } from './preference-resolver.js';

/**
 * The ledger row id of this conversion. Spelled here, not in
 * `@objectstack/spec/system`: the writer and the only reader are this module.
 */
export const PREFERENCE_DIGEST_NONE_CONVERSION_ID = 'messaging-preference-digest-none-unset';

/** The legacy value this conversion rewrites. */
const LEGACY_UNSET_DIGEST = 'none';

/** The table this conversion rewrites; the type ties it to `PREFERENCE_OBJECT`. */
const OBJECT: typeof PREFERENCE_OBJECT = 'sys_notification_preference';

/** How many rows one read takes — the same ceiling `PreferenceResolver.loadRows` reads with. */
const PASS_LIMIT = 10000;

const SYSTEM_CONTEXT = { isSystem: true } as const;

export interface PreferenceDigestConversionLogger {
    info(message: string, meta?: Record<string, unknown>): void;
    warn(message: string, meta?: Record<string, unknown>): void;
    error(message: string, error?: Error, meta?: Record<string, unknown>): void;
}

/** The engine surface the conversion needs: rows, and the ledger. */
type ConversionEngine = Pick<IDataEngine, 'find' | 'findOne' | 'insert' | 'update'> & {
    getObject?(name: string): unknown;
};

export interface PreferenceDigestConversionResult {
    /**
     * - `converted` — the ledger row was claimed and every legacy `none` found
     *   was attempted (`failed` lists the ones left as stored);
     * - `already-run` — the ledger records an earlier pass; nothing was read;
     * - `ledger-unavailable` — no `sys_migration` on this kernel; nothing ran;
     * - `ledger-unreadable` — the ledger read failed; nothing ran;
     * - `read-failed` — the preference rows could not be read; nothing was
     *   claimed or rewritten, and the next boot tries again;
     * - `claim-failed` — the ledger row could not be written; nothing was
     *   rewritten;
     * - `no-engine` — no data engine that reads and writes rows.
     */
    status: 'converted' | 'already-run' | 'ledger-unavailable' | 'ledger-unreadable' | 'read-failed' | 'claim-failed' | 'no-engine';
    converted: number;
    /** Ids of rows whose rewrite was refused — each still holds `none`. */
    failed: string[];
}

function messageOf(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

function textOrUndefined(value: unknown): string | undefined {
    return value === null || value === undefined ? undefined : String(value);
}

/** The ledger row this pass writes — pure. */
export function buildDigestConversionRecord(details: Record<string, unknown>, now: string): DataMigrationFlag {
    return {
        id: PREFERENCE_DIGEST_NONE_CONVERSION_ID,
        last_run_at: now,
        applied_at: now,
        verified_at: null,
        blocking: 0,
        details: JSON.stringify(details),
    };
}

/**
 * Rewrite every legacy stored `digest = 'none'` to empty, across every
 * organization, unless this deployment's ledger already records the pass.
 * Never throws: it runs in a boot hook, which it must not break.
 */
export async function convertLegacyNoneDigestsOnce(
    engine: IDataEngine | undefined,
    logger?: PreferenceDigestConversionLogger,
): Promise<PreferenceDigestConversionResult> {
    const result = (status: PreferenceDigestConversionResult['status'], converted = 0, failed: string[] = []): PreferenceDigestConversionResult =>
        ({ status, converted, failed });
    const e = engine as ConversionEngine | undefined;
    if (!e || typeof e.find !== 'function' || typeof e.update !== 'function' || typeof e.findOne !== 'function' || typeof e.insert !== 'function') {
        return result('no-engine');
    }

    if (typeof e.getObject !== 'function' || !e.getObject(DATA_MIGRATION_FLAG_OBJECT)) {
        logger?.warn(
            `[messaging] the one-time ${OBJECT} digest conversion did NOT run: the deployment ledger ` +
                `(${DATA_MIGRATION_FLAG_OBJECT}) is not available on this kernel, so the pass could not be recorded and ` +
                'would erase choices made after it on every later boot. Rows that still hold the old default digest ' +
                "'none' read as a person's own choice of no digest. Compose PlatformObjectsPlugin (it provisions the ledger).",
        );
        return result('ledger-unavailable');
    }

    try {
        const row = await e.findOne(DATA_MIGRATION_FLAG_OBJECT, { where: { id: PREFERENCE_DIGEST_NONE_CONVERSION_ID } }, { context: SYSTEM_CONTEXT });
        if ((row as Record<string, unknown> | null)?.id === PREFERENCE_DIGEST_NONE_CONVERSION_ID) return result('already-run');
    } catch (err) {
        logger?.warn(
            `[messaging] the one-time ${OBJECT} digest conversion did NOT run: reading its record in ` +
                `${DATA_MIGRATION_FLAG_OBJECT} failed (${messageOf(err)}), and running without knowing whether it ` +
                'already ran could erase choices made since. It is retried on the next boot.',
        );
        return result('ledger-unreadable');
    }

    const readLegacy = async (): Promise<Array<Record<string, unknown>>> => {
        try {
            return ((await e.find(
                OBJECT,
                { where: { digest: LEGACY_UNSET_DIGEST }, fields: ['id', 'organization_id'], limit: PASS_LIMIT },
                { context: SYSTEM_CONTEXT },
            )) ?? []) as Array<Record<string, unknown>>;
        } catch (err) {
            // No table yet holds no legacy row: a fresh database.
            if (isMissingTableError(err, OBJECT)) return [];
            throw err;
        }
    };

    let rows: Array<Record<string, unknown>>;
    try {
        rows = await readLegacy();
    } catch (err) {
        logger?.error(
            `[messaging] the one-time ${OBJECT} digest conversion could not read the rows it converts, so it did not ` +
                "run: rows that still hold the old default digest 'none' read as a person's own choice of no digest, " +
                "and those people do not get their organization's digest while everything looks healthy. Fix the " +
                'cause below and restart; the conversion is retried on the next boot.',
            undefined,
            { object: OBJECT, error: messageOf(err) },
        );
        return result('read-failed');
    }

    // Claim the ledger row BEFORE the first rewrite: from here on, no later
    // boot may run this again.
    const startedAt = new Date().toISOString();
    try {
        const flag = buildDigestConversionRecord({ status: 'started', found: rows.length }, startedAt);
        await e.insert(DATA_MIGRATION_FLAG_OBJECT, { ...flag, created_at: startedAt, updated_at: startedAt }, { context: SYSTEM_CONTEXT });
    } catch (err) {
        // A concurrent node that claimed it first counts as run.
        try {
            const row = await e.findOne(DATA_MIGRATION_FLAG_OBJECT, { where: { id: PREFERENCE_DIGEST_NONE_CONVERSION_ID } }, { context: SYSTEM_CONTEXT });
            if ((row as Record<string, unknown> | null)?.id === PREFERENCE_DIGEST_NONE_CONVERSION_ID) return result('already-run');
        } catch {
            /* reported below */
        }
        logger?.error(
            `[messaging] the one-time ${OBJECT} digest conversion did not run: recording it in ` +
                `${DATA_MIGRATION_FLAG_OBJECT} failed (${messageOf(err)}). Rows that still hold the old default digest ` +
                "'none' read as a person's own choice of no digest, so those people do not get their organization's " +
                `digest while everything looks healthy. Fix: make ${DATA_MIGRATION_FLAG_OBJECT} writable and restart.`,
            undefined,
            { object: OBJECT, error: messageOf(err) },
        );
        return result('claim-failed');
    }

    let converted = 0;
    const failed: string[] = [];
    const seen = new Set<string>();
    // Pass until a read returns no row this run has not already handled. A row
    // left as stored still matches the filter, so `seen` is what ends the loop.
    for (;;) {
        const fresh = rows.filter((row) => !seen.has(String(row.id)));
        if (fresh.length === 0) break;
        for (const row of fresh) {
            const id = String(row.id);
            seen.add(id);
            try {
                // A migration is an entry point, so it states the system
                // context itself, with the row's own organization threaded.
                await e.update(
                    OBJECT,
                    { digest: null },
                    { where: { id, digest: LEGACY_UNSET_DIGEST }, context: { ...SYSTEM_CONTEXT, tenantId: textOrUndefined(row.organization_id) } },
                );
                converted += 1;
            } catch (err) {
                failed.push(id);
                logger?.error(
                    `[messaging] the one-time ${OBJECT} digest conversion could not rewrite row ${id} (${messageOf(err)}): ` +
                        "it still holds the old default digest 'none', which now reads as that person's own choice of no " +
                        "digest. Fix: open the row in Setup, Notification Preferences, and clear its Digest.",
                    undefined,
                    { object: OBJECT, id },
                );
            }
        }
        try {
            rows = await readLegacy();
        } catch (err) {
            logger?.error(
                `[messaging] the one-time ${OBJECT} digest conversion stopped after ${converted} row(s): re-reading the ` +
                    `rows failed (${messageOf(err)}). It is recorded as run and will not run again, so any row still ` +
                    "holding digest 'none' reads as that person's own choice of no digest. Fix: clear Digest on those " +
                    'rows in Setup, Notification Preferences.',
                undefined,
                { object: OBJECT, error: messageOf(err) },
            );
            break;
        }
    }

    try {
        await e.update(
            DATA_MIGRATION_FLAG_OBJECT,
            { details: JSON.stringify({ status: 'converted', converted, failed }), updated_at: new Date().toISOString() },
            { where: { id: PREFERENCE_DIGEST_NONE_CONVERSION_ID }, context: SYSTEM_CONTEXT },
        );
    } catch (err) {
        // The claim already stops every later run; only the receipt's details are missing.
        logger?.warn(
            `[messaging] the one-time ${OBJECT} digest conversion ran (${converted} row(s)) but its receipt in ` +
                `${DATA_MIGRATION_FLAG_OBJECT} was not updated (${messageOf(err)}); it will not run again.`,
        );
    }
    if (converted > 0) {
        logger?.info(
            `[messaging] rewrote ${converted} ${OBJECT} row(s) from the old default digest 'none' to empty (not set): ` +
                "each now follows the organization's default, as it did before. Recorded once in " +
                `${DATA_MIGRATION_FLAG_OBJECT} ('${PREFERENCE_DIGEST_NONE_CONVERSION_ID}').`,
            { object: OBJECT, converted },
        );
    }
    return result('converted', converted, failed);
}
