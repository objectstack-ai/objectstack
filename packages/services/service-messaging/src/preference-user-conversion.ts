// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `sys_notification_preference.user_id`: the stored sentinel `'*'` → the empty
 * reference (ADR-0118 D1; maintainer ruling A on the card that retyped the
 * column, Q2 B of the seat call that set its execution).
 *
 * ## What changed underneath these rows
 *
 * `user_id` was a text column holding a `sys_user` id, or the literal `'*'`
 * for the admin-global default. It is now a `sys_user` reference, and the
 * admin-global default is the row whose reference is EMPTY — ADR-0118 D1's
 * representation of "no particular user" in a user column, with no sentinel.
 * `PreferenceResolver` reads only that: a row still holding `'*'` is a row for a
 * user id nobody has, so it matches no recipient.
 *
 * ## Why this runs at boot, unprompted
 *
 * Unlike the `'system'` sentinel `sys_metadata_history.recorded_by` once held
 * (display only), a `'*'` row here changes BEHAVIOUR: it is an admin's mute or
 * allow for every user. Left unconverted it would stop applying the moment the
 * new resolver loads, while everything keeps looking healthy, so the rewrite
 * cannot wait for an operator to remember a command. It is tiny (admin-authored
 * rows; no code path ever wrote `'*'`), so it runs on every boot at
 * `kernel:ready` and costs one indexed read when there is nothing to do.
 *
 * ## Idempotency
 *
 * The read selects only rows still holding `'*'`, and each write sets the
 * constant empty reference on one row addressed by id. A second run finds
 * nothing and writes nothing.
 *
 * ## Refuse, never keep-one (ADR-0120 D4)
 *
 * The NULL-safe unique index (`metadata-protocol`'s
 * `ensureNotificationPreferenceIdentityIndex`) admits ONE global default per
 * (organization, topic, channel). A `'*'` row cannot collide with another
 * `'*'` row (the previous index already keyed them), but it can collide with an
 * empty-reference row for the same (topic, channel) written since. That pair is
 * two admin decisions for one key, so nothing is discarded: the `'*'` row is
 * left exactly as stored, and the operator is told which row and how to settle
 * it.
 */

import type { IDataEngine } from '@objectstack/spec/contracts';
import { isMissingTableError, isUniqueViolationError, operatorFacingErrorText } from '@objectstack/types';
import { PREFERENCE_OBJECT } from './preference-resolver.js';

/** The sentinel the text column held for the admin-global default. Read here and nowhere else. */
export const LEGACY_WILDCARD_USER = '*';

/** The engine's own code for a refused duplicate (ADR-0112) — branched on before any driver shape. */
const DUPLICATE_RECORD_CODE = 'DUPLICATE_RECORD';

/**
 * The table this conversion rewrites, spelled at its call sites so the tenant
 * audit census can place them (an imported name reads as a runtime value). The
 * type ties it to `PREFERENCE_OBJECT`: a different literal does not compile.
 */
const OBJECT: typeof PREFERENCE_OBJECT = 'sys_notification_preference';

/** How many rows one pass reads — the same ceiling `PreferenceResolver.loadRows` reads with. */
const PASS_LIMIT = 10000;

export interface PreferenceUserConversionLogger {
    info(message: string, meta?: Record<string, unknown>): void;
    error(message: string, error?: Error, meta?: Record<string, unknown>): void;
}

/** One `'*'` row this run left as stored, and why. */
export interface PreferenceUserConversionMiss {
    id: string;
    organizationId: string | null;
    topic: string | null;
    channel: string | null;
    /** `duplicate`: an empty-reference row already holds the key. `failed`: the write was refused otherwise. */
    reason: 'duplicate' | 'failed';
    detail: string;
}

export interface PreferenceUserConversionResult {
    /**
     * - `converted` — at least one row was rewritten (misses may sit beside it);
     * - `nothing-to-convert` — the read ran and found no `'*'` row;
     * - `absent` — the table does not exist on this database yet, so no row can hold `'*'`;
     * - `no-engine` — no data engine that reads and writes rows;
     * - `failed` — the read failed, or every row found was left as stored.
     */
    status: 'converted' | 'nothing-to-convert' | 'absent' | 'no-engine' | 'failed';
    converted: number;
    missed: PreferenceUserConversionMiss[];
    /** The read's own refusal, when the read failed. */
    detail?: string;
}

function textOrNull(value: unknown): string | null {
    return value === null || value === undefined ? null : String(value);
}

/**
 * Rewrite every stored `user_id = '*'` to the empty reference, across every
 * organization. Never throws: a boot must not fail on this, and each outcome is
 * returned and, where it leaves a default not applying, logged at `error`.
 */
