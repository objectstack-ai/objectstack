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
 * ## Only the rows that held `none` before the claim
 *
 * The pass reads the ids of every row holding `none` FIRST, in pages by id,
 * then claims the ledger row, then rewrites exactly that snapshot — it never
 * reads the filter again. The deployment is serving while the boot hook
 * runs, so a `none` written during the pass (a member's own pick, a new row,
 * a node still on the earlier release in a rolling deploy) is a real choice
 * and is not part of the snapshot.
 *
 * Every organization's rows: the read is the platform's own, not a tenant's.
 * Each rewrite is addressed by id AND the stored `none`, under the row's own
 * organization, so a value written since the read is left alone.
 *
 * A claim that fails rewrites nothing, and the next boot takes a new
 * snapshot: a `none` written between those two boots is converted with the
 * rest. Nothing can record the earlier snapshot when the ledger itself cannot
 * be written, so that failure is logged as an error naming the fix.
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

/** How many rows one page of the snapshot read takes. */
const PAGE_SIZE = 10000;

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

export interface PreferenceDigestConversionOptions {
    /** Rows per page of the snapshot read; defaults to 10000. */
    pageSize?: number;
}

/** One row of the snapshot: what its rewrite is addressed by. */
interface LegacyRow {
    id: string;
    organizationId: string | undefined;
}

export interface PreferenceDigestConversionResult {
    /**
     * - `converted` — the ledger row was claimed and every row of the snapshot
     *   taken before the claim was attempted (`failed` lists the ones left as
     *   stored);
     * - `already-run` — the ledger records an earlier pass; nothing was read;
     * - `ledger-unavailable` — no `sys_migration` on this kernel; nothing ran;
     * - `ledger-unreadable` — the ledger read failed; nothing ran;
     * - `read-failed` — the preference rows could not be read (any page of
     *   the snapshot); nothing was claimed or rewritten, and the next boot
     *   tries again;
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
 * Rewrite every stored `digest = 'none'` that existed before the ledger claim
 * to empty, across every organization, unless this deployment's ledger
 * already records the pass. Never throws: it runs in a boot hook, which it
 * must not break.
 */
export async function convertLegacyNoneDigestsOnce(
    engine: IDataEngine | undefined,
    logger?: PreferenceDigestConversionLogger,
    options: PreferenceDigestConversionOptions = {},
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
                "'none' read as a person's own choice of no digest. Compose PlatformObjectsPlugin, which registers the ledger.",
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

    // The snapshot: every row holding `none` now, read in pages in id order
    // until a page comes back short. Taken before the claim, and the only
    // rows the pass rewrites.
    const size = Math.max(1, Math.floor(options.pageSize ?? PAGE_SIZE));
    const readSnapshot = async (): Promise<LegacyRow[]> => {
        const snapshot: LegacyRow[] = [];
        for (let after: string | undefined; ;) {
            let page: Array<Record<string, unknown>>;
            try {
                page = ((await e.find(
                    OBJECT,
                    {
                        where: { digest: LEGACY_UNSET_DIGEST, ...(after === undefined ? {} : { id: { $gt: after } }) },
                        fields: ['id', 'organization_id'],
                        orderBy: [{ field: 'id', order: 'asc' }],
                        limit: size,
                    },
                    { context: SYSTEM_CONTEXT },
                )) ?? []) as Array<Record<string, unknown>>;
            } catch (err) {
                // No table yet holds no legacy row: a fresh database.
                if (after === undefined && isMissingTableError(err, OBJECT)) return [];
                throw err;
            }
            for (const row of page) snapshot.push({ id: String(row.id), organizationId: textOrUndefined(row.organization_id) });
            if (page.length < size) return snapshot;
            after = String(page[page.length - 1]!.id);
        }
    };

    let rows: LegacyRow[];
    try {
        rows = await readSnapshot();
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
    // The snapshot only: a row that came to hold `none` after it was taken is
    // a choice made under this release, and is never read here.
    for (const { id, organizationId } of rows) {
        try {
            // A migration is an entry point, so it states the system
            // context itself, with the row's own organization threaded.
            // Compare-and-set: the predicate path honours both keys, so a
            // digest written since the read is left alone (0 matched).
            const matched = await e.update(
                OBJECT,
                { digest: null },
                { where: { id, digest: LEGACY_UNSET_DIGEST }, multi: true, context: { ...SYSTEM_CONTEXT, tenantId: organizationId } },
            );
            if (matched !== 0) converted += 1;
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