export async function convertWildcardPreferenceUsers(
    engine: IDataEngine | undefined,
    logger?: PreferenceUserConversionLogger,
): Promise<PreferenceUserConversionResult> {
    // An engine that cannot read and write rows has no rows to convert either:
    // the same probe `provisionSystemTables` makes of `syncObjectSchema`.
    if (!engine || typeof engine.find !== 'function' || typeof engine.update !== 'function') {
        return { status: 'no-engine', converted: 0, missed: [] };
    }
    const object = OBJECT;

    let converted = 0;
    const missed: PreferenceUserConversionMiss[] = [];
    const seen = new Set<string>();

    // Pass until a read returns no row this run has not already handled. A row
    // left as stored still matches the filter, so `seen` is what ends the loop.
    for (;;) {
        let rows: Array<Record<string, unknown>>;
        try {
            rows = (await engine.find(
                OBJECT,
                {
                    where: { user_id: LEGACY_WILDCARD_USER },
                    fields: ['id', 'organization_id', 'topic', 'channel'],
                    limit: PASS_LIMIT,
                },
                // Every organization's rows: the read is the platform's own, not a tenant's.
                { context: { isSystem: true } },
            )) ?? [];
        } catch (err) {
            // No table yet holds no '*' row — a fresh database, or a boot whose
            // schema sync is skipped. Anything else is "could not look".
            if (isMissingTableError(err, object)) return { status: 'absent', converted, missed };
            const detail = operatorFacingErrorText(err);
            logger?.error(
                `[messaging] could not read ${object} to rewrite user_id '${LEGACY_WILDCARD_USER}' to the empty ` +
                    'reference, so any admin-global notification default still stored that way is NOT applying: ' +
                    'notifications an admin muted for every user are being delivered while everything looks ' +
                    'healthy. Fix the cause below and restart; the rewrite runs on every boot.',
                undefined,
                { object, error: detail },
            );
            return { status: 'failed', converted, missed, detail };
        }

        const fresh = rows.filter((row) => !seen.has(String(row.id)));
        if (fresh.length === 0) break;

        for (const row of fresh) {
            const id = String(row.id);
            seen.add(id);
            const organizationId = textOrNull(row.organization_id);
            try {
                // ADR-0118 D3: a migration is an entry point, so it states the
                // system context itself. The row's own organization is threaded
                // on the write, so it is tenant-scoped like any other write to
                // this object and needs no audit bypass.
                await engine.update(
                    OBJECT,
                    { user_id: null },
                    { where: { id }, context: { isSystem: true, tenantId: organizationId ?? undefined } },
                );
                converted += 1;
            } catch (err) {
                const duplicate = (err as { code?: unknown } | null)?.code === DUPLICATE_RECORD_CODE || isUniqueViolationError(err);
                missed.push({
                    id,
                    organizationId,
                    topic: textOrNull(row.topic),
                    channel: textOrNull(row.channel),
                    reason: duplicate ? 'duplicate' : 'failed',
                    detail: operatorFacingErrorText(err),
                });
            }
        }
    }

    if (converted > 0) {
        logger?.info(
            `[messaging] rewrote ${converted} ${object} row(s) from user_id '${LEGACY_WILDCARD_USER}' to the empty ` +
                'reference, the admin-global default for every user (an empty User).',
            { object, converted },
        );
    }

    if (missed.length > 0) {
        // Once per boot, naming every row: from the outside nothing looks wrong
        // while each of these admin defaults has stopped applying.
        const duplicates = missed.filter((m) => m.reason === 'duplicate');
        logger?.error(
            `[messaging] ${missed.length} ${object} row(s) still hold user_id '${LEGACY_WILDCARD_USER}' and are NOT ` +
                'applying as the admin-global default: each row is kept as stored, and its mute or allow for every ' +
                'user is ignored while everything looks healthy. ' +
                (duplicates.length > 0
                    ? `${duplicates.length} of them share an organization, topic and channel with a default that ` +
                      'already has an empty User, and only one default per key is allowed: delete the one you do not ' +
                      'want, then restart. '
                    : '') +
                'Rows: ' +
                missed.map((m) => `${m.id} (${m.topic ?? ''} · ${m.channel ?? ''}: ${m.reason})`).join(', ') +
                '.',
            undefined,
            { object, missed },
        );
    }

    if (converted > 0) return { status: 'converted', converted, missed };
    if (missed.length > 0) return { status: 'failed', converted, missed };
    return { status: 'nothing-to-convert', converted, missed };
}
